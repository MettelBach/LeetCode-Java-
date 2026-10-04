import { db, tx } from '../db/index.js';
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

/** Changes product stock in a warehouse by `change` and records it in stock history. */
export function adjustStock(productId: number, change: number, reason: string, orderId?: number | null, warehouseId?: number | null) {
  if (!change) return;
  const wh = warehouseId ?? defaultWarehouseId();
  tx(() => {
    if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(productId)) return;
    db.prepare(
      `INSERT INTO product_stock (product_id, warehouse_id, stock) VALUES (?, ?, ?)
       ON CONFLICT(product_id, warehouse_id) DO UPDATE SET stock = stock + excluded.stock`,
    ).run(productId, wh, change);
    refreshTotal(productId);
    const after = warehouseStock(productId, wh);
    db.prepare('INSERT INTO stock_history (product_id, change, stock_after, reason, order_id, warehouse_id) VALUES (?, ?, ?, ?, ?, ?)').run(
      productId,
      change,
      after,
      reason,
      orderId ?? null,
      wh,
    );
  });
  emitStockChanged(productId);
}

/** Sets the stock of a product in a warehouse to an absolute value. */
export function setStock(productId: number, value: number, reason: string, warehouseId?: number | null) {
  const wh = warehouseId ?? defaultWarehouseId();
  adjustStock(productId, value - warehouseStock(productId, wh), reason, null, wh);
}

function orderWarehouse(orderId: number): number {
  const o = db.prepare('SELECT warehouse_id FROM orders WHERE id = ?').get(orderId) as { warehouse_id: number | null } | undefined;
  return o?.warehouse_id ?? defaultWarehouseId();
}

/** Deducts stock for all linked items of an order (once). */
export function deductOrderStock(orderId: number) {
  tx(() => {
    const o = db.prepare('SELECT stock_deducted FROM orders WHERE id = ?').get(orderId) as { stock_deducted: number } | undefined;
    if (!o || o.stock_deducted) return;
    const wh = orderWarehouse(orderId);
    const items = db
      .prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ? AND product_id IS NOT NULL')
      .all(orderId) as { product_id: number; quantity: number }[];
    for (const it of items) adjustStock(it.product_id, -it.quantity, 'order', orderId, wh);
    db.prepare('UPDATE orders SET stock_deducted = 1 WHERE id = ?').run(orderId);
  });
}

/** Returns previously deducted stock of an order back to the warehouse. */
export function restoreOrderStock(orderId: number) {
  tx(() => {
    const o = db.prepare('SELECT stock_deducted FROM orders WHERE id = ?').get(orderId) as { stock_deducted: number } | undefined;
    if (!o || !o.stock_deducted) return;
    const wh = orderWarehouse(orderId);
    const items = db
      .prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ? AND product_id IS NOT NULL')
      .all(orderId) as { product_id: number; quantity: number }[];
    for (const it of items) adjustStock(it.product_id, it.quantity, 'order_restore', orderId, wh);
    db.prepare('UPDATE orders SET stock_deducted = 0 WHERE id = ?').run(orderId);
  });
}

/** Adjusts stock of a single order line in the order's warehouse. */
export function adjustOrderItemStock(orderId: number, productId: number, change: number, reason: string) {
  adjustStock(productId, change, reason, orderId, orderWarehouse(orderId));
}

/** Finds an inventory product by SKU or EAN (optionally within a catalog). */
export function findProduct(
  sku?: string,
  ean?: string,
  catalogId?: number | null,
): { id: number; sku: string; ean: string; weight: number; location: string; images: string } | undefined {
  const cat = catalogId ? ' AND catalog_id = ?' : '';
  const args = catalogId ? [catalogId] : [];
  if (sku) {
    const p = db.prepare(`SELECT id, sku, ean, weight, location, images FROM products WHERE sku = ? AND sku != ''${cat} LIMIT 1`).get(sku, ...args);
    if (p) return p as any;
  }
  if (ean) {
    const p = db.prepare(`SELECT id, sku, ean, weight, location, images FROM products WHERE ean = ? AND ean != ''${cat} LIMIT 1`).get(ean, ...args);
    if (p) return p as any;
  }
  return undefined;
}
