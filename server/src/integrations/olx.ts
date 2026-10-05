/**
 * OLX.pl connector (OLX Partner API v2, https://developer.olx.pl).
 * Authorization: OAuth2 "authorization code" — the seller logs in on OLX and
 * is redirected back to /api/public/oauth/olx/callback.
 *
 * OLX adverts have no quantity: stock synchronization deactivates an advert
 * when stock drops to 0 and activates it again when stock returns.
 * Orders of "Przesyłka OLX" are not available in the public Partner API, so
 * the connector manages adverts only.
 */
import { config } from '../config.js';
import { request } from './http.js';
import type { Connector, ConnectorContext, ListingInput, ListingOptions, MarketplaceOffer, MarketplaceOrder } from './types.js';

export const OLX_AUTHORIZE_URL = 'https://www.olx.pl/oauth/authorize/';
const OLX_API = 'https://www.olx.pl/api';
const SCOPE = 'v2 read write';

export const olxRedirectUri = () => `${config.appUrl}/api/public/oauth/olx/callback`;

export function olxAuthorizeUrl(clientId: string, state: string) {
  const q = new URLSearchParams({ client_id: clientId, response_type: 'code', scope: SCOPE, state, redirect_uri: olxRedirectUri() });
  return `${OLX_AUTHORIZE_URL}?${q}`;
}

export async function olxExchangeCode(creds: { client_id: string; client_secret: string }, code: string) {
  return request<{ access_token: string; refresh_token: string; expires_in: number }>(`${OLX_API}/open/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'authorization_code', client_id: creds.client_id, client_secret: creds.client_secret, code, scope: SCOPE, redirect_uri: olxRedirectUri() }),
    retries: 0,
  });
}

/** OLX advert statuses → panel offer status. */
const ACTIVE = new Set(['active', 'new', 'unconfirmed', 'moderated']);

export function mapAdvert(a: any): MarketplaceOffer {
  const status = ACTIVE.has(a.status) ? 'active' : a.status === 'limited' ? 'inactive' : 'ended';
  return {
    external_id: String(a.id),
    title: a.title ?? '',
    sku: a.external_id ?? '',
    ean: '',
    price: Number(a.price?.value ?? 0),
    currency: a.price?.currency ?? 'PLN',
    // No quantity on OLX: an active advert means "available".
    stock: status === 'active' ? 1 : 0,
    status,
    url: a.url ?? `https://www.olx.pl/d/oferta/${a.id}`,
    image: a.images?.[0]?.url ?? '',
    raw: { status: a.status, category_id: a.category_id, location: a.location },
  };
}

export class OlxConnector implements Connector {
  constructor(private ctx: ConnectorContext) {}

  private get creds() {
    return this.ctx.integration.credentials as { client_id?: string; client_secret?: string };
  }

  private async token(): Promise<string> {
    const st = this.ctx.integration.state;
    if (!st.refresh_token) throw new Error('OLX account is not authorized — click "Authorize OLX account" in the integration settings');
    if (st.access_token && Number(st.expires_at) > Date.now() + 60_000) return st.access_token;
    const t = await request<{ access_token: string; refresh_token?: string; expires_in: number }>(`${OLX_API}/open/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', client_id: this.creds.client_id, client_secret: this.creds.client_secret, refresh_token: st.refresh_token }),
      retries: 1,
    });
    const patch = { access_token: t.access_token, refresh_token: t.refresh_token ?? st.refresh_token, expires_at: Date.now() + t.expires_in * 1000 };
    this.ctx.saveState(patch);
    Object.assign(st, patch);
    return t.access_token;
  }

  private async api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.token();
    return request<T>(`${OLX_API}/partner${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Version: '2.0',
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async test() {
    const me = await this.api<{ data: { name?: string; email?: string } }>('GET', '/users/me');
    return `Connected: ${me.data?.name || me.data?.email || 'OLX'}`;
  }

  async fetchOrders(): Promise<MarketplaceOrder[]> {
    // "Przesyłka OLX" orders are not exposed by the public Partner API.
    return [];
  }

  async fetchOffers(): Promise<MarketplaceOffer[]> {
    const out: MarketplaceOffer[] = [];
    for (let offset = 0; offset < 5000; offset += 50) {
      const r = await this.api<{ data: any[] }>('GET', `/adverts?offset=${offset}&limit=50`);
      out.push(...(r.data ?? []).map(mapAdvert));
      if ((r.data ?? []).length < 50) break;
    }
    return out;
  }

  private command(id: string, command: 'activate' | 'deactivate' | 'finish') {
    return this.api('POST', `/adverts/${encodeURIComponent(id)}/commands`, command === 'deactivate' ? { command, is_success: true } : { command });
  }

  async updateOffer(offer: { external_id: string; raw: any }, change: { stock?: number; price?: number }) {
    if (change.price !== undefined) {
      // PUT replaces the whole advert, so the current one is read and only the price changed.
      const cur = await this.api<{ data: any }>('GET', `/adverts/${encodeURIComponent(offer.external_id)}`);
      const a = cur.data;
      await this.api('PUT', `/adverts/${encodeURIComponent(offer.external_id)}`, {
        title: a.title,
        description: a.description,
        category_id: a.category_id,
        advertiser_type: a.advertiser_type,
        external_id: a.external_id,
        contact: a.contact,
        location: a.location,
        images: a.images,
        attributes: a.attributes,
        price: { ...(a.price ?? {}), value: change.price, currency: a.price?.currency ?? 'PLN' },
      });
    }
    if (change.stock !== undefined) {
      const active = offer.raw?.status ? ACTIVE.has(offer.raw.status) : true;
      if (change.stock <= 0 && active) await this.command(offer.external_id, 'deactivate');
      if (change.stock > 0 && !active) await this.command(offer.external_id, 'activate');
    }
  }

  async setOrderStatus() {
    throw new Error('OLX orders are not supported by the OLX Partner API');
  }

  async sendTracking() {
    throw new Error('OLX orders are not supported by the OLX Partner API');
  }

  async listingOptions(): Promise<ListingOptions> {
    return { requires_ean: false, requires_category: true };
  }

  async createOffer(input: ListingInput): Promise<MarketplaceOffer> {
    const s = this.ctx.integration.settings as Record<string, any>;
    if (!input.category_id) throw new Error('Choose an OLX category id');
    if (!s.olx_city_id) throw new Error('Set the city (OLX city id) in the integration settings');
    if (input.description.length < 80) throw new Error('OLX requires a description of at least 80 characters');
    const r = await this.api<{ data: any }>('POST', '/adverts', {
      title: input.title.slice(0, 70),
      description: input.description,
      category_id: Number(input.category_id),
      advertiser_type: s.olx_advertiser_type === 'private' ? 'private' : 'business',
      external_id: input.sku || undefined,
      contact: { name: s.olx_contact_name || 'Sprzedawca', phone: s.olx_contact_phone || undefined },
      location: { city_id: Number(s.olx_city_id) },
      price: { value: input.price, currency: input.currency, negotiable: false, trade: false },
      images: input.images.slice(0, 8).map((url) => ({ url })),
      attributes: [],
    });
    return mapAdvert(r.data);
  }

  async setOfferActive(offer: { external_id: string }, active: boolean) {
    await this.command(offer.external_id, active ? 'activate' : 'deactivate');
  }
}
