import { Router } from 'express';
import { z } from 'zod';
import { db, parseJson } from '../db/index.js';
import { HttpError, idParam, q, likeContains } from '../lib/http.js';
import { sendTrackingToSource } from '../integrations/sync.js';
import { computeTotals, createCorrection, createInvoice, deleteInvoice, getInvoice } from '../services/invoices.js';
import { invoicePdf, labelPdf, returnPdf } from '../services/pdf.js';
import { createReturn, getReturn, returnToStock, updateReturn } from '../services/returns.js';
import { deleteShipment, markLabelsPrinted, SHIPMENT_STATUSES, updateShipmentStatus } from '../services/shipments.js';
import { userName } from './auth.js';
import { sendPdf } from './orders.js';

/* --------------------------------- shipments --------------------------------- */

export const shipmentsRouter = Router();

shipmentsRouter.get('/', (req, res) => {
  const w = ['1=1'];
  const p: unknown[] = [];
  const courier = q.str(req.query.courier);
  const status = q.str(req.query.status);
  const search = q.str(req.query.search);
  if (courier) {
    w.push('s.courier = ?');
    p.push(courier);
  }
  if (status) {
    w.push('s.status = ?');
    p.push(status);
  }
  if (search) {
    w.push(`(s.tracking_number LIKE ? ESCAPE '!' OR CAST(s.order_id AS TEXT) = ? OR o.delivery_fullname LIKE ? ESCAPE '!')`);
    p.push(likeContains(String(search)), search, likeContains(String(search)));
  }
  if (q.str(req.query.date_from)) {
    w.push('s.created_at >= ?');
    p.push(`${q.str(req.query.date_from)} 00:00:00`);
  }
  if (q.str(req.query.date_to)) {
    w.push('s.created_at <= ?');
    p.push(`${q.str(req.query.date_to)} 23:59:59`);
  }
  const page = Math.max(1, q.int(req.query.page) ?? 1);
  const perPage = Math.min(500, q.int(req.query.per_page) ?? 50);
  const where = w.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) c FROM shipments s JOIN orders o ON o.id = s.order_id WHERE ${where}`).get(...p) as { c: number }).c;
  const rows = db
    .prepare(
      `SELECT s.*, o.delivery_fullname, o.delivery_city, o.source, o.external_id, o.currency
       FROM shipments s JOIN orders o ON o.id = s.order_id WHERE ${where} ORDER BY s.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...p, perPage, (page - 1) * perPage);
  res.json({ total, page, per_page: perPage, rows, statuses: SHIPMENT_STATUSES });
});

shipmentsRouter.get('/labels', async (req, res) => {
  const ids = q.ints(req.query.ids).slice(0, 500);
  if (!ids.length) throw new HttpError(400, 'No shipments selected');
  const pdf = await labelPdf(ids);
  markLabelsPrinted(ids);
  sendPdf(res, pdf, 'labels.pdf');
});

shipmentsRouter.get('/manifest', (req, res) => {
  // Pickup protocol ("protokół odbioru") as printable data.
  const ids = q.ints(req.query.ids);
  if (!ids.length) throw new HttpError(400, 'No shipments selected');
  res.json(
    db
      .prepare(
        `SELECT s.id, s.courier, s.tracking_number, s.weight, s.cod_amount, o.id order_id, o.delivery_fullname, o.delivery_city
         FROM shipments s JOIN orders o ON o.id = s.order_id WHERE s.id IN (${ids.map(() => '?').join(',')})`,
      )
      .all(...ids),
  );
});

shipmentsRouter.put('/:id/status', (req, res) => {
  const b = z.object({ status: z.enum(SHIPMENT_STATUSES) }).parse(req.body);
  updateShipmentStatus(idParam(req), b.status, userName(req));
  res.json({ ok: true });
});

shipmentsRouter.post('/:id/send-tracking', async (req, res) => {
  try {
    await sendTrackingToSource(idParam(req));
    res.json({ ok: true });
  } catch (e: any) {
    throw new HttpError(502, e.message);
  }
});

shipmentsRouter.delete('/:id', (req, res) => {
  deleteShipment(idParam(req), userName(req));
  res.json({ ok: true });
});

/* --------------------------------- invoices --------------------------------- */

export const invoicesRouter = Router();

