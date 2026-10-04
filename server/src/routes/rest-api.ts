/**
 * Public REST API for client integrations (shop engines, ERP, scripts).
 * Authentication with an API token created in Settings → API
 * (`X-Api-Token: sh_...` or `Authorization: Bearer sh_...`). The request limit
 * per minute comes from the "API" acceleration of the account.
 */
import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { db, platformDb, runWithTenant } from '../db/index.js';
import { HttpError, idParam, nowSql, q } from '../lib/http.js';
import { filtersFromQuery, listOrders } from '../services/order-query.js';
import { changeStatus, createOrder, getOrderFull, setPayment } from '../services/orders.js';
import { accelOption, accountAccelerations, audit, type AccountRow } from '../services/platform.js';
import { defaultWarehouseId, setStock } from '../services/stock.js';
import { requireAccountAdmin } from './auth.js';

export const TOKEN_PREFIX = 'sh_';

export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

declare module 'express-serve-static-core' {
  interface Request {
    apiToken?: { id: number; name: string };
  }
}

/* --------------------------------- rate limit --------------------------------- */

const windows = new Map<number, { minute: number; count: number }>();

function rateLimit(accountId: number, res: Response) {
  const limit = accelOption('api', accountAccelerations(accountId).api).minutes;
  const minute = Math.floor(Date.now() / 60_000);
  const w = windows.get(accountId);
  const cur = w && w.minute === minute ? w : { minute, count: 0 };
  cur.count++;
  windows.set(accountId, cur);
  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - cur.count)));
  if (cur.count > limit) {
    res.setHeader('Retry-After', String(60 - Math.floor((Date.now() / 1000) % 60)));
    throw new HttpError(429, `API limit of ${limit} requests per minute exceeded. Increase it in Integrations → Accelerations.`);
  }
}

/* ----------------------------------- auth ----------------------------------- */

function requireApiToken(req: Request, res: Response, next: NextFunction) {
  const header = req.headers['x-api-token'] ?? (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined);
  const token = typeof header === 'string' ? header.trim() : '';
  if (!token.startsWith(TOKEN_PREFIX)) return next(new HttpError(401, 'API token required'));
  const row = platformDb.prepare('SELECT id, account_id, name FROM api_tokens WHERE token_hash = ?').get(hashToken(token)) as
    | { id: number; account_id: number; name: string }
    | undefined;
  if (!row) return next(new HttpError(401, 'Invalid API token'));
  const account = platformDb.prepare('SELECT * FROM accounts WHERE id = ?').get(row.account_id) as AccountRow | undefined;
  if (!account || account.status === 'closed') return next(new HttpError(401, 'Account closed'));
  if (account.status === 'suspended' && req.method !== 'GET') {
    return next(new HttpError(402, 'Account suspended — the trial has ended or the subscription is unpaid.'));
  }
  try {
    rateLimit(account.id, res);
  } catch (e) {
    return next(e);
  }
  // last_used_at is informative: update at most once a minute.
  platformDb.prepare(`UPDATE api_tokens SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < datetime('now','-1 minute'))`).run(nowSql(), row.id);
  req.apiToken = { id: row.id, name: row.name };
  req.account = account;
  runWithTenant(account.id, () => next());
}

const who = (req: Request) => `API: ${req.apiToken?.name ?? '?'}`;

/* ---------------------------------- endpoints ---------------------------------- */

export const restApiRouter = Router();
restApiRouter.use(requireApiToken);

restApiRouter.get('/statuses', (_req, res) => {
  res.json(db.prepare('SELECT id, name, color, group_id, system_key FROM order_statuses ORDER BY sort, id').all());
});

restApiRouter.get('/warehouses', (_req, res) => {
  res.json(db.prepare('SELECT id, name, code, is_default FROM warehouses ORDER BY id').all());
});

/** Orders, newest first. Accepts the same filters as the order list (status_ids, date_from, search, sources...). */
restApiRouter.get('/orders', (req, res) => {
  const f = filtersFromQuery(req.query as Record<string, unknown>);
  f.per_page = Math.min(100, f.per_page ?? 50);
  const idFrom = q.int(req.query.id_from);
  if (idFrom) {
    // Incremental download: orders with id >= id_from, oldest first.
    const ids = (db.prepare('SELECT id FROM orders WHERE id >= ? AND deleted = 0 ORDER BY id LIMIT ?').all(idFrom, f.per_page) as { id: number }[]).map((r) => r.id);
    return void res.json({ total: ids.length, page: 1, per_page: f.per_page, rows: ids.map((id) => getOrderFull(id)) });
  }
  res.json(listOrders(f));
});

