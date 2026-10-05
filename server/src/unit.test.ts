import { describe, expect, it } from 'vitest';
import { mapCheckoutForm } from './integrations/allegro.js';
import { empikBaseUrl, iso2, mapMiraklOrder } from './integrations/empik.js';
import { isPrivateIp } from './lib/net.js';
import { dueMessage } from './services/lifecycle-mail.js';
import { openJson, sealJson } from './lib/secrets.js';
import { base32Decode, base32Encode, totpCode, verifyTotp } from './lib/totp.js';
import { backupAll } from './services/backup.js';
import { marketplacePrice, marketplaceStock } from './integrations/sync.js';
import { breachCount, weakPasswordReason } from './lib/password-policy.js';
import { vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { kauflandSignature, mapOrderUnits } from './integrations/kaufland.js';
import { testCondition } from './services/automation.js';
import { computeTotals, formatNumber } from './services/invoices.js';
import { code128B } from './services/pdf.js';

describe('Kaufland', () => {
  it('signs requests like the official example', () => {
    // Example from https://sellerapi.kaufland.com/?page=rest-api
    const sig = kauflandSignature('POST', 'https://sellerapi.kaufland.com/v2/units/', '', 1411055926, 'a7d0cb1da1ddbc86c96ee5fedd341b7d8ebfbb2f5c83cfe0909f4e57f05dd403');
    expect(sig).toBe('da0b65f51c0716c1d3fa658b7eaf710583630a762a98c9af8e9b392bd9df2e2a');
  });

  it('groups order units into orders and converts cents', () => {
    const unit = (id: number, status = 'need_to_be_sent') => ({
      id_order_unit: id,
      id_order: 'ABC',
      status,
      price: 1999,
      shipping_rate: 500,
      id_offer: 'SKU-1',
      ts_created_iso: '2026-10-01T10:00:00Z',
      product: { title: 'Patelnia', eans: ['590'] },
      buyer: { email: 'x@y.pl' },
      shipping_address: { first_name: 'Jan', last_name: 'Nowak', street: 'Długa', house_number: '5', postcode: '00-001', city: 'Warszawa', country: 'PL' },
    });
    const [o] = mapOrderUnits([unit(1), unit(2), unit(3, 'cancelled')]);
    expect(o.items).toHaveLength(1);
    expect(o.items![0].quantity).toBe(2);
    expect(o.items![0].price).toBe(19.99);
    expect(o.delivery_price).toBe(10);
    expect(o.delivery_address).toBe('Długa 5');
    expect(o.importable).toBe(true);
  });
});

describe('Allegro', () => {
  it('maps checkout forms', () => {
    const o = mapCheckoutForm({
      id: 'cf-1',
      status: 'READY_FOR_PROCESSING',
      buyer: { login: 'jan123', email: 'j@allegromail.pl' },
      payment: { type: 'CASH_ON_DELIVERY', paidAmount: null },
      delivery: { method: { name: 'Kurier' }, cost: { amount: '12.00' }, address: { firstName: 'Jan', lastName: 'K', street: 'A 1', zipCode: '00-001', city: 'W', countryCode: 'PL' } },
      lineItems: [{ id: 'li1', quantity: 2, price: { amount: '10.50', currency: 'PLN' }, offer: { id: '123', name: 'Kubek', external: { id: 'K-1' } } }],
      summary: { totalToPay: { amount: '33.00', currency: 'PLN' } },
    });
    expect(o.payment_cod).toBe(1);
    expect(o.items![0]).toMatchObject({ sku: 'K-1', quantity: 2, price: 10.5, auction_id: '123', external_line_id: 'li1' });
    expect(o.delivery_price).toBe(12);
    expect(o.importable).toBe(true);
  });
});

describe('Empik (Mirakl)', () => {
  it('maps orders and ISO3 countries', () => {
    expect(iso2('POL')).toBe('PL');
    const o = mapMiraklOrder({
      order_id: 'E-1',
      order_state: 'SHIPPING',
      total_price: 59.9,
      shipping_price: 9.99,
      currency_iso_code: 'PLN',
      customer: { firstname: 'Ola', lastname: 'Z', shipping_address: { firstname: 'Ola', lastname: 'Z', street_1: 'Polna 1', zip_code: '00-001', city: 'Kraków', country_iso_code: 'POL' } },
      order_lines: [{ order_line_id: 'E-1-1', offer_sku: 'B-1', product_title: 'Książka', quantity: 1, price: 49.91, order_line_state: 'SHIPPING' }],
    });
    expect(o.delivery_country_code).toBe('PL');
    expect(o.paid_amount).toBe(59.9);
    expect(o.importable).toBe(true);
  });
});

describe('invoices', () => {
  it('computes totals per VAT rate', () => {
    const t = computeTotals([
      { name: 'A', quantity: 2, price_gross: 123, tax_rate: 23 },
      { name: 'B', quantity: 1, price_gross: 10.5, tax_rate: 5 },
    ]);
    expect(t.total_gross).toBe(256.5);
    expect(t.by_rate['23'].net).toBe(200);
    expect(t.by_rate['5'].net).toBe(10);
  });
  it('formats numbers', () => {
    expect(formatNumber('FV %N/%M/%Y', 7, new Date(2026, 0, 5))).toBe('FV 7/01/2026');
  });
});

describe('automation conditions', () => {
  it('evaluates operators', () => {
    expect(testCondition(150, 'gt', '100')).toBe(true);
    expect(testCondition('allegro', 'in', ['allegro', 'empik'])).toBe(true);
    expect(testCondition(['A-1', 'B-2'], 'contains', 'b-')).toBe(true);
    expect(testCondition('', 'empty', '')).toBe(true);
    expect(testCondition(true, 'false', '')).toBe(false);
  });
});

describe('barcode', () => {
  it('produces valid Code 128 module widths', () => {
    const p = code128B('613855548871');
    for (const x of p.slice(0, -1)) expect([...x].reduce((s, d) => s + Number(d), 0)).toBe(11);
    expect(p[p.length - 1]).toBe('2331112');
  });
});

describe('outbound address checks', () => {
  it('allows only Empik/Mirakl HTTPS hosts for the Empik API', () => {
    expect(empikBaseUrl('')).toBe('https://marketplace.empik.com');
    expect(empikBaseUrl('https://empik-preprod.mirakl.net/')).toBe('https://empik-preprod.mirakl.net');
    for (const bad of ['http://marketplace.empik.com', 'https://localhost', 'https://empik.com.evil.io', 'https://x@marketplace.empik.com', 'https://marketplace.empik.com:8443', 'file:///etc/passwd']) {
      expect(() => empikBaseUrl(bad)).toThrow();
    }
  });

  it('detects private addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', '100.64.0.1']) expect(isPrivateIp(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '151.101.1.1', '2a00:1450:4001::1']) expect(isPrivateIp(ip)).toBe(false);
  });
});

