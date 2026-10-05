import { db, getSetting, parseJson, tx } from '../db/index.js';
import { HttpError, notFound, round2 } from '../lib/http.js';
import { emit } from './events.js';
import { adjustOrderItemStock, deductOrderStock, findProduct, restoreOrderStock } from './stock.js';

export const ORDER_FIELDS = [
  'external_id',
  'source',
  'integration_id',
  'date_add',
  'user_login',
  'email',
  'phone',
  'currency',
  'payment_method',
  'payment_cod',
  'paid_amount',
  'payment_date',
  'delivery_method',
  'delivery_price',
  'delivery_fullname',
  'delivery_company',
  'delivery_address',
  'delivery_postcode',
  'delivery_city',
  'delivery_country_code',
  'delivery_point_id',
  'delivery_point_name',
  'delivery_point_address',
  'delivery_point_postcode',
  'delivery_point_city',
  'invoice_wanted',
  'invoice_fullname',
  'invoice_company',
  'invoice_nip',
  'invoice_address',
  'invoice_postcode',
  'invoice_city',
  'invoice_country_code',
  'buyer_comment',
  'seller_comment',
  'extra_field_1',
  'extra_field_2',
  'star',
  'flag',
  'external_status',
  'external_data',
  'warehouse_id',
] as const;

/** Fields a user may edit on an existing order. */
export const EDITABLE_FIELDS = ORDER_FIELDS.filter(
  (f) => !['external_id', 'source', 'integration_id', 'external_data', 'external_status', 'paid_amount', 'payment_date', 'warehouse_id'].includes(f),
);

export interface ItemInput {
  product_id?: number | null;
  name: string;
  sku?: string;
  ean?: string;
  quantity: number;
  price: number;
  tax_rate?: number;
  weight?: number;
  location?: string;
  attributes?: string;
  auction_id?: string;
  external_line_id?: string;
  image?: string;
}

export type OrderInput = Partial<Record<(typeof ORDER_FIELDS)[number], any>> & {
  status_id?: number;
  items?: ItemInput[];
};

export interface OrderRow {
  id: number;
  status_id: number;
  source: string;
  integration_id: number | null;
  external_id: string | null;
  currency: string;
  paid_amount: number;
  delivery_price: number;
  stock_deducted: number;
  email: string;
  delivery_fullname: string;
  [k: string]: any;
}

export function statusIdByKey(key: string): number {
  const r = db.prepare('SELECT id FROM order_statuses WHERE system_key = ?').get(key) as { id: number } | undefined;
  if (r) return r.id;
  const first = db.prepare('SELECT id FROM order_statuses ORDER BY sort, id LIMIT 1').get() as { id: number };
  return first.id;
}

export function getOrder(id: number): OrderRow {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as OrderRow | undefined;
  if (!o) throw notFound('Order not found');
  return o;
}

export function orderTotal(orderId: number): number {
  const r = db.prepare('SELECT COALESCE(SUM(price * quantity), 0) s FROM order_items WHERE order_id = ?').get(orderId) as { s: number };
  const o = db.prepare('SELECT delivery_price FROM orders WHERE id = ?').get(orderId) as { delivery_price: number } | undefined;
  return round2(r.s + (o?.delivery_price ?? 0));
}

export function addHistory(orderId: number, message: string, type = 'info', user = 'System') {
  db.prepare('INSERT INTO order_history (order_id, type, message, user_name) VALUES (?, ?, ?, ?)').run(orderId, type, message, user);
}

