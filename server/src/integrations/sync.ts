import cron from 'node-cron';
import { config } from '../config.js';
import { db, parseJson } from '../db/index.js';
import { notFound } from '../lib/http.js';
import { onEvent } from '../services/events.js';
import { addHistory, changeStatus, createOrder, getOrder, statusIdByKey } from '../services/orders.js';
import { advanceSimulatedTracking } from '../services/shipments.js';
import { onStockChanged } from '../services/stock-events.js';
import { findProduct } from '../services/stock.js';
import { AllegroConnector } from './allegro.js';
import { DemoConnector } from './demo.js';
import { EmpikConnector } from './empik.js';
import { KauflandConnector } from './kaufland.js';
import type { Connector, ConnectorContext, IntegrationRow, IntegrationSettings } from './types.js';

export const DEFAULT_SETTINGS: Record<string, IntegrationSettings> = {
  allegro: { import_days: 7, send_tracking: true, sync_stock: true, sync_price: false, auto_link: true, sync_cancel: true, status_map: {} },
  empik: { import_days: 7, send_tracking: true, sync_stock: true, sync_price: false, auto_link: true, sync_cancel: true, auto_accept: true, status_map: {} },
  kaufland: { import_days: 7, send_tracking: true, sync_stock: true, sync_price: false, auto_link: true, sync_cancel: true, status_map: {} },
};

export function loadIntegration(id: number): IntegrationRow {
  const r = db.prepare('SELECT * FROM integrations WHERE id = ?').get(id) as any;
  if (!r) throw notFound('Integration not found');
  return {
    ...r,
    credentials: parseJson(r.credentials, {}),
    settings: { ...DEFAULT_SETTINGS[r.type], ...parseJson(r.settings, {}) },
    state: parseJson(r.state, {}),
  };
}

export function saveState(id: number, patch: Record<string, unknown>) {
  const r = db.prepare('SELECT state FROM integrations WHERE id = ?').get(id) as { state: string } | undefined;
  if (!r) return;
  db.prepare('UPDATE integrations SET state = ? WHERE id = ?').run(JSON.stringify({ ...parseJson(r.state, {}), ...patch }), id);
}

export function syncLog(integrationId: number, message: string, level: 'info' | 'warn' | 'error' = 'info') {
  db.prepare('INSERT INTO sync_log (integration_id, level, message) VALUES (?, ?, ?)').run(integrationId, level, message.slice(0, 2000));
}

export function connectorFor(integration: IntegrationRow): Connector {
  const ctx: ConnectorContext = {
    integration,
    saveState: (patch) => saveState(integration.id, patch),
    log: (m, level) => syncLog(integration.id, m, level),
  };
  if (integration.demo) return new DemoConnector(ctx, integration.type);
  switch (integration.type) {
    case 'allegro':
      return new AllegroConnector(ctx);
    case 'empik':
      return new EmpikConnector(ctx);
    case 'kaufland':
      return new KauflandConnector(ctx);
  }
}

function notify(message: string, type = 'info', link = '') {
  db.prepare('INSERT INTO notifications (type, message, link) VALUES (?, ?, ?)').run(type, message, link);
}

const running = new Set<number>();

