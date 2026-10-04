import bcrypt from 'bcryptjs';
import { Router, type NextFunction, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { platformDb, runWithTenant } from '../db/index.js';
import { HttpError, idParam, nowSql } from '../lib/http.js';
import { seedDemo } from '../services/demo-seed.js';
import { createAccount, getAccount, planById, platformMail, refreshAccountStats, type AccountRow } from '../services/platform.js';

export interface AuthUser {
  id: number;
  account_id: number;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'user';
  language: string;
}

export interface StaffUser {
  id: number;
  email: string;
  name: string;
  role: 'superadmin' | 'support';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      account?: AccountRow;
      staff?: StaffUser;
      /** Support staff member acting inside a client account. */
      impersonator?: StaffUser;
    }
  }
}

interface TokenPayload {
  typ: 'user' | 'staff';
  sub: number;
  acc?: number;
  imp?: number;
  v?: number;
}

export function signUser(u: { id: number; account_id: number; token_version: number }, impersonatorId?: number) {
  const payload: TokenPayload = { typ: 'user', sub: u.id, acc: u.account_id, v: u.token_version, ...(impersonatorId ? { imp: impersonatorId } : {}) };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: impersonatorId ? '2h' : '7d' });
}

export function signStaff(s: { id: number; token_version: number }) {
  return jwt.sign({ typ: 'staff', sub: s.id, v: s.token_version } satisfies TokenPayload, config.jwtSecret, { expiresIn: '12h' });
}

function readToken(req: Request): TokenPayload | null {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(h.slice(7), config.jwtSecret) as unknown as TokenPayload;
  } catch {
    return null;
  }
}

const activityTouched = new Map<number, number>();

/** Authenticates a client user and runs the rest of the request inside the account's database context. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const p = readToken(req);
  if (!p || p.typ !== 'user' || !p.acc) return next(new HttpError(401, 'Not authenticated'));
  const u = platformDb
    .prepare('SELECT id, account_id, email, name, role, language, active, token_version FROM users WHERE id = ? AND account_id = ?')
    .get(p.sub, p.acc) as (AuthUser & { active: number; token_version: number }) | undefined;
  if (!u || !u.active || (p.v ?? 0) !== u.token_version) return next(new HttpError(401, 'Session expired'));
  const account = platformDb.prepare('SELECT * FROM accounts WHERE id = ?').get(u.account_id) as AccountRow | undefined;
  if (!account || account.status === 'closed') return next(new HttpError(401, 'Account closed'));
  if (p.imp) {
    const s = platformDb.prepare('SELECT id, email, name, role, active FROM staff WHERE id = ?').get(p.imp) as (StaffUser & { active: number }) | undefined;
    if (!s || !s.active) return next(new HttpError(401, 'Session expired'));
    req.impersonator = { id: s.id, email: s.email, name: s.name, role: s.role };
  }
  // A suspended account can still log in to see billing and contact support, but cannot modify data.
  if (account.status === 'suspended' && !req.impersonator && req.method !== 'GET' && !/^\/(support|billing)/.test(req.path)) {
    return next(new HttpError(402, 'Account suspended — the trial has ended or the subscription is unpaid. See Settings → Subscription.'));
  }
  const { active: _a, token_version: _v, ...user } = u;
  req.user = user;
  req.account = account;
  const last = activityTouched.get(account.id) ?? 0;
  if (!req.impersonator && Date.now() - last > 5 * 60_000) {
    activityTouched.set(account.id, Date.now());
    platformDb.prepare('UPDATE accounts SET last_activity_at = ? WHERE id = ?').run(nowSql(), account.id);
  }
  runWithTenant(account.id, () => next());
}

export function requireAccountAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.impersonator || req.user?.role === 'owner' || req.user?.role === 'admin') return next();
  next(new HttpError(403, 'Administrator rights required'));
}

/** Backwards-compatible alias used by tenant routes. */
export const requireAdmin = requireAccountAdmin;

export function requireStaff(req: Request, _res: Response, next: NextFunction) {
  const p = readToken(req);
  if (!p || p.typ !== 'staff') return next(new HttpError(401, 'Not authenticated'));
  const s = platformDb.prepare('SELECT id, email, name, role, active, token_version FROM staff WHERE id = ?').get(p.sub) as
    | (StaffUser & { active: number; token_version: number })
    | undefined;
  if (!s || !s.active || (p.v ?? 0) !== s.token_version) return next(new HttpError(401, 'Session expired'));
  req.staff = { id: s.id, email: s.email, name: s.name, role: s.role };
  next();
}

