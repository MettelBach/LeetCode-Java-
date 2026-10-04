import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FileText, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { Empty, Loading, Pager, useAction } from '../../components/ui';
import { fmtDate, money } from '../../format';
import { useT } from '../../i18n';

export const DOC_TYPES: Record<string, string> = { invoice: 'Invoice', proforma: 'Pro forma', receipt: 'Receipt', correction: 'Correction' };

export default function InvoicesPage() {
  const t = useT();
  const run = useAction();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const page = Number(params.get('page') ?? 1);
  const query = {
    type: params.get('type') ?? undefined,
    search: params.get('search') ?? undefined,
    date_from: params.get('date_from') ?? undefined,
    date_to: params.get('date_to') ?? undefined,
    page,
    per_page: 50,
  };
  const q = useQuery({ queryKey: ['invoices', query], queryFn: () => api.get<any>('/invoices', query), placeholderData: keepPreviousData });
  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };
  const rows: any[] = q.data?.rows ?? [];
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{t('Invoices and receipts')}</h1>
        <div className="spacer" />
        <Link to="/invoices/new" className="btn btn-primary btn-pill" style={{ height: 44, padding: '0 22px' }}>
          <Plus /> {t('New document')}
        </Link>
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
          <input placeholder={t('Number, order, buyer')} value={search} onChange={(e) => setSearch(e.target.value)} style={{ border: 0, outline: 0, flex: 1 }} />
        </form>
        <div className="btn-group">
          {[['', t('All')], ...Object.entries(DOC_TYPES).map(([k, v]) => [k, t(v)])].map(([k, v]) => (
            <button key={k} className={`btn ${(query.type ?? '') === k ? 'btn-primary' : ''}`} onClick={() => setParam({ type: k || null })}>
              {v}
            </button>
          ))}
        </div>
        <input className="input" type="date" style={{ width: 160 }} value={query.date_from ?? ''} onChange={(e) => setParam({ date_from: e.target.value || null })} aria-label={t('Date from')} />
        <input className="input" type="date" style={{ width: 160 }} value={query.date_to ?? ''} onChange={(e) => setParam({ date_to: e.target.value || null })} aria-label={t('Date to')} />
        <Pager page={page} perPage={50} total={q.data?.total ?? 0} onPage={(p) => setParam({ page: String(p) })} />
      </div>
      {q.data && (
        <div className="row mb text-muted">
          {t('Total net')}: <b style={{ color: '#2f343a' }}>{money(q.data.sums.net)}</b> · {t('Total gross')}: <b style={{ color: '#2f343a' }}>{money(q.data.sums.gross)}</b>
        </div>
      )}
      <div className="table-wrap">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <Empty icon={<FileText />}>{t('No documents')}</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('Number')}</th>
                <th>{t('Type')}</th>
                <th>{t('Issue date')}</th>
                <th>{t('Buyer')}</th>
                <th>{t('Order')}</th>
                <th className="num">{t('Net')}</th>
                <th className="num">{t('Gross')}</th>
                <th>{t('Payment')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td>
                    <Link to={`/invoices/${v.id}`} className="order-no" style={{ fontSize: 14 }}>
                      {v.number}
                    </Link>
                  </td>
                  <td>
                    <span className={`badge-soft ${v.type === 'invoice' ? 'blue' : v.type === 'correction' ? 'orange' : ''}`}>{t(DOC_TYPES[v.type])}</span>
                  </td>
                  <td>{fmtDate(v.issue_date)}</td>
                  <td>
                    {v.buyer.company || v.buyer.name}
                    {v.buyer.nip && <div className="text-muted text-small">NIP {v.buyer.nip}</div>}
                  </td>
                  <td>{v.order_id ? <Link to={`/orders/${v.order_id}`}>{v.order_id}</Link> : '—'}</td>
                  <td className="num">{money(v.total_net, v.currency)}</td>
                  <td className="num">
                    <b>{money(v.total_gross, v.currency)}</b>
                  </td>
                  <td>{v.paid ? <span className="badge-soft green">{t('Paid')}</span> : <span className="badge-soft">{t('Unpaid')}</span>}</td>
                  <td className="num">
                    <button className="btn btn-xs" onClick={() => run(() => api.openPdf(`/invoices/${v.id}/pdf`))}>
                      PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
