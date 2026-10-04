import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, Search, Send, Truck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Empty, Loading, Modal, Pager, SourceIcon, useAction, useToast } from '../components/ui';
import { COURIER_NAMES, COURIERS } from '../data';
import { fmtDateTime, money } from '../format';
import { useT } from '../i18n';
import { SHIP_STATUS_LABEL } from './orders/OrderCard';

export default function ShipmentsPage() {
  const t = useT();
  const qc = useQueryClient();
  const run = useAction();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [selected, setSelected] = useState<number[]>([]);
  const [manifest, setManifest] = useState<any[] | null>(null);
  const page = Number(params.get('page') ?? 1);
  const query = {
    courier: params.get('courier') ?? undefined,
    status: params.get('status') ?? undefined,
    search: params.get('search') ?? undefined,
    date_from: params.get('date_from') ?? undefined,
    date_to: params.get('date_to') ?? undefined,
    page,
    per_page: 50,
  };
  const q = useQuery({ queryKey: ['shipments', query], queryFn: () => api.get<any>('/shipments', query), placeholderData: keepPreviousData });
  useEffect(() => setSelected([]), [JSON.stringify(query)]);
  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ['shipments'] });
  const rows: any[] = q.data?.rows ?? [];
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{t('Shipments')}</h1>
        <div className="spacer" />
        <button
          className="btn btn-pill"
          disabled={!selected.length}
          onClick={async () => {
            const r = await run(() => api.get<any[]>('/shipments/manifest', { ids: selected }));
            if (r) setManifest(r);
          }}
        >
          <Printer /> {t('Pickup protocol')}
        </button>
        <button
          className="btn btn-primary btn-pill"
          disabled={!selected.length}
          onClick={() => run(() => api.openPdf('/shipments/labels', { ids: selected })).then(refresh)}
        >
          <Printer /> {t('Print labels ({n})', { n: selected.length })}
        </button>
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
          <input placeholder={t('Tracking number, order, buyer')} value={search} onChange={(e) => setSearch(e.target.value)} style={{ border: 0, outline: 0, flex: 1 }} />
        </form>
        <select className="select" style={{ width: 190 }} value={query.courier ?? ''} onChange={(e) => setParam({ courier: e.target.value || null })}>
          <option value="">{t('All couriers')}</option>
          {COURIERS.map((c) => (
            <option key={c} value={c}>
              {COURIER_NAMES[c]}
            </option>
          ))}
        </select>
        <select className="select" style={{ width: 190 }} value={query.status ?? ''} onChange={(e) => setParam({ status: e.target.value || null })}>
          <option value="">{t('All statuses')}</option>
          {Object.entries(SHIP_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {t(v)}
            </option>
          ))}
        </select>
        <input className="input" type="date" style={{ width: 160 }} value={query.date_from ?? ''} onChange={(e) => setParam({ date_from: e.target.value || null })} aria-label={t('Date from')} />
        <input className="input" type="date" style={{ width: 160 }} value={query.date_to ?? ''} onChange={(e) => setParam({ date_to: e.target.value || null })} aria-label={t('Date to')} />
        <Pager page={page} perPage={50} total={q.data?.total ?? 0} onPage={(p) => setParam({ page: String(p) })} />
      </div>
      <div className="table-wrap">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <Empty icon={<Truck />}>{t('No shipments. Create them from the order list (truck button) or in the order card.')}</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th className="check">
                  <input type="checkbox" checked={rows.every((r) => selected.includes(r.id))} onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.id) : [])} />
                </th>
                <th>{t('Shipment date')}</th>
                <th>{t('Order')}</th>
                <th>{t('Recipient')}</th>
                <th>{t('Courier')}</th>
                <th>{t('Package number')}</th>
                <th className="num">{t('Weight')}</th>
                <th className="num">{t('COD')}</th>
                <th>{t('Status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className={selected.includes(s.id) ? 'selected' : ''}>
                  <td className="check">
                    <input type="checkbox" checked={selected.includes(s.id)} onChange={() => setSelected((x) => (x.includes(s.id) ? x.filter((y) => y !== s.id) : [...x, s.id]))} />
                  </td>
                  <td className="nowrap">{fmtDateTime(s.created_at)}</td>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      <SourceIcon source={s.source} />
                      <Link to={`/orders/${s.order_id}`} className="order-no" style={{ fontSize: 14 }}>
                        {s.order_id}
                      </Link>
                    </span>
                  </td>
                  <td>
                    {s.delivery_fullname}
                    <div className="text-muted text-small">{s.delivery_city}</div>
                  </td>
                  <td>{COURIER_NAMES[s.courier] ?? s.courier}</td>
                  <td className="code" style={{ background: 'none' }}>
                    {s.tracking_number}
                  </td>
                  <td className="num">{s.weight ? `${s.weight} kg` : '—'}</td>
                  <td className="num">{s.cod_amount > 0 ? money(s.cod_amount, s.currency) : '—'}</td>
                  <td>
                    <select
                      className="select input-sm"
                      style={{ width: 190 }}
                      value={s.status}
                      onChange={(e) => run(() => api.put(`/shipments/${s.id}/status`, { status: e.target.value })).then(refresh)}
                    >
                      {Object.entries(SHIP_STATUS_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {t(v)}
                        </option>
                      ))}
                    </select>
                    {s.label_printed ? <div className="text-muted text-small">✓ {t('Label printed')}</div> : null}
                  </td>
                  <td className="num nowrap">
                    <button className="btn btn-xs" onClick={() => run(() => api.openPdf('/shipments/labels', { ids: [s.id] })).then(refresh)} title={t('Label')}>
                      <Printer size={14} />
                    </button>{' '}
                    {s.source !== 'manual' && !s.sent_to_source && (
                      <button
                        className="btn btn-xs"
                        title={t('Send number to marketplace')}
                        onClick={async () => {
                          const r = await run(() => api.post(`/shipments/${s.id}/send-tracking`));
                          if (r) {
                            toast(t('Sent'), 'success');
                            refresh();
                          }
                        }}
                      >
                        <Send size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {manifest && (
        <Modal
          title={t('Pickup protocol')}
          size="lg"
          onClose={() => setManifest(null)}
          footer={
            <button className="btn btn-primary" onClick={() => window.print()}>
              <Printer /> {t('Print')}
            </button>
          }
        >
          <div className="print-area">
            <p>
              {t('Date')}: {new Date().toLocaleDateString()} · {t('Packages')}: <b>{manifest.length}</b>
            </p>
            <table className="tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('Courier')}</th>
                  <th>{t('Package number')}</th>
                  <th>{t('Order')}</th>
                  <th>{t('Recipient')}</th>
                  <th className="num">{t('Weight')}</th>
                  <th className="num">{t('COD')}</th>
                </tr>
              </thead>
              <tbody>
                {manifest.map((m, i) => (
                  <tr key={m.id}>
                    <td>{i + 1}</td>
                    <td>{COURIER_NAMES[m.courier] ?? m.courier}</td>
                    <td>{m.tracking_number}</td>
                    <td>{m.order_id}</td>
                    <td>
                      {m.delivery_fullname}, {m.delivery_city}
                    </td>
                    <td className="num">{m.weight}</td>
                    <td className="num">{m.cod_amount ? m.cod_amount.toFixed(2) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row mt" style={{ justifyContent: 'space-between', marginTop: 50 }}>
              <span>{t('Sender signature')}: ____________________</span>
              <span>{t('Courier signature')}: ____________________</span>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
