import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Gauge, LayoutGrid, Plus, RefreshCw, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { Empty, Loading, MarketplaceLogo, MP_NAMES, Switch, useAction, useToast } from '../../components/ui';
import { useIntegrations, useInvalidateOrders, type Integration } from '../../data';
import { fmtDateTime } from '../../format';
import { useT } from '../../i18n';

const GROUP_LABELS: Record<string, string> = {
  marketplace: 'Marketplaces',
  shop: 'Online shops',
  courier: 'Couriers',
  invoicing: 'Invoicing and accounting',
  payment: 'Payments',
  comparison: 'Comparison sites',
  other: 'Other',
};

/** "Integracje → Moje integracje": connected accounts grouped by category. */
export default function IntegrationsPage() {
  const t = useT();
  const q = useIntegrations();
  const qc = useQueryClient();
  const run = useAction();
  const toast = useToast();
  const invalidateOrders = useInvalidateOrders();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['integrations'] });
    qc.invalidateQueries({ queryKey: ['integrations-catalog'] });
  };
  const groups = Object.keys(GROUP_LABELS)
    .map((g) => [g, (q.data ?? []).filter((i) => (i.category ?? 'marketplace') === g)] as const)
    .filter(([, l]) => l.length);
  const syncOrders = async (i: Integration) => {
    const r = await run(() => api.post(`/integrations/${i.id}/sync-orders`));
    if (r) toast(t('{name}: {n} new orders', { name: i.name, n: r.imported ?? 0 }), 'success');
    refresh();
    invalidateOrders();
  };
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{t('My integrations')}</h1>
        <div className="spacer" />
        <Link to="/integrations/accelerations" className="btn">
          <Gauge size={17} /> {t('Accelerations')}
        </Link>
        <Link to="/integrations/add" className="btn">
          <LayoutGrid size={17} /> {t('Integrations catalog')}
        </Link>
        <Link to="/integrations/add" className="btn btn-primary btn-pill" style={{ height: 40, padding: '0 20px' }}>
          <Plus /> {t('Add integration')}
        </Link>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.length ? (
        <div className="card">
          <Empty>
            {t('You have no connected marketplaces yet.')} <Link to="/integrations/add">{t('Add integration')}</Link>
          </Empty>
        </div>
      ) : (
        groups.map(([g, list]) => (
          <div key={g} className="mb">
            <div className="section-title" style={{ fontWeight: 600, fontSize: 15, margin: '6px 0 8px', color: '#2f343a' }}>
              {t(GROUP_LABELS[g])} <span className="text-muted">({list.length})</span>
            </div>
            <div className="table-wrap">
              <table className="tbl intg-table">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>{t('Active')}</th>
                    <th>{t('Account')}</th>
                    <th>{t('Status')}</th>
                    <th>{t('Last synchronization')}</th>
                    <th className="num">{t('Orders (30 days)')}</th>
                    <th className="num">{t('Offers')}</th>
                    <th>{t('Stock / prices')}</th>
                    <th style={{ width: 1 }} />
                  </tr>
                </thead>
                <tbody>
                  {list.map((i) => (
                    <tr key={i.id} style={{ opacity: i.enabled ? 1 : 0.6 }}>
                      <td>
                        <Switch
                          checked={i.enabled}
                          onChange={(v) => run(() => api.put(`/integrations/${i.id}`, { enabled: v }), v ? t('Integration enabled') : t('Integration disabled')).then(refresh)}
                        />
                      </td>
                      <td>
                        <Link to={`/integrations/${i.id}`} className="row" style={{ gap: 10, color: 'inherit', textDecoration: 'none' }}>
                          <MarketplaceLogo type={i.type} size={34} />
                          <span>
                            <b>{i.name}</b>
                            <div className="text-muted text-small">
                              {MP_NAMES[i.type] ?? i.type} · ID {i.id}
                            </div>
                          </span>
                        </Link>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                          {i.demo && <span className="badge-soft blue">{t('Demo mode')}</span>}
                          {!i.authorized ? (
                            <span className="badge-soft orange">{t('Not authorized')}</span>
                          ) : i.last_error ? (
                            <span className="badge-soft red" title={i.last_error}>
                              <AlertTriangle size={13} /> {t('Error')}
                            </span>
                          ) : (
                            <span className="badge-soft green">{t('Connected')}</span>
                          )}
                        </div>
                        {i.last_error && (
                          <div className="text-small" style={{ color: 'var(--red)', maxWidth: 320, marginTop: 4 }}>
                            {i.last_error}
                          </div>
                        )}
                      </td>
                      <td className="nowrap">{fmtDateTime(i.last_sync_at)}</td>
                      <td className="num">
                        <Link to={`/orders?integration_ids=${i.id}`}>{i.stats.orders_30d}</Link>
                      </td>
                      <td className="num nowrap">
                        <Link to={`/offers?integration_id=${i.id}`}>{i.stats.offers}</Link>{' '}
                        <span className="text-muted text-small">({t('{n} linked', { n: i.stats.offers_linked })})</span>
                      </td>
                      <td className="text-small nowrap">
                        {t('Stock')}: {i.settings.sync_stock ? '✓' : '—'} · {t('Prices')}: {i.settings.sync_price ? '✓' : '—'}
                      </td>
                      <td className="nowrap">
                        <div className="row" style={{ gap: 6 }}>
                          {i.type !== 'olx' && (
                            <button className="btn btn-sm" disabled={!i.enabled || !i.authorized} onClick={() => syncOrders(i)} title={t('Download orders')}>
                              <RefreshCw />
                            </button>
                          )}
                          <Link to={`/integrations/${i.id}`} className="btn btn-sm">
                            <Settings /> {t('Settings')}
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </>
  );
}
