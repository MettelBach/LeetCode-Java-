/**
 * Business dates are Polish dates: documents issued at 00:30 in Warsaw carry
 * that day, not the previous UTC day.
 */
const TZ = 'Europe/Warsaw';

/** Today's date in Warsaw as YYYY-MM-DD. */
export function warsawToday(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Current Warsaw time as "YYYY-MM-DD HH:MM:SS". */
export function warsawNow(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .format(now)
    .replace('T', ' ');
}

/** A real calendar date "YYYY-MM-DD" (2026-02-30 and 2099-99-99 are not). */
export function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && d.getUTCFullYear() >= 2000 && d.getUTCFullYear() <= 2100;
}

/** A real date with optional time: "YYYY-MM-DD", "YYYY-MM-DD HH:MM" or "YYYY-MM-DD HH:MM:SS". */
export function isValidDateTime(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = /^(\d{4}-\d{2}-\d{2})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!m || !isValidDate(m[1])) return false;
  return m[2] === undefined || (Number(m[2]) < 24 && Number(m[3]) < 60 && Number(m[4] ?? 0) < 60);
}

/** Adds days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
