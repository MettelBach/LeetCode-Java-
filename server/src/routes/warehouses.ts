/**
 * Warehouses, catalogs (with languages, price groups and warehouses assigned),
 * price groups, tags, product extra fields, warehouse documents and stocktaking.
 */
import { Router } from 'express';
import { z } from 'zod';
import { db, parseJson, tx } from '../db/index.js';
import { HttpError, idParam, q } from '../lib/http.js';
import { adjustStock, defaultCatalogId, stockIsDerived, updateAverageCost, warehouseStock } from '../services/stock.js';
import { requireAdmin, userName } from './auth.js';

const exists = (table: string, id: unknown) => id != null && !!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id);

/* --------------------------------- warehouses --------------------------------- */

export const warehousesRouter = Router();

warehousesRouter.get('/', (_req, res) => {
  res.json(
    db
      .prepare(
        `SELECT w.*, (SELECT COALESCE(SUM(stock),0) FROM product_stock s WHERE s.warehouse_id = w.id) units,
          (SELECT COALESCE(SUM(reserved),0) FROM product_stock s WHERE s.warehouse_id = w.id) reserved,
          (SELECT COUNT(*) FROM product_stock s WHERE s.warehouse_id = w.id AND s.stock != 0) products,
          (SELECT ROUND(COALESCE(SUM(s.stock * CASE WHEN p.avg_cost > 0 THEN p.avg_cost ELSE p.purchase_price END),0),2)
             FROM product_stock s JOIN products p ON p.id = s.product_id WHERE s.warehouse_id = w.id AND s.stock > 0) value,
          (SELECT GROUP_CONCAT(c.name, ', ') FROM catalog_warehouses cw JOIN catalogs c ON c.id = cw.catalog_id WHERE cw.warehouse_id = w.id) catalogs
         FROM warehouses w ORDER BY w.is_default DESC, w.id`,
      )
      .all(),
  );
});

const whSchema = z.object({
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().max(20).optional(),
  description: z.string().max(500).optional(),
  is_default: z.boolean().optional(),
  allow_negative: z.boolean().optional(),
});

warehousesRouter.post('/', requireAdmin, (req, res) => {
  const b = whSchema.parse(req.body);
  if (b.code && db.prepare('SELECT 1 FROM warehouses WHERE code = ?').get(b.code)) throw new HttpError(409, 'A warehouse with this code already exists');
  const id = tx(() => {
    if (b.is_default) db.prepare('UPDATE warehouses SET is_default = 0').run();
    const newId = Number(
      db
        .prepare('INSERT INTO warehouses (name, code, description, is_default, allow_negative) VALUES (?, ?, ?, ?, ?)')
        .run(b.name, b.code ?? '', b.description ?? '', b.is_default ? 1 : 0, b.allow_negative ? 1 : 0).lastInsertRowid,
    );
    // A new warehouse is available in the default catalog right away.
    db.prepare('INSERT OR IGNORE INTO catalog_warehouses (catalog_id, warehouse_id) VALUES (?, ?)').run(defaultCatalogId(), newId);
    return newId;
  });
  res.json({ id });
});

warehousesRouter.put('/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  const b = whSchema.parse(req.body);
  if (!exists('warehouses', id)) throw new HttpError(404, 'Warehouse not found');
  if (b.code && db.prepare('SELECT 1 FROM warehouses WHERE code = ? AND id != ?').get(b.code, id)) throw new HttpError(409, 'A warehouse with this code already exists');
  tx(() => {
    if (b.is_default) db.prepare('UPDATE warehouses SET is_default = 0').run();
    db.prepare(
      'UPDATE warehouses SET name = ?, code = ?, description = ?, is_default = CASE WHEN ? THEN 1 ELSE is_default END, allow_negative = COALESCE(?, allow_negative) WHERE id = ?',
    ).run(b.name, b.code ?? '', b.description ?? '', b.is_default ? 1 : 0, b.allow_negative === undefined ? null : b.allow_negative ? 1 : 0, id);
  });
  res.json({ ok: true });
});

warehousesRouter.delete('/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  const w = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(id) as any;
  if (!w) throw new HttpError(404, 'Warehouse not found');
  if (w.is_default) throw new HttpError(400, 'The default warehouse cannot be deleted');
  if (db.prepare('SELECT 1 FROM product_stock WHERE warehouse_id = ? AND (stock != 0 OR reserved != 0)').get(id)) {
    throw new HttpError(409, 'The warehouse still has stock — move it with an MM document first');
  }
  if (db.prepare(`SELECT 1 FROM warehouse_docs WHERE warehouse_id = ? OR target_warehouse_id = ?`).get(id, id)) throw new HttpError(409, 'The warehouse has documents');
  const used = (db.prepare('SELECT name, settings FROM integrations').all() as any[]).find((i) => {
    const s = parseJson<any>(i.settings, {});
    return Number(s.warehouse_id) === id || (s.stock_warehouse_ids ?? []).map(Number).includes(id);
  });
  if (used) throw new HttpError(409, `The warehouse is used by the integration "${used.name}"`);
  tx(() => {
    db.prepare('UPDATE orders SET warehouse_id = NULL WHERE warehouse_id = ?').run(id);
    db.prepare('UPDATE catalogs SET default_warehouse_id = NULL WHERE default_warehouse_id = ?').run(id);
    db.prepare('DELETE FROM product_stock WHERE warehouse_id = ?').run(id);
    db.prepare('DELETE FROM warehouses WHERE id = ?').run(id);
  });
  res.json({ ok: true });
});

