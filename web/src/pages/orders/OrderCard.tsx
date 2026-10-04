import { useQuery } from '@tanstack/react-query';
import {
  Archive,
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Flag,
  ListChecks,
  Mail,
  MoreVertical,
  Package,
  Pencil,
  Phone,
  Plus,
  Printer,
  RefreshCw,
  Scissors,
  Star,
  Trash2,
  TriangleAlert,
  Undo2,
  Warehouse,
  Wrench,
  X,
  Check,
  Send,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { ShipmentModal } from '../../components/ShipmentModal';
import { DdItem, Dropdown, Empty, Field, Loading, Modal, SourceIcon, useAction, useConfirm, useToast } from '../../components/ui';
import { COURIER_NAMES, useEmailTemplates, useInvalidateOrders, useInvoiceSeries, useRules, useSettings, useStatuses, type Status } from '../../data';
import { COUNTRIES, fmtDateTime, money } from '../../format';
import { useT } from '../../i18n';
import { AddOrderButton } from './StatusColumn';

export default function OrderCard() {
  const { id } = useParams();
  const t = useT();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['order', Number(id)], queryFn: () => api.get<any>(`/orders/${id}`) });
  const invalidate = useInvalidateOrders();
  const o = q.data;
  if (q.isLoading) return <Loading />;
  if (q.error || !o) return <Empty>{t('Order not found')}</Empty>;
  return (
    <div className="orders-layout">
      <div className="status-col">
        <AddOrderButton />
        <MiniStatusList currentStatus={o.status_id} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="page-head">
          <h1 className="page-title">
            <span className="row" style={{ gap: 10 }}>
              <button
                className={`star-btn ${o.star ? 'on' : ''}`}
                onClick={() => api.put(`/orders/${o.id}`, { star: o.star ? 0 : 1 }).then(invalidate)}
                title={t('Star')}
              >
                <Star size={26} fill={o.star ? '#f2b01e' : 'none'} style={{ width: 26, height: 26 }} />
              </button>
              {t('Order')} {o.id}
            </span>
            <small>
              {o.delivery_fullname || o.user_login}, {fmtDateTime(o.date_add)}
            </small>
            {o.deleted ? <span className="badge-soft red">{t('In bin')}</span> : o.archived ? <span className="badge-soft">{t('Archived')}</span> : null}
          </h1>
          <div className="spacer" />
          <button className="btn btn-round" disabled={!o.prev_id} onClick={() => nav(`/orders/${o.prev_id}`)} aria-label={t('Previous order')}>
            <ChevronLeft />
          </button>
          <button className="btn btn-round" disabled={!o.next_id} onClick={() => nav(`/orders/${o.next_id}`)} aria-label={t('Next order')}>
            <ChevronRight />
          </button>
          <Link to="/orders" className="btn btn-outline-blue" style={{ height: 50 }}>
            <Undo2 size={19} /> {t('Return to the list of orders')}
          </Link>
        </div>

        <ProductsCard o={o} />
        <OrderInfoCard o={o} />
        <AddressCards o={o} />
        <ShipmentsCard o={o} />
        <div className="grid grid-2 mt">
          <DocumentsCard o={o} />
          <ReturnsCard o={o} />
        </div>
        <HistoryCard o={o} />
      </div>
    </div>
  );
}

function MiniStatusList({ currentStatus }: { currentStatus: number }) {
  const t = useT();
  const { data } = useStatuses();
  if (!data) return null;
  return (
    <div className="status-list">
      <Link to="/orders" className="status-row all">
        {t('All')}
      </Link>
      {data.statuses.map((s) => (
        <Link key={s.id} to={`/orders?status=${s.id}`} className={`status-row ${s.id === currentStatus ? 'active' : ''}`}>
          <span className="count-box" style={{ background: s.color }}>
            {data.counts.by_status[s.id] || '-'}
          </span>
          {s.name}
        </Link>
      ))}
      <div className="status-sep" />
      <Link to="/orders?view=archive" className="status-row">
        <Archive size={17} /> {t('Archive')}
      </Link>
      <Link to="/orders?view=bin" className="status-row">
        <Trash2 size={17} /> {t('Bin')}
      </Link>
    </div>
  );
}

/* ------------------------------------ products ------------------------------------ */

