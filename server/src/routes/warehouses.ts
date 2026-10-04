import { Router } from 'express';
import { z } from 'zod';
import { db, tx } from '../db/index.js';
import { HttpError, idParam, q } from '../lib/http.js';
import { adjustStock, warehouseStock } from '../services/stock.js';
import { userName } from './auth.js';

export const warehousesRouter = Router();

/* --------------------------------- warehouses --------------------------------- */

warehousesRouter.get('/', (_req, res) => {
  res.json(
    db
      .prepare(
        `SELECT w.*, (SELECT COALESCE(SUM(stock),0) FROM product_stock s WHERE s.warehouse_id = w.id) units,
          (SELECT COUNT(*) FROM product_stock s WHERE s.warehouse_id = w.id AND s.stock > 0) products,
          (SELECT ROUND(COALESCE(SUM(s.stock * p.purchase_price),0),2) FROM product_stock s JOIN products p ON p.id = s.product_id WHERE s.warehouse_id = w.id AND s.stock > 0) value
         FROM warehouses w ORDER BY w.is_default DESC, w.id`,
      )
      .all(),
  );
});

const whSchema = z.object({ name: z.string().min(1).max(100), code: z.string().max(20).optional(), description: z.string().max(500).optional(), is_default: z.boolean().optional() });

warehousesRouter.post('/', (req, res) => {
  const b = whSchema.parse(req.body);
  const id = tx(() => {
    if (b.is_default) db.prepare('UPDATE warehouses SET is_default = 0').run();
    return Number(
      db.prepare('INSERT INTO warehouses (name, code, description, is_default) VALUES (?, ?, ?, ?)').run(b.name, b.code ?? '', b.description ?? '', b.is_default ? 1 : 0).lastInsertRowid,
    );
  });
  res.json({ id });
});

warehousesRouter.put('/:id', (req, res) => {
  const id = idParam(req);
  const b = whSchema.parse(req.body);
  tx(() => {
    if (b.is_default) db.prepare('UPDATE warehouses SET is_default = 0').run();
    db.prepare('UPDATE warehouses SET name = ?, code = ?, description = ?, is_default = CASE WHEN ? THEN 1 ELSE is_default END WHERE id = ?').run(
      b.name,
      b.code ?? '',
      b.description ?? '',
      b.is_default ? 1 : 0,
      id,
    );
  });
  res.json({ ok: true });
});