/* ---------------------------------- catalogs ---------------------------------- */

export const catalogsRouter = Router();

function catalogView(c: any) {
  return {
    ...c,
    languages: parseJson<string[]>(c.languages, ['pl']),
    price_group_ids: (db.prepare('SELECT price_group_id FROM catalog_price_groups WHERE catalog_id = ?').all(c.id) as any[]).map((r) => r.price_group_id),
    warehouse_ids: (db.prepare('SELECT warehouse_id FROM catalog_warehouses WHERE catalog_id = ?').all(c.id) as any[]).map((r) => r.warehouse_id),
    integrations: (db.prepare('SELECT id, name, type, settings FROM integrations').all() as any[])
      .filter((i) => Number(parseJson<any>(i.settings, {}).catalog_id) === c.id)
      .map((i) => ({ id: i.id, name: i.name, type: i.type })),
  };
}

catalogsRouter.get('/', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.catalog_id = c.id AND p.parent_id IS NULL) products,
        (SELECT COUNT(*) FROM products p WHERE p.catalog_id = c.id) items
       FROM catalogs c ORDER BY c.is_default DESC, c.id`,
    )
    .all() as any[];
  res.json(rows.map(catalogView));
});

const LANGS = ['pl', 'en', 'de', 'cs', 'sk', 'uk', 'ru', 'fr', 'it', 'es', 'lt', 'hu', 'ro'] as const;

const catSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  is_default: z.boolean().optional(),
  languages: z.array(z.enum(LANGS)).min(1).max(13).optional(),
  default_language: z.enum(LANGS).optional(),
  price_group_ids: z.array(z.number().int()).min(1).optional(),
  default_price_group_id: z.number().int().optional(),
  warehouse_ids: z.array(z.number().int()).min(1).optional(),
  default_warehouse_id: z.number().int().optional(),
});

function saveCatalog(id: number, b: z.infer<typeof catSchema>) {
  const langs = b.languages ?? parseJson<string[]>((db.prepare('SELECT languages FROM catalogs WHERE id = ?').get(id) as any)?.languages, ['pl']);
  const defLang = b.default_language ?? langs[0];
  if (!langs.includes(defLang)) throw new HttpError(400, 'The default language must be one of the catalog languages');
  for (const g of b.price_group_ids ?? []) if (!exists('price_groups', g)) throw new HttpError(400, `Unknown price group ${g}`);
  for (const w of b.warehouse_ids ?? []) if (!exists('warehouses', w)) throw new HttpError(400, `Unknown warehouse ${w}`);
  if (b.default_price_group_id && b.price_group_ids && !b.price_group_ids.includes(b.default_price_group_id)) throw new HttpError(400, 'The default price group must be assigned to the catalog');
  if (b.default_warehouse_id && b.warehouse_ids && !b.warehouse_ids.includes(b.default_warehouse_id)) throw new HttpError(400, 'The default warehouse must be assigned to the catalog');
  if (b.is_default) db.prepare('UPDATE catalogs SET is_default = 0').run();
  db.prepare(
    `UPDATE catalogs SET name = ?, description = ?, is_default = CASE WHEN ? THEN 1 ELSE is_default END, languages = ?, default_language = ?,
       default_price_group_id = COALESCE(?, default_price_group_id), default_warehouse_id = COALESCE(?, default_warehouse_id) WHERE id = ?`,
  ).run(b.name, b.description ?? '', b.is_default ? 1 : 0, JSON.stringify(langs), defLang, b.default_price_group_id ?? null, b.default_warehouse_id ?? null, id);
  if (b.price_group_ids) {
    db.prepare('DELETE FROM catalog_price_groups WHERE catalog_id = ?').run(id);
    for (const g of b.price_group_ids) db.prepare('INSERT INTO catalog_price_groups (catalog_id, price_group_id) VALUES (?, ?)').run(id, g);
    db.prepare('UPDATE catalogs SET default_price_group_id = ? WHERE id = ? AND (default_price_group_id IS NULL OR default_price_group_id NOT IN (SELECT price_group_id FROM catalog_price_groups WHERE catalog_id = ?))').run(
      b.price_group_ids[0],
      id,
      id,
    );
  }
  if (b.warehouse_ids) {
    const removed = (db.prepare('SELECT warehouse_id FROM catalog_warehouses WHERE catalog_id = ?').all(id) as any[])
      .map((r) => r.warehouse_id)
      .filter((w: number) => !b.warehouse_ids!.includes(w));
    for (const w of removed) {
      if (db.prepare('SELECT 1 FROM product_stock s JOIN products p ON p.id = s.product_id WHERE p.catalog_id = ? AND s.warehouse_id = ? AND s.stock != 0').get(id, w)) {
        throw new HttpError(409, 'Products of this catalog still have stock in a warehouse you are removing');
      }
    }
    db.prepare('DELETE FROM catalog_warehouses WHERE catalog_id = ?').run(id);
    for (const w of b.warehouse_ids) db.prepare('INSERT INTO catalog_warehouses (catalog_id, warehouse_id) VALUES (?, ?)').run(id, w);
    db.prepare('UPDATE catalogs SET default_warehouse_id = ? WHERE id = ? AND (default_warehouse_id IS NULL OR default_warehouse_id NOT IN (SELECT warehouse_id FROM catalog_warehouses WHERE catalog_id = ?))').run(
      b.warehouse_ids[0],
      id,
      id,
    );
  }
}

catalogsRouter.post('/', requireAdmin, (req, res) => {
  const b = catSchema.parse(req.body);
  const id = tx(() => {
    const newId = Number(db.prepare('INSERT INTO catalogs (name) VALUES (?)').run(b.name).lastInsertRowid);
    saveCatalog(newId, {
      ...b,
      price_group_ids: b.price_group_ids ?? (db.prepare('SELECT id FROM price_groups WHERE is_default = 1').all() as any[]).map((r) => r.id),
      warehouse_ids: b.warehouse_ids ?? (db.prepare('SELECT id FROM warehouses ORDER BY is_default DESC, id LIMIT 1').all() as any[]).map((r) => r.id),
    });
    return newId;
  });
  res.json({ id });
});

catalogsRouter.put('/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  if (!exists('catalogs', id)) throw new HttpError(404, 'Catalog not found');
  const b = catSchema.parse(req.body);
  tx(() => saveCatalog(id, b));
  res.json({ ok: true });
});

catalogsRouter.delete('/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  const c = db.prepare('SELECT * FROM catalogs WHERE id = ?').get(id) as any;
  if (!c) throw new HttpError(404, 'Catalog not found');
  if (c.is_default) throw new HttpError(400, 'The default catalog cannot be deleted');
  if (db.prepare('SELECT 1 FROM products WHERE catalog_id = ?').get(id)) throw new HttpError(409, 'The catalog contains products — move or delete them first');
  if (catalogView(c).integrations.length) throw new HttpError(409, 'The catalog is used by an integration — change its settings first');
  db.prepare('DELETE FROM catalogs WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* --------------------------------- price groups --------------------------------- */

export const priceGroupsRouter = Router();

priceGroupsRouter.get('/', (_req, res) => {
  res.json(
    db
      .prepare(
        `SELECT g.*, (SELECT COUNT(*) FROM product_prices p WHERE p.price_group_id = g.id) prices,
          (SELECT GROUP_CONCAT(c.name, ', ') FROM catalog_price_groups cg JOIN catalogs c ON c.id = cg.catalog_id WHERE cg.price_group_id = g.id) catalogs
         FROM price_groups g ORDER BY g.is_default DESC, g.id`,
      )
      .all(),
  );
});

const pgSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  /** Fill prices of the new group from another group with a markup (%). */
  copy_from: z.number().int().optional(),
  markup: z.number().min(-90).max(1000).optional(),
});

priceGroupsRouter.post('/', requireAdmin, (req, res) => {
  const b = pgSchema.parse(req.body);
  const id = tx(() => {
    const newId = Number(db.prepare('INSERT INTO price_groups (name, description, currency) VALUES (?, ?, ?)').run(b.name, b.description ?? '', b.currency ?? 'PLN').lastInsertRowid);
    db.prepare('INSERT OR IGNORE INTO catalog_price_groups (catalog_id, price_group_id) SELECT id, ? FROM catalogs').run(newId);
    if (b.copy_from) {
      if (!exists('price_groups', b.copy_from)) throw new HttpError(400, 'Unknown price group');
      db.prepare('INSERT INTO product_prices (product_id, price_group_id, price) SELECT product_id, ?, ROUND(price * (1 + ? / 100.0), 2) FROM product_prices WHERE price_group_id = ?').run(
        newId,
        b.markup ?? 0,
        b.copy_from,
      );
    }
    return newId;
  });
  res.json({ id });
});

priceGroupsRouter.put('/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  if (!exists('price_groups', id)) throw new HttpError(404, 'Price group not found');
  const b = pgSchema.parse(req.body);
  db.prepare('UPDATE price_groups SET name = ?, description = ?, currency = COALESCE(?, currency) WHERE id = ?').run(b.name, b.description ?? '', b.currency ?? null, id);
  res.json({ ok: true });
});

priceGroupsRouter.delete('/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  const g = db.prepare('SELECT * FROM price_groups WHERE id = ?').get(id) as any;
  if (!g) throw new HttpError(404, 'Price group not found');
  if (g.is_default) throw new HttpError(400, 'The default price group cannot be deleted');
  const used = (db.prepare('SELECT name, settings FROM integrations').all() as any[]).find((i) => Number(parseJson<any>(i.settings, {}).price_group_id) === id);
  if (used) throw new HttpError(409, `The price group is used by the integration "${used.name}"`);
  db.prepare('UPDATE catalogs SET default_price_group_id = NULL WHERE default_price_group_id = ?').run(id);
  db.prepare('DELETE FROM price_groups WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ------------------------------ tags & extra fields ------------------------------ */

export const tagsRouter = Router();

tagsRouter.get('/', (_req, res) => {
  res.json(db.prepare('SELECT t.*, (SELECT COUNT(*) FROM product_tags p WHERE p.tag_id = t.id) products FROM tags t ORDER BY t.name COLLATE NOCASE').all());
});
const tagSchema = z.object({ name: z.string().trim().min(1).max(50), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() });
tagsRouter.post('/', (req, res) => {
  const b = tagSchema.parse(req.body);
  if (db.prepare('SELECT 1 FROM tags WHERE name = ?').get(b.name)) throw new HttpError(409, 'This tag already exists');
  res.json({ id: Number(db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)').run(b.name, b.color ?? '#1271d3').lastInsertRowid) });
});
tagsRouter.put('/:id', (req, res) => {
  const b = tagSchema.parse(req.body);
  db.prepare('UPDATE tags SET name = ?, color = COALESCE(?, color) WHERE id = ?').run(b.name, b.color ?? null, idParam(req));
  res.json({ ok: true });
});
tagsRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM tags WHERE id = ?').run(idParam(req));
  res.json({ ok: true });
});

export const extraFieldsRouter = Router();

extraFieldsRouter.get('/', (_req, res) => {
  res.json((db.prepare('SELECT * FROM extra_fields ORDER BY sort, id').all() as any[]).map((f) => ({ ...f, options: parseJson(f.options, []) })));
});
const efSchema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['text', 'number', 'select', 'checkbox', 'date', 'textarea']),
  options: z.array(z.string().max(100)).max(100).optional(),
  sort: z.number().int().optional(),
});
extraFieldsRouter.post('/', requireAdmin, (req, res) => {
  const b = efSchema.parse(req.body);
  res.json({ id: Number(db.prepare('INSERT INTO extra_fields (name, kind, options, sort) VALUES (?, ?, ?, ?)').run(b.name, b.kind, JSON.stringify(b.options ?? []), b.sort ?? 0).lastInsertRowid) });
});
extraFieldsRouter.put('/:id', requireAdmin, (req, res) => {
  const b = efSchema.parse(req.body);
  db.prepare('UPDATE extra_fields SET name = ?, kind = ?, options = ?, sort = ? WHERE id = ?').run(b.name, b.kind, JSON.stringify(b.options ?? []), b.sort ?? 0, idParam(req));
  res.json({ ok: true });
});
extraFieldsRouter.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM extra_fields WHERE id = ?').run(idParam(req));
  res.json({ ok: true });
});

/* ----------------------------- warehouse documents ----------------------------- */

/**
 * PZ goods receipt, PW internal receipt, WZ goods issue, RW internal issue,
 * MM transfer, ZW customer return, BO opening balance, INW stocktaking result
 * (signed quantities).
 */
export const DOC_TYPES = ['PZ', 'PW', 'WZ', 'RW', 'MM', 'ZW', 'BO', 'INW'] as const;
/** Sign of the stock change in the source warehouse. MM also adds to the target warehouse. */
const DOC_SIGN: Record<string, number> = { PZ: 1, PW: 1, ZW: 1, BO: 1, INW: 1, WZ: -1, RW: -1, MM: -1 };

export const docsRouter = Router();

docsRouter.get('/', (req, res) => {
  const w = ['1=1'];
  const p: unknown[] = [];
  if (q.str(req.query.type)) {
    w.push('d.type = ?');
    p.push(q.str(req.query.type));
  }
  if (q.str(req.query.status)) {
    w.push('d.status = ?');
    p.push(q.str(req.query.status));
  }
  if (q.int(req.query.warehouse_id)) {
    w.push('(d.warehouse_id = ? OR d.target_warehouse_id = ?)');
    p.push(q.int(req.query.warehouse_id), q.int(req.query.warehouse_id));
  }
  if (q.int(req.query.product_id)) {
    w.push('EXISTS (SELECT 1 FROM warehouse_doc_items i WHERE i.doc_id = d.id AND i.product_id = ?)');
    p.push(q.int(req.query.product_id));
  }
  if (q.str(req.query.date_from)) {
    w.push('d.doc_date >= ?');
    p.push(q.str(req.query.date_from));
  }
  if (q.str(req.query.date_to)) {
    w.push('d.doc_date <= ?');
    p.push(q.str(req.query.date_to));
  }
  if (q.str(req.query.search)) {
    w.push('(d.number LIKE ? OR d.contractor LIKE ? OR d.notes LIKE ?)');
    const like = `%${q.str(req.query.search)}%`;
    p.push(like, like, like);
  }
  res.json(
    db
      .prepare(
        `SELECT d.*, w.name warehouse_name, t.name target_name,
          (SELECT COUNT(*) FROM warehouse_doc_items i WHERE i.doc_id = d.id) items,
          (SELECT COALESCE(SUM(quantity),0) FROM warehouse_doc_items i WHERE i.doc_id = d.id) units,
          (SELECT ROUND(COALESCE(SUM(quantity * price),0),2) FROM warehouse_doc_items i WHERE i.doc_id = d.id) value
         FROM warehouse_docs d JOIN warehouses w ON w.id = d.warehouse_id LEFT JOIN warehouses t ON t.id = d.target_warehouse_id
         WHERE ${w.join(' AND ')} ORDER BY d.doc_date DESC, d.id DESC LIMIT 500`,
      )
      .all(...p),
  );
});

docsRouter.get('/:id', (req, res) => {
  const d = db
    .prepare(
      `SELECT d.*, w.name warehouse_name, t.name target_name, r.number reverses_number,
         (SELECT number FROM warehouse_docs x WHERE x.reverses_doc_id = d.id LIMIT 1) reversed_by_number
       FROM warehouse_docs d JOIN warehouses w ON w.id = d.warehouse_id LEFT JOIN warehouses t ON t.id = d.target_warehouse_id
       LEFT JOIN warehouse_docs r ON r.id = d.reverses_doc_id WHERE d.id = ?`,
    )
    .get(idParam(req)) as any;
  if (!d) throw new HttpError(404, 'Document not found');
  const items = db.prepare('SELECT i.*, p.variant_name, p.location FROM warehouse_doc_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.doc_id = ? ORDER BY i.id').all(d.id) as any[];
  for (const it of items) it.stock_now = it.product_id ? warehouseStock(it.product_id, d.warehouse_id) : null;
  res.json({ ...d, items });
});

const itemSchema = z.object({ product_id: z.number().int(), quantity: z.number().int().min(-1e7).max(1e7), price: z.number().min(0).max(1e7).optional() });
const docSchema = z.object({
  type: z.enum(DOC_TYPES),
  warehouse_id: z.number().int(),
  target_warehouse_id: z.number().int().nullable().optional(),
  doc_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  contractor: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  items: z.array(itemSchema).min(1).max(5000),
  confirm: z.boolean().optional(),
});

function validateDoc(b: z.infer<typeof docSchema>) {
  if (!exists('warehouses', b.warehouse_id)) throw new HttpError(400, 'Unknown warehouse');
  if (b.type === 'MM') {
    if (!b.target_warehouse_id || b.target_warehouse_id === b.warehouse_id) throw new HttpError(400, 'Choose a different target warehouse');
    if (!exists('warehouses', b.target_warehouse_id)) throw new HttpError(400, 'Unknown target warehouse');
  }
  if (b.doc_date && Number.isNaN(Date.parse(b.doc_date))) throw new HttpError(400, 'Invalid document date');
  const seen = new Set<number>();
  for (const it of b.items) {
    if (!exists('products', it.product_id)) throw new HttpError(400, `Unknown product ${it.product_id}`);
    const derived = stockIsDerived(it.product_id);
    if (derived) throw new HttpError(400, `Product ${it.product_id}: ${derived}`);
    if (it.quantity === 0) throw new HttpError(400, 'Quantity cannot be 0');
    if (it.quantity < 0 && b.type !== 'INW') throw new HttpError(400, 'Quantity must be positive (only a stocktaking document has differences with a sign)');
    if (seen.has(it.product_id)) throw new HttpError(400, `Product ${it.product_id} appears twice — merge the lines`);
    seen.add(it.product_id);
  }
}

function insertItems(docId: number, items: z.infer<typeof itemSchema>[]) {
  const ins = db.prepare('INSERT INTO warehouse_doc_items (doc_id, product_id, name, sku, ean, quantity, price) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const it of items) {
    const p = db.prepare('SELECT name, variant_name, sku, ean, purchase_price, avg_cost FROM products WHERE id = ?').get(it.product_id) as any;
    ins.run(docId, it.product_id, p.variant_name ? `${p.name} — ${p.variant_name}` : p.name, p.sku, p.ean, it.quantity, it.price ?? (p.avg_cost || p.purchase_price || 0));
  }
}

/** Assigns the next number of a document type in the month of its date (on confirmation). */
function assignNumber(id: number) {
  const d = db.prepare('SELECT type, doc_date FROM warehouse_docs WHERE id = ?').get(id) as { type: string; doc_date: string };
  const [y, m] = d.doc_date.split('-');
  const period = `${m}/${y}`;
  const seq = ((db.prepare('SELECT MAX(seq) s FROM warehouse_docs WHERE type = ? AND period = ?').get(d.type, period) as { s: number | null }).s ?? 0) + 1;
  db.prepare('UPDATE warehouse_docs SET seq = ?, period = ?, number = ? WHERE id = ?').run(seq, period, `${d.type} ${seq}/${period}`, id);
}

export function confirmDoc(id: number, user: string) {
  tx(() => {
    const d = db.prepare('SELECT * FROM warehouse_docs WHERE id = ?').get(id) as any;
    if (!d) throw new HttpError(404, 'Document not found');
    if (d.status !== 'draft') throw new HttpError(409, 'Only a draft can be confirmed');
    assignNumber(id);
    const number = (db.prepare('SELECT number FROM warehouse_docs WHERE id = ?').get(id) as { number: string }).number;
    const items = db.prepare('SELECT id, product_id, quantity, price FROM warehouse_doc_items WHERE doc_id = ?').all(id) as any[];
    for (const it of items) {
      if (!it.product_id) throw new HttpError(409, 'A product on the document was deleted');
      db.prepare('UPDATE warehouse_doc_items SET stock_before = ? WHERE id = ?').run(warehouseStock(it.product_id, d.warehouse_id), it.id);
      adjustStock(it.product_id, DOC_SIGN[d.type] * it.quantity, number, d.warehouse_id, { docId: id, user });
      if (d.type === 'MM') adjustStock(it.product_id, it.quantity, number, d.target_warehouse_id, { docId: id, user });
      // Goods receipt updates the weighted average purchase cost.
      if ((d.type === 'PZ' || d.type === 'BO') && it.price > 0) updateAverageCost(it.product_id, it.quantity, it.price);
    }
    db.prepare(`UPDATE warehouse_docs SET status = 'confirmed', confirmed_at = datetime('now'), user_name = ? WHERE id = ?`).run(user, id);
  });
}

function createDoc(b: z.infer<typeof docSchema>, user: string, extra: { order_id?: number; reverses_doc_id?: number } = {}) {
  return tx(() => {
    const r = db
      .prepare(
        `INSERT INTO warehouse_docs (type, doc_date, warehouse_id, target_warehouse_id, contractor, notes, user_name, order_id, reverses_doc_id)
         VALUES (?, COALESCE(?, date('now')), ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(b.type, b.doc_date ?? null, b.warehouse_id, b.type === 'MM' ? b.target_warehouse_id : null, b.contractor ?? '', b.notes ?? '', user, extra.order_id ?? null, extra.reverses_doc_id ?? null);
    const docId = Number(r.lastInsertRowid);
    insertItems(docId, b.items);
    if (b.confirm) confirmDoc(docId, user);
    return docId;
  });
}