restApiRouter.get('/orders/:id', (req, res) => {
  res.json(getOrderFull(idParam(req)));
});

const itemSchema = z.object({
  product_id: z.number().int().positive().optional(),
  name: z.string().min(1).max(500),
  sku: z.string().max(100).optional(),
  ean: z.string().max(50).optional(),
  quantity: z.number().int().positive().max(100000),
  price: z.number().min(0).max(1e7),
  tax_rate: z.number().min(0).max(100).optional(),
});

const str = (max = 200) => z.string().max(max).optional();

restApiRouter.post('/orders', (req, res) => {
  const b = z
    .object({
      external_id: str(100),
      status_id: z.number().int().positive().optional(),
      email: str(),
      phone: str(50),
      user_login: str(),
      currency: z.string().length(3).optional(),
      payment_method: str(),
      payment_cod: z.boolean().optional(),
      paid_amount: z.number().min(0).max(1e8).optional(),
      delivery_method: str(),
      delivery_price: z.number().min(0).max(1e6).optional(),
      delivery_fullname: str(),
      delivery_company: str(),
      delivery_address: str(),
      delivery_postcode: str(20),
      delivery_city: str(),
      delivery_country_code: z.string().length(2).optional(),
      delivery_point_id: str(100),
      delivery_point_name: str(),
      invoice_wanted: z.boolean().optional(),
      invoice_fullname: str(),
      invoice_company: str(),
      invoice_nip: str(30),
      invoice_address: str(),
      invoice_postcode: str(20),
      invoice_city: str(),
      invoice_country_code: z.string().length(2).optional(),
      buyer_comment: str(5000),
      seller_comment: str(5000),
      extra_field_1: str(500),
      extra_field_2: str(500),
      items: z.array(itemSchema).min(1).max(500),
    })
    .strict()
    .parse(req.body);
  if (b.status_id && !db.prepare('SELECT 1 FROM order_statuses WHERE id = ?').get(b.status_id)) throw new HttpError(400, 'Unknown status');
  for (const it of b.items) {
    if (it.product_id && !db.prepare('SELECT 1 FROM products WHERE id = ?').get(it.product_id)) throw new HttpError(400, `Unknown product ${it.product_id}`);
  }
  const id = createOrder({ ...b, source: 'manual' }, who(req));
  res.status(201).json({ id });
});

restApiRouter.put('/orders/:id/status', (req, res) => {
  const id = idParam(req);
  const b = z.object({ status_id: z.number().int().positive() }).parse(req.body);
  getOrderFull(id);
  res.json({ changed: changeStatus(id, b.status_id, who(req)) });
});

restApiRouter.put('/orders/:id/payment', (req, res) => {
  const id = idParam(req);
  const b = z.object({ paid_amount: z.number().min(0).max(1e8) }).parse(req.body);
  getOrderFull(id);
  setPayment(id, b.paid_amount, who(req));
  res.json({ ok: true });
});

