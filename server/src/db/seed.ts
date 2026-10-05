import type { DB } from './index.js';

type Lang = 'pl' | 'en' | 'ru';

const T: Record<Lang, Record<string, string>> = {
  pl: {
    g_to_send: 'Do wysłania',
    g_ended: 'Zakończone',
    s_new: 'Nowe zamówienia',
    s_new_short: 'Nowe',
    s_paid: 'Opłacone',
    s_to_send: 'Do wysłania',
    s_sent: 'Wysłane',
    s_canceled: 'Anulowane',
    s_new_full: 'Zamówienie przyjęte',
    s_paid_full: 'Zamówienie opłacone',
    s_to_send_full: 'W trakcie realizacji',
    s_sent_full: 'Zamówienie wysłane',
    s_canceled_full: 'Zamówienie anulowane',
    r_new: 'Nowy zwrot',
    r_progress: 'W trakcie',
    r_received: 'Paczka odebrana',
    r_refunded: 'Zwrócono środki',
    r_rejected: 'Odrzucony',
    t_confirm: 'Potwierdzenie zamówienia',
    t_confirm_subject: 'Dziękujemy za zamówienie nr [order_id]',
    t_confirm_body:
      'Dzień dobry [buyer_name],\n\ndziękujemy za złożenie zamówienia nr [order_id] na kwotę [total] [currency].\nStatus zamówienia możesz sprawdzić tutaj: [order_link]\n\nPozdrawiamy,\n[company_name]',
    t_sent: 'Zamówienie wysłane',
    t_sent_subject: 'Zamówienie nr [order_id] zostało wysłane',
    t_sent_body:
      'Dzień dobry [buyer_name],\n\nTwoje zamówienie nr [order_id] zostało wysłane.\nNumer przesyłki: [tracking_number]\n\nPozdrawiamy,\n[company_name]',
    wh: 'Magazyn główny',
    cat: 'Katalog główny',
    pg: 'Detaliczna',
    inv: 'Faktury',
    pro: 'Proformy',
    rec: 'Paragony',
    cor: 'Korekty',
  },
  en: {
    g_to_send: 'To send',
    g_ended: 'Ended',
    s_new: 'New orders',
    s_new_short: 'New',
    s_paid: 'Paid',
    s_to_send: 'To send',
    s_sent: 'Sent',
    s_canceled: 'Canceled',
    s_new_full: 'Order received',
    s_paid_full: 'Order paid',
    s_to_send_full: 'In progress',
    s_sent_full: 'Order shipped',
    s_canceled_full: 'Order canceled',
    r_new: 'New return',
    r_progress: 'In progress',
    r_received: 'Parcel received',
    r_refunded: 'Refunded',
    r_rejected: 'Rejected',
    t_confirm: 'Order confirmation',
    t_confirm_subject: 'Thank you for your order no. [order_id]',
    t_confirm_body:
      'Hello [buyer_name],\n\nthank you for your order no. [order_id], total [total] [currency].\nYou can check the order status here: [order_link]\n\nBest regards,\n[company_name]',
    t_sent: 'Order shipped',
    t_sent_subject: 'Order no. [order_id] has been shipped',
    t_sent_body:
      'Hello [buyer_name],\n\nyour order no. [order_id] has been shipped.\nTracking number: [tracking_number]\n\nBest regards,\n[company_name]',
    wh: 'Main warehouse',
    cat: 'Main catalog',
    pg: 'Retail',
    inv: 'Invoices',
    pro: 'Pro forma',
    rec: 'Receipts',
    cor: 'Corrections',
  },
  ru: {
    g_to_send: 'К отправке',
    g_ended: 'Завершённые',
    s_new: 'Новые заказы',
    s_new_short: 'Новые',
    s_paid: 'Оплаченные',
    s_to_send: 'К отправке',
    s_sent: 'Отправленные',
    s_canceled: 'Отменённые',
    s_new_full: 'Заказ принят',
    s_paid_full: 'Заказ оплачен',
    s_to_send_full: 'В обработке',
    s_sent_full: 'Заказ отправлен',
    s_canceled_full: 'Заказ отменён',
    r_new: 'Новый возврат',
    r_progress: 'В обработке',
    r_received: 'Посылка получена',
    r_refunded: 'Деньги возвращены',
    r_rejected: 'Отклонён',
    t_confirm: 'Подтверждение заказа',
    t_confirm_subject: 'Спасибо за заказ № [order_id]',
    t_confirm_body:
      'Здравствуйте, [buyer_name]!\n\nСпасибо за заказ № [order_id] на сумму [total] [currency].\nСтатус заказа: [order_link]\n\nС уважением,\n[company_name]',
    t_sent: 'Заказ отправлен',
    t_sent_subject: 'Заказ № [order_id] отправлен',
    t_sent_body:
      'Здравствуйте, [buyer_name]!\n\nВаш заказ № [order_id] отправлен.\nНомер отправления: [tracking_number]\n\nС уважением,\n[company_name]',
    wh: 'Основной склад',
    cat: 'Основной каталог',
    pg: 'Розничная',
    inv: 'Счета-фактуры',
    pro: 'Проформы',
    rec: 'Чеки',
    cor: 'Корректировки',
  },
};

