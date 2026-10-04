import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, ChevronRight, LifeBuoy, Mail, MessageSquarePlus, Phone, Search, Send, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { Empty, Field, Loading, useAction } from '../../components/ui';
import { fmtDateTime } from '../../format';
import { useI18n, useT } from '../../i18n';
import { ARTICLES, KB_CATEGORIES } from './kb';

export const TICKET_STATUS: Record<string, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'blue' },
  open: { label: 'In progress', cls: 'orange' },
  waiting: { label: 'Waiting for your reply', cls: 'green' },
  resolved: { label: 'Resolved', cls: '' },
  closed: { label: 'Closed', cls: '' },
};

export const TICKET_CATEGORIES: Record<string, string> = {
  orders: 'Orders',
  integrations: 'Integrations',
  products: 'Products and inventory',
  shipping: 'Shipping',
  invoices: 'Invoices',
  billing: 'Billing',
  bug: 'Bug report',
  other: 'Other',
};

const CONTACT = {
  email: import.meta.env.VITE_SUPPORT_EMAIL ?? 'pomoc@sellhub.pl',
  phone: import.meta.env.VITE_SUPPORT_PHONE ?? '+48 22 000 00 00',
  hours: import.meta.env.VITE_SUPPORT_HOURS ?? 'pn.–pt. 8:00–18:00',
};

