import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.DISABLE_SCHEDULER = '1';
process.env.PASSWORD_BREACH_CHECK = '0';
process.env.ADMIN_EMAIL = 'admin@test.pl';
process.env.ADMIN_PASSWORD = 'Panel-Admin-2026';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sellhub-ord-'));
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
describe('Order stock logic', () => {
  let t = '';
  const api = (m: string, u: string, b?: unknown) => call(m, u, b, t);
  let statuses: any[] = [];
  const sid = (key: string) => statuses.find((s) => s.system_key === key)?.id;
  const stockOf = async (id: number) => {
    const p = (await api('GET', `/products/${id}`)).data;
    return { stock: p.stock, reserved: p.stocks.reduce((s: number, x: any) => s + (x.reserved ?? 0), 0) };
  };
  let kubek = 0;
  let talerz = 0;
  let zestaw = 0;
  const order = async (items: any[], extra: Record<string, unknown> = {}) =>
    (await api('POST', '/orders', { delivery_fullname: 'Jan Nowak', email: 'jan@x.pl', items, ...extra })).data.id as number;

  it('setup', async () => {
    t = (await call('POST', '/auth/register', { company: 'Sklep Z', name: 'Zoja', email: 'zoja@x.pl', password: 'Kubek-Zielony-17', accept_terms: true })).data.token;
    statuses = (await api('GET', '/statuses')).data.statuses;
    kubek = (await api('POST', '/products', { name: 'Kubek', sku: 'K-1', price: 20, stock: 10 })).data.id;
    talerz = (await api('POST', '/products', { name: 'Talerz', sku: 'T-1', price: 30, stock: 10 })).data.id;
    zestaw = (await api('POST', '/products', { name: 'Zestaw', sku: 'Z-1', price: 45, is_bundle: true, bundle_items: [{ product_id: kubek, quantity: 1 }, { product_id: talerz, quantity: 1 }] })).data.id;
    expect((await stockOf(kubek)).stock).toBe(10);
  });

  it('bin returns stock and an order in the bin never takes it again', async () => {
    const id = await order([{ product_id: kubek, name: 'Kubek', quantity: 2, price: 20 }]);
    expect((await stockOf(kubek)).stock).toBe(8);
    await api('DELETE', `/orders/${id}`);
    expect((await stockOf(kubek)).stock).toBe(10);
    // Status change of an order in the bin used to deduct again.
    await api('POST', `/orders/${id}/status`, { status_id: sid('canceled') });
    await api('POST', `/orders/${id}/status`, { status_id: sid('new') });
    expect((await stockOf(kubek)).stock).toBe(10);
    await api('POST', `/orders/${id}/restore`);
    expect((await stockOf(kubek)).stock).toBe(8);
    await api('POST', `/orders/${id}/status`, { status_id: sid('canceled') });
    expect((await stockOf(kubek)).stock).toBe(10);
  });

  it('a changed bundle does not return more than the order took', async () => {
    const id = await order([{ product_id: zestaw, name: 'Zestaw', quantity: 1, price: 45 }]);
    expect((await stockOf(kubek)).stock).toBe(9);
    expect((await stockOf(talerz)).stock).toBe(9);
    // The bundle is changed to 2 mugs after the sale.
    await api('PUT', `/products/${zestaw}`, { bundle_items: [{ product_id: kubek, quantity: 2 }] });
    await api('POST', `/orders/${id}/status`, { status_id: sid('canceled') });
    expect((await stockOf(kubek)).stock).toBe(10);
    expect((await stockOf(talerz)).stock).toBe(10);
  });

  it('merge adds up delivery and payments, refuses duplicates, keeps stock right', async () => {
    const a = await order([{ product_id: kubek, name: 'Kubek', quantity: 1, price: 20 }], { delivery_price: 10, paid_amount: 30 });
    const b = await order([{ product_id: talerz, name: 'Talerz', quantity: 1, price: 30 }], { delivery_price: 12, paid_amount: 42 });
    expect((await api('POST', '/orders/bulk', { action: 'merge', ids: [a, a] })).status).toBe(400);
    const m = await api('POST', '/orders/bulk', { action: 'merge', ids: [a, b] });
    expect(m.data.id).toBe(a);
    const card = (await api('GET', `/orders/${a}`)).data;
    expect(card.delivery_price).toBe(22);
    expect(card.paid_amount).toBe(72);
    expect(card.items.length).toBe(2);
    expect((await stockOf(kubek)).stock).toBe(9);
    expect((await stockOf(talerz)).stock).toBe(9);
    // A merged order in the bin cannot be merged again.
    const c = await order([{ product_id: kubek, name: 'Kubek', quantity: 1, price: 20 }]);
    expect((await api('POST', '/orders/bulk', { action: 'merge', ids: [b, c] })).status).toBe(400);
    await api('POST', `/orders/${a}/status`, { status_id: sid('canceled') });
    await api('POST', `/orders/${c}/status`, { status_id: sid('canceled') });
    expect((await stockOf(kubek)).stock).toBe(10);
    expect((await stockOf(talerz)).stock).toBe(10);
  });

  it('split moves part of a line and its taken stock', async () => {
    const id = await order([{ product_id: kubek, name: 'Kubek', quantity: 3, price: 20 }], { paid_amount: 60 });
    const card = (await api('GET', `/orders/${id}`)).data;
    const r = await api('POST', `/orders/${id}/split`, { items: [{ id: card.items[0].id, quantity: 1 }] });
    expect(r.status).toBe(200);
    const left = (await api('GET', `/orders/${id}`)).data;
    const moved = (await api('GET', `/orders/${r.data.id}`)).data;
    expect(left.items[0].quantity).toBe(2);
    expect(moved.items[0].quantity).toBe(1);
    // The payment above the remaining value goes with the new order.
    expect(left.paid_amount).toBe(40);
    expect(moved.paid_amount).toBe(20);
    expect((await stockOf(kubek)).stock).toBe(7);
    await api('POST', `/orders/${r.data.id}/status`, { status_id: sid('canceled') });
    expect((await stockOf(kubek)).stock).toBe(8);
    await api('POST', `/orders/${id}/status`, { status_id: sid('canceled') });
    expect((await stockOf(kubek)).stock).toBe(10);
  });

  it('returns: only ordered products and quantities, refund limited, restock only what was taken', async () => {
    const id = await order([{ product_id: kubek, name: 'Kubek', quantity: 2, price: 20 }]);
    const line = (await api('GET', `/orders/${id}`)).data.items[0].id;
    expect((await api('POST', '/returns', { order_id: id, items: [{ order_item_id: line, name: 'Kubek', quantity: 3, price: 20 }] })).status).toBe(400);
    expect((await api('POST', '/returns', { order_id: id, items: [{ product_id: talerz, name: 'Talerz', quantity: 1, price: 30 }] })).status).toBe(400);
    expect((await api('POST', '/returns', { order_id: id, refund_amount: 500 })).status).toBe(400);
    const r1 = (await api('POST', '/returns', { order_id: id, items: [{ order_item_id: line, name: 'Kubek', quantity: 1, price: 20 }] })).data.id;
    expect((await api('POST', '/returns', { order_id: id, items: [{ order_item_id: line, name: 'Kubek', quantity: 2, price: 20 }] })).status).toBe(400);
    await api('POST', `/returns/${r1}/stock`);
    expect((await stockOf(kubek)).stock).toBe(9);
    // Cancelling after the return gives back only the unit still taken.
    await api('POST', `/orders/${id}/status`, { status_id: sid('canceled') });
    expect((await stockOf(kubek)).stock).toBe(10);
    // A return of a canceled order puts nothing back (stock was already returned).
    const r2 = (await api('POST', '/returns', { order_id: id })).data.id;
    await api('POST', `/returns/${r2}/stock`);
    expect((await stockOf(kubek)).stock).toBe(10);
  });

  it('deduct on status with reservation before', async () => {
    const packed = statuses.find((s) => !s.system_key) ?? statuses[1];
    await api('PUT', '/settings/orders', { stock_deduct: `status:${packed.id}`, stock_reserve: true });
    const id = await order([{ product_id: kubek, name: 'Kubek', quantity: 2, price: 20 }]);
    expect(await stockOf(kubek)).toEqual({ stock: 10, reserved: 2 });
    // Editing the line moves the reservation.
    const line = (await api('GET', `/orders/${id}`)).data.items[0].id;
    await api('PUT', `/orders/${id}/items/${line}`, { quantity: 3 });
    expect(await stockOf(kubek)).toEqual({ stock: 10, reserved: 3 });
    await api('POST', `/orders/${id}/status`, { status_id: packed.id });
    expect(await stockOf(kubek)).toEqual({ stock: 7, reserved: 0 });
    // Further statuses keep it taken; cancelling gives it back.
    await api('POST', `/orders/${id}/status`, { status_id: sid('new') });
    expect((await stockOf(kubek)).stock).toBe(7);
    await api('POST', `/orders/${id}/status`, { status_id: sid('canceled') });
    expect(await stockOf(kubek)).toEqual({ stock: 10, reserved: 0 });
    const card = (await api('GET', `/orders/${id}`)).data;
    expect(card.history.some((h: any) => h.message === 'Stock reserved')).toBe(true);
    await api('PUT', '/settings/orders', { stock_deduct: 'on_create', stock_reserve: false });
  });

  it('invoices: valid dates, numbers follow dates, corrections chain, receipt rules, lock', async () => {
    const id = await order([{ product_id: kubek, name: 'Kubek', quantity: 2, price: 20 }]);
    expect((await api('POST', `/orders/${id}/documents`, { type: 'invoice', issue_date: '2099-99-99' })).status).toBe(400);
    const inv = await api('POST', `/orders/${id}/documents`, { type: 'invoice', issue_date: '2026-10-05' });
    expect(inv.status).toBe(200);
    // A later document cannot be dated before the last one of the series.
    const id2 = await order([{ product_id: kubek, name: 'Kubek', quantity: 1, price: 20 }]);
    expect((await api('POST', `/orders/${id2}/documents`, { type: 'invoice', issue_date: '2026-10-01' })).status).toBe(400);
    // A receipt after an invoice is refused; an invoice to a receipt refers to it.
    expect((await api('POST', `/orders/${id}/documents`, { type: 'receipt' })).status).toBe(409);
    const rec = await api('POST', `/orders/${id2}/documents`, { type: 'receipt', issue_date: '2026-10-05' });
    const inv2 = (await api('POST', `/orders/${id2}/documents`, { type: 'invoice', issue_date: '2026-10-05' })).data.id;
    const recNo = (await api('GET', `/invoices/${rec.data.id}`)).data.number;
    expect((await api('GET', `/invoices/${inv2}`)).data.notes).toContain(recNo);
    // Products and prices are fixed after the invoice.
    const line = (await api('GET', `/orders/${id}`)).data.items[0].id;
    expect((await api('PUT', `/orders/${id}/items/${line}`, { quantity: 5 })).status).toBe(409);
    expect((await api('PUT', `/orders/${id}/items/${line}`, { location: 'A-1' })).status).toBe(200);
    expect((await api('PUT', `/orders/${id}`, { delivery_price: 15 })).status).toBe(409);
    // Corrections: the second one is counted from the first one, not from the invoice.
    const c1 = (await api('POST', `/invoices/${inv.data.id}/correction`, { reason: 'Rabat', items: [{ name: 'Kubek', quantity: 2, price_gross: 15, tax_rate: 23 }] })).data.id;
    expect((await api('GET', `/invoices/${c1}`)).data.total_gross).toBe(-10);
    const c2 = (await api('POST', `/invoices/${c1}/correction`, { reason: 'Zwrot', items: [{ name: 'Kubek', quantity: 1, price_gross: 15, tax_rate: 23 }] })).data.id;
    const c2v = (await api('GET', `/invoices/${c2}`)).data;
    expect(c2v.total_gross).toBe(-15);
    expect(c2v.corrected.id).toBe(inv.data.id);
    expect(c2v.corrected.items[0].price_gross).toBe(15);
  });

  it('payment history, manual lock and search with % _', async () => {
    const id = await order([{ name: 'Usługa 100%_extra', quantity: 1, price: 50 }]);
    expect((await api('POST', `/orders/${id}/payment`, { paid_amount: 20, payment_date: '2026-13-01' })).status).toBe(400);
    await api('POST', `/orders/${id}/payment`, { paid_amount: 20 });
    await api('POST', `/orders/${id}/payment`, { paid_amount: 50, comment: 'Przelew' });
    const card = (await api('GET', `/orders/${id}`)).data;
    expect(card.payments.map((p: any) => p.amount)).toEqual([30, 20]);
    await api('POST', `/orders/${id}/lock`, { locked: true });
    expect((await api('POST', `/orders/${id}/items`, { name: 'X', quantity: 1, price: 1 })).status).toBe(409);
    await api('POST', `/orders/${id}/lock`, { locked: false });
    expect((await api('POST', `/orders/${id}/items`, { name: 'X', quantity: 1, price: 1 })).status).toBe(200);
    // "%" and "_" are searched literally.
    const all = (await api('GET', '/orders?search=' + encodeURIComponent('%'))).data.rows.map((r: any) => r.id);
    expect(all).toEqual([id]);
    expect((await api('POST', '/orders', { items: [{ name: 'Rabat', quantity: 1, price: -10 }] })).status).toBe(400);
    expect((await api('POST', '/orders', { status_id: 99999 })).status).toBe(400);
    expect((await api('POST', '/orders/99999/note', { message: 'x' })).status).toBe(404);
  });
});
