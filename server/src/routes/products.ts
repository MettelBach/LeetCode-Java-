/**
 * Inventory products ("Produkty" / BaseLinker catalog): list per catalog with
 * category tree, prices per price group, stock per warehouse with reservations,
 * variants, bundles, texts per language and channel, tags, extra fields,
 * change log, bulk actions and CSV import/export with column mapping.
 */
import { Router } from 'express';
import { z } from 'zod';
import { db, parseJson, tx } from '../db/index.js';
import { csvCell, parseCsv } from '../lib/csv.js';
import { HttpError, idParam, q, round2 } from '../lib/http.js';
import {
  adjustStock,
  availableStock,
  catalogWarehouseId,
  defaultCatalogId,
  defaultPriceGroupId,
  setStock,
  stockIsDerived,
} from '../services/stock.js';
import { productLabelsPdf } from '../services/pdf.js';
import { userName } from './auth.js';
import { sendPdf } from './orders.js';

export const productsRouter = Router();

/* ---------------------------------- helpers ---------------------------------- */

const exists = (table: string, id: unknown) => id != null && !!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id);

function catalogOf(productId: number): number {
  const r = db.prepare('SELECT catalog_id FROM products WHERE id = ?').get(productId) as { catalog_id: number | null } | undefined;
  if (!r) throw new HttpError(404, 'Product not found');
  return r.catalog_id ?? defaultCatalogId();
}

/** Category ids of a category and all its subcategories. */
function categorySubtree(id: number): number[] {
  return (
    db
      .prepare(
        `WITH RECURSIVE t(id) AS (SELECT ? UNION ALL SELECT c.id FROM categories c JOIN t ON c.parent_id = t.id) SELECT id FROM t`,
      )
      .all(id) as { id: number }[]
  ).map((r) => r.id);
}

function checkSku(sku: string | undefined, catalogId: number, exceptId = 0) {
  if (!sku) return;
  const dup = db.prepare('SELECT id FROM products WHERE sku = ? AND catalog_id = ? AND id != ?').get(sku, catalogId, exceptId) as { id: number } | undefined;
  if (dup) throw new HttpError(409, `SKU "${sku}" is already used by product ${dup.id} in this catalog`);
}

function logChange(productId: number, field: string, oldV: unknown, newV: unknown, user: string) {
  const o = oldV == null ? '' : typeof oldV === 'string' ? oldV : JSON.stringify(oldV);
  const n = newV == null ? '' : typeof newV === 'string' ? newV : JSON.stringify(newV);
  if (o === n) return;
  db.prepare('INSERT INTO product_log (product_id, field, old_value, new_value, user_name) VALUES (?, ?, ?, ?, ?)').run(
    productId,
    field,
    o.slice(0, 2000),
    n.slice(0, 2000),
    user,
  );
}

/** Price groups available in a catalog (all groups when none are assigned). */
function catalogPriceGroups(catalogId: number): { id: number; name: string; currency: string; is_default: number }[] {
  const rows = db
    .prepare('SELECT g.* FROM price_groups g JOIN catalog_price_groups c ON c.price_group_id = g.id WHERE c.catalog_id = ? ORDER BY g.is_default DESC, g.id')
    .all(catalogId) as any[];
  return rows.length ? rows : (db.prepare('SELECT * FROM price_groups ORDER BY is_default DESC, id').all() as any[]);
}

function catalogWarehouses(catalogId: number): { id: number; name: string; code: string }[] {
  const rows = db
    .prepare('SELECT w.id, w.name, w.code FROM warehouses w JOIN catalog_warehouses c ON c.warehouse_id = w.id WHERE c.catalog_id = ? ORDER BY w.is_default DESC, w.id')
    .all(catalogId) as any[];
  return rows.length ? rows : (db.prepare('SELECT id, name, code FROM warehouses ORDER BY is_default DESC, id').all() as any[]);
}

/** Sets the price of a product in a price group; the default group is mirrored in products.price. */
function setPrice(productId: number, groupId: number, price: number, user: string) {
  const old = db.prepare('SELECT price FROM product_prices WHERE product_id = ? AND price_group_id = ?').get(productId, groupId) as { price: number } | undefined;
  db.prepare(
    `INSERT INTO product_prices (product_id, price_group_id, price) VALUES (?, ?, ?)
     ON CONFLICT(product_id, price_group_id) DO UPDATE SET price = excluded.price`,
  ).run(productId, groupId, round2(price));
  if (groupId === defaultPriceGroupId()) db.prepare(`UPDATE products SET price = ?, updated_at = datetime('now') WHERE id = ?`).run(round2(price), productId);
  const g = db.prepare('SELECT name FROM price_groups WHERE id = ?').get(groupId) as { name: string } | undefined;
  logChange(productId, `price:${g?.name ?? groupId}`, old?.price, round2(price), user);
}

function pricesOf(productId: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of db.prepare('SELECT price_group_id, price FROM product_prices WHERE product_id = ?').all(productId) as { price_group_id: number; price: number }[]) {
    out[r.price_group_id] = r.price;
  }
  if (out[defaultPriceGroupId()] === undefined) {
    const p = db.prepare('SELECT price FROM products WHERE id = ?').get(productId) as { price: number } | undefined;
    if (p) out[defaultPriceGroupId()] = p.price;
  }
  return out;
}

function stocksOf(productId: number) {
  return db
    .prepare(
      `SELECT w.id warehouse_id, w.name, w.code, COALESCE(s.stock, 0) stock, COALESCE(s.reserved, 0) reserved
       FROM warehouses w LEFT JOIN product_stock s ON s.warehouse_id = w.id AND s.product_id = ? ORDER BY w.is_default DESC, w.id`,
    )
    .all(productId) as { warehouse_id: number; name: string; code: string; stock: number; reserved: number }[];
}

/** "Biały XL" → "BIALYXL" (Polish letters transliterated for SKUs). */
function slugSku(v: string) {
  const map: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
  return v
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (m) => map[m])
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

/* ---------------------------------- schema ---------------------------------- */

const productSchema = z.object({
  parent_id: z.number().int().nullable().optional(),
  catalog_id: z.number().int().optional(),
  sku: z.string().trim().max(100).optional(),
  ean: z.string().trim().max(50).optional(),
  name: z.string().trim().min(1).max(500),
  description: z.string().max(100000).optional(),
  price: z.number().min(0).max(1e7).optional(),
  purchase_price: z.number().min(0).max(1e7).optional(),
  tax_rate: z.number().min(0).max(100).optional(),
  weight: z.number().min(0).max(100000).optional(),
  width: z.number().min(0).max(100000).optional(),
  height: z.number().min(0).max(100000).optional(),
  length: z.number().min(0).max(100000).optional(),
  location: z.string().max(100).optional(),
  category_id: z.number().int().nullable().optional(),
  manufacturer_id: z.number().int().nullable().optional(),
  images: z.array(z.string().url().max(2000)).max(16).optional(),
  attributes: z.record(z.string(), z.string().max(200)).optional(),
  features: z.array(z.object({ name: z.string().max(200), value: z.string().max(1000) })).max(200).optional(),
  variant_name: z.string().max(200).optional(),
  min_stock: z.number().int().min(0).max(1e7).optional(),
  is_bundle: z.boolean().optional(),
  /** Prices per price group: { "<group id>": price }. */
  prices: z.record(z.string(), z.number().min(0).max(1e7)).optional(),
  /** Stock per warehouse: { "<warehouse id>": quantity } (absolute values). */
  stocks: z.record(z.string(), z.number().int().min(-1e6).max(1e7)).optional(),
  /** Legacy single stock value (default warehouse of the catalog). */
  stock: z.number().int().min(-1e6).max(1e7).optional(),
  warehouse_id: z.number().int().optional(),
  texts: z
    .array(z.object({ lang: z.string().min(2).max(5), integration_id: z.number().int().min(0), name: z.string().max(500), description: z.string().max(100000) }))
    .max(200)
    .optional(),
  extra: z.record(z.string(), z.string().max(5000)).optional(),
  tag_ids: z.array(z.number().int()).max(100).optional(),
  bundle_items: z.array(z.object({ product_id: z.number().int(), quantity: z.number().int().min(1).max(10000) })).max(100).optional(),
});

