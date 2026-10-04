/**
 * Demo connector — simulates a marketplace account so every feature can be
 * tried without API keys. Offers live in the integration state; each sync may
 * "receive" a few new orders.
 */
import { toSqlDate } from './allegro.js';
import { DEMO_CITIES, DEMO_DELIVERY, DEMO_FIRST, DEMO_LAST, DEMO_PRODUCTS, rnd, rndInt } from './demo-data.js';
import type { Connector, ConnectorContext, IntegrationType, MarketplaceOffer, MarketplaceOrder } from './types.js';

const URLS: Record<IntegrationType, (id: string) => string> = {
  allegro: (id) => `https://allegro.pl/oferta/${id}`,
  empik: (id) => `https://www.empik.com/p,${id},p`,
  kaufland: (id) => `https://www.kaufland.pl/product/${id}/`,
};

function strip(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase();
}

export class DemoConnector implements Connector {
  constructor(
    private ctx: ConnectorContext,
    private type: IntegrationType,
  ) {}

  private offers(): MarketplaceOffer[] {
    let offers = this.ctx.integration.state.demo_offers as MarketplaceOffer[] | undefined;
    if (!offers) {
      offers = DEMO_PRODUCTS.filter((p) => p.markets.includes(this.type)).map((p, i) => {
        const id = this.type === 'allegro' ? String(14000000000 + rndInt(1, 999999999)) : this.type === 'kaufland' ? String(400000000 + i * 7919) : `P${1000 + i}`;
        // Marketplace prices differ slightly from the shop price.
        const markup = this.type === 'kaufland' ? 1.05 : this.type === 'empik' ? 0.98 : 1;
        return {
          external_id: id,
          title: p.name,
          sku: p.sku,
          ean: p.ean,
          price: Math.round(p.price * markup * 100) / 100,
          currency: 'PLN',
          stock: p.stock,
          status: 'active',
          url: URLS[this.type](id),
          image: '',
        };
      });
      this.ctx.saveState({ demo_offers: offers });
      this.ctx.integration.state.demo_offers = offers;
    }
    return offers;
  }

  async test() {
    return 'Demo mode — simulated account works';
  }

