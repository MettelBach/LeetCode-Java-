import bcrypt from 'bcryptjs';
import { Router, type NextFunction, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { HttpError, idParam } from '../lib/http.js';
import { seedDemo } from '../services/demo-seed.js';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'user';
  language: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function sign(u: { id: number }) {
  return jwt.sign({ sub: u.id }, config.jwtSecret, { expiresIn: '7d' });
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  const token = h?.startsWith('Bearer ') ? h.slice(7) : undefined;
  if (!token) return next(new HttpError(401, 'Not authenticated'));
  try {
    const payload = jwt.verify(token, config.jwtSecret) as unknown as { sub: number };
    const u = db.prepare('SELECT id, email, name, role, language FROM users WHERE id = ?').get(payload.sub) as AuthUser | undefined;
    if (!u) return next(new HttpError(401, 'Not authenticated'));
    req.user = u;
    next();
  } catch {
    next(new HttpError(401, 'Session expired'));
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') return next(new HttpError(403, 'Administrator rights required'));
  next();
}

export const userName = (req: Request) => req.user?.name ?? 'System';

// Simple in-memory brute-force protection for login.
const attempts = new Map<string, { count: number; until: number }>();
function checkRate(key: string) {
  const a = attempts.get(key);
  if (a && a.until > Date.now() && a.count >= 10) throw new HttpError(429, 'Too many login attempts. Try again in a few minutes.');
}
function fail(key: string) {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) attempts.set(key, { count: 1, until: Date.now() + 10 * 60_000 });
  else a.count++;
}

const passwordSchema = z.string().min(8, 'Password must have at least 8 characters').max(200);

export const authRouter = Router();

authRouter.get('/status', (_req, res) => {
  const c = (db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c;
  res.json({ needs_setup: c === 0 });
});

authRouter.post('/setup', async (req, res) => {
  const c = (db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c;
  if (c > 0) throw new HttpError(409, 'Account already set up');
  const body = z
    .object({
      email: z.string().email(),
      name: z.string().min(1).max(100),
      password: passwordSchema,
      company: z.string().max(200).optional(),
      language: z.enum(['pl', 'en', 'ru']).optional(),
      demo: z.boolean().optional(),
    })
    .parse(req.body);
  const r = db
    .prepare(`INSERT INTO users (email, name, password_hash, role, language) VALUES (?, ?, ?, 'admin', ?)`)
    .run(body.email.toLowerCase(), body.name, bcrypt.hashSync(body.password, 10), body.language ?? 'pl');
  if (body.company) {
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'company'`).get() as { value: string } | undefined;
    const company = { ...(row ? JSON.parse(row.value) : {}), name: body.company };
    db.prepare(`INSERT INTO settings (key, value) VALUES ('company', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
      JSON.stringify(company),
    );
  }
  if (body.demo) await seedDemo();
  res.json({ token: sign({ id: Number(r.lastInsertRowid) }) });
});

authRouter.post('/login', (req, res) => {
  const body = z.object({ email: z.string(), password: z.string() }).parse(req.body);
  const key = `${req.ip}|${body.email.toLowerCase()}`;
  checkRate(key);
  const u = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(body.email.toLowerCase()) as
    | { id: number; password_hash: string }
    | undefined;
  if (!u || !bcrypt.compareSync(body.password, u.password_hash)) {
    fail(key);
    throw new HttpError(401, 'Invalid e-mail or password');
  }
  attempts.delete(key);
  res.json({ token: sign(u) });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
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
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(u.id) as { password_hash: string };
    if (!body.current_password || !bcrypt.compareSync(body.current_password, row.password_hash)) {
      throw new HttpError(400, 'Current password is incorrect');
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(body.new_password, 10), u.id);
  }
  if (body.name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(body.name, u.id);
  if (body.language) db.prepare('UPDATE users SET language = ? WHERE id = ?').run(body.language, u.id);
  res.json(db.prepare('SELECT id, email, name, role, language FROM users WHERE id = ?').get(u.id));
});

export const usersRouter = Router();
usersRouter.use(requireAdmin);

usersRouter.get('/', (_req, res) => {
  res.json(db.prepare('SELECT id, email, name, role, language, created_at FROM users ORDER BY id').all());
});

usersRouter.post('/', (req, res) => {
  const body = z
    .object({ email: z.string().email(), name: z.string().min(1).max(100), password: passwordSchema, role: z.enum(['admin', 'user']) })
    .parse(req.body);
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(body.email.toLowerCase())) throw new HttpError(409, 'User already exists');
  const r = db
    .prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(body.email.toLowerCase(), body.name, bcrypt.hashSync(body.password, 10), body.role);
  res.json({ id: Number(r.lastInsertRowid) });
});

usersRouter.delete('/:id', (req, res) => {
  const id = idParam(req);
  if (id === req.user!.id) throw new HttpError(400, 'You cannot delete yourself');
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});
