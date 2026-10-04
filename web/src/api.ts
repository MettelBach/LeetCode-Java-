/*
 * API clients. Three kinds of tokens:
 *  - client user token (localStorage)
 *  - support impersonation token (sessionStorage — only in the tab opened from the admin panel)
 *  - staff token for the admin panel (localStorage, separate key)
 */
const TOKEN_KEY = 'sellhub_token';
const IMP_KEY = 'sellhub_imp_token';
const STAFF_KEY = 'sellhub_staff_token';

function storageGet(s: Storage | undefined, k: string): string | null {
  try {
    return s?.getItem(k) ?? null;
  } catch {
    return null;
  }
}
function storageSet(s: Storage | undefined, k: string, v: string | null) {
  try {
    if (v) s?.setItem(k, v);
    else s?.removeItem(k);
  } catch {
    /* storage unavailable */
  }
}

export function getToken(): string | null {
  return storageGet(window.sessionStorage, IMP_KEY) ?? storageGet(window.localStorage, TOKEN_KEY);
}
export function setToken(token: string | null) {
  storageSet(window.localStorage, TOKEN_KEY, token);
}
export function isImpersonating() {
  return !!storageGet(window.sessionStorage, IMP_KEY);
}
export function setImpersonationToken(token: string | null) {
  storageSet(window.sessionStorage, IMP_KEY, token);
}
export function getStaffToken() {
  return storageGet(window.localStorage, STAFF_KEY);
}
export function setStaffToken(token: string | null) {
  storageSet(window.localStorage, STAFF_KEY, token);
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

function createClient(prefix: string, token: () => string | null, onUnauthorized: () => void) {
  async function raw(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {};
    const tk = token();
    if (tk) headers.Authorization = `Bearer ${tk}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${prefix}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    if (res.status === 401 && !/\/(login|register|forgot|reset)$/.test(path)) onUnauthorized();
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
  return {
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
}

let onUserUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUserUnauthorized = fn;
}

export const api = createClient('/api', getToken, () => {
  if (isImpersonating()) setImpersonationToken(null);
  else setToken(null);
  onUserUnauthorized?.();
});

let onStaffUnauthorized: (() => void) | null = null;
export function setStaffUnauthorizedHandler(fn: () => void) {
  onStaffUnauthorized = fn;
}

export const adminApi = createClient('/api/admin', getStaffToken, () => {
  setStaffToken(null);
  onStaffUnauthorized?.();
});
