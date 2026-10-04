import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { db, parseJson, platformDb, runWithTenant } from '../db/index.js';
import { HttpError, idParam, nowSql, q } from '../lib/http.js';
import {
  accountAccelerations,
  accountBalance,
  audit,
  deleteAccount,
  getAccount,
  PLANS,
  planById,
  refreshAccountStats,
} from '../services/platform.js';
import { checkRate, clearRate, failRate, passwordSchema, requireStaff, requireSuperadmin, signStaff, signUser } from './auth.js';
import { staffReply } from './support.js';
import { checkSecondFactor, resetSecondFactor, twoFactorRouter } from './two-factor.js';

export const adminRouter = Router();

/* ------------------------------------ auth ------------------------------------ */

adminRouter.post('/login', (req, res) => {
  const b = z.object({ email: z.string().max(200), password: z.string().max(200), code: z.string().max(10).optional() }).parse(req.body);
  const email = b.email.trim().toLowerCase();
  const key = `staff|${req.ip}|${email}`;
  checkRate(key, 5);
  const s = platformDb.prepare('SELECT * FROM staff WHERE email = ?').get(email) as any;
  if (!s || !s.active || !bcrypt.compareSync(b.password, s.password_hash)) {
    failRate(key);
    throw new HttpError(401, 'Invalid e-mail or password');
  }
  if (s.totp_enabled) {
    if (!b.code) return void res.json({ two_factor_required: true });
    if (!checkSecondFactor('staff', s.id, b.code)) {
      failRate(key);
      throw new HttpError(401, 'Invalid two-factor code');
    }
  }
  clearRate(key);
  platformDb.prepare('UPDATE staff SET last_login_at = ? WHERE id = ?').run(nowSql(), s.id);
  audit(s.id, null, 'staff.login', '', req.ip ?? '');
  res.json({ token: signStaff(s) });
});

adminRouter.use(requireStaff);

adminRouter.get('/me', (req, res) => {
  res.json(req.staff);
});

adminRouter.use('/me/2fa', twoFactorRouter('staff', (req) => req.staff?.id));

