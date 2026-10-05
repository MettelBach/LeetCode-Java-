import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Development fallback for JWT_SECRET / SECRETS_KEY: a random value generated
 * once and kept in <DATA_DIR>/.local-secrets.json (never a hardcoded string,
 * so tokens cannot be forged on a server started without configuration).
 * Production refuses to start without the environment variables (index.ts).
 */
export function localSecret(name: 'jwt' | 'secrets'): string {
  const file = path.join(config.dataDir, '.local-secrets.json');
  let all: Record<string, string> = {};
  try {
    all = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* first start */
  }
  if (!all[name]) {
    all[name] = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(all), { mode: 0o600 });
  }
  return all[name];
}

let jwtFallback: string | null = null;

export const config = {
  /** Product name used in e-mails (the web app reads web/src/brand.ts). */
  brandName: process.env.BRAND_NAME ?? 'SellHub',
  port: Number(process.env.PORT ?? 3001),
  /** Public URL of the app — used in links (order page, OAuth redirect). */
  appUrl: process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3001}`,
  dataDir: process.env.DATA_DIR ?? path.resolve(here, '../../data'),
  get jwtSecret(): string {
    return process.env.JWT_SECRET || (jwtFallback ??= localSecret('jwt'));
  },
  /** Directory with the built frontend, served in production. */
  webDist: process.env.WEB_DIST ?? path.resolve(here, '../../web/dist'),
  /** Disable background synchronization (tests). */
  disableScheduler: process.env.DISABLE_SCHEDULER === '1',
  /** Bootstrap super-administrator of the support panel (created on first start). */
  adminEmail: process.env.ADMIN_EMAIL ?? '',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  /** Platform e-mail (password reset, ticket notifications). */
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === '1',
    user: process.env.SMTP_USER ?? '',
    password: process.env.SMTP_PASSWORD ?? '',
    from: process.env.SMTP_FROM ?? '',
  },
  trialDays: Number(process.env.TRIAL_DAYS ?? 14),
  /** Allow public sign-up of new accounts. */
  allowSignup: process.env.ALLOW_SIGNUP !== '0',
  /** Check new passwords against known data breaches (Have I Been Pwned, k-anonymity). */
  breachCheck: process.env.PASSWORD_BREACH_CHECK !== '0',
};
