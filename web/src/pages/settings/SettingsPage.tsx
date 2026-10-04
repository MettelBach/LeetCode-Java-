import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { api, setToken } from '../../api';
import { useAuth } from '../../auth';
import ApiTab from './ApiTab';
import { Empty, Field, Loading, Modal, Switch, useAction, useConfirm } from '../../components/ui';
import { useEmailTemplates, useInvoiceSeries, useSettings, useStatuses, type Status } from '../../data';
import { COUNTRIES, fmtDate, fmtDateTime, money } from '../../format';
import { useI18n, useT, type Lang } from '../../i18n';

const TABS = ['company', 'orders', 'statuses', 'invoices', 'email', 'users', 'api', 'account', 'subscription'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  company: 'Company details',
  orders: 'Order settings',
  statuses: 'Order statuses',
  invoices: 'Invoice numbering',
  email: 'E-mail templates',
  users: 'Users',
  api: 'API',
  account: 'My account',
  subscription: 'Subscription',
};

export default function SettingsPage() {
  const t = useT();
  const { tab = 'company' } = useParams();
  const current = (TABS.includes(tab as Tab) ? tab : 'company') as Tab;
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{t('Settings')}</h1>
      </div>
      <div className="tabs">
        {TABS.map((x) => (
          <NavLink key={x} to={`/settings/${x}`} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            {t(TAB_LABELS[x])}
          </NavLink>
        ))}
      </div>
      {current === 'company' && <CompanyTab />}
      {current === 'orders' && <OrdersTab />}
      {current === 'statuses' && <StatusesTab />}
      {current === 'invoices' && <SeriesTab />}
      {current === 'email' && <EmailTab />}
      {current === 'users' && <UsersTab />}
      {current === 'api' && <ApiTab />}
      {current === 'account' && <AccountTab />}
      {current === 'subscription' && <SubscriptionTab />}
    </>
  );
}

function useSaveSettings(key: string) {
  const run = useAction();
  const t = useT();
  const qc = useQueryClient();
  return async (value: any) => {
    const r = await run(() => api.put(`/settings/${key}`, value), t('Saved'));
    if (r) qc.invalidateQueries({ queryKey: ['settings'] });
  };
}

