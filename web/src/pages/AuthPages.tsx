import { getAttribution } from '../attribution';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { BRAND } from '../brand';
import { Field, LogoMark } from '../components/ui';
import { fmtDateTime, money } from '../format';
import { useI18n, useT, type Lang } from '../i18n';

function LangSwitch() {
  const { lang, setLang } = useI18n();
  return (
    <div className="row" style={{ justifyContent: 'center', gap: 6, marginTop: 16 }}>
      {(['pl', 'en', 'ru'] as Lang[]).map((l) => (
        <button key={l} className="btn-link" style={{ fontWeight: lang === l ? 700 : 400, color: lang === l ? undefined : '#8a9199' }} onClick={() => setLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function AuthShell({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="logo">
          <LogoMark size={38} /> {BRAND.name}
        </div>
        <h2 style={{ fontSize: 20, marginBottom: 18, fontWeight: 600 }}>{title}</h2>
        {children}
        <LangSwitch />
      </div>
    </div>
  );
}

export function LoginPage() {
  const t = useT();
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const cfg = useQuery({ queryKey: ['auth-config'], queryFn: () => api.get<any>('/auth/config') });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.post('/auth/login', { email, password });
      await login(r.token);
      nav('/');
    } catch (err: any) {
      setError(t(err.message));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title={t('Log in to your account')}>
      <form onSubmit={submit}>
        <Field label={t('E-mail')}>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required autoComplete="username" />
        </Field>
        <Field label={t('Password')}>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </Field>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary" style={{ width: '100%', height: 44 }} disabled={busy}>
          {t('Log in')}
        </button>
      </form>
      <div className="row mt" style={{ justifyContent: 'space-between' }}>
        <Link to="/forgot-password">{t('Forgot password?')}</Link>
        {cfg.data?.allow_signup && <Link to="/register">{t('Create an account')}</Link>}
      </div>
    </AuthShell>
  );
}

export function RegisterPage() {
  const t = useT();
  const { lang } = useI18n();
  const { login } = useAuth();
  const nav = useNavigate();
  const cfg = useQuery({ queryKey: ['auth-config'], queryFn: () => api.get<any>('/auth/config') });
  const [f, setF] = useState({ company: '', name: '', email: '', phone: '', password: '', demo: true, accept: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.accept) return setError(t('You must accept the terms of service'));
    setBusy(true);
    setError('');
    try {
      const r = await api.post('/auth/register', {
        attribution: getAttribution(),
        company: f.company,
        name: f.name,
        email: f.email,
        phone: f.phone || undefined,
        password: f.password,
        language: lang,
        demo: f.demo,
        accept_terms: true,
      });
      await login(r.token);
      nav('/');
    } catch (err: any) {
      setError(t(err.message));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title={t('Start a free {n}-day trial', { n: cfg.data?.trial_days ?? 14 })}>
      <form onSubmit={submit}>
        <Field label={t('Company / store name')}>
          <input className="input" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} required autoFocus />
        </Field>
        <Field label={t('Your name')}>
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoComplete="name" />
        </Field>
        <Field label={t('E-mail')}>
          <input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoComplete="email" />
        </Field>
        <Field label={t('Phone (optional)')}>
          <input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" />
        </Field>
        <Field label={t('Password')} help={t('At least 8 characters')}>
          <input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={8} autoComplete="new-password" />
        </Field>
        <label className="check-label mb">
          <input type="checkbox" checked={f.demo} onChange={(e) => setF({ ...f, demo: e.target.checked })} /> {t('Fill the account with sample data (demo marketplaces, products, orders)')}
        </label>
        <label className="check-label mb">
          <input type="checkbox" checked={f.accept} onChange={(e) => setF({ ...f, accept: e.target.checked })} />
          <span>
            {t('I accept the')} <Link to="/terms" target="_blank">{t('terms of service')}</Link> {t('and the')} <Link to="/privacy" target="_blank">{t('privacy policy')}</Link>
          </span>
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary" style={{ width: '100%', height: 44 }} disabled={busy}>
          {busy ? t('Creating account...') : t('Create account')}
        </button>
      </form>
      <div className="mt" style={{ textAlign: 'center' }}>
        {t('Already have an account?')} <Link to="/login">{t('Log in')}</Link>
      </div>
    </AuthShell>
  );
}

export function ForgotPage() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  return (
    <AuthShell title={t('Reset password')}>
      {sent ? (
        <p>{t('If the address exists in our system, we have sent a link to reset the password. Check your inbox.')}</p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.post('/auth/forgot', { email });
              setSent(true);
            } catch (err: any) {
              setError(t(err.message));
            }
          }}
        >
          <Field label={t('E-mail')}>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary" style={{ width: '100%', height: 44 }}>
            {t('Send link')}
          </button>
        </form>
      )}
      <div className="mt" style={{ textAlign: 'center' }}>
        <Link to="/login">{t('Back to login')}</Link>
      </div>
    </AuthShell>
  );
}

export function ResetPage() {
  const t = useT();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  return (
    <AuthShell title={t('Set a new password')}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.post('/auth/reset', { token: params.get('token') ?? '', password });
            nav('/login');
          } catch (err: any) {
            setError(t(err.message));
          }
        }}
      >
        <Field label={t('New password')} help={t('At least 8 characters')}>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoFocus autoComplete="new-password" />
        </Field>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary" style={{ width: '100%', height: 44 }}>
          {t('Save')}
        </button>
      </form>
    </AuthShell>
  );
}

