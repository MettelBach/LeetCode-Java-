import { Router } from 'express';
import { z } from 'zod';
import { db, parseJson } from '../db/index.js';
import { HttpError, idParam, q } from '../lib/http.js';
import { openJson, sealJson } from '../lib/secrets.js';
import { pollDeviceToken, startDeviceAuth } from '../integrations/allegro.js';
import { EMPIK_DEFAULT_URL, empikBaseUrl } from '../integrations/empik.js';
import {
  connectorFor,
  DEFAULT_SETTINGS,
  loadIntegration,
  pushOffers,
  saveState,
  sendTrackingToSource,
  syncLog,
  syncOffers,
  syncOrders,
} from '../integrations/sync.js';
import { STATUS_CODES } from '../integrations/types.js';
import { planById } from '../services/platform.js';
import { requireAdmin, userName } from './auth.js';

export const integrationsRouter = Router();

/** Never send secrets back to the browser — only whether they are set. */
function publicView(row: any) {
  const creds = openJson<Record<string, any>>(row.credentials, {});
  const state = openJson<Record<string, any>>(row.state, {});
  const masked: Record<string, any> = {};
  for (const [k, v] of Object.entries(creds)) {
    masked[k] = /secret|key|password|token/i.test(k) ? (v ? '••••••••' : '') : v;
  }
  const stats = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM orders WHERE integration_id = ?) orders,
              (SELECT COUNT(*) FROM orders WHERE integration_id = ? AND date_add >= datetime('now','-30 days')) orders_30d,
              (SELECT COUNT(*) FROM offers WHERE integration_id = ?) offers,
              (SELECT COUNT(*) FROM offers WHERE integration_id = ? AND product_id IS NOT NULL) offers_linked`,
    )
    .get(row.id, row.id, row.id, row.id);
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    enabled: !!row.enabled,
    demo: !!row.demo,
    credentials: masked,
    settings: { ...DEFAULT_SETTINGS[row.type], ...parseJson(row.settings, {}) },
    authorized: row.type !== 'allegro' || !!row.demo || !!state.refresh_token,
    auth_pending: state.device_auth ? { user_code: state.device_auth.user_code, url: state.device_auth.verification_uri_complete } : null,
    last_sync_at: row.last_sync_at,
    last_error: row.last_error,
    created_at: row.created_at,
    stats,
  };
}

integrationsRouter.get('/meta', (_req, res) => {
  res.json({ status_codes: STATUS_CODES, defaults: DEFAULT_SETTINGS, empik_default_url: EMPIK_DEFAULT_URL });
});

integrationsRouter.get('/', (_req, res) => {
  res.json((db.prepare('SELECT * FROM integrations ORDER BY type, id').all() as any[]).map(publicView));
});

integrationsRouter.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM integrations WHERE id = ?').get(idParam(req));
  if (!row) throw new HttpError(404, 'Integration not found');
  res.json(publicView(row));
});

const credSchema = z.record(z.string(), z.union([z.string().max(2000), z.boolean()]));

/** Rejects API addresses outside the marketplace's own domains. */
function checkCredentials(creds?: Record<string, any>) {
  if (typeof creds?.base_url !== 'string') return;
  try {
    empikBaseUrl(creds.base_url);
  } catch (e: any) {
    throw new HttpError(400, e.message);
  }
}
const settingsSchema = z
  .object({
    import_status_id: z.number().int().nullable(),
    import_days: z.number().int().min(1).max(90),
    status_map: z.record(z.string(), z.string()),
    send_tracking: z.boolean(),
    sync_stock: z.boolean(),
    sync_price: z.boolean(),
    auto_link: z.boolean(),
    auto_accept: z.boolean(),
    sync_cancel: z.boolean(),
    warehouse_id: z.number().int().nullable(),
    stock_warehouse_ids: z.array(z.number().int()),
    catalog_id: z.number().int().nullable(),
  })
  .partial();

integrationsRouter.post('/', requireAdmin, (req, res) => {
  const plan = planById(req.account!.plan);
  const count = (db.prepare('SELECT COUNT(*) c FROM integrations').get() as { c: number }).c;
  if (count >= plan.integrations) throw new HttpError(402, `Your plan allows ${plan.integrations} integration(s). Upgrade the plan to add more.`);
  const b = z
    .object({
      type: z.enum(['allegro', 'empik', 'kaufland']),
      name: z.string().min(1).max(100),
      demo: z.boolean().optional(),
      credentials: credSchema.optional(),
      settings: settingsSchema.optional(),
    })
    .parse(req.body);
  checkCredentials(b.credentials);
  const r = db
    .prepare('INSERT INTO integrations (type, name, demo, credentials, settings) VALUES (?, ?, ?, ?, ?)')
    .run(b.type, b.name, b.demo ? 1 : 0, sealJson(b.credentials ?? {}), JSON.stringify({ ...DEFAULT_SETTINGS[b.type], ...(b.settings ?? {}) }));
  res.json({ id: Number(r.lastInsertRowid) });
});

integrationsRouter.put('/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  const b = z
    .object({
      name: z.string().min(1).max(100).optional(),
      enabled: z.boolean().optional(),
      demo: z.boolean().optional(),
      credentials: credSchema.optional(),
      settings: settingsSchema.optional(),
    })
    .parse(req.body);
  const row = db.prepare('SELECT * FROM integrations WHERE id = ?').get(id) as any;
  if (!row) throw new HttpError(404, 'Integration not found');
  const creds = openJson<Record<string, any>>(row.credentials, {});
  if (b.credentials) {
    for (const [k, v] of Object.entries(b.credentials)) {
      // Masked values mean "unchanged".
      if (v === '••••••••') continue;
      creds[k] = v;
    }
  }
  checkCredentials(creds);
  const settings = { ...parseJson(row.settings, {}), ...(b.settings ?? {}) };
  db.prepare('UPDATE integrations SET name = ?, enabled = ?, demo = ?, credentials = ?, settings = ? WHERE id = ?').run(
    b.name ?? row.name,
    b.enabled === undefined ? row.enabled : b.enabled ? 1 : 0,
    b.demo === undefined ? row.demo : b.demo ? 1 : 0,
    sealJson(creds),
    JSON.stringify(settings),
    id,
  );
  // Changing the account credentials invalidates the Allegro tokens.
  if (row.type === 'allegro' && b.credentials) {
    const old = openJson<any>(row.credentials, {});
    const changed = (k: string) => b.credentials![k] !== undefined && b.credentials![k] !== '••••••••' && b.credentials![k] !== old[k];
    if (changed('client_id') || changed('sandbox')) saveState(id, { access_token: null, refresh_token: null, expires_at: null });
  }
  res.json({ ok: true });
});

integrationsRouter.delete('/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  db.prepare('UPDATE orders SET integration_id = NULL WHERE integration_id = ?').run(id);
  db.prepare('DELETE FROM integrations WHERE id = ?').run(id);
  res.json({ ok: true });
});

integrationsRouter.post('/:id/test', async (req, res) => {
  const integration = loadIntegration(idParam(req));
  try {
    res.json({ ok: true, message: await connectorFor(integration).test() });
  } catch (e: any) {
    res.json({ ok: false, message: e.message });
  }
});

integrationsRouter.post('/:id/sync-orders', async (req, res) => {
  try {
    res.json(await syncOrders(idParam(req)));
  } catch (e: any) {
    throw new HttpError(502, e.message);
  }
});

integrationsRouter.post('/:id/sync-offers', async (req, res) => {
  try {
    res.json(await syncOffers(idParam(req)));
  } catch (e: any) {
    throw new HttpError(502, e.message);
  }
});

integrationsRouter.post('/:id/reset-cursor', requireAdmin, (req, res) => {
  const b = z.object({ days: z.number().int().min(1).max(90) }).parse(req.body);
  const id = idParam(req);
  saveState(id, { orders_cursor: new Date(Date.now() - b.days * 86400_000).toISOString().replace('T', ' ').slice(0, 19) });
  res.json({ ok: true });
});

integrationsRouter.get('/:id/log', (req, res) => {
  res.json(db.prepare('SELECT * FROM sync_log WHERE integration_id = ? ORDER BY id DESC LIMIT 200').all(idParam(req)));
});

/* --------------------------- Allegro OAuth (device flow) --------------------------- */

integrationsRouter.post('/:id/allegro/auth/start', requireAdmin, async (req, res) => {
  const integration = loadIntegration(idParam(req));
  if (integration.type !== 'allegro') throw new HttpError(400, 'Not an Allegro integration');
  const c = integration.credentials;
  if (!c.client_id || !c.client_secret) throw new HttpError(400, 'Enter Client ID and Client Secret first');
  try {
    const d = await startDeviceAuth({ client_id: c.client_id, client_secret: c.client_secret, sandbox: !!c.sandbox });
    saveState(integration.id, { device_auth: { ...d, started_at: Date.now() } });
    res.json({ user_code: d.user_code, url: d.verification_uri_complete, interval: d.interval, expires_in: d.expires_in });
  } catch (e: any) {
    throw new HttpError(502, `Allegro: ${e.message}`);
  }
});

integrationsRouter.post('/:id/allegro/auth/poll', requireAdmin, async (req, res) => {
  const integration = loadIntegration(idParam(req));
  const d = integration.state.device_auth;
  if (!d) throw new HttpError(400, 'Authorization was not started');
  if (Date.now() > d.started_at + d.expires_in * 1000) {
    saveState(integration.id, { device_auth: null });
    throw new HttpError(410, 'Authorization code expired — start again');
  }
  try {
    const t = await pollDeviceToken(integration.credentials as any, d.device_code);
    if (!t) {
      res.json({ authorized: false });
      return;
    }
    saveState(integration.id, { ...t, device_auth: null });
    syncLog(integration.id, 'Allegro account authorized');
    res.json({ authorized: true });
  } catch (e: any) {
    saveState(integration.id, { device_auth: null });
    throw new HttpError(502, `Allegro: ${e.message}`);
  }
});

/* ---------------------------------- offers ---------------------------------- */

export const offersRouter = Router();

offersRouter.get('/', (req, res) => {
  const w: string[] = ['1=1'];
  const p: unknown[] = [];
  const integration = q.int(req.query.integration_id);
  const search = q.str(req.query.search);
  const linked = q.str(req.query.linked);
  if (integration) {
    w.push('o.integration_id = ?');
    p.push(integration);
  }
  if (search) {
    const like = `%${search}%`;
    w.push('(o.title LIKE ? OR o.sku LIKE ? OR o.ean LIKE ? OR o.external_id = ?)');
    p.push(like, like, like, search);
  }
  if (linked === 'yes') w.push('o.product_id IS NOT NULL');
  if (linked === 'no') w.push('o.product_id IS NULL');
  if (q.str(req.query.status)) {
    w.push('o.status = ?');
    p.push(q.str(req.query.status));
  }
  const page = Math.max(1, q.int(req.query.page) ?? 1);
  const perPage = Math.min(500, Math.max(1, q.int(req.query.per_page) ?? 50));
  const where = w.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) c FROM offers o WHERE ${where}`).get(...p) as { c: number }).c;
  const rows = db
    .prepare(
      `SELECT o.*, i.name integration_name, i.type integration_type, pr.name product_name, pr.stock product_stock, pr.price product_price, pr.sku product_sku
       FROM offers o JOIN integrations i ON i.id = o.integration_id LEFT JOIN products pr ON pr.id = o.product_id
       WHERE ${where} ORDER BY o.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...p, perPage, (page - 1) * perPage);
  res.json({ total, page, per_page: perPage, rows });
});

offersRouter.put('/:id', (req, res) => {
  const id = idParam(req);
  const b = z
    .object({ product_id: z.number().int().nullable().optional(), sync_stock: z.boolean().optional(), sync_price: z.boolean().optional() })
    .parse(req.body);
  const cur = db.prepare('SELECT * FROM offers WHERE id = ?').get(id) as any;
  if (!cur) throw new HttpError(404, 'Offer not found');
  if (b.product_id && !db.prepare('SELECT 1 FROM products WHERE id = ?').get(b.product_id)) throw new HttpError(400, 'Product not found');
  db.prepare('UPDATE offers SET product_id = ?, sync_stock = ?, sync_price = ? WHERE id = ?').run(
    b.product_id !== undefined ? b.product_id : cur.product_id,
    b.sync_stock === undefined ? cur.sync_stock : b.sync_stock ? 1 : 0,
    b.sync_price === undefined ? cur.sync_price : b.sync_price ? 1 : 0,
    id,
  );
  res.json({ ok: true });
});

/** Creates inventory products from unlinked offers (BaseLinker "import offers to inventory"). */
offersRouter.post('/to-inventory', (req, res) => {
  const b = z.object({ ids: z.array(z.number().int()).min(1).max(5000) }).parse(req.body);
  let created = 0;
  db.transaction(() => {
    for (const id of b.ids) {
      const o = db.prepare('SELECT * FROM offers WHERE id = ? AND product_id IS NULL').get(id) as any;
      if (!o) continue;
      const existing = o.sku ? (db.prepare('SELECT id FROM products WHERE sku = ?').get(o.sku) as any) : null;
      let pid = existing?.id;
      if (!pid) {
        pid = Number(
          db
            .prepare('INSERT INTO products (sku, ean, name, price, stock, images) VALUES (?, ?, ?, ?, ?, ?)')
            .run(o.sku, o.ean, o.title, o.price, o.stock, JSON.stringify(o.image ? [o.image] : [])).lastInsertRowid,
        );
        db.prepare(`INSERT INTO stock_history (product_id, change, stock_after, reason) VALUES (?, ?, ?, 'offer import')`).run(pid, o.stock, o.stock);
        created++;
      }
      db.prepare('UPDATE offers SET product_id = ? WHERE id = ?').run(pid, id);
    }
  })();
  res.json({ created });
});

offersRouter.post('/push', async (req, res) => {
  const b = z.object({ ids: z.array(z.number().int()).optional() }).parse(req.body);
  res.json(await pushOffers(null, { offerIds: b.ids, force: true }));
});

offersRouter.post('/:id/update', async (req, res) => {
  // Manual edit of a single offer's stock/price directly on the marketplace.
  const id = idParam(req);
  const b = z.object({ stock: z.number().int().min(0).optional(), price: z.number().min(0.01).optional() }).parse(req.body);
  const off = db.prepare('SELECT * FROM offers WHERE id = ?').get(id) as any;
  if (!off) throw new HttpError(404, 'Offer not found');
  const integration = loadIntegration(off.integration_id);
  const change = { ...b };
  if (integration.type === 'empik') {
    change.stock ??= off.stock;
    change.price ??= off.price;
  }
  try {
    await connectorFor(integration).updateOffer({ ...off, raw: parseJson(off.raw, {}) }, change);
  } catch (e: any) {
    throw new HttpError(502, e.message);
  }
  db.prepare(`UPDATE offers SET stock = COALESCE(?, stock), price = COALESCE(?, price), last_synced_at = datetime('now') WHERE id = ?`).run(
    change.stock ?? null,
    change.price ?? null,
    id,
  );
  res.json({ ok: true });
});

/* -------------------------------- offer manager -------------------------------- */

offersRouter.get('/listing-options/:integrationId', async (req, res) => {
  const integration = loadIntegration(idParam(req, 'integrationId'));
  try {
    res.json(await connectorFor(integration).listingOptions());
  } catch (e: any) {
    throw new HttpError(502, e.message);
  }
});

/** Lists inventory products on a marketplace account ("Wystaw oferty"). */
offersRouter.post('/list', async (req, res) => {
  const b = z
    .object({
      integration_id: z.number().int(),
      product_ids: z.array(z.number().int()).min(1).max(500),
      price_markup: z.number().min(-90).max(500).optional(),
      shipping_rates_id: z.string().max(100).optional(),
      category_id: z.string().max(50).optional(),
      handling_time: z.number().int().min(0).max(60).optional(),
      title_template: z.string().max(200).optional(),
    })
    .parse(req.body);
  const integration = loadIntegration(b.integration_id);
  if (!integration.enabled) throw new HttpError(400, 'Integration is disabled');
  const connector = connectorFor(integration);
  const results: { product_id: number; ok: boolean; offer_id?: string; error?: string }[] = [];
  for (const pid of b.product_ids) {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(pid) as any;
    if (!p) {
      results.push({ product_id: pid, ok: false, error: 'Product not found' });
      continue;
    }
    if (db.prepare('SELECT 1 FROM products WHERE parent_id = ?').get(pid)) {
      results.push({ product_id: pid, ok: false, error: 'Product has variants — list the variants' });
      continue;
    }
    const existing = db.prepare(`SELECT external_id FROM offers WHERE integration_id = ? AND product_id = ? AND status != 'ended'`).get(b.integration_id, pid) as any;
    if (existing) {
      results.push({ product_id: pid, ok: false, error: `Already listed (${existing.external_id})` });
      continue;
    }
    const price = Math.round(p.price * (1 + (b.price_markup ?? 0) / 100) * 100) / 100;
    const title = (b.title_template || '{name}').replace('{name}', p.name).replace('{sku}', p.sku).slice(0, 200);
    try {
      const o = await connector.createOffer({
        sku: p.sku,
        ean: p.ean,
        title,
        description: p.description,
        price,
        currency: 'PLN',
        stock: Math.max(0, p.stock),
        images: parseJson<string[]>(p.images, []),
        category_id: b.category_id,
        shipping_rates_id: b.shipping_rates_id,
        handling_time: b.handling_time,
      });
      db.prepare(
        `INSERT INTO offers (integration_id, external_id, title, sku, ean, price, currency, stock, status, url, image, product_id, raw, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(integration_id, external_id) DO UPDATE SET product_id = excluded.product_id, status = excluded.status`,
      ).run(b.integration_id, o.external_id, o.title, o.sku, o.ean, o.price, o.currency, o.stock, o.status, o.url, o.image, pid, JSON.stringify(o.raw ?? {}));
      results.push({ product_id: pid, ok: true, offer_id: o.external_id });
    } catch (e: any) {
      results.push({ product_id: pid, ok: false, error: e.message });
    }
  }
  syncLog(b.integration_id, `Listing by ${userName(req)}: ${results.filter((r) => r.ok).length} created, ${results.filter((r) => !r.ok).length} failed`);
  res.json({ results });
});

async function setActive(id: number, active: boolean) {
  const off = db.prepare('SELECT * FROM offers WHERE id = ?').get(id) as any;
  if (!off) throw new HttpError(404, 'Offer not found');
  const integration = loadIntegration(off.integration_id);
  await connectorFor(integration).setOfferActive({ ...off, raw: parseJson(off.raw, {}) }, active);
  db.prepare(`UPDATE offers SET status = ?, last_synced_at = datetime('now') WHERE id = ?`).run(active ? 'active' : 'ended', id);
}

offersRouter.post('/bulk-status', async (req, res) => {
  const b = z.object({ ids: z.array(z.number().int()).min(1).max(1000), active: z.boolean() }).parse(req.body);
  const errors: { id: number; error: string }[] = [];
  for (const id of b.ids) {
    try {
      await setActive(id, b.active);
    } catch (e: any) {
      errors.push({ id, error: e.message });
    }
  }
  res.json({ ok: b.ids.length - errors.length, errors });
});

offersRouter.post('/bulk-price', async (req, res) => {
  // Changes prices of offers by a percentage directly on the marketplace.
  const b = z.object({ ids: z.array(z.number().int()).min(1).max(1000), percent: z.number().min(-90).max(500) }).parse(req.body);
  const errors: { id: number; error: string }[] = [];
  for (const id of b.ids) {
    const off = db.prepare('SELECT * FROM offers WHERE id = ?').get(id) as any;
    if (!off) continue;
    const price = Math.round(off.price * (1 + b.percent / 100) * 100) / 100;
    try {
      const integration = loadIntegration(off.integration_id);
      await connectorFor(integration).updateOffer({ ...off, raw: parseJson(off.raw, {}) }, integration.type === 'empik' ? { price, stock: off.stock } : { price });
      db.prepare(`UPDATE offers SET price = ?, last_synced_at = datetime('now') WHERE id = ?`).run(price, id);
    } catch (e: any) {
      errors.push({ id, error: e.message });
    }
  }
  res.json({ ok: b.ids.length - errors.length, errors });
});

export { sendTrackingToSource };
