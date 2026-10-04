import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Circle, FileText, Inbox, PackageX, RotateCcw, Truck, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { useAuth } from '../auth';
import { Loading, SourceIcon } from '../components/ui';
import { money } from '../format';
import { useT } from '../i18n';

function fillDays(daily: { d: string; orders: number; revenue: number }[], days: number) {
  const map = new Map(daily.map((r) => [r.d, r]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000);
    const key = d.toISOString().slice(0, 10);
    const r = map.get(key);
    out.push({ d: key, label: `${key.slice(8, 10)}.${key.slice(5, 7)}`, orders: r?.orders ?? 0, revenue: r?.revenue ?? 0 });
  }
  return out;
}

const STEP_LABELS: Record<string, [string, string]> = {
  company: ['Fill in company details', 'They are printed on invoices and labels'],
  integration: ['Connect Allegro, Empik or Kaufland', 'Orders will be downloaded automatically'],
  products: ['Add products to the inventory', 'Manually, from CSV or from marketplace offers'],
  orders: ['Download the first marketplace order', 'Usually within 10 minutes after connecting'],
  invoice: ['Issue an invoice or receipt', 'In the order card → Documents'],
  shipment: ['Create a shipment and print a label', 'In the order card → Shipments'],
  automation: ['Turn on an automatic action', 'E.g. "paid → to send" with an e-mail to the buyer'],
};

