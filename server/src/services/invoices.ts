import { db, getSetting, parseJson, tx } from '../db/index.js';
import { addDays, isValidDate, warsawToday } from '../lib/dates.js';
import { HttpError, notFound, round2 } from '../lib/http.js';
import { emit } from './events.js';
import { addHistory, getOrder } from './orders.js';

export type InvoiceType = 'invoice' | 'proforma' | 'receipt' | 'correction';

export interface InvoiceItem {
  name: string;
  sku?: string;
  quantity: number;
  unit?: string;
  price_gross: number;
  tax_rate: number;
}

export interface Party {
  name: string;
  company?: string;
  nip?: string;
  address?: string;
  postcode?: string;
  city?: string;
  country?: string;
  email?: string;
  bank_account?: string;
  bank_name?: string;
}

export function computeTotals(items: InvoiceItem[]) {
  let gross = 0;
  let net = 0;
  const byRate: Record<string, { net: number; tax: number; gross: number }> = {};
  for (const it of items) {
    const g = round2(it.price_gross * it.quantity);
    const n = round2(g / (1 + it.tax_rate / 100));
    gross += g;
    net += n;
    const k = String(it.tax_rate);
    byRate[k] ??= { net: 0, tax: 0, gross: 0 };
    byRate[k].net = round2(byRate[k].net + n);
    byRate[k].gross = round2(byRate[k].gross + g);
    byRate[k].tax = round2(byRate[k].gross - byRate[k].net);
  }
  gross = round2(gross);
  net = round2(net);
  return { total_gross: gross, total_net: net, total_tax: round2(gross - net), by_rate: byRate };
}

function periodKey(reset: string, date: Date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  if (reset === 'year') return `${y}`;
  if (reset === 'never') return 'all';
  return `${y}-${m}`;
}

export function formatNumber(format: string, seq: number, date: Date) {
  return format
    .replace(/%N/g, String(seq))
    .replace(/%M/g, String(date.getUTCMonth() + 1).padStart(2, '0'))
    .replace(/%Y/g, String(date.getUTCFullYear()))
    .replace(/%y/g, String(date.getUTCFullYear()).slice(2));
}

function nextNumber(seriesId: number, issueDate: Date) {
  const s = db.prepare('SELECT * FROM invoice_series WHERE id = ?').get(seriesId) as any;
  if (!s) throw new HttpError(400, 'Unknown invoice series');
  const period = periodKey(s.reset_period, issueDate);
  const r = db.prepare('SELECT MAX(seq) m FROM invoices WHERE series_id = ? AND period = ?').get(seriesId, period) as { m: number | null };
  // Numbers follow dates: a document cannot be dated before the last one of its series.
  const last = db.prepare('SELECT MAX(issue_date) d FROM invoices WHERE series_id = ? AND period = ?').get(seriesId, period) as { d: string | null };
  const iso = issueDate.toISOString().slice(0, 10);
  if (last.d && iso < last.d) throw new HttpError(400, `The issue date cannot be earlier than the last document of this series (${last.d})`);
  const seq = (r.m ?? 0) + 1;
  return { seq, period, number: formatNumber(s.format, seq, issueDate) };
}

function defaultSeries(type: InvoiceType): number {
  const s = (db.prepare('SELECT id FROM invoice_series WHERE type = ? ORDER BY is_default DESC, id LIMIT 1').get(type) ?? null) as {
    id: number;
  } | null;
  if (!s) throw new HttpError(400, `No invoice series for ${type}`);
  return s.id;
}

export function buyerFromOrder(o: any): Party {
  const useInvoice = o.invoice_fullname || o.invoice_company || o.invoice_address;
  return useInvoice
    ? {
        name: o.invoice_fullname || o.delivery_fullname,
        company: o.invoice_company,
        nip: o.invoice_nip,
        address: o.invoice_address,
        postcode: o.invoice_postcode,
        city: o.invoice_city,
        country: o.invoice_country_code,
        email: o.email,
      }
    : {
        name: o.delivery_fullname,
        company: o.delivery_company,
        nip: '',
        address: o.delivery_address,
        postcode: o.delivery_postcode,
        city: o.delivery_city,
        country: o.delivery_country_code,
        email: o.email,
      };
}

export function itemsFromOrder(orderId: number): InvoiceItem[] {
  const o = getOrder(orderId);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId) as any[];
  const out: InvoiceItem[] = items.map((i) => ({
    name: i.name + (i.attributes ? ` (${i.attributes})` : ''),
    sku: i.sku,
    quantity: i.quantity,
    unit: 'szt.',
    price_gross: i.price,
    tax_rate: i.tax_rate,
  }));
  if (o.delivery_price > 0) {
    const maxRate = items.reduce((m, i) => Math.max(m, i.tax_rate), 0) || getSetting('orders', { default_tax_rate: 23 } as any).default_tax_rate;
    out.push({ name: o.delivery_method || 'Shipping', quantity: 1, unit: 'usł.', price_gross: o.delivery_price, tax_rate: maxRate });
  }
  return out;
}

