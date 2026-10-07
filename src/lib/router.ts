import { useEffect, useState } from 'react';
import { PERIOD_PRESETS, type PeriodPreset, type PeriodSpec } from '../../shared/periods';
import { LABEL_LAYOUTS, PAYMENT_METHODS, type LabelLayout, type PaymentMethod, type ProformaStatus } from '../../shared/types';

// A tiny hash router — hash URLs are the one kind that also work when the app is loaded from a file.

export type Section = 'dashboard' | 'inventory' | 'invoices' | 'proformas' | 'customers' | 'payments' | 'expenses' | 'reports' | 'settings';

export const SETTINGS_SECTIONS = ['business', 'tax', 'invoice', 'proforma', 'expenses', 'accounts', 'instructions', 'notifications', 'messages', 'data', 'backup', 'catalogue', 'people', 'team', 'preferences', 'activity', 'plus'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export type Route =
  | { name: 'dashboard' }
  | { name: 'inventory'; status: 'all' | 'low' | 'out' }
  | { name: 'materials' }
  | { name: 'inventory-add' }
  | { name: 'inventory-names' }
  | { name: 'production' }
  | { name: 'weaver-orders' }
  | { name: 'weaver-order-new'; /** The customer quote the order is for. */ quoteId: string | null }
  | { name: 'weaver-order-edit'; id: string }
  | { name: 'weaver-order'; id: string }
  | { name: 'stock-take' }
  | { name: 'design'; id: string }
  | { name: 'invoices'; status: 'all' | 'open' | 'overdue' | 'cancelled' }
  | { name: 'invoice-new'; customerId: string | null; advance: AdvancePreset | null; /** An earlier invoice to start from (Duplicate). */ copyFrom: string | null }
  | { name: 'payments' }
  | { name: 'dues' }
  | { name: 'notifications' }
  | { name: 'cheques' }
  | { name: 'accounts' }
  | { name: 'reconcile' }
  | { name: 'invoice'; id: string }
  | { name: 'proformas'; status: 'all' | ProformaStatus }
  | { name: 'proforma-new'; customerId: string | null; /** An earlier quote to start from (Duplicate). */ copyFrom: string | null }
  | { name: 'proforma-edit'; id: string }
  | { name: 'proforma'; id: string }
  | { name: 'expenses'; category: string | null }
  | { name: 'customers' }
  | { name: 'customer'; id: string }
  | { name: 'settings'; section: SettingsSection }
  /** Bare invoice document with no app chrome — what PDF export and printing render. */
  | { name: 'credit-notes' }
  | { name: 'credit-note'; id: string }
  | { name: 'print-credit-note'; id: string }
  | { name: 'print-slip'; id: string }
  | { name: 'quick-bill' }
  | { name: 'print-labels'; items: { variantId: string; copies: number }[]; layout: LabelLayout }
  | { name: 'print-invoice'; id: string }
  | { name: 'print-proforma'; id: string }
  | { name: 'print-statement'; id: string }
  | { name: 'print-receipt'; id: string }
  | { name: 'print-invoices'; ids: string[] }
  | { name: 'reports'; tab: ReportTab; period: PeriodSpec; /** Stock valuation date; null means today. */ asOf: string | null };

export const REPORT_TABS = ['sales', 'profit', 'margin', 'gst', 'daybook', 'stock', 'movement', 'movers', 'receivables', 'quotes', 'purchases', 'accountbook', 'salespeople'] as const;
export type ReportTab = (typeof REPORT_TABS)[number];

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
      if (parts[1] === 'names') return { name: 'inventory-names' };
      if (parts[1] === 'production') return { name: 'production' };
      if (parts[1] === 'weaver-orders') {
        if (parts[2] === 'new') return { name: 'weaver-order-new', quoteId: params.get('quote') };
        if (parts[2] && parts[3] === 'edit') return { name: 'weaver-order-edit', id };
        if (parts[2]) return { name: 'weaver-order', id };
        return { name: 'weaver-orders' };
      }
      if (parts[1] === 'stock-take') return { name: 'stock-take' };
      if (parts[1] === 'designs' && id) return { name: 'design', id };
      const status = params.get('status');
      return { name: 'inventory', status: status === 'low' || status === 'out' ? status : 'all' };
    }
    case 'invoices': {
      if (parts[1] === 'quick') return { name: 'quick-bill' };
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
      if (parts[1] === 'new') return { name: 'proforma-new', customerId: params.get('customer'), copyFrom: params.get('copy') };
      if (parts[1] && parts[2] === 'edit') return { name: 'proforma-edit', id: decodeURIComponent(parts[1]) };
      if (parts[1]) return { name: 'proforma', id: decodeURIComponent(parts[1]) };
      const status = params.get('status');
      return { name: 'proformas', status: status === 'open' || status === 'expired' || status === 'partial' || status === 'converted' || status === 'lost' || status === 'cancelled' ? status : 'all' };
    }
    case 'credit-notes':
      return parts[1] ? { name: 'credit-note', id: decodeURIComponent(parts[1]) } : { name: 'credit-notes' };
    case 'expenses':
      return { name: 'expenses', category: params.get('category') };
    case 'customers':
      return parts[1] ? { name: 'customer', id: decodeURIComponent(parts[1]) } : { name: 'customers' };
    case 'settings':
      return { name: 'settings', section: (SETTINGS_SECTIONS as readonly string[]).includes(parts[1] ?? '') ? (parts[1] as SettingsSection) : 'business' };
    case 'print':
      if (parts[1] === 'invoice' && id) return { name: 'print-invoice', id };
      if (parts[1] === 'credit-note' && id) return { name: 'print-credit-note', id };
      if (parts[1] === 'slip' && id) return { name: 'print-slip', id };
      if (parts[1] === 'labels') {
        const layout = params.get('layout') ?? '';
        const items = (params.get('items') ?? '').split(',').flatMap((pair) => {
          const [rawId = '', rawCopies = ''] = pair.split(':');
          const copies = Number(rawCopies);
          return rawId && Number.isInteger(copies) && copies > 0 && copies <= 2000 ? [{ variantId: decodeURIComponent(rawId), copies }] : [];
        });
        return { name: 'print-labels', items, layout: layout in LABEL_LAYOUTS ? (layout as LabelLayout) : 'a4-24' };
      }
      if (parts[1] === 'proforma' && id) return { name: 'print-proforma', id };
      if (parts[1] === 'statement' && id) return { name: 'print-statement', id };
      if (parts[1] === 'receipt' && id) return { name: 'print-receipt', id };
      if (parts[1] === 'invoices') return { name: 'print-invoices', ids: (params.get('ids') ?? '').split(',').map(decodeURIComponent).filter(Boolean) };
      return { name: 'dashboard' };
    case 'notifications':
      return { name: 'notifications' };
    case 'payments':
      if (parts[1] === 'dues') return { name: 'dues' };
      if (parts[1] === 'cheques') return { name: 'cheques' };
      if (parts[1] === 'accounts') return { name: 'accounts' };
      if (parts[1] === 'reconcile') return { name: 'reconcile' };
      return { name: 'payments' };
    case 'reports': {
      const tab: ReportTab = (REPORT_TABS as readonly string[]).includes(parts[1] ?? '') ? (parts[1] as ReportTab) : 'sales';
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
    case 'notifications':
      return 'dashboard';
    case 'inventory':
    case 'materials':
    case 'inventory-add':
    case 'inventory-names':
    case 'production':
    case 'weaver-orders':
    case 'weaver-order-new':
    case 'weaver-order-edit':
    case 'weaver-order':
    case 'stock-take':
    case 'design':
      return 'inventory';
    case 'invoices':
    case 'invoice-new':
    case 'invoice':
    case 'quick-bill':
    case 'credit-notes':
    case 'credit-note':
    case 'print-credit-note':
    case 'print-slip':
    case 'print-invoice':
      return 'invoices';
    case 'proformas':
    case 'proforma-new':
    case 'proforma-edit':
    case 'proforma':
    case 'print-proforma':
      return 'proformas';
    case 'print-statement':
      return 'customers';
    case 'print-receipt':
      return 'payments';
    case 'print-invoices':
      return 'invoices';
    case 'print-labels':
      return 'inventory';
    case 'expenses':
      return 'expenses';
    case 'customers':
    case 'customer':
      return 'customers';
    case 'payments':
    case 'dues':
    case 'cheques':
    case 'accounts':
    case 'reconcile':
      return 'payments';
  }
};