docsRouter.post('/', (req, res) => {
  const b = docSchema.parse(req.body);
  validateDoc(b);
  res.json({ id: createDoc(b, userName(req)) });
});

/** Edits a draft (header and lines). */
docsRouter.put('/:id', (req, res) => {
  const id = idParam(req);
  const d = db.prepare('SELECT * FROM warehouse_docs WHERE id = ?').get(id) as any;
  if (!d) throw new HttpError(404, 'Document not found');
  if (d.status !== 'draft') throw new HttpError(409, 'Only a draft can be edited');
  const b = docSchema.parse({ ...req.body, type: d.type });
  validateDoc(b);
  tx(() => {
    db.prepare('UPDATE warehouse_docs SET doc_date = COALESCE(?, doc_date), warehouse_id = ?, target_warehouse_id = ?, contractor = ?, notes = ? WHERE id = ?').run(
      b.doc_date ?? null,
      b.warehouse_id,
      b.type === 'MM' ? b.target_warehouse_id : null,
      b.contractor ?? '',
      b.notes ?? '',
      id,
    );
    db.prepare('DELETE FROM warehouse_doc_items WHERE doc_id = ?').run(id);
    insertItems(id, b.items);
    if (b.confirm) confirmDoc(id, userName(req));
  });
  res.json({ ok: true });
});