/** Products with stock per warehouse. */
restApiRouter.get('/products', (req, res) => {
  const page = Math.max(1, q.int(req.query.page) ?? 1);
  const perPage = Math.min(500, Math.max(1, q.int(req.query.per_page) ?? 100));
  const w = ['1=1'];
  const p: unknown[] = [];
  const search = q.str(req.query.search);
  if (search) {
    w.push('(name LIKE ? OR sku = ? OR ean = ?)');
    p.push(`%${search}%`, search, search);
  }
  const catalog = q.int(req.query.catalog_id);
  if (catalog) {
    w.push('catalog_id = ?');
    p.push(catalog);
  }
  const where = w.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) c FROM products WHERE ${where}`).get(...p) as { c: number }).c;
  const rows = db
    .prepare(
      `SELECT id, parent_id, catalog_id, sku, ean, name, variant_name, price, purchase_price, tax_rate, weight, stock, location, updated_at
       FROM products WHERE ${where} ORDER BY id LIMIT ? OFFSET ?`,
    )
    .all(...p, perPage, (page - 1) * perPage) as any[];
  if (rows.length) {
    const stocks = db
      .prepare(`SELECT product_id, warehouse_id, stock FROM product_stock WHERE product_id IN (${rows.map(() => '?').join(',')})`)
      .all(...rows.map((r) => r.id)) as { product_id: number; warehouse_id: number; stock: number }[];
    for (const r of rows) r.stocks = Object.fromEntries(stocks.filter((s) => s.product_id === r.id).map((s) => [s.warehouse_id, s.stock]));
  }
  res.json({ total, page, per_page: perPage, rows });
});

/** Finds a product by id or SKU; SKU must be unique among products. */
function resolveProduct(ref: { id?: number; sku?: string }): number | string {
  if (ref.id) return db.prepare('SELECT 1 FROM products WHERE id = ?').get(ref.id) ? ref.id : 'product not found';
  if (!ref.sku) return 'id or sku required';
  const rows = db.prepare('SELECT id FROM products WHERE sku = ? LIMIT 2').all(ref.sku) as { id: number }[];
  if (!rows.length) return 'product not found';
  if (rows.length > 1) return 'SKU is not unique, use id';
  return rows[0].id;
}

const refSchema = { id: z.number().int().positive().optional(), sku: z.string().min(1).max(100).optional() };

restApiRouter.put('/products/stock', (req, res) => {
  const b = z
    .object({ products: z.array(z.object({ ...refSchema, stock: z.number().int().min(0).max(10_000_000), warehouse_id: z.number().int().positive().optional() })).min(1).max(1000) })
    .parse(req.body);
  const warehouses = new Set((db.prepare('SELECT id FROM warehouses').all() as { id: number }[]).map((r) => r.id));
  const fallback = defaultWarehouseId();
  const results = b.products.map((it) => {
    const pid = resolveProduct(it);
    if (typeof pid === 'string') return { ...it, ok: false, error: pid };
    const wh = it.warehouse_id ?? fallback;
    if (!warehouses.has(wh)) return { ...it, ok: false, error: 'warehouse not found' };
    if (db.prepare('SELECT 1 FROM products WHERE parent_id = ?').get(pid)) return { ...it, ok: false, error: 'product has variants, update the variants' };
    setStock(pid, it.stock, who(req), wh);
    return { ...it, id: pid, ok: true };
  });
  res.json({ results });
});

restApiRouter.put('/products/prices', (req, res) => {
  const b = z.object({ products: z.array(z.object({ ...refSchema, price: z.number().min(0).max(1e7) })).min(1).max(1000) }).parse(req.body);
  const upd = db.prepare(`UPDATE products SET price = ?, updated_at = datetime('now') WHERE id = ?`);
  const results = b.products.map((it) => {
    const pid = resolveProduct(it);
    if (typeof pid === 'string') return { ...it, ok: false, error: pid };
    upd.run(it.price, pid);
    return { ...it, id: pid, ok: true };
  });
  res.json({ results });
});

restApiRouter.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

/* ------------------------- token management (panel) ------------------------- */

export const apiTokensRouter = Router();
apiTokensRouter.use(requireAccountAdmin);

apiTokensRouter.get('/', (req, res) => {
  const acc = accountAccelerations(req.account!.id);
  res.json({
    limit_per_minute: accelOption('api', acc.api).minutes,
    tokens: platformDb
      .prepare('SELECT id, name, prefix, created_by, created_at, last_used_at FROM api_tokens WHERE account_id = ? ORDER BY id DESC')
      .all(req.account!.id),
  });
});

apiTokensRouter.post('/', (req, res) => {
  if (req.impersonator) throw new HttpError(403, 'Support cannot create API tokens for the client');
  const b = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
  const count = (platformDb.prepare('SELECT COUNT(*) c FROM api_tokens WHERE account_id = ?').get(req.account!.id) as { c: number }).c;
  if (count >= 20) throw new HttpError(400, 'Too many API tokens (max 20)');
  const token = TOKEN_PREFIX + crypto.randomBytes(24).toString('hex');
  platformDb
    .prepare('INSERT INTO api_tokens (account_id, name, token_hash, prefix, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(req.account!.id, b.name, hashToken(token), token.slice(0, 10), req.user!.name);
  // The token is shown only once.
  res.status(201).json({ token });
});

apiTokensRouter.delete('/:id', (req, res) => {
  const r = platformDb.prepare('DELETE FROM api_tokens WHERE id = ? AND account_id = ?').run(idParam(req), req.account!.id);
  if (!r.changes) throw new HttpError(404, 'API token not found');
  if (req.impersonator) audit(req.impersonator.id, req.account!.id, 'api_token.delete', String(req.params.id), req.ip ?? '');
  res.json({ ok: true });
});
