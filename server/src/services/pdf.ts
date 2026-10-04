import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getSetting, parseJson } from '../db/index.js';
import { computeTotals, getInvoice, type InvoiceItem } from './invoices.js';
import { orderTotal } from './orders.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FONT = path.resolve(here, '../../assets/fonts/DejaVuSans.ttf');
const FONT_BOLD = path.resolve(here, '../../assets/fonts/DejaVuSans-Bold.ttf');

function newDoc(opts: PDFKit.PDFDocumentOptions = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, ...opts });
  doc.registerFont('r', FONT);
  doc.registerFont('b', FONT_BOLD);
  doc.font('r');
  return doc;
}

function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

const money = (n: number) => n.toFixed(2).replace('.', ',');

const TITLES: Record<string, string> = {
  invoice: 'Faktura VAT',
  proforma: 'Faktura pro forma',
  receipt: 'Paragon',
  correction: 'Faktura korygująca',
};

function partyBlock(doc: PDFKit.PDFDocument, title: string, p: any, x: number, y: number, w: number) {
  doc.font('b').fontSize(9).fillColor('#666').text(title.toUpperCase(), x, y, { width: w });
  doc.moveDown(0.3).font('b').fontSize(10).fillColor('#000');
  if (p.company) doc.text(p.company, { width: w });
  if (p.name && p.name !== p.company) doc.font(p.company ? 'r' : 'b').text(p.name, { width: w });
  doc.font('r');
  if (p.address) doc.text(p.address, { width: w });
  if (p.postcode || p.city) doc.text(`${p.postcode ?? ''} ${p.city ?? ''}`.trim(), { width: w });
  if (p.country && p.country !== 'PL') doc.text(p.country, { width: w });
  if (p.nip) doc.text(`NIP: ${p.nip}`, { width: w });
  if (p.email) doc.text(p.email, { width: w });
  return doc.y;
}

function itemsTable(doc: PDFKit.PDFDocument, items: InvoiceItem[], y: number, currency: string, heading?: string) {
  const cols = [
    { k: 'lp', t: 'Lp.', w: 25, a: 'left' },
    { k: 'name', t: 'Nazwa', w: 205, a: 'left' },
    { k: 'qty', t: 'Ilość', w: 40, a: 'right' },
    { k: 'unit', t: 'J.m.', w: 30, a: 'left' },
    { k: 'gross', t: 'Cena brutto', w: 65, a: 'right' },
    { k: 'vat', t: 'VAT', w: 35, a: 'right' },
    { k: 'net', t: 'Wartość netto', w: 55, a: 'right' },
    { k: 'sum', t: 'Wartość brutto', w: 60, a: 'right' },
  ] as const;
  const x0 = 40;
  if (heading) {
    doc.font('b').fontSize(9).text(heading, x0, y);
    y = doc.y + 4;
  }
  doc.rect(x0, y, 515, 18).fill('#eef2f7');
  doc.fillColor('#000').font('b').fontSize(8);
  let x = x0;
  for (const c of cols) {
    doc.text(c.t, x + 3, y + 5, { width: c.w - 6, align: c.a as any });
    x += c.w;
  }
  y += 20;
  doc.font('r').fontSize(8);
  items.forEach((it, i) => {
    const gross = it.price_gross * it.quantity;
    const net = gross / (1 + it.tax_rate / 100);
    const vals: Record<string, string> = {
      lp: String(i + 1),
      name: it.name,
      qty: String(it.quantity),
      unit: it.unit ?? 'szt.',
      gross: money(it.price_gross),
      vat: `${it.tax_rate}%`,
      net: money(net),
      sum: money(gross),
    };
    const h = Math.max(14, doc.heightOfString(it.name, { width: 199 }) + 4);
    if (y + h > 760) {
      doc.addPage();
      y = 40;
    }
    let cx = x0;
    for (const c of cols) {
      doc.text(vals[c.k], cx + 3, y + 2, { width: c.w - 6, align: c.a as any });
      cx += c.w;
    }
    y += h;
    doc.moveTo(x0, y).lineTo(x0 + 515, y).strokeColor('#dde2e8').stroke();
  });
  doc.font('r').fontSize(8).text(`Waluta: ${currency}`, x0, y + 4);
  return y + 16;
}

