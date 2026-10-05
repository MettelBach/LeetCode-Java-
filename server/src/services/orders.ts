import { db, getSetting, parseJson, tx } from '../db/index.js';
import { isValidDateTime, warsawNow } from '../lib/dates.js';
import { HttpError, notFound, round2 } from '../lib/http.js';
import { emit } from './events.js';
import { deductOrderStock, findProduct, orderLineChanged, releaseOrderStock, reserveOrderStock, restoreOrderStock, transferOrderStock } from './stock.js';

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

interface StockSettings {
  stock_deduct: string;
  stock_restore_on_cancel: boolean;
  /** In "deduct on status" mode: reserve the goods until the order reaches that status. */
  stock_reserve: boolean;
}

const stockSettings = () => ({ stock_deduct: 'on_create', stock_restore_on_cancel: true, stock_reserve: false, ...getSetting<Partial<StockSettings>>('orders', {}) }) as StockSettings;

/**
 * Brings the stock of an order (nothing / reserved / deducted) in line with its
 * state and the "Deduct stock" setting. The single place that decides about
 * order stock — called after creating, status changes, the bin, merging.
 */
export function reconcileOrderStock(orderId: number, user = 'System') {
  const o = db
    .prepare('SELECT o.id, o.deleted, o.status_id, o.stock_deducted, o.stock_reserved, s.system_key FROM orders o JOIN order_statuses s ON s.id = o.status_id WHERE o.id = ?')
    .get(orderId) as { id: number; deleted: number; status_id: number; stock_deducted: number; stock_reserved: number; system_key: string | null } | undefined;
  if (!o) return;
  const s = stockSettings();
  const current = o.stock_deducted ? 'deducted' : o.stock_reserved ? 'reserved' : 'none';
  let target: 'none' | 'reserved' | 'deducted';
  if (o.deleted || (o.system_key === 'canceled' && s.stock_restore_on_cancel)) target = 'none';
  else if (o.system_key === 'canceled' || s.stock_deduct === 'never') target = current;
  else if (s.stock_deduct === 'on_create') target = 'deducted';
  else {
    const at = Number(s.stock_deduct.replace('status:', ''));
    // Once taken at that status the stock stays taken in the following statuses.
    target = o.status_id === at || o.stock_deducted ? 'deducted' : s.stock_reserve ? 'reserved' : 'none';
  }
  if (target === current) return;
  tx(() => {
    if (target === 'deducted') deductOrderStock(orderId);
    else {
      if (o.stock_deducted) restoreOrderStock(orderId);
      else releaseOrderStock(orderId);
      if (target === 'reserved') reserveOrderStock(orderId);
    }
    const msg = { deducted: 'Stock deducted from the warehouse', reserved: 'Stock reserved', none: current === 'deducted' ? 'Stock returned to the warehouse' : 'Stock reservation released' }[target];
    addHistory(orderId, msg, 'stock', user);
  });
}

export function createOrder(input: OrderInput, user = 'System'): number {
  const settings = getSetting('orders', { default_tax_rate: 23 } as any);
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
    if (Number(data.paid_amount) > 0) {
      const when = data.payment_date || warsawNow();
      db.prepare('UPDATE orders SET payment_date = ? WHERE id = ?').run(when, orderId);
      db.prepare('INSERT INTO order_payments (order_id, amount, paid_total, payment_date, comment, user_name) VALUES (?, ?, ?, ?, ?, ?)').run(
        orderId,
        round2(data.paid_amount),
        round2(data.paid_amount),
        when,
        input.source && input.source !== 'manual' ? input.source : '',
        user,
      );
    }
    const src = input.source && input.source !== 'manual' ? input.source : null;
    addHistory(orderId, src ? `Order downloaded from ${src}` : 'Order created', 'create', user);
    reconcileOrderStock(orderId, user);
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
  if (data.delivery_price !== undefined || data.currency !== undefined) assertNotLocked(id);
  const set = Object.keys(data)
    .map((k) => `${k} = ?`)
    .join(', ');
  db.prepare(`UPDATE orders SET ${set}, updated_at = datetime('now') WHERE id = ?`).run(...Object.values(data), id);
  if (!(changes.length === 1 && changes[0] === 'star')) addHistory(id, `Order data changed: ${changes.join(', ')}`, 'edit', user);
}