adminRouter.put('/me/password', (req, res) => {
  const b = z.object({ current_password: z.string(), new_password: passwordSchema }).parse(req.body);
  const s = platformDb.prepare('SELECT password_hash FROM staff WHERE id = ?').get(req.staff!.id) as any;
  if (!bcrypt.compareSync(b.current_password, s.password_hash)) throw new HttpError(400, 'Current password is incorrect');
  platformDb.prepare('UPDATE staff SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(b.new_password, 10), req.staff!.id);
  res.json({ ok: true });
});

/* ---------------------------------- dashboard ---------------------------------- */

adminRouter.get('/stats', (_req, res) => {
  const accounts = platformDb
    .prepare(
      `SELECT COUNT(*) total,
        SUM(status = 'active') active, SUM(status = 'trial') trial, SUM(status = 'suspended') suspended, SUM(status = 'closed') closed,
        SUM(created_at >= datetime('now','-30 days')) new_30d,
        SUM(last_activity_at >= datetime('now','-7 days')) active_7d
       FROM accounts`,
    )
    .get() as any;
  const mrr = (platformDb.prepare(`SELECT plan, COUNT(*) c FROM accounts WHERE status = 'active' GROUP BY plan`).all() as any[]).reduce(
    (s, r) => s + planById(r.plan).price * r.c,
    0,
  );
  const tickets = platformDb
    .prepare(
      `SELECT SUM(status = 'new') new, SUM(status = 'open') open, SUM(status = 'waiting') waiting,
        SUM(status IN ('new','open') AND assigned_staff_id IS NULL) unassigned FROM tickets`,
    )
    .get();
  const accelRevenue = platformDb
    .prepare(`SELECT ROUND(COALESCE(SUM(amount),0),2) s FROM billing WHERE item LIKE 'accel:%' AND date >= date('now','-30 days')`)
    .get() as { s: number };
  const signups = platformDb
    .prepare(`SELECT date(created_at) d, COUNT(*) c FROM accounts WHERE created_at >= datetime('now','-30 days') GROUP BY d ORDER BY d`)
    .all();
  const totals = (platformDb.prepare('SELECT stats FROM accounts').all() as { stats: string }[]).reduce(
    (acc, r) => {
      const s = parseJson<any>(r.stats, {});
      acc.orders_30d += s.orders_30d ?? 0;
      acc.gmv_30d += s.gmv_30d ?? 0;
      acc.integration_errors += s.integration_errors ?? 0;
      return acc;
    },
    { orders_30d: 0, gmv_30d: 0, integration_errors: 0 },
  );
  res.json({ accounts, mrr, tickets, accel_revenue_30d: accelRevenue.s, signups, totals, plans: PLANS });
});

/* ---------------------------------- accounts ---------------------------------- */

/** Short marketing source label of an account ("google / cpc", "meta"...). */
function acquisitionSource(raw: string) {
  const at = parseJson<Record<string, string>>(raw, {});
  if (at.utm_source) return [at.utm_source, at.utm_medium].filter(Boolean).join(' / ');
  if (at.gclid || at.gbraid || at.wbraid) return 'google / cpc';
  if (at.fbclid || at.fbc) return 'meta';
  if (at.referrer) {
    try {
      return new URL(at.referrer).hostname;
    } catch {
      return '';
    }
  }
  return '';
}

adminRouter.get('/accounts', (req, res) => {
  const w = ['1=1'];
  const p: unknown[] = [];
  const search = q.str(req.query.search);
  if (search) {
    const like = `%${search}%`;
    w.push(`(a.name LIKE ? OR a.nip LIKE ? OR CAST(a.id AS TEXT) = ? OR EXISTS (SELECT 1 FROM users u WHERE u.account_id = a.id AND (u.email LIKE ? OR u.name LIKE ?)))`);
    p.push(like, like, search, like, like);
  }
  if (q.str(req.query.status)) {
    w.push('a.status = ?');
    p.push(q.str(req.query.status));
  }
  if (q.str(req.query.plan)) {
    w.push('a.plan = ?');
    p.push(q.str(req.query.plan));
  }
  const page = Math.max(1, q.int(req.query.page) ?? 1);
  const perPage = 50;
  const where = w.join(' AND ');
  const total = (platformDb.prepare(`SELECT COUNT(*) c FROM accounts a WHERE ${where}`).get(...p) as { c: number }).c;
  const rows = (
    platformDb
      .prepare(
        `SELECT a.*, (SELECT email FROM users u WHERE u.account_id = a.id AND u.role = 'owner' LIMIT 1) owner_email,
          (SELECT COUNT(*) FROM users u WHERE u.account_id = a.id) users,
          (SELECT COUNT(*) FROM tickets t WHERE t.account_id = a.id AND t.status IN ('new','open','waiting')) open_tickets
         FROM accounts a WHERE ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...p, perPage, (page - 1) * perPage) as any[]
  ).map((a) => ({ ...a, stats: parseJson(a.stats, {}), settings: undefined, attribution: undefined, source: acquisitionSource(a.attribution), balance: accountBalance(a.id) }));
  res.json({ total, page, per_page: perPage, rows });
});

/**
 * First payments of accounts that came from Google Ads, in the Google Ads
 * offline conversion import format (Tools → Conversions → Uploads).
 */
adminRouter.get('/conversions.csv', (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 90));
  const rows = platformDb
    .prepare(
      `SELECT a.id, a.attribution, b.created_at, -b.amount amount FROM accounts a
       JOIN billing b ON b.id = (SELECT id FROM billing WHERE account_id = a.id AND amount < 0 ORDER BY created_at, id LIMIT 1)
       WHERE b.created_at >= datetime('now', ?) ORDER BY b.created_at`,
    )
    .all(`-${days} days`) as { id: number; attribution: string; created_at: string; amount: number }[];
  const cell = (v: string | number) => {
    const s = String(v).replace(/^[=+\-@]/, "'$&");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = ['Parameters:TimeZone=+0000', 'Google Click ID,GBRAID,WBRAID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency'];
  for (const r of rows) {
    const at = parseJson<Record<string, string>>(r.attribution, {});
    if (!at.gclid && !at.gbraid && !at.wbraid) continue;
    lines.push([at.gclid ?? '', at.gbraid ?? '', at.wbraid ?? '', 'Subscription paid', r.created_at, r.amount.toFixed(2), 'PLN'].map(cell).join(','));
  }
  audit(req.staff!.id, null, 'conversions.export', `${lines.length - 2} rows`, req.ip ?? '');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="google-ads-conversions.csv"');
  res.send(lines.join('\n') + '\n');
});

adminRouter.get('/accounts/:id', (req, res) => {
  const a = getAccount(idParam(req));
  const stats = refreshAccountStats(a.id);
  const users = platformDb.prepare('SELECT id, email, name, role, active, totp_enabled, last_login_at, created_at FROM users WHERE account_id = ?').all(a.id);
  const tickets = platformDb.prepare('SELECT id, subject, status, priority, last_message_at FROM tickets WHERE account_id = ? ORDER BY id DESC LIMIT 50').all(a.id);
  const billing = platformDb.prepare('SELECT * FROM billing WHERE account_id = ? ORDER BY date DESC, id DESC LIMIT 100').all(a.id);
  const auditRows = platformDb
    .prepare('SELECT l.*, s.name staff_name FROM audit_log l LEFT JOIN staff s ON s.id = l.staff_id WHERE l.account_id = ? ORDER BY l.id DESC LIMIT 50')
    .all(a.id);
  const tenant = runWithTenant(a.id, () => ({
    integrations: db.prepare('SELECT id, type, name, enabled, demo, last_sync_at, last_error FROM integrations').all(),
    recent_orders: db.prepare('SELECT id, source, date_add, delivery_fullname FROM orders WHERE deleted = 0 ORDER BY id DESC LIMIT 10').all(),
    sync_errors: db.prepare(`SELECT l.created_at, l.message, i.name FROM sync_log l JOIN integrations i ON i.id = l.integration_id WHERE l.level = 'error' ORDER BY l.id DESC LIMIT 20`).all(),
  }));
  res.json({
    ...a,
    settings: parseJson(a.settings, {}),
    attribution: parseJson(a.attribution, {}),
    stats,
    accelerations: accountAccelerations(a.id),
    balance: accountBalance(a.id),
    plan_info: planById(a.plan),
    users,
    tickets,
    billing,
    audit: auditRows,
    ...tenant,
  });
});

adminRouter.put('/accounts/:id', (req, res) => {
  const a = getAccount(idParam(req));
  const b = z
    .object({
      name: z.string().min(1).max(200).optional(),
      nip: z.string().max(30).optional(),
      phone: z.string().max(50).optional(),
      plan: z.enum(PLANS.map((p) => p.id) as [string, ...string[]]).optional(),
      status: z.enum(['trial', 'active', 'suspended', 'closed']).optional(),
      trial_ends_at: z.string().nullable().optional(),
      paid_until: z.string().nullable().optional(),
      notes: z.string().max(10000).optional(),
    })
    .parse(req.body);
  const fields = Object.entries(b).filter(([, v]) => v !== undefined);
  if (!fields.length) return void res.json({ ok: true });
  platformDb.prepare(`UPDATE accounts SET ${fields.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...fields.map(([, v]) => v), a.id);
  audit(req.staff!.id, a.id, 'account.update', JSON.stringify(b), req.ip ?? '');
  res.json({ ok: true });
});

adminRouter.post('/accounts/:id/payments', (req, res) => {
  const a = getAccount(idParam(req));
  const b = z.object({ amount: z.number().positive().max(1e6), description: z.string().max(200).optional(), extend_days: z.number().int().min(0).max(800).optional() }).parse(req.body);
  platformDb
    .prepare('INSERT INTO billing (account_id, date, item, description, amount) VALUES (?, ?, ?, ?, ?)')
    .run(a.id, nowSql().slice(0, 10), `payment:${Date.now()}`, b.description || 'Wpłata', -b.amount);
  if (b.extend_days) {
    const base = a.paid_until && a.paid_until > nowSql() ? new Date(a.paid_until.replace(' ', 'T') + 'Z') : new Date();
    base.setDate(base.getDate() + b.extend_days);
    platformDb.prepare(`UPDATE accounts SET paid_until = ?, status = CASE WHEN status IN ('trial','suspended') THEN 'active' ELSE status END WHERE id = ?`).run(
      base.toISOString().replace('T', ' ').slice(0, 19),
      a.id,
    );
  }
  audit(req.staff!.id, a.id, 'account.payment', JSON.stringify(b), req.ip ?? '');
  res.json({ ok: true });
});

/** Support logs in to the client account. Every session is recorded in the audit log. */
adminRouter.post('/accounts/:id/impersonate', (req, res) => {
  const a = getAccount(idParam(req));
  const b = z.object({ reason: z.string().min(3).max(500) }).parse(req.body);
  const owner = platformDb
    .prepare(`SELECT id, account_id, token_version FROM users WHERE account_id = ? AND active = 1 ORDER BY role = 'owner' DESC, id LIMIT 1`)
    .get(a.id) as any;
  if (!owner) throw new HttpError(400, 'The account has no active users');
  audit(req.staff!.id, a.id, 'account.impersonate', b.reason, req.ip ?? '');
  res.json({ token: signUser(owner, req.staff!.id) });
});

adminRouter.delete('/accounts/:id', requireSuperadmin, (req, res) => {
  const a = getAccount(idParam(req));
  const b = z.object({ confirm: z.literal(String(a.id)) }).parse(req.body);
  void b;
  audit(req.staff!.id, null, 'account.delete', `${a.id} ${a.name}`, req.ip ?? '');
  deleteAccount(a.id);
  res.json({ ok: true });
});

adminRouter.post('/accounts/:id/users/:userId/logout', (req, res) => {
  const a = getAccount(idParam(req));
  platformDb.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ? AND account_id = ?').run(idParam(req, 'userId'), a.id);
  audit(req.staff!.id, a.id, 'user.logout', String(idParam(req, 'userId')), req.ip ?? '');
  res.json({ ok: true });
});

/** Turns off 2FA of a client user who lost the phone (identity must be verified by support). */
adminRouter.post('/accounts/:id/users/:userId/reset-2fa', (req, res) => {
  const a = getAccount(idParam(req));
  const userId = idParam(req, 'userId');
  if (!platformDb.prepare('SELECT 1 FROM users WHERE id = ? AND account_id = ?').get(userId, a.id)) throw new HttpError(404, 'Not found');
  resetSecondFactor('users', userId);
  platformDb.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(userId);
  audit(req.staff!.id, a.id, 'user.reset_2fa', String(userId), req.ip ?? '');
  res.json({ ok: true });
});

/* ----------------------------------- tickets ----------------------------------- */

adminRouter.get('/tickets', (req, res) => {
  const w = ['1=1'];
  const p: unknown[] = [];
  const status = q.str(req.query.status);
  if (status === 'active') w.push(`t.status IN ('new','open','waiting')`);
  else if (status) {
    w.push('t.status = ?');
    p.push(status);
  }
  const assigned = q.str(req.query.assigned);
  if (assigned === 'me') {
    w.push('t.assigned_staff_id = ?');
    p.push(req.staff!.id);
  } else if (assigned === 'none') w.push('t.assigned_staff_id IS NULL');
  if (q.int(req.query.account_id)) {
    w.push('t.account_id = ?');
    p.push(q.int(req.query.account_id));
  }
  const search = q.str(req.query.search);
  if (search) {
    w.push('(t.subject LIKE ? OR a.name LIKE ? OR CAST(t.id AS TEXT) = ?)');
    p.push(`%${search}%`, `%${search}%`, search);
  }
  res.json(
    platformDb
      .prepare(
        `SELECT t.*, a.name account_name, a.plan, s.name assigned_name, u.name user_name, u.email user_email,
          (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id AND m.internal = 0) messages
         FROM tickets t JOIN accounts a ON a.id = t.account_id LEFT JOIN staff s ON s.id = t.assigned_staff_id LEFT JOIN users u ON u.id = t.user_id
         WHERE ${w.join(' AND ')}
         ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.last_message_at ASC LIMIT 500`,
      )
      .all(...p),
  );
});

adminRouter.get('/tickets/:id', (req, res) => {
  const t = platformDb
    .prepare(
      `SELECT t.*, a.name account_name, a.plan, a.status account_status, s.name assigned_name, u.name user_name, u.email user_email
       FROM tickets t JOIN accounts a ON a.id = t.account_id LEFT JOIN staff s ON s.id = t.assigned_staff_id LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
    )
    .get(idParam(req)) as any;
  if (!t) throw new HttpError(404, 'Ticket not found');
  const messages = platformDb.prepare('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY id').all(t.id);
  res.json({ ...t, messages });
});

adminRouter.post('/tickets/:id/take', (req, res) => {
  const id = idParam(req);
  platformDb.prepare(`UPDATE tickets SET assigned_staff_id = ?, status = CASE WHEN status = 'new' THEN 'open' ELSE status END, updated_at = ? WHERE id = ?`).run(
    req.staff!.id,
    nowSql(),
    id,
  );
  platformDb
    .prepare(`INSERT INTO ticket_messages (ticket_id, author_type, author_name, body, internal) VALUES (?, 'system', 'System', ?, 1)`)
    .run(id, `${req.staff!.name} took the ticket`);
  res.json({ ok: true });
});

adminRouter.put('/tickets/:id', (req, res) => {
  const id = idParam(req);
  const b = z
    .object({
      status: z.enum(['new', 'open', 'waiting', 'resolved', 'closed']).optional(),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      assigned_staff_id: z.number().int().nullable().optional(),
      category: z.string().max(40).optional(),
    })
    .parse(req.body);
  const fields = Object.entries(b).filter(([, v]) => v !== undefined);
  if (fields.length) {
    platformDb.prepare(`UPDATE tickets SET ${fields.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...fields.map(([, v]) => v), nowSql(), id);
    if (b.status) {
      platformDb
        .prepare(`INSERT INTO ticket_messages (ticket_id, author_type, author_name, body, internal) VALUES (?, 'system', 'System', ?, 1)`)
        .run(id, `${req.staff!.name}: status → ${b.status}`);
    }
  }
  res.json({ ok: true });
});

adminRouter.post('/tickets/:id/messages', async (req, res) => {
  const b = z
    .object({ body: z.string().min(1).max(20000), internal: z.boolean().optional(), status: z.enum(['open', 'waiting', 'resolved', 'closed']).optional() })
    .parse(req.body);
  await staffReply(idParam(req), req.staff!, b.body, !!b.internal, b.status);
  res.json({ ok: true });
});

/* ------------------------------------ staff ------------------------------------ */

adminRouter.get('/staff', (_req, res) => {
  res.json(
    platformDb
      .prepare(
        `SELECT s.id, s.email, s.name, s.role, s.active, s.totp_enabled, s.last_login_at, s.created_at,
          (SELECT COUNT(*) FROM tickets t WHERE t.assigned_staff_id = s.id AND t.status IN ('new','open','waiting')) open_tickets
         FROM staff s ORDER BY s.id`,
      )
      .all(),
  );
});

adminRouter.post('/staff', requireSuperadmin, (req, res) => {
  const b = z.object({ email: z.string().email(), name: z.string().min(1).max(100), password: passwordSchema, role: z.enum(['superadmin', 'support']) }).parse(req.body);
  if (platformDb.prepare('SELECT 1 FROM staff WHERE email = ?').get(b.email.toLowerCase())) throw new HttpError(409, 'Already exists');
  const r = platformDb
    .prepare('INSERT INTO staff (email, name, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(b.email.toLowerCase(), b.name, bcrypt.hashSync(b.password, 10), b.role);
  audit(req.staff!.id, null, 'staff.create', b.email, req.ip ?? '');
  res.json({ id: Number(r.lastInsertRowid) });
});

adminRouter.put('/staff/:id', requireSuperadmin, (req, res) => {
  const id = idParam(req);
  const b = z
    .object({ role: z.enum(['superadmin', 'support']).optional(), active: z.boolean().optional(), password: passwordSchema.optional(), reset_2fa: z.literal(true).optional() })
    .parse(req.body);
  if (id === req.staff!.id && (b.active === false || b.role === 'support')) throw new HttpError(400, 'You cannot demote or deactivate yourself');
  const s = platformDb.prepare('SELECT * FROM staff WHERE id = ?').get(id) as any;
  if (!s) throw new HttpError(404, 'Not found');
  platformDb
    .prepare('UPDATE staff SET role = ?, active = ?, password_hash = ?, token_version = token_version + ? WHERE id = ?')
    .run(b.role ?? s.role, b.active === undefined ? s.active : b.active ? 1 : 0, b.password ? bcrypt.hashSync(b.password, 10) : s.password_hash, b.active === false || b.password || b.reset_2fa ? 1 : 0, id);
  if (b.reset_2fa) resetSecondFactor('staff', id);
  audit(req.staff!.id, null, 'staff.update', `${s.email} ${JSON.stringify({ ...b, password: b.password ? '***' : undefined })}`, req.ip ?? '');
  res.json({ ok: true });
});

adminRouter.get('/audit', (req, res) => {
  const accountId = q.int(req.query.account_id);
  res.json(
    platformDb
      .prepare(
        `SELECT l.*, s.name staff_name, a.name account_name FROM audit_log l LEFT JOIN staff s ON s.id = l.staff_id LEFT JOIN accounts a ON a.id = l.account_id
         ${accountId ? 'WHERE l.account_id = ?' : ''} ORDER BY l.id DESC LIMIT 300`,
      )
      .all(...(accountId ? [accountId] : [])),
  );
});
