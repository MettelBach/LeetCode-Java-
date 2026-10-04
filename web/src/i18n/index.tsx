import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { pl } from './pl';
import { ru } from './ru';

/**
 * UI strings are written in English in the source code; `pl` and `ru` map the
 * English text to translations. Missing translations fall back to English.
 * `npm run i18n:check` lists strings without translation.
 */
export type Lang = 'pl' | 'en' | 'ru';
const DICTS: Record<Lang, Record<string, string>> = { pl, ru, en: {} };

const STORAGE_KEY = 'sellhub_lang';

function initialLang(): Lang {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s === 'pl' || s === 'en' || s === 'ru') return s;
  } catch {
    /* ignore */
  }
  const nav = navigator.language.slice(0, 2);
  if (nav === 'ru' || nav === 'uk' || nav === 'be') return 'ru';
  if (nav === 'en') return 'en';
  return 'pl';
}

export type TFn = (text: string, vars?: Record<string, string | number>) => string;

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFn;
}

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = l;
  }, []);
  const t = useCallback<TFn>(
    (text, vars) => {
      let s = DICTS[lang][text] ?? text;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
      return s;
    },
    [lang],
  );
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const c = useContext(I18nContext);
  if (!c) throw new Error('I18nProvider missing');
  return c;
}

export function useT() {
  return useI18n().t;
}
