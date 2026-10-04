import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.DISABLE_SCHEDULER = '1';
process.env.ADMIN_EMAIL = 'admin@test.pl';
process.env.ADMIN_PASSWORD = 'adminpass123';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sellhub-test-'));
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

describe('SaaS flow', () => {
  let tokenA = '';
  let tokenB = '';
  let orderId = 0;
  let productId = 0;

  it('registers two isolated accounts', async () => {
    const a = await call('POST', '/auth/register', { company: 'Sklep A', name: 'Anna', email: 'a@a.pl', password: 'password1', accept_terms: true });
    expect(a.status).toBe(200);
    tokenA = a.data.token;
    const b = await call('POST', '/auth/register', { company: 'Sklep B', name: 'Bartek', email: 'b@b.pl', password: 'password2', accept_terms: true });
    tokenB = b.data.token;
    const dup = await call('POST', '/auth/register', { company: 'X', name: 'X', email: 'a@a.pl', password: 'password1', accept_terms: true });
    expect(dup.status).toBe(409);
    const me = await call('GET', '/auth/me', undefined, tokenA);
    expect(me.data.account.name).toBe('Sklep A');
    expect(me.data.account.status).toBe('trial');
  });

  it('rejects unauthenticated and wrong-password requests', async () => {
    expect((await call('GET', '/orders')).status).toBe(401);
    expect((await call('POST', '/auth/login', { email: 'a@a.pl', password: 'nope' })).status).toBe(401);
    expect((await call('POST', '/auth/login', { email: 'a@a.pl', password: 'password1' })).status).toBe(200);
  });

  it('creates a product with stock in the default warehouse', async () => {
    const r = await call('POST', '/products', { name: 'Głośnik', sku: 'SPK-1', price: 100, stocks: undefined, stock: 10 }, tokenA);
    expect(r.status).toBe(200);
    productId = r.data.id;
    const p = await call('GET', `/products/${productId}`, undefined, tokenA);
    expect(p.data.stock).toBe(10);
    expect(p.data.stocks[0].stock).toBe(10);
  });

  it('creates an order, deducts stock and keeps data isolated per account', async () => {
    const r = await call(
      'POST',
      '/orders',
      { delivery_fullname: 'Jan Kowalski', email: 'jan@x.pl', delivery_price: 10, items: [{ name: 'Głośnik', sku: 'SPK-1', quantity: 2, price: 100 }] },
      tokenA,
    );
    expect(r.status).toBe(200);
    orderId = r.data.id;
    expect(orderId).toBeGreaterThan(10000000);
    const o = await call('GET', `/orders/${orderId}`, undefined, tokenA);
    expect(o.data.total).toBe(210);
    expect(o.data.items[0].product_id).toBe(productId);
    expect((await call('GET', `/products/${productId}`, undefined, tokenA)).data.stock).toBe(8);
    // Account B cannot see account A's order or product.
    expect((await call('GET', `/orders/${orderId}`, undefined, tokenB)).status).toBe(404);
    expect((await call('GET', '/orders', undefined, tokenB)).data.total).toBe(0);
    expect((await call('GET', `/products/${productId}`, undefined, tokenB)).status).toBe(404);
  });

  it('restores stock on cancel and filters orders', async () => {
    const st = await call('GET', '/statuses', undefined, tokenA);
    const canceled = st.data.statuses.find((s: any) => s.system_key === 'canceled');
    await call('POST', `/orders/${orderId}/status`, { status_id: canceled.id }, tokenA);
    expect((await call('GET', `/products/${productId}`, undefined, tokenA)).data.stock).toBe(10);
    const f = await call('GET', `/orders?status_id=${canceled.id}&search=Kowalski`, undefined, tokenA);
    expect(f.data.total).toBe(1);
    const none = await call('GET', `/orders?payment=paid`, undefined, tokenA);
    expect(none.data.total).toBe(0);
  });

  it('handles warehouse documents (PZ, MM)', async () => {
    const wh = await call('POST', '/warehouses', { name: 'Magazyn 2', code: 'M2' }, tokenA);
    const whs = await call('GET', '/warehouses', undefined, tokenA);
    const main = whs.data.find((w: any) => w.is_default);
    const pz = await call('POST', '/warehouse-docs', { type: 'PZ', warehouse_id: main.id, items: [{ product_id: productId, quantity: 5, price: 40 }], confirm: true }, tokenA);
    expect(pz.status).toBe(200);
    const mm = await call(
      'POST',
      '/warehouse-docs',
      { type: 'MM', warehouse_id: main.id, target_warehouse_id: wh.data.id, items: [{ product_id: productId, quantity: 3 }], confirm: true },
      tokenA,
    );
    expect(mm.status).toBe(200);
    const p = await call('GET', `/products/${productId}`, undefined, tokenA);
    expect(p.data.stock).toBe(15);
    expect(p.data.stocks.find((s: any) => s.warehouse_id === wh.data.id).stock).toBe(3);
    expect(p.data.purchase_price).toBe(40);
  });

  it('issues an invoice with continuous numbering', async () => {
    const r = await call('POST', `/orders/${orderId}/documents`, { type: 'invoice' }, tokenA);
    expect(r.status).toBe(200);
    const inv = await call('GET', `/invoices/${r.data.id}`, undefined, tokenA);
    expect(inv.data.number).toMatch(/^FV 1\//);
    expect(inv.data.total_gross).toBe(210);
    const again = await call('POST', `/orders/${orderId}/documents`, { type: 'invoice' }, tokenA);
    expect(again.status).toBe(409);
    const pdf = await fetch(`${base}/invoices/${r.data.id}/pdf`, { headers: { authorization: `Bearer ${tokenA}` } });
    expect(pdf.headers.get('content-type')).toContain('application/pdf');
  });

  it('runs automatic actions', async () => {
    const st = await call('GET', '/statuses', undefined, tokenA);
    const toSend = st.data.statuses.find((s: any) => s.system_key === 'to_send');
    const rule = await call(
      'POST',
      '/rules',
      { name: 'COD → to send', event: 'order_created', conditions: [{ field: 'payment_cod', op: 'true', value: true }], actions: [{ type: 'set_status', params: { status_id: toSend.id } }] },
      tokenA,
    );
    expect(rule.status).toBe(200);
    const o = await call('POST', '/orders', { payment_cod: true, items: [{ name: 'X', quantity: 1, price: 5 }] }, tokenA);
    await new Promise((r) => setTimeout(r, 50));
    const got = await call('GET', `/orders/${o.data.id}`, undefined, tokenA);
    expect(got.data.status_id).toBe(toSend.id);
  });

  it('demo marketplace integration imports orders and offers', async () => {
    const i = await call('POST', '/integrations', { type: 'allegro', name: 'Allegro demo', demo: true }, tokenB);
    expect(i.status).toBe(200);
    const offers = await call('POST', `/integrations/${i.data.id}/sync-offers`, {}, tokenB);
    expect(offers.data.count).toBeGreaterThan(0);
    const orders = await call('POST', `/integrations/${i.data.id}/sync-orders`, {}, tokenB);
    expect(orders.data.imported).toBeGreaterThan(0);
    const list = await call('GET', '/orders?sources=allegro', undefined, tokenB);
    expect(list.data.total).toBe(orders.data.imported);
  });

  it('support ticket flow with staff impersonation', async () => {
    const t = await call('POST', '/support/tickets', { subject: 'Problem z Allegro', category: 'integrations', body: 'Nie pobierają się zamówienia' }, tokenA);
    expect(t.status).toBe(200);
    // Clients cannot reach the admin API.
    expect((await call('GET', '/admin/accounts', undefined, tokenA)).status).toBe(401);
    const login = await call('POST', '/admin/login', { email: 'admin@test.pl', password: 'adminpass123' });
    expect(login.status).toBe(200);
    const staff = login.data.token;
    // Staff token cannot be used as a client token.
    expect((await call('GET', '/orders', undefined, staff)).status).toBe(401);
    const tickets = await call('GET', '/admin/tickets?status=active', undefined, staff);
    expect(tickets.data.length).toBe(1);
    await call('POST', `/admin/tickets/${t.data.id}/take`, {}, staff);
    await call('POST', `/admin/tickets/${t.data.id}/messages`, { body: 'Sprawdzamy!' }, staff);
    await call('POST', `/admin/tickets/${t.data.id}/messages`, { body: 'notatka wewnętrzna', internal: true }, staff);
    const mine = await call('GET', `/support/tickets/${t.data.id}`, undefined, tokenA);
    expect(mine.data.status).toBe('waiting');
    expect(mine.data.messages.map((m: any) => m.body)).toEqual(['Nie pobierają się zamówienia', 'Sprawdzamy!']);
    // Impersonation requires a reason and is audited.
    const accounts = await call('GET', '/admin/accounts?search=Sklep A', undefined, staff);
    const accId = accounts.data.rows[0].id;
    expect((await call('POST', `/admin/accounts/${accId}/impersonate`, {}, staff)).status).toBe(400);
    const imp = await call('POST', `/admin/accounts/${accId}/impersonate`, { reason: 'ticket #1' }, staff);
    const me = await call('GET', '/auth/me', undefined, imp.data.token);
    expect(me.data.impersonator.email).toBe('admin@test.pl');
    expect((await call('GET', `/orders/${orderId}`, undefined, imp.data.token)).status).toBe(200);
    const audit = await call('GET', `/admin/audit?account_id=${accId}`, undefined, staff);
    expect(audit.data.some((a: any) => a.action === 'account.impersonate')).toBe(true);
  });

  it('suspended accounts are read-only', async () => {
    const login = await call('POST', '/admin/login', { email: 'admin@test.pl', password: 'adminpass123' });
    const accounts = await call('GET', '/admin/accounts?search=Sklep B', undefined, login.data.token);
    await call('PUT', `/admin/accounts/${accounts.data.rows[0].id}`, { status: 'suspended' }, login.data.token);
    expect((await call('GET', '/orders', undefined, tokenB)).status).toBe(200);
    expect((await call('POST', '/orders', { items: [] }, tokenB)).status).toBe(402);
    expect((await call('POST', '/support/tickets', { subject: 'Płatność', category: 'billing', body: 'Jak zapłacić?' }, tokenB)).status).toBe(200);
  });

  it('accelerations are billed per day', async () => {
    const r = await call('PUT', '/billing/accelerations', { stock: '5m' }, tokenA);
    expect(r.data.current.stock).toBe('5m');
    const b = await call('GET', '/billing', undefined, tokenA);
    expect(b.data.balance).toBeGreaterThan(0);
    expect((await call('PUT', '/billing/accelerations', { stock: 'turbo' }, tokenA)).status).toBe(400);
  });

  it('public order page needs the right token', async () => {
    const o = await call('GET', `/orders/${orderId}`, undefined, tokenA);
    const me = await call('GET', '/auth/me', undefined, tokenA);
    const ok = await call('GET', `/public/order/${me.data.account.id}/${orderId}/${o.data.token}`);
    expect(ok.status).toBe(200);
    expect(ok.data.seller_comment).toBeUndefined();
    expect((await call('GET', `/public/order/${me.data.account.id}/${orderId}/${'0'.repeat(24)}`)).status).toBe(404);
  });

  it('keeps marketplace credentials on marketplace hosts and SMTP on allowed ports', async () => {
    const bad = await call('POST', '/integrations', { type: 'empik', name: 'Empik', credentials: { api_key: 'k', base_url: 'http://169.254.169.254' } }, tokenA);
    expect(bad.status).toBe(400);
    const evil = await call('POST', '/integrations', { type: 'empik', name: 'Empik', credentials: { api_key: 'k', base_url: 'https://empik.com.evil.io' } }, tokenA);
    expect(evil.status).toBe(400);
    const ok = await call('POST', '/integrations', { type: 'empik', name: 'Empik', credentials: { api_key: 'k', base_url: 'https://marketplace.empik.com' } }, tokenA);
    expect(ok.status).toBe(200);
    expect((await call('PUT', `/integrations/${ok.data.id}`, { credentials: { base_url: 'https://127.0.0.1' } }, tokenA)).status).toBe(400);
    expect((await call('PUT', '/settings/smtp', { host: 'localhost', port: 6379 }, tokenA)).status).toBe(400);
    expect((await call('PUT', '/settings/smtp', { host: 'smtp.example.com', port: 587 }, tokenA)).status).toBe(200);
  });

  it('changing the password signs out other sessions', async () => {
    const r = await call('PUT', '/auth/me', { current_password: 'password1', new_password: 'password1-new' }, tokenA);
    expect(r.status).toBe(200);
    expect(r.data.token).toBeTruthy();
    expect((await call('GET', '/auth/me', undefined, tokenA)).status).toBe(401);
    expect((await call('GET', '/auth/me', undefined, r.data.token)).status).toBe(200);
  });

  it('stores sign-up attribution and exports Google Ads conversions', async () => {
    const r = await call('POST', '/auth/register', {
      company: 'Sklep Ads', name: 'Celina', email: 'ads@c.pl', password: 'password3', accept_terms: true,
      attribution: { utm_source: 'google', utm_medium: 'cpc', gclid: 'Cj0KTEST', evil: 'x' },
    });
    expect(r.status).toBe(200);
    const login = await call('POST', '/admin/login', { email: 'admin@test.pl', password: 'adminpass123' });
    const list = await call('GET', '/admin/accounts?search=Sklep Ads', undefined, login.data.token);
    const acc = list.data.rows[0];
    expect(acc.source).toBe('google / cpc');
    const detail = await call('GET', `/admin/accounts/${acc.id}`, undefined, login.data.token);
    expect(detail.data.attribution).toEqual({ utm_source: 'google', utm_medium: 'cpc', gclid: 'Cj0KTEST' });
    await call('POST', `/admin/accounts/${acc.id}/payments`, { amount: 99, extend_days: 30 }, login.data.token);
    const csv = await call('GET', '/admin/conversions.csv', undefined, login.data.token);
    expect(csv.status).toBe(200);
    expect(String(csv.data)).toContain('Cj0KTEST,,,Subscription paid,');
    expect(String(csv.data)).toContain(',99.00,PLN');
    expect((await call('GET', '/admin/conversions.csv', undefined, tokenA)).status).toBe(401);
  });
});
