import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT ?? 3001),
  /** Public URL of the app — used in links (order page, OAuth redirect). */
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',
  dbFile: process.env.DB_FILE ?? path.resolve(here, '../../data/sellhub.db'),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  /** Directory with the built frontend, served in production. */
  webDist: process.env.WEB_DIST ?? path.resolve(here, '../../web/dist'),
  /** Cron expression for marketplace synchronization. */
  syncCron: process.env.SYNC_CRON ?? '*/5 * * * *',
  disableScheduler: process.env.DISABLE_SCHEDULER === '1',
};
