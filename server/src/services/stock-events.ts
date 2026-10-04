/**
 * Stock change notifications, collected per account. The marketplace sync
 * reads them to know which offers need a stock update.
 */
import { currentAccountId, hasTenant } from '../db/index.js';

const dirty = new Map<number, Set<number>>();

export function emitStockChanged(productId: number) {
  if (!hasTenant()) return;
  const acc = currentAccountId();
  if (!dirty.has(acc)) dirty.set(acc, new Set());
  dirty.get(acc)!.add(productId);
}

/** Returns and clears the products with changed stock for an account. */
export function takeDirtyProducts(accountId: number): number[] {
  const s = dirty.get(accountId);
  if (!s) return [];
  dirty.delete(accountId);
  return [...s];
}
