export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  retries?: number;
}

/** fetch wrapper: timeout, retry on 429/5xx, JSON parsing and readable errors. */
export async function request<T = any>(url: string, opts: RequestOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: opts.headers,
        body: opts.body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30000),
      });
      const text = await res.text();
      let data: any = text;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        /* not JSON */
      }
      if (res.ok) return data as T;
      const msg = extractMessage(data) ?? `HTTP ${res.status}`;
      const err = new ApiError(res.status, msg, data);
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        lastErr = err;
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      throw err;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      lastErr = e;
      if (attempt < retries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function extractMessage(data: any): string | undefined {
  if (!data || typeof data !== 'object') return typeof data === 'string' && data.length < 300 ? data : undefined;
  if (Array.isArray(data.errors) && data.errors.length) {
    return data.errors.map((e: any) => e.userMessage || e.message || e.code).join('; ');
  }
  return data.message || data.error_description || data.error || undefined;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Splits a "Street 12/3" style address line into street and house number. */
export function joinAddress(...parts: (string | undefined | null)[]) {
  return parts.filter((p) => p && String(p).trim()).join(' ').trim();
}
