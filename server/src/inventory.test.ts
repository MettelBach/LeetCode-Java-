import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.DISABLE_SCHEDULER = '1';
process.env.PASSWORD_BREACH_CHECK = '0';
process.env.ADMIN_EMAIL = 'admin@test.pl';
process.env.ADMIN_PASSWORD = 'Panel-Admin-2026';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sellhub-inv-'));
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

describe('Inventory like BaseLinker', () => {
  let t = '';
  const api = (m: string, u: string, b?: unknown) => call(m, u, b, t);
  let wh1 = 0;
  let wh2 = 0;
  let catalog = 0;
  let pgRetail = 0;
  let pgB2B = 0;

  it('sets up catalog with price groups and warehouses', async () => {
    const r = await call('POST', '/auth/register', { company: 'Magazyn Test', name: 'Iza', email: 'iza@m.pl', password: 'Kubek-Zielony-17', accept_terms: true });
    t = r.data.token;
    const whs = (await api('GET', '/warehouses')).data;
    wh1 = whs[0].id;
    wh2 = (await api('POST', '/warehouses', { name: 'Magazyn B', code: 'MAGB' })).data.id;
    const groups = (await api('GET', '/price-groups')).data;
    pgRetail = groups[0].id;
    pgB2B = (await api('POST', '/price-groups', { name: 'Hurt', currency: 'PLN' })).data.id;
    catalog = (await api('GET', '/catalogs')).data[0].id;
    const upd = await api('PUT', `/catalogs/${catalog}`, {
      name: 'Katalog główny', languages: ['pl', 'en'], default_language: 'pl',
      price_group_ids: [pgRetail, pgB2B], default_price_group_id: pgRetail, warehouse_ids: [wh1, wh2], default_warehouse_id: wh1,
    });
    expect(upd.status).toBe(200);
    const c = (await api('GET', '/catalogs')).data[0];
    expect(c.languages).toEqual(['pl', 'en']);
    expect(c.warehouse_ids.sort()).toEqual([wh1, wh2].sort());
  });

  let kubek = 0;
  it('creates a product with prices per group, stock per warehouse and texts per language', async () => {
    const r = await api('POST', '/products', {
      name: 'Kubek', sku: 'KUB-1', ean: '5900000000011', catalog_id: catalog,
      prices: { [pgRetail]: 20, [pgB2B]: 15 }, stocks: { [wh1]: 10, [wh2]: 5 },
      texts: [{ lang: 'en', integration_id: 0, name: 'Mug', description: 'Big mug' }],
    });
    expect(r.status).toBe(200);
    kubek = r.data.id;
    const p = (await api('GET', `/products/${kubek}`)).data;
    expect(p.prices[pgB2B]).toBe(15);
    expect(p.price).toBe(20);
    expect(p.stock).toBe(15);
    expect(p.stocks.find((s: any) => s.warehouse_id === wh2).stock).toBe(5);
    expect(p.texts[0].name).toBe('Mug');
    expect(p.history.length).toBe(2);
    // Same SKU in the same catalog is refused.
    expect((await api('POST', '/products', { name: 'X', sku: 'KUB-1', catalog_id: catalog })).status).toBe(409);
  });

  it('refuses negative stock from manual corrections and documents', async () => {
    expect((await api('POST', `/products/${kubek}/stock`, { change: -11, warehouse_id: wh1 })).status).toBe(409);
    const doc = await api('POST', '/warehouse-docs', { type: 'WZ', warehouse_id: wh2, items: [{ product_id: kubek, quantity: 6 }], confirm: true });
    expect(doc.status).toBe(409);
    // The failed document was not saved half-done.
    expect((await api('GET', `/products/${kubek}`)).data.stock).toBe(15);
  });

  it('numbers documents on confirmation, keeps average cost and cancels with a reverse document', async () => {
    const d1 = (await api('POST', '/warehouse-docs', { type: 'PZ', warehouse_id: wh1, items: [{ product_id: kubek, quantity: 10, price: 8 }] })).data.id;
    const d2 = (await api('POST', '/warehouse-docs', { type: 'PZ', warehouse_id: wh1, items: [{ product_id: kubek, quantity: 10, price: 12 }] })).data.id;
    expect((await api('GET', `/warehouse-docs/${d1}`)).data.number).toBe('');
    await api('DELETE', `/warehouse-docs/${d1}`);
    await api('POST', `/warehouse-docs/${d2}/confirm`);
    const d3 = (await api('POST', '/warehouse-docs', { type: 'PZ', warehouse_id: wh1, items: [{ product_id: kubek, quantity: 5, price: 12 }], confirm: true })).data.id;
    const n2 = (await api('GET', `/warehouse-docs/${d2}`)).data.number;
    const n3 = (await api('GET', `/warehouse-docs/${d3}`)).data.number;
    expect(n2).toMatch(/^PZ 1\//);
    expect(n3).toMatch(/^PZ 2\//);
    expect((await api('GET', `/products/${kubek}`)).data.avg_cost).toBe(12);
    const cancel = await api('POST', `/warehouse-docs/${d3}/cancel`);
    expect(cancel.status).toBe(200);
    const rev = (await api('GET', `/warehouse-docs/${cancel.data.reverse_doc_id}`)).data;
    expect(rev.type).toBe('WZ');
    expect((await api('GET', `/warehouse-docs/${d3}`)).data.status).toBe('canceled');
    expect((await api('GET', `/products/${kubek}`)).data.stock).toBe(25);
  });

  it('keeps stock on variants, not on the parent', async () => {
    const parent = (await api('POST', '/products', { name: 'Koszulka', sku: 'TSH', catalog_id: catalog, prices: { [pgRetail]: 50 } })).data.id;
    const gen = await api('POST', `/products/${parent}/variants/generate`, { attributes: { Rozmiar: ['S', 'M'], Kolor: ['Czarny'] } });
    expect(gen.data.created).toBe(2);
    const card = (await api('GET', `/products/${parent}`)).data;
    expect(card.variants[0].sku).toBe('TSH-S-CZARNY');
    expect(card.variants[0].prices[pgRetail]).toBe(50);
    expect((await api('POST', `/products/${parent}/stock`, { change: 5 })).status).toBe(400);
    await api('POST', `/products/${card.variants[0].id}/stock`, { value: 3, warehouse_id: wh1 });
    await api('POST', `/products/${card.variants[1].id}/stock`, { value: 4, warehouse_id: wh2 });
    const list = (await api('GET', `/products?catalog_id=${catalog}&search=TSH`)).data.rows[0];
    expect(list.total_stock).toBe(7);
    expect(list.available).toBe(7);
    // Self-parenting is refused.
    expect((await api('PUT', `/products/${parent}`, { parent_id: parent })).status).toBe(400);
  });

  it('bundle availability comes from components and orders deduct the components', async () => {
    const plate = (await api('POST', '/products', { name: 'Talerz', sku: 'TAL', catalog_id: catalog, stocks: { [wh1]: 9 } })).data.id;
    const set = (await api('POST', '/products', { name: 'Zestaw obiadowy', sku: 'ZEST', catalog_id: catalog, bundle_items: [{ product_id: kubek, quantity: 2 }, { product_id: plate, quantity: 3 }] })).data.id;
    let card = (await api('GET', `/products/${set}`)).data;
    expect(card.is_bundle).toBe(1);
    expect(card.available).toBe(3); // 9 plates / 3
    expect((await api('POST', `/products/${set}/stock`, { change: 1 })).status).toBe(400);
    const order = await api('POST', '/orders', { delivery_fullname: 'Jan', items: [{ product_id: set, name: 'Zestaw', quantity: 1, price: 100 }] });
    expect(order.status).toBe(200);
    expect((await api('GET', `/products/${plate}`)).data.stock).toBe(6);
    card = (await api('GET', `/products/${set}`)).data;
    expect(card.available).toBe(2);
    // A component used in a bundle cannot be deleted.
    expect((await api('DELETE', `/products/${plate}`)).status).toBe(409);
  });

  it('stocktaking creates an INW document from differences', async () => {
    const st = (await api('POST', '/stocktakes', { warehouse_id: wh2, catalog_id: catalog })).data.id;
    const scan = await api('POST', `/stocktakes/${st}/scan`, { code: '5900000000011', qty: 3 });
    expect(scan.data.counted).toBe(3);
    const close = await api('POST', `/stocktakes/${st}/close`, {});
    expect(close.data.differences).toBe(1);
    const doc = (await api('GET', `/warehouse-docs/${close.data.doc_id}`)).data;
    expect(doc.type).toBe('INW');
    expect(doc.items[0].quantity).toBe(-2);
    const p = (await api('GET', `/products/${kubek}`)).data;
    expect(p.stocks.find((s: any) => s.warehouse_id === wh2).stock).toBe(3);
  });

  it('imports CSV with Polish headers, multi-line descriptions and per-row errors', async () => {
    const csv = 'nazwa;sku;cena;stan;kategoria;opis\n"Lampa";LAMP-1;99,90;4;Dom > Oświetlenie;"Linia 1\nLinia 2"\n"Zła";BAD;abc;1;;\n';
    const prev = await api('POST', '/products/import/preview', { csv });
    expect(prev.data.mapping['0']).toBe('name');
    const r = await api('POST', '/products/import', { csv, catalog_id: catalog });
    expect(r.data.created).toBe(1);
    expect(r.data.errors[0].row).toBe(3);
    const lamp = (await api('GET', `/products?catalog_id=${catalog}&search=LAMP-1`)).data.rows[0];
    expect(lamp.description).toBe('Linia 1\nLinia 2');
    expect(lamp.total_stock).toBe(4);
    expect(lamp.group_price).toBe(99.9);
    // Category filter includes subcategories.
    const cats = (await api('GET', `/products/meta/categories?catalog_id=${catalog}`)).data;
    const dom = cats.find((c: any) => c.name === 'Dom');
    expect((await api('GET', `/products?catalog_id=${catalog}&category_id=${dom.id}`)).data.total).toBe(1);
    // Re-import updates instead of duplicating.
    const again = await api('POST', '/products/import', { csv: 'nazwa;sku;stan\nLampa;LAMP-1;7\n', catalog_id: catalog });
    expect(again.data.updated).toBe(1);
    // Export contains per-warehouse stock columns and parent SKU.
    const exp = await api('GET', `/products/export.csv?catalog_id=${catalog}`);
    expect(String(exp.data)).toContain('parent_sku');
    expect(String(exp.data)).toContain('stock_MAGB');
  });

  it('protects warehouses with stock and bulk actions report errors per product', async () => {
    expect((await api('DELETE', `/warehouses/${wh2}`)).status).toBe(409);
    const tag = (await api('POST', '/tags', { name: 'Promocja' })).data.id;
    const bulk = await api('POST', '/products/bulk', { ids: [kubek, 999999], action: 'add_tag', value: tag });
    expect(bulk.data.ok).toBe(1);
    expect(bulk.data.errors[0].id).toBe(999999);
    expect((await api('GET', `/products?catalog_id=${catalog}&tag_id=${tag}`)).data.total).toBe(1);
    const price = await api('POST', '/products/bulk', { ids: [kubek], action: 'price_percent', value: 10, price_group_id: pgB2B });
    expect(price.data.ok).toBe(1);
    expect((await api('GET', `/products/${kubek}`)).data.prices[pgB2B]).toBe(16.5);
  });
});
