/**
 * Inventory stock like in BaseLinker: stock is kept per warehouse, orders can
 * reserve it, a product with variants or a bundle has no stock of its own
 * (variants hold it; a bundle's availability comes from its components), and
 * every change is written to the stock history with the user and document.
 */
import { db, tx } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { emitStockChanged } from './stock-events.js';

export function defaultWarehouseId(): number {
  const r = db.prepare('SELECT id FROM warehouses ORDER BY is_default DESC, id LIMIT 1').get() as { id: number } | undefined;
  if (!r) return Number(db.prepare(`INSERT INTO warehouses (name, code, is_default) VALUES ('Magazyn', 'MAG1', 1)`).run().lastInsertRowid);
  return r.id;
}

export function defaultCatalogId(): number {
  const r = db.prepare('SELECT id FROM catalogs ORDER BY is_default DESC, id LIMIT 1').get() as { id: number } | undefined;
  if (!r) return Number(db.prepare(`INSERT INTO catalogs (name, is_default) VALUES ('Katalog', 1)`).run().lastInsertRowid);
  return r.id;
}

export function defaultPriceGroupId(): number {
  const r = db.prepare('SELECT id FROM price_groups ORDER BY is_default DESC, id LIMIT 1').get() as { id: number } | undefined;
  if (!r) return Number(db.prepare(`INSERT INTO price_groups (name, is_default) VALUES ('Detaliczna', 1)`).run().lastInsertRowid);
  return r.id;
}

/** Warehouse used for a catalog when none is given (catalog default, then platform default). */
export function catalogWarehouseId(catalogId?: number | null): number {
  if (catalogId) {
    const c = db.prepare('SELECT default_warehouse_id FROM catalogs WHERE id = ?').get(catalogId) as { default_warehouse_id: number | null } | undefined;
    if (c?.default_warehouse_id) return c.default_warehouse_id;
  }
  return defaultWarehouseId();
}

/** True when stock cannot be set on the product directly (it has variants or is a bundle). */
export function stockIsDerived(productId: number): string | null {
  const p = db.prepare('SELECT is_bundle FROM products WHERE id = ?').get(productId) as { is_bundle: number } | undefined;
  if (!p) return 'Product not found';
  if (p.is_bundle) return 'A bundle has no own stock — it is calculated from its components';
  if (db.prepare('SELECT 1 FROM products WHERE parent_id = ? LIMIT 1').get(productId)) return 'The product has variants — change the stock of the variants';
  return null;
}

/** Recomputes the denormalized total stock of a product from its warehouses. */
function refreshTotal(productId: number) {
  db.prepare(
    `UPDATE products SET stock = COALESCE((SELECT SUM(stock) FROM product_stock WHERE product_id = ?), 0), updated_at = datetime('now') WHERE id = ?`,
  ).run(productId, productId);
}

export function warehouseStock(productId: number, warehouseId: number): number {
  const r = db.prepare('SELECT stock FROM product_stock WHERE product_id = ? AND warehouse_id = ?').get(productId, warehouseId) as { stock: number } | undefined;
  return r?.stock ?? 0;
}

export interface StockOpts {
  /** Order the change belongs to. */
  orderId?: number | null;
  /** Warehouse document the change belongs to. */
  docId?: number | null;
  user?: string;
  /** Orders may push stock below zero (the goods are already sold); manual changes may not. */
  allowNegative?: boolean;
}