export function requireSuperadmin(req: Request, _res: Response, next: NextFunction) {
  if (req.staff?.role !== 'superadmin') return next(new HttpError(403, 'Super-administrator rights required'));
  next();
}

/** Name recorded in order history etc. */
export const userName = (req: Request) => (req.impersonator ? `Support: ${req.impersonator.name}` : (req.user?.name ?? 'System'));

/* ---------------------------- brute-force protection ---------------------------- */

const attempts = new Map<string, { count: number; until: number }>();
export function checkRate(key: string, max = 10) {
  const a = attempts.get(key);
  if (a && a.until > Date.now() && a.count >= max) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
}
export function failRate(key: string) {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) attempts.set(key, { count: 1, until: Date.now() + 10 * 60_000 });
  else a.count++;
}
export function clearRate(key: string) {
  attempts.delete(key);
}

export const passwordSchema = z.string().min(8, 'Password must have at least 8 characters').max(200);

/* ----------------------------------- routes ----------------------------------- */

export const authRouter = Router();

authRouter.get('/config', (_req, res) => {
  res.json({ allow_signup: config.allowSignup, trial_days: config.trialDays });
});

authRouter.post('/register', async (req, res) => {
  if (!config.allowSignup) throw new HttpError(403, 'Registration is disabled');
  const b = z
    .object({
      company: z.string().min(1).max(200),
      name: z.string().min(1).max(100),
      email: z.string().email().max(200),
      password: passwordSchema,
      phone: z.string().max(50).optional(),
      language: z.enum(['pl', 'en', 'ru']).optional(),
      demo: z.boolean().optional(),
      accept_terms: z.literal(true, { message: 'You must accept the terms of service' }),
      attribution: z.record(z.string(), z.string().max(500)).optional(),
    })
    .parse(req.body);
  checkRate(`reg|${req.ip}`, 5);
  failRate(`reg|${req.ip}`);
  const { accountId, userId } = createAccount(b);
  if (b.demo) await runWithTenant(accountId, () => seedDemo());
  refreshAccountStats(accountId);
  const u = platformDb.prepare('SELECT id, account_id, token_version FROM users WHERE id = ?').get(userId) as any;
  platformMail(b.email, `Witamy w ${config.brandName}`, `Twoje konto ${b.company} zostało utworzone. Okres próbny: ${config.trialDays} dni.\n${config.appUrl}`).catch(() => undefined);
  res.json({ token: signUser(u) });
});

authRouter.post('/login', (req, res) => {
  const b = z.object({ email: z.string().max(200), password: z.string().max(200) }).parse(req.body);
  const email = b.email.trim().toLowerCase();
  const key = `${req.ip}|${email}`;
  checkRate(key);
  const u = platformDb.prepare('SELECT id, account_id, password_hash, active, token_version FROM users WHERE email = ?').get(email) as any;
  if (!u || !u.active || !bcrypt.compareSync(b.password, u.password_hash)) {
    failRate(key);
    throw new HttpError(401, 'Invalid e-mail or password');
  }
  const acc = getAccount(u.account_id);
  if (acc.status === 'closed') throw new HttpError(403, 'This account has been closed');
  clearRate(key);
  platformDb.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowSql(), u.id);
  res.json({ token: signUser(u) });
});

authRouter.post('/forgot', async (req, res) => {
  const b = z.object({ email: z.string().max(200) }).parse(req.body);
  checkRate(`forgot|${req.ip}`, 5);
  failRate(`forgot|${req.ip}`);
  const u = platformDb.prepare('SELECT id, email FROM users WHERE email = ? AND active = 1').get(b.email.trim().toLowerCase()) as any;
  if (u) {
    const token = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + 3600_000).toISOString().replace('T', ' ').slice(0, 19);
    platformDb.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hash, u.id, expires);
    await platformMail(u.email, 'Reset hasła / Password reset', `${config.appUrl}/reset-password?token=${token}\n\nLink jest ważny 1 godzinę.`);
  }
  // Same answer whether the address exists or not.
  res.json({ ok: true });
});

authRouter.post('/reset', (req, res) => {
  const b = z.object({ token: z.string().min(10).max(200), password: passwordSchema }).parse(req.body);
  const hash = crypto.createHash('sha256').update(b.token).digest('hex');
  const r = platformDb.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(hash) as any;
  if (!r || r.used || r.expires_at < nowSql()) throw new HttpError(400, 'The link is invalid or expired');
  platformDb.transaction(() => {
    platformDb.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(bcrypt.hashSync(b.password, 10), r.user_id);
    platformDb.prepare('UPDATE password_resets SET used = 1 WHERE token_hash = ?').run(hash);
  })();
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  const a = req.account!;
  res.json({
    ...req.user,
    impersonator: req.impersonator ?? null,
    account: {
      id: a.id,
      name: a.name,
      plan: a.plan,
      plan_name: planById(a.plan).name,
      status: a.status,
      trial_ends_at: a.trial_ends_at,
      paid_until: a.paid_until,
    },
  });
});

