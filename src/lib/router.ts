import { useEffect, useState } from 'react';
import type { Capability } from '../../shared/access';
import { PERIOD_PRESETS, type PeriodPreset, type PeriodSpec } from '../../shared/periods';
import { PAYMENT_METHODS, type PaymentMethod, type ProformaStatus } from '../../shared/types';

// A tiny hash router — hash URLs are the one kind that also work when the app is loaded from a file.

export type Section = 'dashboard' | 'inventory' | 'invoices' | 'proformas' | 'customers' | 'payments' | 'purchases' | 'expenses' | 'reports' | 'settings';

export const SETTINGS_SECTIONS = ['business', 'tax', 'invoice', 'proforma', 'expenses', 'accounts', 'instructions', 'sharing', 'offers', 'notifications', 'data', 'businesses', 'mobile', 'access', 'activity', 'preferences', 'plus'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export type Route =
  | { name: 'dashboard' }
  | { name: 'inventory'; status: 'all' | 'low' | 'out' }
  | { name: 'materials' }
  | { name: 'labels'; design: string | null }
  | { name: 'catalogue' }
  | { name: 'restock' }
  | { name: 'locations' }
  | { name: 'count' }
  | { name: 'inventory-add' }
  | { name: 'design'; id: string }
  | { name: 'invoices'; status: 'all' | 'open' | 'overdue' | 'cancelled' }
  | { name: 'invoice-new'; customerId: string | null; advance: AdvancePreset | null }
  | { name: 'payments' }
  | { name: 'dues' }
  | { name: 'invoice'; id: string }
  | { name: 'purchases'; status: 'all' | 'open' | 'overdue' | 'cancelled' }
  | { name: 'bill-new'; supplierId: string | null }
  | { name: 'bill'; id: string }
  | { name: 'suppliers' }
  | { name: 'supplier'; id: string }
  | { name: 'weavers' }
  | { name: 'weaver'; id: string }
  | { name: 'job-order'; id: string }
  | { name: 'credit-notes' }
  | { name: 'credit-note'; id: string }
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
  | { name: 'print-credit-note'; id: string }
  | { name: 'print-labels'; query: string }
  | { name: 'print-catalogue'; query: string }
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
      if (parts[1] === 'labels') return { name: 'labels', design: params.get('design') };
      if (parts[1] === 'catalogue') return { name: 'catalogue' };
      if (parts[1] === 'restock') return { name: 'restock' };
      if (parts[1] === 'locations') return { name: 'locations' };
      if (parts[1] === 'count') return { name: 'count' };
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
        return { name: 'invoice-new', customerId: params.get('customer'), advance };
      }
      if (parts[1]) return { name: 'invoice', id: decodeURIComponent(parts[1]) };
      const status = params.get('status');
      return { name: 'invoices', status: status === 'open' || status === 'overdue' || status === 'cancelled' ? status : 'all' };
    }
    case 'purchases': {
      if (parts[1] === 'new') return { name: 'bill-new', supplierId: params.get('supplier') };
      if (parts[1] === 'bills' && id) return { name: 'bill', id };
      if (parts[1] === 'suppliers') return id ? { name: 'supplier', id } : { name: 'suppliers' };
      if (parts[1] === 'weavers') return id ? { name: 'weaver', id } : { name: 'weavers' };
      if (parts[1] === 'orders' && id) return { name: 'job-order', id };
      const status = params.get('status');
      return { name: 'purchases', status: status === 'open' || status === 'overdue' || status === 'cancelled' ? status : 'all' };
    }
    case 'credit-notes':
      return parts[1] ? { name: 'credit-note', id: decodeURIComponent(parts[1]) } : { name: 'credit-notes' };
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
      if (parts[1] === 'labels') return { name: 'print-labels', query };
      if (parts[1] === 'catalogue') return { name: 'print-catalogue', query };
      if (parts[1] === 'invoice' && id) return { name: 'print-invoice', id };
      if (parts[1] === 'proforma' && id) return { name: 'print-proforma', id };
      if (parts[1] === 'credit-note' && id) return { name: 'print-credit-note', id };
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
    case 'labels':
    case 'catalogue':
    case 'restock':
    case 'locations':
    case 'count':
    case 'print-labels':
    case 'print-catalogue':
    case 'inventory-add':
    case 'design':
      return 'inventory';
    case 'invoices':
    case 'invoice-new':
    case 'invoice':
    case 'print-invoice':
    case 'credit-notes':
    case 'credit-note':
    case 'print-credit-note':
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
    case 'purchases':
    case 'bill-new':
    case 'bill':
    case 'suppliers':
    case 'supplier':
    case 'weavers':
    case 'weaver':
    case 'job-order':
      return 'purchases';
  }
};

/** What signing in as someone must allow for a page to be shown. (The data layer enforces this too; this only decides what is offered.) */
export function routeNeeds(route: Route): Capability {
  switch (route.name) {
    case 'dashboard':
    case 'expenses':
    case 'reports':
    case 'restock':
      return 'reports';
    case 'settings':
      return 'admin';
    case 'inventory-add':
    case 'count':
      return 'stock';
    case 'invoice-new':
    case 'proforma-new':
      return 'sell';
    case 'purchases':
    case 'bill-new':
    case 'bill':
    case 'suppliers':
    case 'supplier':
    case 'weavers':
    case 'weaver':
    case 'job-order':
      return 'purchases';
    default:
      return 'view';
  }
}

export const paths = {
  dashboard: '/dashboard',
  inventory: (status?: 'low' | 'out') => (status ? `/inventory?status=${status}` : '/inventory'),
  materials: '/inventory/materials',
  labels: (designId?: string) => (designId ? `/inventory/labels?design=${encodeURIComponent(designId)}` : '/inventory/labels'),
  addSarees: '/inventory/add',
  catalogue: '/inventory/catalogue',
  restock: '/inventory/restock',
  locations: '/inventory/locations',
  count: '/inventory/count',
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
  purchases: (status?: 'open' | 'overdue' | 'cancelled') => (status ? `/purchases?status=${status}` : '/purchases'),
  newBill: (supplierId?: string) => (supplierId ? `/purchases/new?supplier=${encodeURIComponent(supplierId)}` : '/purchases/new'),
  bill: (id: string) => `/purchases/bills/${encodeURIComponent(id)}`,
  suppliers: '/purchases/suppliers',
  supplier: (id: string) => `/purchases/suppliers/${encodeURIComponent(id)}`,
  weavers: '/purchases/weavers',
  weaver: (id: string) => `/purchases/weavers/${encodeURIComponent(id)}`,
  jobOrder: (id: string) => `/purchases/orders/${encodeURIComponent(id)}`,
  creditNotes: '/credit-notes',
  creditNote: (id: string) => `/credit-notes/${encodeURIComponent(id)}`,
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
