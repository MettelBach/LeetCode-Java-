import { db, parseJson, tx } from '../db/index.js';
import { HttpError, notFound, round2 } from '../lib/http.js';
import { emit } from './events.js';
import { addHistory, getOrder } from './orders.js';
import { adjustOrderItemStock, adjustStock } from './stock.js';

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

export function createReturn(input: ReturnInput, user = 'System'): number {
  let buyerName = input.buyer_name ?? '';
  let buyerEmail = input.buyer_email ?? '';
  let currency = 'PLN';
  let items = input.items ?? [];
  if (input.order_id) {
    const o = getOrder(input.order_id);
    buyerName ||= o.delivery_fullname;
    buyerEmail ||= o.email;
    currency = o.currency;
    if (!items.length) {
      items = (db.prepare('SELECT id, product_id, name, sku, quantity, price FROM order_items WHERE order_id = ?').all(input.order_id) as any[]).map(
        (i) => ({ order_item_id: i.id, product_id: i.product_id, name: i.name, sku: i.sku, quantity: i.quantity, price: i.price }),
      );
    } else {
      // Fill product links from order items.
      items = items.map((it) => {
        if (it.order_item_id && it.product_id === undefined) {
          const oi = db.prepare('SELECT product_id FROM order_items WHERE id = ? AND order_id = ?').get(it.order_item_id, input.order_id) as any;
          return { ...it, product_id: oi?.product_id ?? null };
        }
        return it;
      });
    }
  }
  const refund = input.refund_amount ?? round2(items.reduce((s, i) => s + i.price * i.quantity, 0));
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
  if (patch.items) data.items = JSON.stringify(patch.items);
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
  tx(() => {
    for (const it of r.items as ReturnItem[]) {
      if (!it.product_id) continue;
      if (r.order_id) adjustOrderItemStock(r.order_id, it.product_id, it.quantity, 'return');
      else adjustStock(it.product_id, it.quantity, 'return');
    }
    db.prepare('UPDATE returns SET stock_returned = 1 WHERE id = ?').run(id);
  });
  if (r.order_id) addHistory(r.order_id, `Return #${id}: products returned to stock`, 'return', user);
}