export async function invoicePdf(id: number): Promise<Buffer> {
  const inv = getInvoice(id);
  const doc = newDoc();
  doc.font('b').fontSize(18).fillColor('#0f74d4').text(`${TITLES[inv.type] ?? 'Dokument'} nr ${inv.number}`, 40, 40);
  doc.fillColor('#000').font('r').fontSize(9);
  doc.text(`Data wystawienia: ${inv.issue_date}`, 380, 80, { width: 175, align: 'right' });
  doc.text(`Data sprzedaży: ${inv.sale_date}`, { width: 175, align: 'right' });
  if (inv.type !== 'receipt') doc.text(`Termin płatności: ${inv.payment_due ?? '-'}`, { width: 175, align: 'right' });
  if (inv.corrected) {
    doc.text(`Dotyczy faktury: ${inv.corrected.number} z dnia ${inv.corrected.issue_date}`, 40, 80);
    if (inv.correction_reason) doc.text(`Przyczyna korekty: ${inv.correction_reason}`, 40);
  }
  const y1 = partyBlock(doc, 'Sprzedawca', inv.seller, 40, 130, 240);
  const y2 = partyBlock(doc, 'Nabywca', inv.buyer, 315, 130, 240);
  let y = Math.max(y1, y2) + 20;

  if (inv.type === 'correction' && inv.corrected) {
    y = itemsTable(doc, inv.corrected.items, y, inv.currency, 'Przed korektą');
    y = itemsTable(doc, inv.items, y + 6, inv.currency, 'Po korekcie');
  } else {
    y = itemsTable(doc, inv.items, y, inv.currency);
  }

  // VAT summary
  const totals = computeTotals(inv.items);
  y += 6;
  doc.font('b').fontSize(8).text('Stawka VAT', 315, y, { width: 60 });
  doc.text('Netto', 375, y, { width: 60, align: 'right' });
  doc.text('VAT', 435, y, { width: 55, align: 'right' });
  doc.text('Brutto', 490, y, { width: 65, align: 'right' });
  y += 14;
  doc.font('r');
  for (const [rate, v] of Object.entries(totals.by_rate)) {
    doc.text(`${rate}%`, 315, y, { width: 60 });
    doc.text(money(v.net), 375, y, { width: 60, align: 'right' });
    doc.text(money(v.tax), 435, y, { width: 55, align: 'right' });
    doc.text(money(v.gross), 490, y, { width: 65, align: 'right' });
    y += 12;
  }
  y += 10;
  const label = inv.type === 'correction' ? 'Różnica do zapłaty / zwrotu' : 'Razem do zapłaty';
  doc.font('b').fontSize(12).text(`${label}: ${money(inv.total_gross)} ${inv.currency}`, 40, y, { width: 515, align: 'right' });
  y = doc.y + 10;
  doc.font('r').fontSize(9);
  if (inv.payment_method) doc.text(`Sposób płatności: ${inv.payment_method}`, 40, y);
  doc.text(`Status: ${inv.paid ? 'zapłacono' : 'do zapłaty'}`);
  if (inv.seller.bank_account) doc.text(`Konto bankowe: ${inv.seller.bank_account} ${inv.seller.bank_name ?? ''}`);
  if (inv.notes) doc.moveDown().text(`Uwagi: ${inv.notes}`);
  doc.moveDown(4);
  const sy = doc.y;
  doc.moveTo(60, sy).lineTo(240, sy).strokeColor('#999').stroke();
  doc.moveTo(335, sy).lineTo(515, sy).stroke();
  doc.fontSize(7).fillColor('#666').text('Osoba upoważniona do odbioru', 60, sy + 4, { width: 180, align: 'center' });
  doc.text('Osoba upoważniona do wystawienia', 335, sy + 4, { width: 180, align: 'center' });
  return toBuffer(doc);
}

