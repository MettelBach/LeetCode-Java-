import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { api } from '../../api';

export interface Warehouse {
  id: number;
  name: string;
  code: string;
  description: string;
  is_default: number;
  allow_negative: number;
  units: number;
  reserved: number;
  products: number;
  value: number;
  catalogs: string | null;
}

export interface Catalog {
  id: number;
  name: string;
  description: string;
  is_default: number;
  languages: string[];
  default_language: string;
  price_group_ids: number[];
  default_price_group_id: number | null;
  warehouse_ids: number[];
  default_warehouse_id: number | null;
  integrations: { id: number; name: string; type: string }[];
  products: number;
  items: number;
}

export interface PriceGroup {
  id: number;
  name: string;
  description: string;
  currency: string;
  is_default: number;
  prices: number;
  catalogs: string | null;
}

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
  catalog_id: number | null;
  sort: number;
  product_count: number;
  total_count: number;
}

export interface Tag {
  id: number;
  name: string;
  color: string;
  products: number;
}

export interface ExtraField {
  id: number;
  name: string;
  kind: 'text' | 'number' | 'select' | 'checkbox' | 'date' | 'textarea';
  options: string[];
  sort: number;
}

export const LANGUAGE_NAMES: Record<string, string> = {
  pl: 'Polski',
  en: 'English',
  de: 'Deutsch',
  cs: 'Čeština',
  sk: 'Slovenčina',
  uk: 'Українська',
  ru: 'Русский',
  fr: 'Français',
  it: 'Italiano',
  es: 'Español',
  lt: 'Lietuvių',
  hu: 'Magyar',
  ro: 'Română',
};

export const useWarehouses = () => useQuery({ queryKey: ['warehouses'], queryFn: () => api.get<Warehouse[]>('/warehouses'), staleTime: 30_000 });
export const useCatalogs = () => useQuery({ queryKey: ['catalogs'], queryFn: () => api.get<Catalog[]>('/catalogs'), staleTime: 30_000 });
export const usePriceGroups = () => useQuery({ queryKey: ['price-groups'], queryFn: () => api.get<PriceGroup[]>('/price-groups'), staleTime: 30_000 });
export const useTags = () => useQuery({ queryKey: ['tags'], queryFn: () => api.get<Tag[]>('/tags'), staleTime: 30_000 });
export const useExtraFields = () => useQuery({ queryKey: ['extra-fields'], queryFn: () => api.get<ExtraField[]>('/extra-fields'), staleTime: 30_000 });
export const useManufacturers = () => useQuery({ queryKey: ['manufacturers'], queryFn: () => api.get<any[]>('/products/meta/manufacturers'), staleTime: 30_000 });
export const useCategories = (catalogId?: number | null) =>
  useQuery({
    queryKey: ['categories', catalogId ?? null],
    queryFn: () => api.get<Category[]>('/products/meta/categories', catalogId ? { catalog_id: catalogId } : undefined),
    staleTime: 30_000,
  });

const CATALOG_KEY = 'sellhub_catalog';

/** Catalog the user works in (remembered per browser, like in BaseLinker). */
export function useCurrentCatalog(): [Catalog | undefined, (id: number) => void, Catalog[]] {
  const catalogs = useCatalogs();
  const [stored, setStored] = useState<number | null>(() => {
    try {
      return Number(localStorage.getItem(CATALOG_KEY)) || null;
    } catch {
      return null;
    }
  });
  const list = catalogs.data ?? [];
  const current = list.find((c) => c.id === stored) ?? list.find((c) => c.is_default) ?? list[0];
  const select = useCallback((id: number) => {
    setStored(id);
    try {
      localStorage.setItem(CATALOG_KEY, String(id));
    } catch {
      /* ignore */
    }
  }, []);
  return [current, select, list];
}

/** Categories as an indented list (for selects) — depth-first, siblings sorted. */
export function categoryOptions(rows: Category[]): { id: number; label: string; depth: number; path: string }[] {
  const byParent = new Map<number | null, Category[]>();
  for (const r of rows) byParent.set(r.parent_id, [...(byParent.get(r.parent_id) ?? []), r]);
  const out: { id: number; label: string; depth: number; path: string }[] = [];
  const walk = (parent: number | null, depth: number, path: string) => {
    for (const c of byParent.get(parent) ?? []) {
      const p = path ? `${path} › ${c.name}` : c.name;
      out.push({ id: c.id, label: `${'   '.repeat(depth)}${c.name}`, depth, path: p });
      walk(c.id, depth + 1, p);
    }
  };
  walk(null, 0, '');
  return out;
}

export const DOC_TYPE_LABELS: Record<string, string> = {
  PZ: 'PZ — Goods receipt',
  PW: 'PW — Internal receipt',
  WZ: 'WZ — Goods issue',
  RW: 'RW — Internal issue',
  MM: 'MM — Transfer between warehouses',
  ZW: 'ZW — Customer return',
  BO: 'BO — Opening balance',
  INW: 'INW — Stocktaking differences',
};
