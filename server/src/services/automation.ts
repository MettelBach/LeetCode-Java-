/**
 * Automatic actions ("Akcje automatyczne"): rules made of an event, a list of
 * conditions (all must match) and a list of actions executed in order.
 */
import { db, parseJson } from '../db/index.js';
import { onEvent, type EventName, type EventPayload } from './events.js';
import { addHistory, changeStatus, getOrder, orderTotal, setArchived, updateOrder } from './orders.js';
import { issueForOrderWithRate } from './invoices.js';
import { createShipment } from './shipments.js';
import { sendTemplateEmail } from './email.js';
import { assertPublicHttpsUrl } from '../lib/net.js';

export const EVENTS: EventName[] = [
  'order_created',
  'status_changed',
  'order_paid',
  'invoice_created',
  'receipt_created',
  'shipment_created',
  'return_created',
  'manual',
];

export interface Condition {
  field: string;
  op: string;
  value: any;
}

export interface Action {
  type: string;
  params: Record<string, any>;
}

export const CONDITION_FIELDS = [
  'source',
  'integration_id',
  'status_id',
  'from_status_id',
  'payment_status',
  'payment_cod',
  'payment_method',
  'delivery_method',
  'delivery_country_code',
  'total',
  'currency',
  'invoice_wanted',
  'has_invoice',
  'has_shipment',
  'has_pickup_point',
  'buyer_comment',
  'item_count',
  'product_sku',
  'product_name',
  'email',
  'extra_field_1',
  'extra_field_2',
] as const;

export const ACTION_TYPES = [
  'set_status',
  'send_email',
  'issue_invoice',
  'issue_receipt',
  'create_shipment',
  'add_note',
  'set_extra_field',
  'set_star',
  'archive',
  'webhook',
] as const;

const MAX_DEPTH = 5;

function fieldValue(field: string, orderId: number, payload: EventPayload): any {
  const o = getOrder(orderId);
  switch (field) {
    case 'from_status_id':
      return payload.fromStatusId ?? null;
    case 'status_id':
      // Rules run after the event: another rule may have moved the order on already.
      return payload.toStatusId ?? o.status_id;
    case 'payment_status': {
      const total = orderTotal(orderId);
      if (o.paid_amount <= 0) return 'unpaid';
      if (o.paid_amount < total - 0.001) return 'partial';
      return 'paid';
    }
    case 'total':
      return orderTotal(orderId);
    case 'has_invoice':
      return !!db.prepare(`SELECT 1 FROM invoices WHERE order_id = ? AND type = 'invoice'`).get(orderId);
    case 'has_shipment':
      return !!db.prepare('SELECT 1 FROM shipments WHERE order_id = ?').get(orderId);
    case 'has_pickup_point':
      return !!o.delivery_point_id;
    case 'item_count':
      return (db.prepare('SELECT COALESCE(SUM(quantity),0) c FROM order_items WHERE order_id = ?').get(orderId) as { c: number }).c;
    case 'product_sku':
      return (db.prepare('SELECT sku FROM order_items WHERE order_id = ?').all(orderId) as { sku: string }[]).map((r) => r.sku);
    case 'product_name':
      return (db.prepare('SELECT name FROM order_items WHERE order_id = ?').all(orderId) as { name: string }[]).map((r) => r.name);
    case 'payment_cod':
    case 'invoice_wanted':
      return !!o[field];
    default:
      return o[field];
  }
}

export function testCondition(actual: any, op: string, expected: any): boolean {
  if (Array.isArray(actual) && !['in', 'not_in'].includes(op)) {
    // Multi-valued field (e.g. product SKUs): true if any value matches.
    return op.startsWith('not_') ? actual.every((a) => testCondition(a, op, expected)) : actual.some((a) => testCondition(a, op, expected));
  }
  const s = (v: any) => String(v ?? '').toLowerCase();
  const list = (Array.isArray(expected) ? expected : String(expected).split(',')).map((v) => s(v).trim());
  switch (op) {
    case 'eq':
      return s(actual) === s(expected);
    case 'neq':
      return s(actual) !== s(expected);
    case 'in':
      return Array.isArray(actual) ? actual.some((a) => list.includes(s(a))) : list.includes(s(actual));
    case 'not_in':
      return Array.isArray(actual) ? !actual.some((a) => list.includes(s(a))) : !list.includes(s(actual));
    case 'contains':
      return s(actual).includes(s(expected));
    case 'not_contains':
      return !s(actual).includes(s(expected));
    case 'empty':
      return s(actual) === '';
    case 'not_empty':
      return s(actual) !== '';
    case 'gt':
      return Number(actual) > Number(expected);
    case 'gte':
      return Number(actual) >= Number(expected);
    case 'lt':
      return Number(actual) < Number(expected);
    case 'lte':
      return Number(actual) <= Number(expected);
    case 'true':
      return !!actual;
    case 'false':
      return !actual;
    default:
      return false;
  }
}

