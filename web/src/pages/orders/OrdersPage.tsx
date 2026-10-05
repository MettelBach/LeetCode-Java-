import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownWideNarrow,
  Banknote,
  Check,
  CheckSquare,
  ChevronDown,
  Download,
  FileText,
  Flag,
  Mail,
  Menu,
  Printer,
  RefreshCw,
  Search,
  Star,
  Truck,
  Warehouse,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { ShipmentModal } from '../../components/ShipmentModal';
import { DdItem, Dropdown, Empty, Field, Loading, Modal, Pager, SourceIcon, StatusBadge, useAction, useConfirm, useToast } from '../../components/ui';
import { useEmailTemplates, useIntegrations, useInvalidateOrders, useInvoiceSeries, useRules, useSettings, useStatuses } from '../../data';
import { flag, fmtDateTime, money } from '../../format';
import { useT } from '../../i18n';
import { StatusColumn } from './StatusColumn';
import { SHIP_STATUS_LABEL } from './historyText';

const FILTER_KEYS = [
  'search',
  'buyer',
  'product',
  'comment',
  'sources',
  'integration_ids',
  'payment',
  'cod',
  'delivery_method',
  'payment_method',
  'country',
  'date_from',
  'date_to',
  'price_min',
  'price_max',
  'invoice',
  'shipment',
  'star',
  'status_date_from',
  'status_date_to',
  'paid_from',
  'paid_to',
  'status_days',
  'label',
  'shipment_status',
  'warehouse_id',
  'currency',
  'has_return',
  'locked',
  'unlinked',
  'receipt',
  'items_min',
] as const;

