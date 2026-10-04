import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Minus, PackageCheck, Plus, ScanBarcode, SkipForward } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { ShipmentModal } from '../../components/ShipmentModal';
import { Empty, Field, Loading, SourceIcon, useAction } from '../../components/ui';
import { useStatuses } from '../../data';
import { money } from '../../format';
import { useT } from '../../i18n';

const PREFS_KEY = 'sellhub_packing';

interface Prefs {
  from: number | null;
  after: number | null;
  shipment: boolean;
}

function loadPrefs(): Prefs {
  try {
    return { from: null, after: null, shipment: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return { from: null, after: null, shipment: false };
  }
}

/** Short sound feedback for the scanner (ok / error). */
function beep(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 880 : 220;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.3));
    o.onended = () => ctx.close();
  } catch {
    /* no audio */
  }
}

/**
 * Packing station: takes orders from a status one by one; products are
 * confirmed with a barcode scanner (EAN or SKU) or by hand. A packed order can
 * be moved to another status and a shipment can be created right away.
 */
export default function PackingPage() {
  const t = useT();
  const run = useAction();
  const qc = useQueryClient();
  const statuses = useStatuses();
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [skipped, setSkipped] = useState<number[]>([]);
  const [scanned, setScanned] = useState<Record<number, number>>({});
  const [code, setCode] = useState('');
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [shipFor, setShipFor] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const list = statuses.data?.statuses ?? [];
  const from = prefs.from ?? list.find((s) => s.system_key === 'to_send')?.id ?? list[0]?.id ?? null;
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs]);

  const queue = useQuery({
    queryKey: ['packing-queue', from],
    queryFn: () => api.get<any>('/orders', { status_ids: String(from), per_page: 200, sort: 'id', dir: 'asc' }),
    enabled: !!from,
  });
  const ids: number[] = (queue.data?.rows ?? []).map((r: any) => r.id).filter((id: number) => !skipped.includes(id));
  const currentId = ids[0] ?? null;
  const order = useQuery({ queryKey: ['order', currentId], queryFn: () => api.get<any>(`/orders/${currentId}`), enabled: !!currentId });
  const o = order.data;

  useEffect(() => {
    setScanned({});
    setFlash(null);
    input.current?.focus();
  }, [currentId]);

  const items: any[] = o?.items ?? [];
  const totalQty = items.reduce((s, i) => s + i.quantity, 0);
  const doneQty = items.reduce((s, i) => s + Math.min(i.quantity, scanned[i.id] ?? 0), 0);
  const complete = items.length > 0 && doneQty >= totalQty;

  const matchItem = useMemo(
    () => (raw: string) => {
      const c = raw.trim().toLowerCase();
      if (!c) return { item: null, full: false };
      const hits = items.filter((i) => [i.ean, i.product_ean, i.sku].some((v) => v && String(v).toLowerCase() === c));
      const open = hits.find((i) => (scanned[i.id] ?? 0) < i.quantity);
      return { item: open ?? null, full: !open && hits.length > 0 };
    },
    [items, scanned],
  );

  const add = (itemId: number, delta: number) =>
    setScanned((s) => {
      const it = items.find((i) => i.id === itemId);
      const v = Math.max(0, Math.min(it?.quantity ?? 0, (s[itemId] ?? 0) + delta));
      return { ...s, [itemId]: v };
    });

  const onScan = () => {
    if (!code.trim()) {
      if (complete) finish();
      return;
    }
    const { item, full } = matchItem(code);
    if (item) {
      add(item.id, 1);
      setFlash({ ok: true, text: `${item.name}` });
      beep(true);
    } else {
      setFlash({ ok: false, text: full ? t('This product is already complete') : t('Code {code} is not in this order', { code: code.trim() }) });
      beep(false);
    }
    setCode('');
  };

  const next = () => {
    qc.invalidateQueries({ queryKey: ['packing-queue'] });
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['statuses'] });
  };

  const finish = async () => {
    if (!o) return;
    const r = await run(async () => {
      await api.post(`/orders/${o.id}/note`, { message: t('Order packed at the packing station ({n} products scanned)', { n: doneQty }) });
      if (prefs.after && prefs.after !== o.status_id) await api.post(`/orders/${o.id}/status`, { status_id: prefs.after });
      return true;
    }, t('Order packed'));
    if (!r) return;
    // A packed order leaves the queue even when its status stays the same.
    setSkipped((s) => [...s, o.id]);
    if (prefs.shipment && !o.shipments?.length) setShipFor(o.id);
    else next();
  };

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          {t('Packing')}
          <small>{t('Scan products with a barcode scanner or confirm them by hand')}</small>
        </h1>
      </div>
      <div className="card card-pad mb">
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', alignItems: 'end' }}>
          <Field label={t('Orders from status')}>
            <select className="select" value={from ?? ''} onChange={(e) => (setSkipped([]), setPrefs({ ...prefs, from: Number(e.target.value) }))}>
              {list.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('After packing change status to')}>
            <select className="select" value={prefs.after ?? ''} onChange={(e) => setPrefs({ ...prefs, after: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{t('— do not change —')}</option>
              {list.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <label className="check-label" style={{ paddingBottom: 10 }}>
            <input type="checkbox" checked={prefs.shipment} onChange={(e) => setPrefs({ ...prefs, shipment: e.target.checked })} /> {t('Create a shipment after packing')}
          </label>
          <div className="text-muted" style={{ paddingBottom: 10 }}>
            {t('In the queue: {n}', { n: ids.length })}
          </div>
        </div>
      </div>

      {queue.isLoading || (currentId && !o) ? (
        <Loading />
      ) : !currentId ? (
        <Empty icon={<PackageCheck />}>{t('No orders to pack in this status')}</Empty>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 18 }}>
          <div className="card">
            <div className="card-head">
              <div className="card-title">
                <SourceIcon source={o.source} />{' '}
                <Link to={`/orders/${o.id}`} className="order-no">
                  {t('Order')} #{o.id}
                </Link>
                <span className="text-muted" style={{ fontSize: 14, marginLeft: 10 }}>
                  {doneQty} / {totalQty}
                </span>
              </div>
              <button className="btn" onClick={() => setSkipped((s) => [...s, o.id])}>
                <SkipForward size={16} /> {t('Skip')}
              </button>
            </div>
            <div className="card-pad" style={{ paddingTop: 0 }}>
              <div className={`scan-box ${flash ? (flash.ok ? 'ok' : 'err') : ''}`}>
                <ScanBarcode size={26} />
                <input
                  ref={input}
                  className="input"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), onScan())}
                  placeholder={complete ? t('All products scanned — press Enter to finish') : t('Scan EAN or SKU…')}
                  aria-label={t('Scan EAN or SKU…')}
                  autoFocus
                />
              </div>
              {flash && <div className={`scan-flash ${flash.ok ? 'ok' : 'err'}`}>{flash.text}</div>}
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th />
                  <th>{t('Product')}</th>
                  <th>{t('Location')}</th>
                  <th className="num">{t('Packed')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const n = scanned[i.id] ?? 0;
                  const ok = n >= i.quantity;
                  return (
                    <tr key={i.id} className={ok ? 'row-done' : ''}>
                      <td style={{ width: 56 }}>{i.image ? <img src={i.image} alt="" className="thumb" /> : null}</td>
                      <td>
                        <b>{i.name}</b>
                        <div className="text-small text-muted">
                          {[i.sku && `SKU: ${i.sku}`, (i.ean || i.product_ean) && `EAN: ${i.ean || i.product_ean}`].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td>{i.location || i.product_location || '—'}</td>
                      <td className="num nowrap" style={{ fontSize: 18 }}>
                        {ok ? <CheckCircle2 size={18} color="var(--green)" style={{ verticalAlign: -3, marginRight: 6 }} /> : null}
                        <b>{n}</b> / {i.quantity}
                      </td>
                      <td className="num nowrap">
                        <button className="icon-btn" onClick={() => add(i.id, -1)} aria-label="-1">
                          <Minus size={16} />
                        </button>
                        <button className="icon-btn" onClick={() => add(i.id, 1)} aria-label="+1">
                          <Plus size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="card-pad row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setScanned(Object.fromEntries(items.map((i) => [i.id, i.quantity])))}>
                {t('Mark all as packed')}
              </button>
              <button className="btn btn-primary" disabled={!complete} onClick={finish}>
                <PackageCheck size={18} /> {t('Order packed')}
              </button>
            </div>
          </div>
          <div className="card card-pad" style={{ alignSelf: 'start' }}>
            <div className="card-title mb">{t('Delivery')}</div>
            <dl className="kv" style={{ gridTemplateColumns: '120px 1fr' }}>
              <dt>{t('Buyer')}:</dt>
              <dd>{o.delivery_fullname || o.user_login || '—'}</dd>
              <dt>{t('Shipping method')}:</dt>
              <dd>{o.delivery_method || '—'}</dd>
              {o.delivery_point_id && (
                <>
                  <dt>{t('Pickup point')}:</dt>
                  <dd>
                    {o.delivery_point_id} {o.delivery_point_name}
                  </dd>
                </>
              )}
              <dt>{t('Total')}:</dt>
              <dd>{money(o.total, o.currency)}</dd>
              <dt>{t('Cash on delivery')}:</dt>
              <dd>{o.payment_cod ? t('yes') : t('no')}</dd>
            </dl>
            {o.buyer_comment && (
              <div className="note-box mt">
                <b>{t('Buyer comment')}:</b> {o.buyer_comment}
              </div>
            )}
            {o.seller_comment && (
              <div className="note-box mt">
                <b>{t('Seller comment')}:</b> {o.seller_comment}
              </div>
            )}
          </div>
        </div>
      )}

      {shipFor && (
        <ShipmentModal
          orderIds={[shipFor]}
          onClose={() => {
            setShipFor(null);
            next();
          }}
          onDone={() => {
            setShipFor(null);
            next();
          }}
        />
      )}
    </>
  );
}