export interface IssueOptions {
  series_id?: number;
  issue_date?: string;
  sale_date?: string;
  payment_due_days?: number;
  user?: string;
  notes?: string;
  /** Automation chain the document is issued from (loop protection). */
  meta?: { depth?: number; ruleIds?: number[] };
}

export function issueForOrder(orderId: number, type: Exclude<InvoiceType, 'correction'>, opts: IssueOptions = {}): number {
  const o = getOrder(orderId);
  if (o.deleted) throw new HttpError(400, 'The order is in the bin');
  let notes = opts.notes;
  if (type !== 'proforma') {
    const existing = db.prepare('SELECT number FROM invoices WHERE order_id = ? AND type = ?').get(orderId, type) as { number: string } | undefined;
    if (existing) throw new HttpError(409, `Document already issued: ${existing.number}`);
    if (type === 'receipt') {
      const inv = db.prepare(`SELECT number FROM invoices WHERE order_id = ? AND type = 'invoice'`).get(orderId) as { number: string } | undefined;
      if (inv) throw new HttpError(409, `The order already has an invoice: ${inv.number}`);
    } else {
      // An invoice to an issued receipt ("faktura do paragonu") refers to it.
      const rec = db.prepare(`SELECT number FROM invoices WHERE order_id = ? AND type = 'receipt'`).get(orderId) as { number: string } | undefined;
      if (rec) notes = [`Faktura do paragonu nr ${rec.number}`, notes].filter(Boolean).join('\n');
    }
  }
  const items = itemsFromOrder(orderId);
  if (!items.length) throw new HttpError(400, 'Order has no products');
  const id = createInvoice({
    order_id: orderId,
    type,
    series_id: opts.series_id,
    issue_date: opts.issue_date,
    sale_date: opts.sale_date ?? o.date_add.slice(0, 10),
    payment_method: o.payment_method,
    paid: o.paid_amount > 0,
    currency: o.currency,
    buyer: buyerFromOrder(o),
    items,
    payment_due_days: opts.payment_due_days,
    notes,
  });
  const inv = db.prepare('SELECT number FROM invoices WHERE id = ?').get(id) as { number: string };
  const label = type === 'receipt' ? 'Receipt' : type === 'proforma' ? 'Pro forma' : 'Invoice';
  addHistory(orderId, `${label} issued: ${inv.number}`, 'invoice', opts.user ?? 'System');
  emit(type === 'receipt' ? 'receipt_created' : 'invoice_created', { orderId, user: opts.user, invoiceId: id, ...opts.meta });
  return id;
}

export interface CreateInvoiceInput {
  order_id?: number | null;
  type: InvoiceType;
  series_id?: number;
  issue_date?: string;
  sale_date?: string;
  payment_method?: string;
  payment_due_days?: number;
  paid?: boolean;
  currency?: string;
  buyer: Party;
  items: InvoiceItem[];
  corrected_invoice_id?: number;
  correction_reason?: string;
  notes?: string;
}

