import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, KeyRound, PlugZap, RefreshCw, Save, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { Empty, Field, Loading, MarketplaceLogo, Switch, Tabs, useAction, useConfirm, useToast } from '../../components/ui';
import { useInvalidateOrders, useStatuses, type Integration } from '../../data';
import { fmtDateTime } from '../../format';
import { useT } from '../../i18n';
import { useCatalogs, useWarehouses } from '../products/Warehouses';

type Tab = 'connection' | 'orders' | 'products' | 'log';

const STATUS_CODE_LABELS: Record<string, string> = {
  NEW: 'NEW — new',
  PROCESSING: 'PROCESSING — in progress',
  READY_FOR_SHIPMENT: 'READY_FOR_SHIPMENT — ready to ship',
  READY_FOR_PICKUP: 'READY_FOR_PICKUP — ready for pickup',
  SENT: 'SENT — sent',
  PICKED_UP: 'PICKED_UP — picked up',
  CANCELLED: 'CANCELLED — canceled',
  SUSPENDED: 'SUSPENDED — suspended',
  RETURNED: 'RETURNED — returned',
  accept: 'accept — accept order (OR21)',
  ship: 'ship — confirm shipping (OR24)',
  cancel: 'cancel — cancel order',
  send: 'send — mark as sent',
};

export default function IntegrationSettings() {
  const { id } = useParams();
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const run = useAction();
  const confirm = useConfirm();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'connection');
  const q = useQuery({ queryKey: ['integration', id], queryFn: () => api.get<Integration>(`/integrations/${id}`) });
  const meta = useQuery({ queryKey: ['integrations-meta'], queryFn: () => api.get<any>('/integrations/meta'), staleTime: Infinity });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['integration', id] });
    qc.invalidateQueries({ queryKey: ['integrations'] });
  };
  const i = q.data;
  if (q.isLoading) return <Loading />;
  if (!i) return <Empty>{t('Integration not found')}</Empty>;
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          <span className="row">
            <MarketplaceLogo type={i.type} size={40} /> {i.name}
          </span>
          {i.demo && <span className="badge-soft blue">{t('Demo mode')}</span>}
        </h1>
        <div className="spacer" />
        <button
          className="btn btn-pill btn-danger"
          onClick={async () => {
            if (await confirm(t('Delete integration "{name}"? Imported orders stay in the panel.', { name: i.name }), { danger: true, okText: t('Delete') })) {
              const r = await run(() => api.del(`/integrations/${i.id}`), t('Deleted'));
              if (r) {
                qc.invalidateQueries({ queryKey: ['integrations'] });
                nav('/integrations');
              }
            }
          }}
        >
          <Trash2 /> {t('Delete')}
        </button>
        <Link to="/integrations" className="btn btn-outline-blue">
          <Undo2 size={18} /> {t('Back to integrations')}
        </Link>
      </div>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'connection', label: t('Connection') },
          { id: 'orders', label: t('Orders') },
          { id: 'products', label: t('Offers and stock') },
          { id: 'log', label: t('Synchronization log') },
        ]}
      />
      {tab === 'connection' && <ConnectionTab i={i} onSaved={refresh} />}
      {tab === 'orders' && <OrdersTab i={i} codes={meta.data?.status_codes?.[i.type] ?? []} onSaved={refresh} />}
      {tab === 'products' && <ProductsTab i={i} onSaved={refresh} />}
      {tab === 'log' && <LogTab i={i} />}
    </>
  );
}

