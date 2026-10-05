import { db, parseJson, tx } from '../db/index.js';
import { HttpError, notFound, round2 } from '../lib/http.js';
import { emit } from './events.js';
import { addHistory, getOrder, orderTotal } from './orders.js';
import { adjustStock, returnOrderLineStock } from './stock.js';

export interface ReturnItem {
  order_item_id?: number;
  product_id?: number | null;
  name: string;
  sku?: string;
  quantity: number;
  price: number;
}

export interface ReturnInput {
  order_id?: number | null;
  reason?: string;
  items?: ReturnItem[];
  refund_amount?: number;
  bank_account?: string;
  tracking_number?: string;
  notes?: string;
  buyer_name?: string;
  buyer_email?: string;
  source?: string;
  external_id?: string;
  status_id?: number;
}

function defaultReturnStatus() {
  return (db.prepare(`SELECT id FROM return_statuses ORDER BY system_key = 'new' DESC, sort LIMIT 1`).get() as { id: number }).id;
}

/**
 * Checks returned products against the order: only its own lines, not more
 * than ordered minus earlier returns; product links come from the order lines.
 */
function checkReturnItems(orderId: number, items: ReturnItem[], exceptReturnId = 0): ReturnItem[] {
  const lines = db.prepare('SELECT id, product_id, name, sku, quantity, price FROM order_items WHERE order_id = ?').all(orderId) as any[];
  const returned = new Map<number, number>();
  for (const r of db.prepare('SELECT items FROM returns WHERE order_id = ? AND id != ?').all(orderId, exceptReturnId) as { items: string }[]) {
    for (const it of parseJson<ReturnItem[]>(r.items, [])) if (it.order_item_id) returned.set(it.order_item_id, (returned.get(it.order_item_id) ?? 0) + it.quantity);
  }
  const asked = new Map<number, number>();
  return items.map((it) => {
    const line = it.order_item_id
      ? lines.find((l) => l.id === it.order_item_id)
      : lines.find((l) => (it.product_id && l.product_id === it.product_id) || (it.sku && l.sku === it.sku));
    if (!line) throw new HttpError(400, `"${it.name}" is not a product of this order`);
    asked.set(line.id, (asked.get(line.id) ?? 0) + it.quantity);
    const left = line.quantity - (returned.get(line.id) ?? 0);
    if (asked.get(line.id)! > left) throw new HttpError(400, `Only ${Math.max(0, left)} × "${line.name}" can still be returned`);
    return { ...it, order_item_id: line.id, product_id: line.product_id, name: it.name || line.name, sku: it.sku || line.sku };
  });
}

/** Refund cannot exceed what the order is worth minus earlier refunds. */
function checkRefund(orderId: number, refund: number, exceptReturnId = 0) {
  const total = orderTotal(orderId);
  const earlier = (db.prepare('SELECT COALESCE(SUM(refund_amount), 0) s FROM returns WHERE order_id = ? AND id != ?').get(orderId, exceptReturnId) as { s: number }).s;
  if (refund > round2(total - earlier) + 0.001) throw new HttpError(400, `The refund exceeds the order value (${round2(Math.max(0, total - earlier)).toFixed(2)} left to refund)`);
}