const SIMPLE = ['sku', 'ean', 'name', 'description', 'purchase_price', 'tax_rate', 'weight', 'width', 'height', 'length', 'location', 'category_id', 'manufacturer_id', 'variant_name', 'min_stock'] as const;

type ProductInput = Partial<z.infer<typeof productSchema>>;

function validateRefs(b: ProductInput, catalogId: number, selfId = 0) {
  if (b.catalog_id !== undefined && !exists('catalogs', b.catalog_id)) throw new HttpError(400, 'Unknown catalog');
  if (b.category_id && !exists('categories', b.category_id)) throw new HttpError(400, 'Unknown category');
  if (b.manufacturer_id && !exists('manufacturers', b.manufacturer_id)) throw new HttpError(400, 'Unknown manufacturer');
  if (b.parent_id) {
    if (b.parent_id === selfId) throw new HttpError(400, 'A product cannot be its own variant');
    const parent = db.prepare('SELECT id, parent_id, catalog_id, is_bundle FROM products WHERE id = ?').get(b.parent_id) as any;
    if (!parent) throw new HttpError(400, 'Parent product not found');
    if (parent.parent_id) throw new HttpError(400, 'A variant cannot have variants');
    if (parent.is_bundle) throw new HttpError(400, 'A bundle cannot have variants');
    if (selfId && db.prepare('SELECT 1 FROM products WHERE parent_id = ?').get(selfId)) throw new HttpError(400, 'A product with variants cannot become a variant');
  }
  for (const wh of Object.keys(b.stocks ?? {})) if (!exists('warehouses', Number(wh))) throw new HttpError(400, `Unknown warehouse ${wh}`);
  for (const g of Object.keys(b.prices ?? {})) if (!exists('price_groups', Number(g))) throw new HttpError(400, `Unknown price group ${g}`);
  for (const t of b.tag_ids ?? []) if (!exists('tags', t)) throw new HttpError(400, `Unknown tag ${t}`);
  for (const f of Object.keys(b.extra ?? {})) if (!exists('extra_fields', Number(f))) throw new HttpError(400, `Unknown extra field ${f}`);
  for (const it of b.bundle_items ?? []) {
    const c = db.prepare('SELECT id, is_bundle, catalog_id FROM products WHERE id = ?').get(it.product_id) as any;
    if (!c) throw new HttpError(400, `Unknown bundle component ${it.product_id}`);
    if (c.id === selfId) throw new HttpError(400, 'A bundle cannot contain itself');
    if (c.is_bundle) throw new HttpError(400, 'A bundle cannot contain another bundle');
    if (db.prepare('SELECT 1 FROM products WHERE parent_id = ?').get(c.id)) throw new HttpError(400, 'Choose a variant, not a product with variants, as a bundle component');
    if (c.catalog_id !== catalogId) throw new HttpError(400, 'Bundle components must be in the same catalog');
  }
}

/** Writes all the "rich" parts of a product (prices, stocks, texts, tags, extra fields, bundle). */
function saveDetails(id: number, b: ProductInput, user: string, isNew: boolean) {
  const catalogId = catalogOf(id);
  if (b.prices) for (const [g, v] of Object.entries(b.prices)) setPrice(id, Number(g), v, user);
  else if (b.price !== undefined) setPrice(id, defaultPriceGroupId(), b.price, user);
  else if (isNew) setPrice(id, defaultPriceGroupId(), 0, user);
  if (b.is_bundle !== undefined) db.prepare('UPDATE products SET is_bundle = ? WHERE id = ?').run(b.is_bundle ? 1 : 0, id);
  if (b.bundle_items) {
    db.prepare('DELETE FROM bundle_items WHERE bundle_id = ?').run(id);
    const ins = db.prepare('INSERT INTO bundle_items (bundle_id, product_id, quantity) VALUES (?, ?, ?)');
    for (const it of b.bundle_items) ins.run(id, it.product_id, it.quantity);
    db.prepare('UPDATE products SET is_bundle = ? WHERE id = ?').run(b.bundle_items.length ? 1 : 0, id);
  }
  const reason = isNew ? 'Stan początkowy' : 'Korekta ręczna';
  if (b.stocks) {
    for (const [wh, v] of Object.entries(b.stocks)) {
      if (isNew ? v !== 0 : true) setStock(id, v, reason, Number(wh), { user });
    }
  } else if (b.stock !== undefined && (b.stock !== 0 || !isNew)) setStock(id, b.stock, reason, b.warehouse_id ?? catalogWarehouseId(catalogId), { user });
  if (b.texts) {
    const up = db.prepare(
      `INSERT INTO product_texts (product_id, lang, integration_id, name, description) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(product_id, lang, integration_id) DO UPDATE SET name = excluded.name, description = excluded.description`,
    );
    for (const t of b.texts) {
      if (!t.name && !t.description) db.prepare('DELETE FROM product_texts WHERE product_id = ? AND lang = ? AND integration_id = ?').run(id, t.lang, t.integration_id);
      else up.run(id, t.lang, t.integration_id, t.name, t.description);
    }
  }
  if (b.tag_ids) {
    db.prepare('DELETE FROM product_tags WHERE product_id = ?').run(id);
    for (const t of new Set(b.tag_ids)) db.prepare('INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)').run(id, t);
  }
  if (b.extra) {
    for (const [f, v] of Object.entries(b.extra)) {
      if (v === '') db.prepare('DELETE FROM product_extra_values WHERE product_id = ? AND field_id = ?').run(id, Number(f));
      else
        db.prepare(
          `INSERT INTO product_extra_values (product_id, field_id, value) VALUES (?, ?, ?) ON CONFLICT(product_id, field_id) DO UPDATE SET value = excluded.value`,
        ).run(id, Number(f), v);
    }
  }
}

/**
 * Copies a product without stock: data, prices, texts, tags, extra fields and
 * bundle composition; variants are copied too. SKUs get a "-KOPIA" suffix.
 */
function duplicateProduct(id: number, user: string, parentId: number | null = null): number {
  const src = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;
  if (!src) throw new HttpError(404, 'Product not found');
  let sku = '';
  if (src.sku) {
    for (let n = 1; ; n++) {
      sku = `${src.sku}-KOPIA${n > 1 ? n : ''}`;
      if (!db.prepare('SELECT 1 FROM products WHERE sku = ? AND catalog_id IS ?').get(sku, src.catalog_id)) break;
    }
  }
  const skip = new Set(['id', 'sku', 'ean', 'stock', 'created_at', 'updated_at', 'parent_id', 'name']);
  const cols = Object.keys(src).filter((c) => !skip.has(c));
  const r = db
    .prepare(`INSERT INTO products (sku, ean, name, parent_id, stock, ${cols.join(', ')}) VALUES (?, '', ?, ?, 0, ${cols.map(() => '?').join(', ')})`)
    .run(sku, parentId ? src.name : `${src.name} (kopia)`, parentId, ...cols.map((c) => src[c]));
  const copy = Number(r.lastInsertRowid);
  db.prepare('INSERT INTO product_prices (product_id, price_group_id, price) SELECT ?, price_group_id, price FROM product_prices WHERE product_id = ?').run(copy, id);
  for (const [table, key] of [
    ['product_tags', 'tag_id'],
    ['product_extra_values', 'field_id, value'],
    ['bundle_items', 'product_id, quantity'],
  ] as const) {
    const fk = table === 'bundle_items' ? 'bundle_id' : 'product_id';
    db.prepare(`INSERT INTO ${table} (${fk}, ${key}) SELECT ?, ${key} FROM ${table} WHERE ${fk} = ?`).run(copy, id);
  }
  const textCols = (db.prepare(`SELECT name FROM pragma_table_info('product_texts') WHERE name != 'product_id' AND name != 'id'`).all() as { name: string }[]).map((c) => c.name);
  db.prepare(`INSERT INTO product_texts (product_id, ${textCols.join(', ')}) SELECT ?, ${textCols.join(', ')} FROM product_texts WHERE product_id = ?`).run(copy, id);
  for (const v of db.prepare('SELECT id FROM products WHERE parent_id = ?').all(id) as { id: number }[]) duplicateProduct(v.id, user, copy);
  if (!parentId) logChange(copy, 'copy_of', '', String(id), user);
  return copy;
}

