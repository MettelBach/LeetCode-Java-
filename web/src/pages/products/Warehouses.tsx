import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, ClipboardList, FileText, Package, Pencil, Plus, Printer, ScanBarcode, Trash2, Undo2, Warehouse as WarehouseIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { Empty, Field, Loading, MarketplaceLogo, Modal, Switch, useAction, useConfirm, useToast } from '../../components/ui';
import { fmtDate, fmtDateTime, money, todayIso } from '../../format';
import { useT } from '../../i18n';
import {
  DOC_TYPE_LABELS,
  LANGUAGE_NAMES,
  useCatalogs,
  useCurrentCatalog,
  usePriceGroups,
  useWarehouses,
  type Catalog,
  type PriceGroup,
  type Warehouse,
} from './inventoryData';

export { useCatalogs, useWarehouses } from './inventoryData';

/* --------------------------------- warehouses --------------------------------- */

export function WarehousesPage() {
  const t = useT();
  const qc = useQueryClient();
  const run = useAction();
  const confirm = useConfirm();
  const warehouses = useWarehouses();
  const [edit, setEdit] = useState<Partial<Warehouse> | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['warehouses'] });
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          {t('Warehouses')}
          <small>{t('Physical places where you keep stock. Each product has stock per warehouse.')}</small>
        </h1>
        <div className="spacer" />
        <button className="btn btn-primary btn-pill" onClick={() => setEdit({ name: '', code: '', description: '', allow_negative: 0 })}>
          <Plus /> {t('Add warehouse')}
        </button>
      </div>
      <div className="table-wrap">
        {!warehouses.data ? (
          <Loading />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('Name')}</th>
                <th>{t('Code')}</th>
                <th>{t('Catalogs')}</th>
                <th className="num">{t('Products')}</th>
                <th className="num">{t('Units')}</th>
                <th className="num">{t('Reserved')}</th>
                <th className="num">{t('Value (avg. cost)')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {warehouses.data.map((w) => (
                <tr key={w.id}>
                  <td>
                    <b>{w.name}</b> {w.is_default ? <span className="badge-soft blue">{t('default')}</span> : null}
                    {w.allow_negative ? <span className="badge-soft orange">{t('negative stock allowed')}</span> : null}
                    <div className="text-small text-muted">{w.description}</div>
                  </td>
                  <td>{w.code}</td>
                  <td className="text-small">{w.catalogs || '—'}</td>
                  <td className="num">{w.products}</td>
                  <td className="num">{w.units}</td>
                  <td className="num">{w.reserved || '—'}</td>
                  <td className="num">{money(w.value)}</td>
                  <td className="num nowrap">
                    <Link to={`/products/documents?warehouse_id=${w.id}`} className="btn btn-xs">
                      {t('Documents')}
                    </Link>{' '}
                    <button className="icon-btn" onClick={() => setEdit(w)} aria-label={t('Edit')}>
                      <Pencil size={16} />
                    </button>
                    {!w.is_default && (
                      <button
                        className="icon-btn"
                        aria-label={t('Delete')}
                        onClick={async () => {
                          if (await confirm(t('Delete warehouse {name}?', { name: w.name }), { danger: true })) run(() => api.del(`/warehouses/${w.id}`), t('Deleted')).then(refresh);
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {edit && (
        <Modal
          title={edit.id ? t('Edit warehouse') : t('Add warehouse')}
          onClose={() => setEdit(null)}
          footer={
            <button
              className="btn btn-primary"
              disabled={!edit.name?.trim()}
              onClick={async () => {
                const body = { name: edit.name, code: edit.code, description: edit.description, is_default: !!edit.is_default, allow_negative: !!edit.allow_negative };
                const r = await run(() => (edit.id ? api.put(`/warehouses/${edit.id}`, body) : api.post('/warehouses', body)), t('Saved'));
                if (r) {
                  setEdit(null);
                  refresh();
                  qc.invalidateQueries({ queryKey: ['catalogs'] });
                }
              }}
            >
              {t('Save')}
            </button>
          }
        >
          <div className="form-grid">
            <Field label={t('Name')}>
              <input className="input" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus />
            </Field>
            <Field label={t('Code')} help={t('Short symbol used in documents and CSV columns, e.g. MAG1')}>
              <input className="input" value={edit.code ?? ''} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} maxLength={20} />
            </Field>
          </div>
          <Field label={t('Description')}>
            <input className="input" value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
          </Field>
          <label className="check-label mb">
            <Switch checked={!!edit.is_default} onChange={(v) => setEdit({ ...edit, is_default: v ? 1 : 0 })} /> {t('Default warehouse')}
          </label>
          <label className="check-label">
            <Switch checked={!!edit.allow_negative} onChange={(v) => setEdit({ ...edit, allow_negative: v ? 1 : 0 })} /> {t('Allow negative stock (documents and corrections may go below zero)')}
          </label>
        </Modal>
      )}
    </>
  );
}

/* ---------------------------------- catalogs ---------------------------------- */

export function CatalogsPage() {
  const t = useT();
  const qc = useQueryClient();
  const run = useAction();
  const confirm = useConfirm();
  const catalogs = useCatalogs();
  const warehouses = useWarehouses();
  const groups = usePriceGroups();
  const [, select] = useCurrentCatalog();
  const nav = useNavigate();
  const [edit, setEdit] = useState<Partial<Catalog> | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['catalogs'] });
  const name = (list: { id: number; name: string }[] | undefined, id: number | null) => list?.find((x) => x.id === id)?.name ?? '—';
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          {t('Catalogs')}
          <small>{t('Separate product lists (e.g. per brand or shop) with their own languages, price groups and warehouses.')}</small>
        </h1>
        <div className="spacer" />
        <button
          className="btn btn-primary btn-pill"
          onClick={() =>
            setEdit({
              name: '',
              description: '',
              languages: ['pl'],
              default_language: 'pl',
              price_group_ids: groups.data?.filter((g) => g.is_default).map((g) => g.id) ?? [],
              warehouse_ids: warehouses.data?.filter((w) => w.is_default).map((w) => w.id) ?? [],
            })
          }
        >
          <Plus /> {t('Add catalog')}
        </button>
      </div>
      <div className="table-wrap">
        {!catalogs.data ? (
          <Loading />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('Name')}</th>
                <th>{t('Languages')}</th>
                <th>{t('Price groups')}</th>
                <th>{t('Warehouses')}</th>
                <th>{t('Integrations')}</th>
                <th className="num">{t('Products')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {catalogs.data.map((c) => (
                <tr key={c.id}>
                  <td>
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        select(c.id);
                        nav('/products');
                      }}
                    >
                      <b>{c.name}</b>
                    </a>{' '}
                    {c.is_default ? <span className="badge-soft blue">{t('default')}</span> : null}
                    <div className="text-small text-muted">{c.description}</div>
                  </td>
                  <td className="text-small">{c.languages.map((l) => l.toUpperCase()).join(', ')}</td>
                  <td className="text-small">
                    {c.price_group_ids.map((id) => (
                      <div key={id}>
                        {name(groups.data, id)}
                        {id === c.default_price_group_id && <span className="text-muted"> ({t('default')})</span>}
                      </div>
                    ))}
                  </td>
                  <td className="text-small">
                    {c.warehouse_ids.map((id) => (
                      <div key={id}>
                        {name(warehouses.data, id)}
                        {id === c.default_warehouse_id && <span className="text-muted"> ({t('default')})</span>}
                      </div>
                    ))}
                  </td>
                  <td className="text-small">
                    {c.integrations.length
                      ? c.integrations.map((i) => (
                          <div key={i.id} className="nowrap">
                            <MarketplaceLogo type={i.type} size={18} /> {i.name}
                          </div>
                        ))
                      : '—'}
                  </td>
                  <td className="num">{c.products}</td>
                  <td className="num nowrap">
                    <button className="icon-btn" onClick={() => setEdit(c)} aria-label={t('Edit')}>
                      <Pencil size={16} />
                    </button>
                    {!c.is_default && (
                      <button
                        className="icon-btn"
                        aria-label={t('Delete')}
                        onClick={async () => {
                          if (await confirm(t('Delete catalog {name}?', { name: c.name }), { danger: true })) run(() => api.del(`/catalogs/${c.id}`), t('Deleted')).then(refresh);
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="text-small text-muted mt">{t('An integration uses one catalog: set it in the integration settings (tab Offers and inventory).')}</div>
      {edit && (
        <CatalogModal
          edit={edit}
          groups={groups.data ?? []}
          warehouses={warehouses.data ?? []}
          onClose={() => setEdit(null)}
          onSave={async (body) => {
            const r = await run(() => (edit.id ? api.put(`/catalogs/${edit.id}`, body) : api.post('/catalogs', body)), t('Saved'));
            if (r) {
              setEdit(null);
              refresh();
              qc.invalidateQueries({ queryKey: ['warehouses'] });
              qc.invalidateQueries({ queryKey: ['price-groups'] });
            }
          }}
        />
      )}
    </>
  );
}

function CatalogModal({
  edit,
  groups,
  warehouses,
  onClose,
  onSave,
}: {
  edit: Partial<Catalog>;
  groups: PriceGroup[];
  warehouses: Warehouse[];
  onClose: () => void;
  onSave: (b: any) => void;
}) {
  const t = useT();
  const [f, setF] = useState({
    name: edit.name ?? '',
    description: edit.description ?? '',
    is_default: !!edit.is_default,
    languages: edit.languages ?? ['pl'],
    default_language: edit.default_language ?? 'pl',
    price_group_ids: edit.price_group_ids ?? [],
    default_price_group_id: edit.default_price_group_id ?? edit.price_group_ids?.[0] ?? null,
    warehouse_ids: edit.warehouse_ids ?? [],
    default_warehouse_id: edit.default_warehouse_id ?? edit.warehouse_ids?.[0] ?? null,
  });
  const toggle = <K extends 'languages' | 'price_group_ids' | 'warehouse_ids'>(k: K, v: any) => {
    const list = f[k] as any[];
    setF({ ...f, [k]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] });
  };
  const valid = f.name.trim() && f.languages.length && f.price_group_ids.length && f.warehouse_ids.length;
  return (
    <Modal
      title={edit.id ? t('Edit catalog') : t('Add catalog')}
      size="lg"
      onClose={onClose}
      footer={
        <button
          className="btn btn-primary"
          disabled={!valid}
          onClick={() =>
            onSave({
              ...f,
              default_language: f.languages.includes(f.default_language) ? f.default_language : f.languages[0],
              default_price_group_id: f.price_group_ids.includes(f.default_price_group_id ?? -1) ? f.default_price_group_id : f.price_group_ids[0],
              default_warehouse_id: f.warehouse_ids.includes(f.default_warehouse_id ?? -1) ? f.default_warehouse_id : f.warehouse_ids[0],
            })
          }
        >
          {t('Save')}
        </button>
      }
    >
      <div className="form-grid">
        <Field label={t('Name')}>
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        </Field>
        <Field label={t('Description')}>
          <input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
      </div>
      <label className="check-label mb">
        <Switch checked={f.is_default} onChange={(v) => setF({ ...f, is_default: v })} /> {t('Default catalog')}
      </label>
      <div className="grid grid-3" style={{ gap: 18 }}>
        <div>
          <div className="field-label">{t('Languages')}</div>
          {Object.entries(LANGUAGE_NAMES).map(([code, label]) => (
            <label key={code} className="check-label pick-row">
              <input type="checkbox" checked={f.languages.includes(code)} onChange={() => toggle('languages', code)} /> {label}
              {f.languages.includes(code) && (
                <span className={`pick-default ${f.default_language === code ? 'on' : ''}`} onClick={(e) => (e.preventDefault(), setF({ ...f, default_language: code }))}>
                  {t('default')}
                </span>
              )}
            </label>
          ))}
        </div>
        <div>
          <div className="field-label">{t('Price groups')}</div>
          {groups.map((g) => (
            <label key={g.id} className="check-label pick-row">
              <input type="checkbox" checked={f.price_group_ids.includes(g.id)} onChange={() => toggle('price_group_ids', g.id)} /> {g.name} <span className="text-muted">{g.currency}</span>
              {f.price_group_ids.includes(g.id) && (
                <span className={`pick-default ${f.default_price_group_id === g.id ? 'on' : ''}`} onClick={(e) => (e.preventDefault(), setF({ ...f, default_price_group_id: g.id }))}>
                  {t('default')}
                </span>
              )}
            </label>
          ))}
          <Link to="/products/price-groups" className="text-small">
            {t('Manage price groups')}
          </Link>
        </div>
        <div>
          <div className="field-label">{t('Warehouses')}</div>
          {warehouses.map((w) => (
            <label key={w.id} className="check-label pick-row">
              <input type="checkbox" checked={f.warehouse_ids.includes(w.id)} onChange={() => toggle('warehouse_ids', w.id)} /> {w.name}
              {f.warehouse_ids.includes(w.id) && (
                <span className={`pick-default ${f.default_warehouse_id === w.id ? 'on' : ''}`} onClick={(e) => (e.preventDefault(), setF({ ...f, default_warehouse_id: w.id }))}>
                  {t('default')}
                </span>
              )}
            </label>
          ))}
        </div>
      </div>
      <p className="text-small text-muted">{t('The default warehouse receives stock of new products and manual orders; the default price group is shown in the product list.')}</p>
    </Modal>
  );
}

/* --------------------------------- price groups --------------------------------- */

export function PriceGroupsPage() {
  const t = useT();
  const qc = useQueryClient();
  const run = useAction();
  const confirm = useConfirm();
  const groups = usePriceGroups();
  const [edit, setEdit] = useState<any>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['price-groups'] });
    qc.invalidateQueries({ queryKey: ['catalogs'] });
  };
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          {t('Price groups')}
          <small>{t('Different prices of the same product, e.g. retail, wholesale or per marketplace and currency.')}</small>
        </h1>
        <div className="spacer" />
        <button className="btn btn-primary btn-pill" onClick={() => setEdit({ name: '', description: '', currency: 'PLN', copy_from: '', markup: '' })}>
          <Plus /> {t('Add price group')}
        </button>
      </div>
      <div className="table-wrap">
        {!groups.data ? (
          <Loading />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('Name')}</th>
                <th>{t('Currency')}</th>
                <th>{t('Catalogs')}</th>
                <th className="num">{t('Products with a price')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {groups.data.map((g) => (
                <tr key={g.id}>
                  <td>
                    <b>{g.name}</b> {g.is_default ? <span className="badge-soft blue">{t('default')}</span> : null}
                    <div className="text-small text-muted">{g.description}</div>
                  </td>
                  <td>{g.currency}</td>
                  <td className="text-small">{g.catalogs || '—'}</td>
                  <td className="num">{g.prices}</td>
                  <td className="num nowrap">
                    <button className="icon-btn" onClick={() => setEdit(g)} aria-label={t('Edit')}>
                      <Pencil size={16} />
                    </button>
                    {!g.is_default && (
                      <button
                        className="icon-btn"
                        aria-label={t('Delete')}
                        onClick={async () => {
                          if (await confirm(t('Delete price group {name}? Prices in this group will be deleted.', { name: g.name }), { danger: true }))
                            run(() => api.del(`/price-groups/${g.id}`), t('Deleted')).then(refresh);
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="text-small text-muted mt">{t('Which price group is sent to a marketplace is set in the integration settings.')}</div>
      {edit && (
        <Modal
          title={edit.id ? t('Edit price group') : t('Add price group')}
          onClose={() => setEdit(null)}
          footer={
            <button
              className="btn btn-primary"
              disabled={!edit.name?.trim()}
              onClick={async () => {
                const body: any = { name: edit.name, description: edit.description, currency: edit.currency };
                if (!edit.id && edit.copy_from) {
                  body.copy_from = Number(edit.copy_from);
                  body.markup = Number(String(edit.markup).replace(',', '.')) || 0;
                }
                const r = await run(() => (edit.id ? api.put(`/price-groups/${edit.id}`, body) : api.post('/price-groups', body)), t('Saved'));
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
            <Field label={t('Name')}>
              <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus />
            </Field>
            <Field label={t('Currency')}>
              <select className="select" value={edit.currency} onChange={(e) => setEdit({ ...edit, currency: e.target.value })}>
                {['PLN', 'EUR', 'CZK', 'USD', 'GBP', 'HUF', 'RON'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={t('Description')}>
            <input className="input" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
          </Field>
          {!edit.id && (
            <div className="form-grid">
              <Field label={t('Fill prices from group')}>
                <select className="select" value={edit.copy_from} onChange={(e) => setEdit({ ...edit, copy_from: e.target.value })}>
                  <option value="">{t('— empty group —')}</option>
                  {groups.data?.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </Field>
              {edit.copy_from && (
                <Field label={t('Markup (%)')}>
                  <input className="input" value={edit.markup} onChange={(e) => setEdit({ ...edit, markup: e.target.value })} inputMode="decimal" placeholder="0" />
                </Field>
              )}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

/* ----------------------------- warehouse documents ----------------------------- */

const STATUS_BADGE: Record<string, [string, string]> = { draft: ['orange', 'draft'], confirmed: ['green', 'confirmed'], canceled: ['', 'canceled'] };

export function DocumentsPage() {
  const t = useT();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const warehouses = useWarehouses();
  const query = {
    type: params.get('type') ?? undefined,
    status: params.get('status') ?? undefined,
    warehouse_id: params.get('warehouse_id') ?? undefined,
    date_from: params.get('date_from') ?? undefined,
    date_to: params.get('date_to') ?? undefined,
    search: params.get('search') ?? undefined,
  };
  const q = useQuery({ queryKey: ['warehouse-docs', query], queryFn: () => api.get<any[]>('/warehouse-docs', query) });
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n);
  };
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{t('Warehouse documents')}</h1>
        <div className="spacer" />
        <Link to="/products/stocktaking" className="btn btn-pill">
          <ClipboardList /> {t('Stocktaking')}
        </Link>
        <Link to="/products/documents/new" className="btn btn-primary btn-pill" style={{ height: 44 }}>
          <Plus /> {t('New document')}
        </Link>
      </div>
      <div className="toolbar">
        <div className="btn-group">
          {['', 'PZ', 'PW', 'WZ', 'RW', 'MM', 'ZW', 'BO', 'INW'].map((k) => (
            <button key={k} className={`btn ${(query.type ?? '') === k ? 'btn-primary' : ''}`} onClick={() => set('type', k)} title={k ? t(DOC_TYPE_LABELS[k]) : undefined}>
              {k || t('All')}
            </button>
          ))}
        </div>
        <select className="select" style={{ width: 160 }} value={query.status ?? ''} onChange={(e) => set('status', e.target.value)}>
          <option value="">{t('All statuses')}</option>
          <option value="draft">{t('draft')}</option>
          <option value="confirmed">{t('confirmed')}</option>
          <option value="canceled">{t('canceled')}</option>
        </select>
        <select className="select" style={{ width: 200 }} value={query.warehouse_id ?? ''} onChange={(e) => set('warehouse_id', e.target.value)}>
          <option value="">{t('All warehouses')}</option>
          {warehouses.data?.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <input className="input" type="date" style={{ width: 160 }} value={query.date_from ?? ''} onChange={(e) => set('date_from', e.target.value)} aria-label={t('Date from')} />
        <input className="input" type="date" style={{ width: 160 }} value={query.date_to ?? ''} onChange={(e) => set('date_to', e.target.value)} aria-label={t('Date to')} />
      </div>
      <div className="table-wrap">
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.length ? (
          <Empty icon={<FileText />}>{t('No documents')}</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('Number')}</th>
                <th>{t('Type')}</th>
                <th>{t('Date')}</th>
                <th>{t('Warehouse')}</th>
                <th>{t('Contractor')}</th>
                <th className="num">{t('Items')}</th>
                <th className="num">{t('Units')}</th>
                <th className="num">{t('Value')}</th>
                <th>{t('Status')}</th>
                <th>{t('User')}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((d) => (
                <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/products/documents/${d.id}`)}>
                  <td>
                    <Link to={`/products/documents/${d.id}`} className="order-no" style={{ fontSize: 14 }}>
                      {d.number || `${t('Draft')} #${d.id}`}
                    </Link>
                  </td>
                  <td title={t(DOC_TYPE_LABELS[d.type])}>
                    <span className={`doc-type doc-${d.type}`}>{d.type}</span>
                  </td>
                  <td className="nowrap">{fmtDate(d.doc_date)}</td>
                  <td>
                    {d.warehouse_name}
                    {d.target_name && <> → {d.target_name}</>}
                  </td>
                  <td>{d.contractor || <span className="text-muted">{d.notes}</span>}</td>
                  <td className="num">{d.items}</td>
                  <td className="num">{d.units}</td>
                  <td className="num">{money(d.value)}</td>
                  <td>
                    <span className={`badge-soft ${STATUS_BADGE[d.status]?.[0] ?? ''}`}>{t(STATUS_BADGE[d.status]?.[1] ?? d.status)}</span>
                  </td>
                  <td className="text-muted text-small">{d.user_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

interface DocLine {
  product_id: number;
  name: string;
  sku: string;
  ean: string;
  quantity: string;
  price: string;
  stock?: number;
}

/** New document or editing a draft. */
export function DocumentEditor() {
  const { id } = useParams();
  const editing = !!id;
  const t = useT();
  const nav = useNavigate();
  const run = useAction();
  const toast = useToast();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const warehouses = useWarehouses();
  const [catalog] = useCurrentCatalog();
  const existing = useQuery({ queryKey: ['warehouse-doc', id], queryFn: () => api.get<any>(`/warehouse-docs/${id}`), enabled: editing });
  const [type, setType] = useState(params.get('type') ?? 'PZ');
  const [wh, setWh] = useState<string>('');
  const [target, setTarget] = useState<string>('');
  const [date, setDate] = useState(todayIso());
  const [contractor, setContractor] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DocLine[]>([]);
  const [search, setSearch] = useState('');
  const [scan, setScan] = useState('');
  const scanRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    if (d.status !== 'draft') {
      nav(`/products/documents/${d.id}`, { replace: true });
      return;
    }
    setType(d.type);
    setWh(String(d.warehouse_id));
    setTarget(d.target_warehouse_id ? String(d.target_warehouse_id) : '');
    setDate(d.doc_date);
    setContractor(d.contractor);
    setNotes(d.notes);
    setItems(d.items.map((i: any) => ({ product_id: i.product_id, name: i.name, sku: i.sku, ean: i.ean, quantity: String(i.quantity), price: String(i.price || ''), stock: i.stock_now })));
  }, [existing.data]);
  const whId = wh || String(catalog?.default_warehouse_id ?? warehouses.data?.find((w) => w.is_default)?.id ?? '');
  const results = useQuery({
    queryKey: ['product-search', search, catalog?.id, whId],
    queryFn: () => api.get<any[]>('/products/search', { q: search, catalog_id: catalog?.id, warehouse_id: whId }),
    enabled: !!search.trim(),
  });
  const add = (p: any, qty = 1) => {
    const name = p.parent_name ? `${p.parent_name} — ${p.variant_name || p.name}` : p.name;
    setItems((cur) => {
      const ex = cur.find((i) => i.product_id === p.id);
      if (ex) return cur.map((i) => (i.product_id === p.id ? { ...i, quantity: String((Number(i.quantity) || 0) + qty) } : i));
      return [...cur, { product_id: p.id, name, sku: p.sku, ean: p.ean, quantity: String(qty), price: type === 'PZ' ? '' : String(p.avg_cost || p.purchase_price || ''), stock: p.warehouse_stock }];
    });
  };
  const onScan = async () => {
    const code = scan.trim();
    if (!code) return;
    setScan('');
    const r = await api.get<any[]>('/products/search', { q: code, catalog_id: catalog?.id, warehouse_id: whId }).catch(() => []);
    const hit = r.find((p) => p.ean === code || p.sku === code);
    if (hit) add(hit);
    else toast(t('Code {code} not found', { code }), 'error');
    scanRef.current?.focus();
  };
  const save = async (confirmIt: boolean) => {
    const body = {
      type,
      warehouse_id: Number(whId),
      target_warehouse_id: type === 'MM' ? Number(target) : null,
      doc_date: date,
      contractor,
      notes,
      confirm: confirmIt,
      items: items.map((i) => ({ product_id: i.product_id, quantity: Math.trunc(Number(i.quantity) || 0), price: Number(i.price.replace(',', '.')) || 0 })),
    };
    const r = await run(() => (editing ? api.put(`/warehouse-docs/${id}`, body) : api.post<{ id: number }>('/warehouse-docs', body)), confirmIt ? t('Document confirmed — stock updated') : t('Draft saved'));
    if (r) {
      qc.invalidateQueries({ queryKey: ['warehouse-docs'] });
      qc.invalidateQueries({ queryKey: ['warehouse-doc', id] });
      qc.invalidateQueries({ queryKey: ['products'] });
      nav(`/products/documents/${editing ? id : (r as any).id}`);
    }
  };
  if (editing && !existing.data) return <Loading />;
  const total = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.price.replace(',', '.')) || 0), 0);
  const issues = ['WZ', 'RW', 'MM'].includes(type);
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{editing ? `${t('Draft')} #${id}` : t('New warehouse document')}</h1>
        <div className="spacer" />
        <Link to={editing ? `/products/documents/${id}` : '/products/documents'} className="btn btn-outline-blue">
          <Undo2 size={18} /> {t('Back')}
        </Link>
      </div>
      <div className="card card-pad mb">
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <Field label={t('Document type')}>
            <select className="select" value={type} onChange={(e) => setType(e.target.value)} disabled={editing}>
              {Object.entries(DOC_TYPE_LABELS)
                .filter(([k]) => k !== 'INW')
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {t(v)}
                  </option>
                ))}
            </select>
          </Field>
          <Field label={t('Document date')}>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={type === 'MM' ? t('From warehouse') : t('Warehouse')}>
            <select className="select" value={whId} onChange={(e) => setWh(e.target.value)}>
              {warehouses.data?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
          {type === 'MM' ? (
            <Field label={t('To warehouse')}>
              <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">—</option>
                {warehouses.data
                  ?.filter((w) => String(w.id) !== whId)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
              </select>
            </Field>
          ) : (
            <Field label={type === 'PZ' ? t('Supplier') : type === 'WZ' ? t('Recipient') : t('Contractor')}>
              <input className="input" value={contractor} onChange={(e) => setContractor(e.target.value)} />
            </Field>
          )}
          <Field label={t('Notes')}>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </div>
      <div className="card card-pad mb">
        <div className="form-grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
          <div className="field" style={{ position: 'relative' }}>
            <input className="input" style={{ height: 46 }} placeholder={t('Add product: name, SKU, EAN...')} value={search} onChange={(e) => setSearch(e.target.value)} />
            {search && !!results.data?.length && (
              <div className="dd-menu" style={{ top: 50, width: '100%' }}>
                {results.data.map((p) => (
                  <button
                    key={p.id}
                    className="dd-item"
                    onClick={() => {
                      add(p);
                      setSearch('');
                    }}
                  >
                    <Package />
                    <span className="grow" style={{ whiteSpace: 'normal' }}>
                      {p.parent_name ? `${p.parent_name} — ${p.variant_name || p.name}` : p.name}
                    </span>
                    <span className="text-muted text-small">{p.sku}</span>
                    <span title={t('Stock in the selected warehouse')}>{p.warehouse_stock ?? p.stock}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <form
            className="scan-box"
            style={{ padding: '0 10px', height: 46, marginBottom: 16 }}
            onSubmit={(e) => {
              e.preventDefault();
              onScan();
            }}
          >
            <ScanBarcode size={22} />
            <input ref={scanRef} className="input" value={scan} onChange={(e) => setScan(e.target.value)} placeholder={t('Scan EAN / SKU')} aria-label={t('Scan EAN / SKU')} />
          </form>
        </div>
        {!items.length ? (
          <div className="text-muted">{t('Search or scan products to add them to the document.')}</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('Product')}</th>
                <th>SKU / EAN</th>
                <th className="num">{t('In warehouse')}</th>
                <th className="num">{t('Quantity')}</th>
                <th className="num">{type === 'PZ' ? t('Purchase price (net)') : t('Unit value')}</th>
                <th className="num">{t('Value')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((i, idx) => {
                const qty = Number(i.quantity) || 0;
                const short = issues && i.stock !== undefined && qty > i.stock;
                return (
                  <tr key={i.product_id}>
                    <td>
                      <Link to={`/products/${i.product_id}`}>{i.name}</Link>
                    </td>
                    <td className="text-small">
                      {i.sku}
                      <div className="text-muted">{i.ean}</div>
                    </td>
                    <td className="num" style={{ color: short ? 'var(--red)' : undefined }}>
                      {i.stock ?? '—'}
                    </td>
                    <td className="num">
                      <input
                        className="input input-sm"
                        style={{ width: 90, textAlign: 'right', borderColor: short ? 'var(--red)' : undefined }}
                        value={i.quantity}
                        onChange={(e) => setItems(items.map((x, j) => (j === idx ? { ...x, quantity: e.target.value } : x)))}
                        inputMode="numeric"
                      />
                    </td>
                    <td className="num">
                      <input
                        className="input input-sm"
                        style={{ width: 110, textAlign: 'right' }}
                        value={i.price}
                        onChange={(e) => setItems(items.map((x, j) => (j === idx ? { ...x, price: e.target.value } : x)))}
                        inputMode="decimal"
                      />
                    </td>
                    <td className="num">{money(qty * (Number(i.price.replace(',', '.')) || 0))}</td>
                    <td className="num">
                      <button className="icon-btn" onClick={() => setItems(items.filter((_, j) => j !== idx))} aria-label={t('Delete')}>
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} />
                <td className="num">
                  <b>{items.reduce((s, i) => s + (Number(i.quantity) || 0), 0)}</b>
                </td>
                <td />
                <td className="num">
                  <b>{money(total)}</b>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
      <div className="row">
        <div className="grow" />
        <button className="btn btn-pill" disabled={!items.length || (type === 'MM' && !target)} onClick={() => save(false)}>
          {t('Save draft')}
        </button>
        <button className="btn btn-primary btn-pill" disabled={!items.length || (type === 'MM' && !target)} onClick={() => save(true)}>
          <Check /> {t('Confirm document')}
        </button>
      </div>
    </>
  );
}

export function DocumentView() {
  const { id } = useParams();
  const t = useT();
  const nav = useNavigate();
  const run = useAction();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['warehouse-doc', id], queryFn: () => api.get<any>(`/warehouse-docs/${id}`) });
  const d = q.data;
  if (!d) return <Loading />;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['warehouse-doc', id] });
    qc.invalidateQueries({ queryKey: ['warehouse-docs'] });
    qc.invalidateQueries({ queryKey: ['products'] });
  };
  const sign = d.type === 'INW' ? 0 : ['WZ', 'RW', 'MM'].includes(d.type) ? -1 : 1;
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          {d.number || `${t('Draft')} #${d.id}`}
          <small>{t(DOC_TYPE_LABELS[d.type])}</small>
          <span className={`badge-soft ${STATUS_BADGE[d.status]?.[0] ?? ''}`}>{t(STATUS_BADGE[d.status]?.[1] ?? d.status)}</span>
        </h1>
        <div className="spacer" />
        {d.status === 'draft' && (
          <>
            <button
              className="btn btn-pill btn-danger-outline"
              onClick={async () => {
                if (await confirm(t('Delete the draft?'), { danger: true })) {
                  const r = await run(() => api.del(`/warehouse-docs/${d.id}`), t('Deleted'));
                  if (r) {
                    refresh();
                    nav('/products/documents');
                  }
                }
              }}
            >
              <Trash2 /> {t('Delete')}
            </button>
            <Link to={`/products/documents/${d.id}/edit`} className="btn btn-pill">
              <Pencil size={16} /> {t('Edit')}
            </Link>
            <button className="btn btn-primary btn-pill" onClick={() => run(() => api.post(`/warehouse-docs/${d.id}/confirm`), t('Document confirmed — stock updated')).then(refresh)}>
              <Check /> {t('Confirm document')}
            </button>
          </>
        )}
        {d.status === 'confirmed' && !d.reverses_doc_id && (
          <button
            className="btn btn-pill btn-danger-outline"
            onClick={async () => {
              if (await confirm(t('Cancel the document? A reverse document will be issued and stock will be restored.'), { danger: true })) {
                const r = await run(() => api.post<any>(`/warehouse-docs/${d.id}/cancel`), t('Document canceled'));
                if (r) refresh();
              }
            }}
          >
            <Ban size={16} /> {t('Cancel document')}
          </button>
        )}
        <button className="btn btn-pill" onClick={() => window.print()}>
          <Printer size={16} /> {t('Print')}
        </button>
        <Link to="/products/documents" className="btn btn-outline-blue">
          <Undo2 size={18} /> {t('Back')}
        </Link>
      </div>
      <div className="card card-pad mb">
        <dl className="kv" style={{ gridTemplateColumns: '180px 1fr 180px 1fr' }}>
          <dt>{t('Document date')}:</dt>
          <dd>{fmtDate(d.doc_date)}</dd>
          <dt>{t('Warehouse')}:</dt>
          <dd>
            {d.warehouse_name}
            {d.target_name && <> → {d.target_name}</>}
          </dd>
          <dt>{t('Contractor')}:</dt>
          <dd>{d.contractor || '—'}</dd>
          <dt>{t('Notes')}:</dt>
          <dd>{d.notes || '—'}</dd>
          <dt>{t('Created')}:</dt>
          <dd>
            {fmtDateTime(d.created_at)} {d.user_name && <span className="text-muted">({d.user_name})</span>}
          </dd>
          <dt>{t('Confirmed')}:</dt>
          <dd>{fmtDateTime(d.confirmed_at)}</dd>
          {d.reverses_number && (
            <>
              <dt>{t('Cancels document')}:</dt>
              <dd>
                <Link to={`/products/documents/${d.reverses_doc_id}`}>{d.reverses_number}</Link>
              </dd>
            </>
          )}
          {d.reversed_by_number && (
            <>
              <dt>{t('Canceled by')}:</dt>
              <dd>{d.reversed_by_number}</dd>
            </>
          )}
        </dl>
      </div>
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>{t('Product')}</th>
              <th>SKU / EAN</th>
              <th className="num">{t('Quantity')}</th>
              <th className="num">{t('Unit value')}</th>
              <th className="num">{t('Value')}</th>
              <th className="num">{t('Stock before')}</th>
              <th className="num">{t('Stock after')}</th>
              <th className="num">{t('Stock now')}</th>
            </tr>
          </thead>
          <tbody>
            {d.items.map((i: any, idx: number) => (
              <tr key={i.id}>
                <td className="text-muted">{idx + 1}</td>
                <td>{i.product_id ? <Link to={`/products/${i.product_id}`}>{i.name}</Link> : i.name}</td>
                <td className="text-small">
                  {i.sku}
                  <div className="text-muted">{i.ean}</div>
                </td>
                <td className="num" style={{ fontWeight: 600, color: d.type === 'INW' ? (i.quantity < 0 ? 'var(--red)' : 'var(--green)') : undefined }}>
                  {d.type === 'INW' && i.quantity > 0 ? `+${i.quantity}` : i.quantity}
                </td>
                <td className="num">{money(i.price)}</td>
                <td className="num">{money(i.price * i.quantity)}</td>
                <td className="num text-muted">{i.stock_before ?? '—'}</td>
                <td className="num text-muted">{i.stock_before === null || i.stock_before === undefined ? '—' : i.stock_before + (sign ? sign * i.quantity : i.quantity)}</td>
                <td className="num">{i.stock_now ?? '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} />
              <td className="num">
                <b>{d.items.reduce((s: number, i: any) => s + i.quantity, 0)}</b>
              </td>
              <td />
              <td className="num">
                <b>{money(d.items.reduce((s: number, i: any) => s + i.price * i.quantity, 0))}</b>
              </td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

/* -------------------------------- stocktaking -------------------------------- */

export function StocktakingPage() {
  const t = useT();
  const nav = useNavigate();
  const run = useAction();
  const qc = useQueryClient();
  const warehouses = useWarehouses();
  const [catalog] = useCurrentCatalog();
  const q = useQuery({ queryKey: ['stocktakes'], queryFn: () => api.get<any[]>('/stocktakes') });
  const [creating, setCreating] = useState<{ warehouse_id: string; name: string } | null>(null);
  const STATUS: Record<string, [string, string]> = { open: ['orange', 'in progress'], closed: ['green', 'closed'], canceled: ['', 'canceled'] };
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          {t('Stocktaking')}
          <small>{t('Count the goods (with a scanner or by hand); differences become an INW document.')}</small>
        </h1>
        <div className="spacer" />
        <button className="btn btn-primary btn-pill" onClick={() => setCreating({ warehouse_id: String(catalog?.default_warehouse_id ?? warehouses.data?.[0]?.id ?? ''), name: '' })}>
          <Plus /> {t('New stocktaking')}
        </button>
      </div>
      <div className="table-wrap">
        {!q.data ? (
          <Loading />
        ) : !q.data.length ? (
          <Empty icon={<ClipboardList />}>{t('No stocktaking yet')}</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('Name')}</th>
                <th>{t('Warehouse')}</th>
                <th className="num">{t('Counted')}</th>
                <th className="num">{t('Differences')}</th>
                <th>{t('Status')}</th>
                <th>{t('Document')}</th>
                <th>{t('Created')}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((s) => (
                <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/products/stocktaking/${s.id}`)}>
                  <td>
                    <b>{s.name}</b>
                  </td>
                  <td>{s.warehouse_name}</td>
                  <td className="num">
                    {s.counted} / {s.items}
                  </td>
                  <td className="num">{s.differences || '—'}</td>
                  <td>
                    <span className={`badge-soft ${STATUS[s.status]?.[0] ?? ''}`}>{t(STATUS[s.status]?.[1] ?? s.status)}</span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>{s.doc_id ? <Link to={`/products/documents/${s.doc_id}`}>{s.doc_number}</Link> : '—'}</td>
                  <td className="nowrap">
                    {fmtDateTime(s.created_at)} <span className="text-muted">{s.user_name}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {creating && (
        <Modal
          title={t('New stocktaking')}
          onClose={() => setCreating(null)}
          footer={
            <button
              className="btn btn-primary"
              onClick={async () => {
                const r = await run(() => api.post<{ id: number }>('/stocktakes', { warehouse_id: Number(creating.warehouse_id), catalog_id: catalog?.id, name: creating.name || undefined }));
                if (r) {
                  qc.invalidateQueries({ queryKey: ['stocktakes'] });
                  nav(`/products/stocktaking/${r.id}`);
                }
              }}
            >
              {t('Start')}
            </button>
          }
        >
          <Field label={t('Warehouse')}>
            <select className="select" value={creating.warehouse_id} onChange={(e) => setCreating({ ...creating, warehouse_id: e.target.value })}>
              {warehouses.data?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Name')}>
            <input className="input" value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} placeholder={t('e.g. Year-end stocktaking 2026')} />
          </Field>
          <p className="text-small text-muted">
            {t('All products of the catalog {name} are put on the list with their current stock.', { name: catalog?.name ?? '' })}
          </p>
        </Modal>
      )}
    </>
  );
}

export function StocktakeView() {
  const { id } = useParams();
  const t = useT();
  const run = useAction();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['stocktake', id], queryFn: () => api.get<any>(`/stocktakes/${id}`) });
  const [code, setCode] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [last, setLast] = useState<{ ok: boolean; text: string } | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const s = q.data;
  useEffect(() => {
    if (s) setCounts(Object.fromEntries(s.items.map((i: any) => [i.product_id, i.counted === null ? '' : String(i.counted)])));
  }, [s]);
  if (!s) return <Loading />;
  const open = s.status === 'open';
  const refresh = () => qc.invalidateQueries({ queryKey: ['stocktake', id] });
  const scan = async () => {
    const c = code.trim();
    if (!c) return;
    setCode('');
    try {
      const r = await api.post<any>(`/stocktakes/${id}/scan`, { code: c });
      setLast({ ok: true, text: `${r.name}: ${r.counted}` });
      setCounts((x) => ({ ...x, [r.product_id]: String(r.counted) }));
    } catch (e: any) {
      setLast({ ok: false, text: t(e.message) });
    }
    ref.current?.focus();
  };
  const saveCounts = () =>
    run(() => api.put(`/stocktakes/${id}/items`, Object.entries(counts).map(([pid, v]) => ({ product_id: Number(pid), counted: v === '' ? null : Math.max(0, Math.trunc(Number(v)) || 0) }))), t('Saved')).then(refresh);
  const rows = s.items.filter((i: any) => !onlyDiff || (counts[i.product_id] !== '' && Number(counts[i.product_id]) !== i.expected));
  const counted = Object.values(counts).filter((v) => v !== '').length;
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          {s.name}
          <small>
            {s.warehouse_name} · {t('Counted')}: {counted} / {s.items.length}
          </small>
        </h1>
        <div className="spacer" />
        {open && (
          <>
            <button
              className="btn btn-pill btn-danger-outline"
              onClick={async () => {
                if (await confirm(t('Cancel the stocktaking? Stock will not change.'), { danger: true })) {
                  const r = await run(() => api.del(`/stocktakes/${id}`));
                  if (r) nav('/products/stocktaking');
                }
              }}
            >
              {t('Cancel')}
            </button>
            <button className="btn btn-pill" onClick={saveCounts}>
              {t('Save counts')}
            </button>
            <button
              className="btn btn-primary btn-pill"
              onClick={async () => {
                await api.put(`/stocktakes/${id}/items`, Object.entries(counts).map(([pid, v]) => ({ product_id: Number(pid), counted: v === '' ? null : Math.max(0, Math.trunc(Number(v)) || 0) })));
                if (!(await confirm(t('Close the stocktaking? Differences will be booked as an INW document. Products that were not counted stay unchanged.')))) return;
                const r = await run(() => api.post<any>(`/stocktakes/${id}/close`, {}));
                if (r) {
                  toast(t('Stocktaking closed: {n} differences booked', { n: r.differences }), 'success');
                  refresh();
                  qc.invalidateQueries({ queryKey: ['products'] });
                }
              }}
            >
              <Check /> {t('Close and book differences')}
            </button>
          </>
        )}
        {s.doc_id && (
          <Link to={`/products/documents/${s.doc_id}`} className="btn btn-pill">
            <FileText size={16} /> {s.doc_number}
          </Link>
        )}
        <Link to="/products/stocktaking" className="btn btn-outline-blue">
          <Undo2 size={18} /> {t('Back')}
        </Link>
      </div>
      {open && (
        <div className="card card-pad mb">
          <form
            className={`scan-box ${last ? (last.ok ? 'ok' : 'err') : ''}`}
            onSubmit={(e) => {
              e.preventDefault();
              scan();
            }}
          >
            <ScanBarcode size={26} />
            <input ref={ref} className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('Scan EAN or SKU — every scan adds 1')} autoFocus aria-label={t('Scan EAN or SKU — every scan adds 1')} />
          </form>
          {last && <div className={`scan-flash ${last.ok ? 'ok' : 'err'}`}>{last.text}</div>}
        </div>
      )}
      <div className="toolbar">
        <label className="check-label">
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> {t('Only differences')}
        </label>
      </div>
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>{t('Location')}</th>
              <th>{t('Product')}</th>
              <th>SKU / EAN</th>
              <th className="num">{t('Expected')}</th>
              <th className="num">{t('Counted')}</th>
              <th className="num">{t('Difference')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i: any) => {
              const v = counts[i.product_id] ?? '';
              const diff = v === '' ? null : Number(v) - i.expected;
              return (
                <tr key={i.product_id}>
                  <td className="text-muted">{i.location}</td>
                  <td>
                    {i.name}
                    {i.variant_name && <span className="text-muted"> — {i.variant_name}</span>}
                  </td>
                  <td className="text-small">
                    {i.sku}
                    <div className="text-muted">{i.ean}</div>
                  </td>
                  <td className="num">{i.expected}</td>
                  <td className="num">
                    {open ? (
                      <input className="input input-sm" style={{ width: 80, textAlign: 'right' }} value={v} onChange={(e) => setCounts({ ...counts, [i.product_id]: e.target.value })} inputMode="numeric" />
                    ) : (
                      v || '—'
                    )}
                  </td>
                  <td className="num" style={{ fontWeight: 600, color: !diff ? undefined : diff < 0 ? 'var(--red)' : 'var(--green)' }}>
                    {diff === null ? '' : diff > 0 ? `+${diff}` : diff}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export { WarehouseIcon };
