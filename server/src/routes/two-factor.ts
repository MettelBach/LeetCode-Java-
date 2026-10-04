/**
 * Two-factor authentication (TOTP) shared by client users and support staff.
 * The secret is stored encrypted; enabling requires a valid code first.
 */
import bcrypt from 'bcryptjs';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { platformDb } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { openJson, sealJson } from '../lib/secrets.js';
import { newTotpSecret, otpauthUrl, verifyTotp } from '../lib/totp.js';

type Table = 'users' | 'staff';

interface Row {
  id: number;
  email: string;
  password_hash: string;
  totp_secret: string | null;
  totp_enabled: number;
  totp_last_step: number;
}

const load = (table: Table, id: number) =>
  platformDb.prepare(`SELECT id, email, password_hash, totp_secret, totp_enabled, totp_last_step FROM ${table} WHERE id = ?`).get(id) as Row | undefined;

const secretOf = (r: Row) => openJson<{ s?: string }>(r.totp_secret, {}).s ?? '';

/** Verifies a code for a user with 2FA enabled and consumes it (a code works once). */
export function checkSecondFactor(table: Table, id: number, code: string): boolean {
  const r = load(table, id);
  if (!r?.totp_enabled) return true;
  const step = verifyTotp(secretOf(r), code, r.totp_last_step);
  if (step === null) return false;
  platformDb.prepare(`UPDATE ${table} SET totp_last_step = ? WHERE id = ?`).run(step, id);
  return true;
}

export function resetSecondFactor(table: Table, id: number) {
  platformDb.prepare(`UPDATE ${table} SET totp_secret = NULL, totp_enabled = 0, totp_last_step = 0 WHERE id = ?`).run(id);
}

export function twoFactorRouter(table: Table, who: (req: Request) => number | undefined) {
  const r = Router();
  const me = (req: Request) => {
    if (table === 'users' && req.impersonator) throw new HttpError(403, 'Support cannot change two-factor authentication of the client');
    const row = load(table, who(req) ?? 0);
    if (!row) throw new HttpError(401, 'Not authenticated');
    return row;
  };

  r.get('/', (req, res) => {
    const row = load(table, who(req) ?? 0);
    res.json({ enabled: !!row?.totp_enabled });
  });

  r.post('/setup', (req, res) => {
    const row = me(req);
    if (row.totp_enabled) throw new HttpError(400, 'Two-factor authentication is already enabled');
    const secret = newTotpSecret();
    platformDb.prepare(`UPDATE ${table} SET totp_secret = ?, totp_last_step = 0 WHERE id = ?`).run(sealJson({ s: secret }), row.id);
    res.json({ secret, otpauth: otpauthUrl(secret, row.email, config.brandName) });
  });

  r.post('/enable', (req, res) => {
    const row = me(req);
    const b = z.object({ code: z.string().max(10) }).parse(req.body);
    const secret = secretOf(row);
    if (!secret) throw new HttpError(400, 'Start the setup first');
    const step = verifyTotp(secret, b.code, row.totp_last_step);
    if (step === null) throw new HttpError(400, 'Invalid two-factor code');
    platformDb.prepare(`UPDATE ${table} SET totp_enabled = 1, totp_last_step = ? WHERE id = ?`).run(step, row.id);
    res.json({ enabled: true });
  });

  r.post('/disable', (req, res) => {
    const row = me(req);
    const b = z.object({ password: z.string().max(200), code: z.string().max(10) }).parse(req.body);
    if (!bcrypt.compareSync(b.password, row.password_hash)) throw new HttpError(400, 'Current password is incorrect');
    if (!checkSecondFactor(table, row.id, b.code)) throw new HttpError(400, 'Invalid two-factor code');
    resetSecondFactor(table, row.id);
    res.json({ enabled: false });
  });

  return r;
}