/* ---------------- Code 128 (set B) barcode for shipping labels ---------------- */
const C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232',
  '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122',
  '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311',
  '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113',
  '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422',
  '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111',
  '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121',
  '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
];

export function code128B(text: string): string[] {
  const codes = [104];
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) continue;
    codes.push(c - 32);
  }
  let sum = codes[0];
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
  codes.push(sum % 103, 106);
  return codes.map((c) => C128[c]);
}

function drawBarcode(doc: PDFKit.PDFDocument, text: string, x: number, y: number, width: number, height: number) {
  const patterns = code128B(text);
  const modules = patterns.reduce((s, p) => s + [...p].reduce((a, d) => a + Number(d), 0), 0);
  const unit = width / modules;
  let cx = x;
  for (const p of patterns) {
    [...p].forEach((d, i) => {
      const w = Number(d) * unit;
      if (i % 2 === 0) doc.rect(cx, y, w, height).fill('#000');
      cx += w;
    });
  }
}

const COURIER_NAMES: Record<string, string> = {
  inpost: 'InPost Paczkomaty',
  inpost_courier: 'InPost Kurier',
  dpd: 'DPD Polska',
  dhl: 'DHL Parcel',
  gls: 'GLS Poland',
  ups: 'UPS',
  pocztex: 'Poczta Polska / Pocztex',
  orlen: 'ORLEN Paczka',
  allegro: 'Allegro One / Wysyłam z Allegro',
  fedex: 'FedEx',
  other: 'Kurier',
};
export const courierName = (c: string) => COURIER_NAMES[c] ?? c;

export async function labelPdf(shipmentIds: number[]): Promise<Buffer> {
  // 100x150 mm labels (A6-like) — standard thermal label size.
  const W = 283.46;
  const H = 425.2;
  const doc = newDoc({ size: [W, H], margin: 12, autoFirstPage: false });
  const company = getSetting<any>('company', {});
  for (const sid of shipmentIds) {
    const s = db.prepare('SELECT * FROM shipments WHERE id = ?').get(sid) as any;
    if (!s) continue;
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(s.order_id) as any;
    doc.addPage();
    doc.rect(8, 8, W - 16, H - 16).lineWidth(1.5).strokeColor('#000').stroke();
    doc.font('b').fontSize(14).fillColor('#000').text(courierName(s.courier).toUpperCase(), 16, 18, { width: W - 32 });
    if (s.service) doc.font('r').fontSize(8).text(s.service, { width: W - 32 });
    doc.moveTo(8, 50).lineTo(W - 8, 50).stroke();
    doc.font('b').fontSize(7).text('NADAWCA', 16, 56);
    doc.font('r').fontSize(8).text([company.name, company.address, `${company.postcode ?? ''} ${company.city ?? ''}`, company.phone].filter(Boolean).join('\n'), 16, 66, {
      width: W - 32,
    });
    doc.moveTo(8, 118).lineTo(W - 8, 118).stroke();
    doc.font('b').fontSize(7).text('ODBIORCA', 16, 124);
    const recipient = o.delivery_point_id
      ? [o.delivery_fullname, `Punkt: ${o.delivery_point_id} ${o.delivery_point_name}`, o.delivery_point_address, `${o.delivery_point_postcode} ${o.delivery_point_city}`, o.phone]
      : [o.delivery_fullname, o.delivery_company, o.delivery_address, `${o.delivery_postcode} ${o.delivery_city}`, o.delivery_country_code, o.phone];
    doc.font('b').fontSize(11).text(recipient.filter((x: string) => x && x.trim()).join('\n'), 16, 136, { width: W - 32 });
    const by = 250;
    doc.moveTo(8, by - 8).lineTo(W - 8, by - 8).stroke();
    if (s.tracking_number) {
      drawBarcode(doc, s.tracking_number, 24, by, W - 48, 70);
      doc.font('b').fontSize(11).fillColor('#000').text(s.tracking_number, 16, by + 76, { width: W - 32, align: 'center' });
    }
    doc.font('r').fontSize(8).fillColor('#000');
    const info = [
      `Zamówienie: ${o.id}${o.external_id ? ` (${o.external_id})` : ''}`,
      `Waga: ${s.weight || '-'} kg  ${s.size ? `Gabaryt: ${s.size}` : ''}`,
      s.cod_amount > 0 ? `POBRANIE: ${money(s.cod_amount)} ${o.currency}` : '',
      `Data: ${s.created_at.slice(0, 10)}`,
    ].filter(Boolean);
    doc.text(info.join('\n'), 16, by + 100, { width: W - 32 });
  }
  if (!shipmentIds.length) doc.addPage();
  return toBuffer(doc);
}

