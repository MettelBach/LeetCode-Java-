import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { db, getSetting } from '../db/index.js';
import { notFound } from '../lib/http.js';
import { addHistory, getOrder, orderTotal } from './orders.js';

interface Smtp {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

/** Replaces [tags] in a template with order data. */
export function renderTemplate(text: string, orderId: number): string {
  const o = getOrder(orderId);
  const company = getSetting<any>('company', {});
  const status = db.prepare('SELECT full_name, name FROM order_statuses WHERE id = ?').get(o.status_id) as any;
  const tracking = (db.prepare('SELECT tracking_number FROM shipments WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(orderId) as any)
    ?.tracking_number;
  const items = (db.prepare('SELECT name, quantity, price FROM order_items WHERE order_id = ?').all(orderId) as any[])
    .map((i) => `${i.quantity} x ${i.name} — ${i.price.toFixed(2)} ${o.currency}`)
    .join('\n');
  const tags: Record<string, string> = {
    order_id: String(o.id),
    external_id: o.external_id ?? '',
    buyer_name: o.delivery_fullname || o.invoice_fullname || o.user_login,
    buyer_login: o.user_login,
    buyer_email: o.email,
    total: orderTotal(orderId).toFixed(2),
    currency: o.currency,
    paid: o.paid_amount.toFixed(2),
    status: status?.full_name || status?.name || '',
    delivery_method: o.delivery_method,
    payment_method: o.payment_method,
    tracking_number: tracking ?? '',
    products: items,
    company_name: company.name ?? '',
    order_link: `${config.appUrl}/order/${o.id}/${o.token}`,
  };
  return text.replace(/\[([a-z_]+)\]/g, (m, k) => (k in tags ? tags[k] : m));
}

export async function sendTemplateEmail(orderId: number, templateId: number, user = 'System') {
  const tpl = db.prepare('SELECT * FROM email_templates WHERE id = ?').get(templateId) as any;
  if (!tpl) throw notFound('Email template not found');
  const o = getOrder(orderId);
  return sendEmail(orderId, o.email, renderTemplate(tpl.subject, orderId), renderTemplate(tpl.body, orderId), user);
}

export async function sendEmail(orderId: number | null, to: string, subject: string, body: string, user = 'System') {
  const smtp = getSetting<Smtp>('smtp', { host: '', port: 587, secure: false, user: '', password: '', from: '' });
  let status = 'sent';
  if (!to) status = 'error: no recipient';
  else if (!smtp.host) status = 'not sent: SMTP not configured';
  else {
    try {
      const transport = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
      });
      await transport.sendMail({ from: smtp.from || smtp.user, to, subject, text: body });
    } catch (e: any) {
      status = `error: ${e.message}`;
    }
  }
  db.prepare('INSERT INTO email_log (order_id, to_address, subject, body, status) VALUES (?, ?, ?, ?, ?)').run(orderId, to, subject, body, status);
  if (orderId) addHistory(orderId, `E-mail "${subject}" to ${to || '-'}: ${status}`, 'email', user);
  return status;
}
