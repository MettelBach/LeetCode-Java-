import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Bell,
  ChevronDown,
  CircleHelp,
  Gauge,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Search,
  Settings,
  ShoppingCart,
  User,
  Warehouse,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { BRAND } from '../brand';
import { useIntegrations } from '../data';
import { fmtDateTime } from '../format';
import { useI18n, useT, type Lang } from '../i18n';
import { Dropdown, LogoMark } from './ui';

interface NavGroup {
  id: string;
  icon: ReactNode;
  label: string;
  to: string;
  match: string[];
  children?: { to: string; label: string }[];
}

function useNav(): NavGroup[] {
  const t = useT();
  return [
    { id: 'home', icon: <Gauge />, label: t('Home'), to: '/', match: ['/'] },
    {
      id: 'orders',
      icon: <ShoppingCart />,
      label: t('Orders'),
      to: '/orders',
      match: ['/orders', '/returns', '/shipments', '/invoices', '/automation'],
      children: [
        { to: '/orders', label: t('Order list') },
        { to: '/orders/new', label: t('Add order') },
        { to: '/shipments', label: t('Shipments') },
        { to: '/invoices', label: t('Invoices and receipts') },
        { to: '/returns', label: t('Returns') },
        { to: '/automation', label: t('Automatic actions') },
        { to: '/settings/statuses', label: t('Order statuses') },
      ],
    },
    {
      id: 'products',
      icon: <Warehouse />,
      label: t('Products'),
      to: '/products',
      match: ['/products', '/offers'],
      children: [
        { to: '/products', label: t('Inventory') },
        { to: '/products/new', label: t('Add product') },
        { to: '/offers', label: t('Marketplace offers') },
        { to: '/products/categories', label: t('Categories and manufacturers') },
      ],
    },
    {
      id: 'integrations',
      icon: <Plug />,
      label: t('Integrations'),
      to: '/integrations',
      match: ['/integrations'],
      children: [
        { to: '/integrations', label: t('My integrations') },
        { to: '/integrations/add', label: t('Add integration') },
      ],
    },
    {
      id: 'settings',
      icon: <Settings />,
      label: t('Settings'),
      to: '/settings',
      match: ['/settings'],
      children: [
        { to: '/settings/company', label: t('Company details') },
        { to: '/settings/orders', label: t('Order settings') },
        { to: '/settings/statuses', label: t('Order statuses') },
        { to: '/settings/invoices', label: t('Invoice numbering') },
        { to: '/settings/email', label: t('E-mail templates') },
        { to: '/settings/users', label: t('Users') },
        { to: '/settings/account', label: t('My account') },
      ],
    },
    { id: 'help', icon: <CircleHelp />, label: t('Help and contact'), to: '/help', match: ['/help'] },
  ];
}

function isActive(path: string, g: NavGroup) {
  if (g.id === 'home') return path === '/';
  return g.match.some((m) => path === m || path.startsWith(m + '/'));
}

const ACC_LETTERS: Record<string, string> = { allegro: 'Al', empik: 'Em', kaufland: 'Ka' };

