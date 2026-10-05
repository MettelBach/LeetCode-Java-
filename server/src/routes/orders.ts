import { Router, type Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { HttpError, idParam } from '../lib/http.js';
import { runRulesFor } from '../services/automation.js';
import { sendEmail, sendTemplateEmail } from '../services/email.js';
import { issueForOrder } from '../services/invoices.js';
import { filtersFromQuery, listOrderIds, listOrders, type OrderFilters } from '../services/order-query.js';
import {
  addHistory,
  addItem,
  changeStatus,
  createOrder,
  deleteItem,
  deleteOrder,
  duplicateOrder,
  EDITABLE_FIELDS,
  getOrderFull,
  mergeOrders,
  restoreOrder,
  setArchived,
  setPayment,
  splitOrder,
  updateItem,
  updateOrder,
} from '../services/orders.js';
import { ordersPrintout } from '../services/pdf.js';
import { createReturn } from '../services/returns.js';
import { COURIERS, createShipment } from '../services/shipments.js';
import { userName } from './auth.js';

export const ordersRouter = Router();

const str = (max = 500) => z.string().max(max);

const itemSchema = z.object({
  product_id: z.number().int().nullable().optional(),
  name: str(500).min(1),
  sku: str(100).optional(),
  ean: str(50).optional(),
  quantity: z.number().int().min(1).max(100000),
  price: z.number().min(-1e7).max(1e7),
  tax_rate: z.number().min(0).max(100).optional(),
  weight: z.number().min(0).max(100000).optional(),
  location: str(100).optional(),
  attributes: str(500).optional(),
  auction_id: str(100).optional(),
});

const orderFieldsSchema = z
  .object({
    user_login: str(200),
    email: str(200),
    phone: str(50),
    currency: z.string().regex(/^[A-Z]{3}$/),
    payment_method: str(100),
    payment_cod: z.union([z.boolean(), z.number()]),
    delivery_method: str(200),
    delivery_price: z.number().min(0).max(1e6),
    delivery_fullname: str(200),
    delivery_company: str(200),
    delivery_address: str(300),
    delivery_postcode: str(20),
    delivery_city: str(100),
    delivery_country_code: z.string().regex(/^[A-Z]{2}$/),
    delivery_point_id: str(100),
    delivery_point_name: str(200),
    delivery_point_address: str(300),
    delivery_point_postcode: str(20),
    delivery_point_city: str(100),
    invoice_wanted: z.union([z.boolean(), z.number()]),
    invoice_fullname: str(200),
    invoice_company: str(200),
    invoice_nip: str(30),
    invoice_address: str(300),
    invoice_postcode: str(20),
    invoice_city: str(100),
    invoice_country_code: z.string().regex(/^[A-Z]{2}$/),
    buyer_comment: str(2000),
    seller_comment: str(5000),
    extra_field_1: str(500),
    extra_field_2: str(500),
    star: z.number().int().min(0).max(5),
    flag: str(20),
    date_add: z.string().regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/),
  })
  .partial();

ordersRouter.get('/', (req, res) => {
  res.json(listOrders(filtersFromQuery(req.query as Record<string, unknown>)));
});

ordersRouter.get('/export.csv', (req, res) => {
  const f = { ...filtersFromQuery(req.query as Record<string, unknown>), page: 1, per_page: 100000 };
  const data = listOrders(f);
  const statuses = new Map((db.prepare('SELECT id, name FROM order_statuses').all() as any[]).map((s) => [s.id, s.name]));
  const cols = ['id', 'external_id', 'source', 'date_add', 'status', 'delivery_fullname', 'email', 'delivery_method', 'payment_method', 'total', 'paid_amount', 'currency', 'products'];
  const esc = (v: unknown) => {
    let s = String(v ?? '');
    // Prevent formula injection when the file is opened in a spreadsheet.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [cols.join(';')];
  for (const r of data.rows) {
    lines.push(
      [
        r.id,
        r.external_id,
        r.source,
        r.date_add,
        statuses.get(r.status_id),
        r.delivery_fullname,
        r.email,
        r.delivery_method,
        r.payment_method,
        r.total.toFixed(2),
        r.paid_amount.toFixed(2),
        r.currency,
        r.items.map((i: any) => `${i.quantity}x ${i.name}`).join(', '),
      ]
        .map(esc)
        .join(';'),
    );
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
  res.send('﻿' + lines.join('\r\n'));
});

ordersRouter.get('/print', async (req, res) => {
  const ids = String(req.query.ids ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 1000);
  const kind = (['order_card', 'packing_list', 'pick_list'].includes(String(req.query.kind)) ? req.query.kind : 'order_card') as
    | 'order_card'
    | 'packing_list'
    | 'pick_list';
  sendPdf(res, await ordersPrintout(ids, kind), `${kind}.pdf`);
});

export function sendPdf(res: Response, buf: Buffer, filename: string) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  res.send(buf);
}

ordersRouter.get('/:id', (req, res) => {
  const id = idParam(req);
  const order = getOrderFull(id);
  // Neighbours in the active list for the < > navigation.
  const prev = db.prepare('SELECT id FROM orders WHERE id < ? AND deleted = 0 ORDER BY id DESC LIMIT 1').get(id) as any;
  const next = db.prepare('SELECT id FROM orders WHERE id > ? AND deleted = 0 ORDER BY id ASC LIMIT 1').get(id) as any;
  res.json({ ...order, prev_id: prev?.id ?? null, next_id: next?.id ?? null });
});

ordersRouter.post('/', (req, res) => {
  const b = orderFieldsSchema.extend({ status_id: z.number().int().optional(), items: z.array(itemSchema).max(500).optional(), paid_amount: z.number().min(0).optional() }).parse(req.body);
  const id = createOrder({ ...b, source: 'manual' }, userName(req));
  res.json({ id });
});

ordersRouter.put('/:id', (req, res) => {
  const id = idParam(req);
  const b = orderFieldsSchema.parse(req.body);
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) if ((EDITABLE_FIELDS as readonly string[]).includes(k)) patch[k] = v;
  updateOrder(id, patch, userName(req));
  res.json({ ok: true });
});

