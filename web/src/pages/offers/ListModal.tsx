import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { Field, MarketplaceLogo, Modal, useAction } from '../../components/ui';
import { useIntegrations } from '../../data';
import { useT } from '../../i18n';

/** "Wystaw oferty" — creates marketplace offers from inventory products. */
export function ListOnMarketplaceModal({ productIds, onClose, onDone }: { productIds: number[]; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const run = useAction();
  const qc = useQueryClient();
  const integrations = useIntegrations();
  const [integrationId, setIntegrationId] = useState<number | null>(null);
  const [markup, setMarkup] = useState('0');
  const [shipping, setShipping] = useState('');
  const [category, setCategory] = useState('');
  const [handling, setHandling] = useState('1');
  const [title, setTitle] = useState('{name}');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<any[] | null>(null);
  const integration = integrations.data?.find((i) => i.id === integrationId);
  const options = useQuery({
    queryKey: ['listing-options', integrationId],
    queryFn: () => api.get<any>(`/offers/listing-options/${integrationId}`),
    enabled: !!integrationId,
  });
  const submit = async () => {
    if (!integrationId) return;
    setBusy(true);
    const r = await run(() =>
      api.post('/offers/list', {
        integration_id: integrationId,
        product_ids: productIds,
        price_markup: Number(markup.replace(',', '.')) || 0,
        shipping_rates_id: shipping || undefined,
        category_id: category || undefined,
        handling_time: Number(handling) || undefined,
        title_template: title || undefined,
      }),
    );
    setBusy(false);
    if (r) {
      setResults(r.results);
      qc.invalidateQueries({ queryKey: ['offers'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      onDone();
    }
  };
  return (
    <Modal
      title={t('List {n} products on a marketplace', { n: productIds.length })}
      size="lg"
      onClose={onClose}
      footer={
        results ? (
          <>
            <Link to={`/offers?integration_id=${integrationId}`} className="btn" onClick={onClose}>
              {t('Show offers')}
            </Link>
            <button className="btn btn-primary" onClick={onClose}>
              {t('Close')}
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              {t('Cancel')}
            </button>
            <button className="btn btn-primary" disabled={!integrationId || busy} onClick={submit}>
              {busy ? t('Listing...') : t('List offers')}
            </button>
          </>
        )
      }
    >
      {results ? (
        <table className="tbl">
          <tbody>
            {results.map((r) => (
              <tr key={r.product_id}>
                <td style={{ width: 30 }}>{r.ok ? <CheckCircle2 size={18} color="var(--green)" /> : <XCircle size={18} color="var(--red)" />}</td>
                <td>
                  <Link to={`/products/${r.product_id}`}>{t('Product')} {r.product_id}</Link>
                </td>
                <td>{r.ok ? `${t('Offer')} ${r.offer_id}` : <span className="error-text">{r.error}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <div className="field-label mb">{t('Marketplace account')}</div>
          <div className="row wrap mb">
            {integrations.data?.map((i) => (
              <button
                key={i.id}
                className="btn"
                style={{ height: 54, borderWidth: 2, borderColor: integrationId === i.id ? 'var(--blue)' : undefined }}
                onClick={() => setIntegrationId(i.id)}
                disabled={!i.enabled}
              >
                <MarketplaceLogo type={i.type} size={30} /> {i.name}
              </button>
            ))}
            {!integrations.data?.length && (
              <Link to="/integrations/add" onClick={onClose}>
                {t('Add integration')}
              </Link>
            )}
          </div>
          {integration && (
            <div className="form-grid">
              <Field label={t('Offer title')} help={t('{name} — product name, {sku} — SKU')}>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label={t('Price change vs inventory (%)')} help={t('e.g. 10 = 10% higher than the inventory price')}>
                <input className="input" value={markup} onChange={(e) => setMarkup(e.target.value)} inputMode="decimal" />
              </Field>
              {integration.type === 'allegro' && (
                <>
                  <Field label={t('Shipping rates (cennik dostaw)')}>
                    <select className="select" value={shipping} onChange={(e) => setShipping(e.target.value)}>
                      <option value="">{t('— choose —')}</option>
                      {options.data?.shipping_rates?.map((s: any) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t('Allegro category ID (optional)')} help={t('Needed only when the product is not found in the Allegro catalogue by EAN')}>
                    <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} />
                  </Field>
                </>
              )}
              {integration.type !== 'allegro' && (
                <Field label={t('Handling time (days)')}>
                  <input className="input" value={handling} onChange={(e) => setHandling(e.target.value)} inputMode="numeric" />
                </Field>
              )}
              {options.data?.requires_ean && <p className="help-text full">{t('This marketplace identifies products by EAN — products without EAN will be skipped.')}</p>}
              {options.error && <p className="error-text full">{(options.error as Error).message}</p>}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
