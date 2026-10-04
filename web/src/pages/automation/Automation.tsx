import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Trash2, Undo2, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { Empty, Field, Loading, Switch, useAction, useConfirm } from '../../components/ui';
import { COURIER_NAMES, COURIERS, useEmailTemplates, useIntegrations, useInvoiceSeries, useRules, useStatuses } from '../../data';
import { fmtDateTime } from '../../format';
import { useT, type TFn } from '../../i18n';

export const EVENT_LABELS: Record<string, string> = {
  order_created: 'New order',
  status_changed: 'Order status changed',
  order_paid: 'Order paid',
  invoice_created: 'Invoice issued',
  receipt_created: 'Receipt issued',
  shipment_created: 'Shipment created',
  return_created: 'Return created',
  manual: 'Run manually (from the order list)',
};

const FIELD_LABELS: Record<string, string> = {
  source: 'Order source',
  integration_id: 'Marketplace account',
  status_id: 'Order status',
  from_status_id: 'Previous status',
  payment_status: 'Payment status',
  payment_cod: 'Cash on delivery',
  payment_method: 'Payment method',
  delivery_method: 'Shipping method',
  delivery_country_code: 'Delivery country (code)',
  total: 'Order value',
  currency: 'Currency',
  invoice_wanted: 'Customer requests an invoice',
  has_invoice: 'Invoice issued',
  has_shipment: 'Shipment created',
  has_pickup_point: 'Delivery to a pickup point',
  buyer_comment: 'Buyer comment',
  item_count: 'Number of products',
  product_sku: 'Product SKU',
  product_name: 'Product name',
  email: 'Buyer e-mail',
  extra_field_1: 'Additional field 1',
  extra_field_2: 'Additional field 2',
};

const ACTION_LABELS: Record<string, string> = {
  set_status: 'Change order status',
  send_email: 'Send e-mail to the buyer',
  issue_invoice: 'Issue invoice',
  issue_receipt: 'Issue receipt',
  create_shipment: 'Create shipment',
  add_note: 'Add seller note',
  set_extra_field: 'Set additional field',
  set_star: 'Add star',
  archive: 'Move to archive',
  webhook: 'Call webhook (HTTPS POST)',
};

type FieldKind = 'bool' | 'number' | 'text' | 'status' | 'source' | 'integration' | 'payment';
const FIELD_KIND: Record<string, FieldKind> = {
  source: 'source',
  integration_id: 'integration',
  status_id: 'status',
  from_status_id: 'status',
  payment_status: 'payment',
  payment_cod: 'bool',
  invoice_wanted: 'bool',
  has_invoice: 'bool',
  has_shipment: 'bool',
  has_pickup_point: 'bool',
  total: 'number',
  item_count: 'number',
};

const OPS: Record<FieldKind, string[]> = {
  bool: ['true', 'false'],
  number: ['gt', 'gte', 'lt', 'lte', 'eq'],
  text: ['contains', 'not_contains', 'eq', 'neq', 'empty', 'not_empty'],
  status: ['in', 'not_in'],
  source: ['in', 'not_in'],
  integration: ['in', 'not_in'],
  payment: ['in', 'not_in'],
};

const OP_LABELS: Record<string, string> = {
  true: 'is yes',
  false: 'is no',
  gt: 'greater than',
  gte: 'at least',
  lt: 'less than',
  lte: 'at most',
  eq: 'equals',
  neq: 'is not',
  contains: 'contains',
  not_contains: 'does not contain',
  empty: 'is empty',
  not_empty: 'is not empty',
  in: 'is one of',
  not_in: 'is none of',
};

export function describeRule(rule: any, t: TFn, statusName: (id: number) => string) {
  const conds = rule.conditions.map((c: any) => {
    const kind = FIELD_KIND[c.field] ?? 'text';
    let v = Array.isArray(c.value) ? c.value : c.value;
    if (kind === 'status') v = (Array.isArray(v) ? v : [v]).map((x: any) => statusName(Number(x))).join(', ');
    else if (Array.isArray(v)) v = v.join(', ');
    return `${t(FIELD_LABELS[c.field] ?? c.field)} ${t(OP_LABELS[c.op] ?? c.op)}${kind === 'bool' || ['empty', 'not_empty'].includes(c.op) ? '' : ` ${v}`}`;
  });
  const acts = rule.actions.map((a: any) => {
    let s = t(ACTION_LABELS[a.type] ?? a.type);
    if (a.type === 'set_status') s += ` → ${statusName(Number(a.params.status_id))}`;
    if (a.type === 'create_shipment') s += ` (${COURIER_NAMES[a.params.courier] ?? a.params.courier})`;
    return s;
  });
  return { conds, acts };
}