authRouter.put('/me', requireAuth, (req, res) => {
  const body = z
    .object({
      name: z.string().min(1).max(100).optional(),
      language: z.enum(['pl', 'en', 'ru']).optional(),
      current_password: z.string().optional(),
      new_password: passwordSchema.optional(),
    })
    .parse(req.body);
  const u = req.user!;
  if (body.new_password) {
    if (req.impersonator) throw new HttpError(403, 'Support cannot change the client password');
    const row = platformDb.prepare('SELECT password_hash FROM users WHERE id = ?').get(u.id) as { password_hash: string };
    if (!body.current_password || !bcrypt.compareSync(body.current_password, row.password_hash)) throw new HttpError(400, 'Current password is incorrect');
    // Changing the password signs out all other sessions; the caller gets a fresh token.
    platformDb.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(bcrypt.hashSync(body.new_password, 10), u.id);
  }
  if (body.name) platformDb.prepare('UPDATE users SET name = ? WHERE id = ?').run(body.name, u.id);
  if (body.language) platformDb.prepare('UPDATE users SET language = ? WHERE id = ?').run(body.language, u.id);
  const out = platformDb.prepare('SELECT id, account_id, email, name, role, language, token_version FROM users WHERE id = ?').get(u.id) as any;
  const token = body.new_password ? signUser(out) : undefined;
  delete out.token_version;
  res.json({ ...out, ...(token ? { token } : {}) });
});

/** Logs out on all devices. */
authRouter.post('/logout-all', requireAuth, (req, res) => {
  platformDb.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(req.user!.id);
  res.json({ ok: true });
});

/* -------------------------- users of the client account -------------------------- */

export const usersRouter = Router();

usersRouter.get('/', (req, res) => {
  res.json(
    platformDb
      .prepare('SELECT id, email, name, role, language, active, last_login_at, created_at FROM users WHERE account_id = ? ORDER BY id')
      .all(req.account!.id),
  );
});

usersRouter.post('/', requireAccountAdmin, (req, res) => {
  const b = z
    .object({ email: z.string().email(), name: z.string().min(1).max(100), password: passwordSchema, role: z.enum(['admin', 'user']) })
    .parse(req.body);
  const plan = planById(req.account!.plan);
  const count = (platformDb.prepare('SELECT COUNT(*) c FROM users WHERE account_id = ?').get(req.account!.id) as { c: number }).c;
  if (count >= plan.users) throw new HttpError(402, `Your plan allows ${plan.users} user(s). Upgrade the plan to add more.`);
  if (platformDb.prepare('SELECT 1 FROM users WHERE email = ?').get(b.email.toLowerCase())) throw new HttpError(409, 'User already exists');
  const r = platformDb
    .prepare('INSERT INTO users (account_id, email, name, password_hash, role, language) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.account!.id, b.email.toLowerCase(), b.name, bcrypt.hashSync(b.password, 10), b.role, req.user!.language);
  res.json({ id: Number(r.lastInsertRowid) });
});

usersRouter.put('/:id', requireAccountAdmin, (req, res) => {
  const id = idParam(req);
  const b = z.object({ role: z.enum(['admin', 'user']).optional(), active: z.boolean().optional(), name: z.string().min(1).max(100).optional() }).parse(req.body);
  const u = platformDb.prepare('SELECT * FROM users WHERE id = ? AND account_id = ?').get(id, req.account!.id) as any;
  if (!u) throw new HttpError(404, 'User not found');
  if (u.role === 'owner') throw new HttpError(400, 'The account owner cannot be changed');
  platformDb
    .prepare('UPDATE users SET role = ?, active = ?, name = ?, token_version = token_version + ? WHERE id = ?')
    .run(b.role ?? u.role, b.active === undefined ? u.active : b.active ? 1 : 0, b.name ?? u.name, b.active === false ? 1 : 0, id);
  res.json({ ok: true });
});

usersRouter.delete('/:id', requireAccountAdmin, (req, res) => {
  const id = idParam(req);
  if (id === req.user!.id) throw new HttpError(400, 'You cannot delete yourself');
  const u = platformDb.prepare('SELECT role FROM users WHERE id = ? AND account_id = ?').get(id, req.account!.id) as any;
  if (!u) throw new HttpError(404, 'User not found');
  if (u.role === 'owner') throw new HttpError(400, 'The account owner cannot be deleted');
  platformDb.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});
