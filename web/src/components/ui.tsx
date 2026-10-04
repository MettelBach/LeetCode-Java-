import { ChevronLeft, ChevronRight, Inbox, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n';

/* ---------------------------------- Modal ---------------------------------- */

export function Modal({
  title,
  onClose,
  children,
  footer,
  size,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'lg' | 'xl';
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size ?? ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* --------------------------------- Dropdown --------------------------------- */

export function Dropdown({
  trigger,
  children,
  align = 'left',
  up,
  className = '',
}: {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'left' | 'right';
  up?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div className={`dd ${className}`} ref={ref}>
      {trigger(open, () => setOpen((o) => !o))}
      {open && (
        <div className={`dd-menu ${align === 'right' ? 'right' : ''} ${up ? 'up' : ''}`} onClick={(e) => e.stopPropagation()}>
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export function DdItem({
  icon,
  children,
  onClick,
  danger,
  disabled,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button className={`dd-item ${danger ? 'danger' : ''}`} onClick={onClick} disabled={disabled} style={disabled ? { opacity: 0.5 } : undefined}>
      {icon}
      {children}
    </button>
  );
}

/* ---------------------------------- Toasts ---------------------------------- */

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-4), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

/** Wraps an async action: shows an error toast on failure. */
export function useAction() {
  const toast = useToast();
  return useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const r = await fn();
        if (success) toast(success, 'success');
        return r;
      } catch (e: any) {
        toast(e?.message ?? String(e), 'error');
        return undefined;
      }
    },
    [toast],
  );
}

/* --------------------------------- Confirm --------------------------------- */

const ConfirmCtx = createContext<(text: string, opts?: { danger?: boolean; okText?: string }) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [state, setState] = useState<{ text: string; danger?: boolean; okText?: string; resolve: (v: boolean) => void } | null>(null);
  const confirm = useCallback(
    (text: string, opts?: { danger?: boolean; okText?: string }) => new Promise<boolean>((resolve) => setState({ text, ...opts, resolve })),
    [],
  );
  const done = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <Modal
          title={t('Confirm')}
          onClose={() => done(false)}
          footer={
            <>
              <button className="btn" onClick={() => done(false)}>
                {t('Cancel')}
              </button>
              <button className={`btn ${state.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => done(true)} autoFocus>
                {state.okText ?? t('OK')}
              </button>
            </>
          }
        >
          <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{state.text}</p>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmCtx);
}

/* ------------------------------- small pieces ------------------------------- */

export function Loading() {
  return (
    <div className="loading">
      <span className="spinner" />
    </div>
  );
}

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      {icon ?? <Inbox />}
      <div>{children}</div>
    </div>
  );
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export function Pager({
  page,
  perPage,
  total,
  onPage,
}: {
  page: number;
  perPage: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const t = useT();
  const from = total ? (page - 1) * perPage + 1 : 0;
  const to = Math.min(total, page * perPage);
  const last = Math.max(1, Math.ceil(total / perPage));
  return (
    <div className="pager">
      <span>
        <b>
          {from}-{to}
        </b>{' '}
        {t('of {n} items', { n: total })}
      </span>
      <span className="row" style={{ gap: 6 }}>
        <button className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('Previous page')}>
          <ChevronLeft />
        </button>
        <button className="btn" disabled={page >= last} onClick={() => onPage(page + 1)} aria-label={t('Next page')}>
          <ChevronRight />
        </button>
      </span>
    </div>
  );
}

export function StatusBadge({ name, color }: { name: string; color: string }) {
  return (
    <span className="badge" style={{ background: color }}>
      {name}
    </span>
  );
}

const SOURCE_LETTER: Record<string, string> = { allegro: 'A', empik: 'E', kaufland: 'K', manual: '' };

export function SourceIcon({ source }: { source: string }) {
  return <span className={`source-ico ${source}`}>{SOURCE_LETTER[source] ?? source.slice(0, 1).toUpperCase()}</span>;
}

export const MP_NAMES: Record<string, string> = { allegro: 'Allegro', empik: 'Empik', kaufland: 'Kaufland' };

export function MarketplaceLogo({ type, size = 54 }: { type: string; size?: number }) {
  const label = type === 'allegro' ? 'allegro' : type === 'empik' ? 'empik' : 'K';
  return (
    <span className={`mp-logo ${type}`} style={{ width: size, height: size, fontSize: type === 'kaufland' ? size * 0.45 : size * 0.24 }}>
      {label}
    </span>
  );
}

export function Field({ label, children, help, className = '' }: { label?: ReactNode; children: ReactNode; help?: ReactNode; className?: string }) {
  return (
    <div className={`field ${className}`}>
      {label && <label>{label}</label>}
      {children}
      {help && <span className="help-text">{help}</span>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs">
      {tabs.map((tb) => (
        <button key={tb.id} className={`tab ${value === tb.id ? 'active' : ''}`} onClick={() => onChange(tb.id)}>
          {tb.label}
        </button>
      ))}
    </div>
  );
}

/** Logo mark used in the rail and auth screens. */
export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="11" cy="21" r="7" fill="#3d8af7" />
      <circle cx="22.5" cy="8.5" r="5" fill="#3d8af7" />
      <path d="M14.5 17.5l5-5" stroke="#3d8af7" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}
