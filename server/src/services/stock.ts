import { db, tx } from '../db/index.js';
import { emitStockChanged } from './stock-events.js';

/** Changes product stock by `change` and records it in stock history. */
export function adjustStock(productId: number, change: number, reason: string, orderId?: number | null) {
  if (!change) return;
  tx(() => {
    const p = db.prepare('SELECT stock FROM products WHERE id = ?').get(productId) as { stock: number } | undefined;
    if (!p) return;
    const after = p.stock + change;
    db.prepare(`UPDATE products SET stock = ?, updated_at = datetime('now') WHERE id = ?`).run(after, productId);
    db.prepare('INSERT INTO stock_history (product_id, change, stock_after, reason, order_id) VALUES (?, ?, ?, ?, ?)').run(
      productId,
      change,
      after,
      reason,
      orderId ?? null,
    );
  });
  emitStockChanged(productId);
}

export function setStock(productId: number, value: number, reason: string) {
  const p = db.prepare('SELECT stock FROM products WHERE id = ?').get(productId) as { stock: number } | undefined;
  if (!p) return;
  adjustStock(productId, value - p.stock, reason);
}

/** Deducts stock for all linked items of an order (once). */
export function deductOrderStock(orderId: number) {
  tx(() => {
    const o = db.prepare('SELECT stock_deducted FROM orders WHERE id = ?').get(orderId) as { stock_deducted: number } | undefined;
    if (!o || o.stock_deducted) return;
    const items = db
      .prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ? AND product_id IS NOT NULL')
      .all(orderId) as { product_id: number; quantity: number }[];
    for (const it of items) adjustStock(it.product_id, -it.quantity, 'order', orderId);
    db.prepare('UPDATE orders SET stock_deducted = 1 WHERE id = ?').run(orderId);
  });
}

/** Returns previously deducted stock of an order back to the warehouse. */
export function restoreOrderStock(orderId: number) {
  tx(() => {
    const o = db.prepare('SELECT stock_deducted FROM orders WHERE id = ?').get(orderId) as { stock_deducted: number } | undefined;
    if (!o || !o.stock_deducted) return;
    const items = db
      .prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ? AND product_id IS NOT NULL')
      .all(orderId) as { product_id: number; quantity: number }[];
    for (const it of items) adjustStock(it.product_id, it.quantity, 'order_restore', orderId);
    db.prepare('UPDATE orders SET stock_deducted = 0 WHERE id = ?').run(orderId);
  });
}

/** Finds an inventory product by SKU or EAN. */
export function findProduct(sku?: string, ean?: string): { id: number; sku: string; ean: string; weight: number; location: string; images: string } | undefined {
  if (sku) {
    const p = db.prepare(`SELECT id, sku, ean, weight, location, images FROM products WHERE sku = ? AND sku != '' LIMIT 1`).get(sku);
    if (p) return p as any;
  }
  if (ean) {
    const p = db.prepare(`SELECT id, sku, ean, weight, location, images FROM products WHERE ean = ? AND ean != '' LIMIT 1`).get(ean);
    if (p) return p as any;
  }
  return undefined;
}