describe('lifecycle e-mails', () => {
  const now = new Date('2026-10-10T09:00:00Z');
  const acc = (o: Partial<Parameters<typeof dueMessage>[0]>) =>
    ({ id: 1, status: 'trial', language: 'pl', settings: '{}', trial_ends_at: '2026-10-20 10:00:00', paid_until: null, created_at: '2026-10-06 10:00:00', email: 'a@a.pl', name: 'A', ...o }) as Parameters<typeof dueMessage>[0];
  it('asks to connect a marketplace only when none is connected', () => {
    expect(dueMessage(acc({ created_at: '2026-10-08 10:00:00' }), now, false, [])).toBe('connect');
    expect(dueMessage(acc({ created_at: '2026-10-08 10:00:00' }), now, true, [])).toBeNull();
  });
  it('sends each message once and in order', () => {
    expect(dueMessage(acc({}), now, false, [])).toBe('connect');
    expect(dueMessage(acc({}), now, false, ['connect'])).toBe('automation');
    expect(dueMessage(acc({}), now, false, ['connect', 'automation'])).toBeNull();
  });
  it('reminds before and after the end of the trial', () => {
    expect(dueMessage(acc({ trial_ends_at: '2026-10-12 10:00:00' }), now, true, ['automation'])).toBe('trial_ending');
    expect(dueMessage(acc({ status: 'suspended', trial_ends_at: '2026-10-08 10:00:00' }), now, true, [])).toBe('trial_ended');
    expect(dueMessage(acc({ status: 'suspended', trial_ends_at: '2026-10-08 10:00:00', paid_until: '2026-10-01 00:00:00' }), now, true, [])).toBeNull();
  });
});

