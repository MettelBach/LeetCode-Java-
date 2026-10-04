import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import fs from 'node:fs';
import { config } from '../config.js';
import { closeTenant, parseJson, platformDb, tenantDb, tenantFile } from '../db/index.js';
import { HttpError } from '../lib/http.js';

/* ----------------------------------- plans ----------------------------------- */

export interface Plan {
  id: string;
  name: string;
  price: number;
  orders: number;
  users: number;
  integrations: number;
}

/** Monthly net prices in PLN. `orders` = orders per month included. */
export const PLANS: Plan[] = [
  { id: 'trial', name: 'Trial', price: 0, orders: 1000, users: 5, integrations: 10 },
  { id: 'start', name: 'Start', price: 49, orders: 300, users: 1, integrations: 2 },
  { id: 'business', name: 'Business', price: 99, orders: 1000, users: 5, integrations: 10 },
  { id: 'pro', name: 'Pro', price: 199, orders: 5000, users: 20, integrations: 50 },
  { id: 'enterprise', name: 'Enterprise', price: 499, orders: 100000, users: 1000, integrations: 1000 },
];

export const planById = (id: string) => PLANS.find((p) => p.id === id) ?? PLANS[0];

/* -------------------------------- accelerations -------------------------------- */

export interface AccelOption {
  id: string;
  minutes: number;
  /** Net price per day in PLN. */
  price: number;
}

/** Synchronization speed options ("Akceleracje"). The first option is the standard one. */
export const ACCELERATIONS: Record<string, AccelOption[]> = {
  stock: [
    { id: 'std', minutes: 60, price: 0 },
    { id: '15m', minutes: 15, price: 2 },
    { id: '5m', minutes: 5, price: 4 },
  ],
  price: [
    { id: 'std', minutes: 1440, price: 0 },
    { id: '4h', minutes: 240, price: 1 },
    { id: '1h', minutes: 60, price: 2 },
    { id: '5m', minutes: 5, price: 5 },
  ],
  orders: [
    { id: 'std', minutes: 10, price: 0 },
    { id: '5m', minutes: 5, price: 1 },
    { id: '1m', minutes: 1, price: 3 },
  ],
  api: [
    { id: 'std', minutes: 100, price: 0 },
    { id: '300', minutes: 300, price: 2 },
    { id: '500', minutes: 500, price: 4 },
  ],
};

export type AccelSettings = Record<keyof typeof ACCELERATIONS, string>;

export function accountAccelerations(accountId: number): AccelSettings {
  const acc = getAccount(accountId);
  const s = parseJson<any>(acc.settings, {}).accelerations ?? {};
  const out: any = {};
  for (const k of Object.keys(ACCELERATIONS)) {
    const v = s[k];
    out[k] = ACCELERATIONS[k].some((o) => o.id === v) ? v : 'std';
  }
  return out;
}

export function accelOption(kind: string, id: string): AccelOption {
  return ACCELERATIONS[kind].find((o) => o.id === id) ?? ACCELERATIONS[kind][0];
}

export function setAccelerations(accountId: number, patch: Partial<AccelSettings>) {
  const acc = getAccount(accountId);
  const settings = parseJson<any>(acc.settings, {});
  const cur = accountAccelerations(accountId);
  for (const [k, v] of Object.entries(patch)) {
    if (!ACCELERATIONS[k]) throw new HttpError(400, `Unknown acceleration ${k}`);
    if (!ACCELERATIONS[k].some((o) => o.id === v)) throw new HttpError(400, `Unknown option ${v}`);
    (cur as any)[k] = v;
  }
  settings.accelerations = cur;
  platformDb.prepare('UPDATE accounts SET settings = ? WHERE id = ?').run(JSON.stringify(settings), accountId);
  // Charge the current day immediately when an acceleration is switched on.
  chargeAccelerations(accountId, new Date());
  return cur;
}

/** Adds one day of charges for active accelerations (idempotent per day). */
export function chargeAccelerations(accountId: number, day: Date) {
  const date = day.toISOString().slice(0, 10);
  const acc = accountAccelerations(accountId);
  const ins = platformDb.prepare('INSERT OR IGNORE INTO billing (account_id, date, item, description, amount) VALUES (?, ?, ?, ?, ?)');
  for (const [kind, id] of Object.entries(acc)) {
    const o = accelOption(kind, id);
    if (o.price > 0) ins.run(accountId, date, `accel:${kind}`, `Akceleracja ${kind}: ${id}`, o.price);
  }
}

/** Monthly subscription charge on the first day of a billing period. */
export function chargeSubscription(accountId: number, day: Date) {
  const a = getAccount(accountId);
  if (a.status !== 'active') return;
  const plan = planById(a.plan);
  if (!plan.price) return;
  const period = day.toISOString().slice(0, 7);
  platformDb
    .prepare('INSERT OR IGNORE INTO billing (account_id, date, item, description, amount) VALUES (?, ?, ?, ?, ?)')
    .run(accountId, `${period}-01`, `plan:${period}`, `Abonament ${plan.name} ${period}`, plan.price);
}

export function accountBalance(accountId: number) {
  const r = platformDb.prepare('SELECT COALESCE(SUM(amount), 0) s FROM billing WHERE account_id = ?').get(accountId) as { s: number };
  // Charges are positive, payments negative — balance > 0 means the client owes money.
  return Math.round(r.s * 100) / 100;
}

/* ---------------------------------- accounts ---------------------------------- */

