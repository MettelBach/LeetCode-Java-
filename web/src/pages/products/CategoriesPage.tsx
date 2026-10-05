import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { Empty, Field, Loading, Modal, Tabs, useAction, useConfirm } from '../../components/ui';
import { useT } from '../../i18n';
import { categoryOptions, useCategories, useCurrentCatalog, useExtraFields, useManufacturers, useTags, type Category } from './inventoryData';

type Tab = 'categories' | 'manufacturers' | 'tags' | 'extra';

export default function CategoriesPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'categories';
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{t('Product settings')}</h1>
      </div>
      <Tabs
        tabs={[
          { id: 'categories', label: t('Categories') },
          { id: 'manufacturers', label: t('Manufacturers') },
          { id: 'tags', label: t('Tags') },
          { id: 'extra', label: t('Extra fields') },
        ]}
        value={tab}
        onChange={(v) => setParams({ tab: v })}
      />
      {tab === 'categories' && <CategoryTreeEditor />}
      {tab === 'manufacturers' && <Manufacturers />}
      {tab === 'tags' && <TagsEditor />}
      {tab === 'extra' && <ExtraFieldsEditor />}
    </>
  );
}

function CategoryTreeEditor() {
  const t = useT();
  const qc = useQueryClient();
  const run = useAction();
  const confirm = useConfirm();
  const [catalog, selectCatalog, catalogs] = useCurrentCatalog();
  const cats = useCategories(catalog?.id);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [edit, setEdit] = useState<{ id?: number; name: string; parent_id: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['categories'] });
  const rows = cats.data ?? [];
  const byParent = useMemo(() => {
    const m = new Map<number | null, Category[]>();
    for (const r of rows) m.set(r.parent_id, [...(m.get(r.parent_id) ?? []), r]);
    return m;
  }, [rows]);
  // When editing, a category cannot be moved under itself or its subcategories.
  const forbidden = useMemo(() => {
    if (!edit?.id) return new Set<number>();
    const out = new Set<number>([edit.id]);
    const walk = (id: number) => (byParent.get(id) ?? []).forEach((c) => (out.add(c.id), walk(c.id)));
    walk(edit.id);
    return out;
  }, [edit?.id, byParent]);
  const render = (parent: number | null, depth: number): ReactNode =>
    (byParent.get(parent) ?? []).map((c) => {
      const kids = byParent.get(c.id)?.length;
      return (
        <div key={c.id}>
          <div className="tree-edit-row" style={{ paddingLeft: 12 + depth * 22 }}>
            <span className="tree-toggle" onClick={() => kids && setOpen({ ...open, [c.id]: !open[c.id] })}>
              {kids ? open[c.id] ? <ChevronDown size={16} /> : <ChevronRight size={16} /> : null}
            </span>
            <span className="grow">{c.name}</span>
            <span className="text-muted text-small" style={{ width: 90, textAlign: 'right' }}>
              {t('{n} products', { n: c.total_count })}
            </span>
            <button className="icon-btn" onClick={() => setEdit({ name: '', parent_id: String(c.id) })} aria-label={t('Add subcategory')} title={t('Add subcategory')}>
              <FolderPlus size={16} />
            </button>
            <button className="icon-btn" onClick={() => setEdit({ id: c.id, name: c.name, parent_id: c.parent_id ? String(c.parent_id) : '' })} aria-label={t('Edit')}>
              <Pencil size={16} />
            </button>
            <button
              className="icon-btn"
              aria-label={t('Delete')}
              onClick={async () => {
                if (await confirm(t('Delete category {name}? Its subcategories and products move one level up.', { name: c.name }), { danger: true }))
                  run(() => api.del(`/products/meta/categories/${c.id}`), t('Deleted')).then(() => (refresh(), qc.invalidateQueries({ queryKey: ['products'] })));
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
          {kids && open[c.id] ? render(c.id, depth + 1) : null}
        </div>
      );
    });
  return (
    <div className="card" style={{ maxWidth: 900 }}>
      <div className="card-head">
        <div className="row">
          <span className="text-muted">{t('Catalog')}:</span>
          <select className="select" style={{ width: 240 }} value={catalog?.id ?? ''} onChange={(e) => selectCatalog(Number(e.target.value))}>
            {catalogs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setOpen(Object.fromEntries(rows.map((r) => [r.id, true])))}>
            {t('Expand all')}
          </button>
          <button className="btn btn-primary" onClick={() => setEdit({ name: '', parent_id: '' })}>
            <Plus size={16} /> {t('Add category')}
          </button>
        </div>
      </div>
      {!cats.data ? <Loading /> : !rows.length ? <Empty>{t('No categories in this catalog')}</Empty> : <div className="tree-edit">{render(null, 0)}</div>}
      {edit && (
        <Modal
          title={edit.id ? t('Edit category') : t('Add category')}
          onClose={() => setEdit(null)}
          footer={
            <button
              className="btn btn-primary"
              disabled={!edit.name.trim()}
              onClick={async () => {
                const body = { name: edit.name, parent_id: edit.parent_id ? Number(edit.parent_id) : null, catalog_id: catalog?.id };
                const r = await run(() => (edit.id ? api.put(`/products/meta/categories/${edit.id}`, body) : api.post('/products/meta/categories', body)), t('Saved'));
                if (r) {
                  if (body.parent_id) setOpen({ ...open, [body.parent_id]: true });
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
            <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus />
          </Field>
          <Field label={t('Parent category')}>
            <select className="select" value={edit.parent_id} onChange={(e) => setEdit({ ...edit, parent_id: e.target.value })}>
              <option value="">{t('— main level —')}</option>
              {categoryOptions(rows)
                .filter((c) => !forbidden.has(c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
            </select>
          </Field>
        </Modal>
      )}
    </div>
  );
}

function SimpleList({ rows, onAdd, onEdit, onDelete, count, extra }: { rows: any[]; onAdd: () => void; onEdit: (r: any) => void; onDelete: (r: any) => void; count: (r: any) => number; extra?: (r: any) => ReactNode }) {
  const t = useT();
  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <div className="card-head">
        <div />
        <button className="btn btn-primary" onClick={onAdd}>
          <Plus size={16} /> {t('Add')}
        </button>
      </div>
      {!rows.length ? (
        <Empty>{t('No items')}</Empty>
      ) : (
        <table className="tbl">
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {extra?.(r)}
                  {r.name}
                </td>
                <td className="num text-muted">{t('{n} products', { n: count(r) })}</td>
                <td className="num nowrap" style={{ width: 90 }}>
                  <button className="icon-btn" onClick={() => onEdit(r)} aria-label={t('Edit')}>
                    <Pencil size={16} />
                  </button>
                  <button className="icon-btn" onClick={() => onDelete(r)} aria-label={t('Delete')}>
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

function Manufacturers() {
  const t = useT();
  const qc = useQueryClient();
  const run = useAction();
  const confirm = useConfirm();
  const mans = useManufacturers();
  const refresh = () => qc.invalidateQueries({ queryKey: ['manufacturers'] });
  return (
    <SimpleList
      rows={mans.data ?? []}
      count={(r) => r.product_count}
      onAdd={async () => {
        const name = window.prompt(t('Manufacturer name'));
        if (name?.trim()) run(() => api.post('/products/meta/manufacturers', { name }), t('Saved')).then(refresh);
      }}
      onEdit={async (r) => {
        const name = window.prompt(t('Manufacturer name'), r.name);
        if (name?.trim()) run(() => api.put(`/products/meta/manufacturers/${r.id}`, { name }), t('Saved')).then(refresh);
      }}
      onDelete={async (r) => {
        if (await confirm(t('Delete {name}?', { name: r.name }), { danger: true })) run(() => api.del(`/products/meta/manufacturers/${r.id}`), t('Deleted')).then(refresh);
      }}
    />
  );
}

function TagsEditor() {
  const t = useT();
  const qc = useQueryClient();
  const run = useAction();
  const confirm = useConfirm();
  const tags = useTags();
  const [edit, setEdit] = useState<{ id?: number; name: string; color: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['tags'] });
  return (
    <>
      <SimpleList
        rows={tags.data ?? []}
        count={(r) => r.products}
        extra={(r) => <span className="tag-dot" style={{ background: r.color }} />}
        onAdd={() => setEdit({ name: '', color: '#1271d3' })}
        onEdit={(r) => setEdit(r)}
        onDelete={async (r) => {
          if (await confirm(t('Delete {name}?', { name: r.name }), { danger: true })) run(() => api.del(`/tags/${r.id}`), t('Deleted')).then(refresh);
        }}
      />
      {edit && (
        <Modal
          title={edit.id ? t('Edit tag') : t('Add tag')}
          onClose={() => setEdit(null)}
          footer={
            <button
              className="btn btn-primary"
              disabled={!edit.name.trim()}
              onClick={async () => {
                const r = await run(() => (edit.id ? api.put(`/tags/${edit.id}`, edit) : api.post('/tags', edit)), t('Saved'));
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
              <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus maxLength={50} />
            </Field>
            <Field label={t('Colour')}>
              <input className="input" type="color" value={edit.color} onChange={(e) => setEdit({ ...edit, color: e.target.value })} style={{ height: 40, padding: 4 }} />
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}

function ExtraFieldsEditor() {
  const t = useT();
  const qc = useQueryClient();
  const run = useAction();
  const confirm = useConfirm();
  const fields = useExtraFields();
  const [edit, setEdit] = useState<{ id?: number; name: string; kind: string; options: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['extra-fields'] });
  const KINDS: Record<string, string> = { text: 'Text', textarea: 'Long text', number: 'Number', select: 'List', checkbox: 'Yes / no', date: 'Date' };
  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <div className="card-head">
        <div className="text-muted text-small">{t('Your own product fields, e.g. supplier code, warranty, shelf.')}</div>
        <button className="btn btn-primary" onClick={() => setEdit({ name: '', kind: 'text', options: '' })}>
          <Plus size={16} /> {t('Add field')}
        </button>
      </div>
      {!fields.data ? (
        <Loading />
      ) : !fields.data.length ? (
        <Empty>{t('No extra fields')}</Empty>
      ) : (
        <table className="tbl">
          <tbody>
            {fields.data.map((f) => (
              <tr key={f.id}>
                <td>
                  <b>{f.name}</b>
                </td>
                <td className="text-muted">
                  {t(KINDS[f.kind])}
                  {f.kind === 'select' && `: ${f.options.join(', ')}`}
                </td>
                <td className="num nowrap" style={{ width: 90 }}>
                  <button className="icon-btn" onClick={() => setEdit({ id: f.id, name: f.name, kind: f.kind, options: f.options.join(', ') })} aria-label={t('Edit')}>
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={t('Delete')}
                    onClick={async () => {
                      if (await confirm(t('Delete field {name}? Its values in all products will be deleted.', { name: f.name }), { danger: true }))
                        run(() => api.del(`/extra-fields/${f.id}`), t('Deleted')).then(refresh);
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
      {edit && (
        <Modal
          title={edit.id ? t('Edit field') : t('Add field')}
          onClose={() => setEdit(null)}
          footer={
            <button
              className="btn btn-primary"
              disabled={!edit.name.trim()}
              onClick={async () => {
                const body = {
                  name: edit.name,
                  kind: edit.kind,
                  options: edit.options
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean),
                };
                const r = await run(() => (edit.id ? api.put(`/extra-fields/${edit.id}`, body) : api.post('/extra-fields', body)), t('Saved'));
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
              <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus />
            </Field>
            <Field label={t('Type')}>
              <select className="select" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>
                {Object.entries(KINDS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {t(l)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {edit.kind === 'select' && (
            <Field label={t('Options (comma separated)')}>
              <input className="input" value={edit.options} onChange={(e) => setEdit({ ...edit, options: e.target.value })} />
            </Field>
          )}
        </Modal>
      )}
    </div>
  );
}
