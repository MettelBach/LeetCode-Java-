import { Router } from 'express';
import { z } from 'zod';
import { db, parseJson, tx } from '../db/index.js';
import { HttpError, idParam, q, round2 } from '../lib/http.js';
import { adjustStock, defaultCatalogId, setStock } from '../services/stock.js';
import { userName } from './auth.js';

export const productsRouter = Router();

const productSchema = z.object({
  parent_id: z.number().int().nullable().optional(),
  catalog_id: z.number().int().optional(),
  sku: z.string().max(100).optional(),
  ean: z.string().max(50).optional(),
  name: z.string().min(1).max(500),
  description: z.string().max(50000).optional(),
  price: z.number().min(0).max(1e7).optional(),
  purchase_price: z.number().min(0).max(1e7).optional(),
  tax_rate: z.number().min(0).max(100).optional(),
  weight: z.number().min(0).max(100000).optional(),
  width: z.number().min(0).max(100000).optional(),
  height: z.number().min(0).max(100000).optional(),
  length: z.number().min(0).max(100000).optional(),
  stock: z.number().int().min(-1e6).max(1e7).optional(),
  location: z.string().max(100).optional(),
  category_id: z.number().int().nullable().optional(),
  manufacturer_id: z.number().int().nullable().optional(),
  images: z.array(z.string().url().max(2000)).max(30).optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  variant_name: z.string().max(200).optional(),
  /** Stock per warehouse: { "<warehouse id>": quantity }. */
  stocks: z.record(z.string(), z.number().int().min(-1e6).max(1e7)).optional(),
  warehouse_id: z.number().int().optional(),
});

const FIELDS = ['parent_id', 'catalog_id', 'sku', 'ean', 'name', 'description', 'price', 'purchase_price', 'tax_rate', 'weight', 'width', 'height', 'length', 'location', 'category_id', 'manufacturer_id', 'images', 'attributes', 'variant_name'] as const;

function serialize(b: Partial<z.infer<typeof productSchema>>) {
  const data: Record<string, unknown> = {};
  for (const f of FIELDS) {
    if (b[f] === undefined) continue;
    data[f] = f === 'images' || f === 'attributes' ? JSON.stringify(b[f]) : b[f];
  }
  return data;
}

function checkSkuUnique(sku: string | undefined, exceptId?: number, catalogId?: number) {
  if (!sku) return;
  const cat = catalogId ?? (exceptId ? (db.prepare('SELECT catalog_id FROM products WHERE id = ?').get(exceptId) as any)?.catalog_id : defaultCatalogId());
  const dup = db.prepare('SELECT id FROM products WHERE sku = ? AND id != ? AND catalog_id IS ?').get(sku, exceptId ?? 0, cat ?? null) as any;
  if (dup) throw new HttpError(409, `SKU "${sku}" is already used by product ${dup.id}`);
}

