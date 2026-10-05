/**
 * Allegro REST API connector.
 * Docs: https://developer.allegro.pl/documentation
 */
import { ApiError, joinAddress, request } from './http.js';
import crypto from 'node:crypto';
import type { Connector, ConnectorContext, ListingInput, ListingOptions, MarketplaceOffer, MarketplaceOrder } from './types.js';

const MEDIA = 'application/vnd.allegro.public.v1+json';

export function allegroHosts(sandbox: boolean) {
  return sandbox
    ? { api: 'https://api.allegro.pl.allegrosandbox.pl', auth: 'https://allegro.pl.allegrosandbox.pl', web: 'https://allegro.pl.allegrosandbox.pl' }
    : { api: 'https://api.allegro.pl', auth: 'https://allegro.pl', web: 'https://allegro.pl' };
}

const CARRIERS: Record<string, string> = {
  inpost: 'INPOST',
  inpost_courier: 'INPOST',
  dpd: 'DPD',
  dhl: 'DHL',
  gls: 'GLS',
  ups: 'UPS',
  pocztex: 'POCZTA_POLSKA',
  orlen: 'ORLEN',
  allegro: 'ALLEGRO',
  fedex: 'FEDEX',
};

function basic(clientId: string, secret: string) {
  return `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`;
}

/** Step 1 of the OAuth device flow: returns the code the user must confirm on allegro.pl. */
export async function startDeviceAuth(creds: { client_id: string; client_secret: string; sandbox?: boolean }) {
  const h = allegroHosts(!!creds.sandbox);
  return request<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete: string;
    expires_in: number;
    interval: number;
  }>(`${h.auth}/auth/oauth/device`, {
    method: 'POST',
    headers: { Authorization: basic(creds.client_id, creds.client_secret), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: creds.client_id }).toString(),
    retries: 0,
  });
}

/** Step 2: exchanges the device code for tokens. Returns null while the user has not confirmed yet. */
export async function pollDeviceToken(creds: { client_id: string; client_secret: string; sandbox?: boolean }, deviceCode: string) {
  const h = allegroHosts(!!creds.sandbox);
  try {
    const t = await request<{ access_token: string; refresh_token: string; expires_in: number }>(
      `${h.auth}/auth/oauth/token?grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:device_code')}&device_code=${encodeURIComponent(deviceCode)}`,
      { method: 'POST', headers: { Authorization: basic(creds.client_id, creds.client_secret) }, retries: 0 },
    );
    return { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + t.expires_in * 1000 };
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) {
      const code = (e.body as any)?.error;
      if (code === 'authorization_pending' || code === 'slow_down') return null;
    }
    throw e;
  }
}

export function mapCheckoutForm(cf: any): MarketplaceOrder {
  const addr = cf.delivery?.address ?? {};
  const inv = cf.invoice?.address ?? {};
  const pp = cf.delivery?.pickupPoint;
  const currency = cf.summary?.totalToPay?.currency ?? cf.lineItems?.[0]?.price?.currency ?? 'PLN';
  const paymentType = cf.payment?.type ?? '';
  const paymentNames: Record<string, string> = {
    CASH_ON_DELIVERY: 'Pobranie',
    WIRE_TRANSFER: 'Przelew',
    ONLINE: 'Płatności Allegro',
    SPLIT_PAYMENT: 'Płatności Allegro',
    EXTENDED_TERM: 'Allegro Pay',
  };
  return {
    external_id: cf.id,
    source: 'allegro',
    date_add: toSqlDate(cf.lineItems?.[0]?.boughtAt ?? cf.updatedAt),
    user_login: cf.buyer?.login ?? '',
    email: cf.buyer?.email ?? '',
    phone: addr.phoneNumber ?? cf.buyer?.phoneNumber ?? '',
    currency,
    payment_method: paymentNames[paymentType] ?? (cf.payment?.provider || paymentType),
    payment_cod: paymentType === 'CASH_ON_DELIVERY' ? 1 : 0,
    paid_amount: Number(cf.payment?.paidAmount?.amount ?? 0),
    payment_date: cf.payment?.finishedAt ? toSqlDate(cf.payment.finishedAt) : null,
    delivery_method: cf.delivery?.method?.name ?? '',
    delivery_price: Number(cf.delivery?.cost?.amount ?? 0),
    delivery_fullname: joinAddress(addr.firstName, addr.lastName),
    delivery_company: addr.companyName ?? '',
    delivery_address: addr.street ?? '',
    delivery_postcode: addr.zipCode ?? '',
    delivery_city: addr.city ?? '',
    delivery_country_code: addr.countryCode ?? 'PL',
    delivery_point_id: pp?.id ?? '',
    delivery_point_name: pp?.name ?? '',
    delivery_point_address: pp?.address?.street ?? '',
    delivery_point_postcode: pp?.address?.zipCode ?? '',
    delivery_point_city: pp?.address?.city ?? '',
    invoice_wanted: cf.invoice?.required ? 1 : 0,
    invoice_fullname: joinAddress(inv.naturalPerson?.firstName, inv.naturalPerson?.lastName),
    invoice_company: inv.company?.name ?? '',
    invoice_nip: inv.company?.taxId ?? inv.company?.ids?.[0]?.value ?? '',
    invoice_address: inv.street ?? '',
    invoice_postcode: inv.zipCode ?? '',
    invoice_city: inv.city ?? '',
    invoice_country_code: inv.countryCode ?? 'PL',
    buyer_comment: cf.messageToSeller ?? '',
    external_status: [cf.status, cf.fulfillment?.status].filter(Boolean).join(' / '),
    external_data: { revision: cf.revision, fulfillment: cf.fulfillment?.status, buyer_id: cf.buyer?.id },
    items: (cf.lineItems ?? []).map((li: any) => ({
      name: li.offer?.name ?? 'Produkt',
      sku: li.offer?.external?.id ?? '',
      quantity: Number(li.quantity ?? 1),
      price: Number(li.price?.amount ?? li.originalPrice?.amount ?? 0),
      auction_id: li.offer?.id ?? '',
      external_line_id: li.id ?? '',
    })),
    canceled: cf.status === 'CANCELLED',
    importable: cf.status === 'READY_FOR_PROCESSING',
  };
}