export interface AccountRow {
  id: number;
  name: string;
  nip: string;
  phone: string;
  plan: string;
  status: 'trial' | 'active' | 'suspended' | 'closed';
  trial_ends_at: string | null;
  paid_until: string | null;
  language: string;
  settings: string;
  stats: string;
  notes: string;
  last_activity_at: string | null;
  created_at: string;
}

export function getAccount(id: number): AccountRow {
  const a = platformDb.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
  if (!a) throw new HttpError(404, 'Account not found');
  return a;
}

export function createAccount(input: { company: string; name: string; email: string; password: string; language?: string; phone?: string }) {
  const email = input.email.trim().toLowerCase();
  if (platformDb.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'This e-mail is already registered');
  const lang = input.language ?? 'pl';
  const trialEnd = new Date(Date.now() + config.trialDays * 86400_000).toISOString().replace('T', ' ').slice(0, 19);
  const { accountId, userId } = platformDb.transaction(() => {
    const a = platformDb
      .prepare(`INSERT INTO accounts (name, phone, plan, status, trial_ends_at, language) VALUES (?, ?, 'trial', 'trial', ?, ?)`)
      .run(input.company.trim(), input.phone ?? '', trialEnd, lang);
    const accountId = Number(a.lastInsertRowid);
    const u = platformDb
      .prepare(`INSERT INTO users (account_id, email, name, password_hash, role, language) VALUES (?, ?, ?, ?, 'owner', ?)`)
      .run(accountId, email, input.name.trim(), bcrypt.hashSync(input.password, 10), lang);
    return { accountId, userId: Number(u.lastInsertRowid) };
  })();
  // Creates and seeds the tenant database.
  const tdb = tenantDb(accountId, lang);
  const row = tdb.prepare(`SELECT value FROM settings WHERE key = 'company'`).get() as { value: string } | undefined;
  tdb.prepare(`UPDATE settings SET value = ? WHERE key = 'company'`).run(JSON.stringify({ ...parseJson(row?.value, {}), name: input.company.trim(), email }));
  return { accountId, userId };
}

/** Permanently deletes an account and its data file. */
export function deleteAccount(accountId: number) {
  closeTenant(accountId);
  platformDb.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(tenantFile(accountId) + suffix);
    } catch {
      /* missing */
    }
  }
}

/** Trial expiry and similar status transitions; run daily. */
export function updateAccountStatuses() {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  platformDb.prepare(`UPDATE accounts SET status = 'suspended' WHERE status = 'trial' AND trial_ends_at IS NOT NULL AND trial_ends_at < ?`).run(now);
}

export function activeAccountIds(): number[] {
  return (platformDb.prepare(`SELECT id FROM accounts WHERE status IN ('trial','active')`).all() as { id: number }[]).map((r) => r.id);
}

/** Collects usage statistics of an account (stored for the admin panel). */
export function refreshAccountStats(accountId: number) {
  const d = tenantDb(accountId);
  const stats = d
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM orders WHERE deleted = 0) orders_total,
        (SELECT COUNT(*) FROM orders WHERE deleted = 0 AND date_add >= datetime('now','-30 days')) orders_30d,
        (SELECT COUNT(*) FROM orders WHERE deleted = 0 AND date_add >= datetime('now','start of month')) orders_month,
        (SELECT COUNT(*) FROM products) products,
        (SELECT COUNT(*) FROM integrations) integrations,
        (SELECT COUNT(*) FROM integrations WHERE last_error IS NOT NULL AND enabled = 1) integration_errors,
        (SELECT COUNT(*) FROM offers) offers,
        (SELECT ROUND(COALESCE(SUM(i.price * i.quantity), 0), 2) FROM order_items i JOIN orders o ON o.id = i.order_id
           WHERE o.deleted = 0 AND o.date_add >= datetime('now','-30 days')) gmv_30d`,
    )
    .get() as Record<string, number>;
  platformDb.prepare('UPDATE accounts SET stats = ? WHERE id = ?').run(JSON.stringify({ ...stats, updated_at: new Date().toISOString() }), accountId);
  return stats;
}

export function audit(staffId: number | null, accountId: number | null, action: string, details = '', ip = '') {
  platformDb.prepare('INSERT INTO audit_log (staff_id, account_id, action, details, ip) VALUES (?, ?, ?, ?, ?)').run(staffId, accountId, action, details.slice(0, 2000), ip);
}

/* ------------------------------- platform e-mail ------------------------------- */

export async function platformMail(to: string, subject: string, text: string) {
  if (!config.smtp.host) {
    console.log(`[mail] SMTP not configured. To: ${to} | ${subject}\n${text}`);
    return false;
  }
  try {
    const t = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
    });
    await t.sendMail({ from: config.smtp.from || config.smtp.user, to, subject, text });
    return true;
  } catch (e) {
    console.error('[mail] failed', e);
    return false;
  }
}

/** Creates the bootstrap super-administrator from ADMIN_EMAIL / ADMIN_PASSWORD. */
export function ensureBootstrapAdmin() {
  if (!config.adminEmail || !config.adminPassword) return;
  const email = config.adminEmail.toLowerCase();
  if (platformDb.prepare('SELECT 1 FROM staff WHERE email = ?').get(email)) return;
  platformDb
    .prepare(`INSERT INTO staff (email, name, password_hash, role) VALUES (?, ?, ?, 'superadmin')`)
    .run(email, 'Administrator', bcrypt.hashSync(config.adminPassword, 10));
  console.log(`[platform] super-administrator ${email} created`);
}