/** Changes product stock in a warehouse by `change` and records it in stock history. */
export function adjustStock(productId: number, change: number, reason: string, warehouseId?: number | null, opts: StockOpts = {}) {
  if (!change) return;
  tx(() => {
    const product = db.prepare('SELECT id, catalog_id FROM products WHERE id = ?').get(productId) as { id: number; catalog_id: number | null } | undefined;
    if (!product) return;
    const derived = stockIsDerived(productId);
    if (derived) throw new HttpError(400, derived);
    const wh = warehouseId ?? catalogWarehouseId(product.catalog_id);
    const w = db.prepare('SELECT id, allow_negative FROM warehouses WHERE id = ?').get(wh) as { id: number; allow_negative: number } | undefined;
    if (!w) throw new HttpError(400, 'Unknown warehouse');
    const before = warehouseStock(productId, wh);
    if (before + change < 0 && change < 0 && !opts.allowNegative && !w.allow_negative) {
      throw new HttpError(409, `Not enough stock of product ${productId} in the warehouse (${before} available, ${-change} needed)`);
    }
    db.prepare(
      `INSERT INTO product_stock (product_id, warehouse_id, stock) VALUES (?, ?, ?)
       ON CONFLICT(product_id, warehouse_id) DO UPDATE SET stock = stock + excluded.stock`,
    ).run(productId, wh, change);
    refreshTotal(productId);
    db.prepare(
      'INSERT INTO stock_history (product_id, change, stock_after, reason, order_id, warehouse_id, doc_id, user_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(productId, change, before + change, reason, opts.orderId ?? null, wh, opts.docId ?? null, opts.user ?? '');
  });
  emitStockChanged(productId);
}

/** Sets the stock of a product in a warehouse to an absolute value. */
export function setStock(productId: number, value: number, reason: string, warehouseId?: number | null, opts: StockOpts = {}) {
  const p = db.prepare('SELECT catalog_id FROM products WHERE id = ?').get(productId) as { catalog_id: number | null } | undefined;
  const wh = warehouseId ?? catalogWarehouseId(p?.catalog_id);
  adjustStock(productId, value - warehouseStock(productId, wh), reason, wh, opts);
}

/** Moves the reservation counter of a product in a warehouse. */
function changeReserved(productId: number, warehouseId: number, delta: number) {
  // (excluded.reserved cannot carry a negative delta through a clamped insert value.)
  db.prepare('INSERT INTO product_stock (product_id, warehouse_id, stock, reserved) VALUES (?, ?, 0, 0) ON CONFLICT(product_id, warehouse_id) DO NOTHING').run(productId, warehouseId);
  db.prepare('UPDATE product_stock SET reserved = MAX(0, reserved + ?) WHERE product_id = ? AND warehouse_id = ?').run(delta, productId, warehouseId);
}

/**
 * Available quantity for selling (stock − reserved). For a product with
 * variants it is the sum over variants; for a bundle it is the number of
 * complete sets the components allow.
 */
export function availableStock(productId: number, warehouseIds?: number[] | null): number {
  const p = db.prepare('SELECT id, is_bundle FROM products WHERE id = ?').get(productId) as { id: number; is_bundle: number } | undefined;
  if (!p) return 0;
  if (p.is_bundle) {
    const comps = db.prepare('SELECT product_id, quantity FROM bundle_items WHERE bundle_id = ?').all(productId) as { product_id: number; quantity: number }[];
    if (!comps.length) return 0;
    return Math.max(0, Math.min(...comps.map((c) => Math.floor(availableStock(c.product_id, warehouseIds) / c.quantity))));
  }
  const variants = db.prepare('SELECT id FROM products WHERE parent_id = ?').all(productId) as { id: number }[];
  if (variants.length) return variants.reduce((s, v) => s + availableStock(v.id, warehouseIds), 0);
  const whFilter = warehouseIds?.length ? ` AND warehouse_id IN (${warehouseIds.map(() => '?').join(',')})` : '';
  const r = db.prepare(`SELECT COALESCE(SUM(stock - reserved), 0) s FROM product_stock WHERE product_id = ?${whFilter}`).get(productId, ...(warehouseIds ?? [])) as { s: number };
  return Math.max(0, r.s);
}

function orderWarehouse(orderId: number): number {
  const o = db.prepare('SELECT warehouse_id FROM orders WHERE id = ?').get(orderId) as { warehouse_id: number | null } | undefined;
  return o?.warehouse_id ?? defaultWarehouseId();
}

/** Order lines expanded to stock-holding products (bundles → components). */
function orderStockLines(orderId: number): { product_id: number; quantity: number }[] {
  const items = db
    .prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ? AND product_id IS NOT NULL')
    .all(orderId) as { product_id: number; quantity: number }[];
  const out: { product_id: number; quantity: number }[] = [];
  for (const it of items) {
    const p = db.prepare('SELECT is_bundle FROM products WHERE id = ?').get(it.product_id) as { is_bundle: number } | undefined;
    if (!p) continue;
    if (p.is_bundle) {
      for (const c of db.prepare('SELECT product_id, quantity FROM bundle_items WHERE bundle_id = ?').all(it.product_id) as { product_id: number; quantity: number }[]) {
        out.push({ product_id: c.product_id, quantity: c.quantity * it.quantity });
      }
    } else if (!db.prepare('SELECT 1 FROM products WHERE parent_id = ? LIMIT 1').get(it.product_id)) {
      out.push(it);
    }
  }
  return out;
}

/** Deducts stock for all linked items of an order (once); releases a reservation first. */
export function deductOrderStock(orderId: number) {
  tx(() => {
    const o = db.prepare('SELECT stock_deducted FROM orders WHERE id = ?').get(orderId) as { stock_deducted: number } | undefined;
    if (!o || o.stock_deducted) return;
    releaseOrderStock(orderId);
    const wh = orderWarehouse(orderId);
    for (const it of orderStockLines(orderId)) adjustStock(it.product_id, -it.quantity, 'order', wh, { orderId, allowNegative: true });
    db.prepare('UPDATE orders SET stock_deducted = 1 WHERE id = ?').run(orderId);
  });
}

/**
 * Net stock movement of an order per product and warehouse: deductions, edits of
 * the order lines, returns and earlier restores. Restoring reverses exactly this,
 * so a changed bundle composition or warehouse cannot return more than was taken.
 */
export function orderStockMovements(orderId: number) {
  return db
    .prepare(
      `SELECT product_id, warehouse_id, SUM(change) qty FROM stock_history
       WHERE order_id = ? AND doc_id IS NULL AND warehouse_id IS NOT NULL
       GROUP BY product_id, warehouse_id HAVING SUM(change) != 0`,
    )
    .all(orderId) as { product_id: number; warehouse_id: number; qty: number }[];
}

/** Returns previously deducted stock of an order back to the warehouse. */
export function restoreOrderStock(orderId: number) {
  tx(() => {
    const o = db.prepare('SELECT stock_deducted FROM orders WHERE id = ?').get(orderId) as { stock_deducted: number } | undefined;
    if (!o) return;
    releaseOrderStock(orderId);
    if (!o.stock_deducted) return;
    for (const m of orderStockMovements(orderId)) {
      if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(m.product_id) || stockIsDerived(m.product_id)) continue;
      adjustStock(m.product_id, -m.qty, 'order_restore', m.warehouse_id, { orderId, allowNegative: true });
    }
    db.prepare('UPDATE orders SET stock_deducted = 0 WHERE id = ?').run(orderId);
  });
}

