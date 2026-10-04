import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Download, Package, Plus, Search, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { DdItem, Dropdown, Empty, Field, Loading, Modal, Pager, useAction, useConfirm, useToast } from '../../components/ui';
import { money } from '../../format';
import { useT } from '../../i18n';

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => api.get<any[]>('/products/meta/categories') });
}
export function useManufacturers() {
  return useQuery({ queryKey: ['manufacturers'], queryFn: () => api.get<any[]>('/products/meta/manufacturers') });
}

export default function ProductsPage() {
  const t = useT();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const run = useAction();
  const confirm = useConfirm();
  const toast = useToast();
  const cats = useCategories();
  const mans = useManufacturers();
  const [selected, setSelected] = useState<number[]>([]);
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [importing, setImporting] = useState(false);
  const [bulkModal, setBulkModal] = useState<null | 'price_percent' | 'set_stock' | 'set_category' | 'set_tax'>(null);
  const page = Number(params.get('page') ?? 1);
  const query = {
    search: params.get('search') ?? undefined,
    category_id: params.get('category_id') ?? undefined,
    manufacturer_id: params.get('manufacturer_id') ?? undefined,
    stock: params.get('stock') ?? undefined,
    sort: params.get('sort') ?? 'id',
    dir: params.get('dir') ?? 'desc',
    page,
    per_page: 50,
  };
  const q = useQuery({ queryKey: ['products', query], queryFn: () => api.get<any>('/products', query), placeholderData: keepPreviousData });
  useEffect(() => setSelected([]), [JSON.stringify(query)]);
  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ['products'] });
  const rows: any[] = q.data?.rows ?? [];
  const sortBy = (s: string) => setParam({ sort: s, dir: query.sort === s && query.dir === 'asc' ? 'desc' : 'asc' });
  const arrow = (s: string) => (query.sort === s ? (query.dir === 'asc' ? ' ▲' : ' ▼') : '');

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{t('Inventory')}</h1>
        <div className="spacer" />
        <button className="btn btn-pill" onClick={() => setImporting(true)}>
          <Upload /> {t('Import CSV')}
        </button>
        <button className="btn btn-pill" onClick={() => run(() => api.download('/products/export.csv', 'products.csv'))}>
          <Download /> {t('Export CSV')}
        </button>
        <Link to="/products/new" className="btn btn-primary btn-pill" style={{ height: 44, padding: '0 22px' }}>
          <Plus /> {t('Add product')}
        </Link>
      </div>

      <div className="toolbar">
        <form
          className="searchbox-input"
          style={{ height: 40, maxWidth: 360, flex: 1 }}
          onSubmit={(e) => {
            e.preventDefault();
            setParam({ search: search.trim() || null });
          }}
        >
          <Search size={18} />
          <input placeholder={t('Name, SKU, EAN, ID')} value={search} onChange={(e) => setSearch(e.target.value)} style={{ border: 0, outline: 0, flex: 1 }} />
        </form>
        <select className="select" style={{ width: 180 }} value={query.category_id ?? ''} onChange={(e) => setParam({ category_id: e.target.value || null })}>
          <option value="">{t('All categories')}</option>
          {cats.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="select" style={{ width: 180 }} value={query.manufacturer_id ?? ''} onChange={(e) => setParam({ manufacturer_id: e.target.value || null })}>
          <option value="">{t('All manufacturers')}</option>
          {mans.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="select" style={{ width: 160 }} value={query.stock ?? ''} onChange={(e) => setParam({ stock: e.target.value || null })}>
          <option value="">{t('Any stock')}</option>
          <option value="in">{t('In stock')}</option>
          <option value="low">{t('Low stock (≤5)')}</option>
          <option value="out">{t('Out of stock')}</option>
        </select>
        <Dropdown
          trigger={(_o, toggle) => (
            <button className="btn" onClick={() => (selected.length ? toggle() : toast(t('Select products first'), 'error'))}>
              {t('Bulk actions')} {selected.length > 0 && <b>({selected.length})</b>} <ChevronDown size={15} />
            </button>
          )}
        >
          {(close) => (
            <>
              <DdItem onClick={() => (setBulkModal('price_percent'), close())}>{t('Change price by %')}</DdItem>
              <DdItem onClick={() => (setBulkModal('set_stock'), close())}>{t('Set stock')}</DdItem>
              <DdItem onClick={() => (setBulkModal('set_category'), close())}>{t('Set category')}</DdItem>
              <DdItem onClick={() => (setBulkModal('set_tax'), close())}>{t('Set VAT rate')}</DdItem>
              <div className="dd-sep" />
              <DdItem
                danger
                onClick={async () => {
                  close();
                  if (await confirm(t('Delete {n} products? Offers linked to them will be unlinked.', { n: selected.length }), { danger: true, okText: t('Delete') })) {
                    const r = await run(() => api.post('/products/bulk', { ids: selected, action: 'delete' }), t('Deleted'));
                    if (r) refresh();
                  }
                }}
              >
                {t('Delete')}
              </DdItem>
            </>
          )}
        </Dropdown>
        <Pager page={page} perPage={50} total={q.data?.total ?? 0} onPage={(p) => setParam({ page: String(p) })} />
      </div>

      <div className="table-wrap">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <Empty icon={<Package />}>
            {t('No products')}. <Link to="/products/new">{t('Add product')}</Link>
          </Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th className="check">
                  <input
                    type="checkbox"
                    checked={rows.length > 0 && rows.every((r) => selected.includes(r.id))}
                    onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.id) : [])}
                    aria-label={t('Select all')}
                  />
                </th>
                <th style={{ width: 60 }} />
                <th className="sortable" onClick={() => sortBy('id')}>
                  ID{arrow('id')}
                </th>
                <th className="sortable" onClick={() => sortBy('name')}>
                  {t('Product name')}
                  {arrow('name')}
                </th>
                <th className="sortable" onClick={() => sortBy('sku')}>
                  SKU / EAN{arrow('sku')}
                </th>
                <th>{t('Category')}</th>
                <th className="num sortable" onClick={() => sortBy('price')}>
                  {t('Price')}
                  {arrow('price')}
                </th>
                <th className="num sortable" onClick={() => sortBy('stock')}>
                  {t('Stock')}
                  {arrow('stock')}
                </th>
                <th className="num">{t('Sold (30 d)')}</th>
                <th className="num">{t('Offers')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={selected.includes(p.id) ? 'selected' : ''}>
                  <td className="check">
                    <input
                      type="checkbox"
                      checked={selected.includes(p.id)}
                      onChange={() => setSelected((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))}
                    />
                  </td>
                  <td>
                    {p.images[0] ? (
                      <img src={p.images[0]} alt="" className="thumb thumb-sm" />
                    ) : (
                      <div className="thumb thumb-sm">
                        <Package size={18} />
                      </div>
                    )}
                  </td>
                  <td>
                    <Link to={`/products/${p.id}`}>{p.id}</Link>
                  </td>
                  <td style={{ color: '#2f343a' }}>
                    <Link to={`/products/${p.id}`} style={{ color: 'inherit' }}>
                      {p.name}
                    </Link>
                    {p.variant_count > 0 && <span className="badge-soft blue" style={{ marginLeft: 8 }}>{t('{n} variants', { n: p.variant_count })}</span>}
                    {p.manufacturer_name && <div className="text-muted text-small">{p.manufacturer_name}</div>}
                  </td>
                  <td className="text-small">
                    <div>{p.sku || '—'}</div>
                    <div className="text-muted">{p.ean}</div>
                  </td>
                  <td className="text-small">{p.category_name ?? '—'}</td>
                  <td className="num">{money(p.price)}</td>
                  <td className="num">
                    <span className={`badge-soft ${p.total_stock > 5 ? 'green' : p.total_stock > 0 ? 'orange' : 'red'}`}>{p.total_stock}</span>
                    {p.location && <div className="text-muted text-small">{p.location}</div>}
                  </td>
                  <td className="num">{p.sold_30d}</td>
                  <td className="num">{p.offer_count || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={refresh} />}
      {bulkModal && (
        <BulkModal
          action={bulkModal}
          ids={selected}
          categories={cats.data ?? []}
          onClose={() => setBulkModal(null)}
          onDone={() => {
            refresh();
            setSelected([]);
          }}
        />
      )}
    </>
  );
}

