/**
 * Kaufland Marketplace Seller API v2 connector.
 * Docs: https://sellerapi.kaufland.com/?page=rest-api
 */
import crypto from 'node:crypto';
import { toSqlDate } from './allegro.js';
import { joinAddress, request } from './http.js';
import type { Connector, ConnectorContext, ListingInput, ListingOptions, MarketplaceOffer, MarketplaceOrder } from './types.js';

export const KAUFLAND_BASE = 'https://sellerapi.kaufland.com/v2';

/** Shop-Signature: hex HMAC-SHA256 of "METHOD\nURI\nBODY\nTIMESTAMP". */
export function kauflandSignature(method: string, uri: string, body: string, timestamp: number, secret: string) {
  return crypto.createHmac('sha256', secret).update([method, uri, body, String(timestamp)].join('\n')).digest('hex');
}

const CARRIERS: Record<string, string> = {
  inpost: 'InPost',
  inpost_courier: 'InPost',
  dpd: 'DPD',
  dhl: 'DHL',
  gls: 'GLS',
  ups: 'UPS',
  pocztex: 'Poczta Polska',
  orlen: 'ORLEN Paczka',
  fedex: 'Fedex',
};

const STOREFRONT_CURRENCY: Record<string, string> = { pl: 'PLN', de: 'EUR', cz: 'CZK', sk: 'EUR', ro: 'RON', bg: 'EUR', hr: 'EUR', at: 'EUR' };

/** Groups Kaufland order units (one per item) into orders. */
export function mapOrderUnits(units: any[], storefront = 'pl'): MarketplaceOrder[] {
  const groups = new Map<string, any[]>();
  for (const u of units) {
    const k = String(u.id_order);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(u);
  }
  const out: MarketplaceOrder[] = [];
  for (const [idOrder, us] of groups) {
    const first = us[0];
    const ship = first.shipping_address ?? {};
    const bill = first.billing_address ?? {};
    const active = us.filter((u) => !['cancelled', 'returned', 'returned_paid'].includes(u.status));
    const cents = (v: any) => Number(v ?? 0) / 100;
    const shippingTotal = active.reduce((s, u) => s + cents(u.shipping_rate), 0);
    const itemsTotal = active.reduce((s, u) => s + cents(u.price), 0);
    // Merge identical products into one line with quantity.
    const lines = new Map<string, any>();
    for (const u of active) {
      const key = `${u.id_offer ?? ''}|${u.price}`;
      const l = lines.get(key);
      if (l) {
        l.quantity += 1;
        l.external_line_id += `,${u.id_order_unit}`;
      } else {
        lines.set(key, {
          name: u.product?.title ?? 'Produkt',
          sku: u.id_offer ?? '',
          ean: u.product?.eans?.[0] ?? '',
          quantity: 1,
          price: cents(u.price),
          auction_id: String(u.product?.id_product ?? ''),
          external_line_id: String(u.id_order_unit),
          image: u.product?.main_picture ?? '',
        });
      }
    }
    out.push({
      external_id: idOrder,
      source: 'kaufland',
      date_add: toSqlDate(first.ts_created_iso),
      user_login: first.buyer?.id_buyer ? `kaufland-${first.buyer.id_buyer}` : '',
      email: first.buyer?.email ?? '',
      phone: ship.phone ?? bill.phone ?? '',
      currency: first.currency ?? STOREFRONT_CURRENCY[storefront] ?? 'PLN',
      payment_method: 'Kaufland',
      payment_cod: 0,
      paid_amount: Math.round((itemsTotal + shippingTotal) * 100) / 100,
      delivery_method: first.shipping_group ?? first.delivery_type ?? 'Kaufland',
      delivery_price: Math.round(shippingTotal * 100) / 100,
      delivery_fullname: joinAddress(ship.first_name, ship.last_name),
      delivery_company: ship.company_name ?? '',
      delivery_address: joinAddress(ship.street, ship.house_number),
      delivery_postcode: ship.postcode ?? '',
      delivery_city: ship.city ?? '',
      delivery_country_code: (ship.country ?? storefront).toUpperCase().slice(0, 2),
      invoice_wanted: bill.company_name ? 1 : 0,
      invoice_fullname: joinAddress(bill.first_name, bill.last_name),
      invoice_company: bill.company_name ?? '',
      invoice_nip: bill.vat_id ?? '',
      invoice_address: joinAddress(bill.street, bill.house_number),
      invoice_postcode: bill.postcode ?? '',
      invoice_city: bill.city ?? '',
      invoice_country_code: (bill.country ?? storefront).toUpperCase().slice(0, 2),
      buyer_comment: ship.additional_field ?? '',
      external_status: [...new Set(us.map((u) => u.status))].join(', '),
      external_data: { units: us.map((u) => ({ id: u.id_order_unit, status: u.status })) },
      items: [...lines.values()],
      canceled: active.length === 0,
      importable: us.some((u) => ['need_to_be_sent', 'sent', 'received', 'sent_and_autopaid'].includes(u.status)),
    });
  }
  return out;
}

