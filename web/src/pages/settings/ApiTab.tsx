import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Empty, Field, Loading, Modal, useAction, useConfirm, useToast } from '../../components/ui';
import { fmtDateTime } from '../../format';
import { useT } from '../../i18n';

interface TokenRow {
  id: number;
  name: string;
  prefix: string;
  created_by: string;
  created_at: string;
  last_used_at: string | null;
}

const ENDPOINTS: [string, string, string][] = [
  ['GET', '/orders', 'Orders (filters as in the order list: status_ids, date_from, date_to, search, page, per_page ≤ 100; id_from — orders from this ID, oldest first)'],
  ['GET', '/orders/{id}', 'Order with items, payments, shipments, documents and history'],
  ['POST', '/orders', 'Create an order (items[] required)'],
  ['PUT', '/orders/{id}/status', 'Change status: {"status_id": 3}'],
  ['PUT', '/orders/{id}/payment', 'Set paid amount: {"paid_amount": 99.9}'],
  ['GET', '/statuses', 'Order statuses'],
  ['GET', '/products', 'Products with stock per warehouse (search, catalog_id, page, per_page ≤ 500)'],
  ['PUT', '/products/stock', 'Set stock: {"products": [{"sku": "ABC", "stock": 10, "warehouse_id": 1}]}'],
  ['PUT', '/products/prices', 'Set prices: {"products": [{"id": 15, "price": 49.99}]}'],
  ['GET', '/warehouses', 'Warehouses'],
];

export default function ApiTab() {
  const t = useT();
  const { isAdmin, user } = useAuth();
  const qc = useQueryClient();
  const run = useAction();
  const confirm = useConfirm();
  const toast = useToast();
  const q = useQuery({ queryKey: ['api-tokens'], queryFn: () => api.get<{ limit_per_minute: number; tokens: TokenRow[] }>('/api-tokens'), enabled: isAdmin });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['api-tokens'] });
  const base = `${window.location.origin}/api/v1`;
  const copy = (text: string) =>
    navigator.clipboard?.writeText(text).then(
      () => toast(t('Copied'), 'success'),
      () => undefined,
    );

  if (!isAdmin) return <Empty>{t('Administrator rights required')}</Empty>;
  return (
    <>
      <div className="card mb" style={{ maxWidth: 960 }}>
        <div className="card-head">
          <div className="card-title">{t('API tokens')}</div>
          {!user?.impersonator && (
            <button className="btn btn-primary btn-pill" onClick={() => (setName(''), setAdding(true))}>
              <Plus /> {t('Generate token')}
            </button>
          )}
        </div>
        <div className="card-pad" style={{ paddingTop: 0 }}>
          <p className="text-muted" style={{ margin: 0 }}>
            {t('The API lets your online store, ERP or scripts read orders and update stock and prices.')}{' '}
            {q.data && (
              <>
                {t('Limit: {n} requests per minute.', { n: q.data.limit_per_minute })} <Link to="/integrations/accelerations">{t('Increase the limit')}</Link>
              </>
            )}
          </p>
        </div>
        {!q.data ? (
          <Loading />
        ) : !q.data.tokens.length ? (
          <Empty icon={<KeyRound />}>{t('No API tokens yet')}</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('Name')}</th>
                <th>{t('Token')}</th>
                <th>{t('Created by')}</th>
                <th>{t('Created')}</th>
                <th>{t('Last used')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data.tokens.map((tk) => (
                <tr key={tk.id}>
                  <td>{tk.name}</td>
                  <td>
                    <span className="code">{tk.prefix}…</span>
                  </td>
                  <td>{tk.created_by || '—'}</td>
                  <td>{fmtDateTime(tk.created_at)}</td>
                  <td>{tk.last_used_at ? fmtDateTime(tk.last_used_at) : t('never')}</td>
                  <td className="num">
                    <button
                      className="icon-btn"
                      aria-label={t('Revoke')}
                      title={t('Revoke')}
                      onClick={async () => {
                        if (await confirm(t('Revoke token "{name}"? Integrations using it will stop working.', { name: tk.name }), { danger: true, okText: t('Revoke') })) {
                          await run(() => api.del(`/api-tokens/${tk.id}`), t('Token revoked'));
                          refresh();
                        }
                      }}
                    >
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card card-pad" style={{ maxWidth: 960 }}>
        <div className="card-title mb">{t('API documentation')}</div>
        <dl className="kv" style={{ gridTemplateColumns: '160px 1fr' }}>
          <dt>{t('Address')}:</dt>
          <dd>
            <span className="code">{base}</span>
          </dd>
          <dt>{t('Authorization')}:</dt>
          <dd>
            <span className="code">X-Api-Token: sh_…</span>
          </dd>
          <dt>{t('Format')}:</dt>
          <dd>JSON (UTF-8)</dd>
        </dl>
        <table className="tbl mt">
          <tbody>
            {ENDPOINTS.map(([m, path, desc]) => (
              <tr key={m + path}>
                <td className="nowrap">
                  <b>{m}</b>
                </td>
                <td className="nowrap">
                  <span className="code">{path}</span>
                </td>
                <td className="text-small">{t(desc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt text-small text-muted">{t('Example')}:</div>
        <pre className="code" style={{ display: 'block', padding: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {`curl -H "X-Api-Token: sh_…" "${base}/orders?per_page=20"`}
        </pre>
        <div className="text-small text-muted">{t('Errors return an HTTP status and {"error": "..."}. When the limit is exceeded the API returns 429 with a Retry-After header.')}</div>
      </div>

      {adding && (
        <Modal
          title={t('Generate token')}
          onClose={() => setAdding(false)}
          footer={
            <>
              <button className="btn" onClick={() => setAdding(false)}>
                {t('Cancel')}
              </button>
              <button
                className="btn btn-primary"
                disabled={!name.trim()}
                onClick={async () => {
                  const r = await run(() => api.post<{ token: string }>('/api-tokens', { name }));
                  if (r) {
                    setAdding(false);
                    setCreated(r.token);
                    refresh();
                  }
                }}
              >
                {t('Generate')}
              </button>
            </>
          }
        >
          <Field label={t('Name')} help={t('E.g. "Online store" or "ERP" — helps to recognize where the token is used.')}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
          </Field>
        </Modal>
      )}
      {created && (
        <Modal
          title={t('Your new API token')}
          onClose={() => setCreated(null)}
          footer={
            <button className="btn btn-primary" onClick={() => setCreated(null)}>
              {t('Done')}
            </button>
          }
        >
          <p style={{ marginTop: 0 }}>{t('Copy the token now — it will not be shown again.')}</p>
          <div className="row" style={{ gap: 8 }}>
            <input className="input" readOnly value={created} onFocus={(e) => e.target.select()} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }} />
            <button className="btn" onClick={() => copy(created)}>
              <Copy size={16} /> {t('Copy')}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