export const paths = {
  dashboard: '/dashboard',
  inventory: (status?: 'low' | 'out') => (status ? `/inventory?status=${status}` : '/inventory'),
  materials: '/inventory/materials',
  addSarees: '/inventory/add',
  tidyNames: '/inventory/names',
  printLabels: (items: { variantId: string; copies: number }[], layout: LabelLayout) => `/print/labels?items=${items.map((i) => `${encodeURIComponent(i.variantId)}:${i.copies}`).join(',')}&layout=${layout}`,
  production: '/inventory/production',
  quickBill: '/invoices/quick',
  printSlip: (id: string) => `/print/slip/${encodeURIComponent(id)}`,
  weaverOrders: '/inventory/weaver-orders',
  newWeaverOrder: (quoteId?: string) => (quoteId ? `/inventory/weaver-orders/new?quote=${encodeURIComponent(quoteId)}` : '/inventory/weaver-orders/new'),
  weaverOrder: (id: string) => `/inventory/weaver-orders/${encodeURIComponent(id)}`,
  editWeaverOrder: (id: string) => `/inventory/weaver-orders/${encodeURIComponent(id)}/edit`,
  stockTake: '/inventory/stock-take',
  design: (id: string) => `/inventory/designs/${encodeURIComponent(id)}`,
  creditNotes: '/credit-notes',
  creditNote: (id: string) => `/credit-notes/${encodeURIComponent(id)}`,
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
  editProforma: (id: string) => `/proformas/${encodeURIComponent(id)}/edit`,
  /** A new proforma that starts as a copy of an earlier one: same customer, items, prices, discount and notes; today's date. */
  duplicateProforma: (id: string) => `/proformas/new?copy=${encodeURIComponent(id)}`,
  expenses: (category?: string) => (category ? `/expenses?category=${encodeURIComponent(category)}` : '/expenses'),
  payments: '/payments',
  dues: '/payments/dues',
  notifications: '/notifications',
  cheques: '/payments/cheques',
  accounts: '/payments/accounts',
  reconcile: '/payments/reconcile',
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
  printStatement: (customerId: string) => `/print/statement/${encodeURIComponent(customerId)}`,
  printReceipt: (paymentId: string) => `/print/receipt/${encodeURIComponent(paymentId)}`,
  printInvoices: (ids: string[]) => `/print/invoices?ids=${ids.map(encodeURIComponent).join(',')}`,
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
