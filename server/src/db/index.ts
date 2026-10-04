import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { migrations } from './schema.js';
import { seedDefaults } from './seed.js';

export type DB = Database.Database;

// Live binding: modules importing `db` see the instance created by initDb().
export let db: DB;

export function initDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  seedDefaults(db);
  return db;
}

function migrate(d: DB) {
  d.exec(`CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const done = new Set(d.prepare('SELECT id FROM migrations').all().map((r: any) => r.id as number));
  migrations.forEach((sql, i) => {
    if (done.has(i)) return;
    d.transaction(() => {
      d.exec(sql);
      d.prepare('INSERT INTO migrations (id) VALUES (?)').run(i);
      if (i === 0) {
        // Order numbers look like the ones in BaseLinker (8 digits).
        d.prepare(`INSERT INTO sqlite_sequence (name, seq) VALUES ('orders', 10000000)`).run();
      }
    })();
  });
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
