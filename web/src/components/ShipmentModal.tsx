import { useState } from 'react';
import { api } from '../api';
import { COURIER_NAMES, COURIERS } from '../data';
import { useT } from '../i18n';
import { Field, Modal, useAction } from './ui';

/** Create a shipment (package) for one order or many orders at once. */
export function ShipmentModal({
  orderIds,
  defaultCourier,
  onClose,
  onDone,
}: {
  orderIds: number[];
  defaultCourier?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const run = useAction();
  const [courier, setCourier] = useState(defaultCourier ?? 'inpost');
  const [tracking, setTracking] = useState('');
  const [size, setSize] = useState('');
  const [weight, setWeight] = useState('');
  const [cod, setCod] = useState('');
  const [busy, setBusy] = useState(false);
  const single = orderIds.length === 1;
  const submit = async () => {
    setBusy(true);
    const body: any = { courier };
    if (single && tracking.trim()) body.tracking_number = tracking.trim();
    if (size) body.size = size;
    if (weight) body.weight = Number(weight.replace(',', '.'));
    if (single && cod) body.cod_amount = Number(cod.replace(',', '.'));
    const r = await run(
      () => (single ? api.post(`/orders/${orderIds[0]}/shipments`, body) : api.post('/orders/bulk', { ids: orderIds, action: 'shipment', params: body })),
      single ? t('Shipment created') : undefined,
    );
    setBusy(false);
    if (r) {
      if (!single && r.errors?.length) alert(r.errors.map((e: any) => `${e.id}: ${e.error}`).join('\n'));
      onDone();
      onClose();
    }
  };
  return (
    <Modal
      title={single ? t('Create shipment') : t('Create shipments for {n} orders', { n: orderIds.length })}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {t('Create shipment')}
          </button>
        </>
      }
    >
      <Field label={t('Courier')}>
        <select className="select" value={courier} onChange={(e) => setCourier(e.target.value)}>
          {COURIERS.map((c) => (
            <option key={c} value={c}>
              {c === 'other' ? t('Other') : COURIER_NAMES[c]}
            </option>
          ))}
        </select>
      </Field>
      {single && (
        <Field label={t('Tracking number')} help={t('Leave empty to generate a number and a label automatically.')}>
          <input className="input" value={tracking} onChange={(e) => setTracking(e.target.value)} maxLength={100} />
        </Field>
      )}
      <div className="form-grid">
        <Field label={t('Parcel size')}>
          <select className="select" value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="">—</option>
            <option value="A">A (8 × 38 × 64 cm)</option>
            <option value="B">B (19 × 38 × 64 cm)</option>
            <option value="C">C (41 × 38 × 64 cm)</option>
            <option value="custom">{t('Custom')}</option>
          </select>
        </Field>
        <Field label={t('Weight (kg)')} help={t('Empty = sum of product weights')}>
          <input className="input" value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" />
        </Field>
        {single && (
          <Field label={t('Cash on delivery')} help={t('Empty = calculated from the order')}>
            <input className="input" value={cod} onChange={(e) => setCod(e.target.value)} inputMode="decimal" />
          </Field>
        )}
      </div>
    </Modal>
  );
}
