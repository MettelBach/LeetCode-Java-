import { useQueryClient } from '@tanstack/react-query';
import { Gauge, Search, Store } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { Field, MarketplaceLogo, Modal, MP_NAMES, useAction } from '../../components/ui';
import { useIntegrations } from '../../data';
import { useT } from '../../i18n';

type MP = 'allegro' | 'empik' | 'kaufland';

/** Integrations catalog ("Integracje → Dodaj integrację"). */
export default function AddIntegration() {
  const t = useT();
  const nav = useNavigate();
  const run = useAction();
  const qc = useQueryClient();
  const connected = useIntegrations();
  const [q, setQ] = useState('');
  const [type, setType] = useState<MP | null>(null);
  const [name, setName] = useState('');
  const [demo, setDemo] = useState(false);
  const CATALOG: { type: MP; desc: string; features: string[]; country: string }[] = [
    {
      type: 'allegro',
      country: 'PL',
      desc: t('The largest marketplace in Poland. Orders, offers, stock and prices, statuses and tracking numbers (Allegro REST API, OAuth).'),
      features: [t('Orders'), t('Offer management'), t('Stock and prices'), t('Tracking numbers'), t('Order statuses')],
    },
    {
      type: 'empik',
      country: 'PL',
      desc: t('Empik Marketplace (Mirakl platform). Orders with automatic acceptance, offers, stock and prices, tracking numbers.'),
      features: [t('Orders'), t('Offer management'), t('Stock and prices'), t('Tracking numbers')],
    },
    {
      type: 'kaufland',
      country: 'PL / DE / CZ / SK',
      desc: t('Kaufland Marketplace (Seller API v2). Orders (order units), offers (units), stock and prices, shipping confirmation with tracking.'),
      features: [t('Orders'), t('Offer management'), t('Stock and prices'), t('Tracking numbers')],
    },
  ];
  const list = CATALOG.filter((c) => !q || MP_NAMES[c.type].toLowerCase().includes(q.toLowerCase()) || c.desc.toLowerCase().includes(q.toLowerCase()));
  const count = (tp: MP) => connected.data?.filter((i) => i.type === tp).length ?? 0;
  const create = async () => {
    if (!type) return;
    const r = await run(() => api.post('/integrations', { type, name: name.trim() || MP_NAMES[type], demo }), t('Integration added'));
    if (r) {
      qc.invalidateQueries({ queryKey: ['integrations'] });
      if (demo) {
        await api.post(`/integrations/${r.id}/sync-offers`).catch(() => undefined);
        await api.post(`/integrations/${r.id}/sync-orders`).catch(() => undefined);
        qc.invalidateQueries();
      }
      nav(`/integrations/${r.id}`);
    }
  };
  return (
    <div className="orders-layout">
      <div className="status-col">
        <div className="status-list" style={{ marginTop: 0 }}>
          <div className="status-row all active">
            <Store size={18} /> {t('Marketplaces')}
            <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 13 }}>
              {CATALOG.length}
            </span>
          </div>
          <div className="status-sep" />
          <Link to="/integrations" className="status-row">
            {t('My integrations')}
            <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 13 }}>
              {connected.data?.length ?? 0}
            </span>
          </Link>
          <Link to="/integrations/accelerations" className="status-row">
            <Gauge size={17} /> {t('Accelerations')}
          </Link>
        </div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="page-head">
          <h1 className="page-title">{t('Add integration')}</h1>
          <div className="spacer" />
          <div className="searchbox-input" style={{ height: 42, width: 320 }}>
            <Search size={18} />
            <input placeholder={t('Search integrations...')} value={q} onChange={(e) => setQ(e.target.value)} style={{ border: 0, outline: 0, flex: 1 }} />
          </div>
        </div>
        <div className="grid grid-3">
          {list.map((c) => (
            <div key={c.type} className="card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="card-head" style={{ alignItems: 'flex-start' }}>
                <MarketplaceLogo type={c.type} size={56} />
                <div className="grow">
                  <div style={{ fontSize: 18, fontWeight: 600, color: '#2f343a' }}>{MP_NAMES[c.type]}</div>
                  <div className="text-muted text-small">
                    {t('Marketplace')} · {c.country}
                  </div>
                </div>
                {count(c.type) > 0 && <span className="badge-soft green">{t('{n} connected', { n: count(c.type) })}</span>}
              </div>
              <div style={{ padding: '0 20px', flex: 1 }}>
                <p className="text-muted" style={{ marginTop: 0 }}>
                  {c.desc}
                </p>
                <div className="row wrap" style={{ gap: 4 }}>
                  {c.features.map((f) => (
                    <span key={f} className="rule-chip">
                      {f}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ padding: 20 }}>
                <button
                  className="btn btn-primary"
                  style={{ width: '100%' }}
                  onClick={() => {
                    setType(c.type);
                    setName(count(c.type) ? `${MP_NAMES[c.type]} ${count(c.type) + 1}` : MP_NAMES[c.type]);
                    setDemo(false);
                  }}
                >
                  {count(c.type) ? t('Connect another account') : t('Connect')}
                </button>
              </div>
            </div>
          ))}
        </div>
        {!list.length && <p className="text-muted">{t('Nothing found')}</p>}
      </div>
      {type && (
        <Modal
          title={t('New {name} account', { name: MP_NAMES[type] })}
          onClose={() => setType(null)}
          footer={
            <>
              <button className="btn" onClick={() => setType(null)}>
                {t('Cancel')}
              </button>
              <button className="btn btn-primary" onClick={create}>
                {t('Add integration')}
              </button>
            </>
          }
        >
          <Field label={t('Account name (visible in the panel)')}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
          </Field>
          <label className="check-label mb">
            <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
            <span>
              <b>{t('Demo mode')}</b> — {t('simulated account with sample orders and offers, no API keys needed. Good for testing the panel.')}
            </span>
          </label>
          <p className="help-text">{t('After adding, enter the API credentials in the integration settings.')}</p>
        </Modal>
      )}
    </div>
  );
}
