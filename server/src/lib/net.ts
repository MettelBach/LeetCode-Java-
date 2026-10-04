import dns from 'node:dns/promises';
import net from 'node:net';

/** True for loopback, private, link-local and other non-public addresses. */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

/**
 * Validates a user-provided outbound URL (webhooks): HTTPS only and the host
 * must resolve to public addresses, so rules cannot reach internal services.
 */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('invalid URL');
  }
  if (url.protocol !== 'https:') throw new Error('only https:// URLs are allowed');
  if (url.username || url.password) throw new Error('credentials in URL are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!addrs.length || addrs.some(isPrivateIp)) throw new Error('the address points to a private network');
  return url;
}

/** Resolves a host name and rejects private/internal addresses (tenant SMTP servers). */
export async function assertPublicHost(host: string): Promise<void> {
  const h = host.trim().replace(/^\[|\]$/g, '');
  if (!h) throw new Error('host is empty');
  const addrs = net.isIP(h) ? [h] : (await dns.lookup(h, { all: true })).map((a) => a.address);
  if (!addrs.length || addrs.some(isPrivateIp)) throw new Error('the address points to a private network');
}

/** Ports a tenant-defined SMTP server may use. */
export const SMTP_PORTS = [25, 465, 587, 2525];
