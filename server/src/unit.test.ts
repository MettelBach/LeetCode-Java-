import { describe, expect, it } from 'vitest';
import { mapCheckoutForm } from './integrations/allegro.js';
import { empikBaseUrl, iso2, mapMiraklOrder } from './integrations/empik.js';
import { isPrivateIp } from './lib/net.js';
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
