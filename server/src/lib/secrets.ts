import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Encryption of marketplace credentials and OAuth tokens stored in client
 * databases (AES-256-GCM). The key comes from SECRETS_KEY; without it, it is
 * derived from JWT_SECRET — then changing JWT_SECRET makes stored credentials
 * unreadable, so set SECRETS_KEY in production and never change it.
 */
const PREFIX = 'enc:v1:';

let cachedKey: Buffer | null = null;
function key() {
  if (!cachedKey) cachedKey = crypto.createHash('sha256').update(process.env.SECRETS_KEY || `${config.jwtSecret}:integration-secrets`).digest();
  return cachedKey;
}

export function sealJson(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value ?? {}), 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

/** Reads a sealed value; plain JSON (data from before encryption) is accepted too. */
export function openJson<T>(stored: string | null | undefined, fallback: T): T {
  if (!stored) return fallback;
  if (!stored.startsWith(PREFIX)) {
    try {
      return JSON.parse(stored) as T;
    } catch {
      return fallback;
    }
  }
  try {
    const [iv, tag, data] = stored.slice(PREFIX.length).split(':').map((p) => Buffer.from(p, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')) as T;
  } catch {
    console.error('[secrets] cannot decrypt a stored secret — was SECRETS_KEY / JWT_SECRET changed?');
    return fallback;
  }
}
