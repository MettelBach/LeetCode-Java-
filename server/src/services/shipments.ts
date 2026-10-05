import { db } from '../db/index.js';
import { HttpError, notFound } from '../lib/http.js';
import { emit } from './events.js';
import { addHistory, getOrder, orderTotal } from './orders.js';
import { courierName } from './pdf.js';

export const COURIERS = ['inpost', 'inpost_courier', 'dpd', 'dhl', 'gls', 'ups', 'pocztex', 'orlen', 'allegro', 'fedex', 'other'] as const;
export type Courier = (typeof COURIERS)[number];

export const SHIPMENT_STATUSES = ['created', 'label_printed', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'returned', 'canceled'] as const;

/** Generates a tracking number in a courier-like format (used when the courier is not connected via API). */
export function generateTrackingNumber(courier: string): string {
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
  switch (courier) {
    case 'inpost':
    case 'inpost_courier':
      return `6${digits(23)}`;
    case 'dpd':
      return `${digits(13)}U`;
    case 'dhl':
      return digits(11);
    case 'gls':
      return digits(11);
    case 'ups':
      return `1Z${digits(16)}`;
    case 'pocztex':
      return `PX${digits(10)}`;
    case 'orlen':
      return digits(20);
    case 'allegro':
      return `A${digits(9)}`;
    default:
      return digits(12);
  }
}

export interface ShipmentInput {
  courier: string;
  tracking_number?: string;
  service?: string;
  account_name?: string;
  weight?: number;
  size?: string;
  cod_amount?: number;
  insurance?: number;
}

export function createShipment(orderId: number, input: ShipmentInput, user = 'System', meta: { depth?: number; ruleIds?: number[] } = {}): number {
  const o = getOrder(orderId);
  if (!input.courier) throw new HttpError(400, 'Courier is required');
  const weight =
    input.weight ??
    (db.prepare('SELECT COALESCE(SUM(weight * quantity), 0) w FROM order_items WHERE order_id = ?').get(orderId) as { w: number }).w;
  const cod = input.cod_amount ?? (o.payment_cod ? Math.max(0, orderTotal(orderId) - o.paid_amount) : 0);
  if (o.deleted) throw new HttpError(409, 'The order is in the bin');
  // Without a connected courier API and without a real tracking number the shipment is only a
  // simulation (test label): its number is never sent to a marketplace or a customer.
  const simulated = input.tracking_number?.trim() ? 0 : 1;
  const tracking = input.tracking_number?.trim() || generateTrackingNumber(input.courier);
  const r = db
    .prepare(
      `INSERT INTO shipments (order_id, courier, account_name, service, tracking_number, weight, size, cod_amount, insurance, simulated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(orderId, input.courier, input.account_name ?? courierName(input.courier), input.service ?? '', tracking, weight, input.size ?? '', cod, input.insurance ?? 0, simulated);
  const id = Number(r.lastInsertRowid);
  addHistory(orderId, `Shipment created: ${courierName(input.courier)} ${tracking}${simulated ? ' (test number — courier not connected)' : ''}`, 'shipment', user);
  emit('shipment_created', { orderId, user, shipmentId: id, ...meta });
  return id;
}

export function getShipment(id: number) {
  const s = db.prepare('SELECT * FROM shipments WHERE id = ?').get(id) as any;
  if (!s) throw notFound('Shipment not found');
  return s;
}

export function updateShipmentStatus(id: number, status: string, user = 'System') {
  const s = getShipment(id);
  if (!SHIPMENT_STATUSES.includes(status as any)) throw new HttpError(400, 'Unknown shipment status');
  db.prepare(`UPDATE shipments SET status = ?, status_date = datetime('now') WHERE id = ?`).run(status, id);
  addHistory(s.order_id, `Shipment ${s.tracking_number}: ${status}`, 'shipment', user);
}

export function deleteShipment(id: number, user = 'System') {
  const s = getShipment(id);
  db.prepare('DELETE FROM shipments WHERE id = ?').run(id);
  addHistory(s.order_id, `Shipment deleted: ${s.tracking_number}`, 'shipment', user);
}

export function markLabelsPrinted(ids: number[]) {
  const st = db.prepare(
    `UPDATE shipments SET label_printed = 1, status = CASE WHEN status = 'created' THEN 'label_printed' ELSE status END WHERE id = ?`,
  );
  for (const id of ids) st.run(id);
}

/**
 * Simulated tracking progress for shipments created without a courier API.
 * Moves each shipment one step forward after some time so the UI shows
 * realistic statuses. Real courier tracking would replace this.
 */
export function advanceSimulatedTracking() {
  const flow = ['label_printed', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered'];
  const rows = db
    .prepare(
      `SELECT id, status FROM shipments WHERE simulated = 1 AND status IN ('label_printed','picked_up','in_transit','out_for_delivery')
       AND status_date <= datetime('now', '-6 hours')`,
    )
    .all() as { id: number; status: string }[];
  for (const r of rows) {
    const next = flow[flow.indexOf(r.status) + 1];
    if (next) db.prepare(`UPDATE shipments SET status = ?, status_date = datetime('now') WHERE id = ?`).run(next, r.id);
  }
}
