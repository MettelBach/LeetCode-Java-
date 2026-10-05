import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.DISABLE_SCHEDULER = '1';
process.env.PASSWORD_BREACH_CHECK = '0';
process.env.ADMIN_EMAIL = 'admin@test.pl';
process.env.ADMIN_PASSWORD = 'Panel-Admin-2026';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sellhub-int-'));
process.env.DATA_DIR = dir;

let base = '';
let close: () => void;

async function call(method: string, url: string, body?: unknown, token?: string) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* binary */
  }
  return { status: res.status, data, headers: res.headers };
}

beforeAll(async () => {
  const { initPlatform } = await import('./db/index.js');
  const { createApp } = await import('./app.js');
  const { registerAutomation } = await import('./services/automation.js');
  const { registerSyncListeners } = await import('./integrations/sync.js');
  const { ensureBootstrapAdmin } = await import('./services/platform.js');
  initPlatform(dir);
  ensureBootstrapAdmin();
  registerAutomation();
  registerSyncListeners();
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  close = () => server.close();
});

afterAll(() => {
  close?.();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('Integrations', () => {
  let t = '';
  let t2 = '';
  const api = (m: string, u: string, b?: unknown, tok = t) => call(m, u, b, tok);

  it('catalog lists categories and only connectable types can be added', async () => {
    t = (await call('POST', '/auth/register', { company: 'Int A', name: 'Ala', email: 'int-a@x.pl', password: 'Kubek-Zielony-17', accept_terms: true })).data.token;
    t2 = (await call('POST', '/auth/register', { company: 'Int B', name: 'Bob', email: 'int-b@x.pl', password: 'Kubek-Zielony-17', accept_terms: true })).data.token;
    const cat = (await api('GET', '/integrations/catalog')).data;
    const cats = new Set(cat.map((d: any) => d.category));
    expect(cats.has('courier')).toBe(true);
    expect(cats.has('shop')).toBe(true);
    expect(cat.find((d: any) => d.type === 'olx').status).toBe('beta');
    expect((await api('POST', '/integrations', { type: 'amazon', name: 'Amazon' })).status).toBe(400);
  });

  it('validates settings references and reports authorization correctly', async () => {
    const id = (await api('POST', '/integrations', { type: 'empik', name: 'Empik live' })).data.id;
    const one = (await api('GET', `/integrations/${id}`)).data;
    expect(one.authorized).toBe(false);
    expect((await api('PUT', `/integrations/${id}`, { settings: { import_status_id: 999 } })).status).toBe(400);
    expect((await api('PUT', `/integrations/${id}`, { settings: { warehouse_id: 999 } })).status).toBe(400);
    expect((await api('PUT', `/integrations/${id}`, { settings: { status_map: { '999': 'ship' } } })).status).toBe(400);
    expect((await api('POST', '/integrations/777/sync-orders')).status).toBe(404);
  });

  it('a sync lock in one account does not block another account', async () => {
    const a = (await api('POST', '/integrations', { type: 'allegro', name: 'Allegro demo', demo: true })).data.id;
    const b = (await api('POST', '/integrations', { type: 'allegro', name: 'Allegro demo', demo: true }, t2)).data.id;
    const [ra, rb] = await Promise.all([api('POST', `/integrations/${a}/sync-orders`), api('POST', `/integrations/${b}/sync-orders`, undefined, t2)]);
    expect(ra.data.skipped).toBeUndefined();
    expect(rb.data.skipped).toBeUndefined();
    expect(rb.data.imported).toBeGreaterThan(0);
  });

  it('test tracking numbers are never sent to a live marketplace', async () => {
    // Live (non-demo) integration with an order imported through a demo account is not possible here,
    // so the rule is checked through the API of a demo-imported order switched to live mode.
    const integ = (await api('GET', '/integrations')).data.find((i: any) => i.type === 'allegro');
    const orders = (await api('GET', `/orders?per_page=1`)).data.rows;
    await api('PUT', `/integrations/${integ.id}`, { demo: false });
    const sh = await api('POST', `/orders/${orders[0].id}/shipments`, { courier: 'inpost' });
    expect(sh.status).toBe(200);
    const card = (await api('GET', `/orders/${orders[0].id}`)).data;
    expect(card.shipments[0].simulated).toBe(1);
    expect(card.shipments[0].sent_to_source).toBe(0);
    expect(card.history.some((h: any) => /test number/.test(h.message))).toBe(true);
    await api('PUT', `/integrations/${integ.id}`, { demo: true });
  });

  it('a manually unlinked offer stays unlinked after synchronization', async () => {
    const integ = (await api('GET', '/integrations')).data.find((i: any) => i.type === 'allegro');
    // Products to link with.
    await api('POST', '/products', { name: 'Głośnik', sku: 'BT-SPK-001' });
    await api('POST', `/integrations/${integ.id}/sync-offers`);
    const offer = (await api('GET', `/offers?search=BT-SPK-001`)).data.rows[0];
    expect(offer.product_id).toBeTruthy();
    await api('PUT', `/offers/${offer.id}`, { product_id: null });
    await api('POST', `/integrations/${integ.id}/sync-offers`);
    expect((await api('GET', `/offers?search=BT-SPK-001`)).data.rows[0].product_id).toBeNull();
  });

  it('OLX demo account: adverts are downloaded, no orders, authorization link needs keys', async () => {
    const id = (await api('POST', '/integrations', { type: 'olx', name: 'OLX demo', demo: true })).data.id;
    const offers = await api('POST', `/integrations/${id}/sync-offers`);
    expect(offers.data.count).toBe(5);
    expect((await api('POST', `/integrations/${id}/sync-orders`)).data.imported).toBe(0);
    const live = (await api('POST', '/integrations', { type: 'olx', name: 'OLX', credentials: { client_id: 'cid' } })).data.id;
    expect((await api('POST', `/integrations/${live}/olx/authorize`)).status).toBe(400);
    await api('PUT', `/integrations/${live}`, { credentials: { client_secret: 'sec' } });
    const auth = await api('POST', `/integrations/${live}/olx/authorize`);
    expect(auth.data.url).toContain('https://www.olx.pl/oauth/authorize/?client_id=cid');
    const state = new URL(auth.data.url).searchParams.get('state');
    // A wrong state is refused; the right one with "access denied" goes back to settings.
    expect((await fetch(base + '/public/oauth/olx/callback?state=bad&code=x', { redirect: 'manual' })).status).toBe(400);
    const back = await fetch(base + `/public/oauth/olx/callback?state=${state}&error=access_denied`, { redirect: 'manual' });
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toContain(`/integrations/${live}?oauth=denied`);
  });
});
