/**
 * In-process event bus. Domain services emit events after committing changes;
 * the automation engine and marketplace sync subscribe to them.
 */
export type EventName =
  | 'order_created'
  | 'status_changed'
  | 'order_paid'
  | 'invoice_created'
  | 'receipt_created'
  | 'shipment_created'
  | 'return_created'
  | 'manual';

export interface EventPayload {
  orderId: number;
  user?: string;
  fromStatusId?: number;
  toStatusId?: number;
  /** Rule id that caused this event, used to stop infinite rule loops. */
  depth?: number;
  ruleIds?: number[];
  [k: string]: unknown;
}

type Listener = (event: EventName, payload: EventPayload) => void | Promise<void>;

const listeners: Listener[] = [];

export function onEvent(fn: Listener) {
  listeners.push(fn);
}

export function emit(event: EventName, payload: EventPayload) {
  for (const l of listeners) {
    try {
      const r = l(event, payload);
      if (r instanceof Promise) r.catch((e) => console.error(`[events] ${event} listener failed`, e));
    } catch (e) {
      console.error(`[events] ${event} listener failed`, e);
    }
  }
}

export function clearListeners() {
  listeners.length = 0;
}