/** Page for the buyer (link from e-mails): order status and tracking. */
export function PublicOrderPage() {
  const t = useT();
  const { account, id, token } = useParams();
  const q = useQuery({ queryKey: ['public-order', account, id, token], queryFn: () => api.get<any>(`/public/order/${account}/${id}/${token}`), retry: false });
  const o = q.data;
  return (
    <div className="auth-page" style={{ alignItems: 'flex-start', paddingTop: 50 }}>
      <div className="auth-card" style={{ maxWidth: 640 }}>
        {q.isLoading ? (
          <div className="loading">
            <span className="spinner" />
          </div>
        ) : !o ? (
          <p>{t('Order not found')}</p>
        ) : (
          <>
            <div className="text-muted">{o.company.name}</div>
            <h2 style={{ fontSize: 24, margin: '6px 0 4px' }}>
              {t('Order')} {o.id}
            </h2>
            <div className="text-muted mb">{fmtDateTime(o.date_add)}</div>
            <div className="mb">
              <span className="badge" style={{ background: o.status.color, fontSize: 14, padding: '4px 10px' }}>
                {o.status.name}
              </span>
            </div>
            <table className="tbl mb">
              <tbody>
                {o.items.map((i: any, idx: number) => (
                  <tr key={idx}>
                    <td>
                      {i.quantity} × {i.name}
                    </td>
                    <td className="num">{money(i.price * i.quantity, o.currency)}</td>
                  </tr>
                ))}
                <tr>
                  <td>{o.delivery_method}</td>
                  <td className="num">{money(o.delivery_price, o.currency)}</td>
                </tr>
                <tr>
                  <td>
                    <b>{t('Total')}</b>
                  </td>
                  <td className="num">
                    <b>{money(o.total, o.currency)}</b>
                  </td>
                </tr>
              </tbody>
            </table>
            <p>
              <b>{t('Delivery address')}:</b> {o.delivery.fullname}, {o.delivery.address}, {o.delivery.postcode} {o.delivery.city}
              {o.delivery.point && (
                <>
                  <br />
                  <b>{t('Pickup point')}:</b> {o.delivery.point}
                </>
              )}
            </p>
            <p>
              <b>{t('Payment')}:</b> {o.payment_method} — {o.paid_amount >= o.total ? t('paid') : t('awaiting payment')}
            </p>
            {o.shipments.map((s: any, i: number) => (
              <p key={i}>
                <b>{t('Tracking number')}:</b> {s.tracking_number}
              </p>
            ))}
            {(o.company.email || o.company.phone) && (
              <p className="text-muted">
                {t('Questions?')} {o.company.email} {o.company.phone}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
