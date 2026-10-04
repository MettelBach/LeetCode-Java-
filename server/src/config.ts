import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT ?? 3001),
  /** Public URL of the app — used in links (order page, OAuth redirect). */
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',
  dataDir: process.env.DATA_DIR ?? path.resolve(here, '../../data'),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
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
};
