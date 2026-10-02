import { addDays, formatDate } from '../../shared/gst';
import { occasionLabel, upcomingOccasions } from '../../shared/occasions';
import { formatMoney } from '../../shared/money';
import type { AttentionItem } from '../../shared/types';
import { all, type Db } from '../db/connection';
import { listDesigns, loadVariants } from './inventory';
import { listCustomers } from './customers';
import { openDueNotes } from './notes';
import { listProformas } from './proformas';

/** A payment reversed within this many days still needs a look: the invoice it paid owes the money again. */
export const REVERSED_WITHIN_DAYS = 30;
/** A quote this close to lapsing is worth a nudge. */
export const QUOTE_WARNING_DAYS = 3;
const MAX_ITEMS = 8;

const money = (paise: number) => formatMoney(paise, { fractionDigits: 0 });
const when = (days: number) => (days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
/** The ledger keeps UTC timestamps; people think in their own calendar day, which near midnight can be a different one. */
export function localDate(timestamp: string): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function reversedPayments(db: Db, today: string): AttentionItem[] {
  const rows = all<{ id: string; customer_id: string | null; name: string | null; amount_paise: number; void_reason: string; voided_at: string }>(
    db,
    `SELECT p.id, p.customer_id, c.name, p.amount_paise, p.void_reason, p.voided_at
     FROM payments p LEFT JOIN customers c ON c.id = p.customer_id
     WHERE p.voided_at IS NOT NULL AND p.voided_at >= ? ORDER BY p.voided_at DESC LIMIT ?`,
    addDays(today, -REVERSED_WITHIN_DAYS),
    MAX_ITEMS,
  );
  return rows.map((p) => ({
    kind: 'payment-reversed',
    id: `payment-reversed:${p.id}`,
    title: `${money(p.amount_paise)} from ${p.name ?? 'a walk-in customer'} was reversed`,
    detail: p.void_reason ? `${p.void_reason} · ${formatDate(localDate(p.voided_at))}` : `The invoices it paid owe it again · ${formatDate(localDate(p.voided_at))}`,
    link: p.customer_id ? { to: 'customer', id: p.customer_id } : { to: 'payments' },
  }));
}

function expiringQuotes(db: Db, today: string): AttentionItem[] {
  const last = addDays(today, QUOTE_WARNING_DAYS);
  return listProformas(db, { status: 'open' })
    .filter((p) => p.validUntil >= today && p.validUntil <= last)
    .sort((a, b) => a.validUntil.localeCompare(b.validUntil))
    .map((p) => ({
      kind: 'quote-expiring',
      id: `quote-expiring:${p.id}`,
      title: `Quote ${p.number} for ${p.buyerName} lapses ${when(daysBetween(today, p.validUntil))}`,
      detail: `${money(p.totalPaise)} · valid until ${formatDate(p.validUntil)}`,
      link: { to: 'proforma', id: p.id },
    }));
}

/** A variant priced below what it costs loses money on every sale: usually a price not updated after a material got dearer. */
function belowCost(db: Db): AttentionItem[] {
  const names = new Map(listDesigns(db).map((d) => [d.id, d.name]));
  const byDesign = new Map<string, ReturnType<typeof loadVariants>>();
  for (const v of loadVariants(db)) {
    if (v.sellPricePaise > 0 && v.unitCostPaise > v.sellPricePaise) byDesign.set(v.designId, [...(byDesign.get(v.designId) ?? []), v]);
  }
  return [...byDesign.entries()]
    .filter(([designId]) => names.has(designId))
    .map(([designId, variants]) => {
      const worst = variants.reduce((a, b) => (b.unitCostPaise - b.sellPricePaise > a.unitCostPaise - a.sellPricePaise ? b : a));
      return {
        kind: 'below-cost' as const,
        id: `below-cost:${designId}`,
        title: `${names.get(designId)} sells below cost`,
        detail: `${worst.color} ${worst.size}: priced ${money(worst.sellPricePaise)}, costs ${money(worst.unitCostPaise)}${variants.length > 1 ? ` · ${variants.length - 1} more` : ''}`,
        link: { to: 'design' as const, id: designId },
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** Follow-ups due and promises to pay that have come round (or been missed). */
function dueNotes(db: Db, today: string): AttentionItem[] {
  return openDueNotes(db, { onOrBefore: today }).map((n) => {
    const late = n.dueDate !== null && n.dueDate < today;
    const about = n.subjectLabel ? ` (${n.subjectLabel})` : '';
    return {
      kind: n.kind === 'promise' ? ('promise' as const) : ('follow-up' as const),
      id: `note:${n.id}`,
      title: n.kind === 'promise' ? `${n.customerName} promised ${money(n.amountPaise)}${late ? ' and it is overdue' : ' for today'}` : `Follow up with ${n.customerName}${about}`,
      detail: [n.body, n.dueDate ? (late ? `was due ${formatDate(n.dueDate)}` : 'due today') : ''].filter(Boolean).join(' · '),
      link: n.customerId ? { to: 'customer' as const, id: n.customerId } : { to: 'payments' as const },
    };
  });
}

/** Customers' birthdays and anniversaries in the next few days, so a message can go out before the day. */
export const OCCASION_WARNING_DAYS = 3;
function occasions(db: Db, today: string): AttentionItem[] {
  const items: (AttentionItem & { days: number })[] = [];
  for (const c of listCustomers(db)) {
    for (const o of upcomingOccasions(c, today, OCCASION_WARNING_DAYS)) {
      items.push({
        kind: 'occasion',
        id: `occasion:${c.id}:${o.kind}`,
        title: `${c.name}'s ${occasionLabel(o.kind).toLowerCase()} is ${when(o.daysAway)}`,
        detail: c.phone ? `A greeting goes down well · ${c.phone}` : 'A greeting goes down well',
        link: { to: 'customer', id: c.id },
        days: o.daysAway,
      });
    }
  }
  return items.sort((a, b) => a.days - b.days || a.title.localeCompare(b.title)).map(({ days: _days, ...item }) => item);
}

/** What the owner should look at today, most urgent first, capped so the list stays a glance rather than a chore. */
export function attentionItems(db: Db, today: string): AttentionItem[] {
  return [...reversedPayments(db, today), ...dueNotes(db, today), ...expiringQuotes(db, today), ...occasions(db, today), ...belowCost(db)].slice(0, MAX_ITEMS);
}