ordersRouter.delete('/:id', (req, res) => {
  res.json({ result: deleteOrder(idParam(req), userName(req)) });
});

ordersRouter.post('/:id/restore', (req, res) => {
  restoreOrder(idParam(req), userName(req));
  res.json({ ok: true });
});

ordersRouter.post('/:id/archive', (req, res) => {
  const b = z.object({ archived: z.boolean() }).parse(req.body);
  setArchived(idParam(req), b.archived, userName(req));
  res.json({ ok: true });
});

ordersRouter.post('/:id/status', (req, res) => {
  const b = z.object({ status_id: z.number().int() }).parse(req.body);
  changeStatus(idParam(req), b.status_id, userName(req));
  res.json({ ok: true });
});

ordersRouter.post('/:id/payment', (req, res) => {
  const b = z.object({ paid_amount: z.number().min(0).max(1e8), payment_date: z.string().optional() }).parse(req.body);
  setPayment(idParam(req), b.paid_amount, userName(req), b.payment_date);
  res.json({ ok: true });
});

ordersRouter.post('/:id/items', (req, res) => {
  const b = itemSchema.parse(req.body);
  res.json({ id: addItem(idParam(req), b, userName(req)) });
});

ordersRouter.put('/:id/items/:itemId', (req, res) => {
  const b = itemSchema.partial().parse(req.body);
  updateItem(idParam(req), idParam(req, 'itemId'), b, userName(req));
  res.json({ ok: true });
});

ordersRouter.delete('/:id/items/:itemId', (req, res) => {
  deleteItem(idParam(req), idParam(req, 'itemId'), userName(req));
  res.json({ ok: true });
});

ordersRouter.post('/:id/duplicate', (req, res) => {
  res.json({ id: duplicateOrder(idParam(req), userName(req)) });
});

ordersRouter.post('/:id/split', (req, res) => {
  const b = z
    .object({
      item_ids: z.array(z.number().int()).optional(),
      items: z.array(z.object({ id: z.number().int(), quantity: z.number().positive().optional() })).optional(),
    })
    .refine((v) => (v.item_ids?.length ?? 0) + (v.items?.length ?? 0) > 0, 'Select products to split')
    .parse(req.body);
  res.json({ id: splitOrder(idParam(req), [...(b.item_ids ?? []), ...(b.items ?? [])], userName(req)) });
});

ordersRouter.post('/:id/note', (req, res) => {
  const b = z.object({ message: z.string().min(1).max(2000) }).parse(req.body);
  addHistory(idParam(req), b.message, 'note', userName(req));
  res.json({ ok: true });
});

ordersRouter.post('/:id/email', async (req, res) => {
  const id = idParam(req);
  const b = z
    .union([
      z.object({ template_id: z.number().int() }),
      z.object({ to: z.string().email().optional(), subject: z.string().min(1).max(300), body: z.string().min(1).max(20000) }),
    ])
    .parse(req.body);
  if ('template_id' in b) res.json({ status: await sendTemplateEmail(id, b.template_id, userName(req)) });
  else {
    const o = getOrderFull(id);
    res.json({ status: await sendEmail(id, b.to ?? o.email, b.subject, b.body, userName(req)) });
  }
});

