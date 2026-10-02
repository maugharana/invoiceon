import { allocate } from './gst';
import type { Invoice } from './types';

/**
 * Each invoice line's own taxable value and tax. Invoices made since lines carried their own figures have them stored; older ones
 * had one rate, so the invoice's figures are shared over its lines by value, to the exact paisa.
 */
export function lineShares(invoice: Invoice): { taxable: number; tax: number }[] {
  if (invoice.lines.every((l) => l.taxablePaise !== null && l.taxPaise !== null)) return invoice.lines.map((l) => ({ taxable: l.taxablePaise!, tax: l.taxPaise! }));
  const weights = invoice.lines.map((l) => Math.max(0, l.amountPaise - l.discountPaise));
  const tax = invoice.cgstPaise + invoice.sgstPaise + invoice.igstPaise;
  const taxable = allocate(invoice.taxablePaise, weights);
  const taxes = allocate(tax, weights);
  return invoice.lines.map((_, i) => ({ taxable: taxable[i]!, tax: taxes[i]! }));
}