/* ----------------------------------- list ----------------------------------- */

/** Barcode labels of products (bulk action "Drukuj etykiety"). */
productsRouter.get('/labels.pdf', async (req, res) => {
  const ids = q.ints(req.query.ids).slice(0, 500);
  const copies = Math.min(100, Math.max(1, q.int(req.query.copies) ?? 1));
  const byStock = req.query.copies === 'stock';
  const groupId = q.int(req.query.price_group_id) ?? defaultPriceGroupId();
  const group = db.prepare('SELECT currency FROM price_groups WHERE id = ?').get(groupId) as { currency: string } | undefined;
  const items: Parameters<typeof productLabelsPdf>[0] = [];
  for (const id of ids) {
    // A product with variants prints labels of its variants.
    const rows = db.prepare('SELECT * FROM products WHERE (id = ? AND NOT EXISTS (SELECT 1 FROM products v WHERE v.parent_id = ?)) OR parent_id = ? ORDER BY id').all(id, id, id) as any[];
    for (const p of rows) {
      const price = (db.prepare('SELECT price FROM product_prices WHERE product_id = ? AND price_group_id = ?').get(p.id, groupId) as { price: number } | undefined)?.price ?? null;
      const name = p.parent_id ? `${(db.prepare('SELECT name FROM products WHERE id = ?').get(p.parent_id) as any)?.name ?? ''} ${p.name}`.trim() : p.name;
      items.push({ name, sku: p.sku, ean: p.ean, price, currency: group?.currency ?? 'PLN', copies: byStock ? Math.min(100, Math.max(0, p.stock)) : copies });
    }
  }
  sendPdf(res, await productLabelsPdf(items.filter((i) => i.copies > 0)), 'etykiety.pdf');
});

productsRouter.get('/', (req, res) => {
  const catalog = q.int(req.query.catalog_id) ?? defaultCatalogId();
  const search = q.str(req.query.search);
  const category = q.int(req.query.category_id);
  const manufacturer = q.int(req.query.manufacturer_id);
  const warehouse = q.int(req.query.warehouse_id);
  const tag = q.int(req.query.tag_id);
  const stock = q.str(req.query.stock);
  const priceGroup = q.int(req.query.price_group_id) ?? defaultPriceGroupId();
  const page = Math.max(1, q.int(req.query.page) ?? 1);
  const perPage = Math.min(500, Math.max(1, q.int(req.query.per_page) ?? 50));
  const w = ['p.parent_id IS NULL', 'p.catalog_id = ?'];
  const p: unknown[] = [catalog];
  const onlyIds = q.ints(req.query.ids).slice(0, 500);
  if (onlyIds.length) {
    w.push(`p.id IN (${onlyIds.map(() => '?').join(',')})`);
    p.push(...onlyIds);
  }
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    w.push(`(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.ean LIKE ? ESCAPE '\\' OR CAST(p.id AS TEXT) = ?
      OR EXISTS (SELECT 1 FROM products v WHERE v.parent_id = p.id AND (v.sku LIKE ? ESCAPE '\\' OR v.ean LIKE ? ESCAPE '\\' OR v.name LIKE ? ESCAPE '\\')))`);
    p.push(like, like, like, search, like, like, like);
  }
  if (category) {
    const ids = categorySubtree(category);
    w.push(`p.category_id IN (${ids.map(() => '?').join(',')})`);
    p.push(...ids);
  }
  if (q.str(req.query.category_id) === 'none') w.push('p.category_id IS NULL');
  if (manufacturer) {
    w.push('p.manufacturer_id = ?');
    p.push(manufacturer);
  }
  if (tag) {
    w.push('EXISTS (SELECT 1 FROM product_tags t WHERE t.product_id = p.id AND t.tag_id = ?)');
    p.push(tag);
  }
  const whCond = warehouse ? ` AND s.warehouse_id = ${Number(warehouse)}` : '';
  // Stock of a row: own stock, or the sum of its variants.
  const stockExpr = `(SELECT COALESCE(SUM(s.stock), 0) FROM product_stock s WHERE (s.product_id = p.id OR s.product_id IN (SELECT id FROM products v WHERE v.parent_id = p.id))${whCond})`;
  const reservedExpr = `(SELECT COALESCE(SUM(s.reserved), 0) FROM product_stock s WHERE (s.product_id = p.id OR s.product_id IN (SELECT id FROM products v WHERE v.parent_id = p.id))${whCond})`;
  if (stock === 'in') w.push(`${stockExpr} > 0`);
  if (stock === 'out') w.push(`${stockExpr} <= 0 AND p.is_bundle = 0`);
  if (stock === 'low') w.push(`${stockExpr} <= MAX(p.min_stock, 3) AND ${stockExpr} > 0`);
  if (stock === 'negative') w.push(`${stockExpr} < 0`);
  if (stock === 'reserved') w.push(`${reservedExpr} > 0`);
  const priceExpr = `COALESCE((SELECT price FROM product_prices pp WHERE pp.product_id = p.id AND pp.price_group_id = ${Number(priceGroup)}), p.price)`;
  if (q.num(req.query.price_min) !== undefined) {
    w.push(`${priceExpr} >= ?`);
    p.push(q.num(req.query.price_min));
  }
  if (q.num(req.query.price_max) !== undefined) {
    w.push(`${priceExpr} <= ?`);
    p.push(q.num(req.query.price_max));
  }
  if (req.query.has_ean === '0') w.push(`p.ean = ''`);
  if (req.query.has_ean === '1') w.push(`p.ean != ''`);
  if (req.query.no_images === '1') w.push(`p.images = '[]'`);
  if (req.query.has_offers === '1') w.push('EXISTS (SELECT 1 FROM offers o WHERE o.product_id = p.id OR o.product_id IN (SELECT id FROM products v WHERE v.parent_id = p.id))');
  if (req.query.has_offers === '0') w.push('NOT EXISTS (SELECT 1 FROM offers o WHERE o.product_id = p.id OR o.product_id IN (SELECT id FROM products v WHERE v.parent_id = p.id))');
  if (q.num(req.query.stock_min) !== undefined) {
    w.push(`${stockExpr} >= ?`);
    p.push(q.num(req.query.stock_min));
  }
  if (q.num(req.query.stock_max) !== undefined) {
    w.push(`${stockExpr} <= ?`);
    p.push(q.num(req.query.stock_max));
  }
  if (req.query.no_description === '1') w.push(`p.description = '' AND NOT EXISTS (SELECT 1 FROM product_texts t WHERE t.product_id = p.id AND t.description != '')`);
  const location = q.str(req.query.location);
  if (location) {
    w.push(`p.location LIKE ? ESCAPE '\\'`);
    p.push(`%${location.replace(/[\\%_]/g, (m) => '\\' + m)}%`);
  }
  const added = (k: string, end: boolean) => {
    const v = q.str(req.query[k]);
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v} ${end ? '23:59:59' : '00:00:00'}` : undefined;
  };
  if (added('date_from', false)) {
    w.push('p.created_at >= ?');
    p.push(added('date_from', false));
  }
  if (added('date_to', true)) {
    w.push('p.created_at <= ?');
    p.push(added('date_to', true));
  }
  // Listed / not listed on a given marketplace account (like "Wystawione na…" in BaseLinker).
  const onIntegration = q.int(req.query.integration_id);
  if (onIntegration && (req.query.listed === '1' || req.query.listed === '0')) {
    w.push(
      `${req.query.listed === '0' ? 'NOT ' : ''}EXISTS (SELECT 1 FROM offers o WHERE o.integration_id = ? AND o.status != 'ended' AND (o.product_id = p.id OR o.product_id IN (SELECT id FROM products v WHERE v.parent_id = p.id)))`,
    );
    p.push(onIntegration);
  }
  const extraField = q.int(req.query.extra_field_id);
  const extraValue = q.str(req.query.extra_value);
  if (extraField) {
    if (extraValue) {
      w.push(`EXISTS (SELECT 1 FROM product_extra_values e WHERE e.product_id = p.id AND e.field_id = ? AND e.value LIKE ? ESCAPE '\\')`);
      p.push(extraField, `%${extraValue.replace(/[\\%_]/g, (m) => '\\' + m)}%`);
    } else {
      w.push(`NOT EXISTS (SELECT 1 FROM product_extra_values e WHERE e.product_id = p.id AND e.field_id = ? AND e.value != '')`);
      p.push(extraField);
    }
  }
  if (req.query.type === 'bundle') w.push('p.is_bundle = 1');
  if (req.query.type === 'variants') w.push('EXISTS (SELECT 1 FROM products v WHERE v.parent_id = p.id)');
  if (req.query.type === 'simple') w.push('p.is_bundle = 0 AND NOT EXISTS (SELECT 1 FROM products v WHERE v.parent_id = p.id)');
  const sortMap: Record<string, string> = {
    id: 'p.id',
    name: 'p.name COLLATE NOCASE',
    sku: 'p.sku',
    price: priceExpr,
    stock: stockExpr,
    updated: 'p.updated_at',
    sold: 'sold_30d',
  };
  const sort = sortMap[String(req.query.sort)] ?? 'p.id';
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
  const where = w.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) c FROM products p WHERE ${where}`).get(...p) as { c: number }).c;
  const rows = db
    .prepare(
      `SELECT p.*, c.name category_name, m.name manufacturer_name, ${stockExpr} AS total_stock, ${reservedExpr} AS total_reserved,
        ${priceExpr} AS group_price,
        (SELECT COUNT(*) FROM products v WHERE v.parent_id = p.id) AS variant_count,
        (SELECT COUNT(*) FROM offers o WHERE o.product_id = p.id OR o.product_id IN (SELECT id FROM products v WHERE v.parent_id = p.id)) AS offer_count,
        (SELECT COALESCE(SUM(i.quantity),0) FROM order_items i JOIN orders o ON o.id = i.order_id
           WHERE (i.product_id = p.id OR i.product_id IN (SELECT id FROM products v WHERE v.parent_id = p.id)) AND o.deleted = 0 AND o.date_add >= datetime('now','-30 days')) AS sold_30d
       FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN manufacturers m ON m.id = p.manufacturer_id
       WHERE ${where} ORDER BY ${sort} ${dir}, p.id ${dir} LIMIT ? OFFSET ?`,
    )
    .all(...p, perPage, (page - 1) * perPage) as any[];
  const expand = req.query.expand === '1';
  for (const r of rows) {
    r.images = parseJson(r.images, []);
    r.attributes = parseJson(r.attributes, {});
    r.features = parseJson(r.features, []);
    r.tags = db.prepare('SELECT t.id, t.name, t.color FROM tags t JOIN product_tags pt ON pt.tag_id = t.id WHERE pt.product_id = ?').all(r.id);
    const own = db.prepare('SELECT warehouse_id, stock, reserved FROM product_stock WHERE product_id = ? OR product_id IN (SELECT id FROM products WHERE parent_id = ?)').all(r.id, r.id) as any[];
    const stocks: Record<string, { stock: number; reserved: number }> = {};
    for (const s of own) {
      stocks[s.warehouse_id] ??= { stock: 0, reserved: 0 };
      stocks[s.warehouse_id].stock += s.stock;
      stocks[s.warehouse_id].reserved += s.reserved;
    }
    r.stocks = stocks;
    r.available = availableStock(r.id, warehouse ? [warehouse] : null);
    if (expand && r.variant_count) {
      r.variants = (db.prepare('SELECT * FROM products WHERE parent_id = ? ORDER BY id').all(r.id) as any[]).map((v) => ({
        ...v,
        images: parseJson(v.images, []),
        attributes: parseJson(v.attributes, {}),
        group_price: pricesOf(v.id)[priceGroup] ?? v.price,
        stocks: Object.fromEntries(stocksOf(v.id).map((s) => [s.warehouse_id, { stock: s.stock, reserved: s.reserved }])),
      }));
    }
  }
  res.json({ total, page, per_page: perPage, rows });
});

