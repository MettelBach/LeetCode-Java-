import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpFromLine, ExternalLink, Link2, Link2Off, PackagePlus, RefreshCw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Empty, Field, Loading, MarketplaceLogo, Modal, Pager, Switch, useAction, useToast } from '../components/ui';
import { useIntegrations } from '../data';
import { fmtDateTime, money } from '../format';
import { useT } from '../i18n';

export default function OffersPage() {
  const t = useT();
  const qc = useQueryClient();
  const run = useAction();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const integrations = useIntegrations();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [selected, setSelected] = useState<number[]>([]);
  const [linking, setLinking] = useState<any | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const integrationId = params.get('integration_id');
  const page = Number(params.get('page') ?? 1);
  const query = { integration_id: integrationId ?? undefined, search: params.get('search') ?? undefined, linked: params.get('linked') ?? undefined, page, per_page: 50 };
  const q = useQuery({ queryKey: ['offers', query], queryFn: () => api.get<any>('/offers', query), placeholderData: keepPreviousData });
  useEffect(() => setSelected([]), [JSON.stringify(query)]);
  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ['offers'] });
  const current = integrations.data?.find((i) => String(i.id) === integrationId);
  const rows: any[] = q.data?.rows ?? [];

  const syncOffers = async () => {
    const list = current ? [current] : integrations.data ?? [];
    for (const i of list) {
      const r = await run(() => api.post(`/integrations/${i.id}/sync-offers`));
      if (r) toast(t('{name}: {n} offers, {l} linked', { name: i.name, n: r.count, l: r.linked }), 'success');
    }
    refresh();
  };

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          {current ? (
            <span className="row">
              <MarketplaceLogo type={current.type} size={36} /> {current.name}
            </span>
          ) : (
            t('Marketplace offers')
          )}
        </h1>
        <div className="spacer" />
        <button className="btn btn-pill" onClick={syncOffers}>
          <RefreshCw /> {t('Download offers')}
        </button>
        <button
          className="btn btn-pill"
          onClick={async () => {
            const r = await run(() => api.post('/offers/push', { ids: selected.length ? selected : undefined }));
            if (r) {
              toast(t('Updated: {u}, errors: {e}', { u: r.updated, e: r.failed }), r.failed ? 'error' : 'success');
              refresh();
            }
          }}
        >
          <ArrowUpFromLine /> {selected.length ? t('Send stock of selected') : t('Send stock to marketplaces')}
        </button>
        <button
          className="btn btn-primary btn-pill"
          disabled={!selected.length}
          title={t('Create inventory products from selected unlinked offers')}
          onClick={async () => {
            const r = await run(() => api.post('/offers/to-inventory', { ids: selected }));
            if (r) {
              toast(t('{n} products created', { n: r.created }), 'success');
              refresh();
              setSelected([]);
            }
          }}
        >
          <PackagePlus /> {t('Add to inventory')}
        </button>
      </div>

      <div className="toolbar">
        <form
          className="searchbox-input"
          style={{ height: 40, maxWidth: 360, flex: 1 }}
          onSubmit={(e) => {
            e.preventDefault();
            setParam({ search: search.trim() || null });
          }}
        >
          <Search size={18} />
          <input placeholder={t('Title, SKU, EAN, offer ID')} value={search} onChange={(e) => setSearch(e.target.value)} style={{ border: 0, outline: 0, flex: 1 }} />
        </form>
        <select className="select" style={{ width: 230 }} value={integrationId ?? ''} onChange={(e) => setParam({ integration_id: e.target.value || null })}>
          <option value="">{t('All accounts')}</option>
          {integrations.data?.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        <select className="select" style={{ width: 200 }} value={params.get('linked') ?? ''} onChange={(e) => setParam({ linked: e.target.value || null })}>
          <option value="">{t('Linked and unlinked')}</option>
          <option value="yes">{t('Linked with inventory')}</option>
          <option value="no">{t('Not linked')}</option>
        </select>
        <Pager page={page} perPage={50} total={q.data?.total ?? 0} onPage={(p) => setParam({ page: String(p) })} />
      </div>

      <div className="table-wrap">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <Empty>
            {t('No offers.')} {integrations.data?.length ? t('Click "Download offers" to fetch them from marketplaces.') : <Link to="/integrations/add">{t('Add integration')}</Link>}
          </Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th className="check">
                  <input type="checkbox" checked={rows.every((r) => selected.includes(r.id))} onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.id) : [])} />
                </th>
                <th>{t('Offer')}</th>
                <th>SKU / EAN</th>
                <th className="num">{t('Price')}</th>
                <th className="num">{t('Stock')}</th>
                <th>{t('Inventory product')}</th>
                <th className="center">{t('Sync stock')}</th>
                <th className="center">{t('Sync price')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const diff = o.product_id && o.product_stock !== o.stock;
                return (
                  <tr key={o.id} className={selected.includes(o.id) ? 'selected' : ''}>
                    <td className="check">
                      <input type="checkbox" checked={selected.includes(o.id)} onChange={() => setSelected((s) => (s.includes(o.id) ? s.filter((x) => x !== o.id) : [...s, o.id]))} />
                    </td>
                    <td style={{ minWidth: 260 }}>
                      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                        <MarketplaceLogo type={o.integration_type} size={28} />
                        <div>
                          <div style={{ color: '#2f343a' }}>{o.title}</div>
                          <div className="text-muted text-small">
                            {o.integration_name} · {o.external_id}{' '}
                            {o.url && (
                              <a href={o.url} target="_blank" rel="noreferrer" aria-label={t('Open on marketplace')}>
                                <ExternalLink size={12} />
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="text-small">
                      <div>{o.sku || '—'}</div>
                      <div className="text-muted">{o.ean}</div>
                    </td>
                    <td className="num">{money(o.price, o.currency)}</td>
                    <td className="num">
                      <span className={`badge-soft ${o.stock > 0 ? 'green' : 'red'}`}>{o.stock}</span>
                      {diff ? <div className="text-small" style={{ color: 'var(--orange)' }}>{t('inventory')}: {o.product_stock}</div> : null}
                    </td>
                    <td style={{ minWidth: 180 }}>
                      {o.product_id ? (
                        <span className="row" style={{ gap: 6 }}>
                          <Link2 size={15} color="var(--green)" />
                          <Link to={`/products/${o.product_id}`}>{o.product_name}</Link>
                        </span>
                      ) : (
                        <button className="btn btn-xs" onClick={() => setLinking(o)}>
                          <Link2 size={14} /> {t('Link')}
                        </button>
                      )}
                    </td>
                    <td className="center">
                      <Switch checked={!!o.sync_stock} onChange={(v) => run(() => api.put(`/offers/${o.id}`, { sync_stock: v })).then(refresh)} />
                    </td>
                    <td className="center">
                      <Switch checked={!!o.sync_price} onChange={(v) => run(() => api.put(`/offers/${o.id}`, { sync_price: v })).then(refresh)} />
                    </td>
                    <td className="num nowrap">
                      <button className="btn btn-xs" onClick={() => setEditing(o)}>
                        {t('Edit')}
                      </button>{' '}
                      {o.product_id && (
                        <button className="btn btn-xs" title={t('Unlink')} onClick={() => run(() => api.put(`/offers/${o.id}`, { product_id: null })).then(refresh)}>
                          <Link2Off size={14} />
                        </button>
                      )}
                      <div className="text-muted text-small">{fmtDateTime(o.last_synced_at)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {linking && <LinkModal offer={linking} onClose={() => setLinking(null)} onDone={refresh} />}
      {editing && <EditOfferModal offer={editing} onClose={() => setEditing(null)} onDone={refresh} />}
    </>
  );
}

function LinkModal({ offer, onClose, onDone }: { offer: any; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const run = useAction();
  const [search, setSearch] = useState(offer.sku || offer.title.split(' ').slice(0, 2).join(' '));
  const results = useQuery({ queryKey: ['product-search', search], queryFn: () => api.get<any[]>('/products/search', { q: search }), enabled: !!search.trim() });
  return (
    <Modal title={t('Link offer with an inventory product')} size="lg" onClose={onClose}>
      <p style={{ marginTop: 0 }}>
        <b>{offer.title}</b> <span className="text-muted">({offer.external_id})</span>
      </p>
      <input className="input mb" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus placeholder={t('Search inventory: name, SKU, EAN...')} />
      <table className="tbl">
        <tbody>
          {results.data?.map((p) => (
            <tr key={p.id}>
              <td>{p.parent_name ? `${p.parent_name} — ${p.variant_name || p.name}` : p.name}</td>
              <td className="text-small">{p.sku}</td>
              <td className="num">{p.stock}</td>
              <td className="num">
                <button
                  className="btn btn-sm btn-primary"
                  onClick={async () => {
                    const r = await run(() => api.put(`/offers/${offer.id}`, { product_id: p.id }), t('Linked'));
                    if (r) {
                      onDone();
                      onClose();
                    }
                  }}
                >
                  {t('Link')}
                </button>
              </td>
            </tr>
          ))}
          {results.data && !results.data.length && (
            <tr>
              <td className="text-muted">{t('Nothing found')}</td>
            </tr>
          )}
        </tbody>
      </table>
    </Modal>
  );
}

function EditOfferModal({ offer, onClose, onDone }: { offer: any; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const run = useAction();
  const [stock, setStock] = useState(String(offer.stock));
  const [price, setPrice] = useState(String(offer.price));
  return (
    <Modal
      title={t('Edit offer on marketplace')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              const body: any = {};
              if (Number(stock) !== offer.stock) body.stock = Math.max(0, Math.trunc(Number(stock)));
              if (Number(price.replace(',', '.')) !== offer.price) body.price = Number(price.replace(',', '.'));
              if (!Object.keys(body).length) return onClose();
              const r = await run(() => api.post(`/offers/${offer.id}/update`, body), t('Offer updated'));
              if (r) {
                onDone();
                onClose();
              }
            }}
          >
            {t('Send to marketplace')}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        <b>{offer.title}</b>
        <br />
        <span className="text-muted">{offer.integration_name}</span>
      </p>
      {offer.product_id && offer.sync_stock ? <p className="help-text">{t('Note: stock of this offer is synchronized with the inventory and may be overwritten.')}</p> : null}
      <div className="form-grid">
        <Field label={t('Stock')}>
          <input className="input" value={stock} onChange={(e) => setStock(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label={`${t('Price')} (${offer.currency})`}>
          <input className="input" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
        </Field>
      </div>
    </Modal>
  );
}
