import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { HttpError, idParam } from '../lib/http.js';
import { statusCounts } from '../services/order-query.js';

export const statusesRouter = Router();

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid color');

statusesRouter.get('/', (_req, res) => {
  const statuses = db.prepare('SELECT * FROM order_statuses ORDER BY sort, id').all();
  const groups = db.prepare('SELECT * FROM status_groups ORDER BY sort, id').all();
  res.json({ statuses, groups, counts: statusCounts() });
});

const statusSchema = z.object({
  name: z.string().min(1).max(60),
  short_name: z.string().max(30).optional(),
  full_name: z.string().max(200).optional(),
  color: color.optional(),
  group_id: z.number().int().nullable().optional(),
  sort: z.number().int().optional(),
});

statusesRouter.post('/', (req, res) => {
  const b = statusSchema.parse(req.body);
  const sort = b.sort ?? ((db.prepare('SELECT MAX(sort) m FROM order_statuses').get() as { m: number }).m ?? 0) + 1;
  const r = db
    .prepare('INSERT INTO order_statuses (name, short_name, full_name, color, group_id, sort) VALUES (?, ?, ?, ?, ?, ?)')
    .run(b.name, b.short_name || b.name, b.full_name || b.name, b.color ?? '#0f74d4', b.group_id ?? null, sort);
  res.json({ id: Number(r.lastInsertRowid) });
});

statusesRouter.put('/reorder', (req, res) => {
  const b = z.object({ ids: z.array(z.number().int()) }).parse(req.body);
  const st = db.prepare('UPDATE order_statuses SET sort = ? WHERE id = ?');
  db.transaction(() => b.ids.forEach((id, i) => st.run(i + 1, id)))();
  res.json({ ok: true });
});

statusesRouter.put('/:id', (req, res) => {
  const id = idParam(req);
  const b = statusSchema.partial().parse(req.body);
  const cur = db.prepare('SELECT * FROM order_statuses WHERE id = ?').get(id) as any;
  if (!cur) throw new HttpError(404, 'Status not found');
  db.prepare('UPDATE order_statuses SET name = ?, short_name = ?, full_name = ?, color = ?, group_id = ?, sort = ? WHERE id = ?').run(
    b.name ?? cur.name,
    b.short_name ?? cur.short_name,
    b.full_name ?? cur.full_name,
    b.color ?? cur.color,
    b.group_id !== undefined ? b.group_id : cur.group_id,
    b.sort ?? cur.sort,
    id,
  );
  res.json({ ok: true });
});

statusesRouter.delete('/:id', (req, res) => {
  const id = idParam(req);
  const cur = db.prepare('SELECT * FROM order_statuses WHERE id = ?').get(id) as any;
  if (!cur) throw new HttpError(404, 'Status not found');
  if (cur.system_key) throw new HttpError(400, 'System statuses cannot be deleted');
  const target = z.object({ move_to: z.number().int() }).safeParse(req.body);
  const count = (db.prepare('SELECT COUNT(*) c FROM orders WHERE status_id = ?').get(id) as { c: number }).c;
  if (count > 0) {
    if (!target.success || target.data.move_to === id) throw new HttpError(400, 'Choose a status to move the orders to');
    db.prepare('UPDATE orders SET status_id = ? WHERE status_id = ?').run(target.data.move_to, id);
  }
  db.prepare('DELETE FROM order_statuses WHERE id = ?').run(id);
  res.json({ ok: true, moved: count });
});

statusesRouter.post('/groups', (req, res) => {
  const b = z.object({ name: z.string().min(1).max(60) }).parse(req.body);
  const sort = ((db.prepare('SELECT MAX(sort) m FROM status_groups').get() as { m: number }).m ?? 0) + 1;
  const r = db.prepare('INSERT INTO status_groups (name, sort) VALUES (?, ?)').run(b.name, sort);
  res.json({ id: Number(r.lastInsertRowid) });
});

statusesRouter.put('/groups/:id', (req, res) => {
  const b = z.object({ name: z.string().min(1).max(60).optional(), sort: z.number().int().optional() }).parse(req.body);
  const id = idParam(req);
  if (b.name) db.prepare('UPDATE status_groups SET name = ? WHERE id = ?').run(b.name, id);
  if (b.sort !== undefined) db.prepare('UPDATE status_groups SET sort = ? WHERE id = ?').run(b.sort, id);
  res.json({ ok: true });
});

statusesRouter.delete('/groups/:id', (req, res) => {
  const id = idParam(req);
  db.prepare('UPDATE order_statuses SET group_id = NULL WHERE group_id = ?').run(id);
  db.prepare('DELETE FROM status_groups WHERE id = ?').run(id);
  res.json({ ok: true });
});
