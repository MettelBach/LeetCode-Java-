import Database from 'better-sqlite3';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { platformMigrations } from './platform-schema.js';
import { migrations } from './schema.js';
import { seedDefaults } from './seed.js';

export type DB = Database.Database;

/*
 * Multi-tenancy: every client account has its own SQLite database file
 * (data/tenants/<id>.db). Platform data (accounts, users, support tickets,
 * billing) lives in data/platform.db.
 *
 * `db` is a proxy resolving to the database of the tenant of the current
 * request or background job (AsyncLocalStorage), so services use it as a
 * normal better-sqlite3 handle.
 */

interface TenantCtx {
  accountId: number;
  db: DB;
}

const als = new AsyncLocalStorage<TenantCtx>();
const cache = new Map<number, DB>();
let dataDir = '';
export let platformDb: DB;

function current(): DB {
  const c = als.getStore();
  if (!c) throw new Error('No tenant context');
  return c.db;
}

export const db: DB = new Proxy({} as DB, {
  get(_t, prop) {
    const d = current();
    const v = (d as any)[prop];
    return typeof v === 'function' ? v.bind(d) : v;
  },
});

function open(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new Database(file);
  d.pragma('journal_mode = WAL');
  d.pragma('foreign_keys = ON');
  d.pragma('busy_timeout = 5000');
  return d;
}

function migrate(d: DB, list: string[], onFirst?: (d: DB) => void) {
  d.exec(`CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const done = new Set(d.prepare('SELECT id FROM migrations').all().map((r: any) => r.id as number));
  list.forEach((sql, i) => {
    if (done.has(i)) return;
    d.transaction(() => {
      d.exec(sql);
      d.prepare('INSERT INTO migrations (id) VALUES (?)').run(i);
      if (i === 0) onFirst?.(d);
    })();
  });
}

export function initPlatform(dir: string): DB {
  dataDir = dir;
  for (const d of cache.values()) d.close();
  cache.clear();
  platformDb = open(path.join(dir, 'platform.db'));
  migrate(platformDb, platformMigrations, (d) => {
    // Account numbers and order numbers look like BaseLinker ones.
    d.prepare(`INSERT INTO sqlite_sequence (name, seq) VALUES ('accounts', 1000)`).run();
  });
  return platformDb;
}

export function tenantFile(accountId: number) {
  return path.join(dataDir, 'tenants', `${accountId}.db`);
}

/** Opens (and migrates on first use) the database of an account. */
export function tenantDb(accountId: number, lang = 'pl'): DB {
  let d = cache.get(accountId);
  if (d) return d;
  if (!Number.isInteger(accountId) || accountId <= 0) throw new Error('Invalid account');
  d = open(tenantFile(accountId));
  migrate(d, migrations, (x) => {
    x.prepare(`INSERT INTO sqlite_sequence (name, seq) VALUES ('orders', 10000000)`).run();
  });
  seedDefaults(d, lang);
  cache.set(accountId, d);
  // Keep the number of open files bounded.
  if (cache.size > 200) {
    const [oldId, oldDb] = cache.entries().next().value as [number, DB];
    if (oldId !== accountId) {
      oldDb.close();
      cache.delete(oldId);
    }
  }
  return d;
}

export function runWithTenant<T>(accountId: number, fn: () => T, lang?: string): T {
  return als.run({ accountId, db: tenantDb(accountId, lang) }, fn);
}

export function currentAccountId(): number {
  const c = als.getStore();
  if (!c) throw new Error('No tenant context');
  return c.accountId;
}

export function hasTenant(): boolean {
  return !!als.getStore();
}

export function closeTenant(accountId: number) {
  const d = cache.get(accountId);
  if (d) {
    d.close();
    cache.delete(accountId);
  }
}

/** Run fn inside a transaction (nested calls reuse the outer one). */
export function tx<T>(fn: () => T): T {
  if (db.inTransaction) return fn();
  return db.transaction(fn)();
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  );
}

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
