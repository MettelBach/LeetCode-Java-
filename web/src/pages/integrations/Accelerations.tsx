import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Gauge, Package, RefreshCw, Tag, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Loading, useAction, useConfirm } from '../../components/ui';
import { fmtDate, money } from '../../format';
import { useT } from '../../i18n';

const KINDS: { id: string; icon: React.ReactNode; title: string; desc: string; unit: 'interval' | 'limit' }[] = [
  { id: 'stock', icon: <Package />, title: 'Stock synchronization', desc: 'How often stock levels are sent to marketplace offers.', unit: 'interval' },
  { id: 'price', icon: <Tag />, title: 'Price synchronization', desc: 'How often inventory prices are sent to marketplace offers.', unit: 'interval' },
  { id: 'orders', icon: <RefreshCw />, title: 'Order download', desc: 'How often new orders are downloaded from marketplaces.', unit: 'interval' },
  { id: 'api', icon: <Zap />, title: 'API request limit', desc: 'Number of requests per minute to the public API.', unit: 'limit' },
];

function interval(t: (s: string, v?: any) => string, minutes: number) {
  if (minutes >= 1440) return t('every {n} h', { n: minutes / 60 });
  if (minutes >= 60) return t('every {n} h', { n: minutes / 60 });
  return t('every {n} min', { n: minutes });
}

export default function AccelerationsPage() {
  const t = useT();
  const { isAdmin } = useAuth();
  const run = useAction();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['accelerations'], queryFn: () => api.get<any>('/billing/accelerations') });
  const d = q.data;
  if (!d) return <Loading />;
  const total = KINDS.reduce((s, k) => s + (d.options[k.id].find((o: any) => o.id === d.current[k.id])?.price ?? 0), 0);
  const change = async (kind: string, id: string, price: number) => {
    if (price > 0 && !(await confirm(t('Enable this acceleration for {p} net per day? You can switch it off at any time.', { p: money(price) })))) return;
    const r = await run(() => api.put('/billing/accelerations', { [kind]: id }), t('Saved'));
    if (r) {
      qc.invalidateQueries({ queryKey: ['accelerations'] });
      qc.invalidateQueries({ queryKey: ['billing'] });
    }
  };
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          <span className="row">
            <Gauge size={26} /> {t('Accelerations')}
          </span>
          <small>{t('Speed up synchronization when you need it — e.g. during sales peaks. Billed per day, switch off at any time.')}</small>
        </h1>
        <div className="spacer" />
        <Link to="/integrations" className="btn btn-outline-blue">
          {t('Integrations')}
        </Link>
      </div>
      <div className="card card-pad mb row">
        <Clock size={22} color="var(--blue)" />
        <div className="grow">
          {t('Current daily cost of accelerations')}: <b style={{ fontSize: 18 }}>{money(total)}</b> {t('net / day')}
        </div>
        <Link to="/settings/subscription">{t('Billing history')}</Link>
      </div>
      <div className="grid grid-2">
        {KINDS.map((k) => (
          <div key={k.id} className="card">
            <div className="card-head">
              <div className="card-title">
                <span style={{ color: 'var(--blue)', display: 'flex' }}>{k.icon}</span> {t(k.title)}
              </div>
            </div>
            <p className="text-muted" style={{ padding: '0 20px', marginTop: 0 }}>
              {t(k.desc)}
            </p>
            <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {d.options[k.id].map((o: any, idx: number) => {
                const active = d.current[k.id] === o.id;
                return (
                  <label
                    key={o.id}
                    className="row"
                    style={{
                      border: `2px solid ${active ? 'var(--blue)' : 'var(--border)'}`,
                      borderRadius: 8,
                      padding: '10px 14px',
                      cursor: isAdmin ? 'pointer' : 'default',
                      background: active ? 'var(--blue-light)' : '#fff',
                    }}
                  >
                    <input type="radio" name={k.id} checked={active} disabled={!isAdmin} onChange={() => change(k.id, o.id, o.price)} />
                    <span className="grow">
                      <b>{k.unit === 'limit' ? t('{n} requests / min', { n: o.minutes }) : interval(t, o.minutes)}</b>
                      {idx === 0 && <span className="text-muted"> — {t('standard')}</span>}
                    </span>
                    <span>{o.price ? `${money(o.price)} / ${t('day')}` : t('included')}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {!!d.charges_30d.length && (
        <div className="card mt">
          <div className="card-head">
            <div className="card-title">{t('Charges in the last 30 days')}</div>
          </div>
          <table className="tbl">
            <tbody>
              {d.charges_30d.map((c: any, i: number) => (
                <tr key={i}>
                  <td>{fmtDate(c.date)}</td>
                  <td>{c.item.replace('accel:', '')}</td>
                  <td className="num">{money(c.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
