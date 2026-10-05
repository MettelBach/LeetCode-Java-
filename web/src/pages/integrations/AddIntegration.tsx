import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Calculator, Gauge, LayoutGrid, Plug, Scale, Search, ShoppingBag, Store, Truck } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { Field, Loading, MarketplaceLogo, Modal, useAction } from '../../components/ui';
import { useIntegrations } from '../../data';
import { useT } from '../../i18n';

export interface CatalogEntry {
  type: string;
  name: string;
  category: string;
  countries: string[];
  description: string;
  status: 'available' | 'beta' | 'coming_soon';
  auth: string;
  fields: { key: string; label: string; secret?: boolean; placeholder?: string; help?: string }[];
  capabilities: string[];
  docs_url?: string;
  connected: number;
}

export const useIntegrationCatalog = () =>
  useQuery({ queryKey: ['integrations-catalog'], queryFn: () => api.get<CatalogEntry[]>('/integrations/catalog'), staleTime: 60_000 });

const CATEGORY_LABELS: Record<string, string> = {
  marketplace: 'Marketplaces',
  shop: 'Online shops',
  courier: 'Couriers',
  invoicing: 'Invoicing and accounting',
  payment: 'Payments',
  comparison: 'Comparison sites',
  other: 'Other',
};
const CATEGORY_ICONS: Record<string, ReactNode> = {
  marketplace: <Store size={18} />,
  shop: <ShoppingBag size={18} />,
  courier: <Truck size={18} />,
  invoicing: <Calculator size={18} />,
  payment: <Banknote size={18} />,
  comparison: <Scale size={18} />,
  other: <Plug size={18} />,
};
export const CAPABILITY_LABELS: Record<string, string> = {
  orders: 'Orders',
  offers: 'Offer management',
  stock: 'Stock',
  price: 'Prices',
  listing: 'Listing products',
  tracking: 'Tracking numbers',
  statuses: 'Order statuses',
  messages: 'Messages',
  labels: 'Shipping labels',
  invoices: 'Invoices',
};

