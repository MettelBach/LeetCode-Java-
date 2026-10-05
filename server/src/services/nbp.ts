/**
 * NBP average exchange rates (table A). A VAT invoice in a foreign currency shows
 * the tax in PLN converted at the rate of the last working day before the sale
 * date (art. 31a of the Polish VAT act).
 */
import { addDays } from '../lib/dates.js';

export interface NbpRate {
  rate: number;
  date: string;
  table: string;
}

const cache = new Map<string, NbpRate>();

export async function nbpRateBefore(currency: string, date: string, fetchImpl: typeof fetch = fetch): Promise<NbpRate> {
  const code = currency.toUpperCase();
  const key = `${code}:${date}`;
  const hit = cache.get(key);
  if (hit) return hit;
  // Ten days back covers long weekends and holidays.
  const url = `https://api.nbp.pl/api/exchangerates/rates/a/${encodeURIComponent(code.toLowerCase())}/${addDays(date, -10)}/${addDays(date, -1)}/?format=json`;
  const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`NBP: no ${code} rate before ${date} (HTTP ${res.status})`);
  const data = (await res.json()) as { rates?: { no: string; effectiveDate: string; mid: number }[] };
  const last = data.rates?.filter((r) => r.effectiveDate < date).at(-1);
  if (!last) throw new Error(`NBP: no ${code} rate before ${date}`);
  const out = { rate: last.mid, date: last.effectiveDate, table: last.no };
  cache.set(key, out);
  return out;
}