ordersRouter.post('/:id/documents', (req, res) => {
  const b = z
    .object({
      type: z.enum(['invoice', 'proforma', 'receipt']),
      series_id: z.number().int().optional(),
      issue_date: z.string().optional(),
      sale_date: z.string().optional(),
      payment_due_days: z.number().int().min(0).max(365).optional(),
      notes: z.string().max(2000).optional(),
    })
    .parse(req.body);
  res.json({ id: issueForOrder(idParam(req), b.type, { ...b, user: userName(req) }) });
});

const shipmentSchema = z.object({
  courier: z.enum(COURIERS),
  tracking_number: z.string().max(100).optional(),
  service: z.string().max(100).optional(),
  weight: z.number().min(0).max(10000).optional(),
  size: z.string().max(20).optional(),
  cod_amount: z.number().min(0).max(1e7).optional(),
  insurance: z.number().min(0).max(1e7).optional(),
});

ordersRouter.post('/:id/shipments', (req, res) => {
  const b = shipmentSchema.parse(req.body);
  res.json({ id: createShipment(idParam(req), b, userName(req)) });
});

ordersRouter.post('/:id/returns', (req, res) => {
  const b = z
    .object({
      reason: z.string().max(1000).optional(),
      items: z
        .array(z.object({ order_item_id: z.number().int().optional(), name: z.string(), sku: z.string().optional(), quantity: z.number().int().min(1), price: z.number() }))
        .optional(),
      refund_amount: z.number().min(0).optional(),
      bank_account: z.string().max(60).optional(),
      notes: z.string().max(2000).optional(),
    })
    .parse(req.body);
  res.json({ id: createReturn({ ...b, order_id: idParam(req) }, userName(req)) });
});

ordersRouter.post('/:id/run-rule/:ruleId', async (req, res) => {
  const id = idParam(req);
  getOrderFull(id);
  await runRulesFor('manual', { orderId: id, user: userName(req) }, idParam(req, 'ruleId'));
  res.json({ ok: true });
});

/* ------------------------------ bulk actions ------------------------------ */

const bulkSchema = z.object({
  ids: z.array(z.number().int()).optional(),
  /** Apply to all orders matching the list filters instead of explicit ids. */
  filters: z.record(z.string(), z.any()).optional(),
  action: z.enum([
    'set_status',
    'delete',
    'restore',
    'archive',
    'unarchive',
    'star',
    'unstar',
    'invoice',
    'receipt',
    'email',
    'shipment',
    'merge',
    'run_rule',
    'set_paid',
  ]),
  params: z.record(z.string(), z.any()).optional(),
});

ordersRouter.post('/bulk', async (req, res) => {
  const b = bulkSchema.parse(req.body);
  const ids = b.ids?.length ? b.ids : b.filters ? listOrderIds(filtersFromQuery(b.filters) as OrderFilters) : [];
  if (!ids.length) throw new HttpError(400, 'No orders selected');
  if (ids.length > 5000) throw new HttpError(400, 'Too many orders at once (max 5000)');
  const user = userName(req);
  const p = b.params ?? {};
  const errors: { id: number; error: string }[] = [];
  let ok = 0;
  if (b.action === 'merge') {
    res.json({ id: mergeOrders(ids, user) });
    return;
  }
  for (const id of ids) {
    try {
      switch (b.action) {
        case 'set_status':
          changeStatus(id, Number(p.status_id), user);
          break;
        case 'delete':
          deleteOrder(id, user);
          break;
        case 'restore':
          restoreOrder(id, user);
          break;
        case 'archive':
          setArchived(id, true, user);
          break;
        case 'unarchive':
          setArchived(id, false, user);
          break;
        case 'star':
          updateOrder(id, { star: Number(p.star ?? 1) }, user);
          break;
        case 'unstar':
          updateOrder(id, { star: 0 }, user);
          break;
        case 'invoice':
          issueForOrder(id, 'invoice', { series_id: p.series_id ? Number(p.series_id) : undefined, user });
          break;
        case 'receipt':
          issueForOrder(id, 'receipt', { series_id: p.series_id ? Number(p.series_id) : undefined, user });
          break;
        case 'email':
          await sendTemplateEmail(id, Number(p.template_id), user);
          break;
        case 'shipment':
          createShipment(id, shipmentSchema.parse(p), user);
          break;
        case 'run_rule':
          await runRulesFor('manual', { orderId: id, user }, Number(p.rule_id));
          break;
        case 'set_paid': {
          const o = getOrderFull(id);
          setPayment(id, o.total, user);
          break;
        }
      }
      ok++;
    } catch (e: any) {
      errors.push({ id, error: e.message });
    }
  }
  res.json({ ok, errors });
});
