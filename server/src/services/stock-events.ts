/**
 * Stock change notifications. The marketplace sync subscribes to push new
 * quantities to linked offers. Changes are debounced per product.
 */
type Listener = (productIds: number[]) => void;

const listeners: Listener[] = [];
const pending = new Set<number>();
let timer: NodeJS.Timeout | null = null;

export function onStockChanged(fn: Listener) {
  listeners.push(fn);
}

export function emitStockChanged(productId: number) {
  if (!listeners.length) return;
  pending.add(productId);
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const ids = [...pending];
    pending.clear();
    for (const l of listeners) {
      try {
        l(ids);
      } catch (e) {
        console.error('[stock] listener failed', e);
      }
    }
  }, 1500);
  timer.unref?.();
}