  private makeOrder(date: Date): MarketplaceOrder {
    const first = rnd(DEMO_FIRST);
    const last = rnd(DEMO_LAST);
    const [city, post, street] = rnd(DEMO_CITIES);
    const delivery = rnd(DEMO_DELIVERY[this.type]);
    const offers = this.offers();
    const n = Math.random() < 0.75 ? 1 : rndInt(2, 3);
    const available = offers.filter((o) => o.stock > 0);
    const picked = [...(available.length ? available : offers)].sort(() => Math.random() - 0.5).slice(0, n);
    const items = picked.map((o, i) => ({
      name: o.title,
      sku: o.sku,
      ean: o.ean,
      quantity: Math.random() < 0.85 ? 1 : 2,
      price: o.price,
      auction_id: o.external_id,
      external_line_id: `${Date.now()}${i}${rndInt(100, 999)}`,
    }));
    const total = items.reduce((s, i) => s + i.price * i.quantity, 0) + delivery.price;
    const company = Math.random() < 0.15;
    const login = `${strip(first)}_${strip(last)}${rndInt(1, 99)}`;
    const ext =
      this.type === 'allegro'
        ? crypto.randomUUID()
        : this.type === 'empik'
          ? `${rndInt(10000000, 99999999)}-A`
          : String(rndInt(100000000, 999999999));
    const point = delivery.point ? { id: `${city.slice(0, 3).toUpperCase()}${rndInt(10, 99)}M`, name: `Paczkomat ${city} ${rndInt(1, 300)}` } : null;
    return {
      external_id: ext,
      source: this.type,
      date_add: toSqlDate(date.toISOString()),
      user_login: this.type === 'allegro' ? login : `${first} ${last}`,
      email: `${login}+${rndInt(1000, 9999)}@${this.type === 'allegro' ? 'allegromail.pl' : this.type === 'empik' ? 'marketplace.empik.com' : 'kaufland-marketplace.pl'}`,
      phone: `+48 ${rndInt(500, 799)} ${rndInt(100, 999)} ${rndInt(100, 999)}`,
      currency: 'PLN',
      payment_method: delivery.cod ? 'Pobranie' : this.type === 'allegro' ? 'Płatności Allegro' : this.type === 'empik' ? 'Empik' : 'Kaufland',
      payment_cod: delivery.cod ? 1 : 0,
      paid_amount: delivery.cod ? 0 : Math.round(total * 100) / 100,
      payment_date: delivery.cod ? null : toSqlDate(date.toISOString()),
      delivery_method: delivery.name,
      delivery_price: delivery.price,
      delivery_fullname: `${first} ${last}`,
      delivery_company: '',
      delivery_address: `${street} ${rndInt(1, 120)}${Math.random() < 0.5 ? `/${rndInt(1, 40)}` : ''}`,
      delivery_postcode: post,
      delivery_city: city,
      delivery_country_code: 'PL',
      delivery_point_id: point?.id ?? '',
      delivery_point_name: point?.name ?? '',
      delivery_point_address: point ? `${street} ${rndInt(1, 50)}` : '',
      delivery_point_postcode: point ? post : '',
      delivery_point_city: point ? city : '',
      invoice_wanted: company ? 1 : 0,
      invoice_fullname: company ? `${first} ${last}` : '',
      invoice_company: company ? `${last} Consulting Sp. z o.o.` : '',
      invoice_nip: company ? String(rndInt(1000000000, 9999999999)) : '',
      invoice_address: company ? `${street} ${rndInt(1, 120)}` : '',
      invoice_postcode: company ? post : '',
      invoice_city: company ? city : '',
      invoice_country_code: 'PL',
      buyer_comment: Math.random() < 0.15 ? rnd(['Proszę o szybką wysyłkę :)', 'Prezent — proszę nie wkładać paragonu', 'Proszę o kontakt telefoniczny przed dostawą']) : '',
      external_status: this.type === 'allegro' ? 'READY_FOR_PROCESSING / NEW' : this.type === 'empik' ? 'SHIPPING' : 'need_to_be_sent',
      external_data: { demo: true },
      items,
      importable: true,
    };
  }

  async fetchOrders(since: string) {
    const st = this.ctx.integration.state;
    const out: MarketplaceOrder[] = [];
    if (!st.demo_initialized) {
      // First sync: a history of orders from the last days.
      const count = rndInt(6, 10);
      for (let i = 0; i < count; i++) {
        const d = new Date(Date.now() - rndInt(1, 6 * 24 * 60) * 60_000);
        out.push(this.makeOrder(d));
      }
      this.ctx.saveState({ demo_initialized: true });
    } else {
      const sinceMs = new Date(since.replace(' ', 'T') + 'Z').getTime();
      const minutes = Math.max(1, (Date.now() - sinceMs) / 60_000);
      // Roughly one order per 10 minutes, at most 4 per sync.
      const count = Math.min(4, Math.floor(minutes / 10 + Math.random()));
      for (let i = 0; i < count; i++) out.push(this.makeOrder(new Date(Date.now() - rndInt(0, Math.min(minutes, 60)) * 60_000)));
    }
    return out.sort((a, b) => String(a.date_add).localeCompare(String(b.date_add)));
  }

  async fetchOffers() {
    return this.offers();
  }

  async updateOffer(offer: { external_id: string }, change: { stock?: number; price?: number }) {
    const offers = this.offers();
    const o = offers.find((x) => x.external_id === offer.external_id);
    if (!o) throw new Error('Offer not found');
    if (change.stock !== undefined) o.stock = Math.max(0, change.stock);
    if (change.price !== undefined) o.price = change.price;
    this.ctx.saveState({ demo_offers: offers });
  }

  async setOrderStatus(order: { external_id: string }, code: string) {
    this.ctx.log(`[demo] Order ${order.external_id}: status ${code} sent to ${this.type}`);
  }

  async sendTracking(order: { external_id: string }, shipment: { courier: string; tracking_number: string }) {
    this.ctx.log(`[demo] Order ${order.external_id}: tracking ${shipment.tracking_number} (${shipment.courier}) sent to ${this.type}`);
  }
}
