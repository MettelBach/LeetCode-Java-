import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Barcode,
  Boxes,
  Copy,
  FileText,
  Check,
  ChevronDown,
  ChevronRight,
  Columns3,
  Download,
  Filter,
  FolderTree,
  Layers,
  Package,
  Pencil,
  Plus,
  Search,
  Store,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { DdItem, Dropdown, Empty, Field, Loading, Modal, Pager, useAction, useConfirm, useToast } from '../../components/ui';
import { money } from '../../format';
import { useT } from '../../i18n';
import { useIntegrations } from '../../data';
import { ListOnMarketplaceModal } from '../offers/ListModal';
import {
  categoryOptions,
  useCategories,
  useCurrentCatalog,
  useExtraFields,
  useManufacturers,
  usePriceGroups,
  useTags,
  useWarehouses,
  type Category,
  DOC_TYPE_LABELS,
} from './inventoryData';

export { useCategories, useManufacturers } from './inventoryData';

const COLS_KEY = 'sellhub_product_columns';
type ColumnKey = 'category' | 'sku' | 'sold' | 'offers' | 'reserved' | 'per_warehouse' | 'purchase';
const DEFAULT_COLS: ColumnKey[] = ['sku', 'category', 'sold', 'offers'];

function loadCols(): ColumnKey[] {
  try {
    const v = JSON.parse(localStorage.getItem(COLS_KEY) || 'null');
    return Array.isArray(v) ? v : DEFAULT_COLS;
  } catch {
    return DEFAULT_COLS;
  }
}

/** Number that turns into an input on click (inline edit in the product list). */
function InlineNumber({ value, onSave, format, disabled, title }: { value: number; onSave: (v: number) => Promise<unknown>; format?: (v: number) => ReactNode; disabled?: boolean; title?: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(String(value));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);
  if (disabled || !editing)
    return (
      <span
        className={disabled ? '' : 'inline-edit'}
        title={disabled ? title : undefined}
        onClick={(e) => {
          if (disabled) return;
          e.stopPropagation();
          setV(String(value));
          setEditing(true);
        }}
      >
        {format ? format(value) : value}
      </span>
    );
  const commit = async () => {
    const n = Number(v.replace(',', '.'));
    setEditing(false);
    if (Number.isFinite(n) && n !== value) await onSave(n);
  };
  return (
    <input
      ref={ref}
      className="input input-sm"
      style={{ width: 90, textAlign: 'right' }}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
      }}
      onClick={(e) => e.stopPropagation()}
      inputMode="decimal"
    />
  );
}

function StockPill({ stock, reserved, min }: { stock: number; reserved?: number; min?: number }) {
  const cls = stock < 0 ? 'neg' : stock === 0 ? 'zero' : stock <= Math.max(min ?? 0, 3) ? 'low' : 'ok';
  return (
    <span className={`stock-pill ${cls}`} title={reserved ? `${reserved} zarezerwowane` : undefined}>
      {stock}
      {reserved ? <small> ({reserved})</small> : null}
    </span>
  );
}

/* ------------------------------ category tree ------------------------------ */

function CategoryTree({ rows, active, onSelect, total }: { rows: Category[]; active: string | null; onSelect: (id: string | null) => void; total: number }) {
  const t = useT();
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const byParent = useMemo(() => {
    const m = new Map<number | null, Category[]>();
    for (const r of rows) m.set(r.parent_id, [...(m.get(r.parent_id) ?? []), r]);
    return m;
  }, [rows]);
  // Open the branch that contains the active category.
  useEffect(() => {
    if (!active) return;
    const byId = new Map(rows.map((r) => [r.id, r]));
    let c = byId.get(Number(active));
    const next: Record<number, boolean> = {};
    while (c?.parent_id) {
      next[c.parent_id] = true;
      c = byId.get(c.parent_id);
    }
    setOpen((o) => ({ ...o, ...next }));
  }, [active, rows]);
  const render = (parent: number | null, depth: number): ReactNode =>
    (byParent.get(parent) ?? []).map((c) => {
      const kids = byParent.get(c.id)?.length;
      return (
        <div key={c.id}>
          <div className={`status-row tree-row ${active === String(c.id) ? 'active' : ''}`} style={{ paddingLeft: 8 + depth * 16 }} onClick={() => onSelect(String(c.id))}>
            {kids ? (
              <span
                className="tree-toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen({ ...open, [c.id]: !open[c.id] });
                }}
              >
                {open[c.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            ) : (
              <span className="tree-toggle" />
            )}
            <span className="grow ellipsis">{c.name}</span>
            <span className="text-muted" style={{ fontSize: 13 }}>
              {c.total_count || ''}
            </span>
          </div>
          {kids && open[c.id] ? render(c.id, depth + 1) : null}
        </div>
      );
    });
  return (
    <div className="status-list">
      <div className={`status-row all ${!active ? 'active' : ''}`} onClick={() => onSelect(null)}>
        <Boxes size={18} /> {t('All products')}
        <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 13 }}>
          {total}
        </span>
      </div>
      <div className={`status-row ${active === 'none' ? 'active' : ''}`} onClick={() => onSelect('none')}>
        <span className="tree-toggle" />
        <span className="text-muted">{t('No category')}</span>
      </div>
      {render(null, 0)}
      <div className="status-sep" />
      <div className="status-footer">
        <Link to="/products/categories" className="text-small">
          <FolderTree size={14} style={{ verticalAlign: -2 }} /> {t('Manage categories')}
        </Link>
      </div>
    </div>
  );
}

/* --------------------------------- main page --------------------------------- */

