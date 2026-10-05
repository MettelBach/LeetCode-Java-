import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ExternalLink, Layers, Package, Plus, Save, Star, Trash2, Undo2, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { api } from '../../api';
import { Empty, Field, Loading, MarketplaceLogo, Modal, Switch, useAction, useConfirm } from '../../components/ui';
import { useIntegrations } from '../../data';
import { fmtDateTime, money, safeHref } from '../../format';
import { useT } from '../../i18n';
import {
  categoryOptions,
  LANGUAGE_NAMES,
  useCatalogs,
  useCategories,
  useCurrentCatalog,
  useExtraFields,
  useManufacturers,
  usePriceGroups,
  useTags,
  useWarehouses,
} from './inventoryData';

type Tab = 'info' | 'texts' | 'images' | 'features' | 'prices' | 'stock' | 'variants' | 'bundle' | 'extra' | 'offers' | 'history';

const num = (v: string) => Number(String(v).replace(',', '.'));

export default function ProductEdit() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const run = useAction();
  const confirm = useConfirm();
  const [params] = useSearchParams();
  const [currentCatalog] = useCurrentCatalog();
  const catalogs = useCatalogs();
  const q = useQuery({ queryKey: ['product', id], queryFn: () => api.get<any>(`/products/${id}`), enabled: !isNew });
  const p = q.data;
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'info');
  const [f, setF] = useState<any>(null);

  useEffect(() => {
    if (isNew) {
      const catalogId = Number(params.get('catalog_id')) || currentCatalog?.id;
      if (!catalogId || f) return;
      setF({
        catalog_id: catalogId,
        name: '',
        sku: '',
        ean: '',
        tax_rate: 23,
        weight: '',
        width: '',
        height: '',
        length: '',
        location: '',
        min_stock: '',
        category_id: '',
        manufacturer_id: '',
        description: '',
        purchase_price: '',
        prices: {},
        stocks: {},
        images: [],
        features: [],
        texts: [],
        tag_ids: [],
        extra: {},
        is_bundle: false,
        bundle_items: [],
      });
    } else if (p) {
      setF({
        ...p,
        weight: p.weight || '',
        width: p.width || '',
        height: p.height || '',
        length: p.length || '',
        min_stock: p.min_stock || '',
        category_id: p.category_id ?? '',
        manufacturer_id: p.manufacturer_id ?? '',
        purchase_price: p.purchase_price || '',
        prices: Object.fromEntries(Object.entries(p.prices).map(([k, v]) => [k, String(v)])),
        stocks: Object.fromEntries(p.stocks.map((s: any) => [s.warehouse_id, String(s.stock)])),
        tag_ids: p.tags.map((x: any) => x.id),
        bundle_items: p.bundle_items.map((b: any) => ({ product_id: b.product_id, quantity: String(b.quantity), name: b.variant_name ? `${b.name} — ${b.variant_name}` : b.name, sku: b.sku, available: b.available })),
        is_bundle: !!p.is_bundle,
      });
    }
  }, [p, isNew, currentCatalog?.id]);

  if ((!isNew && !p) || !f) return <Loading />;
  const catalog = catalogs.data?.find((c) => c.id === Number(f.catalog_id));
  const hasVariants = !isNew && p.variants.length > 0;
  const set = (patch: any) => setF({ ...f, ...patch });

  const save = async () => {
    const body: any = {
      name: f.name.trim(),
      sku: f.sku.trim(),
      ean: f.ean.trim(),
      description: f.description,
      tax_rate: Number(f.tax_rate) || 0,
      weight: num(f.weight) || 0,
      width: num(f.width) || 0,
      height: num(f.height) || 0,
      length: num(f.length) || 0,
      location: f.location,
      min_stock: Math.trunc(num(f.min_stock)) || 0,
      category_id: f.category_id ? Number(f.category_id) : null,
      manufacturer_id: f.manufacturer_id ? Number(f.manufacturer_id) : null,
      purchase_price: num(f.purchase_price) || 0,
      images: f.images,
      features: f.features.filter((x: any) => x.name.trim()),
      texts: f.texts,
      tag_ids: f.tag_ids,
      extra: f.extra,
      prices: Object.fromEntries(Object.entries(f.prices).filter(([, v]) => v !== '' && Number.isFinite(num(v as string))).map(([k, v]) => [k, num(v as string)])),
    };
    if (isNew) body.catalog_id = Number(f.catalog_id);
    if (f.is_bundle || f.bundle_items.length) {
      body.bundle_items = f.bundle_items.map((b: any) => ({ product_id: b.product_id, quantity: Math.max(1, Math.trunc(num(b.quantity)) || 1) }));
      body.is_bundle = f.is_bundle;
    }
    if (isNew && !f.is_bundle) body.stocks = Object.fromEntries(Object.entries(f.stocks).filter(([, v]) => v !== '').map(([k, v]) => [k, Math.trunc(num(v as string)) || 0]));
    const r = await run(() => (isNew ? api.post<{ id: number }>('/products', body) : api.put(`/products/${id}`, body)), t('Saved'));
    if (r) {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
      if (isNew) nav(`/products/${(r as any).id}`, { replace: true });
      else qc.invalidateQueries({ queryKey: ['product', id] });
    }
  };

  const TABS: [Tab, string, boolean?][] = [
    ['info', 'Information'],
    ['texts', 'Descriptions'],
    ['images', `Images (${f.images.length})`],
    ['features', 'Parameters'],
    ['prices', 'Prices'],
    ['stock', 'Stock'],
    ['variants', `Variants (${isNew ? 0 : p.variants.length})`, isNew || f.is_bundle],
    ['bundle', 'Bundle', hasVariants],
    ['extra', 'Extra fields'],
    ['offers', `Offers (${isNew ? 0 : p.offers.length})`, isNew],
    ['history', 'History', isNew],
  ];

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          {isNew ? t('New product') : f.name}
          {!isNew && <small>ID {p.id}</small>}
          {catalog && <small className="badge-soft">{catalog.name}</small>}
        </h1>
        <div className="spacer" />
        {!isNew && (
          <button
            className="btn btn-pill btn-danger-outline"
            onClick={async () => {
              if (await confirm(t('Delete product {name}?', { name: p.name }), { danger: true })) {
                const r = await run(() => api.del(`/products/${id}`), t('Deleted'));
                if (r) {
                  qc.invalidateQueries({ queryKey: ['products'] });
                  nav('/products');
                }
              }
            }}
          >
            <Trash2 /> {t('Delete')}
          </button>
        )}
        <Link to="/products" className="btn btn-outline-blue">
          <Undo2 size={18} /> {t('Back to inventory')}
        </Link>
        <button className="btn btn-primary btn-pill" onClick={save} disabled={!f.name.trim()}>
          <Save /> {t('Save')}
        </button>
      </div>
      <div className="tabs">
        {TABS.filter(([, , hidden]) => !hidden).map(([k, label]) => (
          <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
            {t(label.replace(/ \(\d+\)$/, ''))}
            {/\((\d+)\)$/.test(label) ? ` (${/\((\d+)\)$/.exec(label)![1]})` : ''}
          </button>
        ))}
      </div>

      {tab === 'info' && <InfoTab f={f} set={set} isNew={isNew} product={p} />}
      {tab === 'texts' && <TextsTab f={f} set={set} catalog={catalog} />}
      {tab === 'images' && <ImagesTab f={f} set={set} />}
      {tab === 'features' && <FeaturesTab f={f} set={set} />}
      {tab === 'prices' && <PricesTab f={f} set={set} catalog={catalog} product={p} />}
      {tab === 'stock' && <StockTab f={f} set={set} isNew={isNew} product={p} catalog={catalog} />}
      {tab === 'variants' && !isNew && <VariantsTab product={p} />}
      {tab === 'bundle' && <BundleTab f={f} set={set} />}
      {tab === 'extra' && <ExtraTab f={f} set={set} />}
      {tab === 'offers' && !isNew && <OffersTab product={p} />}
      {tab === 'history' && !isNew && <HistoryTab product={p} />}
    </>
  );
}