describe('stored secrets', () => {
  it('encrypts and decrypts, accepts legacy plain JSON, rejects tampering', () => {
    const sealed = sealJson({ api_key: 'secret-123' });
    expect(sealed.startsWith('enc:v1:')).toBe(true);
    expect(sealed).not.toContain('secret-123');
    expect(openJson(sealed, {})).toEqual({ api_key: 'secret-123' });
    expect(openJson('{"a":1}', {})).toEqual({ a: 1 });
    const parts = sealed.split(':');
    parts[4] = Buffer.from('{"api_key":"x"}').toString('base64');
    expect(openJson(parts.join(':'), { broken: true })).toEqual({ broken: true });
  });
});

describe('backups', () => {
  it('copies platform and client databases and prunes old backups', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-bk-'));
    const data = path.join(root, 'data');
    fs.mkdirSync(path.join(data, 'tenants'), { recursive: true });
    for (const f of ['platform.db', 'tenants/1001.db']) {
      const d = new Database(path.join(data, f));
      d.exec('CREATE TABLE t (x); INSERT INTO t VALUES (42);');
      d.close();
    }
    const out = path.join(root, 'backups');
    fs.mkdirSync(path.join(out, '2026-01-01_0330'), { recursive: true });
    const r = await backupAll(out, data, new Date('2026-10-04T03:30:00Z'));
    expect(r.tenants).toBe(1);
    const copy = new Database(path.join(r.dir, 'tenants', '1001.db'), { readonly: true });
    expect((copy.prepare('SELECT x FROM t').get() as any).x).toBe(42);
    copy.close();
    expect(fs.existsSync(path.join(out, '2026-01-01_0330'))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('TOTP', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('matches RFC 6238 test vectors', () => {
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    expect(totpCode(secret, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(secret, Math.floor(1111111109 / 30))).toBe('081804');
  });
  it('accepts ±1 step and rejects reuse', () => {
    const now = 1111111109_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(secret, totpCode(secret, step - 1), 0, now)).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, step - 2), 0, now)).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, step), step, now)).toBeNull();
    expect(verifyTotp(secret, 'abc', 0, now)).toBeNull();
    // An unreadable (empty) secret never validates, even with the "empty key" code.
    expect(verifyTotp('', totpCode('', step), 0, now)).toBeNull();
  });
});

describe('marketplace price rules', () => {
  it('applies markup, add-on, rounding and stock reserve', () => {
    expect(marketplacePrice(100, {})).toBe(100);
    expect(marketplacePrice(100, { price_markup_percent: 15 })).toBe(115);
    expect(marketplacePrice(40, { price_markup_percent: 10, price_add: 1.3, price_rounding: '99' })).toBe(45.99);
    expect(marketplacePrice(45, { price_rounding: '99' })).toBe(45.99);
    expect(marketplacePrice(45.5, { price_rounding: 'int' })).toBe(46);
    expect(marketplaceStock(10, { stock_reserve: 3 })).toBe(7);
    expect(marketplaceStock(2, { stock_reserve: 3 })).toBe(0);
  });
});

describe('password policy', () => {
  it('flags common and personal passwords', () => {
    expect(weakPasswordReason('Password1')).toMatch(/too common/);
    expect(weakPasswordReason('kowalski-2026', { email: 'jan.kowalski@x.pl', name: 'Jan Kowalski' })).toBeNull();
    expect(weakPasswordReason('jankowalski99', { name: 'Jan Kowalski' })).toMatch(/e-mail, name or company/);
    expect(weakPasswordReason('Kubek-Zielony-17', { email: 'a@a.pl', name: 'Anna' })).toBeNull();
  });
  it('checks breaches with k-anonymity (only a 5-char hash prefix is sent)', async () => {
    // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, text: async () => '1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\nABC:0' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await breachCount('password')).toBe(9545824);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.pwnedpasswords.com/range/5BAA6');
    expect(await breachCount('Kubek-Zielony-17')).toBe(0);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await breachCount('anything')).toBe(0);
    vi.unstubAllGlobals();
  });
});