function Onboarding({ data }: { data: { steps: { id: string; done: boolean; to: string }[]; done: number } }) {
  const t = useT();
  const qc = useQueryClient();
  const total = data.steps.length;
  const hide = () => api.post('/dashboard/onboarding/dismiss').then(() => qc.invalidateQueries({ queryKey: ['dashboard'] }));
  return (
    <div className="card mb onboarding">
      <div className="card-head">
        <div className="card-title">
          {data.done === total ? t('Everything is set up!') : t('First steps')}
          <span className="text-muted" style={{ fontSize: 14, marginLeft: 10 }}>
            {t('{done} of {total} done', { done: data.done, total })}
          </span>
        </div>
        <button className="icon-btn" onClick={hide} aria-label={t('Hide')} title={t('Hide')}>
          <X size={18} />
        </button>
      </div>
      <div className="onboarding-bar">
        <span style={{ width: `${(data.done / total) * 100}%` }} />
      </div>
      <div className="onboarding-steps">
        {data.steps.map((s) => {
          const [title, hint] = STEP_LABELS[s.id] ?? [s.id, ''];
          return (
            <Link key={s.id} to={s.to} className={`onboarding-step ${s.done ? 'done' : ''}`}>
              {s.done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
              <span>
                <b>{t(title)}</b>
                <small>{t(hint)}</small>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Delta({ cur, prev }: { cur: number; prev: number }) {
  const t = useT();
  if (!prev) return <div className="delta text-muted">{t('no data for the previous period')}</div>;
  const pct = ((cur - prev) / prev) * 100;
  return (
    <div className={`delta ${pct >= 0 ? 'up' : 'down'}`}>
      {pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}% {t('vs previous period')}
    </div>
  );
}

export default function Dashboard() {
  const t = useT();
  const { user } = useAuth();
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ['dashboard', days], queryFn: () => api.get<any>('/dashboard', { days }), refetchInterval: 120_000 });
  const d = q.data;
  if (!d) return <Loading />;
  const chart = fillDays(d.daily, days);
  const todo = [
    { n: d.to_do.new_orders, label: t('New orders to process'), to: '/orders?status=new', icon: <Inbox /> },
    { n: d.to_do.to_ship, label: t('Orders to send without a shipment'), to: '/orders?status=to_send&shipment=no', icon: <Truck /> },
    { n: d.to_do.invoices_needed, label: t('Customers waiting for an invoice'), to: '/orders?invoice=wanted', icon: <FileText /> },
    { n: d.to_do.open_returns, label: t('Open returns'), to: '/returns', icon: <RotateCcw /> },
    { n: d.to_do.integration_errors, label: t('Integrations with errors'), to: '/integrations', icon: <AlertTriangle /> },
  ];
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          {t('Hello, {name}!', { name: user?.name ?? '' })}
          <small>{t('Here is what is happening in your store')}</small>
        </h1>
        <div className="spacer" />
        <div className="btn-group">
          {[7, 30, 90].map((n) => (
            <button key={n} className={`btn ${days === n ? 'btn-primary' : ''}`} onClick={() => setDays(n)}>
              {t('{n} days', { n })}
            </button>
          ))}
        </div>
      </div>

      {d.onboarding && <Onboarding data={d.onboarding} />}

      <div className="grid grid-4 mb">
        <div className="card stat">
          <div className="label">{t('Today')}</div>
          <div className="value">{money(d.today.revenue)}</div>
          <div className="text-muted">{t('{n} orders', { n: d.today.orders })}</div>
        </div>
        <div className="card stat">
          <div className="label">{t('Sales ({n} days)', { n: days })}</div>
          <div className="value">{money(d.summary.revenue)}</div>
          <Delta cur={d.summary.revenue} prev={d.prev_summary.revenue} />
        </div>
        <div className="card stat">
          <div className="label">{t('Orders ({n} days)', { n: days })}</div>
          <div className="value">{d.summary.orders}</div>
          <Delta cur={d.summary.orders} prev={d.prev_summary.orders} />
        </div>
        <div className="card stat">
          <div className="label">{t('Average order value')}</div>
          <div className="value">{money(d.summary.avg_order)}</div>
          <div className="text-muted">{t('{n} products sold', { n: d.summary.items })}</div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 18 }}>
        <div className="card">
          <div className="card-head">
            <div className="card-title">{t('Sales chart')}</div>
          </div>
          <div style={{ height: 300, padding: '0 16px 16px 0' }}>
            <ResponsiveContainer>
              <AreaChart data={chart}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1271d3" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#1271d3" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#eef0f2" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#8a9199' }} tickLine={false} axisLine={false} minTickGap={16} />
                <YAxis yAxisId="r" tick={{ fontSize: 12, fill: '#8a9199' }} tickLine={false} axisLine={false} width={60} />
                <YAxis yAxisId="o" orientation="right" tick={{ fontSize: 12, fill: '#8a9199' }} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
                <Tooltip
                  formatter={(v: any, name: any) => (name === 'revenue' ? [money(Number(v)), t('Sales')] : [v, t('Orders')])}
                  labelFormatter={(l: any) => l}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e9ecef', fontSize: 13 }}
                />
                <Area yAxisId="r" type="monotone" dataKey="revenue" stroke="#1271d3" strokeWidth={2} fill="url(#rev)" />
                <Area yAxisId="o" type="monotone" dataKey="orders" stroke="#f0803c" strokeWidth={2} fill="none" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <div className="card-title">{t('To do')}</div>
          </div>
          {todo.map((x) => (
            <Link key={x.label} to={x.to} className="todo-row">
              <span style={{ color: x.n ? 'var(--blue)' : '#b9bec4' }}>{x.icon}</span>
              <span>{x.label}</span>
              <span className="n" style={{ color: x.n ? '#2f343a' : '#b9bec4' }}>
                {x.n}
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-3 mt">
        <div className="card">
          <div className="card-head">
            <div className="card-title">{t('Sales by source')}</div>
          </div>
          {d.by_source.length ? (
            <>
              <div style={{ height: 160, padding: '0 16px' }}>
                <ResponsiveContainer>
                  <BarChart data={d.by_source} layout="vertical" margin={{ left: 0, right: 10 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="source" width={70} tick={{ fontSize: 12, fill: '#5f666e' }} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(v: any) => money(Number(v))} contentStyle={{ borderRadius: 8, fontSize: 13 }} />
                    <Bar dataKey="revenue" fill="#1271d3" radius={[0, 4, 4, 0]} barSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <table className="tbl">
                <tbody>
                  {d.by_source.map((s: any) => (
                    <tr key={s.name}>
                      <td>
                        <span className="row" style={{ gap: 6 }}>
                          <SourceIcon source={s.source} /> {s.source === 'manual' ? t('Manual orders') : s.name}
                        </span>
                      </td>
                      <td className="num">{s.orders}</td>
                      <td className="num">{money(s.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="text-muted" style={{ padding: '0 20px 20px' }}>{t('No sales yet')}</div>
          )}
        </div>
        <div className="card">
          <div className="card-head">
            <div className="card-title">{t('Bestsellers')}</div>
          </div>
          <table className="tbl">
            <tbody>
              {d.top_products.map((p: any, i: number) => (
                <tr key={i}>
                  <td className="text-muted">{i + 1}.</td>
                  <td>
                    {p.name}
                    {p.sku && <div className="text-muted text-small">{p.sku}</div>}
                  </td>
                  <td className="num">
                    <b>{p.qty}</b> {t('pcs')}
                  </td>
                </tr>
              ))}
              {!d.top_products.length && (
                <tr>
                  <td className="text-muted">{t('No sales yet')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="card-head">
            <div className="card-title">{t('Orders in statuses')}</div>
          </div>
          <div style={{ padding: '0 20px 10px' }}>
            {d.statuses.map((s: any) => (
              <Link key={s.id} to={`/orders?status=${s.id}`} className="status-row" style={{ padding: '6px 0' }}>
                <span className="count-box" style={{ background: s.color }}>
                  {s.count || '-'}
                </span>
                {s.name}
              </Link>
            ))}
          </div>
          <div className="card-head" style={{ borderTop: '1px solid var(--border-light)' }}>
            <div className="card-title" style={{ fontSize: 16 }}>
              <PackageX size={18} /> {t('Low stock')}
            </div>
          </div>
          <table className="tbl">
            <tbody>
              {d.low_stock.map((p: any) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/products/${p.id}`}>{p.name}</Link>
                  </td>
                  <td className="num">
                    <span className={`badge-soft ${p.stock > 0 ? 'orange' : 'red'}`}>{p.stock}</span>
                  </td>
                </tr>
              ))}
              {!d.low_stock.length && (
                <tr>
                  <td className="text-muted">{t('All products are in stock')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
