import { db } from '../db/index.js';
import { q, likeContains } from '../lib/http.js';

export interface OrderFilters {
  view?: 'active' | 'archive' | 'bin';
  status_ids?: number[];
  search?: string;
  sources?: string[];
  integration_ids?: number[];
  payment?: 'paid' | 'unpaid' | 'partial' | 'overpaid';
  cod?: boolean;
  delivery_method?: string;
  payment_method?: string;
  country?: string;
  date_from?: string;
  date_to?: string;
  price_min?: number;
  price_max?: number;
  invoice?: 'issued' | 'not_issued' | 'wanted';
  shipment?: 'yes' | 'no';
  star?: boolean;
  buyer?: string;
  product?: string;
  comment?: string;
  ids?: number[];
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  per_page?: number;
}

export function filtersFromQuery(query: Record<string, unknown>): OrderFilters {
  const bool = (v: unknown) => (v === '1' || v === 'true' ? true : v === '0' || v === 'false' ? false : undefined);
  return {
    view: (['active', 'archive', 'bin'].includes(String(query.view)) ? query.view : 'active') as OrderFilters['view'],
    status_ids: q.ints(query.status_ids ?? query.status_id),
    search: q.str(query.search),
    sources: q.strs(query.sources),
    integration_ids: q.ints(query.integration_ids),
    payment: q.str(query.payment) as OrderFilters['payment'],
    cod: bool(query.cod),
    delivery_method: q.str(query.delivery_method),
    payment_method: q.str(query.payment_method),
    country: q.str(query.country),
    date_from: q.str(query.date_from),
    date_to: q.str(query.date_to),
    price_min: q.num(query.price_min),
    price_max: q.num(query.price_max),
    invoice: q.str(query.invoice) as OrderFilters['invoice'],
    shipment: q.str(query.shipment) as OrderFilters['shipment'],
    star: bool(query.star),
    buyer: q.str(query.buyer),
    product: q.str(query.product),
    comment: q.str(query.comment),
    ids: q.ints(query.ids).slice(0, 1000),
    sort: q.str(query.sort),
    dir: query.dir === 'asc' ? 'asc' : 'desc',
    page: Math.max(1, q.int(query.page) ?? 1),
    per_page: Math.min(1000, Math.max(1, q.int(query.per_page) ?? 50)),
  };
}

const TOTAL_SQL = `(COALESCE((SELECT SUM(i.price * i.quantity) FROM order_items i WHERE i.order_id = o.id), 0) + o.delivery_price)`;

const SORTS: Record<string, string> = {
  id: 'o.id',
  date_add: 'o.date_add',
  status_changed_at: 'o.status_changed_at',
  total: TOTAL_SQL,
  buyer: 'o.delivery_fullname',
};

export function buildWhere(f: OrderFilters): { where: string; params: unknown[] } {
  const w: string[] = [];
  const p: unknown[] = [];
  if (f.view === 'bin') w.push('o.deleted = 1');
  else if (f.view === 'archive') w.push('o.deleted = 0 AND o.archived = 1');
  else w.push('o.deleted = 0 AND o.archived = 0');

  if (f.ids?.length) {
    w.push(`o.id IN (${f.ids.map(() => '?').join(',')})`);
    p.push(...f.ids);
  }
  if (f.status_ids?.length) {
    w.push(`o.status_id IN (${f.status_ids.map(() => '?').join(',')})`);
    p.push(...f.status_ids);
  }
  if (f.sources?.length) {
    w.push(`o.source IN (${f.sources.map(() => '?').join(',')})`);
    p.push(...f.sources);
  }
  if (f.integration_ids?.length) {
    w.push(`o.integration_id IN (${f.integration_ids.map(() => '?').join(',')})`);
    p.push(...f.integration_ids);
  }
  if (f.search) {
    const like = likeContains(String(f.search));
    w.push(`(CAST(o.id AS TEXT) = ? OR o.external_id LIKE ? ESCAPE '!' OR o.delivery_fullname LIKE ? ESCAPE '!' OR o.invoice_fullname LIKE ? ESCAPE '!' OR o.invoice_company LIKE ? ESCAPE '!'
      OR o.email LIKE ? ESCAPE '!' OR o.phone LIKE ? ESCAPE '!' OR o.user_login LIKE ? ESCAPE '!' OR o.delivery_city LIKE ? ESCAPE '!' OR o.invoice_nip LIKE ? ESCAPE '!'
      OR EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND (i.name LIKE ? ESCAPE '!' OR i.sku LIKE ? ESCAPE '!' OR i.ean LIKE ? ESCAPE '!'))
      OR EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id AND s.tracking_number LIKE ? ESCAPE '!'))`);
    p.push(f.search, like, like, like, like, like, like, like, like, like, like, like, like, like);
  }
  if (f.buyer) {
    const like = likeContains(String(f.buyer));
    w.push(`(o.delivery_fullname LIKE ? ESCAPE '!' OR o.email LIKE ? ESCAPE '!' OR o.user_login LIKE ? ESCAPE '!' OR o.phone LIKE ? ESCAPE '!' OR o.invoice_company LIKE ? ESCAPE '!')`);
    p.push(like, like, like, like, like);
  }
  if (f.product) {
    const like = likeContains(String(f.product));
    w.push(`EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND (i.name LIKE ? ESCAPE '!' OR i.sku LIKE ? ESCAPE '!' OR i.ean LIKE ? ESCAPE '!'))`);
    p.push(like, like, like);
  }
  if (f.comment) {
    const like = likeContains(String(f.comment));
    w.push(`(o.buyer_comment LIKE ? ESCAPE '!' OR o.seller_comment LIKE ? ESCAPE '!')`);
    p.push(like, like);
  }
  if (f.payment === 'paid') w.push(`o.paid_amount > 0 AND o.paid_amount >= ${TOTAL_SQL} - 0.001`);
  if (f.payment === 'unpaid') w.push('o.paid_amount <= 0');
  if (f.payment === 'partial') w.push(`o.paid_amount > 0 AND o.paid_amount < ${TOTAL_SQL} - 0.001`);
  if (f.payment === 'overpaid') w.push(`o.paid_amount > ${TOTAL_SQL} + 0.001`);
  if (f.cod !== undefined) {
    w.push('o.payment_cod = ?');
    p.push(f.cod ? 1 : 0);
  }
  if (f.delivery_method) {
    w.push(`o.delivery_method LIKE ? ESCAPE '!'`);
    p.push(likeContains(String(f.delivery_method)));
  }
  if (f.payment_method) {
    w.push(`o.payment_method LIKE ? ESCAPE '!'`);
    p.push(likeContains(String(f.payment_method)));
  }
  if (f.country) {
    w.push('o.delivery_country_code = ?');
    p.push(f.country.toUpperCase());
  }
  if (f.date_from) {
    w.push('o.date_add >= ?');
    p.push(f.date_from.length === 10 ? `${f.date_from} 00:00:00` : f.date_from);
  }
  if (f.date_to) {
    w.push('o.date_add <= ?');
    p.push(f.date_to.length === 10 ? `${f.date_to} 23:59:59` : f.date_to);
  }
  if (f.price_min !== undefined) {
    w.push(`${TOTAL_SQL} >= ?`);
    p.push(f.price_min);
  }
  if (f.price_max !== undefined) {
    w.push(`${TOTAL_SQL} <= ?`);
    p.push(f.price_max);
  }
  if (f.invoice === 'issued') w.push(`EXISTS (SELECT 1 FROM invoices v WHERE v.order_id = o.id AND v.type = 'invoice')`);
  if (f.invoice === 'not_issued') w.push(`NOT EXISTS (SELECT 1 FROM invoices v WHERE v.order_id = o.id AND v.type = 'invoice')`);
  if (f.invoice === 'wanted') w.push('o.invoice_wanted = 1');
  if (f.shipment === 'yes') w.push('EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id)');
  if (f.shipment === 'no') w.push('NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id)');
  if (f.star !== undefined) w.push(f.star ? 'o.star > 0' : 'o.star = 0');
  return { where: w.join(' AND '), params: p };
}

