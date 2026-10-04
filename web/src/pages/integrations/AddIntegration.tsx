import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { Field, MarketplaceLogo, MP_NAMES, useAction } from '../../components/ui';
import { useT } from '../../i18n';

type MP = 'allegro' | 'empik' | 'kaufland';

export default function AddIntegration() {
  const t = useT();
  const nav = useNavigate();
  const run = useAction();
  const qc = useQueryClient();
  const [type, setType] = useState<MP | null>(null);
  const [name, setName] = useState('');
  const [demo, setDemo] = useState(false);
  const DESC: Record<MP, string> = {
    allegro: t('The largest marketplace in Poland. Orders, offers, stock and prices, statuses and tracking numbers (Allegro REST API, OAuth).'),
    empik: t('Empik Marketplace (Mirakl platform). Orders with automatic acceptance, offers, stock and prices, tracking numbers.'),
    kaufland: t('Kaufland Marketplace (Seller API v2). Orders (order units), offers (units), stock and prices, shipping confirmation with tracking.'),
  };
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
    <>
      <div className="page-head">
        <h1 className="page-title">{t('Add integration')}</h1>
      </div>
      <div className="grid grid-3 mb">
        {(['allegro', 'empik', 'kaufland'] as MP[]).map((m) => (
          <button
            key={m}
            className="card card-pad"
            onClick={() => {
              setType(m);
              setName(MP_NAMES[m]);
            }}
            style={{
              textAlign: 'left',
              cursor: 'pointer',
              border: type === m ? '2px solid var(--blue)' : '2px solid transparent',
              display: 'flex',
              gap: 16,
              alignItems: 'flex-start',
              font: 'inherit',
            }}
          >
            <MarketplaceLogo type={m} size={56} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#2f343a' }}>{MP_NAMES[m]}</div>
              <div className="text-muted" style={{ marginTop: 4 }}>
                {DESC[m]}
              </div>
            </div>
          </button>
        ))}
      </div>
      {type && (
        <div className="card card-pad" style={{ maxWidth: 640 }}>
          <div className="card-title dot mb">{t('New {name} account', { name: MP_NAMES[type] })}</div>
          <Field label={t('Account name (visible in the panel)')}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </Field>
          <label className="check-label mb">
            <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
            <span>
              <b>{t('Demo mode')}</b> — {t('simulated account with sample orders and offers, no API keys needed. Good for testing the panel.')}
            </span>
          </label>
          <p className="help-text">{t('After adding, enter the API credentials in the integration settings.')}</p>
          <button className="btn btn-primary btn-pill" style={{ height: 44, padding: '0 26px' }} onClick={create}>
            {t('Add integration')}
          </button>
        </div>
      )}
    </>
  );
}