export default function AutomationPage() {
  const t = useT();
  const rules = useRules();
  const statuses = useStatuses();
  const qc = useQueryClient();
  const run = useAction();
  const statusName = (id: number) => statuses.data?.statuses.find((s) => s.id === id)?.name ?? `#${id}`;
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          {t('Automatic actions')}
          <small>{t('Automate order processing: when an event happens and conditions are met, actions run by themselves.')}</small>
        </h1>
        <div className="spacer" />
        <Link to="/automation/new" className="btn btn-primary btn-pill" style={{ height: 44, padding: '0 22px' }}>
          <Plus /> {t('Add automatic action')}
        </Link>
      </div>
      <div className="table-wrap">
        {rules.isLoading ? (
          <Loading />
        ) : !rules.data?.length ? (
          <Empty icon={<Zap />}>{t('No automatic actions yet.')}</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 70 }}>{t('Active')}</th>
                <th>{t('Name')}</th>
                <th>{t('Event')}</th>
                <th>{t('Conditions')}</th>
                <th>{t('Actions')}</th>
                <th className="num">{t('Runs')}</th>
              </tr>
            </thead>
            <tbody>
              {rules.data.map((r) => {
                const d = describeRule(r, t, statusName);
                return (
                  <tr key={r.id}>
                    <td>
                      <Switch checked={r.enabled} onChange={(v) => run(() => api.patch(`/rules/${r.id}`, { enabled: v })).then(() => qc.invalidateQueries({ queryKey: ['rules'] }))} />
                    </td>
                    <td>
                      <Link to={`/automation/${r.id}`} style={{ fontWeight: 600 }}>
                        {r.name}
                      </Link>
                    </td>
                    <td>{t(EVENT_LABELS[r.event] ?? r.event)}</td>
                    <td>{d.conds.length ? d.conds.map((c: string, i: number) => <span key={i} className="rule-chip">{c}</span>) : <span className="text-muted">{t('always')}</span>}</td>
                    <td>
                      {d.acts.map((a: string, i: number) => (
                        <span key={i} className="rule-chip" style={{ background: 'var(--blue-light)', color: 'var(--blue-dark)' }}>
                          {a}
                        </span>
                      ))}
                    </td>
                    <td className="num">{r.run_count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

export function RuleEditor() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const run = useAction();
  const confirm = useConfirm();
  const rules = useRules();
  const statuses = useStatuses();
  const integrations = useIntegrations();
  const templates = useEmailTemplates();
  const series = useInvoiceSeries();
  const log = useQuery({ queryKey: ['rule-log', id], queryFn: () => api.get<any[]>(`/rules/${id}/log`), enabled: !isNew });
  const [r, setR] = useState<any>({ name: '', event: 'order_created', enabled: true, conditions: [], actions: [{ type: 'set_status', params: {} }] });
  useEffect(() => {
    const found = rules.data?.find((x) => String(x.id) === id);
    if (found) setR(JSON.parse(JSON.stringify(found)));
  }, [rules.data, id]);
  if (!isNew && rules.isLoading) return <Loading />;

  const setCond = (i: number, patch: any) => setR({ ...r, conditions: r.conditions.map((c: any, j: number) => (j === i ? { ...c, ...patch } : c)) });
  const setAct = (i: number, patch: any) => setR({ ...r, actions: r.actions.map((a: any, j: number) => (j === i ? { ...a, ...patch } : a)) });

  const valueInput = (c: any, i: number) => {
    const kind = FIELD_KIND[c.field] ?? 'text';
    if (kind === 'bool' || ['empty', 'not_empty'].includes(c.op)) return null;
    const multi = (options: [string, string][]) => {
      const vals: string[] = (Array.isArray(c.value) ? c.value : c.value ? [c.value] : []).map(String);
      return (
        <div className="row wrap" style={{ gap: 6 }}>
          {options.map(([v, l]) => (
            <label key={v} className="check-label" style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                checked={vals.includes(v)}
                onChange={(e) => setCond(i, { value: e.target.checked ? [...vals, v] : vals.filter((x) => x !== v) })}
              />
              {l}
            </label>
          ))}
        </div>
      );
    };
    if (kind === 'status') return multi((statuses.data?.statuses ?? []).map((s) => [String(s.id), s.name]));
    if (kind === 'source')
      return multi([
        ['manual', t('Manual / other')],
        ['allegro', 'Allegro'],
        ['empik', 'Empik'],
        ['kaufland', 'Kaufland'],
      ]);
    if (kind === 'integration') return multi((integrations.data ?? []).map((x) => [String(x.id), x.name]));
    if (kind === 'payment')
      return multi([
        ['paid', t('Paid')],
        ['partial', t('Partially paid')],
        ['unpaid', t('Not paid')],
      ]);
    return <input className="input input-sm" style={{ width: 200 }} value={c.value ?? ''} onChange={(e) => setCond(i, { value: e.target.value })} inputMode={kind === 'number' ? 'decimal' : undefined} />;
  };

  const actionParams = (a: any, i: number) => {
    const p = a.params ?? {};
    const setP = (k: string, v: any) => setAct(i, { params: { ...p, [k]: v } });
    switch (a.type) {
      case 'set_status':
        return (
          <select className="select input-sm" style={{ width: 220 }} value={p.status_id ?? ''} onChange={(e) => setP('status_id', Number(e.target.value))}>
            <option value="">{t('— choose status —')}</option>
            {statuses.data?.statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        );
      case 'send_email':
        return (
          <select className="select input-sm" style={{ width: 240 }} value={p.template_id ?? ''} onChange={(e) => setP('template_id', Number(e.target.value))}>
            <option value="">{t('— choose template —')}</option>
            {templates.data?.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        );
      case 'issue_invoice':
      case 'issue_receipt':
        return (
          <select className="select input-sm" style={{ width: 220 }} value={p.series_id ?? ''} onChange={(e) => setP('series_id', e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">{t('Default series')}</option>
            {series.data
              ?.filter((s) => s.type === (a.type === 'issue_invoice' ? 'invoice' : 'receipt'))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        );
      case 'create_shipment':
        return (
          <select className="select input-sm" style={{ width: 220 }} value={p.courier ?? ''} onChange={(e) => setP('courier', e.target.value)}>
            <option value="">{t('— choose courier —')}</option>
            {COURIERS.map((c) => (
              <option key={c} value={c}>
                {COURIER_NAMES[c]}
              </option>
            ))}
          </select>
        );
      case 'add_note':
        return <input className="input input-sm" style={{ width: 300 }} value={p.text ?? ''} onChange={(e) => setP('text', e.target.value)} placeholder={t('Note text')} />;
      case 'set_extra_field':
        return (
          <span className="row" style={{ gap: 6 }}>
            <select className="select input-sm" style={{ width: 90 }} value={p.field ?? 1} onChange={(e) => setP('field', Number(e.target.value))}>
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
            <input className="input input-sm" style={{ width: 220 }} value={p.value ?? ''} onChange={(e) => setP('value', e.target.value)} />
          </span>
        );
      case 'webhook':
        return <input className="input input-sm" style={{ width: 340 }} value={p.url ?? ''} onChange={(e) => setP('url', e.target.value)} placeholder="https://example.com/hook" />;
      default:
        return null;
    }
  };

  const save = async () => {
    const body = {
      name: r.name.trim(),
      event: r.event,
      enabled: r.enabled,
      conditions: r.conditions.map((c: any) => ({ field: c.field, op: c.op, value: c.value ?? '' })),
      actions: r.actions.map((a: any) => ({ type: a.type, params: a.params ?? {} })),
    };
    const res = await run(() => (isNew ? api.post('/rules', body) : api.put(`/rules/${id}`, body)), t('Saved'));
    if (res) {
      qc.invalidateQueries({ queryKey: ['rules'] });
      nav('/automation');
    }
  };

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{isNew ? t('New automatic action') : r.name}</h1>
        <div className="spacer" />
        {!isNew && (
          <button
            className="btn btn-pill btn-danger"
            onClick={async () => {
              if (await confirm(t('Delete this automatic action?'), { danger: true })) {
                const res = await run(() => api.del(`/rules/${id}`));
                if (res) {
                  qc.invalidateQueries({ queryKey: ['rules'] });
                  nav('/automation');
                }
              }
            }}
          >
            <Trash2 /> {t('Delete')}
          </button>
        )}
        <Link to="/automation" className="btn btn-outline-blue">
          <Undo2 size={18} /> {t('Back')}
        </Link>
        <button className="btn btn-primary btn-pill" style={{ height: 44, padding: '0 24px' }} onClick={save} disabled={!r.name.trim() || !r.actions.length}>
          <Save /> {t('Save')}
        </button>
      </div>

      <div className="card card-pad mb">
        <div className="form-grid">
          <Field label={t('Name')}>
            <input className="input" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} autoFocus={isNew} />
          </Field>
          <Field label={t('Event (when to run)')}>
            <select className="select" value={r.event} onChange={(e) => setR({ ...r, event: e.target.value })}>
              {Object.entries(EVENT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <label className="check-label">
          <Switch checked={r.enabled} onChange={(v) => setR({ ...r, enabled: v })} /> {t('Active')}
        </label>
      </div>

      <div className="card card-pad mb">
        <div className="card-title dot mb">{t('Conditions (all must be met)')}</div>
        {!r.conditions.length && <p className="text-muted">{t('No conditions — the action runs for every order.')}</p>}
        {r.conditions.map((c: any, i: number) => {
          const kind = FIELD_KIND[c.field] ?? 'text';
          return (
            <div key={i} className="row wrap" style={{ padding: '8px 0', borderTop: i ? '1px solid var(--border-light)' : undefined, alignItems: 'flex-start' }}>
              <select
                className="select input-sm"
                style={{ width: 240 }}
                value={c.field}
                onChange={(e) => {
                  const k = FIELD_KIND[e.target.value] ?? 'text';
                  setCond(i, { field: e.target.value, op: OPS[k][0], value: k === 'bool' ? true : ['status', 'source', 'integration', 'payment'].includes(k) ? [] : '' });
                }}
              >
                {Object.entries(FIELD_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {t(v)}
                  </option>
                ))}
              </select>
              <select className="select input-sm" style={{ width: 170 }} value={c.op} onChange={(e) => setCond(i, { op: e.target.value })}>
                {OPS[kind].map((o) => (
                  <option key={o} value={o}>
                    {t(OP_LABELS[o])}
                  </option>
                ))}
              </select>
              <div className="grow">{valueInput(c, i)}</div>
              <button className="icon-btn" onClick={() => setR({ ...r, conditions: r.conditions.filter((_: any, j: number) => j !== i) })} aria-label={t('Delete')}>
                <Trash2 size={16} />
              </button>
            </div>
          );
        })}
        <button className="btn btn-sm mt-sm" onClick={() => setR({ ...r, conditions: [...r.conditions, { field: 'source', op: 'in', value: [] }] })}>
          <Plus /> {t('Add condition')}
        </button>
      </div>

      <div className="card card-pad mb">
        <div className="card-title dot mb">{t('Actions (run in order)')}</div>
        {r.actions.map((a: any, i: number) => (
          <div key={i} className="row wrap" style={{ padding: '8px 0', borderTop: i ? '1px solid var(--border-light)' : undefined }}>
            <span className="text-muted" style={{ width: 22 }}>
              {i + 1}.
            </span>
            <select className="select input-sm" style={{ width: 260 }} value={a.type} onChange={(e) => setAct(i, { type: e.target.value, params: {} })}>
              {Object.entries(ACTION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v)}
                </option>
              ))}
            </select>
            <div className="grow">{actionParams(a, i)}</div>
            <button className="icon-btn" onClick={() => setR({ ...r, actions: r.actions.filter((_: any, j: number) => j !== i) })} aria-label={t('Delete')}>
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <button className="btn btn-sm mt-sm" onClick={() => setR({ ...r, actions: [...r.actions, { type: 'set_status', params: {} }] })}>
          <Plus /> {t('Add action')}
        </button>
      </div>

      {!isNew && (
        <div className="card">
          <div className="card-head">
            <div className="card-title">{t('Execution log')}</div>
          </div>
          {!log.data?.length ? (
            <div className="text-muted" style={{ padding: '0 20px 20px' }}>
              {t('Not run yet')}
            </div>
          ) : (
            <table className="tbl">
              <tbody>
                {log.data.map((l) => (
                  <tr key={l.id}>
                    <td className="nowrap" style={{ width: 160 }}>
                      {fmtDateTime(l.created_at)}
                    </td>
                    <td style={{ width: 110 }}>{l.order_id && <Link to={`/orders/${l.order_id}`}>{l.order_id}</Link>}</td>
                    <td>{l.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