/** Order card / packing list printout for one or more orders. */
export async function ordersPrintout(orderIds: number[], kind: 'order_card' | 'packing_list' | 'pick_list'): Promise<Buffer> {
  const doc = newDoc({ autoFirstPage: false });
  if (kind === 'pick_list') {
    doc.addPage();
    doc.font('b').fontSize(16).text('Lista zbiorcza produktów (pick list)', 40, 40);
    doc.font('r').fontSize(9).text(`Zamówienia: ${orderIds.join(', ')}`, { width: 515 });
    const rows = orderIds.length
      ? (db
          .prepare(
            `SELECT name, sku, ean, location, SUM(quantity) qty FROM order_items WHERE order_id IN (${orderIds.map(() => '?').join(',')})
             GROUP BY name, sku, ean, location ORDER BY location, name`,
          )
          .all(...orderIds) as any[])
      : [];
    let y = doc.y + 16;
    doc.rect(40, y, 515, 18).fill('#eef2f7').fillColor('#000').font('b').fontSize(8);
    doc.text('Ilość', 44, y + 5, { width: 40 });
    doc.text('Nazwa', 90, y + 5, { width: 250 });
    doc.text('SKU', 345, y + 5, { width: 80 });
    doc.text('EAN', 425, y + 5, { width: 80 });
    doc.text('Lokalizacja', 500, y + 5, { width: 55 });
    y += 22;
    doc.font('r');
    for (const r of rows) {
      const h = Math.max(14, doc.heightOfString(r.name, { width: 250 }) + 4);
      if (y + h > 790) {
        doc.addPage();
        y = 40;
      }
      doc.font('b').text(String(r.qty), 44, y, { width: 40 }).font('r');
      doc.text(r.name, 90, y, { width: 250 });
      doc.text(r.sku, 345, y, { width: 80 });
      doc.text(r.ean, 425, y, { width: 80 });
      doc.text(r.location, 500, y, { width: 55 });
      y += h;
      doc.moveTo(40, y - 2).lineTo(555, y - 2).strokeColor('#dde2e8').stroke();
    }
    return toBuffer(doc);
  }
  for (const id of orderIds) {
    const o = db.prepare('SELECT o.*, s.name status_name FROM orders o JOIN order_statuses s ON s.id = o.status_id WHERE o.id = ?').get(id) as any;
    if (!o) continue;
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(id) as any[];
    doc.addPage();
    doc.font('b').fontSize(16).text(kind === 'packing_list' ? `List przewozowy / packing list — zamówienie ${o.id}` : `Zamówienie ${o.id}`, 40, 40);
    doc.font('r').fontSize(9).fillColor('#555');
    doc.text(
      `Data: ${o.date_add}   Źródło: ${o.source}${o.external_id ? ` (${o.external_id})` : ''}   Status: ${o.status_name}`,
    );
    doc.fillColor('#000');
    const y0 = doc.y + 12;
    partyBlock(doc, 'Adres dostawy', {
      name: o.delivery_fullname,
      company: o.delivery_company,
      address: o.delivery_address,
      postcode: o.delivery_postcode,
      city: o.delivery_city,
      country: o.delivery_country_code,
    }, 40, y0, 240);
    doc.text(`Tel: ${o.phone}`, 40).text(`E-mail: ${o.email}`, 40);
    if (o.delivery_point_id) doc.text(`Punkt odbioru: ${o.delivery_point_id} ${o.delivery_point_name}`, 40, undefined, { width: 240 });
    let yy = doc.y;
    if (kind === 'order_card') {
      doc.font('b').fontSize(9).text('DOSTAWA I PŁATNOŚĆ', 315, y0);
      doc.font('r').fontSize(10);
      doc.text(`Metoda dostawy: ${o.delivery_method}`, 315, undefined, { width: 240 });
      doc.text(`Koszt dostawy: ${money(o.delivery_price)} ${o.currency}`, 315, undefined, { width: 240 });
      doc.text(`Płatność: ${o.payment_method}${o.payment_cod ? ' (pobranie)' : ''}`, 315, undefined, { width: 240 });
      doc.text(`Zapłacono: ${money(o.paid_amount)} z ${money(orderTotal(id))} ${o.currency}`, 315, undefined, { width: 240 });
      yy = Math.max(yy, doc.y);
    }
    let y = yy + 16;
    doc.rect(40, y, 515, 18).fill('#eef2f7').fillColor('#000').font('b').fontSize(8);
    doc.text('Lp.', 44, y + 5, { width: 20 });
    doc.text('Produkt', 68, y + 5, { width: 260 });
    doc.text('SKU / EAN', 330, y + 5, { width: 100 });
    doc.text('Ilość', 430, y + 5, { width: 40, align: 'right' });
    if (kind === 'order_card') doc.text('Cena', 475, y + 5, { width: 75, align: 'right' });
    else doc.text('Lokalizacja', 475, y + 5, { width: 75 });
    y += 22;
    doc.font('r');
    items.forEach((it, i) => {
      const name = it.name + (it.attributes ? ` (${it.attributes})` : '');
      const h = Math.max(14, doc.heightOfString(name, { width: 260 }) + 4);
      doc.text(String(i + 1), 44, y, { width: 20 });
      doc.text(name, 68, y, { width: 260 });
      doc.text([it.sku, it.ean].filter(Boolean).join(' / '), 330, y, { width: 100 });
      doc.font('b').text(String(it.quantity), 430, y, { width: 40, align: 'right' }).font('r');
      if (kind === 'order_card') doc.text(`${money(it.price)} ${o.currency}`, 475, y, { width: 75, align: 'right' });
      else doc.text(it.location, 475, y, { width: 75 });
      y += h;
      doc.moveTo(40, y - 2).lineTo(555, y - 2).strokeColor('#dde2e8').stroke();
    });
    if (kind === 'order_card') {
      doc.font('b').fontSize(11).text(`Razem: ${money(orderTotal(id))} ${o.currency}`, 40, y + 8, { width: 515, align: 'right' });
    }
    if (o.buyer_comment) doc.font('r').fontSize(9).text(`Komentarz kupującego: ${o.buyer_comment}`, 40, doc.y + 10, { width: 515 });
    if (o.seller_comment && kind === 'order_card') doc.text(`Uwagi sprzedawcy: ${o.seller_comment}`, 40, undefined, { width: 515 });
  }
  if (!orderIds.length) doc.addPage();
  return toBuffer(doc);
}

export async function returnPdf(returnId: number): Promise<Buffer> {
  const r = db.prepare('SELECT * FROM returns WHERE id = ?').get(returnId) as any;
  const doc = newDoc();
  doc.font('b').fontSize(16).text(`Protokół zwrotu nr ${returnId}`, 40, 40);
  doc.font('r').fontSize(10).text(`Zamówienie: ${r?.order_id ?? '-'}   Data: ${r?.created_at ?? ''}`);
  doc.text(`Klient: ${r?.buyer_name ?? ''} ${r?.buyer_email ?? ''}`);
  doc.text(`Powód: ${r?.reason ?? ''}`);
  doc.moveDown();
  for (const it of parseJson<any[]>(r?.items, [])) doc.text(`• ${it.quantity}x ${it.name}`);
  doc.moveDown().font('b').text(`Kwota zwrotu: ${money(r?.refund_amount ?? 0)} ${r?.currency ?? 'PLN'}`);
  if (r?.bank_account) doc.font('r').text(`Rachunek do zwrotu: ${r.bank_account}`);
  return toBuffer(doc);
}
