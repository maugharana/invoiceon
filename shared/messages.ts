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
