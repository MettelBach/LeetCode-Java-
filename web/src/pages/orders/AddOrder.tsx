import { useQuery } from '@tanstack/react-query';
import { Package, Plus, Trash2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { Field, useAction } from '../../components/ui';
import { useInvalidateOrders, useSettings, useStatuses } from '../../data';
import { COUNTRIES, money } from '../../format';
import { useT } from '../../i18n';
import { AddOrderButton } from './StatusColumn';

interface Line {
  key: number;
  product_id: number | null;
  name: string;
  sku: string;
  ean: string;
  quantity: string;
  price: string;
  tax_rate: string;
  stock?: number;
}

const num = (s: string) => Number(String(s).replace(',', '.')) || 0;

export default function AddOrder() {
  const t = useT();
  const nav = useNavigate();
  const run = useAction();
  const statuses = useStatuses();
  const settings = useSettings();
  const invalidate = useInvalidateOrders();
  const defTax = String(settings.data?.orders?.default_tax_rate ?? 23);
  const [f, setF] = useState<Record<string, any>>({
    currency: 'PLN',
    delivery_country_code: 'PL',
    invoice_country_code: 'PL',
    delivery_price: '0',
    payment_method: t('Bank transfer'),
    delivery_method: t('Courier shipment'),
    paid: false,
  });
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));
  const results = useQuery({ queryKey: ['product-search', search], queryFn: () => api.get<any[]>('/products/search', { q: search }), enabled: search.trim().length > 0 });
  const addLine = (p?: any) => {
    setLines((l) => [
      ...l,
      p
        ? {
            key: Date.now(),
            product_id: p.id,
            name: p.parent_name ? `${p.parent_name} ${p.variant_name || p.name}` : p.name,
            sku: p.sku,
            ean: p.ean,
            quantity: '1',
            price: String(p.price),
            tax_rate: String(p.tax_rate),
            stock: p.stock,
          }
        : { key: Date.now(), product_id: null, name: search, sku: '', ean: '', quantity: '1', price: '', tax_rate: defTax },
    ]);
    setSearch('');
  };
  const upd = (key: number, k: keyof Line, v: string) => setLines((l) => l.map((x) => (x.key === key ? { ...x, [k]: v } : x)));
  const itemsTotal = lines.reduce((s, l) => s + num(l.price) * Math.max(1, Math.trunc(num(l.quantity))), 0);
  const total = itemsTotal + num(f.delivery_price);

  const submit = async () => {
    setBusy(true);
    const body: any = {
      status_id: f.status_id ? Number(f.status_id) : undefined,
      user_login: f.user_login ?? '',
      email: f.email ?? '',
      phone: f.phone ?? '',
      currency: f.currency,
      payment_method: f.payment_method ?? '',
      payment_cod: !!f.payment_cod,
      delivery_method: f.delivery_method ?? '',
      delivery_price: num(f.delivery_price),
      delivery_fullname: f.delivery_fullname ?? '',
      delivery_company: f.delivery_company ?? '',
      delivery_address: f.delivery_address ?? '',
      delivery_postcode: f.delivery_postcode ?? '',
      delivery_city: f.delivery_city ?? '',
      delivery_country_code: f.delivery_country_code,
      delivery_point_id: f.delivery_point_id ?? '',
      delivery_point_name: f.delivery_point_name ?? '',
      invoice_wanted: !!f.invoice_wanted,
      invoice_fullname: f.invoice_wanted ? f.invoice_fullname ?? '' : '',
      invoice_company: f.invoice_wanted ? f.invoice_company ?? '' : '',
      invoice_nip: f.invoice_wanted ? f.invoice_nip ?? '' : '',
      invoice_address: f.invoice_wanted ? f.invoice_address ?? '' : '',
      invoice_postcode: f.invoice_wanted ? f.invoice_postcode ?? '' : '',
      invoice_city: f.invoice_wanted ? f.invoice_city ?? '' : '',
      invoice_country_code: f.invoice_country_code,
      buyer_comment: f.buyer_comment ?? '',
      seller_comment: f.seller_comment ?? '',
      paid_amount: f.paid ? Math.round(total * 100) / 100 : 0,
      items: lines
        .filter((l) => l.name.trim())
        .map((l) => ({
          product_id: l.product_id,
          name: l.name.trim(),
          sku: l.sku,
          ean: l.ean,
          quantity: Math.max(1, Math.trunc(num(l.quantity))),
          price: num(l.price),
          tax_rate: num(l.tax_rate),
        })),
    };
    const r = await run(() => api.post('/orders', body), t('Order created'));
    setBusy(false);
    if (r) {
      invalidate();
      nav(`/orders/${r.id}`);
    }
  };

  return (
    <div className="orders-layout">
      <div className="status-col">
        <AddOrderButton />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="page-head">
          <h1 className="page-title">{t('New order')}</h1>
          <div className="spacer" />
          <Link to="/orders" className="btn btn-outline-blue">
            <Undo2 size={18} /> {t('Return to the list of orders')}
          </Link>
        </div>

        <div className="card card-pad mb">
          <div className="card-title dot mb">{t('Products')}</div>
          <div className="field" style={{ position: 'relative' }}>
            <input className="input" style={{ height: 46 }} placeholder={t('Search inventory: name, SKU, EAN...')} value={search} onChange={(e) => setSearch(e.target.value)} />
            {search && (
              <div className="dd-menu" style={{ top: 50, width: '100%' }}>
                {results.data?.map((p) => (
                  <button key={p.id} className="dd-item" onClick={() => addLine(p)}>
                    <Package />
                    <span className="grow" style={{ whiteSpace: 'normal' }}>
                      {p.parent_name ? `${p.parent_name} — ${p.variant_name || p.name}` : p.name}
                    </span>
                    <span className="text-muted text-small">{p.sku}</span>
                    <span>{money(p.price)}</span>
                    <span className={`badge-soft ${p.stock > 0 ? 'green' : 'red'}`}>{p.stock}</span>
                  </button>
                ))}
                <button className="dd-item" onClick={() => addLine()}>
                  <Plus /> {t('Add "{name}" as a custom product', { name: search })}
                </button>
              </div>
            )}
          </div>
          {lines.length > 0 && (
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('Product name')}</th>
                  <th>SKU</th>
                  <th className="num">{t('Quantity')}</th>
                  <th className="num">{t('Price (gross)')}</th>
                  <th className="num">{t('Tax (%)')}</th>
                  <th className="num">{t('Value')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td>
                      <input className="input input-sm" value={l.name} onChange={(e) => upd(l.key, 'name', e.target.value)} />
                      {l.stock !== undefined && <span className={`text-small ${l.stock > 0 ? 'text-muted' : 'error-text'}`}>{t('In stock')}: {l.stock}</span>}
                    </td>
                    <td>
                      <input className="input input-sm" style={{ width: 130 }} value={l.sku} onChange={(e) => upd(l.key, 'sku', e.target.value)} />
                    </td>
                    <td className="num">
                      <input className="input input-sm" style={{ width: 70, textAlign: 'right' }} value={l.quantity} onChange={(e) => upd(l.key, 'quantity', e.target.value)} inputMode="numeric" />
                    </td>
                    <td className="num">
                      <input className="input input-sm" style={{ width: 100, textAlign: 'right' }} value={l.price} onChange={(e) => upd(l.key, 'price', e.target.value)} inputMode="decimal" />
                    </td>
                    <td className="num">
                      <input className="input input-sm" style={{ width: 60, textAlign: 'right' }} value={l.tax_rate} onChange={(e) => upd(l.key, 'tax_rate', e.target.value)} inputMode="decimal" />
                    </td>
                    <td className="num">{money(num(l.price) * Math.max(1, Math.trunc(num(l.quantity))), f.currency)}</td>
                    <td className="num">
                      <button className="icon-btn" onClick={() => setLines((x) => x.filter((y) => y.key !== l.key))} aria-label={t('Delete')}>
                        <Trash2 size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!lines.length && <div className="text-muted">{t('Search the inventory or type a name to add a custom product.')}</div>}
        </div>

        <div className="grid grid-3">
          <div className="card card-pad">
            <div className="card-title mb">{t('Buyer')}</div>
            <Field label={t('Name and surname')}>
              <input className="input" value={f.delivery_fullname ?? ''} onChange={set('delivery_fullname')} />
            </Field>
            <Field label={t('E-mail')}>
              <input className="input" type="email" value={f.email ?? ''} onChange={set('email')} />
            </Field>
            <Field label={t('Phone number')}>
              <input className="input" value={f.phone ?? ''} onChange={set('phone')} />
            </Field>
            <Field label={t('Client (login)')}>
              <input className="input" value={f.user_login ?? ''} onChange={set('user_login')} />
            </Field>
          </div>
          <div className="card card-pad">
            <div className="card-title mb">{t('Delivery address')}</div>
            <Field label={t('Company')}>
              <input className="input" value={f.delivery_company ?? ''} onChange={set('delivery_company')} />
            </Field>
            <Field label={t('Address')}>
              <input className="input" value={f.delivery_address ?? ''} onChange={set('delivery_address')} />
            </Field>
            <div className="form-grid">
              <Field label={t('Postal code')}>
                <input className="input" value={f.delivery_postcode ?? ''} onChange={set('delivery_postcode')} />
              </Field>
              <Field label={t('City')}>
                <input className="input" value={f.delivery_city ?? ''} onChange={set('delivery_city')} />
              </Field>
            </div>
            <Field label={t('Country')}>
              <select className="select" value={f.delivery_country_code} onChange={set('delivery_country_code')}>
                {Object.entries(COUNTRIES).map(([c, n]) => (
                  <option key={c} value={c}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('Pickup point (e.g. parcel locker ID)')}>
              <input className="input" value={f.delivery_point_id ?? ''} onChange={set('delivery_point_id')} placeholder="WAW01M" />
            </Field>
          </div>
          <div className="card card-pad">
            <div className="card-title mb">{t('Invoice data')}</div>
            <label className="check-label mb">
              <input type="checkbox" checked={!!f.invoice_wanted} onChange={set('invoice_wanted')} /> {t('The customer requests an invoice')}
            </label>
            {f.invoice_wanted && (
              <>
                <Field label={t('Company')}>
                  <input className="input" value={f.invoice_company ?? ''} onChange={set('invoice_company')} />
                </Field>
                <Field label={t('VAT Reg No')}>
                  <input className="input" value={f.invoice_nip ?? ''} onChange={set('invoice_nip')} />
                </Field>
                <Field label={t('Name and surname')}>
                  <input className="input" value={f.invoice_fullname ?? ''} onChange={set('invoice_fullname')} />
                </Field>
                <Field label={t('Address')}>
                  <input className="input" value={f.invoice_address ?? ''} onChange={set('invoice_address')} />
                </Field>
                <div className="form-grid">
                  <Field label={t('Postal code')}>
                    <input className="input" value={f.invoice_postcode ?? ''} onChange={set('invoice_postcode')} />
                  </Field>
                  <Field label={t('City')}>
                    <input className="input" value={f.invoice_city ?? ''} onChange={set('invoice_city')} />
                  </Field>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-2 mt">
          <div className="card card-pad">
            <div className="card-title mb">{t('Shipping and payment')}</div>
            <div className="form-grid">
              <Field label={t('Shipping method')}>
                <input className="input" value={f.delivery_method ?? ''} onChange={set('delivery_method')} list="delivery-methods" />
                <datalist id="delivery-methods">
                  {['Kurier DPD', 'Kurier InPost', 'Paczkomaty InPost', 'Poczta Polska', 'ORLEN Paczka', 'DHL', 'Odbiór osobisty'].map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </Field>
              <Field label={`${t('Shipping price')} (${f.currency})`}>
                <input className="input" value={f.delivery_price} onChange={set('delivery_price')} inputMode="decimal" />
              </Field>
              <Field label={t('Payment method')}>
                <input className="input" value={f.payment_method ?? ''} onChange={set('payment_method')} list="payment-methods" />
                <datalist id="payment-methods">
                  {['Przelew', 'Pobranie', 'Gotówka', 'BLIK', 'Karta płatnicza', 'PayU', 'Przelewy24'].map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </Field>
              <Field label={t('Currency')}>
                <select className="select" value={f.currency} onChange={set('currency')}>
                  {['PLN', 'EUR', 'CZK', 'USD', 'GBP'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="row wrap">
              <label className="check-label">
                <input type="checkbox" checked={!!f.payment_cod} onChange={set('payment_cod')} /> {t('Cash on delivery')}
              </label>
              <label className="check-label">
                <input type="checkbox" checked={!!f.paid} onChange={set('paid')} /> {t('Order is paid')}
              </label>
            </div>
          </div>
          <div className="card card-pad">
            <div className="card-title mb">{t('Other')}</div>
            <Field label={t('Status')}>
              <select className="select" value={f.status_id ?? ''} onChange={set('status_id')}>
                <option value="">{t('Default (new orders)')}</option>
                {statuses.data?.statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('Buyer comment')}>
              <textarea className="textarea" style={{ minHeight: 60 }} value={f.buyer_comment ?? ''} onChange={set('buyer_comment')} />
            </Field>
            <Field label={t('Seller notes (not visible to the buyer)')}>
              <textarea className="textarea" style={{ minHeight: 60 }} value={f.seller_comment ?? ''} onChange={set('seller_comment')} />
            </Field>
          </div>
        </div>

        <div className="card card-pad mt row">
          <div className="grow" style={{ fontSize: 16 }}>
            {t('Products')}: <b>{money(itemsTotal, f.currency)}</b> + {t('Shipping')}: <b>{money(num(f.delivery_price), f.currency)}</b> = <b style={{ fontSize: 20 }}>{money(total, f.currency)}</b>
          </div>
          <button className="btn btn-primary btn-pill" style={{ height: 48, padding: '0 34px', fontSize: 16 }} onClick={submit} disabled={busy}>
            {t('Add order')}
          </button>
        </div>
      </div>
    </div>
  );
}