function ConnectionTab({ i, onSaved }: { i: Integration; onSaved: () => void }) {
  const t = useT();
  const run = useAction();
  const toast = useToast();
  const invalidateOrders = useInvalidateOrders();
  const [name, setName] = useState(i.name);
  const [demo, setDemo] = useState(i.demo);
  const [creds, setCreds] = useState<Record<string, any>>({ ...i.credentials });
  const [auth, setAuth] = useState<{ user_code: string; url: string } | null>(i.auth_pending);
  const poll = useRef<number | null>(null);
  useEffect(() => () => {
    if (poll.current) window.clearInterval(poll.current);
  }, []);
  const set = (k: string, v: any) => setCreds((c) => ({ ...c, [k]: v }));
  const save = async () => {
    const r = await run(() => api.put(`/integrations/${i.id}`, { name, demo, credentials: creds }), t('Saved'));
    if (r) onSaved();
    return r;
  };
  const test = async () => {
    await save();
    const r = await run(() => api.post(`/integrations/${i.id}/test`));
    if (r) toast(r.message, r.ok ? 'success' : 'error');
  };
  const startAuth = async () => {
    const saved = await save();
    if (!saved) return;
    const r = await run(() => api.post(`/integrations/${i.id}/allegro/auth/start`));
    if (!r) return;
    setAuth({ user_code: r.user_code, url: r.url });
    window.open(r.url, '_blank', 'noopener');
    if (poll.current) window.clearInterval(poll.current);
    poll.current = window.setInterval(async () => {
      try {
        const p = await api.post(`/integrations/${i.id}/allegro/auth/poll`);
        if (p.authorized) {
          window.clearInterval(poll.current!);
          setAuth(null);
          toast(t('Allegro account authorized'), 'success');
          onSaved();
        }
      } catch (e: any) {
        window.clearInterval(poll.current!);
        setAuth(null);
        toast(e.message, 'error');
      }
    }, Math.max(5, 5) * 1000);
  };
  const field = (k: string, label: string, secret = false, help?: string) => (
    <Field label={label} help={help}>
      <input
        className="input"
        type={secret ? 'password' : 'text'}
        value={creds[k] ?? ''}
        onChange={(e) => set(k, e.target.value)}
        onFocus={(e) => secret && e.target.value === '••••••••' && set(k, '')}
        autoComplete="off"
      />
    </Field>
  );
  return (
    <div className="grid grid-2">
      <div className="card card-pad">
        <div className="card-title mb">{t('Account')}</div>
        <Field label={t('Account name')}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <label className="check-label mb">
          <Switch checked={demo} onChange={setDemo} /> {t('Demo mode (simulated account, no API calls)')}
        </label>
        {!demo && (
          <>
            {i.type === 'allegro' && (
              <>
                {field('client_id', 'Client ID')}
                {field('client_secret', 'Client Secret', true)}
                <label className="check-label mb">
                  <input type="checkbox" checked={!!creds.sandbox} onChange={(e) => set('sandbox', e.target.checked)} /> {t('Sandbox (allegrosandbox.pl test environment)')}
                </label>
              </>
            )}
            {i.type === 'empik' && (
              <>
                {field('api_key', t('API key'), true, t('Empik back office → My user settings → API key'))}
                {field('base_url', t('API address'), false, t('Default: https://marketplace.empik.com'))}
              </>
            )}
            {i.type === 'kaufland' && (
              <>
                {field('client_key', 'Client Key', true)}
                {field('secret_key', 'Secret Key', true)}
                <Field label={t('Storefront')}>
                  <select className="select" value={creds.storefront ?? 'pl'} onChange={(e) => set('storefront', e.target.value)}>
                    {['pl', 'de', 'cz', 'sk', 'at', 'ro'].map((s) => (
                      <option key={s} value={s}>
                        kaufland.{s}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}
          </>
        )}
        <div className="row wrap">
          <button className="btn btn-primary" onClick={save}>
            <Save /> {t('Save')}
          </button>
          <button className="btn" onClick={test}>
            <PlugZap /> {t('Test connection')}
          </button>
          {i.type === 'allegro' && !demo && (
            <button className="btn" onClick={startAuth} disabled={!creds.client_id || !creds.client_secret}>
              <KeyRound /> {i.authorized ? t('Authorize again') : t('Authorize Allegro account')}
            </button>
          )}
          <button
            className="btn"
            onClick={async () => {
              const r = await run(() => api.post(`/integrations/${i.id}/sync-orders`));
              if (r) {
                toast(t('{name}: {n} new orders', { name: i.name, n: r.imported ?? 0 }), 'success');
                invalidateOrders();
                onSaved();
              }
            }}
          >
            <RefreshCw /> {t('Download orders now')}
          </button>
        </div>
        {auth && (
          <div className="card-pad mt" style={{ background: 'var(--blue-light)', borderRadius: 8 }}>
            <div>{t('Confirm access on Allegro. Your code:')}</div>
            <div className="big-code">{auth.user_code}</div>
            <a href={auth.url} target="_blank" rel="noreferrer">
              {t('Open allegro.pl')} <ExternalLink size={13} />
            </a>
            <div className="row mt-sm text-muted">
              <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> {t('Waiting for confirmation...')}
            </div>
          </div>
        )}
        {i.type === 'allegro' && i.authorized && !demo && <p className="text-small" style={{ color: 'var(--green)' }}>✓ {t('Account authorized')}</p>}
      </div>
      <div className="card card-pad">
        <div className="card-title mb">{t('How to connect')}</div>
        {i.type === 'allegro' && (
          <ol style={{ paddingLeft: 18, lineHeight: 1.7 }}>
            <li>
              {t('Register an application at')}{' '}
              <a href="https://apps.developer.allegro.pl/" target="_blank" rel="noreferrer">
                apps.developer.allegro.pl
              </a>{' '}
              {t('(type: "device" — the app works without a public URL).')}
            </li>
            <li>{t('Copy Client ID and Client Secret here and click Save.')}</li>
            <li>{t('Click "Authorize Allegro account" and confirm access with your seller account on allegro.pl.')}</li>
            <li>{t('Set the order status mapping on the "Orders" tab and link offers with inventory products.')}</li>
          </ol>
        )}
        {i.type === 'empik' && (
          <ol style={{ paddingLeft: 18, lineHeight: 1.7 }}>
            <li>{t('Log in to the Empik Marketplace seller panel (Mirakl).')}</li>
            <li>{t('Open your user settings → "API key" and generate the key.')}</li>
            <li>{t('Paste the key here, save and test the connection.')}</li>
            <li>{t('New orders are accepted automatically (can be disabled on the "Orders" tab).')}</li>
          </ol>
        )}
        {i.type === 'kaufland' && (
          <ol style={{ paddingLeft: 18, lineHeight: 1.7 }}>
            <li>
              {t('In the Kaufland Seller Portal open Settings → API and generate Client Key and Secret Key')} (
              <a href="https://sellerapi.kaufland.com/?page=rest-api" target="_blank" rel="noreferrer">
                {t('documentation')}
              </a>
              ).
            </li>
            <li>{t('Paste both keys here, choose the storefront (kaufland.pl) and save.')}</li>
            <li>{t('Requests are signed with HMAC-SHA256 — make sure the server clock is correct.')}</li>
          </ol>
        )}
        <p className="help-text">{t('Orders are downloaded automatically every 10 minutes (faster with Accelerations); offers are refreshed every 6 hours.')}</p>
      </div>
    </div>
  );
}

function OrdersTab({ i, codes, onSaved }: { i: Integration; codes: string[]; onSaved: () => void }) {
  const t = useT();
  const run = useAction();
  const statuses = useStatuses();
  const warehouses = useWarehouses();
  const [s, setS] = useState<Record<string, any>>({ ...i.settings, status_map: { ...(i.settings.status_map ?? {}) } });
  const [days, setDays] = useState('7');
  const save = async () => {
    const r = await run(
      () =>
        api.put(`/integrations/${i.id}`, {
          settings: {
            import_status_id: s.import_status_id ? Number(s.import_status_id) : null,
            import_days: Number(s.import_days) || 7,
            status_map: Object.fromEntries(Object.entries(s.status_map).filter(([, v]) => v)),
            send_tracking: !!s.send_tracking,
            sync_cancel: !!s.sync_cancel,
            auto_accept: !!s.auto_accept,
            warehouse_id: s.warehouse_id ? Number(s.warehouse_id) : null,
          },
        }),
      t('Saved'),
    );
    if (r) onSaved();
  };
  return (
    <div className="grid grid-2">
      <div className="card card-pad">
        <div className="card-title mb">{t('Order download')}</div>
        <Field label={t('Status for new orders')}>
          <select className="select" value={s.import_status_id ?? ''} onChange={(e) => setS({ ...s, import_status_id: e.target.value })}>
            <option value="">{t('Default (new orders)')}</option>
            {statuses.data?.statuses.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Fulfil orders from warehouse (stock deduction)')}>
          <select className="select" value={s.warehouse_id ?? ''} onChange={(e) => setS({ ...s, warehouse_id: e.target.value })}>
            <option value="">{t('Default warehouse')}</option>
            {warehouses.data?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('On the first synchronization download orders from the last (days)')}>
          <input className="input" type="number" min={1} max={90} value={s.import_days ?? 7} onChange={(e) => setS({ ...s, import_days: e.target.value })} />
        </Field>
        <div className="col" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="check-label">
            <Switch checked={!!s.send_tracking} onChange={(v) => setS({ ...s, send_tracking: v })} /> {t('Send tracking numbers to the marketplace automatically')}
          </label>
          <label className="check-label">
            <Switch checked={!!s.sync_cancel} onChange={(v) => setS({ ...s, sync_cancel: v })} /> {t('Cancel the order in the panel when it is canceled on the marketplace')}
          </label>
          {i.type === 'empik' && (
            <label className="check-label">
              <Switch checked={s.auto_accept !== false} onChange={(v) => setS({ ...s, auto_accept: v })} /> {t('Accept new Empik orders automatically')}
            </label>
          )}
        </div>
        <div className="row mt">
          <button className="btn btn-primary" onClick={save}>
            <Save /> {t('Save')}
          </button>
        </div>
        <div className="mt" style={{ borderTop: '1px solid var(--border-light)', paddingTop: 14 }}>
          <div className="field-label mb">{t('Download older orders again')}</div>
          <div className="row">
            <input className="input" style={{ width: 90 }} type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} />
            <span>{t('days back')}</span>
            <button
              className="btn"
              onClick={async () => {
                const r = await run(() => api.post(`/integrations/${i.id}/reset-cursor`, { days: Number(days) }), t('Next synchronization will check older orders'));
                if (r) onSaved();
              }}
            >
              {t('Set')}
            </button>
          </div>
        </div>
      </div>
      <div className="card card-pad">
        <div className="card-title mb">{t('Status synchronization (panel → marketplace)')}</div>
        <p className="help-text" style={{ marginTop: 0 }}>
          {t('When an order from this account is moved to a status, the selected action is sent to the marketplace.')}
        </p>
        <table className="tbl">
          <tbody>
            {statuses.data?.statuses.map((x) => (
              <tr key={x.id}>
                <td>
                  <span className="row" style={{ gap: 8 }}>
                    <span className="color-dot" style={{ background: x.color }} /> {x.name}
                  </span>
                </td>
                <td>
                  <select
                    className="select input-sm"
                    value={s.status_map[x.id] ?? ''}
                    onChange={(e) => setS({ ...s, status_map: { ...s.status_map, [x.id]: e.target.value } })}
                  >
                    <option value="">{t('— do not send —')}</option>
                    {codes.map((c) => (
                      <option key={c} value={c}>
                        {STATUS_CODE_LABELS[c] ?? c}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {i.type === 'kaufland' && <p className="help-text">{t('Kaufland units are marked as sent together with the tracking number when you create a shipment.')}</p>}
        <div className="row mt">
          <button className="btn btn-primary" onClick={save}>
            <Save /> {t('Save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductsTab({ i, onSaved }: { i: Integration; onSaved: () => void }) {
  const t = useT();
  const run = useAction();
  const toast = useToast();
  const warehouses = useWarehouses();
  const catalogs = useCatalogs();
  const [s, setS] = useState<Record<string, any>>({
    ...i.settings,
    stock_warehouse_ids: i.settings.stock_warehouse_ids ?? [],
    price_markup_percent: String(i.settings.price_markup_percent ?? 0),
    price_add: String(i.settings.price_add ?? 0),
    price_rounding: i.settings.price_rounding ?? 'none',
    stock_reserve: String(i.settings.stock_reserve ?? 0),
  });
  const num = (v: string) => Number(String(v).replace(',', '.')) || 0;
  // Preview of the price rules for 100.00 in the inventory.
  const preview = (() => {
    let v = 100 * (1 + num(s.price_markup_percent) / 100) + num(s.price_add);
    if (s.price_rounding === 'int') v = Math.round(v);
    else if (s.price_rounding === '99') v = Math.floor(v + 0.001) + 0.99;
    return Math.max(0, v);
  })();
  const save = async () => {
    const r = await run(
      () =>
        api.put(`/integrations/${i.id}`, {
          settings: {
            sync_stock: !!s.sync_stock,
            sync_price: !!s.sync_price,
            auto_link: !!s.auto_link,
            catalog_id: s.catalog_id ? Number(s.catalog_id) : null,
            stock_warehouse_ids: s.stock_warehouse_ids,
            price_markup_percent: num(s.price_markup_percent),
            price_add: num(s.price_add),
            price_rounding: s.price_rounding,
            stock_reserve: Math.max(0, Math.round(num(s.stock_reserve))),
          },
        }),
      t('Saved'),
    );
    if (r) onSaved();
  };
  return (
    <div className="card card-pad" style={{ maxWidth: 760 }}>
      <div className="card-title mb">{t('Offers and inventory')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label className="check-label">
          <Switch checked={!!s.auto_link} onChange={(v) => setS({ ...s, auto_link: v })} /> {t('Link offers with inventory products automatically (by SKU / EAN)')}
        </label>
        <label className="check-label">
          <Switch checked={!!s.sync_stock} onChange={(v) => setS({ ...s, sync_stock: v })} /> {t('Send inventory stock to linked offers (interval set in Accelerations)')}
        </label>
        <label className="check-label">
          <Switch checked={!!s.sync_price} onChange={(v) => setS({ ...s, sync_price: v })} /> {t('Send inventory prices to linked offers')}
        </label>
      </div>
      <div className="form-grid mt">
        <Field label={t('Catalog for this account')} help={t('Offers are linked with products of this catalog')}>
          <select className="select" value={s.catalog_id ?? ''} onChange={(e) => setS({ ...s, catalog_id: e.target.value })}>
            <option value="">{t('All catalogs')}</option>
            {catalogs.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Stock sent to offers comes from')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 6 }}>
            {warehouses.data?.map((w) => (
              <label key={w.id} className="check-label">
                <input
                  type="checkbox"
                  checked={s.stock_warehouse_ids.includes(w.id)}
                  onChange={(e) =>
                    setS({ ...s, stock_warehouse_ids: e.target.checked ? [...s.stock_warehouse_ids, w.id] : s.stock_warehouse_ids.filter((x: number) => x !== w.id) })
                  }
                />
                {w.name}
              </label>
            ))}
            <span className="help-text">{t('None selected = sum of all warehouses')}</span>
          </div>
        </Field>
      </div>
      <div className="card-title mt mb" style={{ fontSize: 16 }}>
        {t('Price rules and stock reserve')}
      </div>
      <div className="form-grid">
        <Field label={t('Price change vs inventory (%)')} help={t('e.g. 15 to cover the marketplace commission')}>
          <input className="input" value={s.price_markup_percent} onChange={(e) => setS({ ...s, price_markup_percent: e.target.value })} inputMode="decimal" />
        </Field>
        <Field label={t('Add to the price (PLN)')}>
          <input className="input" value={s.price_add} onChange={(e) => setS({ ...s, price_add: e.target.value })} inputMode="decimal" />
        </Field>
        <Field label={t('Rounding')} help={t('100.00 in the inventory → {p} on the marketplace', { p: preview.toFixed(2) })}>
          <select className="select" value={s.price_rounding} onChange={(e) => setS({ ...s, price_rounding: e.target.value })}>
            <option value="none">{t('No rounding')}</option>
            <option value="99">{t('Up to .99 (e.g. 45.99)')}</option>
            <option value="int">{t('To whole złoty')}</option>
          </select>
        </Field>
        <Field label={t('Stock reserve (units)')} help={t('Units kept back from this marketplace, e.g. for the own store')}>
          <input className="input" value={s.stock_reserve} onChange={(e) => setS({ ...s, stock_reserve: e.target.value })} inputMode="numeric" />
        </Field>
      </div>
      <div className="row mt">
        <button className="btn btn-primary" onClick={save}>
          <Save /> {t('Save')}
        </button>
        <button
          className="btn"
          onClick={async () => {
            const r = await run(() => api.post(`/integrations/${i.id}/sync-offers`));
            if (r) {
              toast(t('{name}: {n} offers, {l} linked', { name: i.name, n: r.count, l: r.linked }), 'success');
              onSaved();
            }
          }}
        >
          <RefreshCw /> {t('Download offers now')}
        </button>
        <Link to={`/offers?integration_id=${i.id}`} className="btn">
          {t('Show offers')}
        </Link>
      </div>
    </div>
  );
}

function LogTab({ i }: { i: Integration }) {
  const t = useT();
  const q = useQuery({ queryKey: ['integration-log', i.id], queryFn: () => api.get<any[]>(`/integrations/${i.id}/log`), refetchInterval: 15_000 });
  return (
    <div className="table-wrap">
      {!q.data?.length ? (
        <Empty>{t('No entries')}</Empty>
      ) : (
        <table className="tbl">
          <tbody>
            {q.data.map((l) => (
              <tr key={l.id}>
                <td className="nowrap" style={{ width: 160 }}>
                  {fmtDateTime(l.created_at)}
                </td>
                <td style={{ width: 70 }}>
                  <span className={`badge-soft ${l.level === 'error' ? 'red' : l.level === 'warn' ? 'orange' : ''}`}>{l.level}</span>
                </td>
                <td style={{ wordBreak: 'break-word' }}>{l.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