export function changeStatus(id: number, statusId: number, user = 'System', meta: { depth?: number; ruleIds?: number[]; originIntegrationId?: number } = {}) {
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
    reconcileOrderStock(id, user);
  });
  emit('status_changed', { orderId: id, user, fromStatusId: o.status_id, toStatusId: statusId, ...meta });
  return true;
}

/**
 * Sets the paid amount of an order and records the change in the payment
 * history. `order_paid` fires when the order becomes fully paid.
 */
export function setPayment(id: number, amount: number, user = 'System', date?: string, comment = '') {
  const o = getOrder(id);
  if (date !== undefined && date !== '' && !isValidDateTime(date)) throw new HttpError(400, 'Invalid payment date');
  const total = orderTotal(id);
  const paid = round2(amount);
  if (paid === round2(o.paid_amount)) return;
  const wasPaid = o.paid_amount >= total - 0.001 && o.paid_amount > 0;
  const when = date || warsawNow();
  tx(() => {
    db.prepare(`UPDATE orders SET paid_amount = ?, payment_date = ?, updated_at = datetime('now') WHERE id = ?`).run(paid, paid > 0 ? when : null, id);
    db.prepare('INSERT INTO order_payments (order_id, amount, paid_total, payment_date, comment, user_name) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      round2(paid - o.paid_amount),
      paid,
      when,
      comment,
      user,
    );
    addHistory(id, `Payment set: ${paid.toFixed(2)} ${o.currency} of ${total.toFixed(2)} ${o.currency}`, 'payment', user);
  });
  const isPaid = paid >= total - 0.001 && paid > 0;
  if (isPaid && !wasPaid) emit('order_paid', { orderId: id, user });
}

/** An order with an invoice or receipt: products, prices and delivery cost are fixed (change them with a correction). */
export function assertNotLocked(orderId: number) {
  const o = db.prepare('SELECT locked FROM orders WHERE id = ?').get(orderId) as { locked: number } | undefined;
  if (o?.locked) throw new HttpError(409, 'The order is locked — unlock it to change products');
  const doc = db.prepare(`SELECT number FROM invoices WHERE order_id = ? AND type IN ('invoice', 'receipt') LIMIT 1`).get(orderId) as { number: string } | undefined;
  if (doc) throw new HttpError(409, `The order has the document ${doc.number} — issue a correction instead of changing products or prices`);
}

export function addItem(orderId: number, it: ItemInput, user = 'System') {
  getOrder(orderId);
  assertNotLocked(orderId);
  const settings = getSetting('orders', { default_tax_rate: 23 } as any);
  const res = tx(() => {
    const r = insertItem(orderId, it, settings.default_tax_rate ?? 23);
    if (r.productId) orderLineChanged(orderId, r.productId, it.quantity, 'order');
    addHistory(orderId, `Product added: ${it.quantity}x ${it.name}`, 'items', user);
    return r.id;
  });
  return res;
}

