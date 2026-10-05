import { db, setSetting, getSetting } from '../db/index.js';
import { DEMO_PRODUCTS } from '../integrations/demo-data.js';
import { syncOffers, syncOrders } from '../integrations/sync.js';
import { changeStatus, statusIdByKey } from './orders.js';
import { createReturn } from './returns.js';
import { createShipment } from './shipments.js';
import { adjustStock, defaultCatalogId, defaultPriceGroupId } from './stock.js';

/** Fills an empty account with sample products, demo marketplace accounts and rules. */
export async function seedDemo() {
  const has = (db.prepare('SELECT COUNT(*) c FROM products').get() as { c: number }).c;
  if (has === 0) {
    const cats = new Map<string, number>();
    const mans = new Map<string, number>();
    const catalogId = defaultCatalogId();
    for (const p of DEMO_PRODUCTS) {
      if (!cats.has(p.category)) cats.set(p.category, Number(db.prepare('INSERT INTO categories (name, catalog_id) VALUES (?, ?)').run(p.category, catalogId).lastInsertRowid));
      if (!mans.has(p.manufacturer)) mans.set(p.manufacturer, Number(db.prepare('INSERT INTO manufacturers (name) VALUES (?)').run(p.manufacturer).lastInsertRowid));
      const id = Number(
        db
          .prepare(
            `INSERT INTO products (catalog_id, sku, ean, name, description, price, purchase_price, avg_cost, tax_rate, weight, location, category_id, manufacturer_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(catalogId, p.sku, p.ean, p.name, `${p.name} — opis produktu.`, p.price, p.purchase, p.purchase, p.category === 'Książki' ? 5 : 23, p.weight, p.location, cats.get(p.category), mans.get(p.manufacturer))
          .lastInsertRowid,
      );
      db.prepare('INSERT INTO product_prices (product_id, price_group_id, price) VALUES (?, ?, ?)').run(id, defaultPriceGroupId(), p.price);
      if (p.stock) adjustStock(id, p.stock, 'BO — stan początkowy');
    }
  }
  const company = getSetting<any>('company', {});
  if (!company.nip) {
    setSetting('company', {
      ...company,
      nip: '5252525252',
      address: 'ul. Przykładowa 1',
      postcode: '00-950',
      city: 'Warszawa',
      country: 'PL',
      email: 'sklep@example.com',
      phone: '+48 22 123 45 67',
      bank_account: 'PL61 1090 1014 0000 0712 1981 2874',
      bank_name: 'Santander Bank Polska',
    });
  }
  const integ = (db.prepare('SELECT COUNT(*) c FROM integrations').get() as { c: number }).c;
  const ids: number[] = [];
  if (integ === 0) {
    const sent = (db.prepare(`SELECT id FROM order_statuses WHERE system_key = 'sent'`).get() as { id: number }).id;
    const canceled = (db.prepare(`SELECT id FROM order_statuses WHERE system_key = 'canceled'`).get() as { id: number }).id;
    const toSend = (db.prepare(`SELECT id FROM order_statuses WHERE system_key = 'to_send'`).get() as { id: number }).id;
    const add = (type: string, name: string, map: Record<string, string>) =>
      Number(
        db
          .prepare('INSERT INTO integrations (type, name, demo, credentials, settings) VALUES (?, ?, 1, ?, ?)')
          .run(type, name, '{}', JSON.stringify({ import_days: 7, send_tracking: true, sync_stock: true, auto_link: true, sync_cancel: true, auto_accept: true, status_map: map }))
          .lastInsertRowid,
      );
    ids.push(add('allegro', 'Allegro — moj_sklep (demo)', { [toSend]: 'PROCESSING', [sent]: 'SENT', [canceled]: 'CANCELLED' }));
    ids.push(add('empik', 'Empik Marketplace (demo)', { [sent]: 'ship', [canceled]: 'cancel' }));
    ids.push(add('kaufland', 'Kaufland.pl (demo)', { [canceled]: 'cancel' }));

    const rules = (db.prepare('SELECT COUNT(*) c FROM rules').get() as { c: number }).c;
    if (rules === 0) {
      const paid = (db.prepare(`SELECT id FROM order_statuses WHERE system_key = 'paid'`).get() as { id: number }).id;
      const tpl = (db.prepare('SELECT id FROM email_templates ORDER BY id LIMIT 1').get() as { id: number }).id;
      const ins = db.prepare('INSERT INTO rules (name, enabled, event, conditions, actions, sort) VALUES (?, ?, ?, ?, ?, ?)');
      ins.run(
        'Opłacone zamówienia → Do wysłania',
        1,
        'order_paid',
        JSON.stringify([]),
        JSON.stringify([{ type: 'set_status', params: { status_id: toSend } }]),
        1,
      );
      ins.run(
        'Faktura dla firm (chce fakturę)',
        1,
        'status_changed',
        JSON.stringify([
          { field: 'status_id', op: 'in', value: [toSend] },
          { field: 'invoice_wanted', op: 'true', value: true },
        ]),
        JSON.stringify([{ type: 'issue_invoice', params: {} }]),
        2,
      );
      ins.run(
        'Pobranie → Do wysłania',
        1,
        'order_created',
        JSON.stringify([{ field: 'payment_cod', op: 'true', value: true }]),
        JSON.stringify([{ type: 'set_status', params: { status_id: toSend } }]),
        3,
      );
      ins.run(
        'E-mail z potwierdzeniem zamówienia',
        0,
        'order_created',
        JSON.stringify([{ field: 'source', op: 'in', value: ['manual'] }]),
        JSON.stringify([{ type: 'send_email', params: { template_id: tpl } }]),
        4,
      );
      void paid;
    }
  }
  for (const id of ids) {
    await syncOffers(id).catch(() => undefined);
    await syncOrders(id).catch(() => undefined);
  }
  if (ids.length) shapeDemoOrders();
}

/** Spreads demo orders over statuses so the panel looks like a working store. */
function shapeDemoOrders() {
  const sent = statusIdByKey('sent');
  const canceled = statusIdByKey('canceled');
  const fresh = statusIdByKey('new');
  const orders = db.prepare('SELECT id, date_add, source, payment_cod FROM orders ORDER BY date_add').all() as any[];
  const couriers: Record<string, string[]> = { allegro: ['allegro', 'inpost'], empik: ['inpost', 'dpd'], kaufland: ['dhl', 'inpost_courier'] };
  let returned = false;
  orders.forEach((o, i) => {
    const ageH = (Date.now() - Date.parse(o.date_add.replace(' ', 'T') + 'Z')) / 3_600_000;
    try {
      if (i === 2) changeStatus(o.id, canceled, 'Demo');
      else if (ageH > 48) {
        const list = couriers[o.source] ?? ['inpost'];
        const sid = createShipment(o.id, { courier: list[i % list.length] }, 'Demo');
        db.prepare(`UPDATE shipments SET status = ?, label_printed = 1 WHERE id = ?`).run(ageH > 96 ? 'delivered' : 'in_transit', sid);
        changeStatus(o.id, sent, 'Demo');
        if (!returned && ageH > 96) {
          createReturn({ order_id: o.id, reason: 'Produkt nie spełnia oczekiwań' }, 'Demo');
          returned = true;
        }
      } else if (ageH < 12 && !o.payment_cod) {
        db.prepare(`UPDATE orders SET status_id = ?, status_changed_at = date_add WHERE id = ?`).run(fresh, o.id);
      }
    } catch (e) {
      console.error('[demo] shaping order failed', e);
    }
  });
}