/** Integrations catalog ("Integracje → Dodaj integrację"), grouped by category like in BaseLinker. */
export default function AddIntegration() {
  const t = useT();
  const nav = useNavigate();
  const run = useAction();
  const qc = useQueryClient();
  const connected = useIntegrations();
  const catalog = useIntegrationCatalog();
  const [params, setParams] = useSearchParams();
  const cat = params.get('category') || 'all';
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<CatalogEntry | null>(null);
  const [name, setName] = useState('');
  const [demo, setDemo] = useState(false);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const all = catalog.data ?? [];
  const categories = Object.keys(CATEGORY_LABELS).filter((c) => all.some((d) => d.category === c));
  const needle = q.trim().toLowerCase();
  const list = all
    .filter((d) => cat === 'all' || d.category === cat)
    .filter((d) => !needle || d.name.toLowerCase().includes(needle) || t(d.description).toLowerCase().includes(needle) || d.type.includes(needle))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const open = (d: CatalogEntry) => {
    setPick(d);
    setName(d.connected ? `${d.name} ${d.connected + 1}` : d.name);
    setDemo(false);
    setCreds({});
  };
  const create = async () => {
    if (!pick) return;
    const credentials = Object.fromEntries(Object.entries(creds).filter(([, v]) => v.trim()));
    const r = await run(() => api.post('/integrations', { type: pick.type, name: name.trim() || pick.name, demo, credentials }), t('Integration added'));
    if (!r) return;
    qc.invalidateQueries({ queryKey: ['integrations'] });
    qc.invalidateQueries({ queryKey: ['integrations-catalog'] });
    if (demo) {
      await api.post(`/integrations/${r.id}/sync-offers`).catch(() => undefined);
      await api.post(`/integrations/${r.id}/sync-orders`).catch(() => undefined);
      qc.invalidateQueries();
    }
    nav(`/integrations/${r.id}`);
  };
  const setCat = (c: string) => setParams(c === 'all' ? {} : { category: c }, { replace: true });
  return (
    <div className="orders-layout">
      <div className="status-col">
        <div className="status-list" style={{ marginTop: 0 }}>
          <button className={`status-row all ${cat === 'all' ? 'active' : ''}`} onClick={() => setCat('all')}>
            <LayoutGrid size={18} /> {t('All integrations')}
            <span className="status-count">{all.length}</span>
          </button>
          <div className="status-sep" />
          {categories.map((c) => (
            <button key={c} className={`status-row ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>
              {CATEGORY_ICONS[c]} {t(CATEGORY_LABELS[c])}
              <span className="status-count">{all.filter((d) => d.category === c).length}</span>
            </button>
          ))}
          <div className="status-sep" />
          <Link to="/integrations" className="status-row">
            <Plug size={17} /> {t('My integrations')}
            <span className="status-count">{connected.data?.length ?? 0}</span>
          </Link>
          <Link to="/integrations/accelerations" className="status-row">
            <Gauge size={17} /> {t('Accelerations')}
          </Link>
        </div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="page-head">
          <h1 className="page-title">{cat === 'all' ? t('Add integration') : t(CATEGORY_LABELS[cat] ?? cat)}</h1>
          <div className="spacer" />
          <div className="searchbox-input" style={{ height: 42, width: 320, maxWidth: '100%' }}>
            <Search size={18} />
            <input placeholder={t('Search integrations...')} value={q} onChange={(e) => setQ(e.target.value)} style={{ border: 0, outline: 0, flex: 1 }} />
          </div>
        </div>
        {catalog.isLoading ? (
          <Loading />
        ) : (
          <div className="intg-grid">
            {list.map((d) => (
              <div key={d.type} className={`intg-tile ${d.status === 'coming_soon' ? 'soon' : ''}`}>
                <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
                  <MarketplaceLogo type={d.type} size={48} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="intg-name">{d.name}</div>
                    <div className="text-muted text-small">
                      {t(CATEGORY_LABELS[d.category] ?? d.category)} · {d.countries.join(' / ')}
                    </div>
                  </div>
                  {d.status === 'beta' && <span className="badge-soft blue">Beta</span>}
                  {d.status === 'coming_soon' && <span className="badge-soft">{t('Coming soon')}</span>}
                </div>
                <p className="intg-desc">{t(d.description)}</p>
                {d.capabilities.length > 0 && (
                  <div className="row wrap" style={{ gap: 4 }}>
                    {d.capabilities.map((c) => (
                      <span key={c} className="rule-chip">
                        {t(CAPABILITY_LABELS[c] ?? c)}
                      </span>
                    ))}
                  </div>
                )}
                <div className="intg-foot">
                  {d.connected > 0 && <span className="badge-soft green">{t('{n} connected', { n: d.connected })}</span>}
                  <div className="spacer" />
                  {d.status === 'coming_soon' ? (
                    <button className="btn btn-sm" disabled>
                      {t('Coming soon')}
                    </button>
                  ) : (
                    <button className="btn btn-sm btn-primary" onClick={() => open(d)}>
                      {d.connected ? t('Connect another account') : t('Connect')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {!catalog.isLoading && !list.length && <p className="text-muted">{t('Nothing found')}</p>}
      </div>
      {pick && (
        <Modal
          title={t('New {name} account', { name: pick.name })}
          onClose={() => setPick(null)}
          footer={
            <>
              <button className="btn" onClick={() => setPick(null)}>
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
          {!demo &&
            pick.fields.map((f) => (
              <Field key={f.key} label={t(f.label)} help={f.help ? t(f.help) : undefined}>
                <input
                  className="input"
                  type={f.secret ? 'password' : 'text'}
                  placeholder={f.placeholder}
                  value={creds[f.key] ?? ''}
                  onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
                  autoComplete="off"
                />
              </Field>
            ))}
          {!demo && pick.docs_url && (
            <p className="help-text">
              {t('API credentials:')}{' '}
              <a href={pick.docs_url} target="_blank" rel="noreferrer">
                {pick.docs_url.replace(/^https:\/\//, '').replace(/\/$/, '')}
              </a>
            </p>
          )}
          {!demo && (pick.auth === 'oauth_device' || pick.auth === 'oauth_code') && (
            <p className="help-text">{t('After adding, click "Authorize account" in the integration settings and log in to {name}.', { name: pick.name })}</p>
          )}
        </Modal>
      )}
    </div>
  );
}

const rank = (d: CatalogEntry) => (d.status === 'available' ? 0 : d.status === 'beta' ? 1 : 2);
