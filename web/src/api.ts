const TOKEN_KEY = 'sellhub_token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  status: number;
  details?: { path: string; message: string }[];
  constructor(status: number, message: string, details?: { path: string; message: string }[]) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

type Query = Record<string, string | number | boolean | undefined | null | (string | number)[]>;

export function qs(query?: Query): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) p.set(k, v.join(','));
    } else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function raw(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (res.status === 401 && !path.startsWith('/auth/')) {
    setToken(null);
    onUnauthorized?.();
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    let details;
    try {
      const j = await res.json();
      msg = j.error ?? msg;
      details = j.details;
      if (details?.length) msg += ': ' + details.map((d: any) => `${d.path} — ${d.message}`).join('; ');
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, msg, details);
  }
  return res;
}

export const api = {
  async get<T = any>(path: string, query?: Query): Promise<T> {
    return (await raw('GET', path + qs(query))).json();
  },
  async post<T = any>(path: string, body: unknown = {}): Promise<T> {
    return (await raw('POST', path, body)).json();
  },
  async put<T = any>(path: string, body: unknown = {}): Promise<T> {
    return (await raw('PUT', path, body)).json();
  },
  async patch<T = any>(path: string, body: unknown = {}): Promise<T> {
    return (await raw('PATCH', path, body)).json();
  },
  async del<T = any>(path: string, body?: unknown): Promise<T> {
    return (await raw('DELETE', path, body)).json();
  },
  /** Opens a PDF (fetched with auth) in a new tab. */
  async openPdf(path: string, query?: Query) {
    const win = window.open('', '_blank');
    try {
      const res = await raw('GET', path + qs(query));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url;
      else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      win?.close();
      throw e;
    }
  },
  async download(path: string, filename: string, query?: Query) {
    const res = await raw('GET', path + qs(query));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};