docsRouter.post('/:id/confirm', (req, res) => {
  confirmDoc(idParam(req), userName(req));
  res.json({ ok: true });
});

/** Cancels a confirmed document by issuing a reverse document (stock goes back). */
docsRouter.post('/:id/cancel', (req, res) => {
  const id = idParam(req);
  const d = db.prepare('SELECT * FROM warehouse_docs WHERE id = ?').get(id) as any;
  if (!d) throw new HttpError(404, 'Document not found');
  if (d.status !== 'confirmed') throw new HttpError(409, 'Only a confirmed document can be canceled');
  if (d.reverses_doc_id) throw new HttpError(409, 'A reversing document cannot be canceled');
  const items = db.prepare('SELECT product_id, quantity, price FROM warehouse_doc_items WHERE doc_id = ?').all(id) as any[];
  if (items.some((i) => !i.product_id)) throw new HttpError(409, 'A product on the document was deleted');
  const user = userName(req);
  const reverseType: Record<string, (typeof DOC_TYPES)[number]> = { PZ: 'WZ', PW: 'RW', ZW: 'WZ', BO: 'RW', WZ: 'PZ', RW: 'PW', MM: 'MM', INW: 'INW' };
  const newId = tx(() => {
    const rid = createDoc(
      {
        type: reverseType[d.type],
        warehouse_id: d.type === 'MM' ? d.target_warehouse_id : d.warehouse_id,
        target_warehouse_id: d.type === 'MM' ? d.warehouse_id : null,
        contractor: d.contractor,
        notes: `Anulowanie dokumentu ${d.number}`,
        items: items.map((i) => ({ product_id: i.product_id, quantity: d.type === 'INW' ? -i.quantity : i.quantity, price: i.price })),
        confirm: true,
      },
      user,
      { reverses_doc_id: id },
    );
    db.prepare(`UPDATE warehouse_docs SET status = 'canceled' WHERE id = ?`).run(id);
    return rid;
  });
  res.json({ ok: true, reverse_doc_id: newId });
});