export function matches(conditions: Condition[], orderId: number, payload: EventPayload): boolean {
  return conditions.every((c) => testCondition(fieldValue(c.field, orderId, payload), c.op, c.value));
}

async function runAction(a: Action, orderId: number, payload: EventPayload, ruleId: number) {
  const meta = { depth: (payload.depth ?? 0) + 1, ruleIds: [...(payload.ruleIds ?? []), ruleId] };
  const user = 'Automatic action';
  const p = a.params ?? {};
  switch (a.type) {
    case 'set_status': {
      changeStatus(orderId, Number(p.status_id), user, meta);
      const st = db.prepare('SELECT name FROM order_statuses WHERE id = ?').get(Number(p.status_id)) as { name: string } | undefined;
      return `status → ${st?.name ?? p.status_id}`;
    }
    case 'send_email':
      return `email: ${await sendTemplateEmail(orderId, Number(p.template_id), user)}`;
    case 'issue_invoice':
      try {
        await issueForOrderWithRate(orderId, 'invoice', { series_id: p.series_id ? Number(p.series_id) : undefined, user, meta });
        return 'invoice issued';
      } catch (e: any) {
        return `invoice skipped: ${e.message}`;
      }
    case 'issue_receipt':
      try {
        await issueForOrderWithRate(orderId, 'receipt', { series_id: p.series_id ? Number(p.series_id) : undefined, user, meta });
        return 'receipt issued';
      } catch (e: any) {
        return `receipt skipped: ${e.message}`;
      }
    case 'create_shipment': {
      const exists = db.prepare('SELECT 1 FROM shipments WHERE order_id = ?').get(orderId);
      if (exists && !p.allow_multiple) return 'shipment skipped: already exists';
      createShipment(orderId, { courier: String(p.courier || 'other'), service: p.service, size: p.size }, user, meta);
      return 'shipment created';
    }
    case 'add_note': {
      const o = getOrder(orderId);
      const text = String(p.text ?? '');
      updateOrder(orderId, { seller_comment: o.seller_comment ? `${o.seller_comment}\n${text}` : text }, user);
      return 'note added';
    }
    case 'set_extra_field':
      updateOrder(orderId, { [Number(p.field) === 2 ? 'extra_field_2' : 'extra_field_1']: String(p.value ?? '') }, user);
      return 'extra field set';
    case 'set_star':
      updateOrder(orderId, { star: Number(p.star ?? 1) }, user);
      return 'star set';
    case 'archive':
      setArchived(orderId, true, user);
      return 'archived';
    case 'webhook': {
      let url: URL;
      try {
        url = await assertPublicHttpsUrl(String(p.url ?? ''));
      } catch (e: any) {
        return `webhook skipped: ${e.message}`;
      }
      const o = getOrder(orderId);
      const res = await fetch(url, {
        redirect: 'manual',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: payload, order: { ...o, total: orderTotal(orderId) } }),
        signal: AbortSignal.timeout(10000),
      });
      return `webhook: HTTP ${res.status}`;
    }
    default:
      return `unknown action ${a.type}`;
  }
}

export async function runRulesFor(event: EventName, payload: EventPayload, onlyRuleId?: number) {
  if ((payload.depth ?? 0) >= MAX_DEPTH) return;
  const rules = db
    .prepare(`SELECT * FROM rules WHERE enabled = 1 AND event = ? ${onlyRuleId ? 'AND id = ?' : ''} ORDER BY sort, id`)
    .all(...(onlyRuleId ? [event, onlyRuleId] : [event])) as any[];
  for (const rule of rules) {
    // A rule never re-triggers itself through its own actions.
    if (payload.ruleIds?.includes(rule.id)) continue;
    try {
      getOrder(payload.orderId);
    } catch {
      return;
    }
    const conditions = parseJson<Condition[]>(rule.conditions, []);
    if (!matches(conditions, payload.orderId, payload)) continue;
    const results: string[] = [];
    for (const a of parseJson<Action[]>(rule.actions, [])) {
      try {
        results.push(await runAction(a, payload.orderId, payload, rule.id));
      } catch (e: any) {
        results.push(`${a.type} failed: ${e.message}`);
      }
    }
    db.prepare('UPDATE rules SET run_count = run_count + 1 WHERE id = ?').run(rule.id);
    db.prepare('INSERT INTO rule_log (rule_id, order_id, message) VALUES (?, ?, ?)').run(rule.id, payload.orderId, results.join('; '));
    addHistory(payload.orderId, `Automatic action "${rule.name}": ${results.join('; ')}`, 'automation', 'Automatic action');
  }
}

export function registerAutomation() {
  onEvent((event, payload) => runRulesFor(event, payload));
}
