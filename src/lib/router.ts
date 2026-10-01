import { useEffect, useState } from 'react';
import { PERIOD_PRESETS, type PeriodPreset, type PeriodSpec } from '../../shared/periods';
import { PAYMENT_METHODS, type PaymentMethod, type ProformaStatus } from '../../shared/types';

// A tiny hash router — hash URLs are the one kind that also work when the app is loaded from a file.

export type Section = 'dashboard' | 'inventory' | 'invoices' | 'proformas' | 'customers' | 'payments' | 'expenses' | 'reports' | 'settings';

export const SETTINGS_SECTIONS = ['business', 'tax', 'invoice', 'proforma', 'expenses', 'accounts', 'instructions', 'notifications', 'data', 'preferences', 'plus'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export type Route =
  | { name: 'dashboard' }
  | { name: 'inventory'; status: 'all' | 'low' | 'out' }
  | { name: 'materials' }
  | { name: 'inventory-add' }
  | { name: 'design'; id: string }
  | { name: 'invoices'; status: 'all' | 'open' | 'overdue' | 'cancelled' }
  | { name: 'invoice-new'; customerId: string | null; advance: AdvancePreset | null; /** An earlier invoice to start from (Duplicate). */ copyFrom: string | null }
  | { name: 'payments' }
  | { name: 'dues' }
  | { name: 'invoice'; id: string }
  | { name: 'proformas'; status: 'all' | ProformaStatus }
  | { name: 'proforma-new'; customerId: string | null }
  | { name: 'proforma'; id: string }
  | { name: 'expenses'; category: string | null }
  | { name: 'customers' }
  | { name: 'customer'; id: string }
  | { name: 'settings'; section: SettingsSection }
  /** Bare invoice document with no app chrome — what PDF export and printing render. */
  | { name: 'print-invoice'; id: string }
  | { name: 'print-proforma'; id: string }
  | { name: 'reports'; tab: ReportTab; period: PeriodSpec; /** Stock valuation date; null means today. */ asOf: string | null };

export type ReportTab = 'sales' | 'gst' | 'stock';

/** Money a customer has just paid, carried into the New invoice screen so it's recorded in the same step as the invoice. */
export interface AdvancePreset {
  amountPaise: number;
  method: PaymentMethod;
  reference: string;
}

export function parseHash(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  const id = parts[2] ? decodeURIComponent(parts[2]) : '';

  switch (parts[0]) {
    case 'inventory': {
      if (parts[1] === 'materials') return { name: 'materials' };
      if (parts[1] === 'add') return { name: 'inventory-add' };
      if (parts[1] === 'designs' && id) return { name: 'design', id };
      const status = params.get('status');
      return { name: 'inventory', status: status === 'low' || status === 'out' ? status : 'all' };
    }
    case 'invoices': {
      if (parts[1] === 'new') {
        const amount = Number(params.get('advance'));
        const method = params.get('method') as PaymentMethod;
        const advance: AdvancePreset | null = Number.isInteger(amount) && amount > 0 ? { amountPaise: amount, method: (PAYMENT_METHODS as readonly string[]).includes(method) ? method : 'cash', reference: params.get('ref') ?? '' } : null;
        return { name: 'invoice-new', customerId: params.get('customer'), advance, copyFrom: params.get('copy') };
      }
      if (parts[1]) return { name: 'invoice', id: decodeURIComponent(parts[1]) };
      const status = params.get('status');
      return { name: 'invoices', status: status === 'open' || status === 'overdue' || status === 'cancelled' ? status : 'all' };
    }
    case 'proformas': {
      if (parts[1] === 'new') return { name: 'proforma-new', customerId: params.get('customer') };
      if (parts[1]) return { name: 'proforma', id: decodeURIComponent(parts[1]) };
      const status = params.get('status');
      return { name: 'proformas', status: status === 'open' || status === 'expired' || status === 'converted' || status === 'cancelled' ? status : 'all' };
    }
    case 'expenses':
      return { name: 'expenses', category: params.get('category') };
    case 'customers':
      return parts[1] ? { name: 'customer', id: decodeURIComponent(parts[1]) } : { name: 'customers' };
    case 'settings':
      return { name: 'settings', section: (SETTINGS_SECTIONS as readonly string[]).includes(parts[1] ?? '') ? (parts[1] as SettingsSection) : 'business' };
    case 'print':
      if (parts[1] === 'invoice' && id) return { name: 'print-invoice', id };
      if (parts[1] === 'proforma' && id) return { name: 'print-proforma', id };
      return { name: 'dashboard' };
    case 'payments':
      return parts[1] === 'dues' ? { name: 'dues' } : { name: 'payments' };
    case 'reports': {
      const tab: ReportTab = parts[1] === 'gst' || parts[1] === 'stock' ? parts[1] : 'sales';
      const preset = params.get('period');
      const period: PeriodSpec = {
        preset: (PERIOD_PRESETS as readonly string[]).includes(preset ?? '') ? (preset as PeriodPreset) : 'this-month',
        from: params.get('from') ?? undefined,
        to: params.get('to') ?? undefined,
      };
      const asOf = params.get('asOf');
      return { name: 'reports', tab, period, asOf: asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : null };
    }
    default:
      return { name: 'dashboard' };
  }
}

export const sectionOf = (route: Route): Section => {
  switch (route.name) {
    case 'reports':
    case 'dashboard':
    case 'settings':
      return route.name;
    case 'inventory':
    case 'materials':
    case 'inventory-add':
    case 'design':
      return 'inventory';
    case 'invoices':
    case 'invoice-new':
    case 'invoice':
    case 'print-invoice':
      return 'invoices';
    case 'proformas':
    case 'proforma-new':
    case 'proforma':
    case 'print-proforma':
      return 'proformas';
    case 'expenses':
      return 'expenses';
    case 'customers':
    case 'customer':
      return 'customers';
    case 'payments':
    case 'dues':
      return 'payments';
  }
};

export const paths = {
  dashboard: '/dashboard',
  inventory: (status?: 'low' | 'out') => (status ? `/inventory?status=${status}` : '/inventory'),
  materials: '/inventory/materials',
  addSarees: '/inventory/add',
  design: (id: string) => `/inventory/designs/${encodeURIComponent(id)}`,
  invoices: (status?: 'open' | 'overdue' | 'cancelled') => (status ? `/invoices?status=${status}` : '/invoices'),
  newInvoice: (customerId?: string, advance?: AdvancePreset) => {
    const q = new URLSearchParams();
    if (customerId) q.set('customer', customerId);
    if (advance) {
      q.set('advance', String(advance.amountPaise));
      q.set('method', advance.method);
      if (advance.reference) q.set('ref', advance.reference);
    }
    return q.size ? `/invoices/new?${q}` : '/invoices/new';
  },
  /** A new invoice that starts as a copy of an earlier one: same customer, items, prices, discount and notes; today's date; no payment. */
  duplicateInvoice: (id: string) => `/invoices/new?copy=${encodeURIComponent(id)}`,
  proformas: (status?: ProformaStatus) => (status ? `/proformas?status=${status}` : '/proformas'),
  newProforma: (customerId?: string) => (customerId ? `/proformas/new?customer=${encodeURIComponent(customerId)}` : '/proformas/new'),
  proforma: (id: string) => `/proformas/${encodeURIComponent(id)}`,
  expenses: (category?: string) => (category ? `/expenses?category=${encodeURIComponent(category)}` : '/expenses'),
  payments: '/payments',
  dues: '/payments/dues',
  reports: (tab: ReportTab = 'sales', period?: PeriodSpec, asOf?: string | null) => {
    const q = new URLSearchParams();
    if (period && period.preset !== 'this-month') q.set('period', period.preset);
    if (period?.preset === 'custom') {
      if (period.from) q.set('from', period.from);
      if (period.to) q.set('to', period.to);
    }
    if (asOf) q.set('asOf', asOf);
    return `/reports/${tab}${q.size ? `?${q}` : ''}`;
  },
  invoice: (id: string) => `/invoices/${encodeURIComponent(id)}`,
  customers: '/customers',
  customer: (id: string) => `/customers/${encodeURIComponent(id)}`,
  settings: '/settings',
  settingsSection: (s: SettingsSection) => `/settings/${s}`,
  section: (s: Section) => `/${s}`,
};

export const navigate = (path: string) => {
  window.location.hash = path;
};

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
