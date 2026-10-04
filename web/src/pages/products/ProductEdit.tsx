import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Package, Plus, Save, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { api } from '../../api';
import { Empty, Field, Loading, MarketplaceLogo, Modal, Tabs, useAction, useConfirm } from '../../components/ui';
import { useSettings } from '../../data';
import { fmtDateTime, money } from '../../format';
import { useT } from '../../i18n';
import { useCategories, useManufacturers } from './ProductsPage';
import { useCatalogs, useWarehouses } from './Warehouses';

type Tab = 'general' | 'variants' | 'offers' | 'history';

const EMPTY = {
  name: '',
  sku: '',
  ean: '',
  description: '',
  price: '',
  purchase_price: '',
  tax_rate: '23',
  stock: '0',
  location: '',
  weight: '',
  width: '',
  height: '',
  length: '',
  category_id: '',
  manufacturer_id: '',
  images: [] as string[],
};

const num = (v: any) => (v === '' || v === null || v === undefined ? 0 : Number(String(v).replace(',', '.')) || 0);

export default function ProductEdit() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const run = useAction();
  const confirm = useConfirm();
  const settings = useSettings();
  const cats = useCategories();
  const mans = useManufacturers();
  const catalogs = useCatalogs();
  const warehouses = useWarehouses();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'general';
  const q = useQuery({ queryKey: ['product', id], queryFn: () => api.get<any>(`/products/${id}`), enabled: !isNew });
  const [f, setF] = useState<any>(EMPTY);
  const [imgUrl, setImgUrl] = useState('');
  useEffect(() => {
    if (q.data) {
      const p = q.data;
      setF({
        ...p,
        price: String(p.price),
        purchase_price: String(p.purchase_price),
        tax_rate: String(p.tax_rate),
        stock: String(p.stock),
        weight: String(p.weight || ''),
        width: String(p.width || ''),
        height: String(p.height || ''),
        length: String(p.length || ''),
        category_id: p.category_id ? String(p.category_id) : '',
        manufacturer_id: p.manufacturer_id ? String(p.manufacturer_id) : '',
        catalog_id: p.catalog_id ? String(p.catalog_id) : '',
        stocks: Object.fromEntries((p.stocks ?? []).map((x: any) => [x.warehouse_id, String(x.stock)])),
      });
    } else if (isNew && settings.data)
      setF({ ...EMPTY, catalog_id: params.get('catalog_id') ?? '', stocks: {}, tax_rate: String(settings.data.orders?.default_tax_rate ?? 23) });
  }, [q.data, isNew, settings.data]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x: any) => ({ ...x, [k]: e.target.value }));

  const hasVariants = (q.data?.variants?.length ?? 0) > 0;
  const save = async () => {
    const body: any = {
      name: f.name.trim(),
      sku: f.sku.trim(),
      ean: f.ean.trim(),
      description: f.description,
      price: num(f.price),
      purchase_price: num(f.purchase_price),
      tax_rate: num(f.tax_rate),
      weight: num(f.weight),
      width: num(f.width),
      height: num(f.height),
      length: num(f.length),
      location: f.location,
      category_id: f.category_id ? Number(f.category_id) : null,
      manufacturer_id: f.manufacturer_id ? Number(f.manufacturer_id) : null,
      images: f.images,
    };
    if (f.catalog_id) body.catalog_id = Number(f.catalog_id);
    if (!hasVariants) {
      if ((warehouses.data?.length ?? 0) > 1) body.stocks = Object.fromEntries(Object.entries(f.stocks ?? {}).map(([k, v]) => [k, Math.trunc(num(v))]));
      else body.stock = Math.trunc(num(f.stock));
    }
    const r = await run(() => (isNew ? api.post('/products', body) : api.put(`/products/${id}`, body)), t('Saved'));
    if (r) {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product'] });
      if (isNew) nav(`/products/${r.id}`);
    }
  };

  if (!isNew && q.isLoading) return <Loading />;
  if (!isNew && !q.data) return <Empty>{t('Product not found')}</Empty>;
  const margin = num(f.price) > 0 && num(f.purchase_price) > 0 ? ((num(f.price) / (1 + num(f.tax_rate) / 100) - num(f.purchase_price)) / (num(f.price) / (1 + num(f.tax_rate) / 100))) * 100 : null;

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          {isNew ? t('New product') : f.name}
          {!isNew && <small>ID {id}</small>}
        </h1>
        <div className="spacer" />
        {!isNew && (
          <button
            className="btn btn-pill btn-danger"
            onClick={async () => {
              if (await confirm(t('Delete this product?'), { danger: true, okText: t('Delete') })) {
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
        <button className="btn btn-primary btn-pill" style={{ height: 44, padding: '0 26px' }} onClick={save} disabled={!f.name.trim()}>
          <Save /> {t('Save')}
        </button>
      </div>

      {!isNew && (
        <Tabs<Tab>
          value={tab}
          onChange={(v) => setParams({ tab: v })}
          tabs={[
            { id: 'general', label: t('General') },
            { id: 'variants', label: `${t('Variants')} (${q.data?.variants?.length ?? 0})` },
            { id: 'offers', label: `${t('Marketplace offers')} (${q.data?.offers?.length ?? 0})` },
            { id: 'history', label: t('Stock history') },
          ]}
        />
      )}

      {tab === 'general' && (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 18 }}>
          <div className="card card-pad">
            <Field label={t('Product name')}>
              <input className="input" value={f.name} onChange={set('name')} autoFocus={isNew} maxLength={500} />
            </Field>
            <div className="form-grid">
              <Field label="SKU">
                <input className="input" value={f.sku} onChange={set('sku')} maxLength={100} />
              </Field>
              <Field label="EAN">
                <input className="input" value={f.ean} onChange={set('ean')} maxLength={50} />
              </Field>
              <Field label={t('Category')}>
                <select className="select" value={f.category_id} onChange={set('category_id')}>
                  <option value="">—</option>
                  {cats.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('Catalog')}>
                <select className="select" value={f.catalog_id ?? ''} onChange={set('catalog_id')}>
                  {!f.catalog_id && <option value="">{t('Default catalog')}</option>}
                  {catalogs.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('Manufacturer')}>
                <select className="select" value={f.manufacturer_id} onChange={set('manufacturer_id')}>
                  <option value="">—</option>
                  {mans.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label={t('Description')}>
              <textarea className="textarea" style={{ minHeight: 160 }} value={f.description} onChange={set('description')} />
            </Field>
            <div className="field-label mb">{t('Images (URL)')}</div>
            <div className="row wrap mb">
              {f.images.map((u: string, i: number) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={u} alt="" className="thumb" style={{ width: 90, height: 90 }} />
                  <button
                    className="icon-btn"
                    style={{ position: 'absolute', top: -8, right: -8, background: '#fff', boxShadow: 'var(--shadow)', borderRadius: '50%' }}
                    onClick={() => setF((x: any) => ({ ...x, images: x.images.filter((_: string, j: number) => j !== i) }))}
                    aria-label={t('Delete')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {!f.images.length && (
                <div className="thumb" style={{ width: 90, height: 90 }}>
                  <Package size={28} />
                </div>
              )}
            </div>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                if (/^https?:\/\/.+/.test(imgUrl.trim())) {
                  setF((x: any) => ({ ...x, images: [...x.images, imgUrl.trim()] }));
                  setImgUrl('');
                }
              }}
            >
              <input className="input" placeholder="https://..." value={imgUrl} onChange={(e) => setImgUrl(e.target.value)} />
              <button className="btn" type="submit">
                <Plus /> {t('Add')}
              </button>
            </form>
          </div>
          <div>
            <div className="card card-pad mb">
              <div className="card-title mb">{t('Price and stock')}</div>
              <div className="form-grid">
                <Field label={t('Price (gross)')}>
                  <input className="input" value={f.price} onChange={set('price')} inputMode="decimal" />
                </Field>
                <Field label={t('VAT (%)')}>
                  <select className="select" value={f.tax_rate} onChange={set('tax_rate')}>
                    {['23', '8', '5', '0'].map((r) => (
                      <option key={r} value={r}>
                        {r}%
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('Purchase price (net)')}>
                  <input className="input" value={f.purchase_price} onChange={set('purchase_price')} inputMode="decimal" />
                </Field>
                <Field label={t('Margin')}>
                  <input className="input" readOnly value={margin === null ? '—' : `${margin.toFixed(1)}%`} />
                </Field>
                {(warehouses.data?.length ?? 0) > 1 && !hasVariants ? (
                  <div className="full">
                    <div className="field-label mb" style={{ marginBottom: 6 }}>
                      {t('Stock in warehouses')}
                    </div>
                    {warehouses.data?.map((w) => (
                      <div key={w.id} className="row mb" style={{ marginBottom: 6 }}>
                        <span className="grow">{w.name}</span>
                        <input
                          className="input input-sm"
                          style={{ width: 100, textAlign: 'right' }}
                          value={f.stocks?.[w.id] ?? '0'}
                          onChange={(e) => setF((x: any) => ({ ...x, stocks: { ...x.stocks, [w.id]: e.target.value } }))}
                          inputMode="numeric"
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <Field label={t('Stock')} help={hasVariants ? t('Stock is managed on variants') : undefined}>
                    <input className="input" value={hasVariants ? q.data.variants.reduce((s: number, v: any) => s + v.stock, 0) : f.stock} onChange={set('stock')} inputMode="numeric" disabled={hasVariants} />
                  </Field>
                )}
                <Field label={t('Location')}>
                  <input className="input" value={f.location} onChange={set('location')} placeholder="A-01-1" />
                </Field>
              </div>
            </div>
            <div className="card card-pad mb">
              <div className="card-title mb">{t('Dimensions')}</div>
              <div className="form-grid">
                <Field label={t('Weight (kg)')}>
                  <input className="input" value={f.weight} onChange={set('weight')} inputMode="decimal" />
                </Field>
                <Field label={t('Width (cm)')}>
                  <input className="input" value={f.width} onChange={set('width')} inputMode="decimal" />
                </Field>
                <Field label={t('Height (cm)')}>
                  <input className="input" value={f.height} onChange={set('height')} inputMode="decimal" />
                </Field>
                <Field label={t('Length (cm)')}>
                  <input className="input" value={f.length} onChange={set('length')} inputMode="decimal" />
                </Field>
              </div>
            </div>
            {!isNew && !!q.data?.sales?.length && (
              <div className="card card-pad">
                <div className="card-title mb">{t('Sales (30 days)')}</div>
                <div style={{ height: 120 }}>
                  <ResponsiveContainer>
                    <BarChart data={q.data.sales}>
                      <XAxis dataKey="d" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(8, 10)} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                      <Bar dataKey="qty" fill="#1271d3" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'variants' && !isNew && <VariantsTab product={q.data} />}
      {tab === 'offers' && !isNew && <OffersTab product={q.data} />}
      {tab === 'history' && !isNew && <HistoryTab product={q.data} />}
    </>
  );
}

function VariantsTab({ product }: { product: any }) {
  const t = useT();
  const run = useAction();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [edit, setEdit] = useState<any | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['product'] });
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">{t('Variants')}</div>
        <button className="btn btn-primary btn-pill" onClick={() => setEdit({ variant_name: '', sku: '', ean: '', price: String(product.price), stock: '0' })}>
          <Plus /> {t('Add variant')}
        </button>
      </div>
      {!product.variants.length ? (
        <Empty>{t('The product has no variants (e.g. sizes or colours).')}</Empty>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>ID</th>
              <th>{t('Variant')}</th>
              <th>SKU</th>
              <th>EAN</th>
              <th className="num">{t('Price')}</th>
              <th className="num">{t('Stock')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {product.variants.map((v: any) => (
              <tr key={v.id}>
                <td>{v.id}</td>
                <td>{v.variant_name || v.name}</td>
                <td>{v.sku}</td>
                <td>{v.ean}</td>
                <td className="num">{money(v.price)}</td>
                <td className="num">
                  <span className={`badge-soft ${v.stock > 0 ? 'green' : 'red'}`}>{v.stock}</span>
                </td>
                <td className="num nowrap">
                  <button className="btn btn-xs" onClick={() => setEdit({ ...v, price: String(v.price), stock: String(v.stock) })}>
                    {t('Edit')}
                  </button>{' '}
                  <button
                    className="btn btn-xs btn-danger"
                    onClick={async () => {
                      if (await confirm(t('Delete variant?'), { danger: true })) run(() => api.del(`/products/${v.id}`)).then(refresh);
                    }}
                  >
                    {t('Delete')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {edit && (
        <Modal
          title={edit.id ? t('Edit variant') : t('Add variant')}
          onClose={() => setEdit(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEdit(null)}>
                {t('Cancel')}
              </button>
              <button
                className="btn btn-primary"
                disabled={!edit.variant_name?.trim()}
                onClick={async () => {
                  const body = {
                    parent_id: product.id,
                    name: `${product.name} ${edit.variant_name}`.trim(),
                    variant_name: edit.variant_name.trim(),
                    sku: edit.sku,
                    ean: edit.ean,
                    price: num(edit.price),
                    tax_rate: product.tax_rate,
                    weight: product.weight,
                    stock: Math.trunc(num(edit.stock)),
                  };
                  const r = await run(() => (edit.id ? api.put(`/products/${edit.id}`, body) : api.post('/products', body)), t('Saved'));
                  if (r) {
                    setEdit(null);
                    refresh();
                  }
                }}
              >
                {t('Save')}
              </button>
            </>
          }
        >
          <div className="form-grid">
            <Field label={t('Variant name (e.g. "red, XL")')} className="full">
              <input className="input" value={edit.variant_name} onChange={(e) => setEdit({ ...edit, variant_name: e.target.value })} autoFocus />
            </Field>
            <Field label="SKU">
              <input className="input" value={edit.sku} onChange={(e) => setEdit({ ...edit, sku: e.target.value })} />
            </Field>
            <Field label="EAN">
              <input className="input" value={edit.ean} onChange={(e) => setEdit({ ...edit, ean: e.target.value })} />
            </Field>
            <Field label={t('Price (gross)')}>
              <input className="input" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label={t('Stock')}>
              <input className="input" value={edit.stock} onChange={(e) => setEdit({ ...edit, stock: e.target.value })} inputMode="numeric" />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function OffersTab({ product }: { product: any }) {
  const t = useT();
  return (
    <div className="table-wrap">
      {!product.offers.length ? (
        <Empty>
          {t('The product is not linked with any marketplace offer.')} <Link to="/offers?linked=no">{t('Link offers')}</Link>
        </Empty>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>{t('Marketplace')}</th>
              <th>{t('Offer')}</th>
              <th className="num">{t('Price')}</th>
              <th className="num">{t('Stock on marketplace')}</th>
              <th>{t('Status')}</th>
              <th>{t('Last synchronization')}</th>
            </tr>
          </thead>
          <tbody>
            {product.offers.map((o: any) => (
              <tr key={o.id}>
                <td>
                  <span className="row" style={{ gap: 8 }}>
                    <MarketplaceLogo type={o.integration_type} size={26} /> {o.integration_name}
                  </span>
                </td>
                <td>
                  {o.title}
                  <div className="text-muted text-small">
                    {o.external_id}{' '}
                    {o.url && (
                      <a href={o.url} target="_blank" rel="noreferrer">
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </td>
                <td className="num">{money(o.price, o.currency)}</td>
                <td className="num">{o.stock}</td>
                <td>
                  <span className={`badge-soft ${o.status === 'active' || o.status === 'available' ? 'green' : ''}`}>{o.status}</span>
                </td>
                <td>{fmtDateTime(o.last_synced_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const REASONS: Record<string, string> = {
  order: 'Order',
  order_restore: 'Order canceled / deleted',
  order_edit: 'Order edited',
  return: 'Return',
  import: 'Import',
  'initial stock': 'Initial stock',
  'offer import': 'Imported from offer',
};

function HistoryTab({ product }: { product: any }) {
  const t = useT();
  const run = useAction();
  const qc = useQueryClient();
  const [change, setChange] = useState('');
  const [reason, setReason] = useState('');
  const canEdit = !product.variants.length;
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 18 }}>
      <div className="table-wrap">
        {!product.history.length ? (
          <Empty>{t('No stock changes')}</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('Date')}</th>
                <th>{t('Reason')}</th>
                <th>{t('Warehouse')}</th>
                <th className="num">{t('Change')}</th>
                <th className="num">{t('Stock after')}</th>
              </tr>
            </thead>
            <tbody>
              {product.history.map((h: any) => (
                <tr key={h.id}>
                  <td>{fmtDateTime(h.created_at)}</td>
                  <td>
                    {t(REASONS[h.reason] ?? h.reason)}
                    {h.order_id && (
                      <>
                        {' '}
                        — <Link to={`/orders/${h.order_id}`}>{h.order_id}</Link>
                      </>
                    )}
                  </td>
                  <td>{h.warehouse_name ?? '—'}</td>
                  <td className="num" style={{ color: h.change > 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                    {h.change > 0 ? `+${h.change}` : h.change}
                  </td>
                  <td className="num">{h.stock_after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {canEdit && (
        <div className="card card-pad" style={{ alignSelf: 'start' }}>
          <div className="card-title mb">{t('Stock correction')}</div>
          <p className="text-muted" style={{ marginTop: 0 }}>
            {t('Current stock')}: <b>{product.stock}</b>
          </p>
          <Field label={t('Change (e.g. 10 or -3)')}>
            <input className="input" value={change} onChange={(e) => setChange(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label={t('Reason')}>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('Delivery from supplier')} />
          </Field>
          <button
            className="btn btn-primary"
            disabled={!Number.isInteger(Number(change)) || Number(change) === 0}
            onClick={async () => {
              const r = await run(() => api.post(`/products/${product.id}/stock`, { change: Number(change), reason: reason || undefined }), t('Saved'));
              if (r) {
                setChange('');
                setReason('');
                qc.invalidateQueries({ queryKey: ['product'] });
              }
            }}
          >
            {t('Save')}
          </button>
        </div>
      )}
    </div>
  );
}