function Rail({ expanded }: { expanded: boolean }) {
  const nav = useNav();
  const t = useT();
  const loc = useLocation();
  const integrations = useIntegrations();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  useEffect(() => {
    const g = nav.find((n) => isActive(loc.pathname, n));
    setOpenGroup(g?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname]);
  const params = new URLSearchParams(loc.search);
  return (
    <aside className={`rail ${expanded ? 'expanded' : ''}`}>
      <Link to="/" className="rail-logo" style={{ textDecoration: 'none' }}>
        <LogoMark />
        {expanded && <span>{BRAND.name}</span>}
      </Link>
      <nav className="rail-nav">
        {nav.map((g) => {
          const active = isActive(loc.pathname, g);
          return (
            <div className="rail-group" key={g.id}>
              <Link
                to={g.to}
                className={`rail-item ${active ? 'active' : ''}`}
                title={expanded ? undefined : g.label}
                onClick={(e) => {
                  if (expanded && g.children) {
                    e.preventDefault();
                    setOpenGroup((o) => (o === g.id ? null : g.id));
                  }
                }}
              >
                {g.icon}
                <span className="rail-label">{g.label}</span>
                {expanded && g.children && <ChevronDown size={16} style={{ transform: openGroup === g.id ? 'rotate(180deg)' : undefined }} />}
              </Link>
              {g.children && (
                <>
                  <div className="flyout">
                    <div className="flyout-title">{g.label}</div>
                    {g.children.map((c) => (
                      <NavLink key={c.to} to={c.to} end className={({ isActive: a }) => (a ? 'active' : '')}>
                        {c.label}
                      </NavLink>
                    ))}
                  </div>
                  <div className={`subnav ${openGroup === g.id ? 'open' : ''}`}>
                    {g.children.map((c) => (
                      <NavLink key={c.to} to={c.to} end className={({ isActive: a }) => (a ? 'active' : '')}>
                        {c.label}
                      </NavLink>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </nav>
      {!!integrations.data?.length && (
        <div className="rail-section">
          <div className="rail-section-title">{t('Marketplace')}</div>
          <Link to="/offers" className={`rail-account ${loc.pathname === '/offers' && !params.get('integration_id') ? 'active' : ''}`} title={t('All offers')}>
            <span className="rail-account-box">All</span>
            <span className="name">{t('All offers')}</span>
          </Link>
          {integrations.data.map((i) => (
            <Link
              key={i.id}
              to={`/offers?integration_id=${i.id}`}
              className={`rail-account ${params.get('integration_id') === String(i.id) ? 'active' : ''}`}
              title={i.name}
            >
              <span className="rail-account-box">{ACC_LETTERS[i.type]}</span>
              <span className="name">{i.name}</span>
            </Link>
          ))}
        </div>
      )}
    </aside>
  );
}

function GlobalSearch() {
  const t = useT();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const res = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get<{ orders: any[]; products: any[] }>('/search', { q: debounced }),
    enabled: debounced.length >= 2,
  });
  const submit = () => {
    if (!q.trim()) return;
    setOpen(false);
    nav(`/orders?search=${encodeURIComponent(q.trim())}`);
  };
  return (
    <div className="searchbox" ref={ref}>
      <div className="searchbox-input">
        <Search size={20} />
        <input
          placeholder={t('Search...')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          aria-label={t('Search')}
        />
        <button className="icon-btn" onClick={submit} aria-label={t('Search')}>
          <ArrowRight size={20} />
        </button>
      </div>
      {open && debounced.length >= 2 && res.data && (
        <div className="search-results">
          {!res.data.orders.length && !res.data.products.length && <div className="text-muted" style={{ padding: '10px 16px' }}>{t('Nothing found')}</div>}
          {!!res.data.orders.length && <h4>{t('Orders')}</h4>}
          {res.data.orders.map((o) => (
            <Link key={o.id} to={`/orders/${o.id}`} onClick={() => setOpen(false)}>
              <b style={{ color: 'var(--blue-text)' }}>{o.id}</b>
              <span className="grow">{o.delivery_fullname || o.email}</span>
              <span className="badge" style={{ background: o.status_color }}>
                {o.status_name}
              </span>
            </Link>
          ))}
          {!!res.data.products.length && <h4>{t('Products')}</h4>}
          {res.data.products.map((p) => (
            <Link key={p.id} to={`/products/${p.parent_id ?? p.id}`} onClick={() => setOpen(false)}>
              <span className="grow">{p.name}</span>
              <span className="text-muted text-small">{p.sku}</span>
              <span className="text-small">{p.stock} {t('pcs')}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const t = useT();
  const qc = useQueryClient();
  const n = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<{ rows: any[]; unread: number }>('/notifications'), refetchInterval: 60_000 });
  return (
    <Dropdown
      align="right"
      trigger={(_o, toggle) => (
        <button
          className="icon-btn bell"
          aria-label={t('Notifications')}
          onClick={() => {
            toggle();
            if (n.data?.unread) api.post('/notifications/read').then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
          }}
        >
          <Bell size={21} />
          <span className={`dot ${n.data?.unread ? 'on' : ''}`} />
        </button>
      )}
    >
      {(close) => (
        <div style={{ width: 340 }}>
          <div className="dd-head">{t('Notifications')}</div>
          {!n.data?.rows.length && <div className="text-muted" style={{ padding: '10px 16px' }}>{t('No notifications')}</div>}
          {n.data?.rows.slice(0, 12).map((r) => (
            <Link key={r.id} to={r.link || '#'} className="dd-item" onClick={close} style={{ whiteSpace: 'normal', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: r.is_read ? 400 : 600 }}>{r.message}</div>
                <div className="text-muted text-small">{fmtDateTime(r.created_at)}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Dropdown>
  );
}

function QuickAccess() {
  const t = useT();
  const nav = useNavigate();
  return (
    <Dropdown
      trigger={(_o, toggle) => (
        <button className="quick-access" onClick={toggle}>
          <span>{t('Quick access')}</span>
          <ChevronDown size={18} />
        </button>
      )}
    >
      {(close) => (
        <>
          {[
            ['/orders/new', t('Add order')],
            ['/products/new', t('Add product')],
            ['/orders?status=to_send', t('Orders to send')],
            ['/shipments', t('Shipments')],
            ['/invoices', t('Invoices and receipts')],
            ['/returns?new=1', t('New return')],
            ['/integrations', t('Integrations')],
            ['/automation', t('Automatic actions')],
          ].map(([to, label]) => (
            <button
              key={to}
              className="dd-item"
              onClick={() => {
                close();
                nav(to);
              }}
            >
              {label}
            </button>
          ))}
        </>
      )}
    </Dropdown>
  );
}

function UserMenu() {
  const t = useT();
  const { user, logout } = useAuth();
  const { lang, setLang } = useI18n();
  const nav = useNavigate();
  const changeLang = (l: Lang) => {
    setLang(l);
    api.put('/auth/me', { language: l }).catch(() => undefined);
  };
  return (
    <Dropdown
      align="right"
      trigger={(_o, toggle) => (
        <button className="user-btn" onClick={toggle}>
          <span className="avatar">{(user?.name ?? '?').slice(0, 1).toUpperCase()}</span>
          <span className="name">{user?.name}</span>
          <ChevronDown size={16} />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="dd-head">{user?.email}</div>
          <button className="dd-item" onClick={() => (close(), nav('/settings/account'))}>
            <User /> {t('My account')}
          </button>
          <button className="dd-item" onClick={() => (close(), nav('/settings/company'))}>
            <Settings /> {t('Settings')}
          </button>
          <div className="dd-sep" />
          <div className="dd-head">{t('Language')}</div>
          {(
            [
              ['pl', 'Polski'],
              ['en', 'English'],
              ['ru', 'Русский'],
            ] as [Lang, string][]
          ).map(([l, label]) => (
            <button key={l} className="dd-item" onClick={() => changeLang(l)} style={{ fontWeight: lang === l ? 700 : 400 }}>
              {label}
            </button>
          ))}
          <div className="dd-sep" />
          <button
            className="dd-item danger"
            onClick={() => {
              close();
              logout();
              nav('/login');
            }}
          >
            <LogOut /> {t('Log out')}
          </button>
        </>
      )}
    </Dropdown>
  );
}

export function Layout() {
  const t = useT();
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem('sellhub_rail') === '1';
    } catch {
      return false;
    }
  });
  const loc = useLocation();
  useEffect(() => {
    // On phones the expanded menu overlays the page, close it after navigation.
    if (window.innerWidth < 700) setExpanded(false);
  }, [loc.pathname]);
  const toggle = () => {
    setExpanded((e) => {
      try {
        localStorage.setItem('sellhub_rail', e ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !e;
    });
  };
  return (
    <div className={`app ${expanded ? 'rail-open' : ''}`}>
      <Rail expanded={expanded} />
      <div className="main">
        <header className="topbar">
          <button className="icon-btn" onClick={toggle} aria-label={t('Toggle menu')}>
            {expanded ? <PanelLeftClose size={26} strokeWidth={1.5} /> : <PanelLeftOpen size={26} strokeWidth={1.5} />}
          </button>
          <QuickAccess />
          <GlobalSearch />
          <div className="topbar-right">
            <Link to="/help" className="icon-btn" aria-label={t('Help')}>
              <CircleHelp size={26} strokeWidth={1.8} />
            </Link>
            <Notifications />
            <UserMenu />
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
