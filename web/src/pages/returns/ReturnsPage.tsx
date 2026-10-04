import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, PackageCheck, Plus, RotateCcw, Search, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { Empty, Field, Loading, Modal, Pager, SourceIcon, Switch, useAction, useConfirm } from '../../components/ui';
import { fmtDateTime, money } from '../../format';
import { useT } from '../../i18n';

export default function ReturnsPage() {
  const t = useT();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [creating, setCreating] = useState(params.get('new') === '1');
  const page = Number(params.get('page') ?? 1);
  const query = { status_id: params.get('status_id') ?? undefined, search: params.get('search') ?? undefined, page, per_page: 50 };
  const q = useQuery({ queryKey: ['returns', query], queryFn: () => api.get<any>('/returns', query), placeholderData: keepPreviousData });
  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };
  const statuses: any[] = q.data?.statuses ?? [];
  const smap = new Map(statuses.map((s) => [s.id, s]));
  const rows: any[] = q.data?.rows ?? [];
  return (
    <div className="orders-layout">
      <div className="status-col">
        <button className="btn-add-order" onClick={() => setCreating(true)}>
          <span className="plus">
            <Plus size={22} strokeWidth={2.4} />
          </span>
          <span className="label">{t('Add return')}</span>
        </button>
        <div className="status-list">
          <a href="/returns" className={`status-row all ${!query.status_id ? 'active' : ''}`} onClick={(e) => (e.preventDefault(), setParam({ status_id: null }))}>
            <RotateCcw size={18} /> {t('All returns')}
          </a>
          {statuses.map((s) => (
            <a
              key={s.id}
              href={`/returns?status_id=${s.id}`}
              className={`status-row ${query.status_id === String(s.id) ? 'active' : ''}`}
              onClick={(e) => (e.preventDefault(), setParam({ status_id: String(s.id) }))}
            >
              <span className="count-box" style={{ background: s.color }}>
                {s.count || '-'}
              </span>
              {s.name}
            </a>
          ))}
        </div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="page-head">
          <h1 className="page-title">{t('Returns')}</h1>
        </div>
        <div className="toolbar">
          <form
            className="searchbox-input"
            style={{ height: 40, maxWidth: 320, flex: 1 }}
            onSubmit={(e) => {
              e.preventDefault();
              setParam({ search: search.trim() || null });
            }}
          >
            <Search size={18} />
            <input placeholder={t('Return no., order no., buyer')} value={search} onChange={(e) => setSearch(e.target.value)} style={{ border: 0, outline: 0, flex: 1 }} />
          </form>
          <Pager page={page} perPage={50} total={q.data?.total ?? 0} onPage={(p) => setParam({ page: String(p) })} />
        </div>
        <div className="table-wrap">
          {q.isLoading ? (
            <Loading />
          ) : !rows.length ? (
            <Empty icon={<RotateCcw />}>{t('No returns')}</Empty>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('Number')}</th>
                  <th>{t('Order')}</th>
                  <th>{t('Buyer')}</th>
                  <th>{t('Products')}</th>
                  <th className="num">{t('Refund')}</th>
                  <th>{t('Status')}</th>
                  <th>{t('Date')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const s = smap.get(r.status_id);
                  return (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/returns/${r.id}`)}>
                      <td>
                        <Link to={`/returns/${r.id}`} className="order-no" style={{ fontSize: 14 }}>
                          #{r.id}
                        </Link>
                      </td>
                      <td>
                        {r.order_id ? (
                          <span className="row" style={{ gap: 6 }}>
                            <SourceIcon source={r.order_source ?? 'manual'} />
                            <Link to={`/orders/${r.order_id}`} onClick={(e) => e.stopPropagation()}>
                              {r.order_id}
                            </Link>
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {r.buyer_name}
                        <div className="text-muted text-small">{r.buyer_email}</div>
                      </td>
                      <td className="items-cell">
                        {r.items.map((i: any, idx: number) => (
                          <div key={idx}>
                            <i>{i.quantity}x</i> {i.name}
                          </div>
                        ))}
                      </td>
                      <td className="num">
                        {money(r.refund_amount, r.currency)}
                        {r.refunded ? <div className="text-small" style={{ color: 'var(--green)' }}>✓ {t('refunded')}</div> : null}
                      </td>
                      <td>{s && <span className="badge" style={{ background: s.color }}>{s.name}</span>}</td>
                      <td className="nowrap">{fmtDateTime(r.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {creating && <NewReturnModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewReturnModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const run = useAction();
  const [orderId, setOrderId] = useState('');
  const [reason, setReason] = useState('');
  return (
    <Modal
      title={t('Add return')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!/^\d+$/.test(orderId.trim())}
            onClick={async () => {
              const r = await run(() => api.post(`/orders/${orderId.trim()}/returns`, { reason }), t('Return created'));
              if (r) nav(`/returns/${r.id}`);
            }}
          >
            {t('Create')}
          </button>
        </>
      }
    >
      <Field label={t('Order number')} help={t('All products of the order are added; you can change quantities later.')}>
        <input className="input" value={orderId} onChange={(e) => setOrderId(e.target.value)} autoFocus inputMode="numeric" />
      </Field>
      <Field label={t('Reason')}>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}

export function ReturnDetail() {
  const { id } = useParams();
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const run = useAction();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['return', id], queryFn: () => api.get<any>(`/returns/${id}`) });
  const statuses = useQuery({ queryKey: ['returns', { per_page: 1 }], queryFn: () => api.get<any>('/returns', { per_page: 1 }) });
  const [f, setF] = useState<any>(null);
  useEffect(() => {
    if (q.data) setF({ ...q.data, refund_amount: String(q.data.refund_amount) });
  }, [q.data]);
  if (q.isLoading || !f) return <Loading />;
  const r = q.data;
  const save = async () => {
    const res = await run(
      () =>
        api.put(`/returns/${r.id}`, {
          status_id: Number(f.status_id),
          reason: f.reason,
          refund_amount: Number(String(f.refund_amount).replace(',', '.')) || 0,
          bank_account: f.bank_account,
          tracking_number: f.tracking_number,
          notes: f.notes,
          refunded: !!f.refunded,
          items: f.items.filter((i: any) => i.quantity > 0),
        }),
      t('Saved'),
    );
    if (res) qc.invalidateQueries({ queryKey: ['return'] });
  };
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          {t('Return')} #{r.id}
          <small>{fmtDateTime(r.created_at)}</small>
        </h1>
        <div className="spacer" />
        <button className="btn btn-pill" onClick={() => run(() => api.openPdf(`/returns/${r.id}/pdf`))}>
          <FileDown /> {t('Return protocol')}
        </button>
        <button
          className="btn btn-pill"
          disabled={!!r.stock_returned}
          title={r.stock_returned ? t('Already returned to stock') : undefined}
          onClick={async () => {
            if (await confirm(t('Return the products to stock?'))) {
              const res = await run(() => api.post(`/returns/${r.id}/stock`), t('Products returned to stock'));
              if (res) qc.invalidateQueries({ queryKey: ['return'] });
            }
          }}
        >
          <PackageCheck /> {r.stock_returned ? t('Returned to stock') : t('Return to stock')}
        </button>
        {!r.stock_returned && (
          <button
            className="btn btn-pill btn-danger"
            onClick={async () => {
              if (await confirm(t('Delete this return?'), { danger: true })) {
                const res = await run(() => api.del(`/returns/${r.id}`));
                if (res) nav('/returns');
              }
            }}
          >
            {t('Delete')}
          </button>
        )}
        <Link to="/returns" className="btn btn-outline-blue">
          <Undo2 size={18} /> {t('Back')}
        </Link>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 18 }}>
        <div>
          <div className="table-wrap mb">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('Product')}</th>
                  <th>SKU</th>
                  <th className="num">{t('Quantity')}</th>
                  <th className="num">{t('Price')}</th>
                </tr>
              </thead>
              <tbody>
                {f.items.map((i: any, idx: number) => (
                  <tr key={idx}>
                    <td>{i.name}</td>
                    <td>{i.sku}</td>
                    <td className="num">
                      <input
                        className="input input-sm"
                        style={{ width: 70, textAlign: 'right' }}
                        type="number"
                        min={0}
                        value={i.quantity}
                        disabled={!!r.stock_returned}
                        onChange={(e) => setF({ ...f, items: f.items.map((x: any, j: number) => (j === idx ? { ...x, quantity: Math.max(0, Number(e.target.value) || 0) } : x)) })}
                      />
                    </td>
                    <td className="num">{money(i.price, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card card-pad">
            <div className="card-title mb">{t('Buyer')}</div>
            <dl className="kv">
              <dt>{t('Name')}:</dt>
              <dd>{r.buyer_name || '—'}</dd>
              <dt>{t('E-mail')}:</dt>
              <dd>{r.buyer_email || '—'}</dd>
              <dt>{t('Order')}:</dt>
              <dd>{r.order_id ? <Link to={`/orders/${r.order_id}`}>{r.order_id}</Link> : '—'}</dd>
            </dl>
          </div>
        </div>
        <div className="card card-pad">
          <Field label={t('Status')}>
            <select className="select" value={f.status_id} onChange={(e) => setF({ ...f, status_id: e.target.value })}>
              {statuses.data?.statuses.map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Reason')}>
            <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
          </Field>
          <Field label={`${t('Refund amount')} (${r.currency})`}>
            <input className="input" value={f.refund_amount} onChange={(e) => setF({ ...f, refund_amount: e.target.value })} inputMode="decimal" />
          </Field>
          <Field label={t('Bank account for refund')}>
            <input className="input" value={f.bank_account} onChange={(e) => setF({ ...f, bank_account: e.target.value })} />
          </Field>
          <Field label={t('Return parcel tracking number')}>
            <input className="input" value={f.tracking_number} onChange={(e) => setF({ ...f, tracking_number: e.target.value })} />
          </Field>
          <Field label={t('Notes')}>
            <textarea className="textarea" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
          <label className="check-label mb">
            <Switch checked={!!f.refunded} onChange={(v) => setF({ ...f, refunded: v })} /> {t('Money refunded to the buyer')}
          </label>
          <div>
            <button className="btn btn-primary" onClick={save}>
              {t('Save')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