/** Lightweight lookup (add product to an order / document / bundle): stock-holding products only. */
productsRouter.get('/search', (req, res) => {
  const s = q.str(req.query.q) ?? '';
  const like = `%${s.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
  const cat = q.int(req.query.catalog_id);
  const wh = q.int(req.query.warehouse_id);
  const allowParents = req.query.parents === '1';
  const rows = db
    .prepare(
      `SELECT p.id, p.sku, p.ean, p.name, p.variant_name, p.price, p.tax_rate, p.weight, p.stock, p.location, p.images, p.parent_id, p.is_bundle, p.catalog_id,
         p.purchase_price, p.avg_cost, (SELECT name FROM products x WHERE x.id = p.parent_id) parent_name
       FROM products p WHERE (p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.ean = ? OR CAST(p.id AS TEXT) = ?)
       ${allowParents ? '' : 'AND NOT EXISTS (SELECT 1 FROM products v WHERE v.parent_id = p.id)'} ${cat ? 'AND p.catalog_id = ?' : ''}
       ORDER BY (p.ean = ? OR p.sku = ?) DESC, p.name LIMIT 20`,
    )
    .all(like, like, s, s, ...(cat ? [cat] : []), s, s) as any[];
  res.json(
    rows.map((r) => ({
      ...r,
      images: parseJson(r.images, []),
      available: availableStock(r.id, wh ? [wh] : null),
      warehouse_stock: wh ? ((db.prepare('SELECT stock FROM product_stock WHERE product_id = ? AND warehouse_id = ?').get(r.id, wh) as any)?.stock ?? 0) : undefined,
    })),
  );
});

/* ------------------------------- import / export ------------------------------- */

const EXPORT_BASE = ['id', 'parent_sku', 'sku', 'ean', 'name', 'variant_name', 'purchase_price', 'tax_rate', 'weight', 'width', 'height', 'length', 'location', 'category', 'manufacturer', 'images', 'description'];

productsRouter.get('/export.csv', (req, res) => {
  const catalogId = q.int(req.query.catalog_id) ?? defaultCatalogId();
  const groups = catalogPriceGroups(catalogId);
  const whs = catalogWarehouses(catalogId);
  const rows = db
    .prepare(
      `SELECT p.*, (SELECT sku FROM products x WHERE x.id = p.parent_id) parent_sku, c.name category, m.name manufacturer
       FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN manufacturers m ON m.id = p.manufacturer_id
       WHERE p.catalog_id = ? ORDER BY COALESCE(p.parent_id, p.id), p.parent_id IS NOT NULL, p.id`,
    )
    .all(catalogId) as any[];
  const header = [...EXPORT_BASE, ...groups.map((g) => `price_${g.id}`), ...whs.map((w) => `stock_${w.code || w.id}`)];
  const lines = rows.map((r) => {
    const prices = pricesOf(r.id);
    const stocks = Object.fromEntries(stocksOf(r.id).map((s) => [s.warehouse_id, s.stock]));
    return [
      ...EXPORT_BASE.map((c) => (c === 'images' ? parseJson<string[]>(r.images, []).join('|') : r[c])),
      ...groups.map((g) => prices[g.id] ?? ''),
      ...whs.map((w) => stocks[w.id] ?? 0),
    ];
  });
  const cat = db.prepare('SELECT name FROM catalogs WHERE id = ?').get(catalogId) as { name: string } | undefined;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="produkty-${(cat?.name ?? 'katalog').replace(/[^\w-]+/g, '_')}.csv"`);
  res.send('﻿' + [header.map(csvCell).join(';'), ...lines.map((l) => l.map(csvCell).join(';'))].join('\r\n'));
});