function insertItem(orderId: number, it: ItemInput, defaultTax: number) {
  let productId = it.product_id ?? null;
  let { sku = '', ean = '', weight = 0, location = '', image = '' } = it;
  if (productId) {
    const p = db.prepare('SELECT id, sku, ean, weight, location, images FROM products WHERE id = ?').get(productId) as any;
    if (!p) productId = null;
    else {
      sku ||= p.sku;
      ean ||= p.ean;
      weight ||= p.weight;
      location ||= p.location;
      image ||= parseJson<string[]>(p.images, [])[0] ?? '';
    }
  } else {
    // Prefer the catalog assigned to the order's integration.
    const src = db.prepare('SELECT i.settings FROM orders o JOIN integrations i ON i.id = o.integration_id WHERE o.id = ?').get(orderId) as { settings: string } | undefined;
    const catalogId = Number(parseJson<any>(src?.settings, {}).catalog_id) || null;
    const p = findProduct(sku, ean, catalogId);
    if (p) {
      productId = p.id;
      weight ||= p.weight;
      location ||= p.location;
      image ||= parseJson<string[]>(p.images, [])[0] ?? '';
    }
  }
  const r = db
    .prepare(
      `INSERT INTO order_items (order_id, product_id, name, sku, ean, quantity, price, tax_rate, weight, location, attributes, auction_id, external_line_id, image)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      orderId,
      productId,
      it.name,
      sku,
      ean,
      it.quantity,
      it.price,
      it.tax_rate ?? defaultTax,
      weight,
      location,
      it.attributes ?? '',
      it.auction_id ?? '',
      it.external_line_id ?? '',
      image,
    );
  return { id: Number(r.lastInsertRowid), productId };
}

export function createOrder(input: OrderInput, user = 'System'): number {
  const settings = getSetting('orders', { stock_deduct: 'on_create', default_tax_rate: 23 } as any);
  const id = tx(() => {
    const statusId = input.status_id ?? statusIdByKey('new');
    const data: Record<string, any> = {};
    for (const f of ORDER_FIELDS) {
      if (input[f] === undefined) continue;
      let v = input[f];
      if (typeof v === 'boolean') v = v ? 1 : 0;
      if (f === 'external_data' && typeof v !== 'string') v = JSON.stringify(v);
      data[f] = v;
    }
    const cols = ['status_id', ...Object.keys(data)];
    const vals = [statusId, ...Object.values(data)];
    const r = db
      .prepare(`INSERT INTO orders (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(...vals);
    const orderId = Number(r.lastInsertRowid);
    for (const it of input.items ?? []) insertItem(orderId, it, settings.default_tax_rate ?? 23);
    const src = input.source && input.source !== 'manual' ? input.source : null;
    addHistory(orderId, src ? `Order downloaded from ${src}` : 'Order created', 'create', user);
    if (settings.stock_deduct === 'on_create') deductOrderStock(orderId);
    return orderId;
  });
  emit('order_created', { orderId: id, user });
  const o = getOrder(id);
  if (o.paid_amount > 0 && o.paid_amount >= orderTotal(id) - 0.001) emit('order_paid', { orderId: id, user });
  return id;
}

export function updateOrder(id: number, patch: Record<string, any>, user = 'System') {
  const o = getOrder(id);
  const changes: string[] = [];
  const data: Record<string, any> = {};
  for (const f of EDITABLE_FIELDS) {
    if (patch[f] === undefined) continue;
    let v = patch[f];
    if (typeof v === 'boolean') v = v ? 1 : 0;
    if (o[f] === v) continue;
    data[f] = v;
    changes.push(f);
  }
  if (!changes.length) return;
  const set = Object.keys(data)
    .map((k) => `${k} = ?`)
    .join(', ');
  db.prepare(`UPDATE orders SET ${set}, updated_at = datetime('now') WHERE id = ?`).run(...Object.values(data), id);
  if (!(changes.length === 1 && changes[0] === 'star')) addHistory(id, `Order data changed: ${changes.join(', ')}`, 'edit', user);
}