export default function OrdersPage() {
  const t = useT();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const statuses = useStatuses();
  const settings = useSettings();
  const invalidate = useInvalidateOrders();
  const run = useAction();
  const toast = useToast();
  const confirm = useConfirm();
  const [selected, setSelected] = useState<number[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [shipFor, setShipFor] = useState<number[] | null>(null);

  // "status" accepts an id or a system key (e.g. ?status=to_send from quick access).
  const statusParam = params.get('status');
  const statusId = useMemo(() => {
    if (!statusParam) return null;
    if (/^\d+$/.test(statusParam)) return Number(statusParam);
    return statuses.data?.statuses.find((s) => s.system_key === statusParam)?.id ?? null;
  }, [statusParam, statuses.data]);
  const view = params.get('view') ?? 'active';
  const page = Number(params.get('page') ?? 1);
  const perPage = settings.data?.orders?.orders_per_page ?? 50;
  const sort = params.get('sort') ?? 'id';
  const dir = params.get('dir') ?? 'desc';

  const filters: Record<string, string> = {};
  for (const k of FILTER_KEYS) {
    const v = params.get(k);
    if (v) filters[k] = v;
  }
  const query = { ...filters, view, status_id: statusId ?? undefined, page, per_page: perPage, sort, dir };
  const orders = useQuery({
    queryKey: ['orders', query],
    queryFn: () => api.get<{ total: number; rows: any[] }>('/orders', query),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  useEffect(() => setSelected([]), [statusId, view, page, JSON.stringify(filters)]);

  const setParam = (patch: Record<string, string | null | undefined>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (resetPage) next.delete('page');
    setParams(next);
  };

  const statusMap = useMemo(() => new Map((statuses.data?.statuses ?? []).map((s) => [s.id, s])), [statuses.data]);
  const currentStatus = statusId ? statusMap.get(statusId) : null;
  const title = view === 'bin' ? t('Bin') : view === 'archive' ? t('Archive') : currentStatus ? currentStatus.name : t('All orders');

  const rows = orders.data?.rows ?? [];
  const allChecked = rows.length > 0 && rows.every((r) => selected.includes(r.id));

  const bulk = async (action: string, extra: Record<string, any> = {}, msg?: string) => {
    if (!selected.length) {
      toast(t('Select orders first'), 'error');
      return;
    }
    const r = await run(() => api.post('/orders/bulk', { ids: selected, action, params: extra }));
    if (r) {
      if (r.errors?.length) toast(`${t('Done: {n}', { n: r.ok })}. ${t('Errors')}: ${r.errors.map((e: any) => `${e.id} — ${e.error}`).join('; ')}`, 'error');
      else if (msg) toast(msg, 'success');
      if (action === 'merge' && r.id) nav(`/orders/${r.id}`);
      setSelected([]);
      invalidate();
    }
  };

  const filterChips = Object.entries(filters);

  return (
    <div className="orders-layout">
      <StatusColumn
        current={statusId}
        view={view}
        onPick={({ status, view: v }) => {
          const next = new URLSearchParams();
          for (const k of FILTER_KEYS) if (params.get(k)) next.set(k, params.get(k)!);
          if (status) next.set('status', String(status));
          if (v && v !== 'active') next.set('view', v);
          setParams(next);
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div className="page-head">
          <h1 className="page-title">{title}</h1>
          <div className="spacer" />
          <button className="btn btn-outline-blue" onClick={() => setShowSearch(true)}>
            <Search size={18} /> {t('Advanced search')}
          </button>
        </div>

        <OrdersToolbar
          selected={selected}
          rows={rows}
          allChecked={allChecked}
          view={view}
          onSelectAll={() => setSelected(allChecked ? [] : rows.map((r) => r.id))}
          onSelectMatching={async () => {
            const r = await run(() => api.get<{ total: number; rows: any[] }>('/orders', { ...query, page: 1, per_page: 1000 }));
            if (r) setSelected(r.rows.map((x) => x.id));
          }}
          onClear={() => setSelected([])}
          bulk={bulk}
          onShip={() => (selected.length ? setShipFor(selected) : toast(t('Select orders first'), 'error'))}
          sort={sort}
          dir={dir}
          onSort={(s, d) => setParam({ sort: s, dir: d })}
          exportQuery={{ ...filters, view, status_id: statusId ?? undefined, sort, dir }}
          pager={<Pager page={page} perPage={perPage} total={orders.data?.total ?? 0} onPage={(p) => setParam({ page: String(p) }, false)} />}
          confirm={confirm}
        />

        {filterChips.length > 0 && (
          <div className="row wrap mb" style={{ gap: 8, marginTop: -2 }}>
            {filterChips.map(([k, v]) => (
              <span key={k} className="chip">
                {t(FILTER_LABELS[k] ?? k)}: {v}
                <button onClick={() => setParam({ [k]: null })} aria-label={t('Remove filter')}>
                  <X size={14} />
                </button>
              </span>
            ))}
            <button className="btn-link" onClick={() => setParam(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])))}>
              {t('Clear filters')}
            </button>
          </div>
        )}

        <div className="table-wrap">
          {orders.isLoading ? (
            <Loading />
          ) : !rows.length ? (
            <Empty>{t('No orders')}</Empty>
          ) : (
            <table className="tbl orders-tbl">
              <thead>
                <tr>
                  <th className="check" />
                  <th>
                    {t('Number')}
                    <span className="sub">({t('in shop')})</span>
                  </th>
                  <th>
                    {t('Name surname')}
                    <span className="sub">({t('order source')})</span>
                  </th>
                  <th>{t('Items')}</th>
                  <th>{t('Information')}</th>
                  <th className="num">{t('Price')}</th>
                  <th>
                    {t('Additional information')}
                    <span className="sub">({t('shipping method')})</span>
                  </th>
                  <th className="num">
                    {t('Order date')}
                    <span className="sub">({t('in status')})</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const st = statusMap.get(o.status_id);
                  const paidFull = o.paid_amount > 0 && o.paid_amount >= o.total - 0.001;
                  const checked = selected.includes(o.id);
                  return (
                    <tr key={o.id} className={checked ? 'selected' : ''}>
                      <td className="check">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setSelected((s) => (checked ? s.filter((x) => x !== o.id) : [...s, o.id]))}
                          aria-label={`${t('Select')} ${o.id}`}
                        />
                        <StarToggle order={o} onDone={invalidate} />
                      </td>
                      <td>
                        <Link to={`/orders/${o.id}`} className="order-no">
                          {o.id}
                        </Link>
                        {o.external_id && (
                          <div className="text-muted text-small" title={o.external_id} style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {o.external_id}
                          </div>
                        )}
                      </td>
                      <td style={{ minWidth: 130 }}>
                        <div style={{ color: '#4a5057' }}>
                          {o.delivery_country_code && o.delivery_country_code !== 'PL' && <span title={o.delivery_country_code}>{flag(o.delivery_country_code)} </span>}
                          {o.delivery_fullname || o.user_login || o.email || '—'}
                        </div>
                        <div className="source">
                          <SourceIcon source={o.source} />
                          {o.integration_name ?? (o.source === 'manual' ? t('Other') : o.source)}
                        </div>
                      </td>
                      <td className="items-cell" style={{ minWidth: 200 }}>
                        {o.items.slice(0, 4).map((i: any, idx: number) => (
                          <div key={idx} className="item-line">
                            {i.image ? <img src={i.image} alt="" className="mini-thumb" loading="lazy" /> : <span className="mini-thumb empty" />}
                            <span>
                              <i>{i.quantity}x</i> {i.name}
                              {i.attributes ? <span className="text-muted"> ({i.attributes})</span> : null}
                            </span>
                          </div>
                        ))}
                        {o.items.length > 4 && <div className="text-muted">+ {o.items.length - 4} …</div>}
                      </td>
                      <td style={{ maxWidth: 170, fontSize: 13.5 }}>
                        {o.payment_method && <div>{o.payment_method}</div>}
                        {o.buyer_comment && (
                          <div className="text-muted" title={o.buyer_comment} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            💬 {o.buyer_comment}
                          </div>
                        )}
                        {o.extra_field_1 && <div className="text-muted">{o.extra_field_1}</div>}
                      </td>
                      <td className="num">
                        <span className="price">{money(o.total, o.currency)}</span>
                      </td>
                      <td style={{ minWidth: 150 }}>
                        <div>
                          {st && (
                            <Dropdown
                              trigger={(_o, toggle) => (
                                <button className="badge-btn" onClick={toggle} title={t('Change status')}>
                                  <StatusBadge name={st.short_name || st.name} color={st.color} />
                                </button>
                              )}
                            >
                              {(close) => (
                                <>
                                  <div className="dd-head">{t('Move to status')}</div>
                                  {statuses.data?.statuses.map((x) => (
                                    <DdItem
                                      key={x.id}
                                      icon={<span className="color-dot" style={{ background: x.color }} />}
                                      onClick={() => {
                                        close();
                                        if (x.id !== o.status_id) run(() => api.post(`/orders/${o.id}/status`, { status_id: x.id }), t('Status changed')).then(invalidate);
                                      }}
                                    >
                                      {x.name}
                                    </DdItem>
                                  ))}
                                </>
                              )}
                            </Dropdown>
                          )}
                          {o.delivery_method && <div className="date-sub">{o.delivery_method}</div>}
                        <span className="ico-row" style={{ marginTop: 4 }}>
                          <span className={`ico ${paidFull ? 'green' : o.payment_cod ? 'orange' : ''}`} title={paidFull ? t('Paid') : o.payment_cod ? t('Cash on delivery') : t('Not paid')}>
                            {paidFull ? 'P' : o.payment_cod ? 'C' : 'N'}
                          </span>
                          <span className={`ico ${o.paid_amount > 0 ? 'green' : ''}`} title={`${t('Paid')}: ${money(o.paid_amount, o.currency)}`}>
                            $
                          </span>
                          <span className={`ico ${o.shipment_count ? (o.label_printed ? 'orange' : 'blue') : 'outline'}`} title={o.shipment_count ? t('Shipment created') : t('No shipment')}>
                            <Truck />
                          </span>
                          {!!(o.invoice_count > 0 || o.receipt_count > 0 || o.invoice_wanted) && (
                            <span
                              className={`ico ${o.invoice_count || o.receipt_count ? 'blue' : 'outline blue'}`}
                              title={o.invoice_count ? t('Invoice issued') : o.receipt_count ? t('Receipt issued') : t('The customer requests an invoice')}
                            >
                              <FileText />
                            </span>
                          )}
                        </span>
                        </div>
                      </td>
                      <td className="num nowrap" style={{ fontSize: 13.5 }}>
                        <div style={{ color: '#4a5057' }}>{fmtDateTime(o.date_add)}</div>
                        <div className="date-sub">{fmtDateTime(o.status_changed_at)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {(orders.data?.total ?? 0) > perPage && (
          <div className="row mt">
            <Pager page={page} perPage={perPage} total={orders.data?.total ?? 0} onPage={(p) => setParam({ page: String(p) }, false)} />
          </div>
        )}
      </div>

      {showSearch && (
        <AdvancedSearch
          initial={filters}
          onClose={() => setShowSearch(false)}
          onApply={(f) => {
            setParam(Object.fromEntries(FILTER_KEYS.map((k) => [k, f[k] ?? null])));
            setShowSearch(false);
          }}
        />
      )}
      {shipFor && <ShipmentModal orderIds={shipFor} onClose={() => setShipFor(null)} onDone={() => (invalidate(), setSelected([]))} />}
    </div>
  );
}

const FILTER_LABELS: Record<string, string> = {
  search: 'Search',
  buyer: 'Buyer',
  product: 'Product',
  comment: 'Comment',
  sources: 'Order source',
  integration_ids: 'Account',
  payment: 'Payment',
  cod: 'Cash on delivery',
  delivery_method: 'Shipping method',
  payment_method: 'Payment method',
  country: 'Country',
  date_from: 'Date from',
  date_to: 'Date to',
  price_min: 'Price from',
  price_max: 'Price to',
  invoice: 'Invoice',
  shipment: 'Shipment',
  star: 'Starred',
  status_date_from: 'Status changed from',
  status_date_to: 'Status changed to',
  paid_from: 'Paid from',
  paid_to: 'Paid to',
  status_days: 'Days in status',
  label: 'Label',
  shipment_status: 'Shipment status',
  warehouse_id: 'Warehouse',
  currency: 'Currency',
  has_return: 'Return',
  locked: 'Locked',
  unlinked: 'Not linked products',
  receipt: 'Receipt',
  items_min: 'Products at least',
};

function StarToggle({ order, onDone }: { order: any; onDone: () => void }) {
  const t = useT();
  return (
    <button
      className={`star-btn ${order.star ? 'on' : ''}`}
      title={t('Star')}
      onClick={() => api.put(`/orders/${order.id}`, { star: order.star ? 0 : 1 }).then(onDone)}
    >
      <Star fill={order.star ? '#f2b01e' : 'none'} />
    </button>
  );
}

function OrdersToolbar({
  selected,
  rows,
  allChecked,
  view,
  onSelectAll,
  onSelectMatching,
  onClear,
  bulk,
  onShip,
  sort,
  dir,
  onSort,
  pager,
  confirm,
  exportQuery,
}: {
  selected: number[];
  rows: any[];
  allChecked: boolean;
  view: string;
  onSelectAll: () => void;
  onSelectMatching: () => void;
  onClear: () => void;
  bulk: (action: string, extra?: Record<string, any>, msg?: string) => Promise<void>;
  onShip: () => void;
  sort: string;
  dir: string;
  onSort: (s: string, d: string) => void;
  pager: React.ReactNode;
  confirm: ReturnType<typeof useConfirm>;
  exportQuery: Record<string, any>;
}) {
  const t = useT();
  const statuses = useStatuses();
  const templates = useEmailTemplates();
  const series = useInvoiceSeries();
  const integrations = useIntegrations();
  const rules = useRules();
  const invalidate = useInvalidateOrders();
  const run = useAction();
  const toast = useToast();
  const n = selected.length;
  const needSel = () => {
    if (!n) toast(t('Select orders first'), 'error');
    return n > 0;
  };
  return (
    <div className="toolbar">
      <div className="btn-group">
        <Dropdown
          trigger={(_o, toggle) => (
            <button className="btn" onClick={toggle} title={t('Select')}>
              <CheckSquare /> {n > 0 && <b>{n}</b>} <ChevronDown size={15} />
            </button>
          )}
        >
          {(close) => (
            <>
              <DdItem icon={<Check />} onClick={() => (onSelectAll(), close())}>
                {allChecked ? t('Unselect page') : t('Select all on page ({n})', { n: rows.length })}
              </DdItem>
              <DdItem onClick={() => (onSelectMatching(), close())}>{t('Select all matching (max 1000)')}</DdItem>
              <DdItem onClick={() => (onClear(), close())}>{t('Clear selection')}</DdItem>
            </>
          )}
        </Dropdown>
        <Dropdown
          trigger={(_o, toggle) => (
            <button className="btn" onClick={() => needSel() && toggle()} title={t('Star')}>
              <Star />
            </button>
          )}
        >
          {(close) => (
            <>
              <DdItem icon={<Star fill="#f2b01e" color="#f2b01e" />} onClick={() => (bulk('star'), close())}>
                {t('Add star')}
              </DdItem>
              <DdItem icon={<Star />} onClick={() => (bulk('unstar'), close())}>
                {t('Remove star')}
              </DdItem>
            </>
          )}
        </Dropdown>
      </div>

      <div className="btn-group">
        <Dropdown
          trigger={(_o, toggle) => (
            <button className="btn" onClick={() => needSel() && toggle()} title={t('Move to status')}>
              <Flag />
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="dd-head">{t('Move {n} orders to status', { n })}</div>
              {statuses.data?.statuses.map((s) => (
                <DdItem key={s.id} icon={<span className="color-dot" style={{ background: s.color }} />} onClick={() => (bulk('set_status', { status_id: s.id }, t('Status changed')), close())}>
                  {s.name}
                </DdItem>
              ))}
            </>
          )}
        </Dropdown>
        <Dropdown
          trigger={(_o, toggle) => (
            <button className="btn" onClick={() => needSel() && toggle()} title={t('Send e-mail')}>
              <Mail />
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="dd-head">{t('Send e-mail from template')}</div>
              {templates.data?.map((tp) => (
                <DdItem key={tp.id} onClick={() => (bulk('email', { template_id: tp.id }, t('E-mails sent')), close())}>
                  {tp.name}
                </DdItem>
              ))}
              {!templates.data?.length && <div className="text-muted" style={{ padding: '6px 16px' }}>{t('No templates')}</div>}
            </>
          )}
        </Dropdown>
        <Dropdown
          trigger={(_o, toggle) => (
            <button className="btn" onClick={() => needSel() && toggle()} title={t('Sales documents')}>
              <FileText />
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="dd-head">{t('Issue invoices')}</div>
              {series.data
                ?.filter((s) => s.type === 'invoice')
                .map((s) => (
                  <DdItem key={s.id} onClick={() => (bulk('invoice', { series_id: s.id }, t('Invoices issued')), close())}>
                    {s.name}
                  </DdItem>
                ))}
              <div className="dd-head">{t('Issue receipts')}</div>
              {series.data
                ?.filter((s) => s.type === 'receipt')
                .map((s) => (
                  <DdItem key={s.id} onClick={() => (bulk('receipt', { series_id: s.id }, t('Receipts issued')), close())}>
                    {s.name}
                  </DdItem>
                ))}
            </>
          )}
        </Dropdown>
        <Dropdown
          trigger={(_o, toggle) => (
            <button className="btn" onClick={toggle} title={t('Printouts and exports')}>
              <Printer />
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="dd-head">{t('Printouts')}</div>
              <DdItem icon={<Printer />} onClick={() => (needSel() && run(() => api.openPdf('/orders/print', { ids: selected, kind: 'order_card' })), close())}>
                {t('Order cards')}
              </DdItem>
              <DdItem icon={<Printer />} onClick={() => (needSel() && run(() => api.openPdf('/orders/print', { ids: selected, kind: 'packing_list' })), close())}>
                {t('Packing lists')}
              </DdItem>
              <DdItem icon={<Printer />} onClick={() => (needSel() && run(() => api.openPdf('/orders/print', { ids: selected, kind: 'pick_list' })), close())}>
                {t('Pick list (products to collect)')}
              </DdItem>
              <div className="dd-head">{t('Export')}</div>
              <DdItem
                icon={<Download />}
                onClick={() => {
                  close();
                  const q = selected.length ? { ids: selected, view } : exportQuery;
                  run(() => api.download('/orders/export.csv', 'orders.csv', q));
                }}
              >
                {selected.length ? t('Export selected to CSV') : t('Export list to CSV')}
              </DdItem>
            </>
          )}
        </Dropdown>
      </div>

      <button className="btn btn-primary" onClick={onShip} title={t('Create shipments')} style={{ minWidth: 62 }}>
        <Truck />
      </button>

      <Dropdown
        trigger={(_o, toggle) => (
          <button className="btn" onClick={toggle} title={t('Download orders from marketplaces')}>
            <Warehouse /> <ChevronDown size={15} />
          </button>
        )}
      >
        {(close) => (
          <>
            <div className="dd-head">{t('Download new orders now')}</div>
            {integrations.data?.map((i) => (
              <DdItem
                key={i.id}
                icon={<RefreshCw />}
                onClick={async () => {
                  close();
                  const r = await run(() => api.post(`/integrations/${i.id}/sync-orders`));
                  if (r) {
                    toast(t('{name}: {n} new orders', { name: i.name, n: r.imported ?? 0 }), 'success');
                    invalidate();
                  }
                }}
              >
                {i.name}
              </DdItem>
            ))}
            {!integrations.data?.length && (
              <Link className="dd-item" to="/integrations/add">
                {t('Add integration')}
              </Link>
            )}
          </>
        )}
      </Dropdown>

      <Dropdown
        trigger={(_o, toggle) => (
          <button className="btn" onClick={toggle} title={t('More actions')}>
            <Menu /> <ChevronDown size={15} />
          </button>
        )}
      >
        {(close) => (
          <>
            <DdItem icon={<Banknote />} onClick={() => (needSel() && bulk('set_paid', {}, t('Marked as paid')), close())}>
              {t('Mark as paid')}
            </DdItem>
            <DdItem
              onClick={async () => {
                close();
                if (!needSel()) return;
                if (n < 2) return toast(t('Select at least two orders'), 'error');
                if (await confirm(t('Merge {n} orders into one? Products will be moved to the oldest order, the others go to the bin.', { n }))) bulk('merge');
              }}
            >
              {t('Merge orders')}
            </DdItem>
            {view === 'active' ? (
              <DdItem onClick={() => (needSel() && bulk('archive', {}, t('Moved to archive')), close())}>{t('Move to archive')}</DdItem>
            ) : (
              <DdItem onClick={() => (needSel() && bulk(view === 'bin' ? 'restore' : 'unarchive', {}, t('Restored')), close())}>{t('Restore')}</DdItem>
            )}
            {!!rules.data?.length && <div className="dd-head">{t('Run automatic action')}</div>}
            {rules.data
              ?.filter((r) => r.event === 'manual')
              .map((r) => (
                <DdItem key={r.id} onClick={() => (needSel() && bulk('run_rule', { rule_id: r.id }, t('Done')), close())}>
                  {r.name}
                </DdItem>
              ))}
            <div className="dd-sep" />
            <DdItem
              danger
              onClick={async () => {
                close();
                if (!needSel()) return;
                const msg = view === 'bin' ? t('Permanently delete {n} orders? This cannot be undone.', { n }) : t('Move {n} orders to the bin?', { n });
                if (await confirm(msg, { danger: true, okText: t('Delete') })) bulk('delete', {}, t('Deleted'));
              }}
            >
              {view === 'bin' ? t('Delete permanently') : t('Delete')}
            </DdItem>
          </>
        )}
      </Dropdown>

      <Dropdown
        trigger={(_o, toggle) => (
          <button className="btn" onClick={toggle} title={t('Sort')}>
            <ArrowDownWideNarrow />
          </button>
        )}
      >
        {(close) =>
          (
            [
              ['id', 'desc', t('Newest first')],
              ['id', 'asc', t('Oldest first')],
              ['status_changed_at', 'desc', t('Recently changed status')],
              ['total', 'desc', t('Price: highest first')],
              ['total', 'asc', t('Price: lowest first')],
              ['buyer', 'asc', t('Buyer A–Z')],
            ] as const
          ).map(([s, d, label]) => (
            <DdItem key={s + d} icon={sort === s && dir === d ? <Check /> : <span style={{ width: 17 }} />} onClick={() => (onSort(s, d), close())}>
              {label}
            </DdItem>
          ))
        }
      </Dropdown>

      {pager}
    </div>
  );
}

function AdvancedSearch({ initial, onClose, onApply }: { initial: Record<string, string>; onClose: () => void; onApply: (f: Record<string, string>) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const run = useAction();
  const integrations = useIntegrations();
  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: () => api.get<any[]>('/warehouses'), staleTime: 60_000 });
  const saved = useQuery({ queryKey: ['order-saved-filters'], queryFn: () => api.get<{ name: string; query: Record<string, string> }[]>('/orders/saved-filters') });
  const [f, setF] = useState<Record<string, string>>(initial);
  const [saveName, setSaveName] = useState('');
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const clean = () => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''));
  const inp = (k: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input className="input" value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} {...props} />
  );
  const sel = (k: string, options: [string, string][]) => (
    <select className="select" value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)}>
      <option value="">{t('Any')}</option>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
  const yesNo: [string, string][] = [
    ['1', t('Yes')],
    ['0', t('No')],
  ];
  const storeSaved = async (list: { name: string; query: Record<string, string> }[]) => {
    const r = await run(() => api.put('/orders/saved-filters', list), t('Saved'));
    if (r) qc.invalidateQueries({ queryKey: ['order-saved-filters'] });
  };
  return (
    <Modal
      title={t('Advanced search')}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => setF({})}>
            {t('Clear')}
          </button>
          <button className="btn btn-primary" onClick={() => onApply(clean())}>
            <Search size={17} /> {t('Search')}
          </button>
        </>
      }
    >
      {!!saved.data?.length && (
        <div className="row wrap mb" style={{ gap: 6 }}>
          <span className="text-muted text-small">{t('Saved searches')}:</span>
          {saved.data.map((x, i) => (
            <span key={i} className="rule-chip" style={{ cursor: 'pointer' }}>
              <span onClick={() => onApply(x.query)}>{x.name}</span>{' '}
              <span title={t('Delete')} onClick={() => storeSaved(saved.data!.filter((_, j) => j !== i))}>
                ×
              </span>
            </span>
          ))}
        </div>
      )}
      <div className="filter-section">{t('Order and buyer')}</div>
      <div className="form-grid">
        <Field label={t('Order number / text')} help={t('Number, marketplace number, buyer, product, tracking or invoice number')}>
          {inp('search', { autoFocus: true })}
        </Field>
        <Field label={t('Buyer (name, e-mail, login, phone)')}>{inp('buyer')}</Field>
        <Field label={t('Product (name, SKU, EAN)')}>{inp('product')}</Field>
        <Field label={t('Comment')}>{inp('comment')}</Field>
        <Field label={t('Order source')}>
          {sel('sources', [
            ['manual', t('Manual / other')],
            ['allegro', 'Allegro'],
            ['empik', 'Empik'],
            ['kaufland', 'Kaufland'],
          ])}
        </Field>
        <Field label={t('Marketplace account')}>{sel('integration_ids', (integrations.data ?? []).map((i) => [String(i.id), i.name]))}</Field>
        <Field label={t('Delivery country (code)')}>{inp('country', { maxLength: 2, placeholder: 'PL' })}</Field>
        <Field label={t('Currency')}>{inp('currency', { maxLength: 3, placeholder: 'PLN' })}</Field>
        <Field label={t('Warehouse')}>{sel('warehouse_id', (warehouses.data ?? []).map((w) => [String(w.id), w.name]))}</Field>
        <Field label={t('Starred')}>{sel('star', yesNo)}</Field>
      </div>
      <div className="filter-section">{t('Dates')}</div>
      <div className="form-grid">
        <Field label={t('Order date from')}>{inp('date_from', { type: 'date' })}</Field>
        <Field label={t('Order date to')}>{inp('date_to', { type: 'date' })}</Field>
        <Field label={t('Status changed from')}>{inp('status_date_from', { type: 'date' })}</Field>
        <Field label={t('Status changed to')}>{inp('status_date_to', { type: 'date' })}</Field>
        <Field label={t('Paid from')}>{inp('paid_from', { type: 'date' })}</Field>
        <Field label={t('Paid to')}>{inp('paid_to', { type: 'date' })}</Field>
        <Field label={t('In the current status for at least (days)')}>{inp('status_days', { inputMode: 'numeric' })}</Field>
      </div>
      <div className="filter-section">{t('Payment and value')}</div>
      <div className="form-grid">
        <Field label={t('Payment status')}>
          {sel('payment', [
            ['paid', t('Paid')],
            ['partial', t('Partially paid')],
            ['unpaid', t('Not paid')],
            ['overpaid', t('Overpaid')],
          ])}
        </Field>
        <Field label={t('Cash on delivery')}>{sel('cod', yesNo)}</Field>
        <Field label={t('Payment method')}>{inp('payment_method')}</Field>
        <Field label={t('Price from')}>{inp('price_min', { inputMode: 'decimal' })}</Field>
        <Field label={t('Price to')}>{inp('price_max', { inputMode: 'decimal' })}</Field>
        <Field label={t('Number of products at least')}>{inp('items_min', { inputMode: 'numeric' })}</Field>
      </div>
      <div className="filter-section">{t('Shipping')}</div>
      <div className="form-grid">
        <Field label={t('Shipping method')}>{inp('delivery_method')}</Field>
        <Field label={t('Shipment')}>
          {sel('shipment', [
            ['yes', t('Created')],
            ['no', t('Not created')],
          ])}
        </Field>
        <Field label={t('Label')}>
          {sel('label', [
            ['printed', t('Printed')],
            ['not_printed', t('Not printed')],
          ])}
        </Field>
        <Field label={t('Shipment status')}>{sel('shipment_status', Object.entries(SHIP_STATUS_LABEL).map(([k, v]) => [k, t(v)]))}</Field>
      </div>
      <div className="filter-section">{t('Documents and other')}</div>
      <div className="form-grid">
        <Field label={t('Invoice')}>
          {sel('invoice', [
            ['wanted', t('Customer requests an invoice')],
            ['issued', t('Invoice issued')],
            ['not_issued', t('Invoice not issued')],
          ])}
        </Field>
        <Field label={t('Receipt')}>
          {sel('receipt', [
            ['issued', t('Receipt issued')],
            ['not_issued', t('Receipt not issued')],
          ])}
        </Field>
        <Field label={t('Return')}>{sel('has_return', yesNo)}</Field>
        <Field label={t('Locked (document issued or locked manually)')}>{sel('locked', yesNo)}</Field>
        <Field label=" ">
          <label className="check-label" style={{ height: 40 }}>
            <input type="checkbox" checked={f.unlinked === '1'} onChange={(e) => set('unlinked', e.target.checked ? '1' : '')} />
            {t('Products not linked with the inventory')}
          </label>
        </Field>
      </div>
      <div className="row mt" style={{ borderTop: '1px solid var(--border-light)', paddingTop: 12 }}>
        <input className="input" style={{ maxWidth: 260 }} placeholder={t('Name of the search')} value={saveName} onChange={(e) => setSaveName(e.target.value)} maxLength={60} />
        <button
          className="btn"
          disabled={!saveName.trim() || !Object.keys(clean()).length}
          onClick={() => storeSaved([...(saved.data ?? []).filter((x) => x.name !== saveName.trim()), { name: saveName.trim(), query: clean() }]).then(() => setSaveName(''))}
        >
          {t('Save search')}
        </button>
      </div>
    </Modal>
  );
}