function BulkModal({ action, ids, categories, onClose, onDone }: { action: string; ids: number[]; categories: any[]; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const run = useAction();
  const [value, setValue] = useState('');
  const titles: Record<string, string> = {
    price_percent: t('Change price by %'),
    set_stock: t('Set stock'),
    set_category: t('Set category'),
    set_tax: t('Set VAT rate'),
  };
  return (
    <Modal
      title={`${titles[action]} (${ids.length})`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              const r = await run(() => api.post('/products/bulk', { ids, action, value: value.replace(',', '.') }), t('Saved'));
              if (r) {
                onDone();
                onClose();
              }
            }}
          >
            {t('Save')}
          </button>
        </>
      }
    >
      {action === 'set_category' ? (
        <select className="select" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">{t('No category')}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      ) : (
        <Field help={action === 'price_percent' ? t('e.g. 10 raises prices by 10%, -5 lowers by 5%') : undefined}>
          <input className="input" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" autoFocus />
        </Field>
      )}
    </Modal>
  );
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useT();
  const run = useAction();
  const [csv, setCsv] = useState('');
  return (
    <Modal
      title={t('Import products from CSV')}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!csv.trim()}
            onClick={async () => {
              const r = await run(() => api.post('/products/import', { csv }));
              if (r) {
                alert(t('Created: {c}, updated: {u}', { c: r.created, u: r.updated }));
                onDone();
                onClose();
              }
            }}
          >
            {t('Import')}
          </button>
        </>
      }
    >
      <p className="help-text" style={{ marginTop: 0 }}>
        {t('First row = headers. Supported columns: sku, ean, name, price, purchase_price, tax_rate, stock, weight, location, description. Products are matched by SKU (existing ones are updated).')}
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        className="mb"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) setCsv(await file.text());
        }}
      />
      <textarea className="textarea" style={{ minHeight: 200, fontFamily: 'monospace', fontSize: 12 }} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'sku;name;price;stock\nABC-1;Produkt testowy;19.99;10'} />
    </Modal>
  );
}