export function changeStatus(id: number, statusId: number, user = 'System', meta: { depth?: number; ruleIds?: number[] } = {}) {
  const o = getOrder(id);
  if (o.status_id === statusId) return false;
  const st = db.prepare('SELECT id, name, system_key FROM order_statuses WHERE id = ?').get(statusId) as
    | { id: number; name: string; system_key: string | null }
    | undefined;
  if (!st) throw new HttpError(400, 'Unknown status');
  const from = db.prepare('SELECT name FROM order_statuses WHERE id = ?').get(o.status_id) as { name: string } | undefined;
  tx(() => {
    db.prepare(`UPDATE orders SET status_id = ?, status_changed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(
      statusId,
      id,
    );
    addHistory(id, `Status changed: ${from?.name ?? '?'} → ${st.name}`, 'status', user);
    const settings = getSetting('orders', { stock_restore_on_cancel: true, stock_deduct: 'on_create' } as any);
    if (st.system_key === 'canceled' && settings.stock_restore_on_cancel) restoreOrderStock(id);
    else if (settings.stock_deduct === `status:${statusId}`) deductOrderStock(id);
    else if (o.stock_deducted === 0 && settings.stock_deduct === 'on_create' && st.system_key !== 'canceled') {
      // Re-deduct when an order is brought back from "canceled".
      const prev = db.prepare('SELECT system_key FROM order_statuses WHERE id = ?').get(o.status_id) as { system_key: string | null };
      if (prev?.system_key === 'canceled') deductOrderStock(id);
    }
  });
  emit('status_changed', { orderId: id, user, fromStatusId: o.status_id, toStatusId: statusId, ...meta });
  return true;
}

export function setPayment(id: number, amount: number, user = 'System', date?: string) {
  const o = getOrder(id);
  const total = orderTotal(id);
  const wasPaid = o.paid_amount >= total - 0.001 && o.paid_amount > 0;
  db.prepare(`UPDATE orders SET paid_amount = ?, payment_date = ?, updated_at = datetime('now') WHERE id = ?`).run(
    round2(amount),
    amount > 0 ? (date ?? new Date().toISOString().replace('T', ' ').slice(0, 19)) : null,
    id,
  );
  addHistory(id, `Payment set: ${round2(amount).toFixed(2)} ${o.currency} of ${total.toFixed(2)} ${o.currency}`, 'payment', user);
  const isPaid = amount >= total - 0.001 && amount > 0;
  if (isPaid && !wasPaid) emit('order_paid', { orderId: id, user });
}

export function addItem(orderId: number, it: ItemInput, user = 'System') {
  const o = getOrder(orderId);
  const settings = getSetting('orders', { default_tax_rate: 23 } as any);
  const res = tx(() => {
    const r = insertItem(orderId, it, settings.default_tax_rate ?? 23);
    if (o.stock_deducted && r.productId) adjustOrderItemStock(orderId, r.productId, -it.quantity, 'order');
    addHistory(orderId, `Product added: ${it.quantity}x ${it.name}`, 'items', user);
    return r.id;
  });
  return res;
}

export function updateItem(orderId: number, itemId: number, patch: Partial<ItemInput>, user = 'System') {
  const o = getOrder(orderId);
  const it = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(itemId, orderId) as any;
  if (!it) throw notFound('Item not found');
  const fields = ['product_id', 'name', 'sku', 'ean', 'quantity', 'price', 'tax_rate', 'weight', 'location', 'attributes', 'auction_id'] as const;
  const data: Record<string, any> = {};
  for (const f of fields) if (patch[f] !== undefined) data[f] = patch[f];
  if (!Object.keys(data).length) return;
  tx(() => {
    if (o.stock_deducted) {
      // Give back the old quantity and take the new one.
      if (it.product_id) adjustOrderItemStock(orderId, it.product_id, it.quantity, 'order_edit');
      const newPid = data.product_id !== undefined ? data.product_id : it.product_id;
      const newQty = data.quantity ?? it.quantity;
      if (newPid) adjustOrderItemStock(orderId, newPid, -newQty, 'order_edit');
    }
    db.prepare(`UPDATE order_items SET ${Object.keys(data).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
      ...Object.values(data),
      itemId,
    );
    addHistory(orderId, `Product edited: ${data.name ?? it.name}`, 'items', user);
  });
}

export function deleteItem(orderId: number, itemId: number, user = 'System') {
  const o = getOrder(orderId);
  const it = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(itemId, orderId) as any;
  if (!it) throw notFound('Item not found');
  tx(() => {
    if (o.stock_deducted && it.product_id) adjustOrderItemStock(orderId, it.product_id, it.quantity, 'order_edit');
    db.prepare('DELETE FROM order_items WHERE id = ?').run(itemId);
    addHistory(orderId, `Product removed: ${it.quantity}x ${it.name}`, 'items', user);
  });
}

/** Moves an order to the bin (soft delete) or deletes permanently if already in the bin. */
export function deleteOrder(id: number, user = 'System') {
  const o = getOrder(id);
  if (o.deleted) {
    restoreOrderStock(id);
    db.prepare('DELETE FROM orders WHERE id = ?').run(id);
    return 'purged';
  }
  db.prepare(`UPDATE orders SET deleted = 1, updated_at = datetime('now') WHERE id = ?`).run(id);
  restoreOrderStock(id);
  addHistory(id, 'Order moved to bin', 'delete', user);
  return 'binned';
}

export function restoreOrder(id: number, user = 'System') {
  getOrder(id);
  db.prepare(`UPDATE orders SET deleted = 0, archived = 0, updated_at = datetime('now') WHERE id = ?`).run(id);
  addHistory(id, 'Order restored', 'edit', user);
  const settings = getSetting('orders', { stock_deduct: 'on_create' } as any);
  const st = db.prepare('SELECT s.system_key FROM orders o JOIN order_statuses s ON s.id = o.status_id WHERE o.id = ?').get(id) as { system_key: string | null };
  // A canceled order keeps its stock returned.
  if (settings.stock_deduct === 'on_create' && st?.system_key !== 'canceled') deductOrderStock(id);
}

export function setArchived(id: number, archived: boolean, user = 'System') {
  getOrder(id);
  db.prepare(`UPDATE orders SET archived = ?, updated_at = datetime('now') WHERE id = ?`).run(archived ? 1 : 0, id);
  addHistory(id, archived ? 'Order archived' : 'Order removed from archive', 'edit', user);
}

/** Merges orders into the first one: items are moved, the rest go to the bin. */
export function mergeOrders(ids: number[], user = 'System'): number {
  if (ids.length < 2) throw new HttpError(400, 'Select at least two orders');
  const [targetId, ...rest] = [...ids].sort((a, b) => a - b);
  tx(() => {
    const target = getOrder(targetId);
    let paid = target.paid_amount;
    for (const id of rest) {
      const o = getOrder(id);
      if (o.currency !== target.currency) throw new HttpError(400, 'Orders have different currencies');
      if (o.stock_deducted !== target.stock_deducted) {
        if (target.stock_deducted) deductOrderStock(id);
        else restoreOrderStock(id);
      }
      db.prepare('UPDATE order_items SET order_id = ? WHERE order_id = ?').run(targetId, id);
      paid += o.paid_amount;
      db.prepare(`UPDATE orders SET deleted = 1, stock_deducted = 0, updated_at = datetime('now') WHERE id = ?`).run(id);
      addHistory(id, `Order merged into ${targetId}`, 'merge', user);
      addHistory(targetId, `Order ${id} merged into this order`, 'merge', user);
    }
    db.prepare('UPDATE orders SET paid_amount = ? WHERE id = ?').run(round2(paid), targetId);
  });
  return targetId;
}

/** Splits selected items into a new order. */
export function splitOrder(id: number, itemIds: number[], user = 'System'): number {
  const o = getOrder(id);
  const items = db.prepare('SELECT id FROM order_items WHERE order_id = ?').all(id) as { id: number }[];
  const moving = items.filter((i) => itemIds.includes(i.id));
  if (!moving.length || moving.length === items.length) throw new HttpError(400, 'Select some (not all) products to split');
  return tx(() => {
    const copy: Record<string, any> = {};
    for (const f of ORDER_FIELDS) if (f !== 'external_id') copy[f] = o[f];
    copy.paid_amount = 0;
    copy.delivery_price = 0;
    const cols = ['status_id', 'stock_deducted', ...Object.keys(copy)];
    const r = db
      .prepare(`INSERT INTO orders (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(o.status_id, o.stock_deducted, ...Object.values(copy));
    const newId = Number(r.lastInsertRowid);
    const upd = db.prepare('UPDATE order_items SET order_id = ? WHERE id = ?');
    for (const m of moving) upd.run(newId, m.id);
    addHistory(id, `Products moved to new order ${newId}`, 'split', user);
    addHistory(newId, `Order created by splitting order ${id}`, 'split', user);
    return newId;
  });
}

export function duplicateOrder(id: number, user = 'System'): number {
  const o = getOrder(id);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id) as any[];
  const input: OrderInput = {};
  for (const f of ORDER_FIELDS) if (!['external_id', 'integration_id', 'external_data', 'external_status'].includes(f)) (input as any)[f] = o[f];
  input.source = 'manual';
  input.paid_amount = 0;
  input.payment_date = null;
  input.date_add = undefined;
  input.items = items.map((i) => ({ ...i, product_id: i.product_id }));
  const newId = createOrder(input, user);
  addHistory(newId, `Order duplicated from ${id}`, 'create', user);
  return newId;
}

export function getOrderFull(id: number) {
  const o = getOrder(id);
  // Product EAN/location help when packing items imported without them.
  const items = db
    .prepare(
      `SELECT i.*, p.ean AS product_ean, p.location AS product_location FROM order_items i
       LEFT JOIN products p ON p.id = i.product_id WHERE i.order_id = ? ORDER BY i.id`,
    )
    .all(id);
  const history = db.prepare('SELECT * FROM order_history WHERE order_id = ? ORDER BY id DESC').all(id);
  const shipments = db.prepare('SELECT * FROM shipments WHERE order_id = ? ORDER BY id').all(id);
  const invoices = db
    .prepare('SELECT id, type, number, issue_date, total_gross, currency FROM invoices WHERE order_id = ? ORDER BY id')
    .all(id);
  const returns = db.prepare('SELECT id, status_id, refund_amount, created_at FROM returns WHERE order_id = ?').all(id);
  const emails = db.prepare('SELECT id, to_address, subject, status, created_at FROM email_log WHERE order_id = ? ORDER BY id DESC').all(id);
  const integration = o.integration_id
    ? db.prepare('SELECT id, type, name FROM integrations WHERE id = ?').get(o.integration_id)
    : null;
  return {
    ...o,
    external_data: parseJson(o.external_data, {}),
    total: orderTotal(id),
    items,
    history,
    shipments,
    invoices,
    returns,
    emails,
    integration,
  };
}
