import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, LogIn, LogOut, Search, Send, ShieldCheck, UserPlus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, NavLink, Outlet, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { adminApi, getStaffToken, setImpersonationToken, setStaffToken, setStaffUnauthorizedHandler } from '../../api';
import { BRAND } from '../../brand';
import { Empty, Field, Loading, LogoMark, Modal, Pager, Tabs, useAction, useConfirm } from '../../components/ui';
import { fmtDate, fmtDateTime, money } from '../../format';
import { useT } from '../../i18n';
import { TICKET_CATEGORIES } from '../help/HelpPages';

const ACCOUNT_STATUS: Record<string, string> = { trial: 'blue', active: 'green', suspended: 'orange', closed: 'red' };
const TICKET_ST: Record<string, string> = { new: 'blue', open: 'orange', waiting: 'green', resolved: '', closed: '' };
const PRIORITY: Record<string, string> = { urgent: 'red', high: 'orange', normal: '', low: '' };

function useStaff() {
  return useQuery({ queryKey: ['staff-me'], queryFn: () => (getStaffToken() ? adminApi.get<any>('/me') : Promise.resolve(null)), retry: false });
}

export function AdminLogin() {
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await adminApi.post('/login', { email, password });
      setStaffToken(r.token);
      await qc.invalidateQueries({ queryKey: ['staff-me'] });
      nav('/admin');
    } catch (err: any) {
      setError(t(err.message));
    }
  };
  return (
    <div className="auth-page" style={{ background: 'linear-gradient(135deg, #1b1f24, #2b3036)' }}>
      <form className="auth-card" onSubmit={submit}>
        <div className="logo">
          <LogoMark size={38} /> {BRAND.name} <span className="badge-soft" style={{ marginLeft: 6 }}>Admin</span>
        </div>
        <h2 style={{ fontSize: 20, marginBottom: 18, fontWeight: 600 }}>{t('Support panel')}</h2>
        <Field label={t('E-mail')}>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="username" />
        </Field>
        <Field label={t('Password')}>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </Field>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary" style={{ width: '100%', height: 44 }}>
          {t('Log in')}
        </button>
      </form>
    </div>
  );
}

