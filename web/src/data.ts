import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface Status {
  id: number;
  name: string;
  short_name: string;
  full_name: string;
  color: string;
  group_id: number | null;
  sort: number;
  system_key: string | null;
}
export interface StatusGroup {
  id: number;
  name: string;
  sort: number;
}
export interface StatusesData {
  statuses: Status[];
  groups: StatusGroup[];
  counts: { all: number; by_status: Record<string, number>; archive: number; bin: number };
}

export function useStatuses() {
  return useQuery({ queryKey: ['statuses'], queryFn: () => api.get<StatusesData>('/statuses'), staleTime: 15_000 });
}

export interface Integration {
  id: number;
  type: 'allegro' | 'empik' | 'kaufland' | 'olx';
  category?: string;
  name: string;
  enabled: boolean;
  demo: boolean;
  credentials: Record<string, any>;
  settings: Record<string, any>;
  authorized: boolean;
  auth_pending: { user_code: string; url: string } | null;
  last_sync_at: string | null;
  last_error: string | null;
  stats: { orders: number; orders_30d: number; offers: number; offers_linked: number };
}

export function useIntegrations() {
  return useQuery({ queryKey: ['integrations'], queryFn: () => api.get<Integration[]>('/integrations'), staleTime: 30_000 });
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api.get<any>('/settings'), staleTime: 60_000 });
}

export function useEmailTemplates() {
  return useQuery({ queryKey: ['email-templates'], queryFn: () => api.get<any[]>('/settings/email-templates'), staleTime: 60_000 });
}

export function useInvoiceSeries() {
  return useQuery({ queryKey: ['invoice-series'], queryFn: () => api.get<any[]>('/invoices/series'), staleTime: 60_000 });
}

export function useRules() {
  return useQuery({ queryKey: ['rules'], queryFn: () => api.get<any[]>('/rules'), staleTime: 30_000 });
}

/** Invalidates everything that depends on orders after a mutation. */
export function useInvalidateOrders() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['order'] });
    qc.invalidateQueries({ queryKey: ['statuses'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export const COURIERS = ['inpost', 'inpost_courier', 'dpd', 'dhl', 'gls', 'ups', 'pocztex', 'orlen', 'allegro', 'fedex', 'other'] as const;
export const COURIER_NAMES: Record<string, string> = {
  inpost: 'InPost Paczkomaty',
  inpost_courier: 'InPost Kurier',
  dpd: 'DPD',
  dhl: 'DHL',
  gls: 'GLS',
  ups: 'UPS',
  pocztex: 'Pocztex',
  orlen: 'ORLEN Paczka',
  allegro: 'Allegro (Wysyłam z Allegro)',
  fedex: 'FedEx',
  other: 'Other',
};