docsRouter.delete('/:id', (req, res) => {
  const id = idParam(req);
  const d = db.prepare('SELECT status FROM warehouse_docs WHERE id = ?').get(id) as any;
  if (!d) throw new HttpError(404, 'Document not found');
  if (d.status !== 'draft') throw new HttpError(409, 'A confirmed document cannot be deleted — cancel it instead');
  db.prepare('DELETE FROM warehouse_docs WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* -------------------------------- stocktaking -------------------------------- */

export const stocktakesRouter = Router();

stocktakesRouter.get('/', (_req, res) => {
  res.json(
    db
      .prepare(
        `SELECT s.*, w.name warehouse_name, d.number doc_number,
          (SELECT COUNT(*) FROM stocktake_items i WHERE i.stocktake_id = s.id) items,
          (SELECT COUNT(*) FROM stocktake_items i WHERE i.stocktake_id = s.id AND i.counted IS NOT NULL) counted,
          (SELECT COUNT(*) FROM stocktake_items i WHERE i.stocktake_id = s.id AND i.counted IS NOT NULL AND i.counted != i.expected) differences
         FROM stocktakes s JOIN warehouses w ON w.id = s.warehouse_id LEFT JOIN warehouse_docs d ON d.id = s.doc_id ORDER BY s.id DESC`,
      )
      .all(),
  );
});

stocktakesRouter.post('/', (req, res) => {
  const b = z
    .object({ warehouse_id: z.number().int(), catalog_id: z.number().int().optional(), category_id: z.number().int().optional(), name: z.string().trim().max(200).optional() })
    .parse(req.body);
  if (!exists('warehouses', b.warehouse_id)) throw new HttpError(400, 'Unknown warehouse');
  const catalogId = b.catalog_id ?? defaultCatalogId();
  const id = tx(() => {
    const sid = Number(
      db
        .prepare('INSERT INTO stocktakes (warehouse_id, catalog_id, category_id, name, user_name) VALUES (?, ?, ?, ?, ?)')
        .run(b.warehouse_id, catalogId, b.category_id ?? null, b.name || `Inwentaryzacja ${new Date().toISOString().slice(0, 10)}`, userName(req)).lastInsertRowid,
    );
    // Stock-holding products of the catalog (optionally one category with subcategories).
    const cats = b.category_id
      ? (db.prepare('WITH RECURSIVE t(id) AS (SELECT ? UNION ALL SELECT c.id FROM categories c JOIN t ON c.parent_id = t.id) SELECT id FROM t').all(b.category_id) as any[]).map((r) => r.id)
      : null;
    const products = db
      .prepare(
        `SELECT p.id FROM products p WHERE p.catalog_id = ? AND p.is_bundle = 0 AND NOT EXISTS (SELECT 1 FROM products v WHERE v.parent_id = p.id)
         ${cats ? `AND COALESCE(p.category_id, (SELECT category_id FROM products x WHERE x.id = p.parent_id)) IN (${cats.map(() => '?').join(',')})` : ''}`,
      )
      .all(catalogId, ...(cats ?? [])) as { id: number }[];
    const ins = db.prepare('INSERT INTO stocktake_items (stocktake_id, product_id, expected) VALUES (?, ?, ?)');
    for (const p of products) ins.run(sid, p.id, warehouseStock(p.id, b.warehouse_id));
    return sid;
  });
  res.json({ id });
});

stocktakesRouter.get('/:id', (req, res) => {
  const s = db.prepare('SELECT s.*, w.name warehouse_name, d.number doc_number FROM stocktakes s JOIN warehouses w ON w.id = s.warehouse_id LEFT JOIN warehouse_docs d ON d.id = s.doc_id WHERE s.id = ?').get(idParam(req)) as any;
  if (!s) throw new HttpError(404, 'Stocktaking not found');
  const items = db
    .prepare(
      `SELECT i.*, p.name, p.variant_name, p.sku, p.ean, p.location FROM stocktake_items i JOIN products p ON p.id = i.product_id
       WHERE i.stocktake_id = ? ORDER BY p.location, p.name`,
    )
    .all(s.id);
  res.json({ ...s, items });
});

function openStocktake(id: number) {
  const s = db.prepare('SELECT * FROM stocktakes WHERE id = ?').get(id) as any;
  if (!s) throw new HttpError(404, 'Stocktaking not found');
  if (s.status !== 'open') throw new HttpError(409, 'The stocktaking is closed');
  return s;
}

/** Scanner input: EAN or SKU adds `qty` (default 1) to the counted quantity. */
stocktakesRouter.post('/:id/scan', (req, res) => {
  const s = openStocktake(idParam(req));
  const b = z.object({ code: z.string().trim().min(1).max(100), qty: z.number().int().min(-10000).max(10000).optional() }).parse(req.body);
  const it = db
    .prepare('SELECT i.product_id, i.counted, p.name, p.variant_name FROM stocktake_items i JOIN products p ON p.id = i.product_id WHERE i.stocktake_id = ? AND (p.ean = ? OR p.sku = ?) LIMIT 1')
    .get(s.id, b.code, b.code) as any;
  if (!it) throw new HttpError(404, `Code ${b.code} is not on this stocktaking list`);
  const counted = Math.max(0, (it.counted ?? 0) + (b.qty ?? 1));
  db.prepare('UPDATE stocktake_items SET counted = ? WHERE stocktake_id = ? AND product_id = ?').run(counted, s.id, it.product_id);
  res.json({ product_id: it.product_id, name: it.variant_name ? `${it.name} — ${it.variant_name}` : it.name, counted });
});

stocktakesRouter.put('/:id/items', (req, res) => {
  const s = openStocktake(idParam(req));
  const b = z.array(z.object({ product_id: z.number().int(), counted: z.number().int().min(0).max(1e7).nullable() })).max(10000).parse(req.body);
  const up = db.prepare('UPDATE stocktake_items SET counted = ? WHERE stocktake_id = ? AND product_id = ?');
  tx(() => {
    for (const it of b) up.run(it.counted, s.id, it.product_id);
  });
  res.json({ ok: true });
});

/**
 * Closes the stocktaking: differences between counted and current stock become
 * an INW document. Products that were not counted are left unchanged unless
 * `zero_uncounted` is set.
 */
stocktakesRouter.post('/:id/close', (req, res) => {
  const s = openStocktake(idParam(req));
  const b = z.object({ zero_uncounted: z.boolean().optional() }).parse(req.body ?? {});
  const user = userName(req);
  const items = db.prepare('SELECT product_id, counted FROM stocktake_items WHERE stocktake_id = ?').all(s.id) as { product_id: number; counted: number | null }[];
  const lines = items
    .map((i) => {
      const counted = i.counted ?? (b.zero_uncounted ? 0 : null);
      if (counted === null) return null;
      // Differences are taken against the stock at closing time (sales during counting are respected).
      const diff = counted - warehouseStock(i.product_id, s.warehouse_id);
      return diff ? { product_id: i.product_id, quantity: diff } : null;
    })
    .filter((x): x is { product_id: number; quantity: number } => !!x);
  const docId = tx(() => {
    let id: number | null = null;
    if (lines.length) {
      id = createDoc({ type: 'INW', warehouse_id: s.warehouse_id, notes: s.name, items: lines, confirm: true }, user);
    }
    db.prepare(`UPDATE stocktakes SET status = 'closed', closed_at = datetime('now'), doc_id = ? WHERE id = ?`).run(id, s.id);
    return id;
  });
  res.json({ ok: true, doc_id: docId, differences: lines.length });
});

stocktakesRouter.delete('/:id', (req, res) => {
  const s = openStocktake(idParam(req));
  db.prepare(`UPDATE stocktakes SET status = 'canceled', closed_at = datetime('now') WHERE id = ?`).run(s.id);
  res.json({ ok: true });
});
