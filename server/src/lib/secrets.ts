import crypto from 'node:crypto';
import { config, localSecret } from '../config.js';

/**
 * Encryption of marketplace credentials, OAuth tokens and 2FA secrets
 * (AES-256-GCM). The key comes from SECRETS_KEY (required in production, never
 * change it); in development a random local key is generated.
 */
const PREFIX = 'enc:v1:';

let cachedKey: Buffer | null = null;
function key() {
  if (!cachedKey) cachedKey = crypto.createHash('sha256').update(process.env.SECRETS_KEY || localSecret('secrets')).digest();
  return cachedKey;
}

/** Key used by early versions (derived from JWT_SECRET) — still accepted for reading. */
const legacyKey = () => crypto.createHash('sha256').update(`${config.jwtSecret}:integration-secrets`).digest();

function decrypt(k: Buffer, iv: Buffer, tag: Buffer, data: Buffer) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
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
  const [iv, tag, data] = stored.slice(PREFIX.length).split(':').map((p) => Buffer.from(p, 'base64'));
  for (const k of [key(), legacyKey()]) {
    try {
      return JSON.parse(decrypt(k, iv, tag, data)) as T;
    } catch {
      /* try the next key */
    }
  }
  console.error('[secrets] cannot decrypt a stored secret — was SECRETS_KEY changed?');
  return fallback;
}