export default function HelpPage() {
  const t = useT();
  const { lang } = useI18n();
  const [q, setQ] = useState('');
  const tickets = useQuery({ queryKey: ['tickets'], queryFn: () => api.get<any[]>('/support/tickets') });
  const found = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return ARTICLES.filter((a) => a.title[lang].toLowerCase().includes(s) || a.body[lang].toLowerCase().includes(s));
  }, [q, lang]);
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{t('Help and contact')}</h1>
        <div className="spacer" />
        <Link to="/help/tickets/new" className="btn btn-primary btn-pill" style={{ height: 44, padding: '0 22px' }}>
          <MessageSquarePlus /> {t('Contact support')}
        </Link>
      </div>
      <div className="card card-pad mb" style={{ background: 'linear-gradient(135deg, #1271d3, #0d5fb3)', color: '#fff' }}>
        <div style={{ fontSize: 22, fontWeight: 300, marginBottom: 12 }}>{t('How can we help you?')}</div>
        <div className="searchbox-input" style={{ maxWidth: 620, background: '#fff' }}>
          <Search size={20} />
          <input placeholder={t('Search the knowledge base...')} value={q} onChange={(e) => setQ(e.target.value)} style={{ color: '#3d4249' }} />
        </div>
        {q && (
          <div className="card mt-sm" style={{ maxWidth: 620, color: 'var(--text)' }}>
            {!found.length && <div className="text-muted" style={{ padding: 14 }}>{t('Nothing found — contact support, we will help.')}</div>}
            {found.map((a) => (
              <Link key={a.slug} to={`/help/article/${a.slug}`} className="todo-row" style={{ borderTop: 0 }}>
                <BookOpen size={17} /> {a.title[lang]}
              </Link>
            ))}
          </div>
        )}
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 18 }}>
        <div className="grid grid-2" style={{ alignContent: 'start' }}>
          {(Object.keys(KB_CATEGORIES) as (keyof typeof KB_CATEGORIES)[]).map((c) => {
            const list = ARTICLES.filter((a) => a.category === c);
            if (!list.length) return null;
            return (
              <div key={c} className="card">
                <div className="card-head">
                  <div className="card-title" style={{ fontSize: 17 }}>
                    <BookOpen size={18} color="var(--blue)" /> {KB_CATEGORIES[c][lang]}
                  </div>
                </div>
                {list.map((a) => (
                  <Link key={a.slug} to={`/help/article/${a.slug}`} className="todo-row">
                    <span>{a.title[lang]}</span>
                    <ChevronRight size={16} style={{ marginLeft: 'auto', color: '#b9bec4' }} />
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
        <div>
          <div className="card card-pad mb">
            <div className="card-title mb">
              <LifeBuoy size={20} color="var(--blue)" /> {t('Contact')}
            </div>
            <p className="row" style={{ gap: 8 }}>
              <Mail size={16} /> <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
            </p>
            <p className="row" style={{ gap: 8 }}>
              <Phone size={16} /> <a href={`tel:${CONTACT.phone.replace(/\s/g, '')}`}>{CONTACT.phone}</a>
            </p>
            <p className="text-muted">{CONTACT.hours}</p>
            <Link to="/help/tickets/new" className="btn btn-primary" style={{ width: '100%' }}>
              {t('Create a ticket')}
            </Link>
          </div>
          <div className="card">
            <div className="card-head">
              <div className="card-title">{t('My tickets')}</div>
            </div>
            {!tickets.data?.length ? (
              <div className="text-muted" style={{ padding: '0 20px 20px' }}>
                {t('You have no tickets yet.')}
              </div>
            ) : (
              tickets.data.map((tk) => (
                <Link key={tk.id} to={`/help/tickets/${tk.id}`} className="todo-row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: tk.last_author === 'staff' && tk.status === 'waiting' ? 700 : 400 }}>
                      #{tk.id} {tk.subject}
                    </div>
                    <div className="text-muted text-small">{fmtDateTime(tk.last_message_at)}</div>
                  </div>
                  <span className={`badge-soft ${TICKET_STATUS[tk.status]?.cls}`} style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                    {t(TICKET_STATUS[tk.status]?.label ?? tk.status)}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export function ArticlePage() {
  const { slug } = useParams();
  const t = useT();
  const { lang } = useI18n();
  const a = ARTICLES.find((x) => x.slug === slug);
  if (!a) return <Empty>{t('Article not found')}</Empty>;
  const related = ARTICLES.filter((x) => x.category === a.category && x.slug !== a.slug);
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{a.title[lang]}</h1>
        <div className="spacer" />
        <Link to="/help" className="btn btn-outline-blue">
          <Undo2 size={18} /> {t('Help center')}
        </Link>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 18 }}>
        <div className="card card-pad" style={{ whiteSpace: 'pre-line', lineHeight: 1.75, fontSize: 15 }}>
          {a.body[lang]}
          <div className="mt" style={{ borderTop: '1px solid var(--border-light)', paddingTop: 14 }}>
            {t('Did not find the answer?')} <Link to="/help/tickets/new">{t('Contact support')}</Link>
          </div>
        </div>
        {!!related.length && (
          <div className="card" style={{ alignSelf: 'start' }}>
            <div className="card-head">
              <div className="card-title" style={{ fontSize: 16 }}>
                {t('Related articles')}
              </div>
            </div>
            {related.map((r) => (
              <Link key={r.slug} to={`/help/article/${r.slug}`} className="todo-row">
                {r.title[lang]}
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function NewTicketPage() {
  const t = useT();
  const nav = useNavigate();
  const run = useAction();
  const qc = useQueryClient();
  const [f, setF] = useState({ subject: '', category: 'orders', priority: 'normal', body: '' });
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{t('Contact support')}</h1>
        <div className="spacer" />
        <Link to="/help" className="btn btn-outline-blue">
          <Undo2 size={18} /> {t('Help center')}
        </Link>
      </div>
      <div className="card card-pad" style={{ maxWidth: 760 }}>
        <div className="form-grid">
          <Field label={t('Category')}>
            <select className="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {Object.entries(TICKET_CATEGORIES).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Priority')}>
            <select className="select" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
              <option value="low">{t('Low')}</option>
              <option value="normal">{t('Normal')}</option>
              <option value="high">{t('High')}</option>
              <option value="urgent">{t('Urgent — sales are blocked')}</option>
            </select>
          </Field>
          <Field label={t('Subject')} className="full">
            <input className="input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} maxLength={200} autoFocus />
          </Field>
          <Field label={t('Describe the problem')} className="full" help={t('Add order numbers, offer IDs and what you expected — it speeds up the answer.')}>
            <textarea className="textarea" style={{ minHeight: 180 }} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
          </Field>
        </div>
        <button
          className="btn btn-primary"
          disabled={f.subject.trim().length < 3 || f.body.trim().length < 5}
          onClick={async () => {
            const r = await run(() => api.post('/support/tickets', f), t('Ticket sent'));
            if (r) {
              qc.invalidateQueries({ queryKey: ['tickets'] });
              nav(`/help/tickets/${r.id}`);
            }
          }}
        >
          <Send /> {t('Send')}
        </button>
      </div>
    </>
  );
}

export function TicketPage() {
  const { id } = useParams();
  const t = useT();
  const run = useAction();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const q = useQuery({ queryKey: ['ticket', id], queryFn: () => api.get<any>(`/support/tickets/${id}`), refetchInterval: 30_000 });
  const tk = q.data;
  if (q.isLoading) return <Loading />;
  if (!tk) return <Empty>{t('Ticket not found')}</Empty>;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ticket', id] });
    qc.invalidateQueries({ queryKey: ['tickets'] });
  };
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          #{tk.id} {tk.subject}
          <span className={`badge-soft ${TICKET_STATUS[tk.status]?.cls}`}>{t(TICKET_STATUS[tk.status]?.label ?? tk.status)}</span>
        </h1>
        <div className="spacer" />
        {tk.status !== 'closed' && (
          <button className="btn btn-pill" onClick={() => run(() => api.post(`/support/tickets/${tk.id}/close`), t('Ticket closed')).then(refresh)}>
            {t('Close ticket')}
          </button>
        )}
        <Link to="/help" className="btn btn-outline-blue">
          <Undo2 size={18} /> {t('Help center')}
        </Link>
      </div>
      <div style={{ maxWidth: 860 }}>
        {tk.messages.map((m: any) => (
          <div
            key={m.id}
            className="card card-pad mb"
            style={{
              marginLeft: m.author_type === 'user' ? 60 : 0,
              marginRight: m.author_type === 'user' ? 0 : 60,
              background: m.author_type === 'staff' ? 'var(--blue-light)' : m.author_type === 'system' ? '#f6f7f9' : '#fff',
            }}
          >
            <div className="row text-small mb" style={{ marginBottom: 6 }}>
              <b>{m.author_type === 'staff' ? `${m.author_name} (${t('Support')})` : m.author_name}</b>
              <span className="text-muted" style={{ marginLeft: 'auto' }}>
                {fmtDateTime(m.created_at)}
              </span>
            </div>
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.body}</div>
          </div>
        ))}
        {tk.status !== 'closed' ? (
          <div className="card card-pad">
            <textarea className="textarea" placeholder={t('Write a reply...')} value={body} onChange={(e) => setBody(e.target.value)} />
            <button
              className="btn btn-primary mt-sm"
              disabled={!body.trim()}
              onClick={async () => {
                const r = await run(() => api.post(`/support/tickets/${tk.id}/messages`, { body }));
                if (r) {
                  setBody('');
                  refresh();
                }
              }}
            >
              <Send /> {t('Send')}
            </button>
          </div>
        ) : (
          <p className="text-muted">
            {t('The ticket is closed.')} <Link to="/help/tickets/new">{t('Create a new ticket')}</Link>
          </p>
        )}
      </div>
    </>
  );
}