/** Inserts the default configuration on an empty database. Idempotent. */
export function seedDefaults(db: DB, langParam = 'pl') {
  const has = db.prepare('SELECT COUNT(*) c FROM order_statuses').get() as { c: number };
  if (has.c > 0) return;
  const lang = (['pl', 'en', 'ru'].includes(langParam) ? langParam : 'pl') as Lang;
  const t = T[lang];

  db.transaction(() => {
    const g = db.prepare('INSERT INTO status_groups (name, sort) VALUES (?, ?)');
    const gToSend = g.run(t.g_to_send, 1).lastInsertRowid;
    const gEnded = g.run(t.g_ended, 2).lastInsertRowid;

    const s = db.prepare(
      'INSERT INTO order_statuses (name, short_name, full_name, color, group_id, sort, system_key) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    s.run(t.s_new, t.s_new_short, t.s_new_full, '#0f74d4', null, 1, 'new');
    s.run(t.s_paid, t.s_paid, t.s_paid_full, '#6f42c1', null, 2, 'paid');
    s.run(t.s_to_send, t.s_to_send, t.s_to_send_full, '#f0803c', gToSend, 3, 'to_send');
    s.run(t.s_sent, t.s_sent, t.s_sent_full, '#219653', gEnded, 4, 'sent');
    s.run(t.s_canceled, t.s_canceled, t.s_canceled_full, '#d9363e', gEnded, 5, 'canceled');

    const r = db.prepare('INSERT INTO return_statuses (name, color, sort, system_key) VALUES (?, ?, ?, ?)');
    r.run(t.r_new, '#0f74d4', 1, 'new');
    r.run(t.r_progress, '#f0803c', 2, 'progress');
    r.run(t.r_received, '#6f42c1', 3, 'received');
    r.run(t.r_refunded, '#219653', 4, 'refunded');
    r.run(t.r_rejected, '#d9363e', 5, 'rejected');

    db.prepare(`INSERT INTO warehouses (name, code, is_default) VALUES (?, 'MAG1', 1)`).run(t.wh);
    db.prepare('INSERT INTO catalogs (name, is_default) VALUES (?, 1)').run(t.cat);
    // The default catalog uses the default warehouse and price group (BaseLinker-like catalog settings).
    db.prepare(`UPDATE price_groups SET name = ? WHERE is_default = 1`).run(t.pg);
    db.prepare(
      `UPDATE catalogs SET default_warehouse_id = (SELECT id FROM warehouses WHERE is_default = 1),
         default_price_group_id = (SELECT id FROM price_groups WHERE is_default = 1),
         languages = ?, default_language = ? WHERE is_default = 1`,
    ).run(JSON.stringify(['pl']), 'pl');
    db.prepare('INSERT OR IGNORE INTO catalog_warehouses (catalog_id, warehouse_id) SELECT c.id, w.id FROM catalogs c, warehouses w').run();
    db.prepare('INSERT OR IGNORE INTO catalog_price_groups (catalog_id, price_group_id) SELECT c.id, g.id FROM catalogs c, price_groups g').run();

    const ser = db.prepare('INSERT INTO invoice_series (name, type, format, reset_period, is_default) VALUES (?, ?, ?, ?, 1)');
    ser.run(t.inv, 'invoice', 'FV %N/%M/%Y', 'month');
    ser.run(t.pro, 'proforma', 'PRO %N/%M/%Y', 'month');
    ser.run(t.rec, 'receipt', 'PAR %N/%M/%Y', 'month');
    ser.run(t.cor, 'correction', 'KOR %N/%M/%Y', 'month');

    const tpl = db.prepare('INSERT INTO email_templates (name, subject, body) VALUES (?, ?, ?)');
    tpl.run(t.t_confirm, t.t_confirm_subject, t.t_confirm_body);
    tpl.run(t.t_sent, t.t_sent_subject, t.t_sent_body);

    const set = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    set.run(
      'company',
      JSON.stringify({
        name: 'Moja Firma Sp. z o.o.',
        nip: '',
        address: '',
        postcode: '',
        city: '',
        country: 'PL',
        email: '',
        phone: '',
        bank_account: '',
        bank_name: '',
      }),
    );
    set.run(
      'orders',
      JSON.stringify({
        stock_deduct: 'on_create',
        stock_restore_on_cancel: true,
        default_tax_rate: 23,
        orders_per_page: 50,
        extra_field_1_label: '',
        extra_field_2_label: '',
      }),
    );
    set.run('smtp', JSON.stringify({ host: '', port: 587, secure: false, user: '', password: '', from: '' }));
  })();
}
