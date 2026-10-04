import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Plus, RefreshCw, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { Empty, Loading, MarketplaceLogo, Switch, useAction, useToast } from '../../components/ui';
import { useIntegrations, useInvalidateOrders } from '../../data';
import { fmtDateTime } from '../../format';
import { useT } from '../../i18n';

export default function IntegrationsPage() {
  const t = useT();
  const q = useIntegrations();
  const qc = useQueryClient();
  const run = useAction();
  const toast = useToast();
  const invalidateOrders = useInvalidateOrders();
  const refresh = () => qc.invalidateQueries({ queryKey: ['integrations'] });
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{t('Integrations')}</h1>
        <div className="spacer" />
        <Link to="/integrations/add" className="btn btn-primary btn-pill" style={{ height: 44, padding: '0 22px' }}>
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
        <div className="grid grid-3">
          {q.data.map((i) => (
            <div key={i.id} className="card" style={{ opacity: i.enabled ? 1 : 0.65 }}>
              <div className="card-head" style={{ alignItems: 'flex-start' }}>
                <MarketplaceLogo type={i.type} size={48} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 17, fontWeight: 600, color: '#2f343a' }}>{i.name}</div>
                  <div className="row" style={{ gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    {i.demo && <span className="badge-soft blue">{t('Demo mode')}</span>}
                    {!i.authorized ? (
                      <span className="badge-soft orange">{t('Not authorized')}</span>
                    ) : i.last_error ? (
                      <span className="badge-soft red">{t('Error')}</span>
                    ) : (
                      <span className="badge-soft green">{t('Connected')}</span>
                    )}
                  </div>
                </div>
                <Switch
                  checked={i.enabled}
                  onChange={(v) => run(() => api.put(`/integrations/${i.id}`, { enabled: v }), v ? t('Integration enabled') : t('Integration disabled')).then(refresh)}
                />
              </div>
              <div style={{ padding: '0 20px 12px' }}>
                {i.last_error && (
                  <div className="row text-small" style={{ color: 'var(--red)', gap: 6, marginBottom: 8, alignItems: 'flex-start' }}>
                    <AlertTriangle size={16} style={{ flexShrink: 0 }} /> {i.last_error}
                  </div>
                )}
                <dl className="kv" style={{ gridTemplateColumns: '170px 1fr', fontSize: 13.5 }}>
                  <dt>{t('Last synchronization')}:</dt>
                  <dd>{fmtDateTime(i.last_sync_at)}</dd>
                  <dt>{t('Orders (30 days)')}:</dt>
                  <dd>
                    <Link to={`/orders?integration_ids=${i.id}`}>{i.stats.orders_30d}</Link>
                  </dd>
                  <dt>{t('Offers')}:</dt>
                  <dd>
                    <Link to={`/offers?integration_id=${i.id}`}>{i.stats.offers}</Link>{' '}
                    <span className="text-muted">({t('{n} linked', { n: i.stats.offers_linked })})</span>
                  </dd>
                  <dt>{t('Stock synchronization')}:</dt>
                  <dd>{i.settings.sync_stock ? <CheckCircle2 size={16} color="var(--green)" /> : t('off')}</dd>
                </dl>
              </div>
              <div className="row" style={{ padding: '12px 20px', borderTop: '1px solid var(--border-light)' }}>
                <Link to={`/integrations/${i.id}`} className="btn btn-sm">
                  <Settings /> {t('Settings')}
                </Link>
                <button
                  className="btn btn-sm"
                  disabled={!i.enabled || !i.authorized}
                  onClick={async () => {
                    const r = await run(() => api.post(`/integrations/${i.id}/sync-orders`));
                    if (r) toast(t('{name}: {n} new orders', { name: i.name, n: r.imported ?? 0 }), 'success');
                    refresh();
                    invalidateOrders();
                  }}
                >
                  <RefreshCw /> {t('Download orders')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
