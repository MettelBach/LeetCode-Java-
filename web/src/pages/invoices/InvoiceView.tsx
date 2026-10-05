import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, Plus, Trash2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { Empty, Field, Loading, Modal, useAction, useConfirm } from '../../components/ui';
import { useInvoiceSeries } from '../../data';
import { fmtDate, money, todayIso } from '../../format';
import { useT } from '../../i18n';
import { DOC_TYPES } from './InvoicesPage';

interface Item {
  name: string;
  quantity: number | string;
  unit?: string;
  price_gross: number | string;
  tax_rate: number | string;
}

const n = (v: any) => Number(String(v).replace(',', '.')) || 0;

function totals(items: Item[]) {
  let gross = 0;
  let net = 0;
  for (const i of items) {
    const g = Math.round(n(i.price_gross) * n(i.quantity) * 100) / 100;
    gross += g;
    net += Math.round((g / (1 + n(i.tax_rate) / 100)) * 100) / 100;
  }
  return { gross, net, tax: gross - net };
}

function ItemsEditor({ items, onChange, currency }: { items: Item[]; onChange: (i: Item[]) => void; currency: string }) {
  const t = useT();
  const upd = (idx: number, k: keyof Item, v: string) => onChange(items.map((x, i) => (i === idx ? { ...x, [k]: v } : x)));
  const tt = totals(items);
  return (
    <>
      <table className="tbl">
        <thead>
          <tr>
            <th>{t('Name')}</th>
            <th className="num">{t('Quantity')}</th>
            <th>{t('Unit')}</th>
            <th className="num">{t('Price (gross)')}</th>
            <th className="num">VAT %</th>
            <th className="num">{t('Value')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((i, idx) => (
            <tr key={idx}>
              <td>
                <input className="input input-sm" value={i.name} onChange={(e) => upd(idx, 'name', e.target.value)} />
              </td>
              <td className="num">
                <input className="input input-sm" style={{ width: 70, textAlign: 'right' }} value={i.quantity} onChange={(e) => upd(idx, 'quantity', e.target.value)} />
              </td>
              <td>
                <input className="input input-sm" style={{ width: 60 }} value={i.unit ?? 'szt.'} onChange={(e) => upd(idx, 'unit', e.target.value)} />
              </td>
              <td className="num">
                <input className="input input-sm" style={{ width: 100, textAlign: 'right' }} value={i.price_gross} onChange={(e) => upd(idx, 'price_gross', e.target.value)} />
              </td>
              <td className="num">
                <input className="input input-sm" style={{ width: 60, textAlign: 'right' }} value={i.tax_rate} onChange={(e) => upd(idx, 'tax_rate', e.target.value)} />
              </td>
              <td className="num">{money(n(i.price_gross) * n(i.quantity), currency)}</td>
              <td className="num">
                <button className="icon-btn" onClick={() => onChange(items.filter((_, j) => j !== idx))} aria-label={t('Delete')}>
                  <Trash2 size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row mt-sm">
        <button className="btn btn-sm" onClick={() => onChange([...items, { name: '', quantity: 1, unit: 'szt.', price_gross: '', tax_rate: 23 }])}>
          <Plus /> {t('Add line')}
        </button>
        <div className="grow" />
        <span>
          {t('Net')}: <b>{money(tt.net, currency)}</b> · VAT: <b>{money(tt.tax, currency)}</b> · {t('Gross')}: <b>{money(tt.gross, currency)}</b>
        </span>
      </div>
    </>
  );
}

export default function InvoiceView() {
  const { id } = useParams();
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const run = useAction();
  const confirm = useConfirm();
  const [correcting, setCorrecting] = useState(false);
  const q = useQuery({ queryKey: ['invoice', id], queryFn: () => api.get<any>(`/invoices/${id}`) });
  const v = q.data;
  if (q.isLoading) return <Loading />;
  if (!v) return <Empty>{t('Document not found')}</Empty>;
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          {t(DOC_TYPES[v.type])} {v.number}
          <small>
            {t('issued')} {fmtDate(v.issue_date)}
          </small>
        </h1>
        <div className="spacer" />
        {v.type === 'invoice' && (
          <button className="btn btn-pill" onClick={() => setCorrecting(true)}>
            {t('Issue correction')}
          </button>
        )}
        <button
          className="btn btn-pill btn-danger"
          onClick={async () => {
            if (await confirm(t('Delete document {n}? Only the last document in a numbering series can be deleted.', { n: v.number }), { danger: true, okText: t('Delete') })) {
              const r = await run(() => api.del(`/invoices/${v.id}`), t('Deleted'));
              if (r) {
                qc.invalidateQueries();
                nav('/invoices');
              }
            }
          }}
        >
          <Trash2 /> {t('Delete')}
        </button>
        <button className="btn btn-primary btn-pill" onClick={() => run(() => api.openPdf(`/invoices/${v.id}/pdf`))}>
          <FileDown /> PDF
        </button>
        <Link to="/invoices" className="btn btn-outline-blue">
          <Undo2 size={18} /> {t('Back')}
        </Link>
      </div>
      <div className="grid grid-3 mb">
        <div className="card card-pad">
          <div className="field-label">{t('Seller')}</div>
          <b>{v.seller.name}</b>
          <div>{v.seller.address}</div>
          <div>
            {v.seller.postcode} {v.seller.city}
          </div>
          {v.seller.nip && <div>NIP: {v.seller.nip}</div>}
        </div>
        <div className="card card-pad">
          <div className="field-label">{t('Buyer')}</div>
          <b>{v.buyer.company || v.buyer.name}</b>
          {v.buyer.company && <div>{v.buyer.name}</div>}
          <div>{v.buyer.address}</div>
          <div>
            {v.buyer.postcode} {v.buyer.city}
          </div>
          {v.buyer.nip && <div>NIP: {v.buyer.nip}</div>}
        </div>
        <div className="card card-pad">
          <dl className="kv" style={{ gridTemplateColumns: '140px 1fr' }}>
            <dt>{t('Issue date')}:</dt>
            <dd>{fmtDate(v.issue_date)}</dd>
            <dt>{t('Sale date')}:</dt>
            <dd>{fmtDate(v.sale_date)}</dd>
            <dt>{t('Payment due')}:</dt>
            <dd>{fmtDate(v.payment_due)}</dd>
            <dt>{t('Payment method')}:</dt>
            <dd>{v.payment_method || '—'}</dd>
            <dt>{t('Order')}:</dt>
            <dd>{v.order_id ? <Link to={`/orders/${v.order_id}`}>{v.order_id}</Link> : '—'}</dd>
            {v.corrected && (
              <>
                <dt>{t('Corrects')}:</dt>
                <dd>
                  <Link to={`/invoices/${v.corrected.id}`}>{v.corrected.number}</Link>
                </dd>
                {v.corrected.previous_correction && (
                  <>
                    <dt>{t('Previous correction')}:</dt>
                    <dd>
                      <Link to={`/invoices/${v.corrected.previous_correction.id}`}>{v.corrected.previous_correction.number}</Link>
                    </dd>
                  </>
                )}
                <dt>{t('Reason')}:</dt>
                <dd>{v.correction_reason}</dd>
              </>
            )}
            {v.currency !== 'PLN' && (
              <>
                <dt>{t('NBP rate')}:</dt>
                <dd>
                  {v.exchange_rate
                    ? `${Number(v.exchange_rate).toFixed(4)} (${v.exchange_rate_date}, ${v.exchange_rate_table})`
                    : t('not downloaded — VAT in PLN is not shown on the document')}
                </dd>
              </>
            )}
          </dl>
        </div>
      </div>
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>{t('Name')}</th>
              <th className="num">{t('Quantity')}</th>
              <th className="num">{t('Price (gross)')}</th>
              <th className="num">VAT</th>
              <th className="num">{t('Value (gross)')}</th>
            </tr>
          </thead>
          <tbody>
            {v.items.map((i: any, idx: number) => (
              <tr key={idx}>
                <td>{idx + 1}</td>
                <td>{i.name}</td>
                <td className="num">
                  {i.quantity} {i.unit}
                </td>
                <td className="num">{money(i.price_gross, v.currency)}</td>
                <td className="num">{i.tax_rate}%</td>
                <td className="num">{money(i.price_gross * i.quantity, v.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6} className="num" style={{ fontSize: 15 }}>
                {v.type === 'correction' ? t('Difference') : t('Total')}: {t('net')} <b>{money(v.total_net, v.currency)}</b> · VAT <b>{money(v.total_tax, v.currency)}</b> · {t('gross')}{' '}
                <b style={{ fontSize: 18 }}>{money(v.total_gross, v.currency)}</b>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {correcting && (
        <CorrectionModal
          invoice={v}
          onClose={() => setCorrecting(false)}
          onDone={(cid) => {
            qc.invalidateQueries();
            nav(`/invoices/${cid}`);
          }}
        />
      )}
    </>
  );
}

function CorrectionModal({ invoice, onClose, onDone }: { invoice: any; onClose: () => void; onDone: (id: number) => void }) {
  const t = useT();
  const run = useAction();
  const [items, setItems] = useState<Item[]>(invoice.items.map((i: any) => ({ ...i })));
  const [reason, setReason] = useState('');
  return (
    <Modal
      title={t('Correction to {n}', { n: invoice.number })}
      size="xl"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!reason.trim()}
            onClick={async () => {
              const r = await run(() =>
                api.post(`/invoices/${invoice.id}/correction`, {
                  reason: reason.trim(),
                  items: items.filter((i) => i.name.trim()).map((i) => ({ name: i.name, quantity: n(i.quantity), unit: i.unit, price_gross: n(i.price_gross), tax_rate: n(i.tax_rate) })),
                }),
              );
              if (r) onDone(r.id);
            }}
          >
            {t('Issue correction')}
          </button>
        </>
      }
    >
      <p className="help-text" style={{ marginTop: 0 }}>
        {t('Enter the values AFTER correction. To return a product set its quantity to 0.')}
      </p>
      <ItemsEditor items={items} onChange={setItems} currency={invoice.currency} />
      <Field label={t('Reason for correction')}>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('e.g. product return')} />
      </Field>
    </Modal>
  );
}

export function InvoiceNew() {
  const t = useT();
  const nav = useNavigate();
  const run = useAction();
  const series = useInvoiceSeries();
  const [type, setType] = useState<'invoice' | 'proforma' | 'receipt'>('invoice');
  const [seriesId, setSeriesId] = useState('');
  const [buyer, setBuyer] = useState({ name: '', company: '', nip: '', address: '', postcode: '', city: '', country: 'PL', email: '' });
  const [items, setItems] = useState<Item[]>([{ name: '', quantity: 1, unit: 'szt.', price_gross: '', tax_rate: 23 }]);
  const [issueDate, setIssueDate] = useState(todayIso());
  const [saleDate, setSaleDate] = useState(todayIso());
  const [payment, setPayment] = useState('Przelew');
  const [due, setDue] = useState('7');
  const [paid, setPaid] = useState(false);
  const [currency, setCurrency] = useState('PLN');
  const b = (k: keyof typeof buyer) => (e: React.ChangeEvent<HTMLInputElement>) => setBuyer({ ...buyer, [k]: e.target.value });
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{t('New document')}</h1>
        <div className="spacer" />
        <Link to="/invoices" className="btn btn-outline-blue">
          <Undo2 size={18} /> {t('Back')}
        </Link>
      </div>
      <div className="grid grid-2 mb">
        <div className="card card-pad">
          <div className="form-grid">
            <Field label={t('Type')}>
              <select className="select" value={type} onChange={(e) => (setType(e.target.value as any), setSeriesId(''))}>
                <option value="invoice">{t('Invoice')}</option>
                <option value="proforma">{t('Pro forma')}</option>
                <option value="receipt">{t('Receipt')}</option>
              </select>
            </Field>
            <Field label={t('Numbering series')}>
              <select className="select" value={seriesId} onChange={(e) => setSeriesId(e.target.value)}>
                <option value="">{t('Default')}</option>
                {series.data
                  ?.filter((s) => s.type === type)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={t('Issue date')}>
              <input className="input" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </Field>
            <Field label={t('Sale date')}>
              <input className="input" type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
            </Field>
            <Field label={t('Payment method')}>
              <input className="input" value={payment} onChange={(e) => setPayment(e.target.value)} />
            </Field>
            <Field label={t('Payment due (days)')}>
              <input className="input" value={due} onChange={(e) => setDue(e.target.value)} inputMode="numeric" />
            </Field>
            <Field label={t('Currency')}>
              <select className="select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {['PLN', 'EUR', 'CZK', 'USD'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label=" ">
              <label className="check-label" style={{ height: 40 }}>
                <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> {t('Paid')}
              </label>
            </Field>
          </div>
        </div>
        <div className="card card-pad">
          <div className="card-title mb">{t('Buyer')}</div>
          <div className="form-grid">
            <Field label={t('Company')}>
              <input className="input" value={buyer.company} onChange={b('company')} />
            </Field>
            <Field label="NIP">
              <input className="input" value={buyer.nip} onChange={b('nip')} />
            </Field>
            <Field label={t('Name and surname')}>
              <input className="input" value={buyer.name} onChange={b('name')} />
            </Field>
            <Field label={t('E-mail')}>
              <input className="input" value={buyer.email} onChange={b('email')} />
            </Field>
            <Field label={t('Address')} className="full">
              <input className="input" value={buyer.address} onChange={b('address')} />
            </Field>
            <Field label={t('Postal code')}>
              <input className="input" value={buyer.postcode} onChange={b('postcode')} />
            </Field>
            <Field label={t('City')}>
              <input className="input" value={buyer.city} onChange={b('city')} />
            </Field>
          </div>
        </div>
      </div>
      <div className="card card-pad">
        <ItemsEditor items={items} onChange={setItems} currency={currency} />
        <div className="row mt">
          <div className="grow" />
          <button
            className="btn btn-primary btn-pill"
            style={{ height: 46, padding: '0 30px' }}
            disabled={!(buyer.name || buyer.company) || !items.some((i) => i.name.trim())}
            onClick={async () => {
              const r = await run(() =>
                api.post('/invoices', {
                  type,
                  series_id: seriesId ? Number(seriesId) : undefined,
                  issue_date: issueDate,
                  sale_date: saleDate,
                  payment_method: payment,
                  payment_due_days: Number(due) || 0,
                  paid,
                  currency,
                  buyer,
                  items: items.filter((i) => i.name.trim()).map((i) => ({ name: i.name, quantity: n(i.quantity), unit: i.unit, price_gross: n(i.price_gross), tax_rate: n(i.tax_rate) })),
                }),
              );
              if (r) nav(`/invoices/${r.id}`);
            }}
          >
            {t('Issue document')}
          </button>
        </div>
      </div>
    </>
  );
}