export default function ProductsPage() {
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const run = useAction();
  const confirm = useConfirm();
  const toast = useToast();
  const [catalog, selectCatalog, catalogs] = useCurrentCatalog();
  const cats = useCategories(catalog?.id);
  const mans = useManufacturers();
  const tags = useTags();
  const priceGroups = usePriceGroups();
  const warehouses = useWarehouses();
  const [selected, setSelected] = useState<number[]>([]);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [modal, setModal] = useState<null | 'import' | 'list' | 'filters' | 'columns' | 'labels' | BulkAction>(null);
  const [cols, setCols] = useState<ColumnKey[]>(loadCols);
  const page = Number(params.get('page') ?? 1);
  const perPage = Number(params.get('per_page') ?? 50);
  const groupId = params.get('price_group_id') ?? String(catalog?.default_price_group_id ?? '');
  const catalogWarehouses = (warehouses.data ?? []).filter((w) => !catalog || catalog.warehouse_ids.includes(w.id));
  const catalogGroups = (priceGroups.data ?? []).filter((g) => !catalog || catalog.price_group_ids.includes(g.id));
  const group = catalogGroups.find((g) => String(g.id) === groupId) ?? catalogGroups[0];
  const query = {
    catalog_id: catalog?.id,
    warehouse_id: params.get('warehouse_id') ?? undefined,
    search: params.get('search') ?? undefined,
    category_id: params.get('category_id') ?? undefined,
    manufacturer_id: params.get('manufacturer_id') ?? undefined,
    tag_id: params.get('tag_id') ?? undefined,
    stock: params.get('stock') ?? undefined,
    type: params.get('type') ?? undefined,
    has_ean: params.get('has_ean') ?? undefined,
    no_images: params.get('no_images') ?? undefined,
    has_offers: params.get('has_offers') ?? undefined,
    price_min: params.get('price_min') ?? undefined,
    price_max: params.get('price_max') ?? undefined,
    ...Object.fromEntries(EXTRA_FILTER_KEYS.map((k) => [k, params.get(k) ?? undefined])),
    price_group_id: group?.id,
    sort: params.get('sort') ?? 'id',
    dir: params.get('dir') ?? 'desc',
    page,
    per_page: perPage,
    expand: '1',
  };
  const q = useQuery({ queryKey: ['products', query], queryFn: () => api.get<any>('/products', query), placeholderData: keepPreviousData, enabled: !!catalog });
  const allCount = useQuery({ queryKey: ['products-count', catalog?.id], queryFn: () => api.get<any>('/products', { catalog_id: catalog?.id, per_page: 1 }), enabled: !!catalog });
  useEffect(() => setSelected([]), [JSON.stringify(query)]);
  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: ['products-count'] });
    qc.invalidateQueries({ queryKey: ['categories'] });
  };
  const rows: any[] = q.data?.rows ?? [];
  const sortBy = (s: string) => setParam({ sort: s, dir: query.sort === s && query.dir === 'asc' ? 'desc' : 'asc' });
  const arrow = (s: string) => (query.sort === s ? (query.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const show = (c: ColumnKey) => cols.includes(c);
  const filterCount = PRODUCT_FILTER_KEYS.filter((k) => params.get(k) && k !== 'extra_value' && k !== 'listed' && k !== 'stock_max' && k !== 'date_to').length;
  const catPath = useMemo(() => new Map(categoryOptions(cats.data ?? []).map((c) => [c.id, c.path])), [cats.data]);

  const savePrice = (id: number, v: number) => run(() => api.put(`/products/${id}`, { prices: { [group!.id]: v } }), t('Saved')).then(refresh);
  const saveStock = (id: number, v: number, wh?: number) =>
    run(() => api.post(`/products/${id}/stock`, { value: Math.trunc(v), warehouse_id: wh ?? catalog?.default_warehouse_id ?? undefined }), t('Stock updated')).then(refresh);

  const productRow = (p: any, isVariant = false): ReactNode => {
    const derived = !isVariant && (p.variant_count > 0 || p.is_bundle);
    const stocks: Record<string, { stock: number; reserved: number }> = p.stocks ?? {};
    const total = isVariant ? Object.values(stocks).reduce((s, x) => s + x.stock, 0) : p.total_stock;
    const reserved = isVariant ? Object.values(stocks).reduce((s, x) => s + x.reserved, 0) : p.total_reserved;
    const img = p.images?.[0];
    return (
      <tr key={p.id} className={isVariant ? 'variant-row' : ''} onClick={() => nav(`/products/${isVariant ? p.parent_id : p.id}`)} style={{ cursor: 'pointer' }}>
        <td onClick={(e) => e.stopPropagation()} style={{ width: 34 }}>
          {!isVariant && (
            <input type="checkbox" checked={selected.includes(p.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, p.id] : selected.filter((x) => x !== p.id))} aria-label={t('Select')} />
          )}
        </td>
        <td style={{ width: 28 }} onClick={(e) => e.stopPropagation()}>
          {!isVariant && p.variant_count > 0 && (
            <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => setExpanded({ ...expanded, [p.id]: !expanded[p.id] })} aria-label={t('Variants')}>
              {expanded[p.id] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          )}
        </td>
        <td style={{ width: 56 }}>{img ? <img src={img} alt="" className="thumb" loading="lazy" /> : <span className="thumb thumb-empty">{p.is_bundle ? <Layers size={18} /> : <Package size={18} />}</span>}</td>
        <td className="text-muted text-small" style={{ width: 56 }}>
          {p.id}
        </td>
        <td>
          <div className="prod-name">
            {isVariant ? <span className="text-muted">↳ {p.variant_name || p.name}</span> : <Link to={`/products/${p.id}`} onClick={(e) => e.stopPropagation()}>{p.name}</Link>}
          </div>
          {!isVariant && (
            <div className="prod-meta">
              {p.manufacturer_name && <span>{p.manufacturer_name}</span>}
              {p.variant_count > 0 && <span className="badge-soft blue">{t('{n} variants', { n: p.variant_count })}</span>}
              {p.is_bundle ? <span className="badge-soft orange">{t('Bundle')}</span> : null}
              {(p.tags ?? []).map((tg: any) => (
                <span key={tg.id} className="tag-chip" style={{ background: tg.color }}>
                  {tg.name}
                </span>
              ))}
            </div>
          )}
        </td>
        {show('sku') && (
          <td className="text-small">
            <div>{p.sku || '—'}</div>
            <div className="text-muted">{p.ean}</div>
          </td>
        )}
        {show('category') && <td className="text-small text-muted">{!isVariant && p.category_id ? catPath.get(p.category_id) ?? p.category_name : ''}</td>}
        {show('purchase') && <td className="num text-small">{money(p.avg_cost || p.purchase_price)}</td>}
        <td className="num" onClick={(e) => e.stopPropagation()}>
          <InlineNumber
            value={Number(p.group_price ?? p.price)}
            format={(v) => money(v, group?.currency)}
            disabled={!group || (!isVariant && p.variant_count > 0)}
            title={t('Edit prices of the variants')}
            onSave={(v) => savePrice(p.id, v)}
          />
        </td>
        {show('per_warehouse')
          ? catalogWarehouses.map((w) => (
              <td key={w.id} className="num" onClick={(e) => e.stopPropagation()}>
                <InlineNumber
                  value={stocks[w.id]?.stock ?? 0}
                  disabled={derived}
                  title={t('Stock is calculated from variants or bundle components')}
                  format={(v) => <StockPill stock={v} reserved={stocks[w.id]?.reserved} min={p.min_stock} />}
                  onSave={(v) => saveStock(p.id, v, w.id)}
                />
              </td>
            ))
          : (
            <td className="num" onClick={(e) => e.stopPropagation()}>
              {p.is_bundle ? (
                <span className="stock-pill ok" title={t('Complete sets available from components')}>
                  {p.available}
                </span>
              ) : (
                <InlineNumber
                  value={total}
                  disabled={derived || catalogWarehouses.length > 1}
                  title={derived ? t('Stock is calculated from variants or bundle components') : t('Several warehouses — edit stock in the product card or show warehouse columns')}
                  format={(v) => <StockPill stock={v} reserved={reserved} min={p.min_stock} />}
                  onSave={(v) => saveStock(p.id, v)}
                />
              )}
            </td>
          )}
        {show('reserved') && <td className="num text-small">{reserved || ''}</td>}
        {show('sold') && <td className="num">{isVariant ? '' : p.sold_30d}</td>}
        {show('offers') && <td className="num">{isVariant ? '' : p.offer_count || ''}</td>}
        <td className="num" style={{ width: 40 }}>
          {!isVariant && (
            <Link to={`/products/${p.id}`} className="icon-btn" onClick={(e) => e.stopPropagation()} aria-label={t('Edit')}>
              <Pencil size={16} />
            </Link>
          )}
        </td>
      </tr>
    );
  };

  if (!catalog) return <Loading />;
  return (
    <div className="orders-layout">
      <div className="status-col">
        <Link to={`/products/new?catalog_id=${catalog.id}`} className="btn-add-order">
          <span className="plus">
            <Plus />
          </span>
          <span className="label">{t('Add product')}</span>
        </Link>
        <CategoryTree rows={cats.data ?? []} active={params.get('category_id')} onSelect={(id) => setParam({ category_id: id })} total={allCount.data?.total ?? 0} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="page-head">
          <Dropdown
            trigger={(_open, toggle) => (
              <button className="page-title catalog-switch" onClick={toggle}>
                {catalog.name} <ChevronDown size={20} />
              </button>
            )}
          >
            {(close) => (
              <>
                {catalogs.map((c) => (
                  <DdItem
                    key={c.id}
                    icon={c.id === catalog.id ? <Check size={16} /> : <span style={{ width: 16 }} />}
                    onClick={() => {
                      selectCatalog(c.id);
                      setParams(new URLSearchParams());
                      close();
                    }}
                  >
                    {c.name} <span className="text-muted">({c.products})</span>
                  </DdItem>
                ))}
                <div className="dd-sep" />
                <DdItem icon={<Pencil size={16} />} onClick={() => nav('/products/catalogs')}>
                  {t('Manage catalogs')}
                </DdItem>
              </>
            )}
          </Dropdown>
          <div className="spacer" />
          <button className="btn btn-pill" onClick={() => setModal('import')}>
            <Upload /> {t('Import')}
          </button>
          <button className="btn btn-pill" onClick={() => run(() => api.download('/products/export.csv', `produkty-${catalog.name}.csv`, { catalog_id: catalog.id }))}>
            <Download /> {t('Export')}
          </button>
        </div>

        <div className="toolbar">
          <form
            className="searchbox-input"
            style={{ height: 40, maxWidth: 340, flex: 1 }}
            onSubmit={(e) => {
              e.preventDefault();
              setParam({ search: search.trim() || null });
            }}
          >
            <Search size={18} />
            <input placeholder={t('Name, SKU, EAN, ID')} value={search} onChange={(e) => setSearch(e.target.value)} style={{ border: 0, outline: 0, flex: 1 }} />
          </form>
          <button className={`btn ${filterCount ? 'btn-outline-blue' : ''}`} onClick={() => setModal('filters')}>
            <Filter size={16} /> {t('Filters')}
            {filterCount ? ` (${filterCount})` : ''}
          </button>
          {catalogGroups.length > 1 && (
            <select className="select" style={{ width: 170 }} value={group?.id ?? ''} onChange={(e) => setParam({ price_group_id: e.target.value })} aria-label={t('Price group')}>
              {catalogGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {t('Prices')}: {g.name}
                </option>
              ))}
            </select>
          )}
          {catalogWarehouses.length > 1 && (
            <select className="select" style={{ width: 190 }} value={query.warehouse_id ?? ''} onChange={(e) => setParam({ warehouse_id: e.target.value || null })} aria-label={t('Warehouse')}>
              <option value="">{t('Stock: all warehouses')}</option>
              {catalogWarehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {t('Stock')}: {w.name}
                </option>
              ))}
            </select>
          )}
          <button className="btn" onClick={() => setModal('columns')} aria-label={t('Columns')} title={t('Columns')}>
            <Columns3 size={16} />
          </button>
          <Dropdown
            trigger={(_o, toggle) => (
              <button className="btn" onClick={toggle} disabled={!selected.length}>
                {t('Bulk actions')}
                {selected.length ? ` (${selected.length})` : ''} <ChevronDown size={16} />
              </button>
            )}
          >
            {(close) => (
              <>
                {BULK_ACTIONS.map(([a, label]) => (
                  <DdItem
                    key={a}
                    danger={a === 'delete'}
                    onClick={async () => {
                      close();
                      if (a === 'delete') {
                        if (!(await confirm(t('Delete {n} products? Their stock history will be kept in documents.', { n: selected.length }), { danger: true }))) return;
                        const r = await run(() => api.post<any>('/products/bulk', { ids: selected, action: 'delete' }));
                        if (r) {
                          toast(r.errors.length ? t('{ok} done, {e} with errors: {msg}', { ok: r.ok, e: r.errors.length, msg: r.errors[0].message }) : t('Deleted'), r.errors.length ? 'error' : 'success');
                          refresh();
                        }
                      } else setModal(a);
                    }}
                  >
                    {t(label)}
                  </DdItem>
                ))}
                <div className="dd-sep" />
                <DdItem
                  icon={<Copy size={16} />}
                  onClick={async () => {
                    close();
                    const r = await run(() => api.post<any>('/products/bulk', { ids: selected, action: 'duplicate' }));
                    if (r) {
                      toast(r.errors.length ? t('{ok} done, {e} with errors: {msg}', { ok: r.ok, e: r.errors.length, msg: r.errors[0].message }) : t('Copies created: {n}', { n: r.ok }), r.errors.length ? 'error' : 'success');
                      refresh();
                    }
                  }}
                >
                  {t('Duplicate')}
                </DdItem>
                <DdItem icon={<Barcode size={16} />} onClick={() => (close(), setModal('labels'))}>
                  {t('Print barcode labels')}
                </DdItem>
                <div className="dd-head">{t('Warehouse document from selected')}</div>
                {(['PZ', 'WZ', 'RW', 'PW', 'MM'] as const).map((d) => (
                  <DdItem key={d} icon={<FileText size={16} />} onClick={() => (close(), nav(`/products/documents/new?type=${d}&product_ids=${selected.join(',')}`))}>
                    {d} — {t(DOC_TYPE_LABELS[d] ?? d)}
                  </DdItem>
                ))}
                <div className="dd-sep" />
                <DdItem icon={<Store size={16} />} onClick={() => (close(), setModal('list'))}>
                  {t('List on marketplace')}
                </DdItem>
              </>
            )}
          </Dropdown>
          <Pager page={page} perPage={perPage} total={q.data?.total ?? 0} onPage={(p) => setParam({ page: String(p) })} />
        </div>

        <ActiveFilters params={params} setParam={setParam} mans={mans.data} tags={tags.data} />

        <div className="table-wrap">
          {!q.data ? (
            <Loading />
          ) : !rows.length ? (
            <Empty icon={<Package />}>
              {t('No products')}
              <div className="mt">
                <Link to={`/products/new?catalog_id=${catalog.id}`} className="btn btn-primary btn-pill">
                  <Plus /> {t('Add product')}
                </Link>
              </div>
            </Empty>
          ) : (
            <table className="tbl products-tbl">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={selected.length === rows.length && rows.length > 0}
                      onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.id) : [])}
                      aria-label={t('Select all')}
                    />
                  </th>
                  <th />
                  <th />
                  <th className="sortable" onClick={() => sortBy('id')}>
                    ID{arrow('id')}
                  </th>
                  <th className="sortable" onClick={() => sortBy('name')}>
                    {t('Product name')}
                    {arrow('name')}
                  </th>
                  {show('sku') && (
                    <th className="sortable" onClick={() => sortBy('sku')}>
                      SKU / EAN{arrow('sku')}
                    </th>
                  )}
                  {show('category') && <th>{t('Category')}</th>}
                  {show('purchase') && <th className="num">{t('Avg. cost')}</th>}
                  <th className="num sortable" onClick={() => sortBy('price')}>
                    {t('Price')}
                    {arrow('price')}
                    {group && <div className="th-sub">{group.name}</div>}
                  </th>
                  {show('per_warehouse') ? (
                    catalogWarehouses.map((w) => (
                      <th key={w.id} className="num">
                        {t('Stock')}
                        <div className="th-sub">{w.code || w.name}</div>
                      </th>
                    ))
                  ) : (
                    <th className="num sortable" onClick={() => sortBy('stock')}>
                      {t('Stock')}
                      {arrow('stock')}
                    </th>
                  )}
                  {show('reserved') && <th className="num">{t('Reserved')}</th>}
                  {show('sold') && (
                    <th className="num sortable" onClick={() => sortBy('sold')}>
                      {t('Sold (30 days)')}
                      {arrow('sold')}
                    </th>
                  )}
                  {show('offers') && <th className="num">{t('Offers')}</th>}
                  <th />
                </tr>
              </thead>
              <tbody>{rows.flatMap((p) => [productRow(p), ...(expanded[p.id] ? (p.variants ?? []).map((v: any) => productRow(v, true)) : [])])}</tbody>
            </table>
          )}
        </div>
        <div className="row mt" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <span className="text-muted text-small">{t('Per page')}:</span>
          <select className="select" style={{ width: 90 }} value={perPage} onChange={(e) => setParam({ per_page: e.target.value })}>
            {[25, 50, 100, 200, 500].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>

      {modal === 'labels' && <LabelsModal ids={selected} priceGroupId={group?.id} onClose={() => setModal(null)} />}
      {modal === 'list' && <ListOnMarketplaceModal productIds={selected} onClose={() => setModal(null)} onDone={() => (setModal(null), refresh())} />}
      {modal === 'import' && <ImportWizard catalogId={catalog.id} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === 'filters' && <FiltersModal params={params} onApply={(patch) => (setParam(patch), setModal(null))} onClose={() => setModal(null)} />}
      {modal === 'columns' && (
        <ColumnsModal
          cols={cols}
          onSave={(c) => {
            setCols(c);
            try {
              localStorage.setItem(COLS_KEY, JSON.stringify(c));
            } catch {
              /* ignore */
            }
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal && BULK_ACTIONS.some(([a]) => a === modal) && modal !== 'delete' && (
        <BulkModal action={modal as BulkAction} ids={selected} catalogId={catalog.id} onClose={() => setModal(null)} onDone={() => (setModal(null), refresh())} />
      )}
    </div>
  );
}

/* ------------------------------- active filters ------------------------------- */

const CHIP_KEYS: Record<string, Record<string, null>> = {
  price: { price_min: null, price_max: null },
  stock_range: { stock_min: null, stock_max: null },
  added: { date_from: null, date_to: null },
  listed: { integration_id: null, listed: null },
  extra: { extra_field_id: null, extra_value: null },
};

function ActiveFilters({ params, setParam, mans, tags }: { params: URLSearchParams; setParam: (p: Record<string, string | null>) => void; mans?: any[]; tags?: any[] }) {
  const t = useT();
  const STOCK: Record<string, string> = { in: 'In stock', out: 'Out of stock', low: 'Low stock', negative: 'Negative stock', reserved: 'Reserved' };
  const TYPE: Record<string, string> = { simple: 'Simple products', variants: 'With variants', bundle: 'Bundles' };
  const chips: [string, string][] = [];
  if (params.get('search')) chips.push(['search', `"${params.get('search')}"`]);
  if (params.get('manufacturer_id')) chips.push(['manufacturer_id', mans?.find((m) => String(m.id) === params.get('manufacturer_id'))?.name ?? '…']);
  if (params.get('tag_id')) chips.push(['tag_id', `#${tags?.find((m) => String(m.id) === params.get('tag_id'))?.name ?? '…'}`]);
  if (params.get('stock')) chips.push(['stock', t(STOCK[params.get('stock')!] ?? params.get('stock')!)]);
  if (params.get('type')) chips.push(['type', t(TYPE[params.get('type')!] ?? '')]);
  if (params.get('has_ean') === '0') chips.push(['has_ean', t('Without EAN')]);
  if (params.get('no_images') === '1') chips.push(['no_images', t('Without images')]);
  if (params.get('has_offers')) chips.push(['has_offers', params.get('has_offers') === '1' ? t('Listed on marketplaces') : t('Not listed')]);
  if (params.get('price_min') || params.get('price_max')) chips.push(['price', `${params.get('price_min') ?? '0'} – ${params.get('price_max') ?? '∞'} zł`]);
  if (params.get('stock_min') || params.get('stock_max')) chips.push(['stock_range', `${t('Stock')}: ${params.get('stock_min') ?? '…'} – ${params.get('stock_max') ?? '…'}`]);
  if (params.get('location')) chips.push(['location', `${t('Location')}: ${params.get('location')}`]);
  if (params.get('no_description') === '1') chips.push(['no_description', t('Without description')]);
  if (params.get('date_from') || params.get('date_to')) chips.push(['added', `${t('Added')}: ${params.get('date_from') ?? '…'} – ${params.get('date_to') ?? '…'}`]);
  if (params.get('integration_id') && params.get('listed')) chips.push(['listed', `${params.get('listed') === '1' ? t('Listed') : t('Not listed')} (ID ${params.get('integration_id')})`]);
  if (params.get('extra_field_id')) chips.push(['extra', `${t('Additional field')}: ${params.get('extra_value') || t('empty')}`]);
  if (!chips.length) return null;
  return (
    <div className="filter-chips">
      {chips.map(([k, label]) => (
        <span key={k} className="filter-chip">
          {label}
          <button onClick={() => setParam(CHIP_KEYS[k] ?? { [k]: null })} aria-label={t('Remove filter')}>
            <X size={14} />
          </button>
        </span>
      ))}
    </div>
  );
}

const EXTRA_FILTER_KEYS = ['stock_min', 'stock_max', 'location', 'no_description', 'date_from', 'date_to', 'integration_id', 'listed', 'extra_field_id', 'extra_value'];
const PRODUCT_FILTER_KEYS = ['manufacturer_id', 'tag_id', 'stock', 'type', 'has_ean', 'no_images', 'has_offers', 'price_min', 'price_max', ...EXTRA_FILTER_KEYS];

function FiltersModal({ params, onApply, onClose }: { params: URLSearchParams; onApply: (p: Record<string, string | null>) => void; onClose: () => void }) {
  const t = useT();
  const mans = useManufacturers();
  const tags = useTags();
  const integrations = useIntegrations();
  const extra = useExtraFields();
  const keys = PRODUCT_FILTER_KEYS;
  const [f, setF] = useState<Record<string, string>>(Object.fromEntries(keys.map((k) => [k, params.get(k) ?? ''])));
  const sel = (k: string, opts: [string, string][]) => (
    <select className="select" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
      {opts.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
  return (
    <Modal
      title={t('Filters')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => onApply(Object.fromEntries(keys.map((k) => [k, null])))}>
            {t('Clear filters')}
          </button>
          <button className="btn btn-primary" onClick={() => onApply(Object.fromEntries(keys.map((k) => [k, f[k] || null])))}>
            {t('Apply')}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={t('Manufacturer')}>{sel('manufacturer_id', [['', t('All')], ...((mans.data ?? []).map((m) => [String(m.id), m.name]) as [string, string][])])}</Field>
        <Field label={t('Tag')}>{sel('tag_id', [['', t('All')], ...((tags.data ?? []).map((m) => [String(m.id), m.name]) as [string, string][])])}</Field>
        <Field label={t('Stock')}>
          {sel('stock', [
            ['', t('Any')],
            ['in', t('In stock')],
            ['out', t('Out of stock')],
            ['low', t('Low stock')],
            ['negative', t('Negative stock')],
            ['reserved', t('Reserved')],
          ])}
        </Field>
        <Field label={t('Product type')}>
          {sel('type', [
            ['', t('All')],
            ['simple', t('Simple products')],
            ['variants', t('With variants')],
            ['bundle', t('Bundles')],
          ])}
        </Field>
        <Field label={t('Marketplace offers')}>
          {sel('has_offers', [
            ['', t('Any')],
            ['1', t('Listed on marketplaces')],
            ['0', t('Not listed')],
          ])}
        </Field>
        <Field label={t('Data completeness')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }}>
            <label className="check-label">
              <input type="checkbox" checked={f.has_ean === '0'} onChange={(e) => setF({ ...f, has_ean: e.target.checked ? '0' : '' })} /> {t('Without EAN')}
            </label>
            <label className="check-label">
              <input type="checkbox" checked={f.no_images === '1'} onChange={(e) => setF({ ...f, no_images: e.target.checked ? '1' : '' })} /> {t('Without images')}
            </label>
          </div>
        </Field>
        <Field label={t('Price from')}>
          <input className="input" value={f.price_min} onChange={(e) => setF({ ...f, price_min: e.target.value })} inputMode="decimal" />
        </Field>
        <Field label={t('Price to')}>
          <input className="input" value={f.price_max} onChange={(e) => setF({ ...f, price_max: e.target.value })} inputMode="decimal" />
        </Field>
        <Field label={t('Stock from')}>
          <input className="input" value={f.stock_min} onChange={(e) => setF({ ...f, stock_min: e.target.value })} inputMode="numeric" />
        </Field>
        <Field label={t('Stock to')}>
          <input className="input" value={f.stock_max} onChange={(e) => setF({ ...f, stock_max: e.target.value })} inputMode="numeric" />
        </Field>
        <Field label={t('Marketplace account')}>
          {sel('integration_id', [['', t('Any')], ...((integrations.data ?? []).map((i) => [String(i.id), i.name]) as [string, string][])])}
        </Field>
        <Field label={t('On this account')}>
          {sel('listed', [
            ['', t('Any')],
            ['1', t('Listed')],
            ['0', t('Not listed')],
          ])}
        </Field>
        <Field label={t('Location')}>
          <input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="A-01" />
        </Field>
        <Field label=" ">
          <label className="check-label" style={{ height: 40 }}>
            <input type="checkbox" checked={f.no_description === '1'} onChange={(e) => setF({ ...f, no_description: e.target.checked ? '1' : '' })} /> {t('Without description')}
          </label>
        </Field>
        <Field label={t('Added from')}>
          <input className="input" type="date" value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} />
        </Field>
        <Field label={t('Added to')}>
          <input className="input" type="date" value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} />
        </Field>
        {!!extra.data?.length && (
          <>
            <Field label={t('Additional field')}>{sel('extra_field_id', [['', t('Any')], ...((extra.data ?? []).map((x) => [String(x.id), x.name]) as [string, string][])])}</Field>
            <Field label={t('Value contains')} help={t('Empty = products without a value')}>
              <input className="input" value={f.extra_value} onChange={(e) => setF({ ...f, extra_value: e.target.value })} disabled={!f.extra_field_id} />
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Barcode labels 50×30 mm: a fixed number per product or as many as the stock. */
function LabelsModal({ ids, priceGroupId, onClose }: { ids: number[]; priceGroupId?: number; onClose: () => void }) {
  const t = useT();
  const [copies, setCopies] = useState('1');
  const [byStock, setByStock] = useState(false);
  const open = () => {
    void api.openPdf('/products/labels.pdf', { ids: ids.join(','), copies: byStock ? 'stock' : copies, price_group_id: priceGroupId });
    onClose();
  };
  return (
    <Modal
      title={t('Print barcode labels')}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={open}>
          <Barcode size={16} /> {t('Print')}
        </button>
      }
    >
      <p className="help-text" style={{ marginTop: 0 }}>
        {t('Labels 50×30 mm with name, SKU, price and EAN barcode (SKU when there is no EAN). Products with variants print labels of the variants.')}
      </p>
      <label className="check-label mb">
        <input type="radio" checked={!byStock} onChange={() => setByStock(false)} /> {t('Labels per product')}
        <input className="input input-sm" style={{ width: 70, marginLeft: 8 }} value={copies} onChange={(e) => setCopies(e.target.value.replace(/\D/g, '') || '1')} disabled={byStock} />
      </label>
      <label className="check-label">
        <input type="radio" checked={byStock} onChange={() => setByStock(true)} /> {t('As many as the stock (max 100 per product)')}
      </label>
    </Modal>
  );
}

function ColumnsModal({ cols, onSave, onClose }: { cols: ColumnKey[]; onSave: (c: ColumnKey[]) => void; onClose: () => void }) {
  const t = useT();
  const [c, setC] = useState<ColumnKey[]>(cols);
  const ALL: [ColumnKey, string][] = [
    ['sku', 'SKU / EAN'],
    ['category', 'Category'],
    ['purchase', 'Avg. cost'],
    ['per_warehouse', 'Stock per warehouse (separate columns)'],
    ['reserved', 'Reserved'],
    ['sold', 'Sold (30 days)'],
    ['offers', 'Offers'],
  ];
  return (
    <Modal
      title={t('Columns')}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={() => onSave(c)}>
          {t('Save')}
        </button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ALL.map(([k, label]) => (
          <label key={k} className="check-label">
            <input type="checkbox" checked={c.includes(k)} onChange={(e) => setC(e.target.checked ? [...c, k] : c.filter((x) => x !== k))} /> {t(label)}
          </label>
        ))}
      </div>
    </Modal>
  );
}

/* --------------------------------- bulk actions --------------------------------- */

type BulkAction =
  | 'set_category'
  | 'set_manufacturer'
  | 'price'
  | 'set_stock'
  | 'set_tax'
  | 'set_catalog'
  | 'add_tag'
  | 'remove_tag'
  | 'set_location'
  | 'set_weight'
  | 'set_min_stock'
  | 'delete';

const BULK_ACTIONS: [BulkAction, string][] = [
  ['price', 'Change prices'],
  ['set_stock', 'Set stock'],
  ['set_category', 'Change category'],
  ['set_manufacturer', 'Change manufacturer'],
  ['add_tag', 'Add tag'],
  ['remove_tag', 'Remove tag'],
  ['set_tax', 'Change VAT rate'],
  ['set_location', 'Set location'],
  ['set_weight', 'Set weight'],
  ['set_min_stock', 'Set minimum stock'],
  ['set_catalog', 'Move to another catalog'],
  ['delete', 'Delete'],
];

function BulkModal({ action, ids, catalogId, onClose, onDone }: { action: BulkAction; ids: number[]; catalogId: number; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const run = useAction();
  const toast = useToast();
  const cats = useCategories(catalogId);
  const mans = useManufacturers();
  const tags = useTags();
  const groups = usePriceGroups();
  const warehouses = useWarehouses();
  const [, , catalogs] = useCurrentCatalog();
  const [value, setValue] = useState('');
  const [mode, setMode] = useState<'price_percent' | 'price_set' | 'price_from_group'>('price_percent');
  const [group, setGroup] = useState('');
  const [source, setSource] = useState('');
  const [wh, setWh] = useState('');
  const submit = async () => {
    const body: any = { ids, action: action === 'price' ? mode : action, value };
    if (action === 'price') {
      body.price_group_id = Number(group || groups.data?.[0]?.id);
      if (mode === 'price_from_group') body.source_price_group_id = Number(source || groups.data?.[0]?.id);
    }
    if (action === 'set_stock' && wh) body.warehouse_id = Number(wh);
    const r = await run(() => api.post<any>('/products/bulk', body));
    if (r) {
      toast(r.errors.length ? t('{ok} done, {e} with errors: {msg}', { ok: r.ok, e: r.errors.length, msg: r.errors[0].message }) : t('Done: {n} products', { n: r.ok }), r.errors.length ? 'error' : 'success');
      onDone();
    }
  };
  const label = BULK_ACTIONS.find(([a]) => a === action)?.[1] ?? '';
  let body: ReactNode = null;
  if (action === 'set_category')
    body = (
      <Field label={t('Category')}>
        <select className="select" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">{t('— none —')}</option>
          {categoryOptions(cats.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>
    );
  else if (action === 'set_manufacturer')
    body = (
      <Field label={t('Manufacturer')}>
        <select className="select" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">{t('— none —')}</option>
          {mans.data?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>
    );
  else if (action === 'add_tag' || action === 'remove_tag')
    body = (
      <Field label={t('Tag')}>
        <select className="select" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">—</option>
          {tags.data?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {!tags.data?.length && (
          <span className="help-text">
            <Link to="/products/categories?tab=tags">{t('Create tags first')}</Link>
          </span>
        )}
      </Field>
    );
  else if (action === 'set_catalog')
    body = (
      <Field label={t('Catalog')} help={t('Variants move together with their parent. Categories are cleared (they belong to a catalog).')}>
        <select className="select" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">—</option>
          {catalogs
            .filter((c) => c.id !== catalogId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </Field>
    );
  else if (action === 'price')
    body = (
      <div className="form-grid">
        <Field label={t('Price group')}>
          <select className="select" value={group} onChange={(e) => setGroup(e.target.value)}>
            {groups.data?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.currency})
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Change')}>
          <select className="select" value={mode} onChange={(e) => setMode(e.target.value as any)}>
            <option value="price_percent">{t('Change by %')}</option>
            <option value="price_set">{t('Set price')}</option>
            <option value="price_from_group">{t('Copy from another group + %')}</option>
          </select>
        </Field>
        {mode === 'price_from_group' && (
          <Field label={t('Source price group')}>
            <select className="select" value={source} onChange={(e) => setSource(e.target.value)}>
              {groups.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={mode === 'price_set' ? t('Price') : t('Percent (e.g. 10 or -5)')}>
          <input className="input" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" autoFocus />
        </Field>
      </div>
    );
  else if (action === 'set_stock')
    body = (
      <div className="form-grid">
        <Field label={t('Warehouse')}>
          <select className="select" value={wh} onChange={(e) => setWh(e.target.value)}>
            <option value="">{t('Default warehouse of the catalog')}</option>
            {warehouses.data?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Stock')} help={t('Products with variants: the value is set on every variant.')}>
          <input className="input" value={value} onChange={(e) => setValue(e.target.value)} inputMode="numeric" autoFocus />
        </Field>
      </div>
    );
  else
    body = (
      <Field label={t(label)}>
        <input className="input" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      </Field>
    );
  return (
    <Modal
      title={`${t(label)} — ${t('{n} products', { n: ids.length })}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="btn btn-primary" onClick={submit}>
            {t('Apply')}
          </button>
        </>
      }
    >
      {body}
    </Modal>
  );
}

/* --------------------------------- import wizard --------------------------------- */

function ImportWizard({ catalogId, onClose, onDone }: { catalogId: number; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const run = useAction();
  const groups = usePriceGroups();
  const warehouses = useWarehouses();
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [opts, setOpts] = useState({ match_by: 'sku', create_new: true, update_existing: true, stock_mode: 'set' });
  const [result, setResult] = useState<any>(null);
  const FIELD_LABELS: Record<string, string> = {
    id: 'ID',
    sku: 'SKU',
    ean: 'EAN',
    name: t('Name'),
    price: t('Price (default group)'),
    purchase_price: t('Purchase price'),
    tax_rate: 'VAT',
    stock: t('Stock (default warehouse)'),
    weight: t('Weight (kg)'),
    width: t('Width (cm)'),
    height: t('Height (cm)'),
    length: t('Length (cm)'),
    location: t('Location'),
    category: t('Category (path: A > B)'),
    manufacturer: t('Manufacturer'),
    description: t('Description'),
    images: t('Images (URLs separated by |)'),
    parent_sku: t('Parent SKU (variant)'),
    variant_name: t('Variant name'),
  };
  for (const g of groups.data ?? []) FIELD_LABELS[`price_${g.id}`] = `${t('Price')}: ${g.name}`;
  for (const w of warehouses.data ?? []) FIELD_LABELS[`stock_${w.code || w.id}`] = `${t('Stock')}: ${w.name}`;
  const loadFile = (f: File) => f.text().then(setCsv);
  const analyse = async () => {
    const r = await run(() => api.post<any>('/products/import/preview', { csv }));
    if (r) {
      setPreview(r);
      setMapping(r.mapping);
    }
  };
  const doImport = async () => {
    const r = await run(() => api.post<any>('/products/import', { csv, catalog_id: catalogId, mapping, ...opts }));
    if (r) {
      setResult(r);
      onDone();
    }
  };
  return (
    <Modal
      title={t('Import products from CSV')}
      size="xl"
      onClose={onClose}
      footer={
        result ? (
          <button className="btn btn-primary" onClick={onClose}>
            {t('Close')}
          </button>
        ) : preview ? (
          <>
            <button className="btn" onClick={() => setPreview(null)}>
              {t('Back')}
            </button>
            <button className="btn btn-primary" onClick={doImport} disabled={!Object.values(mapping).includes('name') && opts.create_new}>
              {t('Import {n} rows', { n: preview.rows })}
            </button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={analyse} disabled={!csv.trim()}>
            {t('Next')}
          </button>
        )
      }
    >
      {result ? (
        <div>
          <div className="grid grid-3 mb">
            <div className="card stat">
              <div className="label">{t('Created')}</div>
              <div className="value">{result.created}</div>
            </div>
            <div className="card stat">
              <div className="label">{t('Updated')}</div>
              <div className="value">{result.updated}</div>
            </div>
            <div className="card stat">
              <div className="label">{t('Skipped')}</div>
              <div className="value">{result.skipped}</div>
            </div>
          </div>
          {!!result.errors.length && (
            <>
              <div className="card-title mb" style={{ color: 'var(--red)' }}>
                {t('Errors ({n})', { n: result.errors.length })}
              </div>
              <table className="tbl">
                <tbody>
                  {result.errors.slice(0, 200).map((e: any) => (
                    <tr key={e.row}>
                      <td style={{ width: 90 }}>
                        {t('Row')} {e.row}
                      </td>
                      <td>{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      ) : preview ? (
        <>
          <div className="form-grid mb">
            <Field label={t('Match existing products by')}>
              <select className="select" value={opts.match_by} onChange={(e) => setOpts({ ...opts, match_by: e.target.value })}>
                <option value="sku">SKU</option>
                <option value="ean">EAN</option>
                <option value="id">ID</option>
              </select>
            </Field>
            <Field label={t('Stock values')}>
              <select className="select" value={opts.stock_mode} onChange={(e) => setOpts({ ...opts, stock_mode: e.target.value })}>
                <option value="set">{t('Set (replace stock)')}</option>
                <option value="add">{t('Add to current stock')}</option>
              </select>
            </Field>
            <label className="check-label">
              <input type="checkbox" checked={opts.create_new} onChange={(e) => setOpts({ ...opts, create_new: e.target.checked })} /> {t('Create new products')}
            </label>
            <label className="check-label">
              <input type="checkbox" checked={opts.update_existing} onChange={(e) => setOpts({ ...opts, update_existing: e.target.checked })} /> {t('Update existing products')}
            </label>
          </div>
          <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('Column in file')}</th>
                  <th>{t('Field in the catalog')}</th>
                  <th>{t('Example values')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.headers.map((h: string, i: number) => (
                  <tr key={i}>
                    <td>
                      <b>{h}</b>
                    </td>
                    <td>
                      <select className="select" value={mapping[i] ?? ''} onChange={(e) => setMapping({ ...mapping, [i]: e.target.value })}>
                        <option value="">{t('— skip —')}</option>
                        {Object.entries(FIELD_LABELS).map(([k, l]) => (
                          <option key={k} value={k}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="text-small text-muted ellipsis" style={{ maxWidth: 320 }}>
                      {preview.sample
                        .map((r: string[]) => r[i])
                        .filter(Boolean)
                        .slice(0, 3)
                        .join(' · ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <p className="text-muted" style={{ marginTop: 0 }}>
            {t('Upload a CSV file (separator ; , or tab). In the next step you choose which column goes to which field. Polish column names (nazwa, cena, stan, kategoria…) are recognised automatically.')}
          </p>
          <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
          <Field label={t('…or paste the content')} className="mt">
            <textarea className="textarea" style={{ minHeight: 160, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5 }} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="nazwa;sku;ean;cena;stan" />
          </Field>
        </>
      )}
    </Modal>
  );
}