/** Downloads new/updated orders from a marketplace account. */
export async function syncOrders(id: number) {
  if (running.has(id)) return { imported: 0, updated: 0, skipped: true };
  running.add(id);
  const integration = loadIntegration(id);
  let imported = 0;
  let updated = 0;
  try {
    const st = integration.state;
    const days = Number(integration.settings.import_days ?? 7);
    const since: string =
      st.orders_cursor ?? new Date(Date.now() - days * 86400_000).toISOString().replace('T', ' ').slice(0, 19);
    const started = new Date(Date.now() - 2 * 60_000).toISOString().replace('T', ' ').slice(0, 19);
    const orders = await connectorFor(integration).fetchOrders(since);
    const importStatus = integration.settings.import_status_id ?? statusIdByKey('new');
    for (const mo of orders) {
      const existing = db
        .prepare('SELECT id, status_id, paid_amount, external_status FROM orders WHERE integration_id = ? AND external_id = ?')
        .get(id, mo.external_id) as { id: number; status_id: number; paid_amount: number; external_status: string } | undefined;
      if (existing) {
        const patch: string[] = [];
        if (mo.external_status && mo.external_status !== existing.external_status) {
          db.prepare(`UPDATE orders SET external_status = ?, external_data = ?, updated_at = datetime('now') WHERE id = ?`).run(
            mo.external_status,
            JSON.stringify(mo.external_data ?? {}),
            existing.id,
          );
          patch.push(`marketplace status: ${mo.external_status}`);
        }
        if (typeof mo.paid_amount === 'number' && mo.paid_amount > existing.paid_amount) {
          db.prepare(`UPDATE orders SET paid_amount = ?, payment_date = COALESCE(payment_date, datetime('now')) WHERE id = ?`).run(
            mo.paid_amount,
            existing.id,
          );
          patch.push(`paid ${mo.paid_amount}`);
        }
        if (mo.canceled && integration.settings.sync_cancel) {
          const canceled = statusIdByKey('canceled');
          if (existing.status_id !== canceled) {
            changeStatus(existing.id, canceled, integration.name);
            patch.push('canceled by marketplace');
          }
        }
        if (patch.length) {
          addHistory(existing.id, `Updated from ${integration.name}: ${patch.join(', ')}`, 'sync', integration.name);
          updated++;
        }
        continue;
      }
      if (mo.importable === false || mo.canceled) continue;
      const { canceled: _c, importable: _i, ...input } = mo;
      createOrder({ ...input, integration_id: id, status_id: importStatus }, integration.name);
      imported++;
    }
    saveState(id, { orders_cursor: started });
    db.prepare(`UPDATE integrations SET last_sync_at = datetime('now'), last_error = NULL WHERE id = ?`).run(id);
    if (imported || updated) syncLog(id, `Orders: ${imported} imported, ${updated} updated`);
    if (imported) notify(`${integration.name}: ${imported} new order(s)`, 'order', '/orders');
    return { imported, updated };
  } catch (e: any) {
    db.prepare(`UPDATE integrations SET last_sync_at = datetime('now'), last_error = ? WHERE id = ?`).run(e.message, id);
    syncLog(id, `Order sync failed: ${e.message}`, 'error');
    throw e;
  } finally {
    running.delete(id);
  }
}

/** Downloads the list of offers and links them with inventory products. */
export async function syncOffers(id: number) {
  const integration = loadIntegration(id);
  try {
    const offers = await connectorFor(integration).fetchOffers();
    const upsert = db.prepare(
      `INSERT INTO offers (integration_id, external_id, title, sku, ean, price, currency, stock, status, url, image, product_id, raw, last_synced_at)
       VALUES (@integration_id, @external_id, @title, @sku, @ean, @price, @currency, @stock, @status, @url, @image, @product_id, @raw, datetime('now'))
       ON CONFLICT(integration_id, external_id) DO UPDATE SET title = excluded.title, sku = excluded.sku,
         ean = CASE WHEN excluded.ean != '' THEN excluded.ean ELSE offers.ean END, price = excluded.price, currency = excluded.currency,
         stock = excluded.stock, status = excluded.status, url = excluded.url, image = excluded.image, raw = excluded.raw,
         product_id = COALESCE(offers.product_id, excluded.product_id), last_synced_at = datetime('now')`,
    );
    let linked = 0;
    db.transaction(() => {
      for (const o of offers) {
        const p = integration.settings.auto_link ? findProduct(o.sku, o.ean) : undefined;
        if (p) linked++;
        upsert.run({ ...o, integration_id: id, product_id: p?.id ?? null, raw: JSON.stringify(o.raw ?? {}) });
      }
    })();
    syncLog(id, `Offers: ${offers.length} downloaded, ${linked} matched with inventory`);
    return { count: offers.length, linked };
  } catch (e: any) {
    syncLog(id, `Offer sync failed: ${e.message}`, 'error');
    throw e;
  }
}

