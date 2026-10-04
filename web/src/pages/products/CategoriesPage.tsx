import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { Empty, useAction, useConfirm } from '../../components/ui';
import { useT } from '../../i18n';
import { useCategories, useManufacturers } from './ProductsPage';

function ListEditor({ kind, title, rows }: { kind: 'categories' | 'manufacturers'; title: string; rows: any[] }) {
  const t = useT();
  const run = useAction();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: [kind] });
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">{title}</div>
      </div>
      <form
        className="row"
        style={{ padding: '0 20px 14px' }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const r = await run(() => api.post(`/products/meta/${kind}`, { name: name.trim() }));
          if (r) {
            setName('');
            refresh();
          }
        }}
      >
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('New name')} />
        <button className="btn btn-primary" type="submit">
          <Plus /> {t('Add')}
        </button>
      </form>
      {!rows.length ? (
        <Empty>{t('Empty list')}</Empty>
      ) : (
        <table className="tbl">
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {editing?.id === r.id ? (
                    <form
                      className="row"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const name = editing!.name;
                        const ok = await run(() => api.put(`/products/meta/${kind}/${r.id}`, { name }));
                        if (ok) {
                          setEditing(null);
                          refresh();
                        }
                      }}
                    >
                      <input className="input input-sm" value={editing!.name} onChange={(e) => setEditing({ id: r.id, name: e.target.value })} autoFocus />
                      <button className="btn btn-sm btn-primary">{t('Save')}</button>
                    </form>
                  ) : (
                    <Link to={`/products?${kind === 'categories' ? 'category_id' : 'manufacturer_id'}=${r.id}`}>{r.name}</Link>
                  )}
                </td>
                <td className="num text-muted">{t('{n} products', { n: r.product_count })}</td>
                <td className="num nowrap" style={{ width: 90 }}>
                  <button className="icon-btn" onClick={() => setEditing({ id: r.id, name: r.name })} aria-label={t('Edit')}>
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={t('Delete')}
                    onClick={async () => {
                      if (await confirm(t('Delete "{name}"?', { name: r.name }), { danger: true })) run(() => api.del(`/products/meta/${kind}/${r.id}`)).then(refresh);
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
  );
}

export default function CategoriesPage() {
  const t = useT();
  const cats = useCategories();
  const mans = useManufacturers();
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{t('Categories and manufacturers')}</h1>
      </div>
      <div className="grid grid-2">
        <ListEditor kind="categories" title={t('Categories')} rows={cats.data ?? []} />
        <ListEditor kind="manufacturers" title={t('Manufacturers')} rows={mans.data ?? []} />
      </div>
    </>
  );
}