/** Reserves stock for an order (stock mode "reserve"): goods stay in the warehouse but are not offered for sale. */
export function reserveOrderStock(orderId: number) {
  tx(() => {
    const o = db.prepare('SELECT stock_deducted, stock_reserved FROM orders WHERE id = ?').get(orderId) as { stock_deducted: number; stock_reserved: number } | undefined;
    if (!o || o.stock_deducted || o.stock_reserved) return;
    const wh = orderWarehouse(orderId);
    const lines = orderStockLines(orderId);
    for (const it of lines) changeReserved(it.product_id, wh, it.quantity);
    db.prepare('UPDATE orders SET stock_reserved = 1 WHERE id = ?').run(orderId);
    for (const it of lines) emitStockChanged(it.product_id);
  });
}

/** Releases an order's reservation (when deducted, canceled or deleted). */
export function releaseOrderStock(orderId: number) {
  const o = db.prepare('SELECT stock_reserved FROM orders WHERE id = ?').get(orderId) as { stock_reserved: number } | undefined;
  if (!o?.stock_reserved) return;
  const wh = orderWarehouse(orderId);
  const lines = orderStockLines(orderId);
  for (const it of lines) changeReserved(it.product_id, wh, -it.quantity);
  db.prepare('UPDATE orders SET stock_reserved = 0 WHERE id = ?').run(orderId);
  for (const it of lines) emitStockChanged(it.product_id);
}

/** Stock-holding products of one order line (a bundle → its components). */
function lineStockProducts(productId: number, quantity: number): { product_id: number; quantity: number }[] {
  const p = db.prepare('SELECT is_bundle FROM products WHERE id = ?').get(productId) as { is_bundle: number } | undefined;
  if (!p) return [];
  if (p.is_bundle) {
    return (db.prepare('SELECT product_id, quantity FROM bundle_items WHERE bundle_id = ?').all(productId) as { product_id: number; quantity: number }[]).map((c) => ({
      product_id: c.product_id,
      quantity: c.quantity * quantity,
    }));
  }
  return stockIsDerived(productId) ? [] : [{ product_id: productId, quantity }];
}

/**
 * An order line changed after the stock was taken or reserved: `quantityDelta`
 * more units of `productId` are ordered (negative = fewer). Deducted orders move
 * the stock, reserved ones move the reservation; others are not affected.
 */
