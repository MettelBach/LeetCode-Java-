/**
 * Empik Marketplace connector. Empik runs on Mirakl, so this uses the Mirakl
 * Seller API (OR11, OR21, OR23, OR24, OR29, OF21, OF24, A01).
 * Docs: https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3
 */
import { toSqlDate } from './allegro.js';
import { joinAddress, request } from './http.js';
import type { Connector, ConnectorContext, ListingInput, ListingOptions, MarketplaceOffer, MarketplaceOrder } from './types.js';

export const EMPIK_DEFAULT_URL = 'https://marketplace.empik.com';

/**
 * The API address may be changed (e.g. Empik test environment), but only to
 * Empik / Mirakl hosts over HTTPS — the API key must never leave for other servers.
 */
export function empikBaseUrl(raw?: string): string {
  const value = String(raw || '').trim();
  if (!value) return EMPIK_DEFAULT_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid Empik API address');
  }
  const host = url.hostname.toLowerCase();
  const allowed = host === 'empik.com' || host.endsWith('.empik.com') || host.endsWith('.mirakl.net');
  if (url.protocol !== 'https:' || !allowed || url.username || url.password || url.port) {
    throw new Error('Empik API address must be https://*.empik.com or https://*.mirakl.net');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** Mirakl states in which the shipping address is available and the order should be fulfilled. */
const IMPORTABLE = new Set(['SHIPPING', 'SHIPPED', 'TO_COLLECT', 'RECEIVED', 'CLOSED']);

const CARRIERS: Record<string, { code: string; name: string }> = {
  inpost: { code: 'INPOST', name: 'InPost' },
  inpost_courier: { code: 'INPOST', name: 'InPost' },
  dpd: { code: 'DPD', name: 'DPD' },
  dhl: { code: 'DHL', name: 'DHL' },
  gls: { code: 'GLS', name: 'GLS' },
  ups: { code: 'UPS', name: 'UPS' },
  pocztex: { code: 'POCZTA_POLSKA', name: 'Poczta Polska' },
  orlen: { code: 'ORLEN', name: 'ORLEN Paczka' },
  fedex: { code: 'FEDEX', name: 'FedEx' },
};

const ISO3: Record<string, string> = {
  POL: 'PL', DEU: 'DE', CZE: 'CZ', SVK: 'SK', LTU: 'LT', LVA: 'LV', EST: 'EE', AUT: 'AT', FRA: 'FR', ITA: 'IT', ESP: 'ES',
  NLD: 'NL', BEL: 'BE', HUN: 'HU', ROU: 'RO', UKR: 'UA', GBR: 'GB', IRL: 'IE', DNK: 'DK', SWE: 'SE',
};

/** Mirakl uses ISO 3166 alpha-3 country codes. */
export function iso2(code?: string): string {
  if (!code) return 'PL';
  if (code.length === 2) return code.toUpperCase();
  return ISO3[code.toUpperCase()] ?? code.slice(0, 2).toUpperCase();
}

export function mapMiraklOrder(o: any): MarketplaceOrder {
  const ship = o.customer?.shipping_address ?? {};
  const bill = o.customer?.billing_address ?? {};
  const fields: Record<string, string> = {};
  for (const f of o.order_additional_fields ?? []) fields[f.code] = f.value;
  const lines = (o.order_lines ?? []).filter((l: any) => !['REFUSED', 'CANCELED'].includes(l.order_line_state));
  return {
    external_id: o.order_id,
    source: 'empik',
    date_add: toSqlDate(o.created_date),
    user_login: joinAddress(o.customer?.firstname, o.customer?.lastname) || o.customer?.customer_id || '',
    email: o.customer_notification_email ?? '',
    phone: ship.phone ?? bill.phone ?? '',
    currency: o.currency_iso_code ?? 'PLN',
    payment_method: o.payment_type || 'Empik',
    payment_cod: 0,
    // The customer pays Empik; once in SHIPPING the order is fully paid.
    paid_amount: IMPORTABLE.has(o.order_state) ? Number(o.total_price ?? 0) : 0,
    delivery_method: o.shipping_type_label ?? o.shipping_type_code ?? '',
    delivery_price: Number(o.shipping_price ?? 0),
    delivery_fullname: joinAddress(ship.firstname, ship.lastname),
    delivery_company: ship.company ?? '',
    delivery_address: joinAddress(ship.street_1, ship.street_2),
    delivery_postcode: ship.zip_code ?? '',
    delivery_city: ship.city ?? '',
    delivery_country_code: iso2(ship.country_iso_code),
    delivery_point_id: fields['delivery-point-id'] ?? fields['pickup-point-id'] ?? '',
    delivery_point_name: fields['delivery-point-name'] ?? '',
    delivery_point_address: fields['delivery-point-address'] ?? '',
    invoice_wanted: bill.company || fields['nip'] ? 1 : 0,
    invoice_fullname: joinAddress(bill.firstname, bill.lastname),
    invoice_company: bill.company ?? '',
    invoice_nip: fields['nip'] ?? fields['vat-number'] ?? '',
    invoice_address: joinAddress(bill.street_1, bill.street_2),
    invoice_postcode: bill.zip_code ?? '',
    invoice_city: bill.city ?? '',
    invoice_country_code: 'PL',
    external_status: o.order_state ?? '',
    external_data: { state: o.order_state, lines: (o.order_lines ?? []).map((l: any) => ({ id: l.order_line_id, state: l.order_line_state })) },
    items: lines.map((l: any) => ({
      name: l.product_title ?? 'Produkt',
      sku: l.offer_sku ?? '',
      quantity: Number(l.quantity ?? 1),
      price: Number(l.price_unit ?? (l.price ?? 0) / Math.max(1, Number(l.quantity ?? 1))),
      auction_id: String(l.offer_id ?? ''),
      external_line_id: l.order_line_id ?? '',
      image: l.product_medias?.[0]?.media_url ?? '',
    })),
    canceled: ['CANCELED', 'REFUSED'].includes(o.order_state),
    importable: IMPORTABLE.has(o.order_state),
  };
}

export class EmpikConnector implements Connector {
  constructor(private ctx: ConnectorContext) {}

  private get base() {
    return empikBaseUrl(this.ctx.integration.credentials.base_url);
  }

  private api<T = any>(method: string, path: string, body?: unknown) {
    const key = this.ctx.integration.credentials.api_key;
    if (!key) throw new Error('Empik API key is missing');
    return request<T>(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: key,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async test() {
    const acc = await this.api<{ shop_name?: string; shop_id?: number }>('GET', '/api/account');
    return `Connected: ${acc.shop_name ?? acc.shop_id ?? 'OK'}`;
  }

  async fetchOrders(since: string) {
    const sinceIso = new Date(since.replace(' ', 'T') + 'Z').toISOString().replace(/\.\d{3}Z$/, 'Z');
    const out: MarketplaceOrder[] = [];
    const toAccept: any[] = [];
    for (let offset = 0; offset < 10000; offset += 100) {
      const res = await this.api<{ orders: any[]; total_count: number }>(
        'GET',
        `/api/orders?start_update_date=${encodeURIComponent(sinceIso)}&max=100&offset=${offset}&sort=dateCreated&order=asc`,
      );
      for (const o of res.orders ?? []) {
        if (o.order_state === 'WAITING_ACCEPTANCE') toAccept.push(o);
        out.push(mapMiraklOrder(o));
      }
      if (!res.orders?.length || offset + 100 >= (res.total_count ?? 0)) break;
    }
    if (this.ctx.integration.settings.auto_accept !== false) {
      for (const o of toAccept) {
        try {
          await this.api('PUT', `/api/orders/${encodeURIComponent(o.order_id)}/accept`, {
            order_lines: (o.order_lines ?? []).map((l: any) => ({ accepted: true, id: l.order_line_id })),
          });
          this.ctx.log(`Order ${o.order_id} accepted`);
        } catch (e: any) {
          this.ctx.log(`Order ${o.order_id} accept failed: ${e.message}`, 'warn');
        }
      }
    }
    return out;
  }

  async fetchOffers() {
    const out: MarketplaceOffer[] = [];
    for (let offset = 0; offset < 50000; offset += 100) {
      const res = await this.api<{ offers: any[]; total_count: number }>('GET', `/api/offers?max=100&offset=${offset}`);
      for (const o of res.offers ?? []) {
        const ean = (o.product_references ?? []).find((r: any) => r.reference_type === 'EAN')?.reference ?? '';
        out.push({
          external_id: String(o.offer_id),
          title: o.product_title ?? o.shop_sku ?? '',
          sku: o.shop_sku ?? '',
          ean,
          price: Number(o.price ?? 0),
          currency: o.currency_iso_code ?? 'PLN',
          stock: Number(o.quantity ?? 0),
          status: o.active ? 'active' : 'inactive',
          url: o.product_sku ? `https://www.empik.com/p,${encodeURIComponent(o.product_sku)},p` : '',
          image: '',
          raw: { product_sku: o.product_sku, state_code: o.state_code ?? '11' },
        });
      }
      if (!res.offers?.length || offset + 100 >= (res.total_count ?? 0)) break;
    }
    return out;
  }

  async updateOffer(offer: { sku: string; ean: string; raw: any }, change: { stock?: number; price?: number }) {
    // OF24 requires the current price and quantity, so the caller passes both.
    await this.api('POST', '/api/offers', {
      offers: [
        {
          shop_sku: offer.sku,
          product_id: offer.ean || offer.raw?.product_sku || offer.sku,
          product_id_type: offer.ean ? 'EAN' : 'SHOP_SKU',
          state_code: offer.raw?.state_code ?? '11',
          update_delete: 'update',
          ...(change.price !== undefined ? { price: change.price.toFixed(2) } : {}),
          ...(change.stock !== undefined ? { quantity: Math.max(0, change.stock) } : {}),
        },
      ],
    });
  }

  async setOrderStatus(order: { external_id: string; external_data: any }, code: string) {
    const id = encodeURIComponent(order.external_id);
    if (code === 'accept') {
      await this.api('PUT', `/api/orders/${id}/accept`, {
        order_lines: (order.external_data?.lines ?? []).map((l: any) => ({ accepted: true, id: l.id })),
      });
    } else if (code === 'ship') {
      await this.api('PUT', `/api/orders/${id}/ship`);
    } else if (code === 'cancel') {
      await this.api('PUT', `/api/orders/${id}/cancel`);
    } else throw new Error(`Unknown Empik action ${code}`);
  }

  async sendTracking(order: { external_id: string }, shipment: { courier: string; tracking_number: string }) {
    const c = CARRIERS[shipment.courier];
    const id = encodeURIComponent(order.external_id);
    await this.api('PUT', `/api/orders/${id}/tracking`, {
      ...(c ? { carrier_code: c.code, carrier_name: c.name } : { carrier_name: shipment.courier }),
      tracking_number: shipment.tracking_number,
    });
    // Mirakl requires an explicit "ship" confirmation after setting tracking.
    await this.api('PUT', `/api/orders/${id}/ship`);
  }

  async listingOptions(): Promise<ListingOptions> {
    return { requires_ean: true, requires_category: false };
  }

  /** Mirakl offers are attached to existing catalogue products identified by EAN (OF24). */
  async createOffer(input: ListingInput): Promise<MarketplaceOffer> {
    if (!input.ean) throw new Error('Empik requires the product EAN');
    const r = await this.api<{ import_id: number }>('POST', '/api/offers', {
      offers: [
        {
          shop_sku: input.sku || input.ean,
          product_id: input.ean,
          product_id_type: 'EAN',
          price: input.price.toFixed(2),
          quantity: Math.max(0, input.stock),
          state_code: '11',
          update_delete: 'update',
          description: input.description.slice(0, 2000),
          leadtime_to_ship: input.handling_time ?? 2,
        },
      ],
    });
    return {
      external_id: `pending-${r.import_id ?? Date.now()}-${input.sku || input.ean}`,
      title: input.title,
      sku: input.sku || input.ean,
      ean: input.ean,
      price: input.price,
      currency: 'PLN',
      stock: input.stock,
      status: 'pending',
      url: '',
      image: input.images[0] ?? '',
      raw: { import_id: r.import_id, state_code: '11' },
    };
  }

  async setOfferActive(offer: { sku: string; ean: string; price: number; stock: number; raw: any }, active: boolean) {
    await this.api('POST', '/api/offers', {
      offers: [
        {
          shop_sku: offer.sku,
          product_id: offer.ean || offer.raw?.product_sku || offer.sku,
          product_id_type: offer.ean ? 'EAN' : 'SHOP_SKU',
          price: offer.price.toFixed(2),
          quantity: active ? Math.max(0, offer.stock) : 0,
          state_code: offer.raw?.state_code ?? '11',
          update_delete: active ? 'update' : 'delete',
        },
      ],
    });
  }
}