/** Polish / English header aliases → product fields. */
const HEADER_ALIASES: Record<string, string> = {
  id: 'id',
  sku: 'sku',
  kod: 'sku',
  'kod produktu': 'sku',
  symbol: 'sku',
  ean: 'ean',
  'kod ean': 'ean',
  gtin: 'ean',
  name: 'name',
  nazwa: 'name',
  'nazwa produktu': 'name',
  price: 'price',
  cena: 'price',
  'cena brutto': 'price',
  purchase_price: 'purchase_price',
  'cena zakupu': 'purchase_price',
  tax_rate: 'tax_rate',
  vat: 'tax_rate',
  stawka_vat: 'tax_rate',
  stock: 'stock',
  stan: 'stock',
  ilosc: 'stock',
  'ilość': 'stock',
  weight: 'weight',
  waga: 'weight',
  width: 'width',
  szerokosc: 'width',
  'szerokość': 'width',
  height: 'height',
  wysokosc: 'height',
  'wysokość': 'height',
  length: 'length',
  dlugosc: 'length',
  'długość': 'length',
  location: 'location',
  lokalizacja: 'location',
  category: 'category',
  kategoria: 'category',
  manufacturer: 'manufacturer',
  producent: 'manufacturer',
  description: 'description',
  opis: 'description',
  images: 'images',
  zdjecia: 'images',
  'zdjęcia': 'images',
  parent_sku: 'parent_sku',
  'sku rodzica': 'parent_sku',
  variant_name: 'variant_name',
  wariant: 'variant_name',
};

const IMPORT_FIELDS = ['id', 'sku', 'ean', 'name', 'price', 'purchase_price', 'tax_rate', 'stock', 'weight', 'width', 'height', 'length', 'location', 'category', 'manufacturer', 'description', 'images', 'parent_sku', 'variant_name'];

function suggestMapping(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((h, i) => {
    const k = h.toLowerCase().trim();
    if (HEADER_ALIASES[k]) out[i] = HEADER_ALIASES[k];
    else if (/^price_\d+$/.test(k) || /^stock_.+$/.test(k)) out[i] = k;
  });
  return out;
}

productsRouter.post('/import/preview', (req, res) => {
  const b = z.object({ csv: z.string().max(20_000_000) }).parse(req.body);
  const rows = parseCsv(b.csv);
  if (rows.length < 2) throw new HttpError(400, 'CSV must have a header and at least one row');
  res.json({ headers: rows[0], sample: rows.slice(1, 6), rows: rows.length - 1, mapping: suggestMapping(rows[0]), fields: IMPORT_FIELDS });
});

