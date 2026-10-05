/**
 * Order history entries are stored in English (the server's language-neutral
 * log); this turns them into the panel language. Unknown entries (notes typed
 * by users) are shown as they are.
 */
type T = (key: string, vars?: Record<string, string | number>) => string;

export const SHIP_STATUS_LABEL: Record<string, string> = {
  created: 'Created',
  label_printed: 'Label printed',
  picked_up: 'Picked up by the courier',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  returned: 'Returned to sender',
  canceled: 'Canceled',
};


// `label` values are UI texts (picked up by the i18n checker); {a} {b} {c} are the captured parts.
const HISTORY_LABELS: { re: RegExp; label: string; tr?: number[] }[] = [
  { re: /^Status changed: (.*) → (.*)$/, label: 'Status changed: {a} → {b}' },
  { re: /^Order created$/, label: 'Order created' },
  { re: /^Order downloaded from (.+)$/, label: 'Order downloaded from {a}' },
  { re: /^Order moved to bin$/, label: 'Order moved to bin' },
  { re: /^Order restored$/, label: 'Order restored' },
  { re: /^Order archived$/, label: 'Order archived' },
  { re: /^Order removed from archive$/, label: 'Order removed from archive' },
  { re: /^Order data changed: (.*)$/, label: 'Order data changed: {a}' },
  { re: /^Product added: (\d+(?:\.\d+)?)x (.*)$/, label: 'Product added: {a}x {b}' },
  { re: /^Product edited: (.*)$/, label: 'Product edited: {a}' },
  { re: /^Product removed: (\d+(?:\.\d+)?)x (.*)$/, label: 'Product removed: {a}x {b}' },
  { re: /^Payment set: (.*) of (.*)$/, label: 'Payment set: {a} of {b}' },
  { re: /^Order (\d+) merged into this order$/, label: 'Order {a} merged into this order' },
  { re: /^Order merged into (\d+)$/, label: 'Order merged into {a}' },
  { re: /^Products moved to new order (\d+)$/, label: 'Products moved to new order {a}' },
  { re: /^Order created by splitting order (\d+)$/, label: 'Order created by splitting order {a}' },
  { re: /^Order duplicated from (\d+)$/, label: 'Order duplicated from {a}' },
  { re: /^Return #(\d+) created \((.*)\)$/, label: 'Return #{a} created ({b})' },
  { re: /^Return #(\d+): refunded (.*)$/, label: 'Return #{a}: refunded {b}' },
  { re: /^Return #(\d+): status → (.*)$/, label: 'Return #{a}: status → {b}' },
  { re: /^Return #(\d+): products returned to stock$/, label: 'Return #{a}: products returned to stock' },
  { re: /^Return #(\d+): nothing returned to stock — the order did not take stock$/, label: 'Return #{a}: nothing returned to stock — the order did not take stock' },
  { re: /^(Invoice|Receipt|Pro forma) issued: (.*)$/, label: '{a} issued: {b}', tr: [0] },
  { re: /^Correction issued: (.*) \(to (.*)\)$/, label: 'Correction issued: {a} (to {b})' },
  { re: /^Document deleted: (.*)$/, label: 'Document deleted: {a}' },
  { re: /^E-mail "(.*)" to (.*): (sent|not sent: SMTP not configured)$/, label: 'E-mail "{a}" to {b}: {c}', tr: [2] },
  { re: /^E-mail "(.*)" to (.*): error: (.*)$/, label: 'E-mail "{a}" to {b}: error: {c}' },
  { re: /^Shipment created: (.*) \(test number — courier not connected\)$/, label: 'Shipment created: {a} (test number — courier not connected)' },
  { re: /^Shipment created: (.*)$/, label: 'Shipment created: {a}' },
  { re: /^Shipment deleted: (.*)$/, label: 'Shipment deleted: {a}' },
  { re: /^Shipment (\S+): (.*)$/, label: 'Shipment {a}: {b}', tr: [1] },
  { re: /^Status "(.*)" sent to (.*)$/, label: 'Status "{a}" sent to {b}' },
  { re: /^Sending status "(.*)" to (.*) failed: (.*)$/, label: 'Sending status "{a}" to {b} failed: {c}' },
  { re: /^Tracking number (.*) sent to (.*)$/, label: 'Tracking number {a} sent to {b}' },
  { re: /^Sending tracking number to (.*) failed: (.*)$/, label: 'Sending tracking number to {a} failed: {b}' },
  { re: /^Updated from (.*?): (.*)$/, label: 'Updated from {a}: {b}' },
  { re: /^Automatic action "(.*)": (.*)$/, label: 'Automatic action "{a}": {b}' },
  { re: /^Stock deducted from the warehouse$/, label: 'Stock deducted from the warehouse' },
  { re: /^Stock reserved$/, label: 'Stock reserved' },
  { re: /^Stock returned to the warehouse$/, label: 'Stock returned to the warehouse' },
  { re: /^Stock reservation released$/, label: 'Stock reservation released' },
];

export function historyText(message: string, t: T): string {
  for (const h of HISTORY_LABELS) {
    const m = h.re.exec(message);
    if (!m) continue;
    const parts = m.slice(1).map((v, i) => (h.tr?.includes(i) ? t(SHIP_STATUS_LABEL[v] ?? v) : v));
    return t(h.label, { a: parts[0] ?? '', b: parts[1] ?? '', c: parts[2] ?? '' });
  }
  return message;
}