function CompanyTab() {
  const t = useT();
  const s = useSettings();
  const save = useSaveSettings('company');
  const [f, setF] = useState<any>(null);
  useEffect(() => {
    if (s.data) setF({ ...s.data.company });
  }, [s.data]);
  if (!f) return <Loading />;
  const inp = (k: string, label: string) => (
    <Field label={label}>
      <input className="input" value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </Field>
  );
  return (
    <div className="card card-pad" style={{ maxWidth: 820 }}>
      <p className="help-text" style={{ marginTop: 0 }}>
        {t('These details are printed on invoices, receipts, shipping labels and shown on the order page for buyers.')}
      </p>
      <div className="form-grid">
        {inp('name', t('Company name'))}
        {inp('nip', t('VAT Reg No (NIP)'))}
        {inp('address', t('Address'))}
        {inp('postcode', t('Postal code'))}
        {inp('city', t('City'))}
        <Field label={t('Country')}>
          <select className="select" value={f.country ?? 'PL'} onChange={(e) => setF({ ...f, country: e.target.value })}>
            {Object.entries(COUNTRIES).map(([c, n]) => (
              <option key={c} value={c}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        {inp('email', t('E-mail'))}
        {inp('phone', t('Phone'))}
        {inp('bank_account', t('Bank account'))}
        {inp('bank_name', t('Bank name'))}
      </div>
      <button className="btn btn-primary" onClick={() => save(f)}>
        <Save /> {t('Save')}
      </button>
    </div>
  );
}

function OrdersTab() {
  const t = useT();
  const s = useSettings();
  const statuses = useStatuses();
  const save = useSaveSettings('orders');
  const [f, setF] = useState<any>(null);
  useEffect(() => {
    if (s.data) setF({ ...s.data.orders });
  }, [s.data]);
  if (!f) return <Loading />;
  return (
    <div className="card card-pad" style={{ maxWidth: 820 }}>
      <div className="form-grid">
        <Field label={t('Deduct stock')}>
          <select className="select" value={f.stock_deduct} onChange={(e) => setF({ ...f, stock_deduct: e.target.value })}>
            <option value="on_create">{t('When the order is created / downloaded')}</option>
            {statuses.data?.statuses.map((x) => (
              <option key={x.id} value={`status:${x.id}`}>
                {t('When moved to status "{s}"', { s: x.name })}
              </option>
            ))}
            <option value="never">{t('Never (manual stock management)')}</option>
          </select>
        </Field>
        <Field label={t('Default VAT rate (%)')}>
          <select className="select" value={f.default_tax_rate} onChange={(e) => setF({ ...f, default_tax_rate: Number(e.target.value) })}>
            {[23, 8, 5, 0].map((r) => (
              <option key={r} value={r}>
                {r}%
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Orders per page')}>
          <select className="select" value={f.orders_per_page} onChange={(e) => setF({ ...f, orders_per_page: Number(e.target.value) })}>
            {[20, 50, 100, 200, 500, 1000].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <Field label=" ">
          <label className="check-label" style={{ height: 40 }}>
            <Switch checked={!!f.stock_restore_on_cancel} onChange={(v) => setF({ ...f, stock_restore_on_cancel: v })} /> {t('Return stock when the order is canceled')}
          </label>
        </Field>
        <Field label={t('Name of additional field 1')}>
          <input className="input" value={f.extra_field_1_label} onChange={(e) => setF({ ...f, extra_field_1_label: e.target.value })} placeholder={t('Additional field 1')} />
        </Field>
        <Field label={t('Name of additional field 2')}>
          <input className="input" value={f.extra_field_2_label} onChange={(e) => setF({ ...f, extra_field_2_label: e.target.value })} placeholder={t('Additional field 2')} />
        </Field>
      </div>
      <button className="btn btn-primary" onClick={() => save(f)}>
        <Save /> {t('Save')}
      </button>
    </div>
  );
}

function StatusesTab() {
  const t = useT();
  const q = useStatuses();
  const qc = useQueryClient();
  const run = useAction();
  const confirm = useConfirm();
  const [edit, setEdit] = useState<Partial<Status> | null>(null);
  const [del, setDel] = useState<Status | null>(null);
  const [moveTo, setMoveTo] = useState<number>(0);
  const [group, setGroup] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['statuses'] });
  if (!q.data) return <Loading />;
  const { statuses, groups, counts } = q.data;
  const move = (idx: number, dir: -1 | 1) => {
    const ids = statuses.map((s) => s.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    run(() => api.put('/statuses/reorder', { ids })).then(refresh);
  };
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 18 }}>
      <div className="card">
        <div className="card-head">
          <div className="card-title">{t('Order statuses')}</div>
          <button className="btn btn-primary btn-pill" onClick={() => setEdit({ name: '', short_name: '', full_name: '', color: '#0f74d4', group_id: null })}>
            <Plus /> {t('Add status')}
          </button>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th />
              <th>{t('Name')}</th>
              <th>{t('Short name')}</th>
              <th>{t('Name for the buyer')}</th>
              <th>{t('Group')}</th>
              <th className="num">{t('Orders')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {statuses.map((s, idx) => (
              <tr key={s.id}>
                <td className="nowrap">
                  <button className="icon-btn" onClick={() => move(idx, -1)} disabled={idx === 0} aria-label={t('Up')}>
                    <ArrowUp size={14} />
                  </button>
                  <button className="icon-btn" onClick={() => move(idx, 1)} disabled={idx === statuses.length - 1} aria-label={t('Down')}>
                    <ArrowDown size={14} />
                  </button>
                </td>
                <td>
                  <span className="badge" style={{ background: s.color }}>
                    {s.name}
                  </span>
                  {s.system_key && <span className="text-muted text-small"> ({t('system')})</span>}
                </td>
                <td>{s.short_name}</td>
                <td>{s.full_name}</td>
                <td>{groups.find((g) => g.id === s.group_id)?.name ?? '—'}</td>
                <td className="num">{counts.by_status[s.id] ?? 0}</td>
                <td className="num nowrap">
                  <button className="icon-btn" onClick={() => setEdit(s)} aria-label={t('Edit')}>
                    <Pencil size={16} />
                  </button>
                  {!s.system_key && (
                    <button
                      className="icon-btn"
                      aria-label={t('Delete')}
                      onClick={() => {
                        setDel(s);
                        setMoveTo(statuses.find((x) => x.id !== s.id)?.id ?? 0);
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card" style={{ alignSelf: 'start' }}>
        <div className="card-head">
          <div className="card-title">{t('Status groups')}</div>
        </div>
        <p className="help-text" style={{ padding: '0 20px', marginTop: 0 }}>
          {t('Groups organize statuses in the left column of the order list.')}
        </p>
        <table className="tbl">
          <tbody>
            {groups.map((g) => (
              <tr key={g.id}>
                <td>{g.name}</td>
                <td className="num nowrap">
                  <button
                    className="icon-btn"
                    aria-label={t('Edit')}
                    onClick={() => {
                      const name = window.prompt(t('Group name'), g.name);
                      if (name?.trim()) run(() => api.put(`/statuses/groups/${g.id}`, { name: name.trim() })).then(refresh);
                    }}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={t('Delete')}
                    onClick={async () => {
                      if (await confirm(t('Delete group "{name}"? Statuses stay, only the group is removed.', { name: g.name }), { danger: true }))
                        run(() => api.del(`/statuses/groups/${g.id}`)).then(refresh);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form
          className="row"
          style={{ padding: 16 }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!group.trim()) return;
            const r = await run(() => api.post('/statuses/groups', { name: group.trim() }));
            if (r) {
              setGroup('');
              refresh();
            }
          }}
        >
          <input className="input" value={group} onChange={(e) => setGroup(e.target.value)} placeholder={t('New group')} />
          <button className="btn">
            <Plus /> {t('Add')}
          </button>
        </form>
      </div>
      {edit && (
        <Modal
          title={edit.id ? t('Edit status') : t('Add status')}
          onClose={() => setEdit(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEdit(null)}>
                {t('Cancel')}
              </button>
              <button
                className="btn btn-primary"
                disabled={!edit.name?.trim()}
                onClick={async () => {
                  const body = { name: edit.name!.trim(), short_name: edit.short_name || edit.name, full_name: edit.full_name || edit.name, color: edit.color, group_id: edit.group_id ?? null };
                  const r = await run(() => (edit.id ? api.put(`/statuses/${edit.id}`, body) : api.post('/statuses', body)), t('Saved'));
                  if (r) {
                    setEdit(null);
                    refresh();
                  }
                }}
              >
                {t('Save')}
              </button>
            </>
          }
        >
          <div className="form-grid">
            <Field label={t('Name (visible to you)')} className="full">
              <input className="input" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus />
            </Field>
            <Field label={t('Short name (table)')}>
              <input className="input" value={edit.short_name ?? ''} onChange={(e) => setEdit({ ...edit, short_name: e.target.value })} maxLength={30} />
            </Field>
            <Field label={t('Colour')}>
              <input className="input" type="color" value={edit.color ?? '#0f74d4'} onChange={(e) => setEdit({ ...edit, color: e.target.value })} style={{ padding: 4 }} />
            </Field>
            <Field label={t('Full name (visible to the buyer)')} className="full">
              <input className="input" value={edit.full_name ?? ''} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} />
            </Field>
            <Field label={t('Group')} className="full">
              <select className="select" value={edit.group_id ?? ''} onChange={(e) => setEdit({ ...edit, group_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">{t('No group')}</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Modal>
      )}
      {del && (
        <Modal
          title={t('Delete status "{name}"', { name: del.name })}
          onClose={() => setDel(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDel(null)}>
                {t('Cancel')}
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  const r = await run(() => api.del(`/statuses/${del.id}`, { move_to: moveTo }), t('Deleted'));
                  if (r) {
                    setDel(null);
                    refresh();
                    qc.invalidateQueries({ queryKey: ['orders'] });
                  }
                }}
              >
                {t('Delete')}
              </button>
            </>
          }
        >
          <Field label={t('Move orders from this status to')}>
            <select className="select" value={moveTo} onChange={(e) => setMoveTo(Number(e.target.value))}>
              {statuses
                .filter((s) => s.id !== del.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </Field>
        </Modal>
      )}
    </div>
  );
}

function SeriesTab() {
  const t = useT();
  const q = useInvoiceSeries();
  const qc = useQueryClient();
  const run = useAction();
  const confirm = useConfirm();
  const [edit, setEdit] = useState<any | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['invoice-series'] });
  const TYPES: Record<string, string> = { invoice: t('Invoice'), proforma: t('Pro forma'), receipt: t('Receipt'), correction: t('Correction') };
  return (
    <div className="card" style={{ maxWidth: 960 }}>
      <div className="card-head">
        <div className="card-title">{t('Numbering series')}</div>
        <button className="btn btn-primary btn-pill" onClick={() => setEdit({ name: '', type: 'invoice', format: 'FV %N/%M/%Y', reset_period: 'month', is_default: false })}>
          <Plus /> {t('Add series')}
        </button>
      </div>
      <p className="help-text" style={{ padding: '0 20px', marginTop: 0 }}>
        {t('Format: %N — number, %M — month, %Y — year, %y — two-digit year. Example: "FV %N/%M/%Y" → FV 12/10/2026.')}
      </p>
      <table className="tbl">
        <thead>
          <tr>
            <th>{t('Name')}</th>
            <th>{t('Type')}</th>
            <th>{t('Format')}</th>
            <th>{t('Numbering resets')}</th>
            <th>{t('Default')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {q.data?.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{TYPES[s.type]}</td>
              <td>
                <span className="code">{s.format}</span>
              </td>
              <td>{s.reset_period === 'month' ? t('every month') : s.reset_period === 'year' ? t('every year') : t('never')}</td>
              <td>{s.is_default ? '✓' : ''}</td>
              <td className="num nowrap">
                <button className="icon-btn" onClick={() => setEdit({ ...s, is_default: !!s.is_default })} aria-label={t('Edit')}>
                  <Pencil size={16} />
                </button>
                <button
                  className="icon-btn"
                  aria-label={t('Delete')}
                  onClick={async () => {
                    if (await confirm(t('Delete series "{name}"?', { name: s.name }), { danger: true })) run(() => api.del(`/invoices/series/${s.id}`)).then(refresh);
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {edit && (
        <Modal
          title={edit.id ? t('Edit series') : t('Add series')}
          onClose={() => setEdit(null)}
          footer={
            <button
              className="btn btn-primary"
              onClick={async () => {
                const body = { name: edit.name, type: edit.type, format: edit.format, reset_period: edit.reset_period, is_default: !!edit.is_default };
                const r = await run(() => (edit.id ? api.put(`/invoices/series/${edit.id}`, body) : api.post('/invoices/series', body)), t('Saved'));
                if (r) {
                  setEdit(null);
                  refresh();
                }
              }}
            >
              {t('Save')}
            </button>
          }
        >
          <div className="form-grid">
            <Field label={t('Name')}>
              <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label={t('Type')}>
              <select className="select" value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>
                {Object.entries(TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('Format')}>
              <input className="input" value={edit.format} onChange={(e) => setEdit({ ...edit, format: e.target.value })} />
            </Field>
            <Field label={t('Numbering resets')}>
              <select className="select" value={edit.reset_period} onChange={(e) => setEdit({ ...edit, reset_period: e.target.value })}>
                <option value="month">{t('every month')}</option>
                <option value="year">{t('every year')}</option>
                <option value="never">{t('never')}</option>
              </select>
            </Field>
            <label className="check-label full">
              <input type="checkbox" checked={edit.is_default} onChange={(e) => setEdit({ ...edit, is_default: e.target.checked })} /> {t('Default series for this type')}
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}

const TAGS = ['[order_id]', '[buyer_name]', '[buyer_email]', '[total]', '[currency]', '[status]', '[delivery_method]', '[payment_method]', '[tracking_number]', '[products]', '[order_link]', '[company_name]'];

function EmailTab() {
  const t = useT();
  const q = useEmailTemplates();
  const s = useSettings();
  const qc = useQueryClient();
  const run = useAction();
  const confirm = useConfirm();
  const saveSmtp = useSaveSettings('smtp');
  const [edit, setEdit] = useState<any | null>(null);
  const [smtp, setSmtp] = useState<any>(null);
  useEffect(() => {
    if (s.data) setSmtp({ ...s.data.smtp });
  }, [s.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['email-templates'] });
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 18 }}>
      <div className="card" style={{ alignSelf: 'start' }}>
        <div className="card-head">
          <div className="card-title">{t('E-mail templates')}</div>
          <button className="btn btn-primary btn-pill" onClick={() => setEdit({ name: '', subject: '', body: '' })}>
            <Plus /> {t('Add template')}
          </button>
        </div>
        {!q.data?.length ? (
          <Empty>{t('No templates')}</Empty>
        ) : (
          <table className="tbl">
            <tbody>
              {q.data.map((x) => (
                <tr key={x.id}>
                  <td>
                    <b>{x.name}</b>
                    <div className="text-muted text-small">{x.subject}</div>
                  </td>
                  <td className="num nowrap">
                    <button className="icon-btn" onClick={() => setEdit(x)} aria-label={t('Edit')}>
                      <Pencil size={16} />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label={t('Delete')}
                      onClick={async () => {
                        if (await confirm(t('Delete template "{name}"?', { name: x.name }), { danger: true })) run(() => api.del(`/settings/email-templates/${x.id}`)).then(refresh);
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card card-pad" style={{ alignSelf: 'start' }}>
        <div className="card-title mb">{t('Outgoing mail server (SMTP)')}</div>
        {!smtp ? (
          <Loading />
        ) : (
          <>
            <div className="form-grid">
              <Field label={t('Server')}>
                <input className="input" value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} placeholder="smtp.example.com" />
              </Field>
              <Field label={t('Port')}>
                <select className="input" value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })}>
                  {[587, 465, 25, 2525].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('User')}>
                <input className="input" value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} autoComplete="off" />
              </Field>
              <Field label={t('Password')}>
                <input
                  className="input"
                  type="password"
                  value={smtp.password}
                  onChange={(e) => setSmtp({ ...smtp, password: e.target.value })}
                  onFocus={() => smtp.password === '••••••••' && setSmtp({ ...smtp, password: '' })}
                  autoComplete="new-password"
                />
              </Field>
              <Field label={t('Sender address')} className="full">
                <input className="input" value={smtp.from} onChange={(e) => setSmtp({ ...smtp, from: e.target.value })} placeholder="Sklep <sklep@example.com>" />
              </Field>
            </div>
            <label className="check-label mb">
              <input type="checkbox" checked={!!smtp.secure} onChange={(e) => setSmtp({ ...smtp, secure: e.target.checked })} /> SSL/TLS ({t('port 465')})
            </label>
            <div>
              <button className="btn btn-primary" onClick={() => saveSmtp(smtp)}>
                <Save /> {t('Save')}
              </button>
            </div>
          </>
        )}
      </div>
      {edit && (
        <Modal
          title={edit.id ? t('Edit template') : t('Add template')}
          size="lg"
          onClose={() => setEdit(null)}
          footer={
            <button
              className="btn btn-primary"
              disabled={!edit.name || !edit.subject || !edit.body}
              onClick={async () => {
                const body = { name: edit.name, subject: edit.subject, body: edit.body };
                const r = await run(() => (edit.id ? api.put(`/settings/email-templates/${edit.id}`, body) : api.post('/settings/email-templates', body)), t('Saved'));
                if (r) {
                  setEdit(null);
                  refresh();
                }
              }}
            >
              {t('Save')}
            </button>
          }
        >
          <Field label={t('Name')}>
            <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          </Field>
          <Field label={t('Subject')}>
            <input className="input" value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} />
          </Field>
          <Field label={t('Message')}>
            <textarea className="textarea" style={{ minHeight: 220 }} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
          </Field>
          <div className="help-text">
            {t('Available tags')}:{' '}
            {TAGS.map((tag) => (
              <button key={tag} className="rule-chip" style={{ border: 0, cursor: 'pointer' }} onClick={() => setEdit({ ...edit, body: `${edit.body}${tag}` })}>
                {tag}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function UsersTab() {
  const t = useT();
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const run = useAction();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<any[]>('/users') });
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'user' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });
  const ROLES: Record<string, string> = { owner: t('Owner'), admin: t('Administrator'), user: t('User') };
  return (
    <div className="card" style={{ maxWidth: 960 }}>
      <div className="card-head">
        <div className="card-title">{t('Users')}</div>
        {isAdmin && (
          <button className="btn btn-primary btn-pill" onClick={() => setAdding(true)}>
            <Plus /> {t('Add user')}
          </button>
        )}
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>{t('Name')}</th>
            <th>E-mail</th>
            <th>{t('Role')}</th>
            <th>{t('Last login')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {q.data?.map((u) => (
            <tr key={u.id} style={{ opacity: u.active ? 1 : 0.5 }}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>
                {isAdmin && u.role !== 'owner' && u.id !== user?.id ? (
                  <select className="select input-sm" style={{ width: 160 }} value={u.role} onChange={(e) => run(() => api.put(`/users/${u.id}`, { role: e.target.value })).then(refresh)}>
                    <option value="admin">{ROLES.admin}</option>
                    <option value="user">{ROLES.user}</option>
                  </select>
                ) : (
                  ROLES[u.role]
                )}
              </td>
              <td>{fmtDateTime(u.last_login_at)}</td>
              <td className="num nowrap">
                {isAdmin && u.role !== 'owner' && u.id !== user?.id && (
                  <>
                    <button className="btn btn-xs" onClick={() => run(() => api.put(`/users/${u.id}`, { active: !u.active })).then(refresh)}>
                      {u.active ? t('Block') : t('Unblock')}
                    </button>{' '}
                    <button
                      className="btn btn-xs btn-danger"
                      onClick={async () => {
                        if (await confirm(t('Delete user {name}?', { name: u.name }), { danger: true })) run(() => api.del(`/users/${u.id}`)).then(refresh);
                      }}
                    >
                      {t('Delete')}
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {adding && (
        <Modal
          title={t('Add user')}
          onClose={() => setAdding(false)}
          footer={
            <button
              className="btn btn-primary"
              onClick={async () => {
                const r = await run(() => api.post('/users', f), t('Saved'));
                if (r) {
                  setAdding(false);
                  setF({ name: '', email: '', password: '', role: 'user' });
                  refresh();
                }
              }}
            >
              {t('Save')}
            </button>
          }
        >
          <Field label={t('Name')}>
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="E-mail">
            <input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field label={t('Password')} help={t('At least 8 characters')}>
            <input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
          </Field>
          <Field label={t('Role')}>
            <select className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              <option value="user">{ROLES.user}</option>
              <option value="admin">{ROLES.admin}</option>
            </select>
          </Field>
        </Modal>
      )}
    </div>
  );
}

function AccountTab() {
  const t = useT();
  const { user, refresh, logout } = useAuth();
  const { setLang } = useI18n();
  const run = useAction();
  const [name, setName] = useState(user?.name ?? '');
  const [pwd, setPwd] = useState({ current_password: '', new_password: '' });
  return (
    <div className="grid grid-2" style={{ maxWidth: 960 }}>
      <div className="card card-pad">
        <div className="card-title mb">{t('My account')}</div>
        <Field label="E-mail">
          <input className="input" value={user?.email ?? ''} disabled />
        </Field>
        <Field label={t('Name')}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('Language')}>
          <select
            className="select"
            value={user?.language}
            onChange={(e) => {
              const l = e.target.value as Lang;
              setLang(l);
              run(() => api.put('/auth/me', { language: l })).then(refresh);
            }}
          >
            <option value="pl">Polski</option>
            <option value="en">English</option>
            <option value="ru">Русский</option>
          </select>
        </Field>
        <button className="btn btn-primary" onClick={() => run(() => api.put('/auth/me', { name }), t('Saved')).then(refresh)}>
          <Save /> {t('Save')}
        </button>
      </div>
      <div className="card card-pad">
        <div className="card-title mb">{t('Change password')}</div>
        <Field label={t('Current password')}>
          <input className="input" type="password" value={pwd.current_password} onChange={(e) => setPwd({ ...pwd, current_password: e.target.value })} autoComplete="current-password" />
        </Field>
        <Field label={t('New password')} help={t('At least 8 characters')}>
          <input className="input" type="password" value={pwd.new_password} onChange={(e) => setPwd({ ...pwd, new_password: e.target.value })} autoComplete="new-password" />
        </Field>
        <div className="row wrap">
          <button className="btn btn-primary" disabled={pwd.new_password.length < 8} onClick={() => run(() => api.put<{ token?: string }>('/auth/me', pwd), t('Password changed')).then((r) => {
                if (r?.token) setToken(r.token);
                setPwd({ current_password: '', new_password: '' });
              })}>
            {t('Change password')}
          </button>
          <button
            className="btn"
            onClick={async () => {
              const r = await run(() => api.post('/auth/logout-all'));
              if (r) logout();
            }}
          >
            {t('Log out on all devices')}
          </button>
        </div>
      </div>
    </div>
  );
}

function SubscriptionTab() {
  const t = useT();
  const { isAdmin, refresh } = useAuth();
  const run = useAction();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['billing'], queryFn: () => api.get<any>('/billing') });
  const b = q.data;
  if (!b) return <Loading />;
  const STATUS: Record<string, string> = { trial: t('Trial period'), active: t('Active'), suspended: t('Suspended'), closed: t('Closed') };
  return (
    <>
      <div className="grid grid-3 mb">
        <div className="card stat">
          <div className="label">{t('Plan')}</div>
          <div className="value">{b.plan.name}</div>
          <div className="text-muted">
            {STATUS[b.status]}
            {b.status === 'trial' && b.trial_ends_at && ` — ${t('until')} ${fmtDate(b.trial_ends_at)}`}
            {b.paid_until && ` · ${t('paid until')} ${fmtDate(b.paid_until)}`}
          </div>
        </div>
        <div className="card stat">
          <div className="label">{t('Orders this month')}</div>
          <div className="value">
            {b.usage.orders_month ?? 0} <small style={{ fontSize: 15 }}>/ {b.plan.orders}</small>
          </div>
          <div className="progress" style={{ width: '100%', marginTop: 6 }}>
            <div style={{ width: `${Math.min(100, ((b.usage.orders_month ?? 0) / b.plan.orders) * 100)}%` }} />
          </div>
        </div>
        <div className="card stat">
          <div className="label">{t('Balance')}</div>
          <div className="value" style={{ color: b.balance > 0 ? 'var(--red)' : 'var(--green)' }}>
            {money(Math.abs(b.balance))}
          </div>
          <div className="text-muted">{b.balance > 0 ? t('to pay') : t('overpayment / nothing to pay')}</div>
        </div>
      </div>
      <div className="grid grid-4 mb">
        {b.plans.map((p: any) => (
          <div key={p.id} className="card card-pad" style={{ border: p.id === b.plan.id ? '2px solid var(--blue)' : '2px solid transparent' }}>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{p.name}</div>
            <div style={{ fontSize: 28, fontWeight: 300, margin: '8px 0' }}>
              {p.price} zł <small style={{ fontSize: 13 }}>{t('net / month')}</small>
            </div>
            <ul className="list-plain text-small" style={{ lineHeight: 1.9 }}>
              <li>✓ {t('up to {n} orders / month', { n: p.orders.toLocaleString() })}</li>
              <li>✓ {t('{n} users', { n: p.users })}</li>
              <li>✓ {t('{n} marketplace accounts', { n: p.integrations })}</li>
              <li>✓ {t('All modules: orders, inventory, invoices, shipping, returns, automation')}</li>
            </ul>
            {p.id !== b.plan.id && isAdmin && (
              <button
                className="btn btn-primary mt-sm"
                style={{ width: '100%' }}
                onClick={async () => {
                  if (await confirm(t('Switch to the {name} plan ({price} zł net / month)?', { name: p.name, price: p.price }))) {
                    const r = await run(() => api.put('/billing/plan', { plan: p.id }), t('Plan changed'));
                    if (r) {
                      qc.invalidateQueries({ queryKey: ['billing'] });
                      refresh();
                    }
                  }
                }}
              >
                {t('Choose')}
              </button>
            )}
            {p.id === b.plan.id && <div className="badge-soft blue mt-sm">{t('Current plan')}</div>}
          </div>
        ))}
      </div>
      <div className="grid grid-2">
        <div className="card card-pad">
          <div className="card-title mb">{t('How to pay')}</div>
          {b.payment.bank_account ? (
            <dl className="kv" style={{ gridTemplateColumns: '150px 1fr' }}>
              <dt>{t('Recipient')}:</dt>
              <dd>{b.payment.recipient}</dd>
              <dt>{t('Account number')}:</dt>
              <dd className="code">{b.payment.bank_account}</dd>
              <dt>{t('Transfer title')}:</dt>
              <dd className="code">{b.payment.title}</dd>
            </dl>
          ) : (
            <p className="text-muted">{t('Contact support to receive the payment details.')}</p>
          )}
          <p className="help-text">{t('After the payment is booked the subscription is extended automatically. A VAT invoice is sent by e-mail.')}</p>
        </div>
        <div className="card">
          <div className="card-head">
            <div className="card-title">{t('Charges and payments')}</div>
          </div>
          {!b.ledger.length ? (
            <div className="text-muted" style={{ padding: '0 20px 20px' }}>
              {t('No entries')}
            </div>
          ) : (
            <table className="tbl">
              <tbody>
                {b.ledger.map((l: any, i: number) => (
                  <tr key={i}>
                    <td className="nowrap">{fmtDate(l.date)}</td>
                    <td>{l.description}</td>
                    <td className="num" style={{ color: l.amount < 0 ? 'var(--green)' : undefined }}>
                      {money(l.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