productsRouter.post('/import', (req, res) => {
  const b = z
    .object({
      csv: z.string().max(20_000_000),
      catalog_id: z.number().int().optional(),
      /** column index → field (see IMPORT_FIELDS, price_<group id>, stock_<warehouse code or id>). */
      mapping: z.record(z.string(), z.string()).optional(),
      match_by: z.enum(['sku', 'ean', 'id']).optional(),
      create_new: z.boolean().optional(),
      update_existing: z.boolean().optional(),
      stock_mode: z.enum(['set', 'add']).optional(),
    })
    .parse(req.body);
  const catalogId = b.catalog_id ?? defaultCatalogId();
  if (!exists('catalogs', catalogId)) throw new HttpError(400, 'Unknown catalog');
  const rows = parseCsv(b.csv);
  if (rows.length < 2) throw new HttpError(400, 'CSV must have a header and at least one row');
  const mapping = b.mapping ?? suggestMapping(rows[0]);
  const matchBy = b.match_by ?? 'sku';
  const createNew = b.create_new ?? true;
  const updateExisting = b.update_existing ?? true;
  const user = userName(req);
  const whs = catalogWarehouses(catalogId);
  const whByKey = (key: string) => whs.find((w) => w.code === key || String(w.id) === key) ?? null;
  const defaultWh = catalogWarehouseId(catalogId);
  const result = { created: 0, updated: 0, skipped: 0, errors: [] as { row: number; message: string }[] };
  const num = (v: string | undefined) => {
    if (v === undefined || v.trim() === '') return undefined;
    const n = Number(v.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  };
  const categoryId = (name: string) => {
    const path = name.split(/\s*[>/|]\s*/).filter(Boolean);
    let parent: number | null = null;
    for (const part of path) {
      const found = db.prepare('SELECT id FROM categories WHERE name = ? AND parent_id IS ? AND catalog_id = ?').get(part, parent, catalogId) as { id: number } | undefined;
      parent = found ? found.id : Number(db.prepare('INSERT INTO categories (name, parent_id, catalog_id) VALUES (?, ?, ?)').run(part, parent, catalogId).lastInsertRowid);
    }
    return parent;
  };
  const manufacturerId = (name: string) => {
    const found = db.prepare('SELECT id FROM manufacturers WHERE name = ?').get(name) as { id: number } | undefined;
    return found ? found.id : Number(db.prepare('INSERT INTO manufacturers (name) VALUES (?)').run(name).lastInsertRowid);
  };
  rows.slice(1).forEach((cells, i) => {
    const rowNo = i + 2;
    const get = (field: string) => {
      const col = Object.entries(mapping).find(([, f]) => f === field)?.[0];
      return col === undefined ? undefined : cells[Number(col)];
    };
    try {
      const outcome = tx((): 'created' | 'updated' | 'skipped' => {
        const key = get(matchBy);
        let existing: { id: number } | undefined;
        if (key) {
          existing =
            matchBy === 'id'
              ? (db.prepare('SELECT id FROM products WHERE id = ? AND catalog_id = ?').get(Number(key), catalogId) as any)
              : (db.prepare(`SELECT id FROM products WHERE ${matchBy} = ? AND catalog_id = ?`).get(key, catalogId) as any);
        }
        if (existing && !updateExisting) return 'skipped';
        if (!existing && !createNew) return 'skipped';
        const data: Record<string, unknown> = {};
        for (const f of ['sku', 'ean', 'name', 'location', 'description', 'variant_name']) if (get(f) !== undefined) data[f] = get(f);
        for (const f of ['purchase_price', 'tax_rate', 'weight', 'width', 'height', 'length']) {
          const v = num(get(f));
          if (v !== undefined) {
            if (Number.isNaN(v) || v < 0) throw new Error(`invalid number in column "${f}"`);
            data[f] = v;
          }
        }
        if (get('category')) data.category_id = categoryId(get('category')!);
        if (get('manufacturer')) data.manufacturer_id = manufacturerId(get('manufacturer')!);
        if (get('images') !== undefined) {
          const imgs = get('images')!.split(/[|,\s]+/).filter((u) => /^https?:\/\//i.test(u)).slice(0, 16);
          data.images = JSON.stringify(imgs);
        }
        if (get('parent_sku')) {
          const parent = db.prepare('SELECT id FROM products WHERE sku = ? AND catalog_id = ? AND parent_id IS NULL').get(get('parent_sku'), catalogId) as { id: number } | undefined;
          if (!parent) throw new Error(`parent SKU "${get('parent_sku')}" not found (put parents above variants)`);
          data.parent_id = parent.id;
        }
        let id: number;
        if (existing) {
          id = existing.id;
          if (data.sku) checkSku(String(data.sku), catalogId, id);
          if (Object.keys(data).length)
            db.prepare(`UPDATE products SET ${Object.keys(data).map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...Object.values(data), id);
        } else {
          if (!data.name) throw new Error('missing product name');
          if (data.sku) checkSku(String(data.sku), catalogId);
          const cols = ['catalog_id', ...Object.keys(data)];
          id = Number(db.prepare(`INSERT INTO products (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(catalogId, ...Object.values(data)).lastInsertRowid);
        }
        const price = num(get('price'));
        if (price !== undefined) {
          if (Number.isNaN(price) || price < 0) throw new Error('invalid price');
          setPrice(id, defaultPriceGroupId(), price, user);
        } else if (!existing) setPrice(id, defaultPriceGroupId(), 0, user);
        for (const [col, field] of Object.entries(mapping)) {
          const v = cells[Number(col)];
          if (v === undefined || v === '') continue;
          const pm = /^price_(\d+)$/.exec(field);
          if (pm) {
            const n = num(v);
            if (n === undefined || Number.isNaN(n) || n < 0 || !exists('price_groups', Number(pm[1]))) throw new Error(`invalid value in "${field}"`);
            setPrice(id, Number(pm[1]), n, user);
          }
          const sm = /^stock_(.+)$/.exec(field);
          if (sm) {
            const w = whByKey(sm[1]);
            const n = num(v);
            if (!w || n === undefined || Number.isNaN(n)) throw new Error(`invalid value or warehouse in "${field}"`);
            if (b.stock_mode === 'add') adjustStock(id, Math.trunc(n), 'Import CSV', w.id, { user });
            else setStock(id, Math.trunc(n), 'Import CSV', w.id, { user });
          }
        }
        const stock = num(get('stock'));
        if (stock !== undefined && !Object.values(mapping).some((f) => f.startsWith('stock_'))) {
          if (Number.isNaN(stock)) throw new Error('invalid stock');
          if (b.stock_mode === 'add') adjustStock(id, Math.trunc(stock), 'Import CSV', defaultWh, { user });
          else setStock(id, Math.trunc(stock), 'Import CSV', defaultWh, { user });
        }
        return existing ? 'updated' : 'created';
      });
      result[outcome]++;
    } catch (e: any) {
      result.errors.push({ row: rowNo, message: e?.message ?? String(e) });
    }
  });
  res.json(result);
});

/* ----------------------------------- card ----------------------------------- */

productsRouter.get('/:id', (req, res) => {
  const id = idParam(req);
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;
  if (!p) throw new HttpError(404, 'Product not found');
  const catalogId = p.catalog_id ?? defaultCatalogId();
  const variants: any[] = (db.prepare('SELECT * FROM products WHERE parent_id = ? ORDER BY id').all(id) as any[]).map((v) => ({
    ...v,
    images: parseJson(v.images, []),
    attributes: parseJson(v.attributes, {}),
    prices: pricesOf(v.id),
    stocks: stocksOf(v.id),
    available: availableStock(v.id),
  }));
  const family = 'SELECT id FROM products WHERE id = ? OR parent_id = ?';
  const history = db
    .prepare(
      `SELECT h.*, w.name warehouse_name, d.number doc_number, x.name product_name, x.variant_name
       FROM stock_history h LEFT JOIN warehouses w ON w.id = h.warehouse_id LEFT JOIN warehouse_docs d ON d.id = h.doc_id LEFT JOIN products x ON x.id = h.product_id
       WHERE h.product_id IN (${family}) ORDER BY h.id DESC LIMIT 300`,
    )
    .all(id, id);
  const offers = db
    .prepare(
      `SELECT o.*, i.name integration_name, i.type integration_type FROM offers o JOIN integrations i ON i.id = o.integration_id
       WHERE o.product_id IN (${family})`,
    )
    .all(id, id);
  const sales = db
    .prepare(
      `SELECT date(o.date_add) d, SUM(i.quantity) qty FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE i.product_id IN (${family}) AND o.deleted = 0 AND o.date_add >= datetime('now','-30 days')
       GROUP BY d ORDER BY d`,
    )
    .all(id, id);
  const bundleItems = db
    .prepare('SELECT b.product_id, b.quantity, p.name, p.variant_name, p.sku, p.ean FROM bundle_items b JOIN products p ON p.id = b.product_id WHERE b.bundle_id = ?')
    .all(id) as any[];
  for (const b of bundleItems) b.available = availableStock(b.product_id);
  res.json({
    ...p,
    images: parseJson(p.images, []),
    attributes: parseJson(p.attributes, {}),
    features: parseJson(p.features, []),
    prices: pricesOf(id),
    price_groups: catalogPriceGroups(catalogId),
    warehouses: catalogWarehouses(catalogId),
    stocks: stocksOf(id),
    available: availableStock(id),
    texts: db.prepare('SELECT lang, integration_id, name, description FROM product_texts WHERE product_id = ?').all(id),
    tags: db.prepare('SELECT t.* FROM tags t JOIN product_tags pt ON pt.tag_id = t.id WHERE pt.product_id = ?').all(id),
    extra: Object.fromEntries((db.prepare('SELECT field_id, value FROM product_extra_values WHERE product_id = ?').all(id) as any[]).map((r) => [r.field_id, r.value])),
    bundle_items: bundleItems,
    used_in_bundles: db.prepare('SELECT p.id, p.name FROM bundle_items b JOIN products p ON p.id = b.bundle_id WHERE b.product_id = ?').all(id),
    variants,
    history,
    log: db.prepare('SELECT * FROM product_log WHERE product_id IN (' + family + ') ORDER BY id DESC LIMIT 300').all(id, id),
    offers,
    sales,
    stock_derived: stockIsDerived(id),
  });
});

productsRouter.post('/', (req, res) => {
  const b = productSchema.parse(req.body);
  const parent = b.parent_id ? (db.prepare('SELECT catalog_id FROM products WHERE id = ?').get(b.parent_id) as { catalog_id: number } | undefined) : undefined;
  const catalogId = parent?.catalog_id ?? b.catalog_id ?? defaultCatalogId();
  validateRefs(b, catalogId);
  checkSku(b.sku, catalogId);
  if (b.parent_id && !db.prepare('SELECT 1 FROM products WHERE parent_id = ?').get(b.parent_id)) {
    const ps = db.prepare('SELECT stock FROM products WHERE id = ?').get(b.parent_id) as { stock: number };
    if (ps.stock !== 0) throw new HttpError(409, 'Move or zero the stock of the product before adding variants — stock is kept on variants');
  }
  const user = userName(req);
  const id = tx(() => {
    const data: Record<string, unknown> = { catalog_id: catalogId, parent_id: b.parent_id ?? null };
    for (const f of SIMPLE) if (b[f] !== undefined) data[f] = b[f];
    if (b.images) data.images = JSON.stringify(b.images);
    if (b.attributes) data.attributes = JSON.stringify(b.attributes);
    if (b.features) data.features = JSON.stringify(b.features);
    if (b.purchase_price !== undefined) data.avg_cost = b.purchase_price;
    const cols = Object.keys(data);
    const newId = Number(db.prepare(`INSERT INTO products (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...Object.values(data)).lastInsertRowid);
    saveDetails(newId, b, user, true);
    db.prepare('INSERT INTO product_log (product_id, field, new_value, user_name) VALUES (?, ?, ?, ?)').run(newId, 'created', b.name, user);
    return newId;
  });
  res.json({ id });
});

productsRouter.put('/:id', (req, res) => {
  const id = idParam(req);
  const b = productSchema.partial().parse(req.body);
  const cur = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;
  if (!cur) throw new HttpError(404, 'Product not found');
  const targetCatalog = b.catalog_id ?? cur.catalog_id ?? defaultCatalogId();
  if (cur.parent_id && b.catalog_id !== undefined && b.catalog_id !== cur.catalog_id) throw new HttpError(400, 'A variant always stays in the catalog of its parent');
  validateRefs(b, targetCatalog, id);
  checkSku(b.sku ?? cur.sku, targetCatalog, id);
  if (b.catalog_id !== undefined && b.catalog_id !== cur.catalog_id) {
    for (const v of db.prepare('SELECT id, sku FROM products WHERE parent_id = ?').all(id) as any[]) checkSku(v.sku, targetCatalog, v.id);
  }
  const user = userName(req);
  tx(() => {
    const data: Record<string, unknown> = {};
    for (const f of SIMPLE) if (b[f] !== undefined) data[f] = b[f];
    if (b.parent_id !== undefined) data.parent_id = b.parent_id;
    if (b.catalog_id !== undefined) data.catalog_id = b.catalog_id;
    if (b.images) data.images = JSON.stringify(b.images);
    if (b.attributes) data.attributes = JSON.stringify(b.attributes);
    if (b.features) data.features = JSON.stringify(b.features);
    for (const [k, v] of Object.entries(data)) logChange(id, k, cur[k], v, user);
    if (Object.keys(data).length) {
      db.prepare(`UPDATE products SET ${Object.keys(data).map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...Object.values(data), id);
    }
    if (b.catalog_id !== undefined && b.catalog_id !== cur.catalog_id) db.prepare('UPDATE products SET catalog_id = ? WHERE parent_id = ?').run(b.catalog_id, id);
    saveDetails(id, b, user, false);
  });
  res.json({ ok: true });
});

productsRouter.delete('/:id', (req, res) => {
  const id = idParam(req);
  if (!exists('products', id)) throw new HttpError(404, 'Product not found');
  const bundle = db.prepare('SELECT p.name FROM bundle_items b JOIN products p ON p.id = b.bundle_id WHERE b.product_id IN (SELECT id FROM products WHERE id = ? OR parent_id = ?) LIMIT 1').get(id, id) as
    | { name: string }
    | undefined;
  if (bundle) throw new HttpError(409, `The product is a component of the bundle "${bundle.name}" — remove it from the bundle first`);
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  res.json({ ok: true });
});

/** Stock correction in one warehouse (BaseLinker "Korekta stanu"). */
productsRouter.post('/:id/stock', (req, res) => {
  const id = idParam(req);
  const b = z
    .object({ change: z.number().int().optional(), value: z.number().int().optional(), reason: z.string().max(200).optional(), warehouse_id: z.number().int().optional() })
    .refine((v) => v.change !== undefined || v.value !== undefined, 'change or value required')
    .parse(req.body);
  const catalogId = catalogOf(id);
  if (b.warehouse_id !== undefined && !exists('warehouses', b.warehouse_id)) throw new HttpError(400, 'Unknown warehouse');
  const wh = b.warehouse_id ?? catalogWarehouseId(catalogId);
  const reason = b.reason || 'Korekta ręczna';
  if (b.value !== undefined) setStock(id, b.value, reason, wh, { user: userName(req) });
  else adjustStock(id, b.change!, reason, wh, { user: userName(req) });
  res.json({ stock: (db.prepare('SELECT stock FROM products WHERE id = ?').get(id) as { stock: number }).stock, stocks: stocksOf(id) });
});

/** Creates variants from attribute values, e.g. {Rozmiar: [S, M], Kolor: [Czarny]}. */
productsRouter.post('/:id/variants/generate', (req, res) => {
  const id = idParam(req);
  const b = z
    .object({
      attributes: z.record(z.string().min(1).max(50), z.array(z.string().min(1).max(100)).min(1).max(50)),
      sku_pattern: z.string().max(100).optional(),
    })
    .parse(req.body);
  const parent = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;
  if (!parent) throw new HttpError(404, 'Product not found');
  if (parent.parent_id) throw new HttpError(400, 'A variant cannot have variants');
  if (parent.is_bundle) throw new HttpError(400, 'A bundle cannot have variants');
  if (!db.prepare('SELECT 1 FROM products WHERE parent_id = ?').get(id) && parent.stock !== 0) {
    throw new HttpError(409, 'Move or zero the stock of the product before adding variants — stock is kept on variants');
  }
  const keys = Object.keys(b.attributes);
  let combos: Record<string, string>[] = [{}];
  for (const k of keys) combos = combos.flatMap((c) => b.attributes[k].map((v) => ({ ...c, [k]: v })));
  if (combos.length > 200) throw new HttpError(400, 'Too many combinations (max 200)');
  const user = userName(req);
  const created: number[] = [];
  tx(() => {
    for (const c of combos) {
      const label = keys.map((k) => c[k]).join(' / ');
      const existing = (db.prepare('SELECT attributes FROM products WHERE parent_id = ?').all(id) as any[]).some((v) => JSON.stringify(parseJson(v.attributes, {})) === JSON.stringify(c));
      if (existing) continue;
      const skuPart = keys.map((k) => slugSku(c[k])).join('-');
      const sku = parent.sku ? (b.sku_pattern ?? '{sku}-{variant}').replace('{sku}', parent.sku).replace('{variant}', skuPart) : '';
      checkSku(sku, parent.catalog_id);
      const vid = Number(
        db
          .prepare(
            `INSERT INTO products (parent_id, catalog_id, sku, name, variant_name, attributes, price, purchase_price, avg_cost, tax_rate, weight, category_id, manufacturer_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(id, parent.catalog_id, sku, parent.name, label, JSON.stringify(c), parent.price, parent.purchase_price, parent.avg_cost, parent.tax_rate, parent.weight, parent.category_id, parent.manufacturer_id)
          .lastInsertRowid,
      );
      for (const [g, v] of Object.entries(pricesOf(id))) setPrice(vid, Number(g), v, user);
      created.push(vid);
    }
  });
  res.json({ created: created.length, ids: created });
});

/* ----------------------------------- bulk ----------------------------------- */

productsRouter.post('/bulk', (req, res) => {
  const b = z
    .object({
      ids: z.array(z.number().int()).min(1).max(10000),
      action: z.enum([
        'delete',
        'set_category',
        'set_manufacturer',
        'price_percent',
        'price_set',
        'price_from_group',
        'set_stock',
        'set_tax',
        'set_catalog',
        'add_tag',
        'remove_tag',
        'set_location',
        'set_weight',
        'set_min_stock',
        'duplicate',
      ]),
      value: z.any().optional(),
      warehouse_id: z.number().int().optional(),
      price_group_id: z.number().int().optional(),
      source_price_group_id: z.number().int().optional(),
    })
    .parse(req.body);
  const user = userName(req);
  const group = b.price_group_id ?? defaultPriceGroupId();
  if (!exists('price_groups', group)) throw new HttpError(400, 'Unknown price group');
  const num = Number(b.value);
  const errors: { id: number; message: string }[] = [];
  let ok = 0;
  // Actions on a product with variants apply to the variants where it matters (stock, price).
  const targets = (id: number) => {
    const vs = (db.prepare('SELECT id FROM products WHERE parent_id = ?').all(id) as { id: number }[]).map((v) => v.id);
    return vs.length ? vs : [id];
  };
  for (const id of b.ids) {
    try {
      tx(() => {
        if (!exists('products', id)) throw new HttpError(404, 'Product not found');
        switch (b.action) {
          case 'delete': {
            const bundle = db.prepare('SELECT 1 FROM bundle_items WHERE product_id IN (SELECT id FROM products WHERE id = ? OR parent_id = ?)').get(id, id);
            if (bundle) throw new HttpError(409, 'Used in a bundle');
            db.prepare('DELETE FROM products WHERE id = ?').run(id);
            break;
          }
          case 'set_category':
            if (b.value && !exists('categories', Number(b.value))) throw new HttpError(400, 'Unknown category');
            db.prepare('UPDATE products SET category_id = ? WHERE id = ? OR parent_id = ?').run(b.value ? Number(b.value) : null, id, id);
            break;
          case 'set_manufacturer':
            if (b.value && !exists('manufacturers', Number(b.value))) throw new HttpError(400, 'Unknown manufacturer');
            db.prepare('UPDATE products SET manufacturer_id = ? WHERE id = ? OR parent_id = ?').run(b.value ? Number(b.value) : null, id, id);
            break;
          case 'price_percent':
          case 'price_set':
          case 'price_from_group':
            if (!Number.isFinite(num)) throw new HttpError(400, 'Invalid value');
            for (const t of new Set([id, ...targets(id)])) {
              const prices = pricesOf(t);
              let v: number;
              if (b.action === 'price_set') v = num;
              else if (b.action === 'price_percent') v = (prices[group] ?? 0) * (1 + num / 100);
              else {
                const src = prices[b.source_price_group_id ?? defaultPriceGroupId()];
                if (src === undefined) continue;
                v = src * (1 + num / 100);
              }
              if (v < 0) throw new HttpError(400, 'The price would be negative');
              setPrice(t, group, v, user);
            }
            break;
          case 'set_stock':
            if (!Number.isFinite(num)) throw new HttpError(400, 'Invalid value');
            if (b.warehouse_id !== undefined && !exists('warehouses', b.warehouse_id)) throw new HttpError(400, 'Unknown warehouse');
            for (const t of targets(id)) {
              if (db.prepare('SELECT is_bundle FROM products WHERE id = ?').get(t) && (db.prepare('SELECT is_bundle FROM products WHERE id = ?').get(t) as any).is_bundle) continue;
              setStock(t, Math.trunc(num), 'Zmiana masowa', b.warehouse_id ?? catalogWarehouseId(catalogOf(t)), { user });
            }
            break;
          case 'set_catalog': {
            const target = Number(b.value);
            if (!exists('catalogs', target)) throw new HttpError(400, 'Unknown catalog');
            const p = db.prepare('SELECT parent_id FROM products WHERE id = ?').get(id) as any;
            if (p.parent_id) throw new HttpError(400, 'A variant moves together with its parent');
            for (const v of db.prepare('SELECT id, sku FROM products WHERE id = ? OR parent_id = ?').all(id, id) as any[]) checkSku(v.sku, target, v.id);
            if (db.prepare('SELECT 1 FROM bundle_items b JOIN products p ON p.id = b.product_id WHERE b.bundle_id = ? AND p.catalog_id != ?').get(id, target)) {
              throw new HttpError(400, 'Bundle components are in another catalog');
            }
            db.prepare('UPDATE products SET catalog_id = ?, category_id = NULL WHERE id = ? OR parent_id = ?').run(target, id, id);
            break;
          }
          case 'set_tax':
            if (!Number.isFinite(num) || num < 0 || num > 100) throw new HttpError(400, 'Invalid VAT rate');
            db.prepare('UPDATE products SET tax_rate = ? WHERE id = ? OR parent_id = ?').run(num, id, id);
            break;
          case 'add_tag':
            if (!exists('tags', num)) throw new HttpError(400, 'Unknown tag');
            db.prepare('INSERT OR IGNORE INTO product_tags (product_id, tag_id) VALUES (?, ?)').run(id, num);
            break;
          case 'remove_tag':
            db.prepare('DELETE FROM product_tags WHERE product_id = ? AND tag_id = ?').run(id, num);
            break;
          case 'set_location':
            db.prepare('UPDATE products SET location = ? WHERE id = ?').run(String(b.value ?? '').slice(0, 100), id);
            break;
          case 'set_weight':
            if (!Number.isFinite(num) || num < 0) throw new HttpError(400, 'Invalid weight');
            db.prepare('UPDATE products SET weight = ? WHERE id = ? OR parent_id = ?').run(num, id, id);
            break;
          case 'set_min_stock':
            if (!Number.isFinite(num) || num < 0) throw new HttpError(400, 'Invalid value');
            db.prepare('UPDATE products SET min_stock = ? WHERE id = ? OR parent_id = ?').run(Math.trunc(num), id, id);
            break;
          case 'duplicate':
            duplicateProduct(id, user);
            break;
        }
        ok++;
      });
    } catch (e: any) {
      errors.push({ id, message: e?.message ?? String(e) });
    }
  }
  res.json({ ok, errors });
});

/* ------------------------------ categories (tree) ------------------------------ */

productsRouter.get('/meta/categories', (req, res) => {
  const catalog = q.int(req.query.catalog_id);
  const rows = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.parent_id IS NULL) product_count
       FROM categories c ${catalog ? 'WHERE c.catalog_id = ? OR c.catalog_id IS NULL' : ''} ORDER BY c.sort, c.name COLLATE NOCASE`,
    )
    .all(...(catalog ? [catalog] : [])) as any[];
  // Count includes subcategories (like the tree in BaseLinker).
  const byParent = new Map<number | null, any[]>();
  for (const r of rows) byParent.set(r.parent_id, [...(byParent.get(r.parent_id) ?? []), r]);
  const total = (r: any): number => r.product_count + (byParent.get(r.id) ?? []).reduce((s, c) => s + total(c), 0);
  for (const r of rows) r.total_count = total(r);
  res.json(rows);
});

productsRouter.post('/meta/categories', (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(200), parent_id: z.number().int().nullable().optional(), catalog_id: z.number().int().optional() }).parse(req.body);
  const catalogId = b.catalog_id ?? defaultCatalogId();
  if (!exists('catalogs', catalogId)) throw new HttpError(400, 'Unknown catalog');
  if (b.parent_id && !db.prepare('SELECT 1 FROM categories WHERE id = ? AND catalog_id = ?').get(b.parent_id, catalogId)) throw new HttpError(400, 'Unknown parent category');
  const r = db.prepare('INSERT INTO categories (name, parent_id, catalog_id) VALUES (?, ?, ?)').run(b.name, b.parent_id ?? null, catalogId);
  res.json({ id: Number(r.lastInsertRowid) });
});

productsRouter.put('/meta/categories/:id', (req, res) => {
  const id = idParam(req);
  const b = z.object({ name: z.string().trim().min(1).max(200).optional(), parent_id: z.number().int().nullable().optional(), sort: z.number().int().optional() }).parse(req.body);
  const cur = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as any;
  if (!cur) throw new HttpError(404, 'Category not found');
  if (b.parent_id) {
    if (!db.prepare('SELECT 1 FROM categories WHERE id = ? AND catalog_id IS ?').get(b.parent_id, cur.catalog_id)) throw new HttpError(400, 'Unknown parent category');
    if (categorySubtree(id).includes(b.parent_id)) throw new HttpError(400, 'A category cannot be moved into its own subcategory');
  }
  db.prepare('UPDATE categories SET name = ?, parent_id = ?, sort = ? WHERE id = ?').run(
    b.name ?? cur.name,
    b.parent_id === undefined ? cur.parent_id : b.parent_id,
    b.sort ?? cur.sort,
    id,
  );
  res.json({ ok: true });
});

productsRouter.delete('/meta/categories/:id', (req, res) => {
  const id = idParam(req);
  const cur = db.prepare('SELECT parent_id FROM categories WHERE id = ?').get(id) as any;
  if (!cur) throw new HttpError(404, 'Category not found');
  // Subcategories and products move one level up.
  tx(() => {
    db.prepare('UPDATE categories SET parent_id = ? WHERE parent_id = ?').run(cur.parent_id, id);
    db.prepare('UPDATE products SET category_id = ? WHERE category_id = ?').run(cur.parent_id, id);
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  });
  res.json({ ok: true });
});

/* --------------------------------- manufacturers --------------------------------- */

productsRouter.get('/meta/manufacturers', (_req, res) => {
  res.json(db.prepare('SELECT m.*, (SELECT COUNT(*) FROM products p WHERE p.manufacturer_id = m.id) product_count FROM manufacturers m ORDER BY name COLLATE NOCASE').all());
});

productsRouter.post('/meta/manufacturers', (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(200) }).parse(req.body);
  const dup = db.prepare('SELECT id FROM manufacturers WHERE name = ?').get(b.name) as { id: number } | undefined;
  if (dup) return void res.json({ id: dup.id });
  res.json({ id: Number(db.prepare('INSERT INTO manufacturers (name) VALUES (?)').run(b.name).lastInsertRowid) });
});

productsRouter.put('/meta/manufacturers/:id', (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(200) }).parse(req.body);
  db.prepare('UPDATE manufacturers SET name = ? WHERE id = ?').run(b.name, idParam(req));
  res.json({ ok: true });
});

productsRouter.delete('/meta/manufacturers/:id', (req, res) => {
  db.prepare('DELETE FROM manufacturers WHERE id = ?').run(idParam(req));
  res.json({ ok: true });
});