export class KauflandConnector implements Connector {
  constructor(private ctx: ConnectorContext) {}

  private get storefront() {
    return String(this.ctx.integration.credentials.storefront || 'pl');
  }

  private api<T = any>(method: string, path: string, body?: unknown) {
    const { client_key, secret_key } = this.ctx.integration.credentials;
    if (!client_key || !secret_key) throw new Error('Kaufland client key / secret key is missing');
    const url = `${KAUFLAND_BASE}${path}`;
    const bodyStr = body !== undefined ? JSON.stringify(body) : '';
    const ts = Math.floor(Date.now() / 1000);
    return request<T>(url, {
      method,
      headers: {
        Accept: 'application/json',
        'Shop-Client-Key': client_key,
        'Shop-Timestamp': String(ts),
        'Shop-Signature': kauflandSignature(method, url, bodyStr, ts, secret_key),
        'User-Agent': 'SellHub/1.0',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? bodyStr : undefined,
    });
  }

  async test() {
    const res = await this.api<{ data: any[] }>('GET', `/info/storefront`);
    return `Connected. Storefronts: ${(res.data ?? []).map((s: any) => s.storefront ?? s).join(', ') || this.storefront}`;
  }

  async fetchOrders(since: string) {
    const sinceIso = new Date(since.replace(' ', 'T') + 'Z').toISOString();
    const units: any[] = [];
    for (let offset = 0; offset < 20000; offset += 100) {
      const res = await this.api<{ data: any[]; pagination?: { total: number } }>(
        'GET',
        `/order-units?storefront=${this.storefront}&ts_created_from_iso=${encodeURIComponent(sinceIso)}&limit=100&offset=${offset}`,
      );
      units.push(...(res.data ?? []));
      if (!res.data?.length || offset + 100 >= (res.pagination?.total ?? 0)) break;
    }
    // The listing omits addresses — load full units for each order.
    const detailed: any[] = [];
    for (const u of units) {
      if (u.shipping_address) {
        detailed.push(u);
        continue;
      }
      try {
        const d = await this.api<{ data: any }>('GET', `/order-units/${u.id_order_unit}?embedded=product,buyer`);
        detailed.push({ ...u, ...d.data });
      } catch (e: any) {
        this.ctx.log(`Order unit ${u.id_order_unit}: ${e.message}`, 'warn');
        detailed.push(u);
      }
    }
    return mapOrderUnits(detailed, this.storefront);
  }

  async fetchOffers() {
    const out: MarketplaceOffer[] = [];
    for (let offset = 0; offset < 50000; offset += 100) {
      const res = await this.api<{ data: any[]; pagination?: { total: number } }>(
        'GET',
        `/units?storefront=${this.storefront}&limit=100&offset=${offset}&embedded=product`,
      );
      for (const u of res.data ?? []) {
        out.push({
          external_id: String(u.id_unit),
          title: u.product?.title ?? u.id_offer ?? '',
          sku: u.id_offer ?? '',
          ean: u.ean ?? u.product?.eans?.[0] ?? '',
          price: Number(u.listing_price ?? u.price ?? 0) / 100,
          currency: STOREFRONT_CURRENCY[this.storefront] ?? 'PLN',
          stock: Number(u.amount ?? 0),
          status: u.status ?? 'available',
          url: u.product?.id_product ? `https://www.kaufland.${this.storefront}/product/${u.product.id_product}/` : '',
          image: u.product?.main_picture ?? '',
          raw: { id_product: u.product?.id_product },
        });
      }
      if (!res.data?.length || offset + 100 >= (res.pagination?.total ?? 0)) break;
    }
    return out;
  }

  async updateOffer(offer: { external_id: string }, change: { stock?: number; price?: number }) {
    const body: any = {};
    if (change.stock !== undefined) body.amount = Math.max(0, change.stock);
    if (change.price !== undefined) body.listing_price = Math.round(change.price * 100);
    await this.api('PATCH', `/units/${encodeURIComponent(offer.external_id)}?storefront=${this.storefront}`, body);
  }

  private unitIds(order: { external_data: any; items: { external_line_id: string }[] }): string[] {
    const fromData = (order.external_data?.units ?? []).filter((u: any) => u.status !== 'cancelled').map((u: any) => String(u.id));
    if (fromData.length) return fromData;
    return order.items.flatMap((i) => i.external_line_id.split(',')).filter(Boolean);
  }

  async setOrderStatus(order: { external_id: string; external_data: any; items: { external_line_id: string }[] }, code: string) {
    if (code === 'cancel') {
      for (const id of this.unitIds(order)) await this.api('PATCH', `/order-units/${id}/cancel`, { reason: 'product_not_available' });
    } else if (code === 'send') {
      throw new Error('Kaufland requires a tracking number to mark units as sent — create a shipment instead');
    } else throw new Error(`Unknown Kaufland action ${code}`);
  }

  async sendTracking(order: { external_id: string; external_data: any; items: { external_line_id: string }[] }, shipment: { courier: string; tracking_number: string }) {
    for (const id of this.unitIds(order)) {
      await this.api('PATCH', `/order-units/${id}/send`, {
        carrier_code: CARRIERS[shipment.courier] ?? 'Other',
        tracking_numbers: [shipment.tracking_number],
      });
    }
  }

  async listingOptions(): Promise<ListingOptions> {
    return { requires_ean: true, requires_category: false };
  }

  async createOffer(input: ListingInput): Promise<MarketplaceOffer> {
    if (!input.ean) throw new Error('Kaufland requires the product EAN');
    const r = await this.api<{ data: any }>('POST', `/units?storefront=${this.storefront}`, {
      ean: input.ean,
      condition: 'NEW',
      listing_price: Math.round(input.price * 100),
      amount: Math.max(0, input.stock),
      id_offer: input.sku || input.ean,
      handling_time: input.handling_time ?? 1,
      note: '',
    });
    const u = r.data ?? {};
    return {
      external_id: String(u.id_unit ?? `pending-${input.ean}`),
      title: input.title,
      sku: input.sku || input.ean,
      ean: input.ean,
      price: input.price,
      currency: STOREFRONT_CURRENCY[this.storefront] ?? 'PLN',
      stock: input.stock,
      status: u.status ?? 'available',
      url: '',
      image: input.images[0] ?? '',
    };
  }

  async setOfferActive(offer: { external_id: string; sku: string; ean: string; price: number; stock: number }, active: boolean) {
    if (!active) {
      await this.api('DELETE', `/units/${encodeURIComponent(offer.external_id)}?storefront=${this.storefront}`);
      return;
    }
    await this.api('POST', `/units?storefront=${this.storefront}`, {
      ean: offer.ean,
      condition: 'NEW',
      listing_price: Math.round(offer.price * 100),
      amount: Math.max(0, offer.stock),
      id_offer: offer.sku,
      handling_time: 1,
    });
  }
}
