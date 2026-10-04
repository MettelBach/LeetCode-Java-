/** Server stores UTC as "YYYY-MM-DD HH:MM:SS". */
export function parseDate(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + (s.length > 10 ? 'Z' : ''));
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function fmtDateTime(s?: string | null): string {
  const d = parseDate(s);
  if (!d) return '—';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDate(s?: string | null): string {
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}.${m}.${y}`;
  }
  const d = parseDate(s);
  if (!d) return '—';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

const CUR: Record<string, string> = { PLN: 'zł', EUR: '€', USD: '$', CZK: 'Kč', GBP: '£' };

export function money(n: number | null | undefined, currency = 'PLN'): string {
  const v = Number(n ?? 0);
  const s = v.toFixed(2);
  const sym = CUR[currency];
  if (currency === 'PLN' || currency === 'CZK') return `${s} ${sym}`;
  return sym ? `${s} ${sym}` : `${s} ${currency}`;
}

export function moneyPlain(n: number | null | undefined, currency = 'PLN'): string {
  return `${Number(n ?? 0).toFixed(2)} ${currency}`;
}

export function todayIso(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400_000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const COUNTRIES: Record<string, string> = {
  PL: 'Polska',
  DE: 'Deutschland',
  CZ: 'Česko',
  SK: 'Slovensko',
  LT: 'Lietuva',
  LV: 'Latvija',
  EE: 'Eesti',
  AT: 'Österreich',
  FR: 'France',
  IT: 'Italia',
  ES: 'España',
  NL: 'Nederland',
  BE: 'Belgique',
  HU: 'Magyarország',
  RO: 'România',
  UA: 'Україна',
  GB: 'United Kingdom',
  US: 'United States',
};

export function flag(cc?: string): string {
  if (!cc || cc.length !== 2) return '';
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