/* ----------------------------------- tabs ----------------------------------- */

function InfoTab({ f, set, isNew, product }: { f: any; set: (p: any) => void; isNew: boolean; product: any }) {
  const t = useT();
  const cats = useCategories(Number(f.catalog_id));
  const mans = useManufacturers();
  const tags = useTags();
  const catalogs = useCatalogs();
  const run = useAction();
  const qc = useQueryClient();
  const addManufacturer = async () => {
    const name = window.prompt(t('Manufacturer name'));
    if (!name?.trim()) return;
    const r = await run(() => api.post<{ id: number }>('/products/meta/manufacturers', { name }));
    if (r) {
      await qc.invalidateQueries({ queryKey: ['manufacturers'] });
      set({ manufacturer_id: r.id });
    }
  };
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 18 }}>
      <div className="card card-pad">
        <Field label={t('Product name')}>
          <input className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus={isNew} maxLength={500} />
        </Field>
        <div className="form-grid">
          <Field label="SKU">
            <input className="input" value={f.sku} onChange={(e) => set({ sku: e.target.value })} maxLength={100} />
          </Field>
          <Field label="EAN">
            <input className="input" value={f.ean} onChange={(e) => set({ ean: e.target.value })} maxLength={50} inputMode="numeric" />
          </Field>
          <Field label={t('Category')}>
            <select className="select" value={f.category_id} onChange={(e) => set({ category_id: e.target.value })}>
              <option value="">{t('— none —')}</option>
              {categoryOptions(cats.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Manufacturer')}>
            <div className="row" style={{ gap: 6 }}>
              <select className="select grow" value={f.manufacturer_id} onChange={(e) => set({ manufacturer_id: e.target.value })}>
                <option value="">{t('— none —')}</option>
                {mans.data?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <button className="btn" onClick={addManufacturer} aria-label={t('Add manufacturer')} title={t('Add manufacturer')}>
                <Plus size={16} />
              </button>
            </div>
          </Field>
          <Field label={t('Catalog')}>
            <select className="select" value={f.catalog_id} disabled={!isNew} onChange={(e) => set({ catalog_id: e.target.value, category_id: '' })}>
              {catalogs.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Tags')}>
            <div className="tag-picker">
              {tags.data?.map((tg) => {
                const on = f.tag_ids.includes(tg.id);
                return (
                  <button
                    key={tg.id}
                    type="button"
                    className={`tag-chip ${on ? '' : 'off'}`}
                    style={on ? { background: tg.color } : undefined}
                    onClick={() => set({ tag_ids: on ? f.tag_ids.filter((x: number) => x !== tg.id) : [...f.tag_ids, tg.id] })}
                  >
                    {tg.name}
                  </button>
                );
              })}
              {!tags.data?.length && (
                <Link to="/products/categories?tab=tags" className="text-small">
                  {t('Create tags')}
                </Link>
              )}
            </div>
          </Field>
        </div>
        <Field label={t('Description')} help={t('Main description in the default language. Descriptions for other languages and marketplaces — tab Descriptions.')}>
          <textarea className="textarea" style={{ minHeight: 180 }} value={f.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        {!isNew && product.used_in_bundles?.length > 0 && (
          <div className="text-small text-muted">
            {t('Component of bundles')}:{' '}
            {product.used_in_bundles.map((b: any, i: number) => (
              <span key={b.id}>
                {i ? ', ' : ''}
                <Link to={`/products/${b.id}`}>{b.name}</Link>
              </span>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="card card-pad mb">
          <div className="card-title mb">{t('Shipping & storage')}</div>
          <div className="form-grid">
            <Field label={t('Weight (kg)')}>
              <input className="input" value={f.weight} onChange={(e) => set({ weight: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label={t('Location')}>
              <input className="input" value={f.location} onChange={(e) => set({ location: e.target.value })} placeholder="A-01-2" />
            </Field>
            <Field label={t('Width (cm)')}>
              <input className="input" value={f.width} onChange={(e) => set({ width: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label={t('Height (cm)')}>
              <input className="input" value={f.height} onChange={(e) => set({ height: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label={t('Length (cm)')}>
              <input className="input" value={f.length} onChange={(e) => set({ length: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label={t('Minimum stock')} help={t('Below this value the product is marked as low stock')}>
              <input className="input" value={f.min_stock} onChange={(e) => set({ min_stock: e.target.value })} inputMode="numeric" />
            </Field>
          </div>
        </div>
        {!isNew && (
          <div className="card card-pad">
            <div className="card-title mb">{t('Sales (30 days)')}</div>
            {product.sales.length ? (
              <div style={{ height: 140 }}>
                <ResponsiveContainer>
                  <BarChart data={product.sales}>
                    <XAxis dataKey="d" tickFormatter={(d: string) => d.slice(5).split('-').reverse().join('.')} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="qty" fill="#1271d3" name={t('Sold')} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-muted">{t('No sales in the last 30 days')}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TextsTab({ f, set, catalog }: { f: any; set: (p: any) => void; catalog: any }) {
  const t = useT();
  const integrations = useIntegrations();
  const langs: string[] = catalog?.languages ?? ['pl'];
  const defLang = catalog?.default_language ?? 'pl';
  const [lang, setLang] = useState(langs.find((l) => l !== defLang) ?? defLang);
  const [channel, setChannel] = useState(0);
  const isDefault = lang === defLang && channel === 0;
  const cur = f.texts.find((x: any) => x.lang === lang && x.integration_id === channel) ?? { lang, integration_id: channel, name: '', description: '' };
  const update = (patch: any) => {
    const next = f.texts.filter((x: any) => !(x.lang === lang && x.integration_id === channel));
    set({ texts: [...next, { ...cur, ...patch }] });
  };
  return (
    <div className="grid" style={{ gridTemplateColumns: '240px minmax(0, 1fr)', gap: 18 }}>
      <div className="card">
        <div className="card-pad" style={{ paddingBottom: 6 }}>
          <div className="text-small text-muted">{t('Language')}</div>
        </div>
        {langs.map((l) => (
          <div key={l} className={`side-item ${lang === l ? 'active' : ''}`} onClick={() => setLang(l)}>
            {LANGUAGE_NAMES[l] ?? l} {l === defLang && <span className="badge-soft">{t('default')}</span>}
          </div>
        ))}
        <div className="card-pad" style={{ paddingBottom: 6 }}>
          <div className="text-small text-muted">{t('Channel')}</div>
        </div>
        <div className={`side-item ${channel === 0 ? 'active' : ''}`} onClick={() => setChannel(0)}>
          {t('All channels')}
        </div>
        {integrations.data?.map((i) => (
          <div key={i.id} className={`side-item ${channel === i.id ? 'active' : ''}`} onClick={() => setChannel(i.id)}>
            <MarketplaceLogo type={i.type} size={20} /> {i.name}
          </div>
        ))}
        {!catalog?.languages?.length || catalog.languages.length < 2 ? (
          <div className="card-pad text-small text-muted">
            <Link to="/products/catalogs">{t('Add languages to the catalog')}</Link>
          </div>
        ) : null}
      </div>
      <div className="card card-pad">
        {isDefault ? (
          <>
            <Field label={t('Product name')}>
              <input className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label={t('Description')}>
              <textarea className="textarea" style={{ minHeight: 320 }} value={f.description} onChange={(e) => set({ description: e.target.value })} />
            </Field>
          </>
        ) : (
          <>
            <p className="text-muted" style={{ marginTop: 0 }}>
              {channel
                ? t('Text used only for this marketplace account. Empty fields = the text for all channels is used.')
                : t('Translation of the product. Empty fields = the default language text is used.')}
            </p>
            <Field label={t('Product name')}>
              <input className="input" value={cur.name} onChange={(e) => update({ name: e.target.value })} placeholder={f.name} />
            </Field>
            <Field label={t('Description')}>
              <textarea className="textarea" style={{ minHeight: 320 }} value={cur.description} onChange={(e) => update({ description: e.target.value })} placeholder={f.description} />
            </Field>
          </>
        )}
      </div>
    </div>
  );
}

function ImagesTab({ f, set }: { f: any; set: (p: any) => void }) {
  const t = useT();
  const [url, setUrl] = useState('');
  const imgs: string[] = f.images;
  const move = (i: number, d: number) => {
    const next = [...imgs];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    set({ images: next });
  };
  return (
    <div className="card card-pad">
      <p className="text-muted" style={{ marginTop: 0 }}>
        {t('Up to 16 images. The first one is the main image (used in lists and offers).')}
      </p>
      <div className="image-grid">
        {imgs.map((src, i) => (
          <div key={src + i} className={`image-tile ${i === 0 ? 'main' : ''}`}>
            {safeHref(src) ? <img src={src} alt="" /> : <Package />}
            {i === 0 && (
              <span className="image-main">
                <Star size={12} /> {t('Main')}
              </span>
            )}
            <div className="image-actions">
              <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('Move left')}>
                <ArrowUp size={14} style={{ transform: 'rotate(-90deg)' }} />
              </button>
              <button className="icon-btn" disabled={i === imgs.length - 1} onClick={() => move(i, 1)} aria-label={t('Move right')}>
                <ArrowDown size={14} style={{ transform: 'rotate(-90deg)' }} />
              </button>
              <button className="icon-btn" onClick={() => set({ images: imgs.filter((_, j) => j !== i) })} aria-label={t('Delete')}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {imgs.length < 16 && (
        <form
          className="row mt"
          onSubmit={(e) => {
            e.preventDefault();
            const u = url.trim();
            if (!/^https?:\/\//i.test(u)) return;
            set({ images: [...imgs, u] });
            setUrl('');
          }}
        >
          <input className="input grow" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
          <button className="btn">
            <Plus size={16} /> {t('Add image')}
          </button>
        </form>
      )}
    </div>
  );
}

function FeaturesTab({ f, set }: { f: any; set: (p: any) => void }) {
  const t = useT();
  const feats: { name: string; value: string }[] = f.features;
  const upd = (i: number, patch: any) => set({ features: feats.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <div className="card card-pad" style={{ maxWidth: 900 }}>
      <p className="text-muted" style={{ marginTop: 0 }}>
        {t('Product parameters (e.g. Material: cotton, Colour: black). They are sent to marketplaces when listing offers.')}
      </p>
      <table className="tbl">
        <thead>
          <tr>
            <th>{t('Parameter')}</th>
            <th>{t('Value')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {feats.map((x, i) => (
            <tr key={i}>
              <td>
                <input className="input" value={x.name} onChange={(e) => upd(i, { name: e.target.value })} placeholder={t('e.g. Material')} />
              </td>
              <td>
                <input className="input" value={x.value} onChange={(e) => upd(i, { value: e.target.value })} />
              </td>
              <td className="num">
                <button className="icon-btn" onClick={() => set({ features: feats.filter((_, j) => j !== i) })} aria-label={t('Delete')}>
                  <Trash2 size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn mt" onClick={() => set({ features: [...feats, { name: '', value: '' }] })}>
        <Plus size={16} /> {t('Add parameter')}
      </button>
    </div>
  );
}

function PricesTab({ f, set, catalog, product }: { f: any; set: (p: any) => void; catalog: any; product: any }) {
  const t = useT();
  const groups = usePriceGroups();
  const list = (groups.data ?? []).filter((g) => !catalog || catalog.price_group_ids.includes(g.id));
  const cost = num(f.purchase_price) || product?.avg_cost || 0;
  const vat = Number(f.tax_rate) || 0;
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 18 }}>
      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>{t('Price group')}</th>
              <th className="num">{t('Gross price')}</th>
              <th className="num">{t('Net price')}</th>
              <th className="num">{t('Margin')}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((g) => {
              const gross = num(f.prices[g.id] ?? '');
              const net = gross / (1 + vat / 100);
              const margin = cost > 0 && gross > 0 ? ((net - cost) / net) * 100 : null;
              return (
                <tr key={g.id}>
                  <td>
                    <b>{g.name}</b> {g.is_default ? <span className="badge-soft">{t('default')}</span> : null}
                    <div className="text-small text-muted">{g.description}</div>
                  </td>
                  <td className="num">
                    <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <input
                        className="input"
                        style={{ width: 130, textAlign: 'right' }}
                        value={f.prices[g.id] ?? ''}
                        onChange={(e) => set({ prices: { ...f.prices, [g.id]: e.target.value } })}
                        inputMode="decimal"
                        disabled={product?.variants?.length > 0}
                      />
                      <span className="text-muted">{g.currency}</span>
                    </div>
                  </td>
                  <td className="num text-muted">{gross ? money(net, g.currency) : '—'}</td>
                  <td className="num" style={{ color: margin === null ? undefined : margin < 0 ? 'var(--red)' : 'var(--green)' }}>
                    {margin === null ? '—' : `${margin.toFixed(1)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {product?.variants?.length > 0 && <div className="card-pad text-small text-muted">{t('Prices of a product with variants are set per variant — tab Variants.')}</div>}
        <div className="card-pad text-small">
          <Link to="/products/price-groups">{t('Manage price groups')}</Link>
        </div>
      </div>
      <div className="card card-pad">
        <Field label={t('VAT (%)')}>
          <select className="select" value={f.tax_rate} onChange={(e) => set({ tax_rate: e.target.value })}>
            {[23, 8, 5, 0].map((v) => (
              <option key={v} value={v}>
                {v}%
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Purchase price (net)')} help={t('Last purchase price. Updated automatically by goods receipts (PZ).')}>
          <input className="input" value={f.purchase_price} onChange={(e) => set({ purchase_price: e.target.value })} inputMode="decimal" />
        </Field>
        {product && (
          <dl className="kv" style={{ gridTemplateColumns: '170px 1fr' }}>
            <dt>{t('Average cost')}:</dt>
            <dd>{money(product.avg_cost)}</dd>
          </dl>
        )}
      </div>
    </div>
  );
}

function StockTab({ f, set, isNew, product, catalog }: { f: any; set: (p: any) => void; isNew: boolean; product: any; catalog: any }) {
  const t = useT();
  const run = useAction();
  const qc = useQueryClient();
  const warehouses = useWarehouses();
  const [correction, setCorrection] = useState<{ wh: number; value: string; reason: string } | null>(null);
  const list = (warehouses.data ?? []).filter((w) => !catalog || catalog.warehouse_ids.includes(w.id));
  if (f.is_bundle)
    return (
      <div className="card card-pad">
        <p style={{ marginTop: 0 }}>{t('A bundle has no own stock. Available sets are calculated from components — tab Bundle.')}</p>
        {product && (
          <div className="big-number">
            {product.available} <span className="text-muted">{t('sets available')}</span>
          </div>
        )}
      </div>
    );
  if (isNew)
    return (
      <div className="card card-pad" style={{ maxWidth: 700 }}>
        <p className="text-muted" style={{ marginTop: 0 }}>
          {t('Initial stock per warehouse (recorded in the stock history).')}
        </p>
        <div className="form-grid">
          {list.map((w) => (
            <Field key={w.id} label={w.name}>
              <input className="input" value={f.stocks[w.id] ?? ''} onChange={(e) => set({ stocks: { ...f.stocks, [w.id]: e.target.value } })} inputMode="numeric" placeholder="0" />
            </Field>
          ))}
        </div>
      </div>
    );
  const derived = product.variants.length > 0;
  return (
    <div className="card">
      <table className="tbl">
        <thead>
          <tr>
            <th>{t('Warehouse')}</th>
            <th className="num">{t('Stock')}</th>
            <th className="num">{t('Reserved')}</th>
            <th className="num">{t('Available')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {product.stocks
            .filter((s: any) => list.some((w) => w.id === s.warehouse_id) || s.stock !== 0)
            .map((s: any) => {
              const varStock = derived ? product.variants.reduce((sum: number, v: any) => sum + (v.stocks.find((x: any) => x.warehouse_id === s.warehouse_id)?.stock ?? 0), 0) : s.stock;
              const varRes = derived ? product.variants.reduce((sum: number, v: any) => sum + (v.stocks.find((x: any) => x.warehouse_id === s.warehouse_id)?.reserved ?? 0), 0) : s.reserved;
              return (
                <tr key={s.warehouse_id}>
                  <td>
                    <b>{s.name}</b> <span className="text-muted">{s.code}</span>
                  </td>
                  <td className="num">{varStock}</td>
                  <td className="num">{varRes || '—'}</td>
                  <td className="num">
                    <b>{varStock - varRes}</b>
                  </td>
                  <td className="num">
                    {!derived && (
                      <button className="btn btn-xs" onClick={() => setCorrection({ wh: s.warehouse_id, value: String(s.stock), reason: '' })}>
                        {t('Correct stock')}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
      <div className="card-pad text-small text-muted">
        {derived
          ? t('Stock of a product with variants is the sum of its variants — edit it in the tab Variants.')
          : t('Stock changes are recorded in the history. For deliveries use a goods receipt (PZ) — it also updates the purchase cost.')}{' '}
        <Link to="/products/documents/new">{t('New warehouse document')}</Link>
      </div>
      {correction && (
        <Modal
          title={t('Correct stock')}
          onClose={() => setCorrection(null)}
          footer={
            <button
              className="btn btn-primary"
              onClick={async () => {
                const r = await run(
                  () => api.post(`/products/${product.id}/stock`, { value: Math.trunc(num(correction.value)), warehouse_id: correction.wh, reason: correction.reason || undefined }),
                  t('Stock updated'),
                );
                if (r) {
                  setCorrection(null);
                  qc.invalidateQueries({ queryKey: ['product', String(product.id)] });
                  qc.invalidateQueries({ queryKey: ['products'] });
                }
              }}
            >
              {t('Save')}
            </button>
          }
        >
          <Field label={t('New stock')}>
            <input className="input" value={correction.value} onChange={(e) => setCorrection({ ...correction, value: e.target.value })} inputMode="numeric" autoFocus />
          </Field>
          <Field label={t('Reason')}>
            <input className="input" value={correction.reason} onChange={(e) => setCorrection({ ...correction, reason: e.target.value })} placeholder={t('e.g. damaged, found during counting')} />
          </Field>
        </Modal>
      )}
    </div>
  );
}

function VariantsTab({ product }: { product: any }) {
  const t = useT();
  const run = useAction();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const warehouses = useWarehouses();
  const groups = usePriceGroups();
  const catalogs = useCatalogs();
  const catalog = catalogs.data?.find((c) => c.id === product.catalog_id);
  const whs = (warehouses.data ?? []).filter((w) => !catalog || catalog.warehouse_ids.includes(w.id));
  const group = (groups.data ?? []).find((g) => g.id === catalog?.default_price_group_id) ?? groups.data?.[0];
  const [gen, setGen] = useState<{ rows: { name: string; values: string }[] } | null>(null);
  const [edit, setEdit] = useState<any>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['product', String(product.id)] });
    qc.invalidateQueries({ queryKey: ['products'] });
  };
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">{t('Variants')}</div>
        <div className="row">
          <button className="btn" onClick={() => setGen({ rows: [{ name: t('Size'), values: 'S, M, L' }] })}>
            <Wand2 size={16} /> {t('Generate variants')}
          </button>
          <button className="btn btn-primary" onClick={() => setEdit({ name: product.name, variant_name: '', sku: '', ean: '', price: String(product.price || ''), attributes: {} })}>
            <Plus size={16} /> {t('Add variant')}
          </button>
        </div>
      </div>
      {!product.variants.length ? (
        <Empty icon={<Layers />}>
          {t('No variants. Variants are versions of a product (size, colour) with their own SKU, EAN, price and stock.')}
          {product.stock !== 0 && <div className="text-small mt">{t('Zero the stock of the product first — stock is kept on variants.')}</div>}
        </Empty>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>ID</th>
              <th>{t('Variant')}</th>
              <th>SKU / EAN</th>
              <th className="num">
                {t('Price')}
                <div className="th-sub">{group?.name}</div>
              </th>
              {whs.map((w) => (
                <th key={w.id} className="num">
                  {t('Stock')}
                  <div className="th-sub">{w.code || w.name}</div>
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {product.variants.map((v: any) => (
              <tr key={v.id}>
                <td className="text-muted text-small">{v.id}</td>
                <td>
                  <b>{v.variant_name || v.name}</b>
                  <div className="text-small text-muted">
                    {Object.entries(v.attributes)
                      .map(([k, val]) => `${k}: ${val}`)
                      .join(', ')}
                  </div>
                </td>
                <td className="text-small">
                  {v.sku}
                  <div className="text-muted">{v.ean}</div>
                </td>
                <td className="num">{money(v.prices[group?.id ?? 0] ?? v.price, group?.currency)}</td>
                {whs.map((w) => {
                  const s = v.stocks.find((x: any) => x.warehouse_id === w.id);
                  return (
                    <td key={w.id} className="num">
                      <VariantStock value={s?.stock ?? 0} reserved={s?.reserved ?? 0} onSave={(n) => run(() => api.post(`/products/${v.id}/stock`, { value: n, warehouse_id: w.id }), t('Stock updated')).then(refresh)} />
                    </td>
                  );
                })}
                <td className="num nowrap">
                  <button
                    className="btn btn-xs"
                    onClick={() =>
                      setEdit({
                        id: v.id,
                        name: v.name,
                        variant_name: v.variant_name,
                        sku: v.sku,
                        ean: v.ean,
                        price: String(v.prices[group?.id ?? 0] ?? v.price),
                        attributes: v.attributes,
                      })
                    }
                  >
                    {t('Edit')}
                  </button>{' '}
                  <button
                    className="icon-btn"
                    onClick={async () => {
                      if (await confirm(t('Delete variant {name}?', { name: v.variant_name || v.sku }), { danger: true })) run(() => api.del(`/products/${v.id}`), t('Deleted')).then(refresh);
                    }}
                    aria-label={t('Delete')}
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {gen && (
        <Modal
          title={t('Generate variants')}
          onClose={() => setGen(null)}
          footer={
            <button
              className="btn btn-primary"
              onClick={async () => {
                const attributes = Object.fromEntries(
                  gen.rows
                    .filter((r) => r.name.trim() && r.values.trim())
                    .map((r) => [
                      r.name.trim(),
                      r.values
                        .split(',')
                        .map((x) => x.trim())
                        .filter(Boolean),
                    ]),
                );
                const r = await run(() => api.post<any>(`/products/${product.id}/variants/generate`, { attributes }));
                if (r) {
                  setGen(null);
                  refresh();
                }
              }}
            >
              {t('Generate')}
            </button>
          }
        >
          <p className="text-muted" style={{ marginTop: 0 }}>
            {t('Every combination of values becomes a variant. SKU = product SKU + values (e.g. TSHIRT-M-BLACK).')}
          </p>
          {gen.rows.map((r, i) => (
            <div key={i} className="form-grid">
              <Field label={t('Attribute')}>
                <input className="input" value={r.name} onChange={(e) => setGen({ rows: gen.rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              </Field>
              <Field label={t('Values (comma separated)')}>
                <input className="input" value={r.values} onChange={(e) => setGen({ rows: gen.rows.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)) })} />
              </Field>
            </div>
          ))}
          <button className="btn" onClick={() => setGen({ rows: [...gen.rows, { name: t('Colour'), values: '' }] })}>
            <Plus size={16} /> {t('Add attribute')}
          </button>
        </Modal>
      )}
      {edit && (
        <Modal
          title={edit.id ? t('Edit variant') : t('Add variant')}
          onClose={() => setEdit(null)}
          footer={
            <button
              className="btn btn-primary"
              onClick={async () => {
                const body = {
                  name: edit.name || product.name,
                  variant_name: edit.variant_name,
                  sku: edit.sku,
                  ean: edit.ean,
                  ...(group ? { prices: { [group.id]: num(edit.price) || 0 } } : {}),
                };
                const r = await run(() => (edit.id ? api.put(`/products/${edit.id}`, body) : api.post('/products', { ...body, parent_id: product.id })), t('Saved'));
                if (r) {
                  setEdit(null);
                  refresh();
                }
              }}
            >
              {t('Save')}
            </button>
          }
        >
          <div className="form-grid">
            <Field label={t('Variant name')}>
              <input className="input" value={edit.variant_name} onChange={(e) => setEdit({ ...edit, variant_name: e.target.value })} placeholder="M / Czarny" autoFocus />
            </Field>
            <Field label={`${t('Price')} (${group?.name ?? ''})`}>
              <input className="input" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label="SKU">
              <input className="input" value={edit.sku} onChange={(e) => setEdit({ ...edit, sku: e.target.value })} />
            </Field>
            <Field label="EAN">
              <input className="input" value={edit.ean} onChange={(e) => setEdit({ ...edit, ean: e.target.value })} />
            </Field>
          </div>
          <div className="text-small text-muted">{t('Stock of the variant is edited in the table, per warehouse.')}</div>
        </Modal>
      )}
    </div>
  );
}

function VariantStock({ value, reserved, onSave }: { value: number; reserved: number; onSave: (n: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
      <input
        className="input input-sm"
        style={{ width: 70, textAlign: 'right' }}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => Number(v) !== value && Number.isFinite(Number(v)) && onSave(Math.trunc(Number(v)))}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        inputMode="numeric"
      />
      {reserved ? <small className="text-muted">({reserved})</small> : null}
    </span>
  );
}

function BundleTab({ f, set }: { f: any; set: (p: any) => void }) {
  const t = useT();
  const [search, setSearch] = useState('');
  const results = useQuery({
    queryKey: ['product-search', search, f.catalog_id],
    queryFn: () => api.get<any[]>('/products/search', { q: search, catalog_id: f.catalog_id }),
    enabled: !!search.trim(),
  });
  const items: any[] = f.bundle_items;
  const sets = items.length ? Math.min(...items.map((i) => Math.floor((i.available ?? 0) / Math.max(1, num(i.quantity) || 1)))) : 0;
  return (
    <div className="card card-pad">
      <label className="check-label mb">
        <Switch checked={f.is_bundle} onChange={(v) => set({ is_bundle: v })} /> <b>{t('This product is a bundle (set of other products)')}</b>
      </label>
      <p className="text-muted">{t('A bundle has no own stock: when it is sold, the components are deducted from the warehouse. Available sets = the smallest number of complete sets the components allow.')}</p>
      {f.is_bundle && (
        <>
          <div className="field" style={{ position: 'relative' }}>
            <input className="input" placeholder={t('Add component: name, SKU, EAN...')} value={search} onChange={(e) => setSearch(e.target.value)} />
            {search && !!results.data?.length && (
              <div className="dd-menu" style={{ top: 44, width: '100%' }}>
                {results.data
                  .filter((p) => !p.is_bundle && p.id !== f.id)
                  .map((p) => (
                    <button
                      key={p.id}
                      className="dd-item"
                      onClick={() => {
                        if (!items.some((i) => i.product_id === p.id))
                          set({ bundle_items: [...items, { product_id: p.id, quantity: '1', name: p.parent_name ? `${p.parent_name} — ${p.variant_name}` : p.name, sku: p.sku, available: p.available }] });
                        setSearch('');
                      }}
                    >
                      <Package />
                      <span className="grow">{p.parent_name ? `${p.parent_name} — ${p.variant_name}` : p.name}</span>
                      <span className="text-muted text-small">{p.sku}</span>
                      <span>{p.available}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
          {items.length > 0 && (
            <table className="tbl mt">
              <thead>
                <tr>
                  <th>{t('Component')}</th>
                  <th>SKU</th>
                  <th className="num">{t('Quantity in set')}</th>
                  <th className="num">{t('Available')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((i, idx) => (
                  <tr key={i.product_id}>
                    <td>
                      <Link to={`/products/${i.product_id}`}>{i.name}</Link>
                    </td>
                    <td>{i.sku}</td>
                    <td className="num">
                      <input
                        className="input input-sm"
                        style={{ width: 80, textAlign: 'right' }}
                        value={i.quantity}
                        onChange={(e) => set({ bundle_items: items.map((x, j) => (j === idx ? { ...x, quantity: e.target.value } : x)) })}
                        inputMode="numeric"
                      />
                    </td>
                    <td className="num">{i.available ?? '—'}</td>
                    <td className="num">
                      <button className="icon-btn" onClick={() => set({ bundle_items: items.filter((_, j) => j !== idx) })} aria-label={t('Delete')}>
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {items.length > 0 && (
            <div className="big-number mt">
              {sets} <span className="text-muted">{t('sets available')}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ExtraTab({ f, set }: { f: any; set: (p: any) => void }) {
  const t = useT();
  const fields = useExtraFields();
  if (!fields.data) return <Loading />;
  if (!fields.data.length)
    return (
      <Empty>
        {t('No extra fields defined.')}{' '}
        <Link to="/products/categories?tab=extra">{t('Define extra fields')}</Link>
      </Empty>
    );
  const val = (id: number) => f.extra[id] ?? '';
  const put = (id: number, v: string) => set({ extra: { ...f.extra, [id]: v } });
  return (
    <div className="card card-pad" style={{ maxWidth: 800 }}>
      {fields.data.map((x) => (
        <Field key={x.id} label={x.name}>
          {x.kind === 'select' ? (
            <select className="select" value={val(x.id)} onChange={(e) => put(x.id, e.target.value)}>
              <option value="">—</option>
              {x.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : x.kind === 'checkbox' ? (
            <Switch checked={val(x.id) === '1'} onChange={(v) => put(x.id, v ? '1' : '')} />
          ) : x.kind === 'textarea' ? (
            <textarea className="textarea" value={val(x.id)} onChange={(e) => put(x.id, e.target.value)} />
          ) : (
            <input className="input" type={x.kind === 'date' ? 'date' : 'text'} inputMode={x.kind === 'number' ? 'decimal' : undefined} value={val(x.id)} onChange={(e) => put(x.id, e.target.value)} />
          )}
        </Field>
      ))}
    </div>
  );
}

function OffersTab({ product }: { product: any }) {
  const t = useT();
  if (!product.offers.length)
    return (
      <Empty>
        {t('The product is not linked with any marketplace offer.')} <Link to="/offers">{t('Manage offers')}</Link>
      </Empty>
    );
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>{t('Account')}</th>
            <th>{t('Offer')}</th>
            <th className="num">{t('Price')}</th>
            <th className="num">{t('Stock')}</th>
            <th>{t('Status')}</th>
            <th>{t('Last synchronization')}</th>
          </tr>
        </thead>
        <tbody>
          {product.offers.map((o: any) => (
            <tr key={o.id}>
              <td className="nowrap">
                <MarketplaceLogo type={o.integration_type} size={22} /> {o.integration_name}
              </td>
              <td>
                {o.title}
                <div className="text-small text-muted">
                  {o.external_id}{' '}
                  {safeHref(o.url) && (
                    <a href={safeHref(o.url)} target="_blank" rel="noreferrer">
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              </td>
              <td className="num">{money(o.price, o.currency)}</td>
              <td className="num">{o.stock}</td>
              <td>
                <span className={`badge-soft ${o.status === 'active' ? 'green' : ''}`}>{t(o.status)}</span>
              </td>
              <td>{fmtDateTime(o.last_synced_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryTab({ product }: { product: any }) {
  const t = useT();
  const [kind, setKind] = useState<'stock' | 'changes'>('stock');
  const FIELD: Record<string, string> = {
    name: 'Name',
    sku: 'SKU',
    ean: 'EAN',
    description: 'Description',
    category_id: 'Category',
    manufacturer_id: 'Manufacturer',
    tax_rate: 'VAT',
    weight: 'Weight',
    location: 'Location',
    images: 'Images',
    created: 'Created',
    purchase_price: 'Purchase price',
  };
  const fieldLabel = (f: string) => (f.startsWith('price:') ? `${t('Price')} (${f.slice(6)})` : t(FIELD[f] ?? f));
  const reasonLabel = (r: string) => (r === 'order' ? t('Order') : r === 'order_restore' ? t('Order canceled / restored') : r === 'order_edit' ? t('Order edited') : r === 'return' ? t('Return') : r);
  const rows: ReactNode = useMemo(
    () =>
      kind === 'stock'
        ? product.history.map((h: any) => (
            <tr key={h.id}>
              <td className="nowrap">{fmtDateTime(h.created_at)}</td>
              <td>{h.product_id !== product.id ? `${h.variant_name || h.product_name}` : ''}</td>
              <td>{h.warehouse_name}</td>
              <td className="num" style={{ color: h.change < 0 ? 'var(--red)' : 'var(--green)', fontWeight: 600 }}>
                {h.change > 0 ? `+${h.change}` : h.change}
              </td>
              <td className="num">{h.stock_after}</td>
              <td>
                {h.doc_id ? <Link to={`/products/documents/${h.doc_id}`}>{h.doc_number || reasonLabel(h.reason)}</Link> : h.order_id ? <Link to={`/orders/${h.order_id}`}>{reasonLabel(h.reason)} #{h.order_id}</Link> : reasonLabel(h.reason)}
              </td>
              <td className="text-muted">{h.user_name}</td>
            </tr>
          ))
        : product.log.map((l: any) => (
            <tr key={l.id}>
              <td className="nowrap">{fmtDateTime(l.created_at)}</td>
              <td>{fieldLabel(l.field)}</td>
              <td className="text-muted ellipsis" style={{ maxWidth: 260 }}>
                {l.old_value}
              </td>
              <td className="ellipsis" style={{ maxWidth: 260 }}>
                {l.new_value}
              </td>
              <td className="text-muted">{l.user_name}</td>
            </tr>
          )),
    [kind, product],
  );
  return (
    <div className="card">
      <div className="card-head">
        <div className="btn-group">
          <button className={`btn ${kind === 'stock' ? 'btn-primary' : ''}`} onClick={() => setKind('stock')}>
            {t('Stock history')}
          </button>
          <button className={`btn ${kind === 'changes' ? 'btn-primary' : ''}`} onClick={() => setKind('changes')}>
            {t('Change log')}
          </button>
        </div>
      </div>
      <table className="tbl">
        <thead>
          {kind === 'stock' ? (
            <tr>
              <th>{t('Date')}</th>
              <th>{t('Variant')}</th>
              <th>{t('Warehouse')}</th>
              <th className="num">{t('Change')}</th>
              <th className="num">{t('After')}</th>
              <th>{t('Reason / document')}</th>
              <th>{t('User')}</th>
            </tr>
          ) : (
            <tr>
              <th>{t('Date')}</th>
              <th>{t('Field')}</th>
              <th>{t('Before')}</th>
              <th>{t('After')}</th>
              <th>{t('User')}</th>
            </tr>
          )}
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}
