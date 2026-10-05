/**
 * Password policy: minimum length, no very common passwords, nothing built
 * from the e-mail / name, and (optionally) not present in known data breaches.
 * The breach check uses the Have I Been Pwned range API with k-anonymity: only
 * the first 5 characters of the SHA-1 hash leave the server. If the service
 * cannot be reached, the check is skipped (the account is not blocked).
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from './http.js';

const COMMON = new Set(
  `123456 1234567 12345678 123456789 1234567890 12345678910 0123456789 987654321 qwerty qwerty123 qwertyuiop qwerty12345
  password password1 password12 password123 password1234 passw0rd p@ssw0rd p@ssword haslo haslo123 haslo1234 maslo123 zaq12wsx
  zaq1@wsx 1qaz2wsx 1q2w3e4r 1q2w3e4r5t 1q2w3e 1qazxsw2 qazwsx qazwsx123 abc12345 abcd1234 abcdefgh aaaaaaaa 11111111 00000000
  12341234 11223344 iloveyou iloveyou1 sunshine princess football baseball welcome welcome1 welcome123 admin123 administrator
  admin1234 letmein letmein1 monkey123 dragon123 master123 superman batman123 trustno1 starwars computer internet polska polska123
  kochamcie kochamcie1 marcin123 mateusz1 bartek123 agnieszka123 zxcvbnm zxcvbnm1 asdfghjkl asdfgh123 changeme changeme1
  sellhub sellhub1 sellhub123 allegro allegro1 allegro123 sklep123 sklep1234 sklepinternetowy test1234 test12345 testtest
  demo1234 demo12345 secret123 haslo12345 qwe12345 qweasdzxc 123qweasd 123qwe123 q1w2e3r4 1234qwer 4321qwer 87654321 123123123`
    .split(/\s+/)
    .filter(Boolean),
);

export function weakPasswordReason(password: string, context: { email?: string; name?: string; company?: string } = {}): string | null {
  const p = password.toLowerCase();
  if (password.length < 8) return 'Password must have at least 8 characters';
  if (COMMON.has(p) || new Set(p).size < 4) return 'This password is too common — choose a less obvious one';
  const parts = [context.email?.split('@')[0], context.name, context.company].map((x) => (x ?? '').toLowerCase().replace(/\s+/g, '')).filter((x) => x.length >= 4);
  if (parts.some((x) => p.replace(/[^a-z0-9ąćęłńóśźż]/g, '').includes(x))) return 'The password must not contain your e-mail, name or company name';
  return null;
}

/** Number of times the password appears in known breaches (0 = not found or check unavailable). */
export async function breachCount(password: string): Promise<number> {
  if (!config.breachCheck) return 0;
  const hash = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': `${config.brandName}-password-check` },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return 0;
    const suffix = hash.slice(5);
    for (const line of (await res.text()).split('\n')) {
      const [h, n] = line.trim().split(':');
      if (h === suffix) return Number(n) || 0;
    }
  } catch {
    /* offline — do not block the user */
  }
  return 0;
}

/** Throws 400 when the password is weak or known from data breaches. */
export async function assertGoodPassword(password: string, context: { email?: string; name?: string; company?: string } = {}) {
  const reason = weakPasswordReason(password, context);
  if (reason) throw new HttpError(400, reason);
  if ((await breachCount(password)) > 0) throw new HttpError(400, 'This password appeared in a data breach — choose a different one');
}
