import { addDays, formatDate } from '../../shared/gst';
import { formatMoney } from '../../shared/money';
import type { AttentionItem } from '../../shared/types';
import { all, type Db } from '../db/connection';
import { listDesigns, loadVariants } from './inventory';
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

/** What the owner should look at today, most urgent first, capped so the list stays a glance rather than a chore. */
export function attentionItems(db: Db, today: string): AttentionItem[] {
  return [...reversedPayments(db, today), ...expiringQuotes(db, today), ...belowCost(db)].slice(0, MAX_ITEMS);
}
