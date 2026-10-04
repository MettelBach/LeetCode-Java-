import { SMTP_PORTS } from '../lib/net.js';
import { Router } from 'express';
import { z } from 'zod';
import { db, getSetting, parseJson, platformDb, runWithTenant, setSetting } from '../db/index.js';
import { HttpError, idParam, q } from '../lib/http.js';
import { ACTION_TYPES, CONDITION_FIELDS, EVENTS, runRulesFor } from '../services/automation.js';
import { orderTotal } from '../services/orders.js';
import { assertPublicHttpsUrl } from '../lib/net.js';
import { requireAdmin, userName } from './auth.js';

/* ----------------------------- automatic actions ----------------------------- */

export const rulesRouter = Router();

const ruleSchema = z.object({
  name: z.string().min(1).max(200),
  enabled: z.boolean().optional(),
  event: z.enum(EVENTS as [string, ...string[]]),
  conditions: z
    .array(z.object({ field: z.enum(CONDITION_FIELDS), op: z.string().max(20), value: z.any() }))
    .max(50),
  actions: z
    .array(z.object({ type: z.enum(ACTION_TYPES), params: z.record(z.string(), z.any()).default({}) }))
    .min(1)
    .max(30),
});

rulesRouter.get('/meta', (_req, res) => {
  res.json({ events: EVENTS, fields: CONDITION_FIELDS, actions: ACTION_TYPES });
});

rulesRouter.get('/', (_req, res) => {
  const rows = (db.prepare('SELECT * FROM rules ORDER BY sort, id').all() as any[]).map((r) => ({
    ...r,
    enabled: !!r.enabled,
    conditions: parseJson(r.conditions, []),
    actions: parseJson(r.actions, []),
  }));
  res.json(rows);
});

rulesRouter.post('/', requireAdmin, async (req, res) => {
  const b = ruleSchema.parse(req.body);
  await validateRule(b);
  const sort = ((db.prepare('SELECT MAX(sort) m FROM rules').get() as { m: number }).m ?? 0) + 1;
  const r = db
    .prepare('INSERT INTO rules (name, enabled, event, conditions, actions, sort) VALUES (?, ?, ?, ?, ?, ?)')
    .run(b.name, b.enabled === false ? 0 : 1, b.event, JSON.stringify(b.conditions), JSON.stringify(b.actions), sort);
  res.json({ id: Number(r.lastInsertRowid) });
});

async function validateRule(b: z.infer<typeof ruleSchema>) {
  for (const a of b.actions) {
    if (a.type === 'webhook') {
      try {
        await assertPublicHttpsUrl(String(a.params.url ?? ''));
      } catch (e: any) {
        throw new HttpError(400, `Webhook URL: ${e.message}`);
      }
    }
    if (a.type === 'set_status' && !db.prepare('SELECT 1 FROM order_statuses WHERE id = ?').get(Number(a.params.status_id))) {
      throw new HttpError(400, 'Action "set status": choose a status');
    }
    if (a.type === 'send_email' && !db.prepare('SELECT 1 FROM email_templates WHERE id = ?').get(Number(a.params.template_id))) {
      throw new HttpError(400, 'Action "send e-mail": choose a template');
    }
  }
}

rulesRouter.put('/:id', requireAdmin, async (req, res) => {
  const id = idParam(req);
  const b = ruleSchema.parse(req.body);
  await validateRule(b);
  const r = db
    .prepare('UPDATE rules SET name = ?, enabled = ?, event = ?, conditions = ?, actions = ? WHERE id = ?')
    .run(b.name, b.enabled === false ? 0 : 1, b.event, JSON.stringify(b.conditions), JSON.stringify(b.actions), id);
  if (!r.changes) throw new HttpError(404, 'Rule not found');
  res.json({ ok: true });
});

rulesRouter.patch('/:id', requireAdmin, (req, res) => {
  const b = z.object({ enabled: z.boolean() }).parse(req.body);
  db.prepare('UPDATE rules SET enabled = ? WHERE id = ?').run(b.enabled ? 1 : 0, idParam(req));
  res.json({ ok: true });
});

rulesRouter.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM rules WHERE id = ?').run(idParam(req));
  res.json({ ok: true });
});

rulesRouter.get('/:id/log', (req, res) => {
  res.json(db.prepare('SELECT * FROM rule_log WHERE rule_id = ? ORDER BY id DESC LIMIT 200').all(idParam(req)));
});