warehousesRouter.delete('/:id', (req, res) => {
  const id = idParam(req);
  const w = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(id) as any;
  if (!w) throw new HttpError(404, 'Warehouse not found');
  if (w.is_default) throw new HttpError(400, 'The default warehouse cannot be deleted');
  const units = (db.prepare('SELECT COALESCE(SUM(stock),0) s FROM product_stock WHERE warehouse_id = ?').get(id) as { s: number }).s;
  if (units !== 0) throw new HttpError(409, 'The warehouse still has stock — move it with an MM document first');
  if (db.prepare(`SELECT 1 FROM warehouse_docs WHERE warehouse_id = ? OR target_warehouse_id = ?`).get(id, id)) throw new HttpError(409, 'The warehouse has documents');
  db.prepare('UPDATE orders SET warehouse_id = NULL WHERE warehouse_id = ?').run(id);
  db.prepare('DELETE FROM product_stock WHERE warehouse_id = ?').run(id);
  db.prepare('DELETE FROM warehouses WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ---------------------------------- catalogs ---------------------------------- */

export const catalogsRouter = Router();

catalogsRouter.get('/', (_req, res) => {
  res.json(
    db
      .prepare('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.catalog_id = c.id AND p.parent_id IS NULL) products FROM catalogs c ORDER BY c.is_default DESC, c.id')
      .all(),
  );
});

const catSchema = z.object({ name: z.string().min(1).max(100), description: z.string().max(500).optional(), is_default: z.boolean().optional() });

catalogsRouter.post('/', (req, res) => {
  const b = catSchema.parse(req.body);
  const id = tx(() => {
    if (b.is_default) db.prepare('UPDATE catalogs SET is_default = 0').run();
    return Number(db.prepare('INSERT INTO catalogs (name, description, is_default) VALUES (?, ?, ?)').run(b.name, b.description ?? '', b.is_default ? 1 : 0).lastInsertRowid);
  });
  res.json({ id });
});

catalogsRouter.put('/:id', (req, res) => {
  const id = idParam(req);
  const b = catSchema.parse(req.body);
  tx(() => {
    if (b.is_default) db.prepare('UPDATE catalogs SET is_default = 0').run();
    db.prepare('UPDATE catalogs SET name = ?, description = ?, is_default = CASE WHEN ? THEN 1 ELSE is_default END WHERE id = ?').run(b.name, b.description ?? '', b.is_default ? 1 : 0, id);
  });
  res.json({ ok: true });
});

catalogsRouter.delete('/:id', (req, res) => {
  const id = idParam(req);
  const c = db.prepare('SELECT * FROM catalogs WHERE id = ?').get(id) as any;
  if (!c) throw new HttpError(404, 'Catalog not found');
  if (c.is_default) throw new HttpError(400, 'The default catalog cannot be deleted');
  if (db.prepare('SELECT 1 FROM products WHERE catalog_id = ?').get(id)) throw new HttpError(409, 'The catalog contains products — move or delete them first');
  db.prepare('DELETE FROM catalogs WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ----------------------------- warehouse documents ----------------------------- */

export const DOC_TYPES = ['PZ', 'PW', 'WZ', 'RW', 'MM'] as const;
/** Sign of the stock change in the source warehouse. MM also adds to the target warehouse. */
const DOC_SIGN: Record<string, number> = { PZ: 1, PW: 1, WZ: -1, RW: -1, MM: -1 };

export const docsRouter = Router();

docsRouter.get('/', (req, res) => {
  const w = ['1=1'];
  const p: unknown[] = [];
  if (q.str(req.query.type)) {
    w.push('d.type = ?');
    p.push(q.str(req.query.type));
  }
  if (q.int(req.query.warehouse_id)) {
    w.push('(d.warehouse_id = ? OR d.target_warehouse_id = ?)');
    p.push(q.int(req.query.warehouse_id), q.int(req.query.warehouse_id));
  }
  if (q.str(req.query.search)) {
    w.push('(d.number LIKE ? OR d.contractor LIKE ?)');
    p.push(`%${q.str(req.query.search)}%`, `%${q.str(req.query.search)}%`);
  }
  res.json(
    db
      .prepare(
        `SELECT d.*, w.name warehouse_name, t.name target_name,
          (SELECT COUNT(*) FROM warehouse_doc_items i WHERE i.doc_id = d.id) items,
          (SELECT COALESCE(SUM(quantity),0) FROM warehouse_doc_items i WHERE i.doc_id = d.id) units,
          (SELECT ROUND(COALESCE(SUM(quantity * price),0),2) FROM warehouse_doc_items i WHERE i.doc_id = d.id) value
         FROM warehouse_docs d JOIN warehouses w ON w.id = d.warehouse_id LEFT JOIN warehouses t ON t.id = d.target_warehouse_id
         WHERE ${w.join(' AND ')} ORDER BY d.id DESC LIMIT 500`,
      )
      .all(...p),
  );
});

docsRouter.get('/:id', (req, res) => {
  const d = db
    .prepare('SELECT d.*, w.name warehouse_name, t.name target_name FROM warehouse_docs d JOIN warehouses w ON w.id = d.warehouse_id LEFT JOIN warehouses t ON t.id = d.target_warehouse_id WHERE d.id = ?')
    .get(idParam(req)) as any;
  if (!d) throw new HttpError(404, 'Document not found');
  const items = db
    .prepare('SELECT i.*, p.name, p.sku, p.ean FROM warehouse_doc_items i JOIN products p ON p.id = i.product_id WHERE i.doc_id = ? ORDER BY i.id')
    .all(d.id) as any[];
  for (const it of items) it.stock_now = warehouseStock(it.product_id, d.warehouse_id);
  res.json({ ...d, items });
});

const docSchema = z.object({
  type: z.enum(DOC_TYPES),
  warehouse_id: z.number().int(),
  target_warehouse_id: z.number().int().nullable().optional(),
  contractor: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  items: z.array(z.object({ product_id: z.number().int(), quantity: z.number().int().min(1).max(1e7), price: z.number().min(0).max(1e7).optional() })).min(1).max(2000),
  confirm: z.boolean().optional(),
});

function nextDocNumber(type: string) {
  const d = new Date();
  const period = `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  const r = db.prepare(`SELECT COUNT(*) c FROM warehouse_docs WHERE type = ? AND number LIKE ?`).get(type, `%/${period}`) as { c: number };
  return `${type} ${r.c + 1}/${period}`;
}

function confirmDoc(id: number, user: string) {
  const d = db.prepare('SELECT * FROM warehouse_docs WHERE id = ?').get(id) as any;
  if (!d) throw new HttpError(404, 'Document not found');
  if (d.status === 'confirmed') throw new HttpError(409, 'Document already confirmed');
  const items = db.prepare('SELECT product_id, quantity, price FROM warehouse_doc_items WHERE doc_id = ?').all(id) as any[];
  tx(() => {
    for (const it of items) {
      const reason = `${d.number}`;
      adjustStock(it.product_id, DOC_SIGN[d.type] * it.quantity, reason, null, d.warehouse_id);
      if (d.type === 'MM') adjustStock(it.product_id, it.quantity, reason, null, d.target_warehouse_id);
      // Goods receipt updates the purchase price.
      if (d.type === 'PZ' && it.price > 0) db.prepare('UPDATE products SET purchase_price = ? WHERE id = ?').run(it.price, it.product_id);
    }
    db.prepare(`UPDATE warehouse_docs SET status = 'confirmed', confirmed_at = datetime('now'), user_name = ? WHERE id = ?`).run(user, id);
  });
}

docsRouter.post('/', (req, res) => {
  const b = docSchema.parse(req.body);
  if (!db.prepare('SELECT 1 FROM warehouses WHERE id = ?').get(b.warehouse_id)) throw new HttpError(400, 'Unknown warehouse');
  if (b.type === 'MM') {
    if (!b.target_warehouse_id || b.target_warehouse_id === b.warehouse_id) throw new HttpError(400, 'Choose a different target warehouse');
    if (!db.prepare('SELECT 1 FROM warehouses WHERE id = ?').get(b.target_warehouse_id)) throw new HttpError(400, 'Unknown target warehouse');
  }
  for (const it of b.items) {
    const p = db.prepare('SELECT id FROM products WHERE id = ?').get(it.product_id);
    if (!p) throw new HttpError(400, `Unknown product ${it.product_id}`);
    if (db.prepare('SELECT 1 FROM products WHERE parent_id = ?').get(it.product_id)) throw new HttpError(400, `Product ${it.product_id} has variants — choose a variant`);
  }
  const id = tx(() => {
    const r = db
      .prepare('INSERT INTO warehouse_docs (type, number, warehouse_id, target_warehouse_id, contractor, notes, user_name) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(b.type, nextDocNumber(b.type), b.warehouse_id, b.type === 'MM' ? b.target_warehouse_id : null, b.contractor ?? '', b.notes ?? '', userName(req));
    const docId = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO warehouse_doc_items (doc_id, product_id, quantity, price) VALUES (?, ?, ?, ?)');
    for (const it of b.items) ins.run(docId, it.product_id, it.quantity, it.price ?? 0);
    if (b.confirm) confirmDoc(docId, userName(req));
    return docId;
  });
  res.json({ id });
});

docsRouter.post('/:id/confirm', (req, res) => {
  confirmDoc(idParam(req), userName(req));
  res.json({ ok: true });
});

docsRouter.delete('/:id', (req, res) => {
  const id = idParam(req);
  const d = db.prepare('SELECT status FROM warehouse_docs WHERE id = ?').get(id) as any;
  if (!d) throw new HttpError(404, 'Document not found');
  if (d.status === 'confirmed') throw new HttpError(409, 'A confirmed document cannot be deleted — issue a reverse document instead');
  db.prepare('DELETE FROM warehouse_docs WHERE id = ?').run(id);
  res.json({ ok: true });
});