export function orderLineChanged(orderId: number, productId: number, quantityDelta: number, reason = 'order_edit') {
  if (!quantityDelta) return;
  const o = db.prepare('SELECT stock_deducted, stock_reserved FROM orders WHERE id = ?').get(orderId) as { stock_deducted: number; stock_reserved: number } | undefined;
  if (!o) return;
  const wh = orderWarehouse(orderId);
  for (const c of lineStockProducts(productId, quantityDelta)) {
    if (o.stock_deducted) adjustStock(c.product_id, -c.quantity, reason, wh, { orderId, allowNegative: true });
    else if (o.stock_reserved) {
      changeReserved(c.product_id, wh, c.quantity);
      emitStockChanged(c.product_id);
    }
  }
}

/**
 * Moves the record of taken stock of `quantity` units of a line from one order to
 * another (order split) without changing the warehouse: a pair of zero-sum
 * history entries, so that restoring either order returns exactly its goods.
 */
export function transferOrderStock(fromOrderId: number, toOrderId: number, productId: number, quantity: number) {
  const wh = orderWarehouse(fromOrderId);
  const ins = db.prepare(
    'INSERT INTO stock_history (product_id, change, stock_after, reason, order_id, warehouse_id, user_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const c of lineStockProducts(productId, quantity)) {
    const now = warehouseStock(c.product_id, wh);
    ins.run(c.product_id, c.quantity, now, 'order_split', fromOrderId, wh, '');
    ins.run(c.product_id, -c.quantity, now, 'order_split', toOrderId, wh, '');
  }
}

/**
 * Puts returned units of an order line back into the order's warehouse, never
 * more than the order actually took (an order whose stock was not deducted
 * returns nothing). Returns the number of units put back per stock product.
 */
export function returnOrderLineStock(orderId: number, productId: number, quantity: number, user = '') {
  const wh = orderWarehouse(orderId);
  let back = 0;
  for (const c of lineStockProducts(productId, quantity)) {
    const net = (
      db.prepare('SELECT COALESCE(SUM(change), 0) s FROM stock_history WHERE order_id = ? AND product_id = ? AND warehouse_id = ? AND doc_id IS NULL').get(orderId, c.product_id, wh) as {
        s: number;
      }
    ).s;
    const qty = Math.min(c.quantity, Math.max(0, -net));
    if (qty > 0) adjustStock(c.product_id, qty, 'return', wh, { orderId, allowNegative: true, user });
    back += qty;
  }
  return back;
}

/** Adjusts stock of a single order line in the order's warehouse (line added/changed after deduction). */
export function adjustOrderItemStock(orderId: number, productId: number, change: number, reason: string) {
  const wh = orderWarehouse(orderId);
  for (const c of lineStockProducts(productId, change)) adjustStock(c.product_id, c.quantity, reason, wh, { orderId, allowNegative: true });
}

/**
 * Finds an inventory product by SKU or EAN. Only stock-holding products
 * (not parents of variants) are matched; the given catalog is preferred.
 */
export function findProduct(
  sku?: string,
  ean?: string,
  catalogId?: number | null,
): { id: number; sku: string; ean: string; weight: number; location: string; images: string } | undefined {
  const notParent = 'NOT EXISTS (SELECT 1 FROM products v WHERE v.parent_id = p.id)';
  const order = catalogId ? 'ORDER BY (p.catalog_id = ?) DESC, p.id' : 'ORDER BY p.id';
  const args = catalogId ? [catalogId] : [];
  for (const [col, val] of [
    ['sku', sku],
    ['ean', ean],
  ] as const) {
    if (!val) continue;
    const p = db
      .prepare(`SELECT p.id, p.sku, p.ean, p.weight, p.location, p.images FROM products p WHERE p.${col} = ? AND p.${col} != '' AND ${notParent} ${order} LIMIT 1`)
      .get(val, ...args);
    if (p) return p as any;
  }
  return undefined;
}

/** Updates the weighted average purchase cost after a goods receipt. */
export function updateAverageCost(productId: number, quantity: number, unitCost: number) {
  if (quantity <= 0 || unitCost <= 0) return;
  const p = db.prepare('SELECT stock, avg_cost FROM products WHERE id = ?').get(productId) as { stock: number; avg_cost: number } | undefined;
  if (!p) return;
  // Stock already includes the received quantity.
  const prevQty = Math.max(0, p.stock - quantity);
  const avg = prevQty > 0 && p.avg_cost > 0 ? (prevQty * p.avg_cost + quantity * unitCost) / (prevQty + quantity) : unitCost;
  db.prepare('UPDATE products SET avg_cost = ?, purchase_price = ? WHERE id = ?').run(Math.round(avg * 100) / 100, unitCost, productId);
}