export function createReturn(input: ReturnInput, user = 'System'): number {
  let buyerName = input.buyer_name ?? '';
  let buyerEmail = input.buyer_email ?? '';
  let currency = 'PLN';
  let items = input.items ?? [];
  if (input.order_id) {
    const o = getOrder(input.order_id);
    if (o.deleted) throw new HttpError(400, 'The order is in the bin');
    buyerName ||= o.delivery_fullname;
    buyerEmail ||= o.email;
    currency = o.currency;
    if (!items.length) {
      // Everything that was not returned yet.
      items = (db.prepare('SELECT id, product_id, name, sku, quantity, price FROM order_items WHERE order_id = ?').all(input.order_id) as any[]).map((i) => ({
        order_item_id: i.id,
        product_id: i.product_id,
        name: i.name,
        sku: i.sku,
        quantity: i.quantity,
        price: i.price,
      }));
      const done = new Map<number, number>();
      for (const r of db.prepare('SELECT items FROM returns WHERE order_id = ?').all(input.order_id) as { items: string }[]) {
        for (const it of parseJson<ReturnItem[]>(r.items, [])) if (it.order_item_id) done.set(it.order_item_id, (done.get(it.order_item_id) ?? 0) + it.quantity);
      }
      items = items.map((i) => ({ ...i, quantity: i.quantity - (done.get(i.order_item_id!) ?? 0) })).filter((i) => i.quantity > 0);
      if (!items.length) throw new HttpError(400, 'All products of this order have already been returned');
    }
    items = checkReturnItems(input.order_id, items);
  }
  const refund = input.refund_amount ?? round2(items.reduce((s, i) => s + i.price * i.quantity, 0));
  if (refund < 0) throw new HttpError(400, 'The refund cannot be negative');
  if (input.order_id) checkRefund(input.order_id, refund);
  const id = Number(
    db
      .prepare(
        `INSERT INTO returns (order_id, status_id, source, external_id, reason, items, refund_amount, currency, buyer_name, buyer_email, bank_account, tracking_number, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.order_id ?? null,
        input.status_id ?? defaultReturnStatus(),
        input.source ?? 'manual',
        input.external_id ?? '',
        input.reason ?? '',
        JSON.stringify(items),
        refund,
        currency,
        buyerName,
        buyerEmail,
        input.bank_account ?? '',
        input.tracking_number ?? '',
        input.notes ?? '',
      ).lastInsertRowid,
  );
  if (input.order_id) {
    addHistory(input.order_id, `Return #${id} created (${refund.toFixed(2)} ${currency})`, 'return', user);
    emit('return_created', { orderId: input.order_id, user, returnId: id });
  }
  return id;
}

export function getReturn(id: number) {
  const r = db.prepare('SELECT * FROM returns WHERE id = ?').get(id) as any;
  if (!r) throw notFound('Return not found');
  return { ...r, items: parseJson(r.items, []) };
}

export function updateReturn(id: number, patch: Partial<ReturnInput> & { refunded?: boolean }, user = 'System') {
  const r = getReturn(id);
  const fields = ['status_id', 'reason', 'refund_amount', 'bank_account', 'tracking_number', 'notes', 'refunded'] as const;
  const data: Record<string, any> = {};
  for (const f of fields) if (patch[f] !== undefined) data[f] = typeof patch[f] === 'boolean' ? (patch[f] ? 1 : 0) : patch[f];
  if (patch.items) {
    if (r.stock_returned) throw new HttpError(409, 'Products were already returned to stock — the list cannot be changed');
    data.items = JSON.stringify(r.order_id ? checkReturnItems(r.order_id, patch.items, id) : patch.items);
  }
  if (r.order_id && data.refund_amount !== undefined) {
    if (data.refund_amount < 0) throw new HttpError(400, 'The refund cannot be negative');
    checkRefund(r.order_id, data.refund_amount, id);
  }
  if (data.status_id && !db.prepare('SELECT 1 FROM return_statuses WHERE id = ?').get(data.status_id)) throw new HttpError(400, 'Unknown return status');
  if (!Object.keys(data).length) return;
  db.prepare(`UPDATE returns SET ${Object.keys(data).map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(
    ...Object.values(data),
    id,
  );
  if (r.order_id && data.status_id && data.status_id !== r.status_id) {
    const st = db.prepare('SELECT name FROM return_statuses WHERE id = ?').get(data.status_id) as { name: string };
    addHistory(r.order_id, `Return #${id}: status → ${st.name}`, 'return', user);
  }
  if (r.order_id && data.refunded === 1 && !r.refunded) addHistory(r.order_id, `Return #${id}: refunded ${r.refund_amount.toFixed(2)} ${r.currency}`, 'return', user);
}

/** Puts returned products back into stock (once). */
export function returnToStock(id: number, user = 'System') {
  const r = getReturn(id);
  if (r.stock_returned) throw new HttpError(409, 'Stock already returned');
  let units = 0;
  tx(() => {
    for (const it of r.items as ReturnItem[]) {
      if (!it.product_id) continue;
      if (r.order_id) units += returnOrderLineStock(r.order_id, it.product_id, it.quantity, user);
      else {
        adjustStock(it.product_id, it.quantity, 'return', null, { user });
        units += it.quantity;
      }
    }
    db.prepare('UPDATE returns SET stock_returned = 1 WHERE id = ?').run(id);
  });
  if (r.order_id) {
    addHistory(
      r.order_id,
      units ? `Return #${id}: products returned to stock` : `Return #${id}: nothing returned to stock — the order did not take stock`,
      'return',
      user,
    );
  }
  return units;
}
