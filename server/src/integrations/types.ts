import type { OrderInput } from '../services/orders.js';

export type IntegrationType = 'allegro' | 'empik' | 'kaufland';

export interface IntegrationRow {
  id: number;
  type: IntegrationType;
  name: string;
  enabled: number;
  demo: number;
  credentials: Record<string, any>;
  settings: IntegrationSettings;
  state: Record<string, any>;
  last_sync_at: string | null;
  last_error: string | null;
}

export interface IntegrationSettings {
  /** Local status for newly imported orders. */
  import_status_id?: number | null;
  /** How many days back to look on the first synchronization. */
  import_days?: number;
  /** local status id -> marketplace action/status code. */
  status_map?: Record<string, string>;
  /** Push tracking numbers to the marketplace when a shipment is created. */
  send_tracking?: boolean;
  sync_stock?: boolean;
  sync_price?: boolean;
  /** Automatically link offers with inventory products by SKU/EAN. */
  auto_link?: boolean;
  /** Empik: automatically accept orders waiting for acceptance. */
  auto_accept?: boolean;
  /** Mark local order as canceled when canceled on the marketplace. */
  sync_cancel?: boolean;
  [k: string]: unknown;
}

export interface MarketplaceOrder extends OrderInput {
  external_id: string;
  /** True when the marketplace reports the order as canceled. */
  canceled?: boolean;
  /** False when the order exists but should not be imported yet (e.g. unpaid). */
  importable?: boolean;
}

export interface MarketplaceOffer {
  external_id: string;
  title: string;
  sku: string;
  ean: string;
  price: number;
  currency: string;
  stock: number;
  status: string;
  url: string;
  image: string;
  raw?: unknown;
}

export interface ShipmentInfo {
  courier: string;
  tracking_number: string;
}

export interface ConnectorContext {
  integration: IntegrationRow;
  saveState(patch: Record<string, unknown>): void;
  log(message: string, level?: 'info' | 'warn' | 'error'): void;
}

export interface Connector {
  test(): Promise<string>;
  fetchOrders(since: string): Promise<MarketplaceOrder[]>;
  fetchOffers(): Promise<MarketplaceOffer[]>;
  updateOffer(offer: { external_id: string; sku: string; ean: string; currency: string; raw: any }, change: { stock?: number; price?: number }): Promise<void>;
  /** Performs a marketplace action/status change for an order (codes per marketplace, see STATUS_CODES). */
  setOrderStatus(order: { external_id: string; external_data: any; items: { external_line_id: string }[] }, code: string): Promise<void>;
  sendTracking(order: { external_id: string; external_data: any; items: { external_line_id: string }[] }, shipment: ShipmentInfo): Promise<void>;
}

/** Marketplace status codes available for the local → marketplace status mapping. */
export const STATUS_CODES: Record<IntegrationType, string[]> = {
  allegro: ['NEW', 'PROCESSING', 'READY_FOR_SHIPMENT', 'READY_FOR_PICKUP', 'SENT', 'PICKED_UP', 'CANCELLED', 'SUSPENDED', 'RETURNED'],
  empik: ['accept', 'ship', 'cancel'],
  kaufland: ['send', 'cancel'],
};