invoicesRouter.get('/', (req, res) => {
  const w = ['1=1'];
  const p: unknown[] = [];
  const type = q.str(req.query.type);
  const search = q.str(req.query.search);
  if (type) {
    w.push('v.type = ?');
    p.push(type);
  }
  if (search) {
    w.push(`(v.number LIKE ? ESCAPE '!' OR CAST(v.order_id AS TEXT) = ? OR v.buyer LIKE ? ESCAPE '!')`);
    p.push(likeContains(String(search)), search, likeContains(String(search)));
  }
  if (q.str(req.query.date_from)) {
    w.push('v.issue_date >= ?');
    p.push(q.str(req.query.date_from));
  }
  if (q.str(req.query.date_to)) {
    w.push('v.issue_date <= ?');
    p.push(q.str(req.query.date_to));
  }
  const page = Math.max(1, q.int(req.query.page) ?? 1);
  const perPage = Math.min(500, q.int(req.query.per_page) ?? 50);
  const where = w.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) c FROM invoices v WHERE ${where}`).get(...p) as { c: number }).c;
  const sums = db.prepare(`SELECT COALESCE(SUM(total_net),0) net, COALESCE(SUM(total_gross),0) gross FROM invoices v WHERE ${where}`).get(...p);
  const rows = (
    db
      .prepare(`SELECT v.id, v.order_id, v.type, v.number, v.issue_date, v.sale_date, v.buyer, v.total_net, v.total_gross, v.currency, v.paid FROM invoices v WHERE ${where} ORDER BY v.id DESC LIMIT ? OFFSET ?`)
      .all(...p, perPage, (page - 1) * perPage) as any[]
  ).map((r) => ({ ...r, buyer: parseJson(r.buyer, {}) }));
  res.json({ total, page, per_page: perPage, rows, sums });
});

invoicesRouter.get('/series', (_req, res) => {
  res.json(db.prepare('SELECT * FROM invoice_series ORDER BY type, id').all());
});

const seriesSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['invoice', 'proforma', 'receipt', 'correction']),
  format: z.string().min(2).max(50).refine((f) => f.includes('%N'), 'Format must contain %N'),
  reset_period: z.enum(['month', 'year', 'never']),
  is_default: z.boolean().optional(),
});

invoicesRouter.post('/series', (req, res) => {
  const b = seriesSchema.parse(req.body);
  if (b.is_default) db.prepare('UPDATE invoice_series SET is_default = 0 WHERE type = ?').run(b.type);
  const r = db
    .prepare('INSERT INTO invoice_series (name, type, format, reset_period, is_default) VALUES (?, ?, ?, ?, ?)')
    .run(b.name, b.type, b.format, b.reset_period, b.is_default ? 1 : 0);
  res.json({ id: Number(r.lastInsertRowid) });
});

invoicesRouter.put('/series/:id', (req, res) => {
  const id = idParam(req);
  const b = seriesSchema.parse(req.body);
  if (b.is_default) db.prepare('UPDATE invoice_series SET is_default = 0 WHERE type = ?').run(b.type);
  db.prepare('UPDATE invoice_series SET name = ?, type = ?, format = ?, reset_period = ?, is_default = ? WHERE id = ?').run(
    b.name,
    b.type,
    b.format,
    b.reset_period,
    b.is_default ? 1 : 0,
    id,
  );
  res.json({ ok: true });
});

invoicesRouter.delete('/series/:id', (req, res) => {
  const id = idParam(req);
  if (db.prepare('SELECT 1 FROM invoices WHERE series_id = ?').get(id)) throw new HttpError(409, 'Series has documents');
  db.prepare('DELETE FROM invoice_series WHERE id = ?').run(id);
  res.json({ ok: true });
});

invoicesRouter.get('/:id', (req, res) => {
  res.json(getInvoice(idParam(req)));
});

invoicesRouter.get('/:id/pdf', async (req, res) => {
  const inv = getInvoice(idParam(req));
  sendPdf(res, await invoicePdf(inv.id), `${inv.number}.pdf`);
});

const invItem = z.object({
  name: z.string().min(1).max(500),
  sku: z.string().max(100).optional(),
  quantity: z.number().min(-100000).max(100000),
  unit: z.string().max(10).optional(),
  price_gross: z.number().min(-1e7).max(1e7),
  tax_rate: z.number().min(0).max(100),
});
const party = z.object({
  name: z.string().max(200),
  company: z.string().max(200).optional(),
  nip: z.string().max(30).optional(),
  address: z.string().max(300).optional(),
  postcode: z.string().max(20).optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(2).optional(),
  email: z.string().max(200).optional(),
});

invoicesRouter.post('/', (req, res) => {
  const b = z
    .object({
      type: z.enum(['invoice', 'proforma', 'receipt']),
      series_id: z.number().int().optional(),
      issue_date: z.string().optional(),
      sale_date: z.string().optional(),
      payment_method: z.string().max(100).optional(),
      payment_due_days: z.number().int().min(0).max(365).optional(),
      paid: z.boolean().optional(),
      currency: z.string().regex(/^[A-Z]{3}$/).optional(),
      buyer: party,
      items: z.array(invItem).min(1).max(500),
      notes: z.string().max(2000).optional(),
    })
    .parse(req.body);
  res.json({ id: createInvoice(b) });
});

invoicesRouter.post('/:id/correction', (req, res) => {
  const b = z.object({ items: z.array(invItem).max(500), reason: z.string().min(1).max(500) }).parse(req.body);
  res.json({ id: createCorrection(idParam(req), b.items, b.reason, userName(req)) });
});

invoicesRouter.post('/preview-totals', (req, res) => {
  const b = z.object({ items: z.array(invItem) }).parse(req.body);
  res.json(computeTotals(b.items));
});

invoicesRouter.delete('/:id', (req, res) => {
  deleteInvoice(idParam(req), userName(req));
  res.json({ ok: true });
});

/* ---------------------------------- returns ---------------------------------- */

export const returnsRouter = Router();

returnsRouter.get('/', (req, res) => {
  const w = ['1=1'];
  const p: unknown[] = [];
  const status = q.int(req.query.status_id);
  const search = q.str(req.query.search);
  if (status) {
    w.push('r.status_id = ?');
    p.push(status);
  }
  if (search) {
    w.push(`(CAST(r.order_id AS TEXT) = ? OR CAST(r.id AS TEXT) = ? OR r.buyer_name LIKE ? ESCAPE '!' OR r.buyer_email LIKE ? ESCAPE '!')`);
    p.push(search, search, likeContains(String(search)), likeContains(String(search)));
  }
  const page = Math.max(1, q.int(req.query.page) ?? 1);
  const perPage = Math.min(500, q.int(req.query.per_page) ?? 50);
  const where = w.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) c FROM returns r WHERE ${where}`).get(...p) as { c: number }).c;
  const rows = (
    db
      .prepare(
        `SELECT r.*, o.source order_source, o.external_id FROM returns r LEFT JOIN orders o ON o.id = r.order_id
         WHERE ${where} ORDER BY r.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...p, perPage, (page - 1) * perPage) as any[]
  ).map((r) => ({ ...r, items: parseJson(r.items, []) }));
  const statuses = db.prepare('SELECT s.*, (SELECT COUNT(*) FROM returns r WHERE r.status_id = s.id) count FROM return_statuses s ORDER BY sort, id').all();
  res.json({ total, page, per_page: perPage, rows, statuses });
});

returnsRouter.post('/statuses', (req, res) => {
  const b = z.object({ name: z.string().min(1).max(60), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).parse(req.body);
  const sort = ((db.prepare('SELECT MAX(sort) m FROM return_statuses').get() as { m: number }).m ?? 0) + 1;
  res.json({ id: Number(db.prepare('INSERT INTO return_statuses (name, color, sort) VALUES (?, ?, ?)').run(b.name, b.color, sort).lastInsertRowid) });
});

returnsRouter.put('/statuses/:id', (req, res) => {
  const b = z.object({ name: z.string().min(1).max(60), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).parse(req.body);
  db.prepare('UPDATE return_statuses SET name = ?, color = ? WHERE id = ?').run(b.name, b.color, idParam(req));
  res.json({ ok: true });
});

returnsRouter.delete('/statuses/:id', (req, res) => {
  const id = idParam(req);
  const s = db.prepare('SELECT system_key FROM return_statuses WHERE id = ?').get(id) as any;
  if (!s) throw new HttpError(404, 'Status not found');
  if (s.system_key) throw new HttpError(400, 'System statuses cannot be deleted');
  if (db.prepare('SELECT 1 FROM returns WHERE status_id = ?').get(id)) throw new HttpError(409, 'Status is in use');
  db.prepare('DELETE FROM return_statuses WHERE id = ?').run(id);
  res.json({ ok: true });
});

returnsRouter.get('/:id', (req, res) => {
  res.json(getReturn(idParam(req)));
});

returnsRouter.get('/:id/pdf', async (req, res) => {
  const r = getReturn(idParam(req));
  sendPdf(res, await returnPdf(r.id), `return-${r.id}.pdf`);
});

const returnItem = z.object({
  order_item_id: z.number().int().optional(),
  product_id: z.number().int().nullable().optional(),
  name: z.string().min(1).max(500),
  sku: z.string().max(100).optional(),
  quantity: z.number().int().min(1),
  price: z.number(),
});

returnsRouter.post('/', (req, res) => {
  const b = z
    .object({
      order_id: z.number().int().nullable().optional(),
      reason: z.string().max(1000).optional(),
      items: z.array(returnItem).max(500).optional(),
      refund_amount: z.number().min(0).optional(),
      bank_account: z.string().max(60).optional(),
      tracking_number: z.string().max(100).optional(),
      notes: z.string().max(2000).optional(),
      buyer_name: z.string().max(200).optional(),
      buyer_email: z.string().max(200).optional(),
    })
    .parse(req.body);
  res.json({ id: createReturn(b, userName(req)) });
});

returnsRouter.put('/:id', (req, res) => {
  const b = z
    .object({
      status_id: z.number().int().optional(),
      reason: z.string().max(1000).optional(),
      refund_amount: z.number().min(0).optional(),
      bank_account: z.string().max(60).optional(),
      tracking_number: z.string().max(100).optional(),
      notes: z.string().max(2000).optional(),
      refunded: z.boolean().optional(),
      items: z.array(returnItem).max(500).optional(),
    })
    .parse(req.body);
  updateReturn(idParam(req), b, userName(req));
  res.json({ ok: true });
});

returnsRouter.post('/:id/stock', (req, res) => {
  returnToStock(idParam(req), userName(req));
  res.json({ ok: true });
});

returnsRouter.delete('/:id', (req, res) => {
  const r = getReturn(idParam(req));
  if (r.stock_returned) throw new HttpError(409, 'Products were already returned to stock');
  db.prepare('DELETE FROM returns WHERE id = ?').run(r.id);
  res.json({ ok: true });
});