productsRouter.get('/', (req, res) => {
  const search = q.str(req.query.search);
  const category = q.int(req.query.category_id);
  const manufacturer = q.int(req.query.manufacturer_id);
  const catalog = q.int(req.query.catalog_id);
  const warehouse = q.int(req.query.warehouse_id);
  const stock = q.str(req.query.stock);
  const page = Math.max(1, q.int(req.query.page) ?? 1);
  const perPage = Math.min(500, Math.max(1, q.int(req.query.per_page) ?? 50));
  const sortMap: Record<string, string> = { id: 'p.id', name: 'p.name', sku: 'p.sku', price: 'p.price', stock: 'p.stock' };
  const sort = sortMap[String(req.query.sort)] ?? 'p.id';
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
  const w = ['p.parent_id IS NULL'];
  const p: unknown[] = [];
  if (search) {
    const like = `%${search}%`;
    w.push(`(p.name LIKE ? OR p.sku LIKE ? OR p.ean LIKE ? OR CAST(p.id AS TEXT) = ?
      OR EXISTS (SELECT 1 FROM products v WHERE v.parent_id = p.id AND (v.sku LIKE ? OR v.ean LIKE ? OR v.name LIKE ?)))`);
    p.push(like, like, like, search, like, like, like);
  }
  if (catalog) {
    w.push('p.catalog_id = ?');
    p.push(catalog);
  }
  if (category) {
    w.push('p.category_id = ?');
    p.push(category);
  }
  if (manufacturer) {
    w.push('p.manufacturer_id = ?');
    p.push(manufacturer);
  }
  const own = warehouse ? `COALESCE((SELECT stock FROM product_stock s WHERE s.product_id = p.id AND s.warehouse_id = ${Number(warehouse)}), 0)` : 'p.stock';
  const varSum = warehouse
    ? `(SELECT COALESCE(SUM(s.stock),0) FROM product_stock s JOIN products v ON v.id = s.product_id WHERE v.parent_id = p.id AND s.warehouse_id = ${Number(warehouse)})`
    : '(SELECT SUM(stock) FROM products v WHERE v.parent_id = p.id)';
  const stockExpr = `(CASE WHEN EXISTS (SELECT 1 FROM products v WHERE v.parent_id = p.id) THEN ${varSum} ELSE ${own} END)`;
  if (stock === 'in') w.push(`${stockExpr} > 0`);
  if (stock === 'out') w.push(`${stockExpr} <= 0`);
  if (stock === 'low') w.push(`${stockExpr} > 0 AND ${stockExpr} <= 5`);
  const where = w.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) c FROM products p WHERE ${where}`).get(...p) as { c: number }).c;
  const rows = db
    .prepare(
      `SELECT p.*, c.name category_name, m.name manufacturer_name, ${stockExpr} AS total_stock,
        (SELECT COUNT(*) FROM products v WHERE v.parent_id = p.id) AS variant_count,
        (SELECT COUNT(*) FROM offers o WHERE o.product_id = p.id) AS offer_count,
        (SELECT COALESCE(SUM(i.quantity),0) FROM order_items i JOIN orders o ON o.id = i.order_id
           WHERE i.product_id = p.id AND o.deleted = 0 AND o.date_add >= datetime('now','-30 days')) AS sold_30d
       FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN manufacturers m ON m.id = p.manufacturer_id
       WHERE ${where} ORDER BY ${sort === 'p.stock' ? stockExpr : sort} ${dir}, p.id ${dir} LIMIT ? OFFSET ?`,
    )
    .all(...p, perPage, (page - 1) * perPage) as any[];
  for (const r of rows) {
    r.images = parseJson(r.images, []);
    r.attributes = parseJson(r.attributes, {});
  }
  res.json({ total, page, per_page: perPage, rows });
});

productsRouter.get('/search', (req, res) => {
  // Lightweight lookup for "add product to order".
  const s = q.str(req.query.q) ?? '';
  const like = `%${s}%`;
  const cat = q.int(req.query.catalog_id);
  const rows = db
    .prepare(
      `SELECT p.id, p.sku, p.ean, p.name, p.variant_name, p.price, p.tax_rate, p.weight, p.stock, p.location, p.images, p.parent_id,
         (SELECT name FROM products x WHERE x.id = p.parent_id) parent_name
       FROM products p WHERE (p.name LIKE ? OR p.sku LIKE ? OR p.ean LIKE ? OR CAST(p.id AS TEXT) = ?)
       AND NOT EXISTS (SELECT 1 FROM products v WHERE v.parent_id = p.id) ${cat ? 'AND p.catalog_id = ?' : ''}
       ORDER BY p.name LIMIT 20`,
    )
    .all(like, like, like, s, ...(cat ? [cat] : [])) as any[];
  res.json(rows.map((r) => ({ ...r, images: parseJson(r.images, []) })));
});

productsRouter.get('/export.csv', (req, res) => {
  const cat = q.int(req.query.catalog_id);
  const rows = (cat ? db.prepare('SELECT * FROM products WHERE catalog_id = ? ORDER BY id').all(cat) : db.prepare('SELECT * FROM products ORDER BY id').all()) as any[];
  const cols = ['id', 'parent_id', 'sku', 'ean', 'name', 'price', 'purchase_price', 'tax_rate', 'stock', 'weight', 'location'];
  const esc = (v: unknown) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="products.csv"');
  res.send('﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\r\n'));
});

productsRouter.post('/import', (req, res) => {
  // CSV with header: sku;ean;name;price;stock;... (semicolon or comma separated). Upserts by SKU.
  const b = z.object({ csv: z.string().max(10_000_000), catalog_id: z.number().int().optional() }).parse(req.body);
  const catalogId = b.catalog_id ?? defaultCatalogId();
  const lines = b.csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new HttpError(400, 'CSV must have a header and at least one row');
  const sep = lines[0].includes(';') ? ';' : ',';
  const parseLine = (l: string) => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (inQ) {
        if (ch === '"' && l[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === sep) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const header = parseLine(lines[0]).map((h) => h.toLowerCase());
  const idx = (n: string) => header.indexOf(n);
  if (idx('name') < 0) throw new HttpError(400, 'CSV must contain a "name" column');
  let created = 0;
  let updated = 0;
  const num = (v: string | undefined) => (v === undefined || v === '' ? undefined : Number(v.replace(',', '.')));
  tx(() => {
    for (const l of lines.slice(1)) {
      const c = parseLine(l);
      const get = (n: string) => (idx(n) >= 0 ? c[idx(n)] : undefined);
      const sku = get('sku') ?? '';
      const data: Record<string, unknown> = { name: get('name') };
      for (const f of ['ean', 'location', 'description']) if (get(f) !== undefined) data[f] = get(f);
      for (const f of ['price', 'purchase_price', 'tax_rate', 'weight']) {
        const v = num(get(f));
        if (v !== undefined && Number.isFinite(v)) data[f] = v;
      }
      if (!data.name) continue;
      const existing = sku ? (db.prepare('SELECT id FROM products WHERE sku = ? AND catalog_id = ?').get(sku, catalogId) as any) : undefined;
      const stock = num(get('stock'));
      if (existing) {
        db.prepare(`UPDATE products SET ${Object.keys(data).map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(
          ...Object.values(data),
          existing.id,
        );
        if (stock !== undefined && Number.isFinite(stock)) setStock(existing.id, Math.trunc(stock), 'import');
        updated++;
      } else {
        const cols = ['sku', 'catalog_id', ...Object.keys(data)];
        const r = db.prepare(`INSERT INTO products (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(sku, catalogId, ...Object.values(data));
        if (stock !== undefined && Number.isFinite(stock)) adjustStock(Number(r.lastInsertRowid), Math.trunc(stock), 'import');
        created++;
      }
    }
  });
  res.json({ created, updated });
});

productsRouter.get('/:id', (req, res) => {
  const id = idParam(req);
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;
  if (!p) throw new HttpError(404, 'Product not found');
  const variants: any[] = (db.prepare('SELECT * FROM products WHERE parent_id = ? ORDER BY id').all(id) as any[]).map((v) => ({
    ...v,
    images: parseJson(v.images, []),
    attributes: parseJson(v.attributes, {}),
  }));
  const history = db
    .prepare(
      'SELECT h.*, w.name warehouse_name FROM stock_history h LEFT JOIN warehouses w ON w.id = h.warehouse_id WHERE h.product_id IN (SELECT id FROM products WHERE id = ? OR parent_id = ?) ORDER BY h.id DESC LIMIT 200',
    )
    .all(id, id);
  const offers = db
    .prepare(
      `SELECT o.*, i.name integration_name, i.type integration_type FROM offers o JOIN integrations i ON i.id = o.integration_id
       WHERE o.product_id IN (SELECT id FROM products WHERE id = ? OR parent_id = ?)`,
    )
    .all(id, id);
  const sales = db
    .prepare(
      `SELECT date(o.date_add) d, SUM(i.quantity) qty FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE i.product_id IN (SELECT id FROM products WHERE id = ? OR parent_id = ?) AND o.deleted = 0 AND o.date_add >= datetime('now','-30 days')
       GROUP BY d ORDER BY d`,
    )
    .all(id, id);
  const stocks = db
    .prepare('SELECT w.id warehouse_id, w.name, w.code, COALESCE(s.stock, 0) stock FROM warehouses w LEFT JOIN product_stock s ON s.warehouse_id = w.id AND s.product_id = ? ORDER BY w.is_default DESC, w.id')
    .all(id);
  for (const v of variants) {
    v.stocks = db
      .prepare('SELECT w.id warehouse_id, COALESCE(s.stock, 0) stock FROM warehouses w LEFT JOIN product_stock s ON s.warehouse_id = w.id AND s.product_id = ? ORDER BY w.is_default DESC, w.id')
      .all(v.id);
  }
  res.json({ ...p, images: parseJson(p.images, []), attributes: parseJson(p.attributes, {}), variants, history, offers, sales, stocks });
});

productsRouter.post('/', (req, res) => {
  const b = productSchema.parse(req.body);
  checkSkuUnique(b.sku, undefined, b.catalog_id);
  if (b.parent_id && !db.prepare('SELECT 1 FROM products WHERE id = ? AND parent_id IS NULL').get(b.parent_id)) {
    throw new HttpError(400, 'Parent product not found');
  }
  const data = serialize(b);
  if (!data.catalog_id) {
    const parent = b.parent_id ? (db.prepare('SELECT catalog_id FROM products WHERE id = ?').get(b.parent_id) as any) : null;
    data.catalog_id = parent?.catalog_id ?? defaultCatalogId();
  }
  const cols = Object.keys(data);
  const id = tx(() => {
    const r = db.prepare(`INSERT INTO products (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...Object.values(data));
    const newId = Number(r.lastInsertRowid);
    if (b.stocks) {
      for (const [wh, v] of Object.entries(b.stocks)) if (v) adjustStock(newId, v, `manual (${userName(req)})`, null, Number(wh));
    } else if (b.stock) adjustStock(newId, b.stock, `manual (${userName(req)})`, null, b.warehouse_id);
    return newId;
  });
  res.json({ id });
});