function ProductsCard({ o }: { o: any }) {
  const t = useT();
  const invalidate = useInvalidateOrders();
  const run = useAction();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<any | null>(null);
  const [splitMode, setSplitMode] = useState(false);
  const [splitIds, setSplitIds] = useState<number[]>([]);
  const nav = useNavigate();
  const itemsTotal = o.items.reduce((s: number, i: any) => s + i.price * i.quantity, 0);
  return (
    <>
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              {splitMode && <th className="check" />}
              <th style={{ width: 80 }}>
                <Camera size={20} />
              </th>
              <th>{t('Prod. ID')}</th>
              <th>{t('Product name')}</th>
              <th className="num">{t('Quantity')}</th>
              <th className="num">{t('Price')}</th>
              <th className="num">{t('Tax')}</th>
              <th className="num">{t('Weight')}</th>
              <th>{t('Date')}</th>
              <th className="num">{t('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {o.items.map((i: any) => (
              <tr key={i.id} className={editing?.id === i.id ? 'selected' : ''}>
                {splitMode && (
                  <td className="check">
                    <input type="checkbox" checked={splitIds.includes(i.id)} onChange={() => setSplitIds((s) => (s.includes(i.id) ? s.filter((x) => x !== i.id) : [...s, i.id]))} />
                  </td>
                )}
                <td>
                  {i.image ? <img src={i.image} alt="" className="thumb" /> : <div className="thumb"><Package size={22} /></div>}
                </td>
                <td style={{ verticalAlign: 'middle' }}>
                  {i.product_id ? (
                    <Link to={`/products/${i.product_id}`} style={{ fontSize: 15 }}>
                      {i.product_id}
                    </Link>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td style={{ verticalAlign: 'middle', color: '#3d4249', fontSize: 15 }}>
                  {i.name}
                  {i.attributes && <span className="text-muted"> ({i.attributes})</span>}
                  {i.ean && <span> [EAN {i.ean}]</span>}
                  {i.sku && <span> [SKU {i.sku}]</span>}
                  {i.location && <div className="text-muted text-small">{t('Location')}: {i.location}</div>}
                  {i.auction_id && <div className="text-muted text-small">{t('Offer')}: {i.auction_id}</div>}
                </td>
                <td className="num" style={{ verticalAlign: 'middle', fontSize: 15 }}>
                  {i.quantity}
                </td>
                <td className="num" style={{ verticalAlign: 'middle', fontSize: 15 }}>
                  {i.price.toFixed(2)} {o.currency}
                </td>
                <td className="num" style={{ verticalAlign: 'middle' }}>
                  {i.tax_rate}%
                </td>
                <td className="num" style={{ verticalAlign: 'middle' }}>
                  {i.weight || 0}
                </td>
                <td style={{ verticalAlign: 'middle', fontSize: 13.5 }}>{fmtDateTime(i.created_at)}</td>
                <td className="num" style={{ verticalAlign: 'middle' }}>
                  <Dropdown
                    align="right"
                    trigger={(_o, toggle) => (
                      <button className="icon-btn" onClick={toggle} aria-label={t('Actions')}>
                        <MoreVertical size={18} />
                      </button>
                    )}
                  >
                    {(close) => (
                      <>
                        <DdItem icon={<Pencil />} onClick={() => (setEditing(i), close())}>
                          {t('Edit')}
                        </DdItem>
                        <DdItem
                          icon={<Trash2 />}
                          onClick={async () => {
                            close();
                            if (await confirm(t('Remove "{name}" from the order?', { name: i.name }), { danger: true }))
                              run(() => api.del(`/orders/${o.id}/items/${i.id}`)).then(invalidate);
                          }}
                        >
                          {t('Delete')}
                        </DdItem>
                        {i.product_id && (
                          <DdItem icon={<Warehouse />} onClick={() => nav(`/products/${i.product_id}?tab=history`)}>
                            {t('Stock levels history')}
                          </DdItem>
                        )}
                      </>
                    )}
                  </Dropdown>
                </td>
              </tr>
            ))}
            {editing?.id === 'new' && (
              <tr className="selected">
                <td colSpan={splitMode ? 10 : 9} style={{ textAlign: 'left', paddingLeft: 140 }}>
                  {t('Adding a new product...')}
                </td>
              </tr>
            )}
            {!o.items.length && editing?.id !== 'new' && (
              <tr>
                <td colSpan={10}>
                  <Empty>{t('No products in the order')}</Empty>
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={splitMode ? 5 : 4} className="num" style={{ borderTop: '1px solid var(--border)', color: '#5f666e' }}>
                {t('Products')}: <b>{itemsTotal.toFixed(2)} {o.currency}</b> &nbsp;+&nbsp; {t('Shipping')}: <b>{o.delivery_price.toFixed(2)} {o.currency}</b>
              </td>
              <td className="num" style={{ borderTop: '1px solid var(--border)', fontSize: 16, color: '#2f343a' }}>
                <b>{money(o.total, o.currency)}</b>
              </td>
              <td colSpan={5} style={{ borderTop: '1px solid var(--border)' }} />
            </tr>
          </tfoot>
        </table>
      </div>

      {editing && (
        <ItemForm
          o={o}
          item={editing.id === 'new' ? null : editing}
          preset={editing.preset}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
          }}
        />
      )}

      <div className="row mt mb">
        <div className="btn-group pill">
          <button className="btn" style={{ height: 50, padding: '0 24px', fontSize: 15 }} onClick={() => setEditing({ id: 'new' })}>
            <Plus /> {t('Add products to order...')}
          </button>
          <Dropdown
            trigger={(_o, toggle) => (
              <button className="btn" style={{ height: 50, borderRadius: '0 999px 999px 0' }} onClick={toggle}>
                <ChevronDown />
              </button>
            )}
          >
            {(close) => (
              <>
                <DdItem icon={<Warehouse />} onClick={() => (setEditing({ id: 'new' }), close())}>
                  {t('Product from inventory')}
                </DdItem>
                <DdItem icon={<Plus />} onClick={() => (setEditing({ id: 'new', preset: { custom: true } }), close())}>
                  {t('Custom product')}
                </DdItem>
                <DdItem icon={<Plus />} onClick={() => (setEditing({ id: 'new', preset: { custom: true, name: t('Discount'), price: -10, tax_rate: 23 } }), close())}>
                  {t('Discount')}
                </DdItem>
              </>
            )}
          </Dropdown>
        </div>
        <div className="grow" />
        {splitMode ? (
          <>
            <span className="text-muted">{t('Select products to move to a new order')}</span>
            <button className="btn btn-pill" onClick={() => (setSplitMode(false), setSplitIds([]))}>
              {t('Cancel')}
            </button>
            <button
              className="btn btn-primary btn-pill"
              disabled={!splitIds.length}
              onClick={async () => {
                const r = await run(() => api.post(`/orders/${o.id}/split`, { item_ids: splitIds }), t('Order split'));
                if (r) {
                  setSplitMode(false);
                  setSplitIds([]);
                  invalidate();
                  nav(`/orders/${r.id}`);
                }
              }}
            >
              <Scissors /> {t('Split order')}
            </button>
          </>
        ) : (
          <Dropdown
            align="right"
            trigger={(_o, toggle) => (
              <button className="btn btn-pill" style={{ height: 50, padding: '0 24px', fontSize: 15 }} onClick={toggle}>
                <Wrench /> {t('Operations on products')} <ChevronDown size={15} />
              </button>
            )}
          >
            {(close) => (
              <>
                <DdItem icon={<Scissors />} onClick={() => (setSplitMode(true), close())}>
                  {t('Split order')}
                </DdItem>
                <DdItem icon={<Printer />} onClick={() => (run(() => api.openPdf('/orders/print', { ids: [o.id], kind: 'pick_list' })), close())}>
                  {t('Pick list')}
                </DdItem>
              </>
            )}
          </Dropdown>
        )}
      </div>
    </>
  );
}

function ItemForm({ o, item, preset, onClose, onSaved }: { o: any; item: any | null; preset?: any; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const run = useAction();
  const settings = useSettings();
  const [f, setF] = useState<any>(
    item
      ? { ...item }
      : { name: preset?.name ?? '', quantity: 1, price: preset?.price ?? '', tax_rate: preset?.tax_rate ?? settings.data?.orders?.default_tax_rate ?? 23, weight: '', product_id: null, sku: '', ean: '', location: '', attributes: '', auction_id: '' },
  );
  const [search, setSearch] = useState('');
  const custom = !!item || preset?.custom;
  const results = useQuery({
    queryKey: ['product-search', search],
    queryFn: () => api.get<any[]>('/products/search', { q: search }),
    enabled: !custom && search.trim().length > 0,
  });
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const pick = (p: any) => {
    setF({
      ...f,
      product_id: p.id,
      name: p.parent_name ? `${p.parent_name} ${p.variant_name || p.name}` : p.name,
      sku: p.sku,
      ean: p.ean,
      price: p.price,
      tax_rate: p.tax_rate,
      weight: p.weight,
      location: p.location,
    });
    setSearch('');
  };
  const num = (v: any) => (v === '' || v === null || v === undefined ? undefined : Number(String(v).replace(',', '.')));
  const save = async () => {
    const body: any = {
      name: f.name,
      quantity: Math.max(1, Math.trunc(num(f.quantity) ?? 1)),
      price: num(f.price) ?? 0,
      tax_rate: num(f.tax_rate) ?? 23,
      weight: num(f.weight) ?? 0,
      sku: f.sku ?? '',
      ean: f.ean ?? '',
      location: f.location ?? '',
      attributes: f.attributes ?? '',
      auction_id: f.auction_id ?? '',
      product_id: f.product_id ? Number(f.product_id) : null,
    };
    const r = await run(() => (item ? api.put(`/orders/${o.id}/items/${item.id}`, body) : api.post(`/orders/${o.id}/items`, body)));
    if (r) onSaved();
  };
  return (
    <div className="card card-pad mt">
      <div className="card-title dot" style={{ fontSize: 22, marginBottom: 18 }}>
        {item ? t('Edition of the product in the order') : t('Adding product to the order')}
      </div>
      {!custom && !f.product_id && (
        <div className="field" style={{ position: 'relative' }}>
          <input className="input" style={{ height: 46 }} placeholder={t('Search inventory: name, SKU, EAN...')} value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          {!!results.data?.length && (
            <div className="dd-menu" style={{ top: 50, width: '100%' }}>
              {results.data.map((p) => (
                <button key={p.id} className="dd-item" onClick={() => pick(p)}>
                  <span className="grow" style={{ whiteSpace: 'normal' }}>
                    {p.parent_name ? `${p.parent_name} — ${p.variant_name || p.name}` : p.name}
                  </span>
                  <span className="text-muted text-small">{p.sku}</span>
                  <span className="text-small">{p.price.toFixed(2)}</span>
                  <span className={`badge-soft ${p.stock > 0 ? 'green' : 'red'}`}>{p.stock}</span>
                </button>
              ))}
            </div>
          )}
          {search && results.data && !results.data.length && <span className="help-text">{t('Nothing found')} — <button className="btn-link" onClick={() => set('name', search)}>{t('add as custom product')}</button></span>}
        </div>
      )}
      <div className="field">
        <input className="input" style={{ height: 46 }} placeholder={t('Product name')} value={f.name} onChange={(e) => set('name', e.target.value)} />
      </div>
      <div className="inline-fields mb">
        <Field label={t('Quantity')}>
          <input className="input" style={{ width: 110, textAlign: 'right' }} value={f.quantity} onChange={(e) => set('quantity', e.target.value)} inputMode="numeric" />
        </Field>
        <Field label={`${t('Price')} (${o.currency})`}>
          <input className="input" style={{ width: 130, textAlign: 'right' }} value={f.price} onChange={(e) => set('price', e.target.value)} inputMode="decimal" />
        </Field>
        <Field label={t('Tax (%)')}>
          <input className="input" style={{ width: 90 }} value={f.tax_rate} onChange={(e) => set('tax_rate', e.target.value)} inputMode="decimal" />
        </Field>
        <Field label={t('Weight')}>
          <input className="input" style={{ width: 100 }} value={f.weight} onChange={(e) => set('weight', e.target.value)} inputMode="decimal" />
        </Field>
      </div>
      <div className="field-label" style={{ color: '#9aa1a8', borderTop: '1px solid var(--border-light)', paddingTop: 12, marginBottom: 8 }}>
        {t('Optional fields')}:
      </div>
      <div className="inline-fields mb">
        <Field label={t('Product ID')}>
          <input className="input" style={{ width: 120 }} value={f.product_id ?? ''} onChange={(e) => set('product_id', e.target.value.replace(/\D/g, '') || null)} />
        </Field>
        <Field label="EAN">
          <input className="input" style={{ width: 170 }} value={f.ean ?? ''} onChange={(e) => set('ean', e.target.value)} />
        </Field>
        <Field label="SKU">
          <input className="input" style={{ width: 170 }} value={f.sku ?? ''} onChange={(e) => set('sku', e.target.value)} />
        </Field>
        <Field label={t('Location')}>
          <input className="input" style={{ width: 140 }} value={f.location ?? ''} onChange={(e) => set('location', e.target.value)} />
        </Field>
        <Field label={t('Offer no.')}>
          <input className="input" style={{ width: 150 }} value={f.auction_id ?? ''} onChange={(e) => set('auction_id', e.target.value)} />
        </Field>
        <Field label={t('Attributes')}>
          <input className="input" style={{ width: 200 }} value={f.attributes ?? ''} onChange={(e) => set('attributes', e.target.value)} />
        </Field>
      </div>
      <div className="row">
        <button className="btn btn-primary btn-pill" style={{ height: 46, padding: '0 28px' }} onClick={save} disabled={!f.name}>
          {t('Save')}
        </button>
        <button className="btn btn-pill" style={{ height: 46, padding: '0 28px' }} onClick={onClose}>
          {t('Cancel')}
        </button>
      </div>
    </div>
  );
}

/* --------------------------------- order information --------------------------------- */

function OrderInfoCard({ o }: { o: any }) {
  const t = useT();
  const nav = useNavigate();
  const statuses = useStatuses();
  const series = useInvoiceSeries();
  const templates = useEmailTemplates();
  const rules = useRules();
  const settings = useSettings();
  const invalidate = useInvalidateOrders();
  const run = useAction();
  const confirm = useConfirm();
  const toast = useToast();
  const [modal, setModal] = useState<null | 'info' | 'payment' | 'email' | 'note' | 'return' | 'ship'>(null);
  const [pendingStatus, setPendingStatus] = useState<number>(o.status_id);
  const st = statuses.data?.statuses.find((s) => s.id === o.status_id);
  const paidFull = o.paid_amount > 0 && o.paid_amount >= o.total - 0.001;
  const invoice = o.invoices.find((v: any) => v.type === 'invoice');
  const receipt = o.invoices.find((v: any) => v.type === 'receipt');
  const orderPage = `${window.location.origin}/order/${o.id}/${o.token}`;
  const s = settings.data?.orders ?? {};

  const changeStatus = async (statusId: number) => {
    const r = await run(() => api.post(`/orders/${o.id}/status`, { status_id: statusId }), t('Status changed'));
    if (r) invalidate();
  };
  const issue = async (type: string, seriesId?: number) => {
    const r = await run(() => api.post(`/orders/${o.id}/documents`, { type, series_id: seriesId }), t('Document issued'));
    if (r) {
      invalidate();
      api.openPdf(`/invoices/${r.id}/pdf`).catch(() => undefined);
    }
  };

  return (
    <div className="card mt">
      <div className="card-head">
        <div className="card-title" style={{ fontSize: 22 }}>
          {t('Order information')}
        </div>
        <Dropdown
          align="right"
          trigger={(_o, toggle) => (
            <button className="btn btn-pill btn-sm" style={{ height: 36 }} onClick={toggle}>
              <Printer /> {t('Printouts and exports')} <ChevronDown size={14} />
            </button>
          )}
        >
          {(close) => (
            <>
              <DdItem icon={<Printer />} onClick={() => (run(() => api.openPdf('/orders/print', { ids: [o.id], kind: 'order_card' })), close())}>
                {t('Order card')}
              </DdItem>
              <DdItem icon={<Printer />} onClick={() => (run(() => api.openPdf('/orders/print', { ids: [o.id], kind: 'packing_list' })), close())}>
                {t('Packing list')}
              </DdItem>
              {o.shipments.length > 0 && (
                <DdItem icon={<Printer />} onClick={() => (run(() => api.openPdf('/shipments/labels', { ids: o.shipments.map((x: any) => x.id) })).then(invalidate), close())}>
                  {t('Shipping labels')}
                </DdItem>
              )}
              {o.invoices.map((v: any) => (
                <DdItem key={v.id} icon={<FileText />} onClick={() => (run(() => api.openPdf(`/invoices/${v.id}/pdf`)), close())}>
                  {v.number}
                </DdItem>
              ))}
            </>
          )}
        </Dropdown>
        <div className="btn-group pill">
          <button className="btn btn-sm" style={{ height: 36 }} onClick={() => setModal('ship')}>
            <Package /> {t('Pack')}
          </button>
          <Dropdown
            align="right"
            trigger={(_o, toggle) => (
              <button className="btn btn-sm" style={{ height: 36, borderRadius: '0 999px 999px 0' }} onClick={toggle}>
                <ChevronDown size={14} />
              </button>
            )}
          >
            {(close) =>
              (['inpost', 'dpd', 'dhl', 'gls', 'ups', 'pocztex', 'orlen', 'allegro'] as const).map((c) => (
                <DdItem
                  key={c}
                  onClick={async () => {
                    close();
                    const r = await run(() => api.post(`/orders/${o.id}/shipments`, { courier: c }), t('Shipment created'));
                    if (r) invalidate();
                  }}
                >
                  {COURIER_NAMES[c]}
                </DdItem>
              ))
            }
          </Dropdown>
        </div>
        <Dropdown
          align="right"
          trigger={(_o, toggle) => (
            <button className="btn btn-pill btn-sm" style={{ height: 36 }} onClick={toggle}>
              {t('Actions')} <ChevronDown size={14} />
            </button>
          )}
        >
          {(close) => (
            <>
              <DdItem icon={<Pencil />} onClick={() => (setModal('info'), close())}>
                {t('Edit order data')}
              </DdItem>
              <DdItem icon={<Mail />} onClick={() => (setModal('email'), close())}>
                {t('Send e-mail')}
              </DdItem>
              <DdItem icon={<ListChecks />} onClick={() => (setModal('note'), close())}>
                {t('Add note to history')}
              </DdItem>
              <DdItem icon={<Undo2 />} onClick={() => (setModal('return'), close())}>
                {t('Create return')}
              </DdItem>
              <DdItem
                icon={<Copy />}
                onClick={async () => {
                  close();
                  const r = await run(() => api.post(`/orders/${o.id}/duplicate`), t('Order duplicated'));
                  if (r) {
                    invalidate();
                    nav(`/orders/${r.id}`);
                  }
                }}
              >
                {t('Duplicate order')}
              </DdItem>
              {rules.data?.some((r) => r.event === 'manual') && <div className="dd-head">{t('Run automatic action')}</div>}
              {rules.data
                ?.filter((r) => r.event === 'manual')
                .map((r) => (
                  <DdItem key={r.id} onClick={() => (run(() => api.post(`/orders/${o.id}/run-rule/${r.id}`), t('Done')).then(invalidate), close())}>
                    {r.name}
                  </DdItem>
                ))}
              <div className="dd-sep" />
              {o.deleted || o.archived ? (
                <DdItem icon={<Undo2 />} onClick={() => (run(() => api.post(`/orders/${o.id}/restore`), t('Restored')).then(invalidate), close())}>
                  {t('Restore')}
                </DdItem>
              ) : (
                <DdItem icon={<Archive />} onClick={() => (run(() => api.post(`/orders/${o.id}/archive`, { archived: true }), t('Moved to archive')).then(invalidate), close())}>
                  {t('Move to archive')}
                </DdItem>
              )}
              <DdItem
                icon={<Trash2 />}
                danger
                onClick={async () => {
                  close();
                  const msg = o.deleted ? t('Permanently delete this order? This cannot be undone.') : t('Move the order to the bin?');
                  if (!(await confirm(msg, { danger: true, okText: t('Delete') }))) return;
                  const r = await run(() => api.del(`/orders/${o.id}`), t('Deleted'));
                  if (r) {
                    invalidate();
                    if (r.result === 'purged') nav('/orders?view=bin');
                  }
                }}
              >
                {o.deleted ? t('Delete permanently') : t('Delete order')}
              </DdItem>
            </>
          )}
        </Dropdown>
      </div>

      <div className="grid grid-2" style={{ gap: 0 }}>
        <div style={{ borderRight: '1px solid var(--border-light)' }}>
          <div className="paid-row">
            <span style={{ color: '#5f666e', width: 110 }}>{t('Paid')}:</span>
            <span className="paid-amount" style={{ background: paidFull ? '#1e8e3e' : o.paid_amount > 0 ? '#f0803c' : '#d9363e' }}>
              {money(o.paid_amount, o.currency)}
            </span>
            <span style={{ fontSize: 15 }}>
              {t('of')} <b>{money(o.total, o.currency)}</b>
            </span>
            {!paidFull && (
              <button
                className="btn btn-round"
                style={{ width: 34, height: 34 }}
                title={t('Mark as fully paid')}
                onClick={() => run(() => api.post(`/orders/${o.id}/payment`, { paid_amount: o.total }), t('Payment saved')).then(invalidate)}
              >
                <RefreshCw size={15} />
              </button>
            )}
            <button className="edit-payment" onClick={() => setModal('payment')}>
              <Pencil size={17} /> {t('Edit payment')}
            </button>
          </div>
          <dl className="kv kv-section">
            <dt>{t('Client (login)')}:</dt>
            <dd>{o.user_login || '...'}</dd>
            <dt>{t('E-mail')}:</dt>
            <dd>{o.email ? <a href={`mailto:${o.email}`}>{o.email}</a> : '...'}</dd>
            <dt>{t('Phone number')}:</dt>
            <dd>
              {o.phone || '...'}{' '}
              {o.phone && (
                <a href={`tel:${o.phone.replace(/\s/g, '')}`} aria-label={t('Call')}>
                  <Phone size={15} />
                </a>
              )}
            </dd>
            <dt>{t('Order source')}:</dt>
            <dd>
              <span className="row" style={{ gap: 6 }}>
                <SourceIcon source={o.source} />
                {o.integration?.name ?? (o.source === 'manual' ? t('In person / by phone') : o.source)}
              </span>
              {o.external_id && <div className="text-muted text-small">ID: {o.external_id}</div>}
              {o.external_status && <div className="text-muted text-small">{t('Marketplace status')}: {o.external_status}</div>}
            </dd>
          </dl>
          <dl className="kv kv-section">
            <dt>{t('Shipping method')}:</dt>
            <dd>{o.delivery_method || '...'}</dd>
            <dt>{t('Shipping price')}:</dt>
            <dd>{money(o.delivery_price, o.currency)}</dd>
            <dt>{t('Payment method')}:</dt>
            <dd>
              {o.payment_method || '...'}
              {o.payment_cod ? <span className="badge-soft orange" style={{ marginLeft: 8 }}>{t('Cash on delivery')}</span> : null}
            </dd>
          </dl>
          <dl className="kv kv-section">
            <dt>{s.extra_field_1_label || t('Additional field 1')}:</dt>
            <dd>{o.extra_field_1 || '...'}</dd>
            <dt>{s.extra_field_2_label || t('Additional field 2')}:</dt>
            <dd>{o.extra_field_2 || '...'}</dd>
            <dt>{t('Buyer comment')}:</dt>
            <dd style={{ whiteSpace: 'pre-line' }}>{o.buyer_comment || '...'}</dd>
          </dl>
          <div style={{ padding: '0 22px 16px' }}>
            <button className="btn btn-sm" onClick={() => setModal('info')}>
              <Pencil /> {t('Edit')}
            </button>
          </div>
        </div>

        <div style={{ padding: '22px 22px 18px' }}>
          <div className="row" style={{ marginBottom: 14 }}>
            <span style={{ width: 160, color: '#5f666e', fontSize: 15 }} className="row">
              <Flag size={18} /> {t('Status')}:
            </span>
            <StatusPicker statuses={statuses.data?.statuses ?? []} value={pendingStatus} onChange={setPendingStatus} />
            <div className="btn-group">
              <button className="btn" style={{ height: 44, borderRadius: 2 }} disabled={pendingStatus === o.status_id} onClick={() => changeStatus(pendingStatus)}>
                {t('Change')}
              </button>
              <Dropdown
                align="right"
                trigger={(_o, toggle) => (
                  <button className="btn" style={{ height: 44, borderRadius: 2 }} onClick={toggle}>
                    <ChevronDown size={16} />
                  </button>
                )}
              >
                {(close) =>
                  statuses.data?.statuses.map((x) => (
                    <DdItem key={x.id} icon={<span className="color-dot" style={{ background: x.color }} />} onClick={() => (setPendingStatus(x.id), changeStatus(x.id), close())}>
                      {x.name}
                    </DdItem>
                  ))
                }
              </Dropdown>
            </div>
          </div>
          <div className="row" style={{ marginBottom: 10 }}>
            <span style={{ width: 160, color: '#5f666e', fontSize: 15 }}>{t('Receipt')}:</span>
            {receipt ? (
              <button className="btn-link" onClick={() => run(() => api.openPdf(`/invoices/${receipt.id}/pdf`))}>
                {receipt.number}
              </button>
            ) : (
              <button className="btn btn-caps" onClick={() => issue('receipt')}>
                {t('Create receipt')}
              </button>
            )}
          </div>
          <div className="row" style={{ marginBottom: 18 }}>
            <span style={{ width: 160, color: '#5f666e', fontSize: 15 }}>{t('Invoice')}:</span>
            {invoice ? (
              <span className="row" style={{ gap: 8 }}>
                <button className="btn-link" onClick={() => run(() => api.openPdf(`/invoices/${invoice.id}/pdf`))}>
                  {invoice.number}
                </button>
                <Link to={`/invoices/${invoice.id}`} className="btn btn-xs">
                  {t('Details')}
                </Link>
              </span>
            ) : (
              <div className="btn-group">
                <Dropdown
                  trigger={(_o, toggle) => (
                    <button className="btn btn-caps" style={{ borderRadius: '2px 0 0 2px' }} onClick={() => ((series.data?.filter((x) => x.type === 'invoice').length ?? 0) > 1 ? toggle() : issue('invoice'))}>
                      {t('Issue an invoice')}
                    </button>
                  )}
                >
                  {(close) =>
                    series.data
                      ?.filter((x) => x.type === 'invoice')
                      .map((x) => (
                        <DdItem key={x.id} onClick={() => (issue('invoice', x.id), close())}>
                          {x.name}
                        </DdItem>
                      ))
                  }
                </Dropdown>
                <button className="btn btn-caps" style={{ borderRadius: 0 }} onClick={() => issue('proforma')}>
                  {t('Pro forma')}
                </button>
                <button className="btn btn-caps" style={{ borderRadius: '0 2px 2px 0' }} title={t('Print order card')} onClick={() => run(() => api.openPdf('/orders/print', { ids: [o.id], kind: 'order_card' }))}>
                  <Printer />
                </button>
              </div>
            )}
          </div>
          <dl className="kv" style={{ gridTemplateColumns: '160px 1fr', fontSize: 15, rowGap: 6 }}>
            <dt>{t('Order date')}:</dt>
            <dd>{fmtDateTime(o.date_add)}</dd>
            <dt>{t('Date in status')}:</dt>
            <dd>{fmtDateTime(o.status_changed_at)}</dd>
            <dt>{t('Stock levels')}:</dt>
            <dd>
              {o.stock_deducted ? (
                <span className="row" style={{ gap: 6 }}>
                  <Check size={18} color="#1e8e3e" /> {t('Completed (deducted)')}
                </span>
              ) : (
                <span className="text-muted">{t('Not deducted')}</span>
              )}
            </dd>
            {st && (
              <>
                <dt>{t('Status for the buyer')}:</dt>
                <dd>{st.full_name || st.name}</dd>
              </>
            )}
          </dl>
          <div style={{ borderTop: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-light)', margin: '16px 0', padding: '14px 0' }}>
            <button className="note-pill" onClick={() => setModal('info')} title={t('Seller notes')}>
              <span className="ci">
                <ListChecks size={18} />
              </span>
              <span style={{ whiteSpace: 'pre-line', textAlign: 'left' }}>{o.seller_comment || t('Add a note for yourself...')}</span>
            </button>
          </div>
          <div style={{ fontWeight: 600, color: '#3d4249' }}>{t('Order information page')}:</div>
          <div className="row" style={{ gap: 8 }}>
            <a href={orderPage} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all' }}>
              {orderPage}
            </a>
            <button className="icon-btn" title={t('Copy')} onClick={() => navigator.clipboard?.writeText(orderPage).then(() => toast(t('Copied'), 'success'))}>
              <Copy size={16} />
            </button>
          </div>
        </div>
      </div>

      {modal === 'info' && <EditOrderModal o={o} onClose={() => setModal(null)} />}
      {modal === 'payment' && <PaymentModal o={o} onClose={() => setModal(null)} />}
      {modal === 'email' && <EmailModal o={o} templates={templates.data ?? []} onClose={() => setModal(null)} />}
      {modal === 'note' && <NoteModal o={o} onClose={() => setModal(null)} />}
      {modal === 'return' && <ReturnModal o={o} onClose={() => setModal(null)} />}
      {modal === 'ship' && <ShipmentModal orderIds={[o.id]} onClose={() => setModal(null)} onDone={invalidate} />}
    </div>
  );
}

function StatusPicker({ statuses, value, onChange }: { statuses: Status[]; value: number; onChange: (v: number) => void }) {
  const cur = statuses.find((s) => s.id === value);
  return (
    <Dropdown
      trigger={(_o, toggle) => (
        <button className="status-select" onClick={toggle} type="button">
          <span className="sq" style={{ background: cur?.color }} />
          <span className="grow" style={{ textAlign: 'left' }}>
            {cur?.name}
          </span>
          <ChevronDown size={16} color="#6c737b" />
        </button>
      )}
    >
      {(close) =>
        statuses.map((s) => (
          <DdItem key={s.id} icon={<span className="color-dot" style={{ background: s.color }} />} onClick={() => (onChange(s.id), close())}>
            {s.name}
          </DdItem>
        ))
      }
    </Dropdown>
  );
}

/* ------------------------------------ modals ------------------------------------ */

function useOrderSave(o: any, onClose: () => void) {
  const run = useAction();
  const t = useT();
  const invalidate = useInvalidateOrders();
  return async (patch: Record<string, any>) => {
    const r = await run(() => api.put(`/orders/${o.id}`, patch), t('Saved'));
    if (r) {
      invalidate();
      onClose();
    }
  };
}

function TextField({ label, value, onChange, ...rest }: { label: ReactNode; value: any; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>) {
  return (
    <Field label={label}>
      <input className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />
    </Field>
  );
}

function EditOrderModal({ o, onClose }: { o: any; onClose: () => void }) {
  const t = useT();
  const save = useOrderSave(o, onClose);
  const settings = useSettings();
  const s = settings.data?.orders ?? {};
  const [f, setF] = useState<any>({ ...o });
  const set = (k: string) => (v: any) => setF((x: any) => ({ ...x, [k]: v }));
  return (
    <Modal
      title={t('Edit order data')}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            className="btn btn-primary"
            onClick={() =>
              save({
                user_login: f.user_login,
                email: f.email,
                phone: f.phone,
                delivery_method: f.delivery_method,
                delivery_price: Number(String(f.delivery_price).replace(',', '.')) || 0,
                payment_method: f.payment_method,
                payment_cod: !!f.payment_cod,
                currency: f.currency,
                extra_field_1: f.extra_field_1,
                extra_field_2: f.extra_field_2,
                buyer_comment: f.buyer_comment,
                seller_comment: f.seller_comment,
              })
            }
          >
            {t('Save')}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <TextField label={t('Client (login)')} value={f.user_login} onChange={set('user_login')} />
        <TextField label={t('E-mail')} value={f.email} onChange={set('email')} type="email" />
        <TextField label={t('Phone number')} value={f.phone} onChange={set('phone')} />
        <Field label={t('Currency')}>
          <select className="select" value={f.currency} onChange={(e) => set('currency')(e.target.value)}>
            {['PLN', 'EUR', 'CZK', 'USD', 'GBP'].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <TextField label={t('Shipping method')} value={f.delivery_method} onChange={set('delivery_method')} />
        <TextField label={t('Shipping price')} value={f.delivery_price} onChange={set('delivery_price')} inputMode="decimal" />
        <TextField label={t('Payment method')} value={f.payment_method} onChange={set('payment_method')} />
        <Field label=" ">
          <label className="check-label" style={{ height: 40 }}>
            <input type="checkbox" checked={!!f.payment_cod} onChange={(e) => set('payment_cod')(e.target.checked)} /> {t('Cash on delivery')}
          </label>
        </Field>
        <TextField label={s.extra_field_1_label || t('Additional field 1')} value={f.extra_field_1} onChange={set('extra_field_1')} />
        <TextField label={s.extra_field_2_label || t('Additional field 2')} value={f.extra_field_2} onChange={set('extra_field_2')} />
        <Field label={t('Buyer comment')} className="full">
          <textarea className="textarea" value={f.buyer_comment} onChange={(e) => set('buyer_comment')(e.target.value)} />
        </Field>
        <Field label={t('Seller notes (not visible to the buyer)')} className="full">
          <textarea className="textarea" value={f.seller_comment} onChange={(e) => set('seller_comment')(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function PaymentModal({ o, onClose }: { o: any; onClose: () => void }) {
  const t = useT();
  const run = useAction();
  const invalidate = useInvalidateOrders();
  const [amount, setAmount] = useState(String(o.paid_amount.toFixed(2)));
  const save = async (v: number) => {
    const r = await run(() => api.post(`/orders/${o.id}/payment`, { paid_amount: v }), t('Payment saved'));
    if (r) {
      invalidate();
      onClose();
    }
  };
  return (
    <Modal
      title={t('Edit payment')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => save(Math.max(0, Number(amount.replace(',', '.')) || 0))}>
            {t('Save')}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        {t('Order total')}: <b>{money(o.total, o.currency)}</b>
      </p>
      <Field label={`${t('Paid amount')} (${o.currency})`}>
        <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus />
      </Field>
      <div className="row">
        <button className="btn btn-sm" onClick={() => setAmount(o.total.toFixed(2))}>
          {t('Fully paid')}
        </button>
        <button className="btn btn-sm" onClick={() => setAmount('0.00')}>
          {t('Not paid')}
        </button>
      </div>
    </Modal>
  );
}

function EmailModal({ o, templates, onClose }: { o: any; templates: any[]; onClose: () => void }) {
  const t = useT();
  const run = useAction();
  const toast = useToast();
  const invalidate = useInvalidateOrders();
  const [mode, setMode] = useState<'template' | 'custom'>(templates.length ? 'template' : 'custom');
  const [tpl, setTpl] = useState<number>(templates[0]?.id ?? 0);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const send = async () => {
    const r = await run(() => api.post(`/orders/${o.id}/email`, mode === 'template' ? { template_id: tpl } : { subject, body }));
    if (r) {
      invalidate();
      onClose();
      toast(`${t('E-mail')}: ${r.status}`, r.status === 'sent' ? 'success' : 'error');
    }
  };
  return (
    <Modal
      title={`${t('Send e-mail')} — ${o.email || t('no e-mail address')}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="btn btn-primary" onClick={send} disabled={!o.email || (mode === 'custom' && (!subject || !body))}>
            <Send /> {t('Send')}
          </button>
        </>
      }
    >
      <div className="row mb">
        <label className="check-label">
          <input type="radio" checked={mode === 'template'} onChange={() => setMode('template')} disabled={!templates.length} /> {t('From template')}
        </label>
        <label className="check-label">
          <input type="radio" checked={mode === 'custom'} onChange={() => setMode('custom')} /> {t('Custom message')}
        </label>
      </div>
      {mode === 'template' ? (
        <Field label={t('Template')}>
          <select className="select" value={tpl} onChange={(e) => setTpl(Number(e.target.value))}>
            {templates.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <>
          <Field label={t('Subject')}>
            <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label={t('Message')}>
            <textarea className="textarea" style={{ minHeight: 180 }} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
        </>
      )}
    </Modal>
  );
}

function NoteModal({ o, onClose }: { o: any; onClose: () => void }) {
  const t = useT();
  const run = useAction();
  const invalidate = useInvalidateOrders();
  const [text, setText] = useState('');
  return (
    <Modal
      title={t('Add note to history')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!text.trim()}
            onClick={async () => {
              const r = await run(() => api.post(`/orders/${o.id}/note`, { message: text.trim() }));
              if (r) {
                invalidate();
                onClose();
              }
            }}
          >
            {t('Save')}
          </button>
        </>
      }
    >
      <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} autoFocus maxLength={2000} />
    </Modal>
  );
}

function ReturnModal({ o, onClose }: { o: any; onClose: () => void }) {
  const t = useT();
  const run = useAction();
  const invalidate = useInvalidateOrders();
  const nav = useNavigate();
  const [qty, setQty] = useState<Record<number, number>>(Object.fromEntries(o.items.map((i: any) => [i.id, i.quantity])));
  const [reason, setReason] = useState('');
  const [account, setAccount] = useState('');
  const items = o.items.filter((i: any) => (qty[i.id] ?? 0) > 0).map((i: any) => ({ order_item_id: i.id, name: i.name, sku: i.sku, quantity: qty[i.id], price: i.price }));
  const refund = items.reduce((s: number, i: any) => s + i.price * i.quantity, 0);
  return (
    <Modal
      title={t('Create return')}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!items.length}
            onClick={async () => {
              const r = await run(() => api.post(`/orders/${o.id}/returns`, { items, reason, bank_account: account }), t('Return created'));
              if (r) {
                invalidate();
                onClose();
                nav(`/returns/${r.id}`);
              }
            }}
          >
            {t('Create return')}
          </button>
        </>
      }
    >
      <table className="tbl mb">
        <thead>
          <tr>
            <th>{t('Product')}</th>
            <th className="num">{t('Ordered')}</th>
            <th className="num">{t('Returned')}</th>
          </tr>
        </thead>
        <tbody>
          {o.items.map((i: any) => (
            <tr key={i.id}>
              <td>{i.name}</td>
              <td className="num">{i.quantity}</td>
              <td className="num">
                <input
                  className="input input-sm"
                  style={{ width: 80, textAlign: 'right' }}
                  type="number"
                  min={0}
                  max={i.quantity}
                  value={qty[i.id] ?? 0}
                  onChange={(e) => setQty((q) => ({ ...q, [i.id]: Math.min(i.quantity, Math.max(0, Number(e.target.value) || 0)) }))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form-grid">
        <Field label={t('Reason')} className="full">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label={t('Bank account for refund')}>
          <input className="input" value={account} onChange={(e) => setAccount(e.target.value)} />
        </Field>
        <Field label={t('Refund amount')}>
          <input className="input" value={money(refund, o.currency)} readOnly />
        </Field>
      </div>
    </Modal>
  );
}

/* ------------------------------------ addresses ------------------------------------ */

function AddressCards({ o }: { o: any }) {
  const t = useT();
  const [edit, setEdit] = useState<null | 'delivery' | 'invoice' | 'point'>(null);
  const save = useOrderSave(o, () => setEdit(null));
  const copyDeliveryToInvoice = () =>
    save({
      invoice_fullname: o.delivery_fullname,
      invoice_company: o.delivery_company,
      invoice_address: o.delivery_address,
      invoice_postcode: o.delivery_postcode,
      invoice_city: o.delivery_city,
      invoice_country_code: o.delivery_country_code,
    });
  const v = (x: string) => x || '...';
  return (
    <div className="grid grid-3 mt">
      <div className="card addr-card">
        <div className="card-head">
          <div className="card-title">{t('Delivery address')}</div>
          <button className="btn btn-round" style={{ width: 40, height: 40 }} title={t('Copy to invoice data')} onClick={copyDeliveryToInvoice}>
            <Copy size={16} />
          </button>
          <button className="btn btn-round" style={{ width: 40, height: 40 }} title={t('Edit')} onClick={() => setEdit('delivery')}>
            <Pencil size={16} />
          </button>
        </div>
        <dl className="kv">
          <dt>{t('Name and surname')}:</dt>
          <dd>{v(o.delivery_fullname)}</dd>
          <dt>{t('Company')}:</dt>
          <dd>{v(o.delivery_company)}</dd>
          <dt>{t('Address')}:</dt>
          <dd>{v(o.delivery_address)}</dd>
          <dt>{t('Postal code and city')}:</dt>
          <dd>
            {o.delivery_postcode} &nbsp; {o.delivery_city}
          </dd>
          <dt>{t('Country')}:</dt>
          <dd>{COUNTRIES[o.delivery_country_code] ?? o.delivery_country_code}</dd>
        </dl>
      </div>
      <div className="card addr-card">
        <div className="card-head">
          <div className="card-title">{t('Invoice data')}</div>
          <button className="btn btn-round" style={{ width: 40, height: 40 }} title={t('Edit')} onClick={() => setEdit('invoice')}>
            <Pencil size={16} />
          </button>
        </div>
        {!!o.invoice_wanted && (
          <div className="warn-strip">
            <TriangleAlert size={24} /> <FileText size={16} /> {t('The customer requests an invoice')}
          </div>
        )}
        <dl className="kv">
          <dt>{t('Name and surname')}:</dt>
          <dd>{v(o.invoice_fullname)}</dd>
          <dt>{t('Company')}:</dt>
          <dd>{v(o.invoice_company)}</dd>
          <dt>{t('Address')}:</dt>
          <dd>{v(o.invoice_address)}</dd>
          <dt>{t('Postal code and city')}:</dt>
          <dd>
            {o.invoice_postcode} &nbsp; {o.invoice_city} &nbsp; {o.invoice_address ? COUNTRIES[o.invoice_country_code] ?? o.invoice_country_code : ''}
          </dd>
          <dt>{t('VAT Reg No')}:</dt>
          <dd>{v(o.invoice_nip)}</dd>
        </dl>
      </div>
      <div className="card addr-card">
        <div className="card-head">
          <div className="card-title">{t('Pickup at point')}</div>
          <button className="btn btn-round" style={{ width: 40, height: 40 }} title={t('Edit')} onClick={() => setEdit('point')}>
            <Pencil size={16} />
          </button>
        </div>
        <dl className="kv">
          <dt>{t('Name')}:</dt>
          <dd>{o.delivery_point_id ? `${o.delivery_point_id} ${o.delivery_point_name}` : '...'}</dd>
          <dt>{t('Address')}:</dt>
          <dd>{v(o.delivery_point_address)}</dd>
          <dt>{t('Postal code and city')}:</dt>
          <dd>
            {o.delivery_point_postcode || '...'} &nbsp; {o.delivery_point_city || '...'}
          </dd>
        </dl>
      </div>
      {edit && <AddressModal o={o} kind={edit} onClose={() => setEdit(null)} onSave={save} />}
    </div>
  );
}

function AddressModal({ o, kind, onClose, onSave }: { o: any; kind: 'delivery' | 'invoice' | 'point'; onClose: () => void; onSave: (p: any) => void }) {
  const t = useT();
  const fields: [string, string][] =
    kind === 'delivery'
      ? [
          ['delivery_fullname', t('Name and surname')],
          ['delivery_company', t('Company')],
          ['delivery_address', t('Address')],
          ['delivery_postcode', t('Postal code')],
          ['delivery_city', t('City')],
          ['delivery_country_code', t('Country')],
        ]
      : kind === 'invoice'
        ? [
            ['invoice_fullname', t('Name and surname')],
            ['invoice_company', t('Company')],
            ['invoice_nip', t('VAT Reg No')],
            ['invoice_address', t('Address')],
            ['invoice_postcode', t('Postal code')],
            ['invoice_city', t('City')],
            ['invoice_country_code', t('Country')],
          ]
        : [
            ['delivery_point_id', t('Point ID')],
            ['delivery_point_name', t('Name')],
            ['delivery_point_address', t('Address')],
            ['delivery_point_postcode', t('Postal code')],
            ['delivery_point_city', t('City')],
          ];
  const [f, setF] = useState<any>(Object.fromEntries(fields.map(([k]) => [k, o[k] ?? ''])).valueOf());
  const [wants, setWants] = useState(!!o.invoice_wanted);
  const title = kind === 'delivery' ? t('Delivery address') : kind === 'invoice' ? t('Invoice data') : t('Pickup at point');
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => onSave(kind === 'invoice' ? { ...f, invoice_wanted: wants } : f)}>
            {t('Save')}
          </button>
        </>
      }
    >
      <div className="form-grid">
        {fields.map(([k, label]) =>
          k.endsWith('country_code') ? (
            <Field key={k} label={label}>
              <select className="select" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
                {Object.entries(COUNTRIES).map(([c, n]) => (
                  <option key={c} value={c}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <TextField key={k} label={label} value={f[k]} onChange={(v) => setF({ ...f, [k]: v })} />
          ),
        )}
        {kind === 'invoice' && (
          <label className="check-label full" style={{ marginBottom: 10 }}>
            <input type="checkbox" checked={wants} onChange={(e) => setWants(e.target.checked)} /> {t('The customer requests an invoice')}
          </label>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------ shipments ------------------------------------ */

const SHIP_PROGRESS: Record<string, number> = {
  created: 10,
  label_printed: 20,
  picked_up: 40,
  in_transit: 60,
  out_for_delivery: 80,
  delivered: 100,
  returned: 100,
  canceled: 0,
};

export const SHIP_STATUS_LABEL: Record<string, string> = {
  created: 'Created',
  label_printed: 'Label printed',
  picked_up: 'Picked up by the courier',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  returned: 'Returned to sender',
  canceled: 'Canceled',
};

function ShipmentsCard({ o }: { o: any }) {
  const t = useT();
  const run = useAction();
  const confirm = useConfirm();
  const invalidate = useInvalidateOrders();
  const [courier, setCourier] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const main = ['allegro', 'inpost', 'inpost_courier', 'dpd', 'dhl', 'gls', 'ups', 'pocztex', 'orlen'];
  const list = showAll ? [...main, 'fedex', 'other'] : main;
  return (
    <div className="card card-pad mt">
      <div className="card-title dot" style={{ fontSize: 22, marginBottom: 14 }}>
        {t('Shipments')}
      </div>
      {o.shipments.length > 0 && (
        <table className="tbl mb">
          <thead>
            <tr>
              <th>{t('Shipment date')}</th>
              <th>{t('Courier')}</th>
              <th>{t('Account name')}</th>
              <th>{t('Package number')}</th>
              <th>{t('Status')}</th>
              <th />
              <th className="num">{t('Delete')}</th>
            </tr>
          </thead>
          <tbody>
            {o.shipments.map((s: any) => (
              <tr key={s.id}>
                <td>{fmtDateTime(s.created_at)}</td>
                <td>
                  <span className="row" style={{ gap: 4 }}>
                    <span className={`ico ${s.sent_to_source ? 'blue' : 'outline'}`} title={s.sent_to_source ? t('Package number was sent to the order source ({date})', { date: fmtDateTime(s.sent_to_source_at) }) : t('Package number not sent to the order source')}>
                      <Check />
                    </span>
                    <a>{COURIER_NAMES[s.courier] ?? s.courier}</a>
                  </span>
                </td>
                <td>{s.account_name}</td>
                <td className="code" style={{ background: 'none' }}>
                  {s.tracking_number}
                </td>
                <td style={{ minWidth: 220 }}>
                  <span className="progress">
                    <div style={{ width: `${SHIP_PROGRESS[s.status] ?? 10}%`, background: s.status === 'canceled' || s.status === 'returned' ? 'var(--red)' : undefined }} />
                  </span>{' '}
                  <span className="text-small">{t(SHIP_STATUS_LABEL[s.status] ?? s.status)}</span>
                </td>
                <td className="nowrap">
                  <div className="btn-group">
                    <button className="btn btn-xs btn-caps" style={{ height: 30 }} onClick={() => run(() => api.openPdf('/shipments/labels', { ids: [s.id] })).then(invalidate)}>
                      {t('Label')}
                    </button>
                    <button className="btn btn-xs" style={{ height: 30 }} onClick={() => run(() => api.openPdf('/shipments/labels', { ids: [s.id] })).then(invalidate)} aria-label={t('Print')}>
                      <Printer size={14} />
                    </button>
                  </div>{' '}
                  {o.integration_id && !s.sent_to_source && (
                    <button className="btn btn-xs" style={{ height: 30 }} onClick={() => run(() => api.post(`/shipments/${s.id}/send-tracking`), t('Sent')).then(invalidate)}>
                      {t('Send number to marketplace')}
                    </button>
                  )}
                </td>
                <td className="num">
                  <button
                    className="btn btn-round"
                    style={{ width: 34, height: 34, background: '#eef0f2', border: 0 }}
                    aria-label={t('Delete')}
                    onClick={async () => {
                      if (await confirm(t('Delete shipment {n}?', { n: s.tracking_number }), { danger: true })) run(() => api.del(`/shipments/${s.id}`)).then(invalidate);
                    }}
                  >
                    <X size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="courier-grid">
        {list.map((c) => (
          <button key={c} className={`courier-btn ${['allegro', 'inpost'].includes(c) ? 'connected' : ''}`} onClick={() => setCourier(c)}>
            {c === 'other' ? t('Other') : COURIER_NAMES[c]}
          </button>
        ))}
        <button className="courier-btn" style={{ background: '#f1f3f5' }} onClick={() => setShowAll((x) => !x)}>
          {showAll ? t('hide others') : t('show/hide others')} <ChevronDown size={14} style={{ verticalAlign: 'middle' }} />
        </button>
      </div>
      {courier && <ShipmentModal orderIds={[o.id]} defaultCourier={courier} onClose={() => setCourier(null)} onDone={invalidate} />}
    </div>
  );
}

/* --------------------------------- documents & returns --------------------------------- */

function DocumentsCard({ o }: { o: any }) {
  const t = useT();
  const run = useAction();
  const TYPE: Record<string, string> = { invoice: t('Invoice'), proforma: t('Pro forma'), receipt: t('Receipt'), correction: t('Correction') };
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">{t('Sales documents')}</div>
      </div>
      {!o.invoices.length ? (
        <div className="text-muted" style={{ padding: '0 20px 20px' }}>
          {t('No documents issued')}
        </div>
      ) : (
        <table className="tbl">
          <tbody>
            {o.invoices.map((v: any) => (
              <tr key={v.id}>
                <td>{TYPE[v.type] ?? v.type}</td>
                <td>
                  <Link to={`/invoices/${v.id}`}>{v.number}</Link>
                </td>
                <td>{v.issue_date}</td>
                <td className="num">{money(v.total_gross, v.currency)}</td>
                <td className="num">
                  <button className="btn btn-xs" onClick={() => run(() => api.openPdf(`/invoices/${v.id}/pdf`))}>
                    PDF
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ReturnsCard({ o }: { o: any }) {
  const t = useT();
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">{t('Returns')}</div>
      </div>
      {!o.returns.length ? (
        <div className="text-muted" style={{ padding: '0 20px 20px' }}>
          {t('No returns')}
        </div>
      ) : (
        <table className="tbl">
          <tbody>
            {o.returns.map((r: any) => (
              <tr key={r.id}>
                <td>
                  <Link to={`/returns/${r.id}`}>#{r.id}</Link>
                </td>
                <td>{fmtDateTime(r.created_at)}</td>
                <td className="num">{money(r.refund_amount, o.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const HISTORY_TYPES = ['all', 'status', 'payment', 'items', 'shipment', 'invoice', 'email', 'automation', 'sync', 'note'] as const;

function HistoryCard({ o }: { o: any }) {
  const t = useT();
  const [type, setType] = useState<(typeof HISTORY_TYPES)[number]>('all');
  const rows = o.history.filter((h: any) => type === 'all' || h.type === type || (type === 'sync' && h.type === 'error'));
  return (
    <div className="card mt">
      <div className="card-head">
        <div className="card-title">{t('Order history')}</div>
        <select className="select" style={{ width: 200, height: 34 }} value={type} onChange={(e) => setType(e.target.value as any)}>
          {HISTORY_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(HISTORY_LABEL[x])}
            </option>
          ))}
        </select>
      </div>
      <div className="history-list">
        {rows.map((h: any) => (
          <div className="h" key={h.id}>
            <span className="when">{fmtDateTime(h.created_at)}</span>
            <span className="text-muted">{h.user_name}</span>
            <span style={{ color: h.type === 'error' ? 'var(--red)' : undefined }}>{h.message}</span>
          </div>
        ))}
        {!rows.length && <div className="text-muted" style={{ padding: '0 22px 18px' }}>{t('No entries')}</div>}
      </div>
    </div>
  );
}

const HISTORY_LABEL: Record<string, string> = {
  all: 'All events',
  status: 'Status changes',
  payment: 'Payments',
  items: 'Products',
  shipment: 'Shipments',
  invoice: 'Documents',
  email: 'E-mails',
  automation: 'Automatic actions',
  sync: 'Marketplace',
  note: 'Notes',
};