export function AdminLayout() {
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const me = useStaff();
  useEffect(() => {
    setStaffUnauthorizedHandler(() => {
      qc.setQueryData(['staff-me'], null);
      nav('/admin/login');
    });
  }, [nav, qc]);
  if (me.isLoading) return <Loading />;
  if (!me.data) return <Navigate to="/admin/login" replace />;
  const link = (to: string, label: string) => (
    <NavLink to={to} end={to === '/admin'} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`} style={{ color: '#d4dae0' }}>
      {label}
    </NavLink>
  );
  return (
    <div style={{ minHeight: '100vh' }}>
      <header className="row" style={{ background: '#1f2328', color: '#fff', padding: '0 24px', height: 60, gap: 22, position: 'sticky', top: 0, zIndex: 30 }}>
        <Link to="/admin" className="row" style={{ color: '#fff', fontWeight: 700, fontSize: 18, gap: 10, textDecoration: 'none' }}>
          <LogoMark size={30} /> {BRAND.name} <span className="badge" style={{ background: '#f0803c' }}>{t('Support panel')}</span>
        </Link>
        <nav className="row admin-nav" style={{ gap: 0, alignSelf: 'stretch' }}>
          {link('/admin', t('Dashboard'))}
          {link('/admin/accounts', t('Client accounts'))}
          {link('/admin/tickets', t('Tickets'))}
          {link('/admin/staff', t('Team'))}
          {link('/admin/audit', t('Audit log'))}
        </nav>
        <div className="grow" />
        <span className="row" style={{ gap: 8, color: '#d4dae0' }}>
          <ShieldCheck size={18} /> {me.data.name} <span className="text-small" style={{ color: '#8a9199' }}>({me.data.role})</span>
        </span>
        <button
          className="icon-btn"
          style={{ color: '#d4dae0' }}
          title={t('Log out')}
          onClick={() => {
            setStaffToken(null);
            qc.setQueryData(['staff-me'], null);
            nav('/admin/login');
          }}
        >
          <LogOut size={20} />
        </button>
      </header>
      <main className="content">
        <Outlet context={me.data} />
      </main>
    </div>
  );
}

export function AdminDashboard() {
  const t = useT();
  const q = useQuery({ queryKey: ['admin-stats'], queryFn: () => adminApi.get<any>('/stats'), refetchInterval: 60_000 });
  const d = q.data;
  if (!d) return <Loading />;
  const tiles = [
    { label: t('Accounts'), value: d.accounts.total, sub: `${d.accounts.active ?? 0} ${t('active')} · ${d.accounts.trial ?? 0} ${t('trial')} · ${d.accounts.suspended ?? 0} ${t('suspended')}` },
    { label: t('New accounts (30 days)'), value: d.accounts.new_30d ?? 0, sub: `${d.accounts.active_7d ?? 0} ${t('active in the last 7 days')}` },
    { label: 'MRR', value: money(d.mrr), sub: `${t('Accelerations (30 days)')}: ${money(d.accel_revenue_30d)}` },
    { label: t('Open tickets'), value: (d.tickets.new ?? 0) + (d.tickets.open ?? 0), sub: `${d.tickets.unassigned ?? 0} ${t('unassigned')} · ${d.tickets.waiting ?? 0} ${t('waiting for client')}` },
  ];
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{t('Platform overview')}</h1>
      </div>
      <div className="grid grid-4 mb">
        {tiles.map((x) => (
          <div key={x.label} className="card stat">
            <div className="label">{x.label}</div>
            <div className="value">{x.value}</div>
            <div className="text-muted text-small">{x.sub}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <div className="card-title">{t('Sign-ups (30 days)')}</div>
          </div>
          <div style={{ height: 220, padding: '0 16px 16px' }}>
            <ResponsiveContainer>
              <AreaChart data={d.signups}>
                <XAxis dataKey="d" tick={{ fontSize: 11 }} tickFormatter={(x: string) => x.slice(5)} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 13 }} />
                <Area type="monotone" dataKey="c" stroke="#1271d3" fill="#e7f1fc" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <div className="card-title">{t('Client activity (30 days)')}</div>
          </div>
          <dl className="kv" style={{ padding: '0 20px 20px' }}>
            <dt>{t('Orders processed')}:</dt>
            <dd>{d.totals.orders_30d}</dd>
            <dt>GMV:</dt>
            <dd>{money(d.totals.gmv_30d)}</dd>
            <dt>{t('Integrations with errors')}:</dt>
            <dd style={{ color: d.totals.integration_errors ? 'var(--red)' : undefined }}>{d.totals.integration_errors}</dd>
          </dl>
          <div className="row" style={{ padding: '0 20px 20px' }}>
            <Link to="/admin/tickets?assigned=none" className="btn">
              {t('Unassigned tickets')}
            </Link>
            <Link to="/admin/accounts?status=suspended" className="btn">
              {t('Suspended accounts')}
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

export function AdminAccounts() {
  const t = useT();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const page = Number(params.get('page') ?? 1);
  const query = { search: params.get('search') ?? undefined, status: params.get('status') ?? undefined, plan: params.get('plan') ?? undefined, page };
  const q = useQuery({ queryKey: ['admin-accounts', query], queryFn: () => adminApi.get<any>('/accounts', query), placeholderData: keepPreviousData });
  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{t('Client accounts')}</h1>
      </div>
      <div className="toolbar">
        <form
          className="searchbox-input"
          style={{ height: 40, maxWidth: 380, flex: 1 }}
          onSubmit={(e) => {
            e.preventDefault();
            setParam({ search: search.trim() || null });
          }}
        >
          <Search size={18} />
          <input placeholder={t('Company, NIP, e-mail, account ID')} value={search} onChange={(e) => setSearch(e.target.value)} style={{ border: 0, outline: 0, flex: 1 }} />
        </form>
        <select className="select" style={{ width: 170 }} value={query.status ?? ''} onChange={(e) => setParam({ status: e.target.value || null })}>
          <option value="">{t('All statuses')}</option>
          {Object.keys(ACCOUNT_STATUS).map((s) => (
            <option key={s} value={s}>
              {t(s)}
            </option>
          ))}
        </select>
        <select className="select" style={{ width: 170 }} value={query.plan ?? ''} onChange={(e) => setParam({ plan: e.target.value || null })}>
          <option value="">{t('All plans')}</option>
          {['trial', 'start', 'business', 'pro', 'enterprise'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Pager page={page} perPage={50} total={q.data?.total ?? 0} onPage={(p) => setParam({ page: String(p) })} />
      </div>
      <div className="table-wrap">
        {!q.data ? (
          <Loading />
        ) : !q.data.rows.length ? (
          <Empty>{t('No accounts')}</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>ID</th>
                <th>{t('Company')}</th>
                <th>{t('Plan')}</th>
                <th>{t('Status')}</th>
                <th className="num">{t('Orders (30 d)')}</th>
                <th className="num">{t('Integrations')}</th>
                <th className="num">{t('Balance')}</th>
                <th className="num">{t('Tickets')}</th>
                <th>{t('Last activity')}</th>
                <th>{t('Created')}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((a: any) => (
                <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/admin/accounts/${a.id}`)}>
                  <td>
                    <Link to={`/admin/accounts/${a.id}`} className="order-no" style={{ fontSize: 14 }}>
                      {a.id}
                    </Link>
                  </td>
                  <td>
                    <b style={{ color: '#2f343a' }}>{a.name}</b>
                    <div className="text-muted text-small">{a.owner_email}</div>
                  </td>
                  <td>{a.plan}</td>
                  <td>
                    <span className={`badge-soft ${ACCOUNT_STATUS[a.status]}`}>{t(a.status)}</span>
                    {a.status === 'trial' && a.trial_ends_at && <div className="text-muted text-small">{t('until')} {fmtDate(a.trial_ends_at)}</div>}
                  </td>
                  <td className="num">{a.stats.orders_30d ?? '—'}</td>
                  <td className="num">
                    {a.stats.integrations ?? '—'}
                    {a.stats.integration_errors ? <span className="badge-soft red" style={{ marginLeft: 6 }}>{a.stats.integration_errors}</span> : null}
                  </td>
                  <td className="num" style={{ color: a.balance > 0 ? 'var(--red)' : undefined }}>
                    {money(a.balance)}
                  </td>
                  <td className="num">{a.open_tickets || '—'}</td>
                  <td>{fmtDateTime(a.last_activity_at)}</td>
                  <td>{fmtDate(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

export function AdminAccount() {
  const { id } = useParams();
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const run = useAction();
  const confirm = useConfirm();
  const me = useStaff();
  const [tab, setTab] = useState<'overview' | 'users' | 'billing' | 'tickets' | 'audit'>('overview');
  const [impersonate, setImpersonate] = useState(false);
  const [payment, setPayment] = useState(false);
  const q = useQuery({ queryKey: ['admin-account', id], queryFn: () => adminApi.get<any>(`/accounts/${id}`) });
  const [form, setForm] = useState<any>(null);
  useEffect(() => {
    if (q.data) setForm({ plan: q.data.plan, status: q.data.status, trial_ends_at: q.data.trial_ends_at?.slice(0, 10) ?? '', paid_until: q.data.paid_until?.slice(0, 10) ?? '', notes: q.data.notes });
  }, [q.data]);
  const a = q.data;
  if (!a || !form) return <Loading />;
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-account', id] });
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          {a.name} <small>#{a.id}</small>
          <span className={`badge-soft ${ACCOUNT_STATUS[a.status]}`}>{t(a.status)}</span>
        </h1>
        <div className="spacer" />
        <button className="btn btn-primary btn-pill" style={{ height: 44 }} onClick={() => setImpersonate(true)}>
          <LogIn /> {t('Log in to the account')}
        </button>
        <Link to={`/admin/tickets?account_id=${a.id}`} className="btn btn-pill">
          {t('Tickets')}
        </Link>
        <Link to="/admin/accounts" className="btn btn-outline-blue">
          {t('Back')}
        </Link>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: t('Overview') },
          { id: 'users', label: `${t('Users')} (${a.users.length})` },
          { id: 'billing', label: t('Billing') },
          { id: 'tickets', label: `${t('Tickets')} (${a.tickets.length})` },
          { id: 'audit', label: t('Audit log') },
        ]}
      />
      {tab === 'overview' && (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 18 }}>
          <div>
            <div className="grid grid-4 mb">
              {[
                [t('Orders (30 d)'), a.stats.orders_30d],
                [t('Orders this month'), `${a.stats.orders_month} / ${a.plan_info.orders}`],
                [t('Products'), a.stats.products],
                ['GMV (30 d)', money(a.stats.gmv_30d)],
              ].map(([l, v]) => (
                <div key={String(l)} className="card stat">
                  <div className="label">{l}</div>
                  <div className="value" style={{ fontSize: 22 }}>
                    {v}
                  </div>
                </div>
              ))}
            </div>
            <div className="card mb">
              <div className="card-head">
                <div className="card-title">{t('Integrations')}</div>
              </div>
              <table className="tbl">
                <tbody>
                  {a.integrations.map((i: any) => (
                    <tr key={i.id}>
                      <td>{i.type}</td>
                      <td>
                        {i.name} {i.demo ? <span className="badge-soft blue">demo</span> : null}
                      </td>
                      <td>{i.enabled ? <span className="badge-soft green">{t('enabled')}</span> : <span className="badge-soft">{t('disabled')}</span>}</td>
                      <td>{fmtDateTime(i.last_sync_at)}</td>
                      <td style={{ color: 'var(--red)' }}>{i.last_error}</td>
                    </tr>
                  ))}
                  {!a.integrations.length && (
                    <tr>
                      <td className="text-muted">{t('No integrations')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {!!a.sync_errors.length && (
              <div className="card">
                <div className="card-head">
                  <div className="card-title">{t('Recent synchronization errors')}</div>
                </div>
                <table className="tbl">
                  <tbody>
                    {a.sync_errors.map((e: any, i: number) => (
                      <tr key={i}>
                        <td className="nowrap">{fmtDateTime(e.created_at)}</td>
                        <td>{e.name}</td>
                        <td style={{ wordBreak: 'break-word' }}>{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="card card-pad" style={{ alignSelf: 'start' }}>
            <Field label={t('Plan')}>
              <select className="select" value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
                {['trial', 'start', 'business', 'pro', 'enterprise'].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </Field>
            <Field label={t('Status')}>
              <select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {Object.keys(ACCOUNT_STATUS).map((s) => (
                  <option key={s} value={s}>
                    {t(s)}
                  </option>
                ))}
              </select>
            </Field>
            <div className="form-grid">
              <Field label={t('Trial until')}>
                <input className="input" type="date" value={form.trial_ends_at} onChange={(e) => setForm({ ...form, trial_ends_at: e.target.value })} />
              </Field>
              <Field label={t('Paid until')}>
                <input className="input" type="date" value={form.paid_until} onChange={(e) => setForm({ ...form, paid_until: e.target.value })} />
              </Field>
            </div>
            <Field label={t('Internal notes')}>
              <textarea className="textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
            <div className="row wrap">
              <button
                className="btn btn-primary"
                onClick={() =>
                  run(
                    () =>
                      adminApi.put(`/accounts/${a.id}`, {
                        plan: form.plan,
                        status: form.status,
                        trial_ends_at: form.trial_ends_at ? `${form.trial_ends_at} 23:59:59` : null,
                        paid_until: form.paid_until ? `${form.paid_until} 23:59:59` : null,
                        notes: form.notes,
                      }),
                    t('Saved'),
                  ).then(refresh)
                }
              >
                {t('Save')}
              </button>
              <button className="btn" onClick={() => setPayment(true)}>
                {t('Register payment')}
              </button>
              {me.data?.role === 'superadmin' && (
                <button
                  className="btn btn-danger"
                  onClick={async () => {
                    const typed = window.prompt(t('Type the account ID ({id}) to delete it permanently with all data:', { id: a.id }));
                    if (typed !== String(a.id)) return;
                    if (await confirm(t('Delete account {name} permanently?', { name: a.name }), { danger: true })) {
                      const r = await run(() => adminApi.del(`/accounts/${a.id}`, { confirm: String(a.id) }), t('Deleted'));
                      if (r) nav('/admin/accounts');
                    }
                  }}
                >
                  {t('Delete account')}
                </button>
              )}
            </div>
            <dl className="kv mt" style={{ gridTemplateColumns: '140px 1fr', fontSize: 13 }}>
              <dt>{t('Created')}:</dt>
              <dd>{fmtDateTime(a.created_at)}</dd>
              <dt>{t('Last activity')}:</dt>
              <dd>{fmtDateTime(a.last_activity_at)}</dd>
              <dt>{t('Balance')}:</dt>
              <dd style={{ color: a.balance > 0 ? 'var(--red)' : 'var(--green)' }}>{money(a.balance)}</dd>
              <dt>{t('Accelerations')}:</dt>
              <dd>
                {Object.entries(a.accelerations)
                  .filter(([, v]) => v !== 'std')
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ') || '—'}
              </dd>
            </dl>
          </div>
        </div>
      )}
      {tab === 'users' && (
        <div className="table-wrap">
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
              {a.users.map((u: any) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>{fmtDateTime(u.last_login_at)}</td>
                  <td className="num">
                    <button className="btn btn-xs" onClick={() => run(() => adminApi.post(`/accounts/${a.id}/users/${u.id}/logout`), t('Sessions ended'))}>
                      {t('End sessions')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'billing' && (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('Date')}</th>
                <th>{t('Description')}</th>
                <th className="num">{t('Amount')}</th>
              </tr>
            </thead>
            <tbody>
              {a.billing.map((b: any) => (
                <tr key={b.id}>
                  <td>{fmtDate(b.date)}</td>
                  <td>{b.description}</td>
                  <td className="num" style={{ color: b.amount < 0 ? 'var(--green)' : undefined }}>
                    {money(b.amount)}
                  </td>
                </tr>
              ))}
              {!a.billing.length && (
                <tr>
                  <td className="text-muted">{t('No entries')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'tickets' && <TicketsTable rows={a.tickets} />}
      {tab === 'audit' && <AuditTable rows={a.audit} />}
      {impersonate && (
        <ImpersonateModal
          account={a}
          onClose={() => {
            setImpersonate(false);
            refresh();
          }}
        />
      )}
      {payment && <PaymentModal accountId={a.id} onClose={() => (setPayment(false), refresh())} />}
    </>
  );
}

function ImpersonateModal({ account, onClose }: { account: any; onClose: () => void }) {
  const t = useT();
  const run = useAction();
  const [reason, setReason] = useState('');
  return (
    <Modal
      title={t('Log in to the account {name}', { name: account.name })}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={reason.trim().length < 3}
            onClick={async () => {
              const r = await run(() => adminApi.post(`/accounts/${account.id}/impersonate`, { reason }));
              if (!r) return;
              // The client session lives only in the new tab (sessionStorage). The token travels
              // in the URL fragment, which is never sent to the server and is removed immediately.
              const w = window.open(`/impersonate#${r.token}`, '_blank');
              if (!w) {
                setImpersonationToken(r.token);
                window.location.href = '/';
              }
              onClose();
            }}
          >
            <ExternalLink /> {t('Open the client panel')}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>{t('The session lasts 2 hours and is recorded in the audit log. Your actions are marked as "Support" in the client account.')}</p>
      <Field label={t('Reason (e.g. ticket number)')}>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}

function PaymentModal({ accountId, onClose }: { accountId: number; onClose: () => void }) {
  const t = useT();
  const run = useAction();
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState('30');
  const [desc, setDesc] = useState('');
  return (
    <Modal
      title={t('Register payment')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!(Number(amount.replace(',', '.')) > 0)}
            onClick={async () => {
              const r = await run(
                () => adminApi.post(`/accounts/${accountId}/payments`, { amount: Number(amount.replace(',', '.')), extend_days: Number(days) || 0, description: desc || undefined }),
                t('Saved'),
              );
              if (r) onClose();
            }}
          >
            {t('Save')}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={t('Amount (PLN)')}>
          <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus />
        </Field>
        <Field label={t('Extend subscription by (days)')}>
          <input className="input" value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label={t('Description')} className="full">
          <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t('e.g. bank transfer 12.10')} />
        </Field>
      </div>
    </Modal>
  );
}

function TicketsTable({ rows }: { rows: any[] }) {
  const t = useT();
  const nav = useNavigate();
  return (
    <div className="table-wrap">
      {!rows.length ? (
        <Empty>{t('No tickets')}</Empty>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>{t('Subject')}</th>
              <th>{t('Account')}</th>
              <th>{t('Priority')}</th>
              <th>{t('Status')}</th>
              <th>{t('Assigned')}</th>
              <th>{t('Last message')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((tk) => (
              <tr key={tk.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/admin/tickets/${tk.id}`)}>
                <td>
                  <Link to={`/admin/tickets/${tk.id}`}>{tk.id}</Link>
                </td>
                <td style={{ fontWeight: tk.last_author === 'user' && ['new', 'open'].includes(tk.status) ? 700 : 400 }}>
                  {tk.subject}
                  {tk.category && <div className="text-muted text-small">{t(TICKET_CATEGORIES[tk.category] ?? tk.category)}</div>}
                </td>
                <td>{tk.account_name ?? ''}</td>
                <td>
                  <span className={`badge-soft ${PRIORITY[tk.priority]}`}>{t(tk.priority)}</span>
                </td>
                <td>
                  <span className={`badge-soft ${TICKET_ST[tk.status]}`}>{t(tk.status)}</span>
                </td>
                <td>{tk.assigned_name ?? <span className="text-muted">—</span>}</td>
                <td className="nowrap">{fmtDateTime(tk.last_message_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AuditTable({ rows }: { rows: any[] }) {
  const t = useT();
  return (
    <div className="table-wrap">
      {!rows.length ? (
        <Empty>{t('No entries')}</Empty>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>{t('Date')}</th>
              <th>{t('Staff')}</th>
              <th>{t('Account')}</th>
              <th>{t('Action')}</th>
              <th>{t('Details')}</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td className="nowrap">{fmtDateTime(l.created_at)}</td>
                <td>{l.staff_name ?? '—'}</td>
                <td>{l.account_id ? <Link to={`/admin/accounts/${l.account_id}`}>{l.account_name ?? l.account_id}</Link> : '—'}</td>
                <td>
                  <span className="code">{l.action}</span>
                </td>
                <td style={{ wordBreak: 'break-word', maxWidth: 400 }}>{l.details}</td>
                <td className="text-muted text-small">{l.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function AdminTickets() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const query = {
    status: params.get('status') ?? 'active',
    assigned: params.get('assigned') ?? undefined,
    account_id: params.get('account_id') ?? undefined,
    search: params.get('search') ?? undefined,
  };
  const q = useQuery({ queryKey: ['admin-tickets', query], queryFn: () => adminApi.get<any[]>('/tickets', query), refetchInterval: 30_000 });
  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    setParams(next);
  };
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{t('Tickets')}</h1>
      </div>
      <div className="toolbar">
        <div className="btn-group">
          {[
            ['active', t('Active')],
            ['new', t('new')],
            ['open', t('open')],
            ['waiting', t('waiting')],
            ['resolved', t('resolved')],
            ['closed', t('closed')],
          ].map(([k, l]) => (
            <button key={k} className={`btn ${query.status === k ? 'btn-primary' : ''}`} onClick={() => setParam({ status: k })}>
              {l}
            </button>
          ))}
        </div>
        <div className="btn-group">
          {[
            ['', t('Everyone')],
            ['me', t('Mine')],
            ['none', t('Unassigned')],
          ].map(([k, l]) => (
            <button key={k} className={`btn ${(query.assigned ?? '') === k ? 'btn-primary' : ''}`} onClick={() => setParam({ assigned: k || null })}>
              {l}
            </button>
          ))}
        </div>
        <form
          className="searchbox-input"
          style={{ height: 40, maxWidth: 300, flex: 1 }}
          onSubmit={(e) => {
            e.preventDefault();
            setParam({ search: search.trim() || null });
          }}
        >
          <Search size={18} />
          <input placeholder={t('Subject, company, number')} value={search} onChange={(e) => setSearch(e.target.value)} style={{ border: 0, outline: 0, flex: 1 }} />
        </form>
      </div>
      {q.isLoading ? <Loading /> : <TicketsTable rows={q.data ?? []} />}
    </>
  );
}

export function AdminTicket() {
  const { id } = useParams();
  const t = useT();
  const qc = useQueryClient();
  const run = useAction();
  const nav = useNavigate();
  const me = useStaff();
  const staff = useQuery({ queryKey: ['admin-staff'], queryFn: () => adminApi.get<any[]>('/staff') });
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [impersonate, setImpersonate] = useState(false);
  const q = useQuery({ queryKey: ['admin-ticket', id], queryFn: () => adminApi.get<any>(`/tickets/${id}`), refetchInterval: 30_000 });
  const tk = q.data;
  if (!tk) return <Loading />;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-ticket', id] });
    qc.invalidateQueries({ queryKey: ['admin-tickets'] });
  };
  const send = async (status?: string) => {
    const r = await run(() => adminApi.post(`/tickets/${tk.id}/messages`, { body, internal, status: internal ? undefined : status }));
    if (r) {
      setBody('');
      refresh();
    }
  };
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          #{tk.id} {tk.subject}
          <span className={`badge-soft ${TICKET_ST[tk.status]}`}>{t(tk.status)}</span>
        </h1>
        <div className="spacer" />
        {tk.assigned_staff_id !== me.data?.id && (
          <button className="btn btn-primary btn-pill" onClick={() => run(() => adminApi.post(`/tickets/${tk.id}/take`), t('Ticket assigned to you')).then(refresh)}>
            <UserPlus /> {t('Take ticket')}
          </button>
        )}
        <button className="btn btn-pill" onClick={() => setImpersonate(true)}>
          <LogIn /> {t('Log in to the account')}
        </button>
        <button className="btn btn-outline-blue" onClick={() => nav(-1)}>
          {t('Back')}
        </button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 18 }}>
        <div>
          {tk.messages.map((m: any) => (
            <div
              key={m.id}
              className="card card-pad mb"
              style={{
                marginLeft: m.author_type === 'staff' ? 60 : 0,
                marginRight: m.author_type === 'staff' ? 0 : 60,
                background: m.internal ? '#fff8e6' : m.author_type === 'staff' ? 'var(--blue-light)' : m.author_type === 'system' ? '#f6f7f9' : '#fff',
              }}
            >
              <div className="row text-small" style={{ marginBottom: 6 }}>
                <b>{m.author_name}</b>
                {m.internal ? <span className="badge-soft orange">{t('internal note')}</span> : null}
                <span className="text-muted" style={{ marginLeft: 'auto' }}>
                  {fmtDateTime(m.created_at)}
                </span>
              </div>
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.body}</div>
            </div>
          ))}
          <div className="card card-pad">
            <textarea className="textarea" style={{ minHeight: 120 }} placeholder={internal ? t('Internal note (not visible to the client)') : t('Reply to the client...')} value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="row wrap mt-sm">
              <label className="check-label">
                <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> {t('Internal note')}
              </label>
              <div className="grow" />
              {!internal && (
                <button className="btn" disabled={!body.trim()} onClick={() => send('resolved')}>
                  {t('Send and mark resolved')}
                </button>
              )}
              <button className="btn btn-primary" disabled={!body.trim()} onClick={() => send('waiting')}>
                <Send /> {internal ? t('Save note') : t('Send')}
              </button>
            </div>
          </div>
        </div>
        <div className="card card-pad" style={{ alignSelf: 'start' }}>
          <dl className="kv" style={{ gridTemplateColumns: '110px 1fr', fontSize: 13.5 }}>
            <dt>{t('Account')}:</dt>
            <dd>
              <Link to={`/admin/accounts/${tk.account_id}`}>{tk.account_name}</Link> ({tk.plan}, {t(tk.account_status)})
            </dd>
            <dt>{t('Client')}:</dt>
            <dd>
              {tk.user_name}
              <div className="text-muted">{tk.user_email}</div>
            </dd>
            <dt>{t('Category')}:</dt>
            <dd>{t(TICKET_CATEGORIES[tk.category] ?? tk.category)}</dd>
            <dt>{t('Created')}:</dt>
            <dd>{fmtDateTime(tk.created_at)}</dd>
          </dl>
          <Field label={t('Status')}>
            <select className="select" value={tk.status} onChange={(e) => run(() => adminApi.put(`/tickets/${tk.id}`, { status: e.target.value })).then(refresh)}>
              {['new', 'open', 'waiting', 'resolved', 'closed'].map((s) => (
                <option key={s} value={s}>
                  {t(s)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Priority')}>
            <select className="select" value={tk.priority} onChange={(e) => run(() => adminApi.put(`/tickets/${tk.id}`, { priority: e.target.value })).then(refresh)}>
              {['low', 'normal', 'high', 'urgent'].map((s) => (
                <option key={s} value={s}>
                  {t(s)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Assigned')}>
            <select
              className="select"
              value={tk.assigned_staff_id ?? ''}
              onChange={(e) => run(() => adminApi.put(`/tickets/${tk.id}`, { assigned_staff_id: e.target.value ? Number(e.target.value) : null })).then(refresh)}
            >
              <option value="">—</option>
              {staff.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>
      {impersonate && <ImpersonateModal account={{ id: tk.account_id, name: tk.account_name }} onClose={() => setImpersonate(false)} />}
    </>
  );
}

export function AdminStaff() {
  const t = useT();
  const run = useAction();
  const qc = useQueryClient();
  const me = useStaff();
  const q = useQuery({ queryKey: ['admin-staff'], queryFn: () => adminApi.get<any[]>('/staff') });
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'support' });
  const [pwd, setPwd] = useState({ current_password: '', new_password: '' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-staff'] });
  const isSuper = me.data?.role === 'superadmin';
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{t('Team')}</h1>
        <div className="spacer" />
        {isSuper && (
          <button className="btn btn-primary btn-pill" onClick={() => setAdding(true)}>
            <UserPlus /> {t('Add team member')}
          </button>
        )}
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 18 }}>
        <div className="table-wrap" style={{ alignSelf: 'start' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('Name')}</th>
                <th>E-mail</th>
                <th>{t('Role')}</th>
                <th className="num">{t('Open tickets')}</th>
                <th>{t('Last login')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data?.map((s) => (
                <tr key={s.id} style={{ opacity: s.active ? 1 : 0.5 }}>
                  <td>{s.name}</td>
                  <td>{s.email}</td>
                  <td>{s.role}</td>
                  <td className="num">{s.open_tickets}</td>
                  <td>{fmtDateTime(s.last_login_at)}</td>
                  <td className="num">
                    {isSuper && s.id !== me.data?.id && (
                      <button className="btn btn-xs" onClick={() => run(() => adminApi.put(`/staff/${s.id}`, { active: !s.active })).then(refresh)}>
                        {s.active ? t('Deactivate') : t('Activate')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card card-pad" style={{ alignSelf: 'start' }}>
          <div className="card-title mb">{t('Change my password')}</div>
          <Field label={t('Current password')}>
            <input className="input" type="password" value={pwd.current_password} onChange={(e) => setPwd({ ...pwd, current_password: e.target.value })} />
          </Field>
          <Field label={t('New password')}>
            <input className="input" type="password" value={pwd.new_password} onChange={(e) => setPwd({ ...pwd, new_password: e.target.value })} />
          </Field>
          <button className="btn btn-primary" onClick={() => run(() => adminApi.put('/me/password', pwd), t('Password changed')).then(() => setPwd({ current_password: '', new_password: '' }))}>
            {t('Save')}
          </button>
        </div>
      </div>
      {adding && (
        <Modal
          title={t('Add team member')}
          onClose={() => setAdding(false)}
          footer={
            <button
              className="btn btn-primary"
              onClick={async () => {
                const r = await run(() => adminApi.post('/staff', f), t('Saved'));
                if (r) {
                  setAdding(false);
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
          <Field label={t('Password')}>
            <input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </Field>
          <Field label={t('Role')}>
            <select className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              <option value="support">support</option>
              <option value="superadmin">superadmin</option>
            </select>
          </Field>
        </Modal>
      )}
    </>
  );
}

export function AdminAudit() {
  const t = useT();
  const q = useQuery({ queryKey: ['admin-audit'], queryFn: () => adminApi.get<any[]>('/audit') });
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{t('Audit log')}</h1>
      </div>
      {q.isLoading ? <Loading /> : <AuditTable rows={q.data ?? []} />}
    </>
  );
}
