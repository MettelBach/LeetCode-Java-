import { useQueryClient } from '@tanstack/react-query';
import { Archive, ChevronDown, ChevronUp, Inbox, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStatuses, type Status } from '../../data';
import { useT } from '../../i18n';

export function AddOrderButton() {
  const t = useT();
  return (
    <Link to="/orders/new" className="btn-add-order">
      <span className="plus">
        <Plus size={22} strokeWidth={2.4} />
      </span>
      <span className="label">{t('Add order')}</span>
    </Link>
  );
}

function readCollapsed(): number[] {
  try {
    return JSON.parse(localStorage.getItem('sellhub_groups') ?? '[]');
  } catch {
    return [];
  }
}

export function StatusColumn({ current, view, onPick }: { current: number | null; view: string; onPick: (p: { status?: number | null; view?: string }) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { data } = useStatuses();
  const [collapsed, setCollapsed] = useState<number[]>(readCollapsed);
  const toggleGroup = (id: number) => {
    const next = collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id];
    setCollapsed(next);
    try {
      localStorage.setItem('sellhub_groups', JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  if (!data) return null;
  const counts = data.counts.by_status;
  const row = (s: Status) => {
    const n = counts[s.id] ?? 0;
    return (
      <a
        key={s.id}
        href={`/orders?status=${s.id}`}
        className={`status-row ${view === 'active' && current === s.id ? 'active' : ''}`}
        onClick={(e) => {
          e.preventDefault();
          onPick({ status: s.id, view: 'active' });
        }}
      >
        <span className="count-box" style={{ background: s.color }}>
          {n || '-'}
        </span>
        <span>{s.name}</span>
      </a>
    );
  };
  const ungrouped = data.statuses.filter((s) => !s.group_id || !data.groups.some((g) => g.id === s.group_id));
  return (
    <div className="status-col">
      <AddOrderButton />
      <div className="status-list">
        <a
          href="/orders"
          className={`status-row all ${view === 'active' && !current ? 'active' : ''}`}
          onClick={(e) => {
            e.preventDefault();
            onPick({ status: null, view: 'active' });
          }}
        >
          <Inbox size={18} />
          <span>{t('All')}</span>
          <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 13 }}>
            {data.counts.all}
          </span>
        </a>
        {ungrouped.map(row)}
        {data.groups.map((g) => {
          const items = data.statuses.filter((s) => s.group_id === g.id);
          if (!items.length) return null;
          const isCollapsed = collapsed.includes(g.id);
          const total = items.reduce((s, x) => s + (counts[x.id] ?? 0), 0);
          return (
            <div key={g.id}>
              <div className="status-group-title" onClick={() => toggleGroup(g.id)}>
                {g.name} {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                {isCollapsed && <span className="text-muted" style={{ marginLeft: 'auto', fontWeight: 400, fontSize: 13 }}>{total}</span>}
              </div>
              {!isCollapsed && items.map(row)}
            </div>
          );
        })}
        <div className="status-sep" />
        <a
          href="/orders?view=archive"
          className={`status-row ${view === 'archive' ? 'active' : ''}`}
          onClick={(e) => {
            e.preventDefault();
            onPick({ status: null, view: 'archive' });
          }}
        >
          <Archive size={17} />
          <span>{t('Archive')}</span>
          <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 13 }}>{data.counts.archive || ''}</span>
        </a>
        <a
          href="/orders?view=bin"
          className={`status-row ${view === 'bin' ? 'active' : ''}`}
          onClick={(e) => {
            e.preventDefault();
            onPick({ status: null, view: 'bin' });
          }}
        >
          <Trash2 size={17} />
          <span>{t('Bin')}</span>
          <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 13 }}>{data.counts.bin || ''}</span>
        </a>
        <div className="status-sep" />
        <div className="status-footer">
          <Link to="/settings/statuses" style={{ color: 'inherit' }}>
            + {t('Add status')}
          </Link>
          <button
            className="icon-btn"
            title={t('Refresh')}
            onClick={() => {
              qc.invalidateQueries({ queryKey: ['statuses'] });
              qc.invalidateQueries({ queryKey: ['orders'] });
            }}
          >
            <RefreshCw size={19} />
          </button>
        </div>
      </div>
    </div>
  );
}
