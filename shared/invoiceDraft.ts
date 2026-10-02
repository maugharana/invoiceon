import { PAYMENT_METHODS } from './types';
import type { InvoiceType, PaymentMethod } from './types';

/** An invoice that was being built when the app was closed or crashed. Nothing in it has touched stock or money. */
export interface InvoiceDraft {
  savedAt: string;
  type: InvoiceType;
  customerId: string | null;
  buyerName: string;
  issueDate: string;
  dueDate: string;
  discountPaise: number;
  notes: string;
  lines: { variantId: string; qty: string; price: number; /** Taken off this line, in paise. */ discount?: number; /** A GST rate typed for this line; empty = worked out. */ rate?: string; note?: string }[];
  /** What was being handed over as the invoice was made. */
  receivedPaise: number;
  payMethod: PaymentMethod;
}

const text = (v: unknown, max = 500): string => (typeof v === 'string' ? v.slice(0, max) : '');
const paise = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100_000_000_000 ? v : 0);
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Reads a saved draft back, checking every field, because it comes from a file that may be old, damaged, or from another version.
 * Returns null when there's nothing worth restoring (no items and no customer).
 */
export function parseInvoiceDraft(raw: unknown): InvoiceDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const lines = (Array.isArray(d.lines) ? d.lines : [])
    .map((l): InvoiceDraft['lines'][number] | null => {
      if (!l || typeof l !== 'object') return null;
      const { variantId, qty, price, discount, rate, note } = l as Record<string, unknown>;
      if (typeof variantId !== 'string' || !variantId) return null;
      return { variantId, qty: text(qty, 8) || '1', price: paise(price), discount: paise(discount), rate: /^\d{1,3}(\.\d{1,2})?$/.test(text(rate, 6)) ? text(rate, 6) : '', note: text(note, 120) };
    })
    .filter((l): l is InvoiceDraft['lines'][number] => l !== null)
    .slice(0, 200);
  const customerId = typeof d.customerId === 'string' && d.customerId ? d.customerId : null;
  if (lines.length === 0 && !customerId) return null;
  const method = d.payMethod as PaymentMethod;
  return {
    savedAt: typeof d.savedAt === 'string' ? d.savedAt : '',
    type: d.type === 'B2B' ? 'B2B' : 'B2C',
    customerId,
    buyerName: text(d.buyerName, 120),
    issueDate: isDate(d.issueDate) ? d.issueDate : '',
    dueDate: isDate(d.dueDate) ? d.dueDate : '',
    discountPaise: paise(d.discountPaise),
    notes: text(d.notes),
    lines,
    receivedPaise: paise(d.receivedPaise),
    payMethod: (PAYMENT_METHODS as readonly string[]).includes(method) ? method : 'cash',
  };
}
