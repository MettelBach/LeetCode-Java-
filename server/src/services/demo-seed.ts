import { db, setSetting, getSetting } from '../db/index.js';
import { DEMO_PRODUCTS } from '../integrations/demo-data.js';
import { syncOffers, syncOrders } from '../integrations/sync.js';
import { adjustStock } from './stock.js';

/** Fills an empty account with sample products, demo marketplace accounts and rules. */
export async function seedDemo() {
  const has = (db.prepare('SELECT COUNT(*) c FROM products').get() as { c: number }).c;
  if (has === 0) {
    const cats = new Map<string, number>();
    const mans = new Map<string, number>();
    for (const p of DEMO_PRODUCTS) {
      if (!cats.has(p.category)) cats.set(p.category, Number(db.prepare('INSERT INTO categories (name) VALUES (?)').run(p.category).lastInsertRowid));
      if (!mans.has(p.manufacturer)) mans.set(p.manufacturer, Number(db.prepare('INSERT INTO manufacturers (name) VALUES (?)').run(p.manufacturer).lastInsertRowid));
      const id = Number(
        db
          .prepare(
            `INSERT INTO products (sku, ean, name, description, price, purchase_price, tax_rate, weight, location, category_id, manufacturer_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(p.sku, p.ean, p.name, `${p.name} — opis produktu.`, p.price, p.purchase, p.category === 'Książki' ? 5 : 23, p.weight, p.location, cats.get(p.category), mans.get(p.manufacturer))
          .lastInsertRowid,
      );
      if (p.stock) adjustStock(id, p.stock, 'initial stock');
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
}