rulesRouter.post('/:id/run', async (req, res) => {
  const b = z.object({ order_ids: z.array(z.number().int()).min(1).max(1000) }).parse(req.body);
  const id = idParam(req);
  const rule = db.prepare('SELECT event FROM rules WHERE id = ?').get(id) as { event: string } | undefined;
  if (!rule) throw new HttpError(404, 'Rule not found');
  for (const orderId of b.order_ids) await runRulesFor(rule.event as any, { orderId, user: userName(req) }, id);
  res.json({ ok: true });
});

/* --------------------------------- dashboard --------------------------------- */

export const dashboardRouter = Router();

dashboardRouter.get('/', (req, res) => {
  const days = Math.min(365, Math.max(1, q.int(req.query.days) ?? 30));
  const since = `-${days} days`;
  const total = `(COALESCE((SELECT SUM(i.price*i.quantity) FROM order_items i WHERE i.order_id = o.id),0) + o.delivery_price)`;
  const daily = db
    .prepare(
      `SELECT date(o.date_add) d, COUNT(*) orders, ROUND(SUM(${total}), 2) revenue FROM orders o
       WHERE o.deleted = 0 AND o.date_add >= datetime('now', ?) GROUP BY d ORDER BY d`,
    )
    .all(since);
  const bySource = db
    .prepare(
      `SELECT COALESCE(n.name, o.source) name, o.source, COUNT(*) orders, ROUND(SUM(${total}), 2) revenue FROM orders o
       LEFT JOIN integrations n ON n.id = o.integration_id
       WHERE o.deleted = 0 AND o.date_add >= datetime('now', ?) GROUP BY COALESCE(n.name, o.source), o.source ORDER BY revenue DESC`,
    )
    .all(since);
  const summary = db
    .prepare(
      `SELECT COUNT(*) orders, ROUND(COALESCE(SUM(${total}),0), 2) revenue,
        ROUND(COALESCE(AVG(${total}),0), 2) avg_order,
        (SELECT COALESCE(SUM(i.quantity),0) FROM order_items i JOIN orders x ON x.id = i.order_id WHERE x.deleted = 0 AND x.date_add >= datetime('now', ?)) items
       FROM orders o WHERE o.deleted = 0 AND o.date_add >= datetime('now', ?)`,
    )
    .get(since, since);
  const prevSummary = db
    .prepare(
      `SELECT COUNT(*) orders, ROUND(COALESCE(SUM(${total}),0), 2) revenue FROM orders o
       WHERE o.deleted = 0 AND o.date_add >= datetime('now', ?) AND o.date_add < datetime('now', ?)`,
    )
    .get(`-${days * 2} days`, since);
  const today = db
    .prepare(`SELECT COUNT(*) orders, ROUND(COALESCE(SUM(${total}),0), 2) revenue FROM orders o WHERE o.deleted = 0 AND date(o.date_add) = date('now')`)
    .get();
  const topProducts = db
    .prepare(
      `SELECT i.name, i.sku, SUM(i.quantity) qty, ROUND(SUM(i.price * i.quantity), 2) revenue FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE o.deleted = 0 AND o.date_add >= datetime('now', ?) GROUP BY i.name, i.sku ORDER BY qty DESC LIMIT 10`,
    )
    .all(since);
  const statuses = db
    .prepare(
      `SELECT s.id, s.name, s.color, (SELECT COUNT(*) FROM orders o WHERE o.status_id = s.id AND o.deleted = 0 AND o.archived = 0) count
       FROM order_statuses s ORDER BY s.sort, s.id`,
    )
    .all();
  const lowStock = db
    .prepare(
      `SELECT id, name, sku, stock FROM products p WHERE stock <= 3 AND NOT EXISTS (SELECT 1 FROM products v WHERE v.parent_id = p.id) ORDER BY stock, name LIMIT 10`,
    )
    .all();
  const toDo = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM orders WHERE deleted = 0 AND archived = 0 AND status_id IN (SELECT id FROM order_statuses WHERE system_key IN ('new','paid'))) new_orders,
        (SELECT COUNT(*) FROM orders o WHERE o.deleted = 0 AND o.archived = 0 AND o.invoice_wanted = 1
          AND NOT EXISTS (SELECT 1 FROM invoices v WHERE v.order_id = o.id AND v.type = 'invoice')
          AND o.status_id NOT IN (SELECT id FROM order_statuses WHERE system_key = 'canceled')) invoices_needed,
        (SELECT COUNT(*) FROM orders o WHERE o.deleted = 0 AND o.archived = 0
          AND o.status_id IN (SELECT id FROM order_statuses WHERE system_key = 'to_send')
          AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id)) to_ship,
        (SELECT COUNT(*) FROM returns WHERE status_id IN (SELECT id FROM return_statuses WHERE system_key IN ('new','progress'))) open_returns,
        (SELECT COUNT(*) FROM integrations WHERE enabled = 1 AND last_error IS NOT NULL) integration_errors`,
    )
    .get();
  res.json({ days, daily, by_source: bySource, summary, prev_summary: prevSummary, today, top_products: topProducts, statuses, low_stock: lowStock, to_do: toDo, onboarding: onboarding() });
});

/** "First steps" checklist shown on the dashboard until it is completed or hidden. */
function onboarding() {
  if (getSetting<boolean>('onboarding_dismissed', false)) return null;
  const company = getSetting<any>('company', {});
  const has = (sql: string) => !!db.prepare(sql).get();
  const steps = [
    { id: 'company', done: !!(company.nip && company.address && company.city), to: '/settings/company' },
    { id: 'integration', done: has('SELECT 1 FROM integrations WHERE demo = 0'), to: '/integrations/add' },
    { id: 'products', done: has('SELECT 1 FROM products'), to: '/products' },
    { id: 'orders', done: has(`SELECT 1 FROM orders WHERE source <> 'manual'`), to: '/orders' },
    { id: 'invoice', done: has('SELECT 1 FROM invoices'), to: '/orders' },
    { id: 'shipment', done: has('SELECT 1 FROM shipments'), to: '/orders' },
    { id: 'automation', done: has('SELECT 1 FROM rules WHERE enabled = 1'), to: '/automation' },
  ];
  return { steps, done: steps.filter((x) => x.done).length };
}

dashboardRouter.post('/onboarding/dismiss', (_req, res) => {
  setSetting('onboarding_dismissed', true);
  res.json({ ok: true });
});

/* ---------------------------------- settings ---------------------------------- */

export const settingsRouter = Router();

const SETTINGS_SCHEMAS = {
  company: z.object({
    name: z.string().max(200),
    nip: z.string().max(30),
    address: z.string().max(300),
    postcode: z.string().max(20),
    city: z.string().max(100),
    country: z.string().max(2),
    email: z.string().max(200),
    phone: z.string().max(50),
    bank_account: z.string().max(60),
    bank_name: z.string().max(100),
  }),
  orders: z.object({
    stock_deduct: z.string().regex(/^(on_create|never|status:\d+)$/),
    stock_restore_on_cancel: z.boolean(),
    default_tax_rate: z.number().min(0).max(100),
    orders_per_page: z.number().int().min(10).max(1000),
    extra_field_1_label: z.string().max(60),
    extra_field_2_label: z.string().max(60),
  }),
  smtp: z.object({
    host: z.string().max(200),
    port: z.number().int().refine((p) => SMTP_PORTS.includes(p), 'SMTP port must be 25, 465, 587 or 2525'),
    secure: z.boolean(),
    user: z.string().max(200),
    password: z.string().max(200),
    from: z.string().max(200),
  }),
} as const;

settingsRouter.get('/', (_req, res) => {
  const smtp = getSetting<any>('smtp', {});
  res.json({
    company: getSetting('company', {}),
    orders: getSetting('orders', {}),
    smtp: { ...smtp, password: smtp.password ? '••••••••' : '' },
  });
});

settingsRouter.put('/:key', requireAdmin, (req, res) => {
  const key = String(req.params.key) as keyof typeof SETTINGS_SCHEMAS;
  const schema = SETTINGS_SCHEMAS[key];
  if (!schema) throw new HttpError(404, 'Unknown settings section');
  const value = (schema as z.ZodObject<any>).partial().parse(req.body) as Record<string, unknown>;
  const cur = getSetting<Record<string, unknown>>(key, {});
  if (key === 'smtp' && value.password === '••••••••') delete value.password;
  setSetting(key, { ...cur, ...value });
  res.json({ ok: true });
});

settingsRouter.get('/email-templates', (_req, res) => {
  res.json(db.prepare('SELECT * FROM email_templates ORDER BY id').all());
});

const tplSchema = z.object({ name: z.string().min(1).max(200), subject: z.string().min(1).max(300), body: z.string().min(1).max(20000) });

settingsRouter.post('/email-templates', (req, res) => {
  const b = tplSchema.parse(req.body);
  res.json({ id: Number(db.prepare('INSERT INTO email_templates (name, subject, body) VALUES (?, ?, ?)').run(b.name, b.subject, b.body).lastInsertRowid) });
});

settingsRouter.put('/email-templates/:id', (req, res) => {
  const b = tplSchema.parse(req.body);
  db.prepare('UPDATE email_templates SET name = ?, subject = ?, body = ? WHERE id = ?').run(b.name, b.subject, b.body, idParam(req));
  res.json({ ok: true });
});

settingsRouter.delete('/email-templates/:id', (req, res) => {
  db.prepare('DELETE FROM email_templates WHERE id = ?').run(idParam(req));
  res.json({ ok: true });
});

/* ------------------------- notifications & global search ------------------------- */

export const miscRouter = Router();

miscRouter.get('/notifications', (_req, res) => {
  const rows = db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 50').all();
  const unread = (db.prepare('SELECT COUNT(*) c FROM notifications WHERE is_read = 0').get() as { c: number }).c;
  res.json({ rows, unread });
});

miscRouter.post('/notifications/read', (_req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE is_read = 0').run();
  res.json({ ok: true });
});

miscRouter.get('/search', (req, res) => {
  const s = q.str(req.query.q);
  if (!s) {
    res.json({ orders: [], products: [] });
    return;
  }
  const like = `%${s}%`;
  const orders = db
    .prepare(
      `SELECT o.id, o.external_id, o.delivery_fullname, o.email, o.source, o.date_add, s.name status_name, s.color status_color
       FROM orders o JOIN order_statuses s ON s.id = o.status_id
       WHERE o.deleted = 0 AND (CAST(o.id AS TEXT) = ? OR o.external_id LIKE ? OR o.delivery_fullname LIKE ? OR o.email LIKE ? OR o.user_login LIKE ? OR o.phone LIKE ?
         OR EXISTS (SELECT 1 FROM shipments x WHERE x.order_id = o.id AND x.tracking_number = ?))
       ORDER BY o.id DESC LIMIT 8`,
    )
    .all(s, like, like, like, like, like, s);
  const products = db
    .prepare('SELECT id, name, sku, ean, stock, parent_id FROM products WHERE name LIKE ? OR sku LIKE ? OR ean = ? ORDER BY name LIMIT 8')
    .all(like, like, s);
  res.json({ orders, products });
});

/* ------------------------ public order page for the buyer ------------------------ */

export const publicRouter = Router();

publicRouter.get('/order/:account/:id/:token', (req, res) => {
  const accountId = idParam(req, 'account');
  if (!platformDb.prepare(`SELECT 1 FROM accounts WHERE id = ? AND status != 'closed'`).get(accountId)) throw new HttpError(404, 'Order not found');
  runWithTenant(accountId, () => publicOrder(req, res));
});

function publicOrder(req: import('express').Request, res: import('express').Response) {
  const id = idParam(req);
  const token = String(req.params.token);
  if (!/^[0-9a-f]{24}$/.test(token)) throw new HttpError(404, 'Order not found');
  const o = db.prepare('SELECT * FROM orders WHERE id = ? AND token = ? AND deleted = 0').get(id, token) as any;
  if (!o) throw new HttpError(404, 'Order not found');
  const status = db.prepare('SELECT full_name, name, color FROM order_statuses WHERE id = ?').get(o.status_id) as any;
  const items = db.prepare('SELECT name, quantity, price, attributes FROM order_items WHERE order_id = ?').all(id);
  const shipments = db.prepare('SELECT courier, tracking_number, status FROM shipments WHERE order_id = ?').all(id);
  const company = getSetting<any>('company', {});
  // Only data the buyer already knows — no internal notes or history.
  res.json({
    id: o.id,
    date_add: o.date_add,
    status: { name: status?.full_name || status?.name, color: status?.color },
    currency: o.currency,
    total: orderTotal(id),
    paid_amount: o.paid_amount,
    delivery_method: o.delivery_method,
    delivery_price: o.delivery_price,
    payment_method: o.payment_method,
    delivery: {
      fullname: o.delivery_fullname,
      address: o.delivery_address,
      postcode: o.delivery_postcode,
      city: o.delivery_city,
      point: o.delivery_point_id ? `${o.delivery_point_id} ${o.delivery_point_name}` : '',
    },
    items,
    shipments,
    company: { name: company.name, email: company.email, phone: company.phone },
  });
}
