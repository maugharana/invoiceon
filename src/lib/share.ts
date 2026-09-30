import { formatDate } from '../../shared/gst';
import { formatMoney } from '../../shared/money';
import { renderTemplate } from '../../shared/share';
import type { DuesRow, Invoice, InvoiceSummary, Settings } from '../../shared/types';

const rupees = (paise: number) => formatMoney(paise, { fractionDigits: 0 });
const upiLine = (s: Settings) => (s.upiId ? `\nYou can pay by UPI to ${s.upiId}.` : '');

/** The message that goes with an invoice, from the shop's template. */
export function invoiceMessage(s: Settings, inv: Invoice): string {
  const balance = inv.totalPaise - inv.paidPaise;
  return renderTemplate(s.shareInvoiceMessage, {
    customer: inv.buyer.name,
    business: s.businessName,
    number: inv.number,
    total: rupees(inv.totalPaise),
    balance: rupees(balance),
    dueDate: inv.dueDate ? formatDate(inv.dueDate) : '',
    dueLine: balance > 0 && inv.dueDate ? ` ${rupees(balance)} is due by ${formatDate(inv.dueDate)}.` : '',
    upi: s.upiId,
    upiLine: balance > 0 ? upiLine(s) : '',
  });
}

export const invoiceSubject = (s: Settings, inv: Invoice): string => renderTemplate(s.shareEmailSubject, { number: inv.number, business: s.businessName, customer: inv.buyer.name });

/** A reminder about one invoice. */
export function invoiceReminder(s: Settings, inv: Invoice): string {
  const balance = inv.totalPaise - inv.paidPaise;
  const overdue = inv.dueDate && inv.dueDate < new Date().toISOString().slice(0, 10);
  return renderTemplate(s.shareReminderMessage, {
    customer: inv.buyer.name,
    business: s.businessName,
    owedLine: `invoice ${inv.number} has ${rupees(balance)} still to pay${inv.dueDate ? `, ${overdue ? 'which was due' : 'due'} on ${formatDate(inv.dueDate)}` : ''}.`,
    invoices: '',
    upiLine: upiLine(s),
    number: inv.number,
    balance: rupees(balance),
  });
}

/** A reminder about everything one customer owes, listing the open invoices. */
export function customerReminder(s: Settings, row: DuesRow, open: InvoiceSummary[]): string {
  const list = open.map((i) => `• ${i.number}: ${rupees(i.totalPaise - i.paidPaise)}${i.dueDate ? ` (due ${formatDate(i.dueDate)})` : ''}`).join('\n');
  const owed = `you have ${rupees(row.outstandingPaise)} outstanding${row.overduePaise > 0 ? `, of which ${rupees(row.overduePaise)} is overdue` : ''}.`;
  return renderTemplate(s.shareReminderMessage, {
    customer: row.customerName,
    business: s.businessName,
    owedLine: owed,
    invoices: list,
    upiLine: upiLine(s),
    balance: rupees(row.outstandingPaise),
  });
}
