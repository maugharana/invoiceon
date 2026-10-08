import type { Paise } from './money';

// "Bill the same again": a customer's earlier invoice is turned into the items for a new one. What was bought may no longer be
// available (sold out, or no longer sold at all), so the plan says what can be added, how many, and what was left out and why.

export interface RepeatSourceLine {
  variantId: string;
  designName: string;
  color: string;
  size: string;
  qty: number;
  unitPricePaise: Paise;
  /** Taken off this line, in paise. */
  discountPaise: Paise;
  note: string;
}

export interface RepeatVariant {
  stock: number;
  held: number;
  sellPricePaise: Paise;
}

export interface RepeatItem {
  variantId: string;
  qty: number;
  price: Paise;
  discount: Paise;
  note: string;
}

export interface RepeatPlan {
  items: RepeatItem[];
  /** Left out altogether: no longer sold, or none to sell. */
  skipped: { label: string; reason: 'gone' | 'out' }[];
  /** Added, but fewer than last time because that is all there is. */
  reduced: { label: string; asked: number; got: number }[];
}

const labelOf = (l: RepeatSourceLine): string => `${l.designName} (${[l.color, l.size].filter(Boolean).join(', ')})`;

/**
 * Plans the items of a new bill from an earlier one. `todayPrices` takes each piece's selling price now instead of what was charged,
 * and drops the earlier item discount (it was agreed on that price). A quantity above what is in stock (less what quotes hold) is
 * cut to what is there, with the item discount cut in the same share. A quote can promise pieces that aren't on the shelf yet, so
 * `allowOutOfStock` keeps the full quantity.
 */
export function planRepeat(lines: RepeatSourceLine[], variants: Map<string, RepeatVariant>, opts: { todayPrices: boolean; allowOutOfStock?: boolean; include?: (variantId: string) => boolean }): RepeatPlan {
  const plan: RepeatPlan = { items: [], skipped: [], reduced: [] };
  const seen = new Set<string>();
  for (const l of lines) {
    if (opts.include && !opts.include(l.variantId)) continue;
    if (seen.has(l.variantId)) continue; // one line per piece on any invoice, but be safe
    seen.add(l.variantId);
    const v = variants.get(l.variantId);
    if (!v) {
      plan.skipped.push({ label: labelOf(l), reason: 'gone' });
      continue;
    }
    const room = Math.max(0, v.stock - v.held);
    const qty = opts.allowOutOfStock ? l.qty : Math.min(l.qty, room);
    if (qty <= 0) {
      plan.skipped.push({ label: labelOf(l), reason: 'out' });
      continue;
    }
    if (qty < l.qty) plan.reduced.push({ label: labelOf(l), asked: l.qty, got: qty });
    plan.items.push({
      variantId: l.variantId,
      qty,
      price: opts.todayPrices ? v.sellPricePaise : l.unitPricePaise,
      discount: opts.todayPrices || l.qty === 0 ? 0 : Math.round((l.discountPaise * qty) / l.qty),
      note: l.note,
    });
  }
  return plan;
}

/** One sentence for the person: what was added, and anything that could not be. */
export function repeatMessage(plan: RepeatPlan): string {
  const n = plan.items.length;
  const parts = [n === 0 ? 'Nothing could be added.' : `Added ${n} ${n === 1 ? 'item' : 'items'}.`];
  const out = plan.skipped.filter((s) => s.reason === 'out').map((s) => s.label);
  const gone = plan.skipped.filter((s) => s.reason === 'gone').map((s) => s.label);
  if (out.length > 0) parts.push(`${out.join(', ')} ${out.length === 1 ? 'is' : 'are'} out of stock.`);
  if (gone.length > 0) parts.push(`${gone.join(', ')} ${gone.length === 1 ? 'is' : 'are'} no longer sold.`);
  if (plan.reduced.length > 0) parts.push(`${plan.reduced.map((r) => `${r.label}: only ${r.got} of ${r.asked}`).join('; ')}.`);
  return parts.join(' ');
}