productsRouter.put('/:id', (req, res) => {
  const id = idParam(req);
  const b = productSchema.partial().parse(req.body);
  if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(id)) throw new HttpError(404, 'Product not found');
  checkSkuUnique(b.sku, id);
  const data = serialize(b);
  tx(() => {
    if (Object.keys(data).length) {
      db.prepare(`UPDATE products SET ${Object.keys(data).map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(
        ...Object.values(data),
        id,
      );
    }
    if (b.stocks) {
      for (const [wh, v] of Object.entries(b.stocks)) setStock(id, v, `manual (${userName(req)})`, Number(wh));
    } else if (b.stock !== undefined) setStock(id, b.stock, `manual (${userName(req)})`, b.warehouse_id);
  });
  res.json({ ok: true });
});

productsRouter.delete('/:id', (req, res) => {
  const id = idParam(req);
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  res.json({ ok: true });
});

productsRouter.post('/:id/stock', (req, res) => {
  const id = idParam(req);
  const b = z
    .object({ change: z.number().int().optional(), value: z.number().int().optional(), reason: z.string().max(200).optional(), warehouse_id: z.number().int().optional() })
    .refine((v) => v.change !== undefined || v.value !== undefined, 'change or value required')
    .parse(req.body);
  if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(id)) throw new HttpError(404, 'Product not found');
  const reason = b.reason || `manual (${userName(req)})`;
  if (b.value !== undefined) setStock(id, b.value, reason, b.warehouse_id);
  else adjustStock(id, b.change!, reason, null, b.warehouse_id);
  res.json(db.prepare('SELECT stock FROM products WHERE id = ?').get(id));
});

productsRouter.post('/bulk', (req, res) => {
  const b = z
    .object({
      ids: z.array(z.number().int()).min(1).max(10000),
      action: z.enum(['delete', 'set_category', 'set_manufacturer', 'price_percent', 'set_stock', 'set_tax', 'set_catalog']),
      value: z.any().optional(),
      warehouse_id: z.number().int().optional(),
    })
    .parse(req.body);
  tx(() => {
    for (const id of b.ids) {
      switch (b.action) {
        case 'delete':
          db.prepare('DELETE FROM products WHERE id = ?').run(id);
          break;
        case 'set_category':
          db.prepare('UPDATE products SET category_id = ? WHERE id = ?').run(b.value ? Number(b.value) : null, id);
          break;
        case 'set_manufacturer':
          db.prepare('UPDATE products SET manufacturer_id = ? WHERE id = ?').run(b.value ? Number(b.value) : null, id);
          break;
        case 'price_percent': {
          const pct = Number(b.value);
          if (!Number.isFinite(pct)) throw new HttpError(400, 'Invalid percent');
          const p = db.prepare('SELECT price FROM products WHERE id = ?').get(id) as { price: number } | undefined;
          if (p) db.prepare(`UPDATE products SET price = ?, updated_at = datetime('now') WHERE id = ?`).run(round2(p.price * (1 + pct / 100)), id);
          break;
        }
        case 'set_stock':
          setStock(id, Math.trunc(Number(b.value) || 0), `bulk (${userName(req)})`, b.warehouse_id);
          break;
        case 'set_catalog':
          if (!db.prepare('SELECT 1 FROM catalogs WHERE id = ?').get(Number(b.value))) throw new HttpError(400, 'Unknown catalog');
          db.prepare('UPDATE products SET catalog_id = ? WHERE id = ? OR parent_id = ?').run(Number(b.value), id, id);
          break;
        case 'set_tax':
          db.prepare('UPDATE products SET tax_rate = ? WHERE id = ?').run(Number(b.value) || 0, id);
          break;
      }
    }
  });
  res.json({ ok: true });
});

/* ------------------------- categories & manufacturers ------------------------- */

for (const [path, table] of [
  ['categories', 'categories'],
  ['manufacturers', 'manufacturers'],
] as const) {
  productsRouter.get(`/meta/${path}`, (_req, res) => {
    res.json(
      db
        .prepare(`SELECT t.*, (SELECT COUNT(*) FROM products p WHERE p.${table === 'categories' ? 'category_id' : 'manufacturer_id'} = t.id) product_count FROM ${table} t ORDER BY name`)
        .all(),
    );
  });
  productsRouter.post(`/meta/${path}`, (req, res) => {
    const b = z.object({ name: z.string().min(1).max(200), parent_id: z.number().int().nullable().optional() }).parse(req.body);
    const r =
      table === 'categories'
        ? db.prepare('INSERT INTO categories (name, parent_id) VALUES (?, ?)').run(b.name, b.parent_id ?? null)
        : db.prepare('INSERT INTO manufacturers (name) VALUES (?)').run(b.name);
    res.json({ id: Number(r.lastInsertRowid) });
  });
  productsRouter.put(`/meta/${path}/:id`, (req, res) => {
    const b = z.object({ name: z.string().min(1).max(200) }).parse(req.body);
    db.prepare(`UPDATE ${table} SET name = ? WHERE id = ?`).run(b.name, idParam(req));
    res.json({ ok: true });
  });
  productsRouter.delete(`/meta/${path}/:id`, (req, res) => {
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(idParam(req));
    res.json({ ok: true });
  });
}
