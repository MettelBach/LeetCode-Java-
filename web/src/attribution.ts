/**
 * Remembers where a visitor came from (UTM tags, Google/Meta click IDs) until
 * sign-up, so paid campaigns can be measured by paying customers, not clicks.
 * Kept in sessionStorage only; Meta cookies are read only if the site's own
 * consent banner allowed the pixel to set them.
 */
const KEY = 'sellhub_attribution';
const PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid', 'fbclid'];

type Attribution = Record<string, string>;

function load(): Attribution {
  try {
    return JSON.parse(window.sessionStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

export function captureAttribution() {
  try {
    const url = new URL(window.location.href);
    const cur = load();
    const fresh: Attribution = {};
    for (const p of PARAMS) {
      const v = url.searchParams.get(p);
      if (v) fresh[p] = v.slice(0, 500);
    }
    // A new campaign click replaces the previous campaign data (last paid click).
    const next: Attribution = Object.keys(fresh).length ? { ...Object.fromEntries(Object.entries(cur).filter(([k]) => !PARAMS.includes(k))), ...fresh } : cur;
    if (!next.first_seen) {
      next.first_seen = new Date().toISOString();
      next.landing = url.pathname;
      if (document.referrer && !document.referrer.startsWith(window.location.origin)) next.referrer = document.referrer.slice(0, 500);
    }
    window.sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}

function cookie(name: string) {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}

export function getAttribution(): Attribution {
  const out = load();
  const fbp = cookie('_fbp');
  const fbc = cookie('_fbc') ?? (out.fbclid ? `fb.1.${Date.parse(out.first_seen ?? '') || Date.now()}.${out.fbclid}` : undefined);
  if (fbp) out.fbp = fbp;
  if (fbc) out.fbc = fbc;
  return out;
}
