/**
 * Consistent online backups of all databases (SQLite backup API, safe while
 * the app is running): BACKUP_DIR/<YYYY-MM-DD_HHMM>/platform.db + tenants/<id>.db.
 * Old backups are removed after BACKUP_KEEP_DAYS (default 7).
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const DIR_RE = /^\d{4}-\d{2}-\d{2}_\d{4}$/;

async function copyDb(src: string, dest: string) {
  const d = new Database(src, { readonly: true, fileMustExist: true });
  try {
    await d.backup(dest);
  } finally {
    d.close();
  }
}

export async function backupAll(targetRoot = process.env.BACKUP_DIR ?? '', dataDir = config.dataDir, now = new Date()) {
  if (!targetRoot) throw new Error('BACKUP_DIR is not set');
  const stamp = now.toISOString().slice(0, 16).replace('T', '_').replace(':', '');
  const target = path.join(targetRoot, stamp);
  fs.mkdirSync(path.join(target, 'tenants'), { recursive: true });
  await copyDb(path.join(dataDir, 'platform.db'), path.join(target, 'platform.db'));
  const tenantsDir = path.join(dataDir, 'tenants');
  let tenants = 0;
  for (const f of fs.existsSync(tenantsDir) ? fs.readdirSync(tenantsDir) : []) {
    if (!/^\d+\.db$/.test(f)) continue;
    await copyDb(path.join(tenantsDir, f), path.join(target, 'tenants', f));
    tenants++;
  }
  pruneBackups(targetRoot, Number(process.env.BACKUP_KEEP_DAYS ?? 7), now);
  return { dir: target, tenants };
}

export function pruneBackups(root: string, keepDays: number, now = new Date()) {
  const limit = now.getTime() - Math.max(1, keepDays) * 86400_000;
  for (const name of fs.readdirSync(root)) {
    if (!DIR_RE.test(name)) continue;
    const t = Date.parse(`${name.slice(0, 10)}T${name.slice(11, 13)}:${name.slice(13, 15)}:00Z`);
    if (Number.isFinite(t) && t < limit) fs.rmSync(path.join(root, name), { recursive: true, force: true });
  }
}
