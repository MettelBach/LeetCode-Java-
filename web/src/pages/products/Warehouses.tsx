import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileText, Package, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { Empty, Field, Loading, Modal, useAction, useConfirm } from '../../components/ui';
import { fmtDateTime, money } from '../../format';
import { useT } from '../../i18n';

export function useWarehouses() {
  return useQuery({ queryKey: ['warehouses'], queryFn: () => api.get<any[]>('/warehouses'), staleTime: 30_000 });
}
export function useCatalogs() {
  return useQuery({ queryKey: ['catalogs'], queryFn: () => api.get<any[]>('/catalogs'), staleTime: 30_000 });
}

/** Generic list editor used for warehouses and catalogs. */
function NamedListPage({ kind }: { kind: 'warehouses' | 'catalogs' }) {
  const t = useT();
  const qc = useQueryClient();
  const run = useAction();
  const confirm = useConfirm();
  const wq = useWarehouses();
  const cq = useCatalogs();
  const q = kind === 'warehouses' ? wq : cq;
  const [edit, setEdit] = useState<any | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: [kind] });
  const isWh = kind === 'warehouses';
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          {isWh ? t('Warehouses') : t('Catalogs')}
          <small>{isWh ? t('Places where you keep goods. A product can have stock in several warehouses.') : t('Separate product lists, e.g. for different brands or stores.')}</small>
        </h1>
        <div className="spacer" />
        {isWh && (
          <Link to="/products/documents" className="btn btn-pill">
            <FileText /> {t('Warehouse documents')}
          </Link>
        )}
        <button className="btn btn-primary btn-pill" style={{ height: 44 }} onClick={() => setEdit({ name: '', code: '', description: '', is_default: false })}>
          <Plus /> {isWh ? t('Add warehouse') : t('Add catalog')}
        </button>
      </div>
      <div className="table-wrap">
        {q.isLoading ? (
          <Loading />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('Name')}</th>
                {isWh && <th>{t('Code')}</th>}
                <th>{t('Description')}</th>
                {isWh ? (
                  <>
                    <th className="num">{t('Products in stock')}</th>
                    <th className="num">{t('Units')}</th>
                    <th className="num">{t('Stock value (purchase)')}</th>
                  </>
                ) : (
                  <th className="num">{t('Products')}</th>
                )}
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data?.map((x) => (
                <tr key={x.id}>
                  <td>
                    <Link to={isWh ? `/products?warehouse_id=${x.id}` : `/products?catalog_id=${x.id}`} style={{ fontWeight: 600 }}>
                      {x.name}
                    </Link>
                    {!!x.is_default && <span className="badge-soft blue" style={{ marginLeft: 8 }}>{t('default')}</span>}
                  </td>
                  {isWh && <td>{x.code}</td>}
                  <td className="text-muted">{x.description}</td>
                  {isWh ? (
                    <>
                      <td className="num">{x.products}</td>
                      <td className="num">{x.units}</td>
                      <td className="num">{money(x.value)}</td>
                    </>
                  ) : (
                    <td className="num">{x.products}</td>
                  )}
                  <td className="num nowrap">
                    <button className="icon-btn" onClick={() => setEdit({ ...x, is_default: !!x.is_default })} aria-label={t('Edit')}>
                      <Pencil size={16} />
                    </button>
                    {!x.is_default && (
                      <button
                        className="icon-btn"
                        aria-label={t('Delete')}
                        onClick={async () => {
                          if (await confirm(t('Delete "{name}"?', { name: x.name }), { danger: true })) run(() => api.del(`/${kind}/${x.id}`), t('Deleted')).then(refresh);
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
          title={edit.id ? t('Edit') : isWh ? t('Add warehouse') : t('Add catalog')}
          onClose={() => setEdit(null)}
          footer={
            <button
              className="btn btn-primary"
              disabled={!edit.name.trim()}
              onClick={async () => {
                const body: any = { name: edit.name.trim(), description: edit.description, is_default: edit.is_default };
                if (isWh) body.code = edit.code;
                const r = await run(() => (edit.id ? api.put(`/${kind}/${edit.id}`, body) : api.post(`/${kind}`, body)), t('Saved'));
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
          <Field label={t('Name')}>
            <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus />
          </Field>
          {isWh && (
            <Field label={t('Code')}>
              <input className="input" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} maxLength={20} />
            </Field>
          )}
          <Field label={t('Description')}>
            <input className="input" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
          </Field>
          <label className="check-label">
            <input type="checkbox" checked={edit.is_default} onChange={(e) => setEdit({ ...edit, is_default: e.target.checked })} /> {t('Default')}
          </label>
        </Modal>
      )}
    </>
  );
}

export function WarehousesPage() {
  return <NamedListPage kind="warehouses" />;
}
export function CatalogsPage() {
  return <NamedListPage kind="catalogs" />;
}

export const DOC_TYPE_LABELS: Record<string, string> = {
  PZ: 'PZ — goods received',
  PW: 'PW — internal receipt',
  WZ: 'WZ — goods issued',
  RW: 'RW — internal issue',
  MM: 'MM — transfer between warehouses',
};

export function DocumentsPage() {
  const t = useT();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const warehouses = useWarehouses();
  const query = { type: params.get('type') ?? undefined, warehouse_id: params.get('warehouse_id') ?? undefined };
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
        <Link to="/products/documents/new" className="btn btn-primary btn-pill" style={{ height: 44 }}>
          <Plus /> {t('New document')}
        </Link>
      </div>
      <div className="toolbar">
        <div className="btn-group">
          {['', 'PZ', 'PW', 'WZ', 'RW', 'MM'].map((k) => (
            <button key={k} className={`btn ${(query.type ?? '') === k ? 'btn-primary' : ''}`} onClick={() => set('type', k)} title={k ? t(DOC_TYPE_LABELS[k]) : undefined}>
              {k || t('All')}
            </button>
          ))}
        </div>
        <select className="select" style={{ width: 220 }} value={query.warehouse_id ?? ''} onChange={(e) => set('warehouse_id', e.target.value)}>
          <option value="">{t('All warehouses')}</option>
          {warehouses.data?.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
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
                <th>{t('Warehouse')}</th>
                <th>{t('Contractor')}</th>
                <th className="num">{t('Items')}</th>
                <th className="num">{t('Units')}</th>
                <th className="num">{t('Value')}</th>
                <th>{t('Status')}</th>
                <th>{t('Date')}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((d) => (
                <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/products/documents/${d.id}`)}>
                  <td>
                    <Link to={`/products/documents/${d.id}`} className="order-no" style={{ fontSize: 14 }}>
                      {d.number}
                    </Link>
                  </td>
                  <td title={t(DOC_TYPE_LABELS[d.type])}>{d.type}</td>
                  <td>
                    {d.warehouse_name}
                    {d.target_name && <> → {d.target_name}</>}
                  </td>
                  <td>{d.contractor}</td>
                  <td className="num">{d.items}</td>
                  <td className="num">{d.units}</td>
                  <td className="num">{money(d.value)}</td>
                  <td>{d.status === 'confirmed' ? <span className="badge-soft green">{t('confirmed')}</span> : <span className="badge-soft orange">{t('draft')}</span>}</td>
                  <td className="nowrap">{fmtDateTime(d.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

export function DocumentNew() {
  const t = useT();
  const nav = useNavigate();
  const run = useAction();
  const qc = useQueryClient();
  const warehouses = useWarehouses();
  const [type, setType] = useState('PZ');
  const [wh, setWh] = useState<string>('');
  const [target, setTarget] = useState<string>('');
  const [contractor, setContractor] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<{ product_id: number; name: string; sku: string; quantity: string; price: string }[]>([]);
  const [search, setSearch] = useState('');
  const results = useQuery({ queryKey: ['product-search', search], queryFn: () => api.get<any[]>('/products/search', { q: search }), enabled: !!search.trim() });
  const whId = wh || String(warehouses.data?.find((w) => w.is_default)?.id ?? '');
  const save = async (confirm: boolean) => {
    const r = await run(
      () =>
        api.post('/warehouse-docs', {
          type,
          warehouse_id: Number(whId),
          target_warehouse_id: type === 'MM' ? Number(target) : null,
          contractor,
          notes,
          confirm,
          items: items.map((i) => ({ product_id: i.product_id, quantity: Math.max(1, Math.trunc(Number(i.quantity) || 0)), price: Number(i.price.replace(',', '.')) || 0 })),
        }),
      confirm ? t('Document confirmed — stock updated') : t('Draft saved'),
    );
    if (r) {
      qc.invalidateQueries({ queryKey: ['warehouse-docs'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      nav(`/products/documents/${r.id}`);
    }
  };
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{t('New warehouse document')}</h1>
        <div className="spacer" />
        <Link to="/products/documents" className="btn btn-outline-blue">
          <Undo2 size={18} /> {t('Back')}
        </Link>
      </div>
      <div className="card card-pad mb">
        <div className="form-grid">
          <Field label={t('Document type')}>
            <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v)}
                </option>
              ))}
            </select>
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
        <div className="field" style={{ position: 'relative' }}>
          <input className="input" style={{ height: 46 }} placeholder={t('Add product: name, SKU, EAN...')} value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && !!results.data?.length && (
            <div className="dd-menu" style={{ top: 50, width: '100%' }}>
              {results.data.map((p) => (
                <button
                  key={p.id}
                  className="dd-item"
                  onClick={() => {
                    if (!items.some((i) => i.product_id === p.id))
                      setItems([...items, { product_id: p.id, name: p.parent_name ? `${p.parent_name} — ${p.variant_name || p.name}` : p.name, sku: p.sku, quantity: '1', price: '' }]);
                    setSearch('');
                  }}
                >
                  <Package />
                  <span className="grow" style={{ whiteSpace: 'normal' }}>
                    {p.parent_name ? `${p.parent_name} — ${p.variant_name || p.name}` : p.name}
                  </span>
                  <span className="text-muted text-small">{p.sku}</span>
                  <span>{p.stock}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {!items.length ? (
          <div className="text-muted">{t('Search for products to add them to the document.')}</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('Product')}</th>
                <th>SKU</th>
                <th className="num">{t('Quantity')}</th>
                <th className="num">{type === 'PZ' ? t('Purchase price (net)') : t('Price')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((i, idx) => (
                <tr key={i.product_id}>
                  <td>{i.name}</td>
                  <td>{i.sku}</td>
                  <td className="num">
                    <input
                      className="input input-sm"
                      style={{ width: 90, textAlign: 'right' }}
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
                  <td className="num">
                    <button className="icon-btn" onClick={() => setItems(items.filter((_, j) => j !== idx))} aria-label={t('Delete')}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
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
  const qc = useQueryClient();
  const run = useAction();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['warehouse-doc', id], queryFn: () => api.get<any>(`/warehouse-docs/${id}`) });
  const d = q.data;
  if (q.isLoading) return <Loading />;
  if (!d) return <Empty>{t('Document not found')}</Empty>;
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          {d.number}
          <small>{t(DOC_TYPE_LABELS[d.type])}</small>
          {d.status === 'confirmed' ? <span className="badge-soft green">{t('confirmed')}</span> : <span className="badge-soft orange">{t('draft')}</span>}
        </h1>
        <div className="spacer" />
        {d.status !== 'confirmed' && (
          <>
            <button
              className="btn btn-pill btn-danger"
              onClick={async () => {
                if (await confirm(t('Delete the draft?'), { danger: true })) {
                  const r = await run(() => api.del(`/warehouse-docs/${d.id}`));
                  if (r) nav('/products/documents');
                }
              }}
            >
              <Trash2 /> {t('Delete')}
            </button>
            <button
              className="btn btn-primary btn-pill"
              onClick={async () => {
                const r = await run(() => api.post(`/warehouse-docs/${d.id}/confirm`), t('Document confirmed — stock updated'));
                if (r) {
                  qc.invalidateQueries();
                }
              }}
            >
              <Check /> {t('Confirm document')}
            </button>
          </>
        )}
        <button className="btn btn-pill" onClick={() => window.print()}>
          {t('Print')}
        </button>
        <Link to="/products/documents" className="btn btn-outline-blue">
          <Undo2 size={18} /> {t('Back')}
        </Link>
      </div>
      <div className="card card-pad mb">
        <dl className="kv" style={{ gridTemplateColumns: '170px 1fr' }}>
          <dt>{t('Warehouse')}:</dt>
          <dd>
            {d.warehouse_name}
            {d.target_name && <> → {d.target_name}</>}
          </dd>
          {d.contractor && (
            <>
              <dt>{t('Contractor')}:</dt>
              <dd>{d.contractor}</dd>
            </>
          )}
          <dt>{t('Created')}:</dt>
          <dd>{fmtDateTime(d.created_at)}</dd>
          {d.confirmed_at && (
            <>
              <dt>{t('Confirmed')}:</dt>
              <dd>
                {fmtDateTime(d.confirmed_at)} ({d.user_name})
              </dd>
            </>
          )}
          {d.notes && (
            <>
              <dt>{t('Notes')}:</dt>
              <dd>{d.notes}</dd>
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
              <th className="num">{t('Price')}</th>
              <th className="num">{t('Value')}</th>
              <th className="num">{t('Stock now')}</th>
            </tr>
          </thead>
          <tbody>
            {d.items.map((i: any, idx: number) => (
              <tr key={i.id}>
                <td>{idx + 1}</td>
                <td>
                  <Link to={`/products/${i.product_id}`}>{i.name}</Link>
                </td>
                <td className="text-small">
                  {i.sku} {i.ean && <span className="text-muted">/ {i.ean}</span>}
                </td>
                <td className="num">{i.quantity}</td>
                <td className="num">{money(i.price)}</td>
                <td className="num">{money(i.price * i.quantity)}</td>
                <td className="num">{i.stock_now}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