/** Pushes stock (and optionally price) of linked offers to the marketplace. */
export async function pushOffers(productIds: number[] | null, opts: { offerIds?: number[]; force?: boolean } = {}) {
  let rows: any[];
  if (opts.offerIds?.length) {
    rows = db.prepare(`SELECT * FROM offers WHERE id IN (${opts.offerIds.map(() => '?').join(',')}) AND product_id IS NOT NULL`).all(...opts.offerIds);
  } else if (productIds?.length) {
    rows = db.prepare(`SELECT * FROM offers WHERE product_id IN (${productIds.map(() => '?').join(',')})`).all(...productIds);
  } else rows = db.prepare('SELECT * FROM offers WHERE product_id IS NOT NULL').all();
  const results = { updated: 0, failed: 0 };
  for (const off of rows) {
    const integration = loadIntegration(off.integration_id);
    if (!integration.enabled) continue;
    const p = db.prepare('SELECT stock, price FROM products WHERE id = ?').get(off.product_id) as { stock: number; price: number } | undefined;
    if (!p) continue;
    const change: { stock?: number; price?: number } = {};
    if (integration.settings.sync_stock && off.sync_stock && (opts.force || p.stock !== off.stock)) change.stock = Math.max(0, p.stock);
    if (integration.settings.sync_price && off.sync_price && (opts.force || Math.abs(p.price - off.price) > 0.001)) change.price = p.price;
    if (change.stock === undefined && change.price === undefined) continue;
    // Mirakl (Empik) needs both values in one update.
    if (integration.type === 'empik') {
      change.stock ??= off.stock;
      change.price ??= off.price;
    }
    try {
      await connectorFor(integration).updateOffer({ ...off, raw: parseJson(off.raw, {}) }, change);
      db.prepare(`UPDATE offers SET stock = COALESCE(?, stock), price = COALESCE(?, price), last_synced_at = datetime('now') WHERE id = ?`).run(
        change.stock ?? null,
        change.price ?? null,
        off.id,
      );
      results.updated++;
    } catch (e: any) {
      results.failed++;
      syncLog(off.integration_id, `Offer ${off.external_id} update failed: ${e.message}`, 'error');
    }
  }
  return results;
}

function orderForConnector(orderId: number) {
  const o = getOrder(orderId);
  const items = db.prepare('SELECT external_line_id FROM order_items WHERE order_id = ?').all(orderId) as { external_line_id: string }[];
  return { external_id: o.external_id ?? '', external_data: parseJson(o.external_data, {}), items };
}

/** Sends the tracking number of a shipment to the order's marketplace. */
export async function sendTrackingToSource(shipmentId: number) {
  const s = db.prepare('SELECT * FROM shipments WHERE id = ?').get(shipmentId) as any;
  if (!s) throw notFound('Shipment not found');
  const o = getOrder(s.order_id);
  if (!o.integration_id || !o.external_id) throw new Error('Order does not come from a marketplace');
  const integration = loadIntegration(o.integration_id);
  await connectorFor(integration).sendTracking(orderForConnector(o.id), { courier: s.courier, tracking_number: s.tracking_number });
  db.prepare(`UPDATE shipments SET sent_to_source = 1, sent_to_source_at = datetime('now') WHERE id = ?`).run(shipmentId);
  addHistory(o.id, `Tracking number ${s.tracking_number} sent to ${integration.name}`, 'sync', 'System');
}

export function registerSyncListeners() {
  onEvent(async (event, payload) => {
    if (event === 'status_changed') {
      const o = getOrder(payload.orderId);
      if (!o.integration_id || !o.external_id) return;
      const integration = loadIntegration(o.integration_id);
      if (!integration.enabled) return;
      const code = integration.settings.status_map?.[String(payload.toStatusId)];
      if (!code) return;
      try {
        await connectorFor(integration).setOrderStatus(orderForConnector(o.id), code);
        addHistory(o.id, `Status "${code}" sent to ${integration.name}`, 'sync', 'System');
      } catch (e: any) {
        addHistory(o.id, `Sending status "${code}" to ${integration.name} failed: ${e.message}`, 'error', 'System');
        syncLog(integration.id, `Order ${o.external_id}: status ${code} failed: ${e.message}`, 'error');
      }
    }
    if (event === 'shipment_created') {
      const o = getOrder(payload.orderId);
      if (!o.integration_id || !o.external_id) return;
      const integration = loadIntegration(o.integration_id);
      if (!integration.enabled || !integration.settings.send_tracking) return;
      try {
        await sendTrackingToSource(Number(payload.shipmentId));
      } catch (e: any) {
        addHistory(o.id, `Sending tracking number to ${integration.name} failed: ${e.message}`, 'error', 'System');
      }
    }
  });
  onStockChanged((ids) => {
    pushOffers(ids).catch((e) => console.error('[sync] stock push failed', e));
  });
}

export async function syncAll() {
  const rows = db.prepare('SELECT id FROM integrations WHERE enabled = 1').all() as { id: number }[];
  for (const r of rows) {
    try {
      await syncOrders(r.id);
    } catch {
      /* logged in syncOrders */
    }
  }
  advanceSimulatedTracking();
}

export function startScheduler() {
  if (config.disableScheduler) return;
  cron.schedule(config.syncCron, () => {
    syncAll().catch((e) => console.error('[sync] failed', e));
  });
  // Offers are refreshed less often.
  cron.schedule('17 * * * *', async () => {
    const rows = db.prepare('SELECT id FROM integrations WHERE enabled = 1').all() as { id: number }[];
    for (const r of rows) await syncOffers(r.id).catch(() => undefined);
  });
}
