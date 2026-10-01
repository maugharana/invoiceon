import { formatDate } from './gst';
import { formatMoney } from './money';
import type { ReorderRow } from './types';

/**
 * A phone number as WhatsApp wants it: digits only, with the country code. A bare 10-digit number is taken to be Indian,
 * and so is one with a leading 0. Returns null when it can't be a phone number.
 */
export function whatsappPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

/** Opens a chat with the number and the message ready to send. */
export const whatsappLink = (phone: string, text: string): string => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;

/** A polite nudge about a quote that hasn't been answered. */
export function quoteReminder(q: { number: string; buyerName: string; totalPaise: number; validUntil: string }, businessName: string): string {
  const name = q.buyerName && q.buyerName !== 'Walk-in customer' ? q.buyerName : 'there';
  return [
    `Hello ${name},`,
    `A gentle reminder about our quote ${q.number} for ${formatMoney(q.totalPaise, { fractionDigits: 0 })}, which is valid until ${formatDate(q.validUntil)}.`,
    `Please let us know if you would like to go ahead, or if you'd like anything changed.`,
    businessName ? `Thank you, ${businessName}` : 'Thank you',
  ].join('\n\n');
}

/** What to order, grouped by saree, ready to paste into a message to the supplier or weaver. */
export function reorderNote(rows: ReorderRow[], businessName: string, today: string): string {
  if (rows.length === 0) return 'Nothing needs reordering.';
  const byDesign = new Map<string, ReorderRow[]>();
  for (const r of rows) byDesign.set(r.designId, [...(byDesign.get(r.designId) ?? []), r]);
  const lines = [...byDesign.values()].map((variants) => {
    const first = variants[0]!;
    const title = first.nickname ? `${first.designName} (${first.nickname})` : first.designName;
    const items = variants.map((v) => `  - ${v.color}, ${v.size}: ${v.stock <= 0 ? 'out of stock' : `${v.stock} left`}${v.reorderLevel > 0 ? ` (reorder at ${v.reorderLevel})` : ''}`);
    return [title, ...items].join('\n');
  });
  return [`Reorder list${businessName ? ` — ${businessName}` : ''} — ${formatDate(today)}`, ...lines].join('\n\n');
}

/** A friendly message to send with an invoice: what it's for, what is still owed and by when, and where to pay. */
export function invoiceMessage(inv: { number: string; buyerName: string; totalPaise: number; paidPaise: number; dueDate: string | null }, seller: { name: string; upiId: string }): { subject: string; body: string } {
  const name = inv.buyerName && inv.buyerName !== 'Walk-in customer' ? inv.buyerName : 'there';
  const owed = inv.totalPaise - inv.paidPaise;
  const money = (p: number) => formatMoney(p, { fractionDigits: p % 100 === 0 ? 0 : 2 });
  const lines = [`Hello ${name},`, `Thank you for shopping with ${seller.name || 'us'}. Your invoice ${inv.number} for ${money(inv.totalPaise)} is attached.`];
  if (owed <= 0) lines.push('It has been paid in full. Thank you!');
  else {
    lines.push(`${inv.paidPaise > 0 ? `We have received ${money(inv.paidPaise)}. ` : ''}The balance of ${money(owed)} is due${inv.dueDate ? ` by ${formatDate(inv.dueDate)}` : ''}.`);
    if (seller.upiId) lines.push(`You can pay by UPI to ${seller.upiId}, or scan the QR code on the invoice.`);
  }
  lines.push(seller.name ? `Warm regards, ${seller.name}` : 'Thank you');
  return { subject: `Invoice ${inv.number}${seller.name ? ` from ${seller.name}` : ''}`, body: lines.join('\n\n') };
}

/** A link that opens the person's mail program with the message ready to send. */
export const mailtoLink = (to: string, subject: string, body: string): string => `mailto:${encodeURIComponent(to.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

/** A polite reminder to a customer with money overdue. */
export function dueReminder(d: { customerName: string; owedPaise: number; overduePaise: number; openInvoices: number; oldestDueDate: string | null }, seller: { name: string; upiId: string }): string {
  const money = (p: number) => formatMoney(p, { fractionDigits: p % 100 === 0 ? 0 : 2 });
  const lines = [`Hello ${d.customerName},`];
  lines.push(
    d.overduePaise > 0 && d.overduePaise < d.owedPaise
      ? `A gentle reminder: ${money(d.overduePaise)} of the ${money(d.owedPaise)} you owe us is now overdue${d.oldestDueDate ? `, the oldest since ${formatDate(d.oldestDueDate)}` : ''}.`
      : `A gentle reminder that ${money(d.owedPaise)} is pending${d.openInvoices > 1 ? ` across ${d.openInvoices} invoices` : ''}${d.oldestDueDate ? `, the oldest due on ${formatDate(d.oldestDueDate)}` : ''}.`,
  );
  if (seller.upiId) lines.push(`You can pay by UPI to ${seller.upiId}.`);
  lines.push('If you have already paid, please ignore this message and accept our thanks.');
  lines.push(seller.name ? `Warm regards, ${seller.name}` : 'Thank you');
  return lines.join('\n\n');
}