export function listOrders(f: OrderFilters) {
  const { where, params } = buildWhere(f);
  const sort = SORTS[f.sort ?? 'id'] ?? 'o.id';
  const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
  const perPage = f.per_page ?? 50;
  const offset = ((f.page ?? 1) - 1) * perPage;
  const total = (db.prepare(`SELECT COUNT(*) c FROM orders o WHERE ${where}`).get(...params) as { c: number }).c;
  const rows = db
    .prepare(
      `SELECT o.id, o.external_id, o.source, o.integration_id, o.status_id, o.status_changed_at, o.date_add, o.user_login, o.email,
              o.delivery_fullname, o.delivery_company, o.delivery_country_code, o.delivery_method, o.payment_method, o.payment_cod,
              o.paid_amount, o.currency, o.star, o.flag, o.buyer_comment, o.seller_comment, o.invoice_wanted, o.delivery_point_id,
              o.extra_field_1, o.extra_field_2, o.archived, o.deleted,
              ROUND(${TOTAL_SQL}, 2) AS total,
              (SELECT COUNT(*) FROM invoices v WHERE v.order_id = o.id AND v.type IN ('invoice','correction')) AS invoice_count,
              (SELECT COUNT(*) FROM invoices v WHERE v.order_id = o.id AND v.type = 'receipt') AS receipt_count,
              (SELECT COUNT(*) FROM shipments s WHERE s.order_id = o.id) AS shipment_count,
              (SELECT MAX(s.label_printed) FROM shipments s WHERE s.order_id = o.id) AS label_printed,
              (SELECT name FROM integrations n WHERE n.id = o.integration_id) AS integration_name
       FROM orders o WHERE ${where} ORDER BY ${sort} ${dir}, o.id ${dir} LIMIT ? OFFSET ?`,
    )
    .all(...params, perPage, offset) as any[];
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    const items = db
      .prepare(
        `SELECT order_id, name, quantity, sku, image, attributes FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
      )
      .all(...ids) as any[];
    const byOrder = new Map<number, any[]>();
    for (const it of items) {
      if (!byOrder.has(it.order_id)) byOrder.set(it.order_id, []);
      byOrder.get(it.order_id)!.push(it);
    }
    for (const r of rows) r.items = byOrder.get(r.id) ?? [];
  }
  return { total, page: f.page ?? 1, per_page: perPage, rows };
}

/** Matching order ids (for bulk actions on "all filtered"). */
export function listOrderIds(f: OrderFilters): number[] {
  const { where, params } = buildWhere(f);
  return (db.prepare(`SELECT o.id FROM orders o WHERE ${where} ORDER BY o.id`).all(...params) as { id: number }[]).map((r) => r.id);
}

export function statusCounts() {
  const rows = db
    .prepare('SELECT status_id, COUNT(*) c FROM orders WHERE deleted = 0 AND archived = 0 GROUP BY status_id')
    .all() as { status_id: number; c: number }[];
  const counts: Record<number, number> = {};
  let all = 0;
  for (const r of rows) {
    counts[r.status_id] = r.c;
    all += r.c;
  }
  const archive = (db.prepare('SELECT COUNT(*) c FROM orders WHERE deleted = 0 AND archived = 1').get() as { c: number }).c;
  const bin = (db.prepare('SELECT COUNT(*) c FROM orders WHERE deleted = 1').get() as { c: number }).c;
  return { all, by_status: counts, archive, bin };
}