export function createInvoice(input: CreateInvoiceInput): number {
  return tx(() => {
    const issueStr = input.issue_date ?? warsawToday();
    if (!isValidDate(issueStr)) throw new HttpError(400, 'Invalid issue date');
    if (input.sale_date !== undefined && !isValidDate(input.sale_date)) throw new HttpError(400, 'Invalid sale date');
    const issue = new Date(`${issueStr}T00:00:00Z`);
    const seriesId = input.series_id ?? defaultSeries(input.type);
    const { seq, period, number } = nextNumber(seriesId, issue);
    const company = getSetting<Party & Record<string, string>>('company', { name: '' });
    const totals =
      input.type === 'correction' && input.corrected_invoice_id
        ? correctionTotals(input.corrected_invoice_id, input.items)
        : computeTotals(input.items);
    const r = db
      .prepare(
        `INSERT INTO invoices (order_id, series_id, type, number, seq, period, issue_date, sale_date, payment_due, payment_method, paid, currency,
          buyer, seller, items, total_net, total_tax, total_gross, corrected_invoice_id, correction_reason, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.order_id ?? null,
        seriesId,
        input.type,
        number,
        seq,
        period,
        issueStr,
        input.sale_date ?? issueStr,
        addDays(issueStr, input.payment_due_days ?? 7),
        input.payment_method ?? '',
        input.paid ? 1 : 0,
        input.currency ?? 'PLN',
        JSON.stringify(input.buyer),
        JSON.stringify({
          name: company.name,
          nip: company.nip,
          address: company.address,
          postcode: company.postcode,
          city: company.city,
          country: company.country,
          email: company.email,
          phone: company.phone,
          bank_account: company.bank_account,
          bank_name: company.bank_name,
        }),
        JSON.stringify(input.items),
        totals.total_net,
        totals.total_tax,
        totals.total_gross,
        input.corrected_invoice_id ?? null,
        input.correction_reason ?? '',
        input.notes ?? '',
      );
    return Number(r.lastInsertRowid);
  });
}

/**
 * Items of an invoice as they stand before correction `beforeId` (or now):
 * the latest earlier correction, otherwise the invoice itself.
 */
function stateBefore(originalId: number, beforeId = Number.MAX_SAFE_INTEGER): { id: number; number: string; items: InvoiceItem[]; issue_date: string } {
  const row = (db
    .prepare(`SELECT id, number, items, issue_date FROM invoices WHERE corrected_invoice_id = ? AND type = 'correction' AND id < ? ORDER BY id DESC LIMIT 1`)
    .get(originalId, beforeId) ?? db.prepare('SELECT id, number, items, issue_date FROM invoices WHERE id = ?').get(originalId)) as any;
  if (!row) throw notFound('Corrected invoice not found');
  return { ...row, items: parseJson<InvoiceItem[]>(row.items, []) };
}

function correctionTotals(originalId: number, newItems: InvoiceItem[]) {
  // The difference is counted from the latest state, so a second correction does not repeat the first.
  const before = computeTotals(stateBefore(originalId).items);
  const after = computeTotals(newItems);
  return {
    total_net: round2(after.total_net - before.total_net),
    total_tax: round2(after.total_tax - before.total_tax),
    total_gross: round2(after.total_gross - before.total_gross),
  };
}

/** Issues a correction invoice with new item values ("after correction"). */
export function createCorrection(invoiceId: number, items: InvoiceItem[], reason: string, user = 'System'): number {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any;
  if (!inv) throw notFound('Invoice not found');
  if (inv.type !== 'invoice' && inv.type !== 'correction') throw new HttpError(400, 'Only invoices can be corrected');
  // Every correction refers to the original invoice; correcting a correction continues the chain.
  const original = inv.type === 'correction' ? db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.corrected_invoice_id) as any : inv;
  if (!original) throw notFound('Corrected invoice not found');
  const id = createInvoice({
    order_id: inv.order_id,
    type: 'correction',
    sale_date: inv.sale_date,
    payment_method: inv.payment_method,
    currency: inv.currency,
    buyer: parseJson(original.buyer, { name: '' }),
    items,
    corrected_invoice_id: original.id,
    correction_reason: reason,
  });
  if (inv.order_id) {
    const c = db.prepare('SELECT number FROM invoices WHERE id = ?').get(id) as { number: string };
    addHistory(inv.order_id, `Correction issued: ${c.number} (to ${original.number})`, 'invoice', user);
  }
  return id;
}

export function getInvoice(id: number) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as any;
  if (!inv) throw notFound('Invoice not found');
  // "Before correction" shows the state this correction changed (the previous correction, if any);
  // the document it refers to is always the original invoice.
  let corrected: any = null;
  if (inv.corrected_invoice_id) {
    const orig = db.prepare('SELECT id, number, issue_date FROM invoices WHERE id = ?').get(inv.corrected_invoice_id) as any;
    const prev = stateBefore(inv.corrected_invoice_id, inv.id);
    corrected = { ...orig, items: prev.items, previous_correction: prev.id !== orig?.id ? { id: prev.id, number: prev.number } : null };
  }
  return {
    ...inv,
    buyer: parseJson(inv.buyer, {}),
    seller: parseJson(inv.seller, {}),
    items: parseJson(inv.items, []),
    totals: computeTotals(parseJson(inv.items, [])),
    corrected,
  };
}

export function deleteInvoice(id: number, user = 'System') {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as any;
  if (!inv) throw notFound('Invoice not found');
  // Only the last number in a series/period may be removed, so numbering stays continuous.
  const last = db.prepare('SELECT MAX(seq) m FROM invoices WHERE series_id = ? AND period = ?').get(inv.series_id, inv.period) as { m: number };
  if (inv.type !== 'proforma' && last.m !== inv.seq) throw new HttpError(409, 'Only the last document in a series can be deleted');
  const hasCorrections = db.prepare('SELECT 1 FROM invoices WHERE corrected_invoice_id = ?').get(id);
  if (hasCorrections) throw new HttpError(409, 'Invoice has corrections');
  db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
  if (inv.order_id) addHistory(inv.order_id, `Document deleted: ${inv.number}`, 'invoice', user);
}