export function updateItem(orderId: number, itemId: number, patch: Partial<ItemInput>, user = 'System') {
  getOrder(orderId);
  const it = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(itemId, orderId) as any;
  if (!it) throw notFound('Item not found');
  if (patch.product_id && !db.prepare('SELECT 1 FROM products WHERE id = ?').get(patch.product_id)) throw new HttpError(400, 'Product not found');
  const fields = ['product_id', 'name', 'sku', 'ean', 'quantity', 'price', 'tax_rate', 'weight', 'location', 'attributes', 'auction_id'] as const;
  const data: Record<string, any> = {};
  for (const f of fields) if (patch[f] !== undefined) data[f] = patch[f];
  if (!Object.keys(data).length) return;
  // Linking a product or changing the storage location does not change the document.
  if (Object.keys(data).some((k) => ['name', 'quantity', 'price', 'tax_rate'].includes(k) && data[k] !== it[k])) assertNotLocked(orderId);
  tx(() => {
    // Give back the old quantity and take the new one (stock or reservation).
    const newPid = data.product_id !== undefined ? data.product_id : it.product_id;
    const newQty = data.quantity ?? it.quantity;
    if (newPid !== it.product_id || newQty !== it.quantity) {
      if (it.product_id) orderLineChanged(orderId, it.product_id, -it.quantity);
      if (newPid) orderLineChanged(orderId, newPid, newQty);
    }
    db.prepare(`UPDATE order_items SET ${Object.keys(data).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
      ...Object.values(data),
      itemId,
    );
    addHistory(orderId, `Product edited: ${data.name ?? it.name}`, 'items', user);
  });
}

export function deleteItem(orderId: number, itemId: number, user = 'System') {
  getOrder(orderId);
  const it = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(itemId, orderId) as any;
  if (!it) throw notFound('Item not found');
  assertNotLocked(orderId);
  tx(() => {
    if (it.product_id) orderLineChanged(orderId, it.product_id, -it.quantity);
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
  tx(() => {
    db.prepare(`UPDATE orders SET deleted = 1, updated_at = datetime('now') WHERE id = ?`).run(id);
    addHistory(id, 'Order moved to bin', 'delete', user);
    reconcileOrderStock(id, user);
  });
  return 'binned';
}

export function restoreOrder(id: number, user = 'System') {
  getOrder(id);
  tx(() => {
    db.prepare(`UPDATE orders SET deleted = 0, archived = 0, updated_at = datetime('now') WHERE id = ?`).run(id);
    addHistory(id, 'Order restored', 'edit', user);
    // A canceled order keeps its stock returned.
    reconcileOrderStock(id, user);
  });
}

export function setArchived(id: number, archived: boolean, user = 'System') {
  getOrder(id);
  db.prepare(`UPDATE orders SET archived = ?, updated_at = datetime('now') WHERE id = ?`).run(archived ? 1 : 0, id);
  addHistory(id, archived ? 'Order archived' : 'Order removed from archive', 'edit', user);
}

/**
 * Merges orders into the oldest one: products, delivery cost and payments are
 * added up, the other orders go to the bin. Stock is taken back from the merged
 * orders and settled again on the result.
 */
export function mergeOrders(ids: number[], user = 'System'): number {
  const unique = [...new Set(ids.map(Number))].sort((a, b) => a - b);
  if (unique.length < 2) throw new HttpError(400, 'Select at least two orders');
  const [targetId, ...rest] = unique;
  tx(() => {
    const target = getOrder(targetId);
    const all = [target, ...rest.map(getOrder)];
    for (const o of all) {
      if (o.deleted) throw new HttpError(400, `Order ${o.id} is in the bin`);
      if (o.currency !== target.currency) throw new HttpError(400, 'Orders have different currencies');
      if ((o.warehouse_id ?? null) !== (target.warehouse_id ?? null)) throw new HttpError(400, 'Orders are fulfilled from different warehouses');
      if (db.prepare(`SELECT 1 FROM invoices WHERE order_id = ? AND type != 'proforma'`).get(o.id)) throw new HttpError(400, `Order ${o.id} already has an invoice or receipt`);
    }
    // Settle stock from scratch: give everything back, move the lines, take it again.
    for (const o of all) {
      if (o.stock_deducted) restoreOrderStock(o.id);
      else releaseOrderStock(o.id);
    }
    let paid = target.paid_amount;
    let delivery = target.delivery_price;
    for (const o of all.slice(1)) {
      db.prepare('UPDATE order_items SET order_id = ? WHERE order_id = ?').run(targetId, o.id);
      paid += o.paid_amount;
      delivery += o.delivery_price;
      db.prepare(`UPDATE orders SET deleted = 1, paid_amount = 0, delivery_price = 0, updated_at = datetime('now') WHERE id = ?`).run(o.id);
      addHistory(o.id, `Order merged into ${targetId}`, 'merge', user);
      addHistory(targetId, `Order ${o.id} merged into this order`, 'merge', user);
    }
    db.prepare(`UPDATE orders SET paid_amount = ?, delivery_price = ?, updated_at = datetime('now') WHERE id = ?`).run(round2(paid), round2(delivery), targetId);
    reconcileOrderStock(targetId, user);
  });
  return targetId;
}

/**
 * Splits products into a new order. Each entry moves the whole line or only
 * `quantity` units of it. Payment above the remaining total goes with the new order.
 */
export function splitOrder(id: number, lines: (number | { id: number; quantity?: number })[], user = 'System'): number {
  const o = getOrder(id);
  if (o.deleted) throw new HttpError(400, 'The order is in the bin');
  assertNotLocked(id);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id) as any[];
  const wanted = new Map<number, number>();
  for (const l of lines) {
    const lid = typeof l === 'number' ? l : l.id;
    const it = items.find((i) => i.id === lid);
    if (!it) throw new HttpError(400, `Item ${lid} is not part of the order`);
    const q = typeof l === 'number' || l.quantity === undefined ? it.quantity : l.quantity;
    if (!(q > 0) || q > it.quantity) throw new HttpError(400, `Wrong quantity to split for "${it.name}"`);
    wanted.set(lid, q);
  }
  const remaining = items.reduce((sum, i) => sum + i.quantity - (wanted.get(i.id) ?? 0), 0);
  if (!wanted.size || remaining <= 0) throw new HttpError(400, 'Select some (not all) products to split');
  return tx(() => {
    const copy: Record<string, any> = {};
    for (const f of ORDER_FIELDS) if (f !== 'external_id') copy[f] = o[f];
    copy.paid_amount = 0;
    copy.payment_date = null;
    copy.delivery_price = 0;
    // The stock state is kept: lines move between orders of the same warehouse.
    const cols = ['status_id', 'stock_deducted', 'stock_reserved', ...Object.keys(copy)];
    const r = db
      .prepare(`INSERT INTO orders (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(o.status_id, o.stock_deducted, o.stock_reserved, ...Object.values(copy));
    const newId = Number(r.lastInsertRowid);
    for (const [lid, q] of wanted) {
      const it = items.find((i) => i.id === lid);
      if (q === it.quantity) db.prepare('UPDATE order_items SET order_id = ? WHERE id = ?').run(newId, lid);
      else {
        db.prepare('UPDATE order_items SET quantity = quantity - ? WHERE id = ?').run(q, lid);
        const { id: _id, order_id: _o, ...rest } = it;
        const cols2 = Object.keys(rest);
        db.prepare(`INSERT INTO order_items (order_id, ${cols2.join(', ')}) VALUES (?, ${cols2.map(() => '?').join(', ')})`).run(newId, ...cols2.map((c) => (c === 'quantity' ? q : rest[c])));
      }
    }
    // Taken stock follows the moved lines so that cancelling either order returns the right goods.
    if (o.stock_deducted) {
      for (const [lid, q] of wanted) {
        const it = items.find((i) => i.id === lid);
        if (it.product_id) transferOrderStock(id, newId, it.product_id, q);
      }
    }
    const left = orderTotal(id);
    if (o.paid_amount > left + 0.001) {
      db.prepare('UPDATE orders SET paid_amount = ? WHERE id = ?').run(left, id);
      db.prepare('UPDATE orders SET paid_amount = ?, payment_date = ? WHERE id = ?').run(round2(o.paid_amount - left), o.payment_date, newId);
    }
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
  // Marketplace references belong to the original order only.
  input.items = items.map((i) => ({ ...i, product_id: i.product_id, auction_id: '', external_line_id: '' }));
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
  const payments = db.prepare('SELECT * FROM order_payments WHERE order_id = ? ORDER BY id DESC').all(id);
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
    payments,
    integration,
  };
}