export function toSqlDate(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  return (Number.isNaN(d.getTime()) ? new Date() : d).toISOString().replace('T', ' ').slice(0, 19);
}

export class AllegroConnector implements Connector {
  constructor(private ctx: ConnectorContext) {}

  private get creds() {
    return this.ctx.integration.credentials as { client_id: string; client_secret: string; sandbox?: boolean };
  }
  private get hosts() {
    return allegroHosts(!!this.creds.sandbox);
  }

  private async token(): Promise<string> {
    const st = this.ctx.integration.state;
    if (!st.refresh_token && !st.access_token) throw new Error('Allegro account is not authorized. Click "Authorize" in integration settings.');
    if (st.access_token && st.expires_at && st.expires_at > Date.now() + 60_000) return st.access_token;
    const t = await request<{ access_token: string; refresh_token: string; expires_in: number }>(
      `${this.hosts.auth}/auth/oauth/token?grant_type=refresh_token&refresh_token=${encodeURIComponent(st.refresh_token)}`,
      { method: 'POST', headers: { Authorization: basic(this.creds.client_id, this.creds.client_secret) }, retries: 1 },
    );
    const patch = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + t.expires_in * 1000 };
    Object.assign(st, patch);
    this.ctx.saveState(patch);
    return t.access_token;
  }

  private async api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const tok = await this.token();
    return request<T>(`${this.hosts.api}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${tok}`,
        Accept: MEDIA,
        ...(body !== undefined ? { 'Content-Type': MEDIA } : {}),
        'Accept-Language': 'pl-PL',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async test() {
    const me = await this.api<{ login: string; id: string }>('GET', '/me');
    return `Connected as ${me.login}`;
  }

  async fetchOrders(since: string) {
    const out: MarketplaceOrder[] = [];
    const sinceIso = new Date(since.replace(' ', 'T') + 'Z').toISOString();
    for (let offset = 0; offset < 10000; offset += 100) {
      const res = await this.api<{ checkoutForms: any[]; totalCount: number }>(
        'GET',
        `/order/checkout-forms?limit=100&offset=${offset}&updatedAt.gte=${encodeURIComponent(sinceIso)}&sort=updatedAt`,
      );
      for (const cf of res.checkoutForms ?? []) out.push(mapCheckoutForm(cf));
      if (!res.checkoutForms?.length || offset + 100 >= res.totalCount) break;
    }
    return out;
  }

  async fetchOffers() {
    const out: MarketplaceOffer[] = [];
    for (let offset = 0; offset < 50000; offset += 1000) {
      const res = await this.api<{ offers: any[]; totalCount: number }>('GET', `/sale/offers?limit=1000&offset=${offset}`);
      for (const o of res.offers ?? []) {
        out.push({
          external_id: String(o.id),
          title: o.name ?? '',
          sku: o.external?.id ?? '',
          ean: '',
          price: Number(o.sellingMode?.price?.amount ?? 0),
          currency: o.sellingMode?.price?.currency ?? 'PLN',
          stock: Number(o.stock?.available ?? 0),
          status: String(o.publication?.status ?? '').toLowerCase(),
          url: `${this.hosts.web}/oferta/${o.id}`,
          image: o.primaryImage?.url ?? '',
          raw: { category: o.category?.id },
        });
      }
      if (!res.offers?.length || offset + 1000 >= res.totalCount) break;
    }
    return out;
  }

  async updateOffer(offer: { external_id: string; currency: string }, change: { stock?: number; price?: number }) {
    const body: any = {};
    if (change.stock !== undefined) body.stock = { available: Math.max(0, change.stock), unit: 'UNIT' };
    if (change.price !== undefined) body.sellingMode = { price: { amount: change.price.toFixed(2), currency: offer.currency || 'PLN' } };
    await this.api('PATCH', `/sale/product-offers/${encodeURIComponent(offer.external_id)}`, body);
  }

  async setOrderStatus(order: { external_id: string }, code: string) {
    await this.api('PUT', `/order/checkout-forms/${encodeURIComponent(order.external_id)}/fulfillment`, { status: code });
  }

  async sendTracking(order: { external_id: string; items: { external_line_id: string }[] }, shipment: { courier: string; tracking_number: string }) {
    const carrierId = CARRIERS[shipment.courier] ?? 'OTHER';
    await this.api('POST', `/order/checkout-forms/${encodeURIComponent(order.external_id)}/shipments`, {
      carrierId,
      ...(carrierId === 'OTHER' ? { carrierName: shipment.courier } : {}),
      waybill: shipment.tracking_number,
      lineItems: order.items.filter((i) => i.external_line_id).map((i) => ({ id: i.external_line_id })),
    });
  }

  async listingOptions(): Promise<ListingOptions> {
    const r = await this.api<{ shippingRates: { id: string; name: string }[] }>('GET', '/sale/shipping-rates');
    const me = await this.api<{ id: string }>('GET', '/me');
    // After-sales conditions defined by the seller on Allegro (returns, complaints, warranty).
    const conditions = async (kind: string, key: string) => {
      try {
        const res = await this.api<Record<string, { id: string; name: string }[]>>('GET', `/after-sales-service-conditions/${kind}?seller.id=${encodeURIComponent(me.id)}`);
        return (res[key] ?? []).map((x) => ({ id: x.id, name: x.name }));
      } catch {
        return [];
      }
    };
    return {
      shipping_rates: (r.shippingRates ?? []).map((x) => ({ id: x.id, name: x.name })),
      return_policies: await conditions('return-policies', 'returnPolicies'),
      implied_warranties: await conditions('implied-warranties', 'impliedWarranties'),
      warranties: await conditions('warranties', 'warranties'),
      requires_ean: false,
      requires_category: false,
    };
  }

  async createOffer(input: ListingInput): Promise<MarketplaceOffer> {
    const html = input.description
      ? input.description
          .split(/\n{2,}/)
          .map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
          .join('')
      : `<p>${input.title}</p>`;
    const body: any = {
      name: input.title.slice(0, 75),
      productSet: [
        {
          product: input.ean
            ? { id: input.ean, idType: 'GTIN' }
            : { name: input.title.slice(0, 75), category: input.category_id ? { id: input.category_id } : undefined, images: input.images },
        },
      ],
      sellingMode: { format: 'BUY_NOW', price: { amount: input.price.toFixed(2), currency: input.currency || 'PLN' } },
      stock: { available: Math.max(0, input.stock), unit: 'UNIT' },
      external: input.sku ? { id: input.sku } : undefined,
      images: input.images,
      description: { sections: [{ items: [{ type: 'TEXT', content: html }] }] },
      publication: { status: 'ACTIVE' },
    };
    if (input.category_id) body.category = { id: input.category_id };
    if (input.shipping_rates_id || input.handling_time !== undefined) {
      body.delivery = {
        ...(input.shipping_rates_id ? { shippingRates: { id: input.shipping_rates_id } } : {}),
        ...(input.handling_time !== undefined ? { handlingTime: allegroHandlingTime(input.handling_time) } : {}),
      };
    }
    if (input.return_policy_id || input.implied_warranty_id || input.warranty_id) {
      body.afterSalesServices = {
        ...(input.return_policy_id ? { returnPolicy: { id: input.return_policy_id } } : {}),
        ...(input.implied_warranty_id ? { impliedWarranty: { id: input.implied_warranty_id } } : {}),
        ...(input.warranty_id ? { warranty: { id: input.warranty_id } } : {}),
      };
    }
    const o = await this.api<any>('POST', '/sale/product-offers', body);
    return {
      external_id: String(o.id),
      title: o.name ?? input.title,
      sku: input.sku,
      ean: input.ean,
      price: input.price,
      currency: input.currency || 'PLN',
      stock: input.stock,
      status: String(o.publication?.status ?? 'activating').toLowerCase(),
      url: `${this.hosts.web}/oferta/${o.id}`,
      image: input.images[0] ?? '',
    };
  }

  async setOfferActive(offer: { external_id: string }, active: boolean) {
    await this.api('PUT', `/sale/offer-publication-commands/${crypto.randomUUID()}`, {
      publication: { action: active ? 'ACTIVATE' : 'END' },
      offerCriteria: [{ offers: [{ id: offer.external_id }], type: 'CONTAINS_OFFERS' }],
    });
  }
}

/** Handling time in days → the nearest allowed Allegro value that is not shorter. */
export function allegroHandlingTime(days: number): string {
  const allowed = [0, 1, 2, 3, 4, 5, 7, 10, 14, 21, 30, 60];
  const d = allowed.find((a) => a >= days) ?? 60;
  return d === 0 ? 'PT0S' : d === 1 ? 'PT24H' : `P${d}D`;
}
