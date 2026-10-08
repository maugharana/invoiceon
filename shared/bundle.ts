import { allocate } from './gst';
import type { Paise } from './money';
import type { RepeatSourceLine } from './repeatBill';

// A bundle is a saved set of items that is sold together at a price of its own (a saree with its blouse piece and fall, say). The
// price is kept as a discount on each item, worked out once when the bundle is saved, so adding it to a bill is just adding its items.

export interface BundleLine {
  variantId: string;
  qty: number;
  unitPricePaise: Paise;
  /** Taken off this item, in paise. */
  discountPaise?: Paise;
}

/** What the items come to at their list prices, before any discount. */
export const bundleGross = (lines: BundleLine[]): Paise => lines.reduce((sum, l) => sum + l.qty * l.unitPricePaise, 0);

/** What the bundle sells for: the items at their prices, less each item's discount. */
export const bundleNet = (lines: BundleLine[]): Paise => bundleGross(lines) - lines.reduce((sum, l) => sum + (l.discountPaise ?? 0), 0);

/**
 * Gives the bundle a price of its own: whatever the items come to at list price above `targetPaise` is taken off as a discount, shared
 * over the items by their value to the exact paisa. The bundle's price replaces any discounts the items had. Null when the price is
 * more than the items come to at list price (a bundle is a saving, not a surcharge) or is negative.
 */
export function priceBundle(lines: BundleLine[], targetPaise: Paise): BundleLine[] | null {
  const gross = lines.map((l) => l.qty * l.unitPricePaise);
  const total = gross.reduce((a, b) => a + b, 0);
  if (!Number.isInteger(targetPaise) || targetPaise < 0 || targetPaise > total) return null;
  const shares = allocate(total - targetPaise, gross);
  return lines.map((l, i) => ({ variantId: l.variantId, qty: l.qty, unitPricePaise: l.unitPricePaise, discountPaise: Math.min(shares[i]!, gross[i]!) }));
}

/** A bundle's items shaped like an earlier bill's, so they are added to a new bill by the same rules (stock, cut quantities, what is gone). */
export function bundleSource(lines: BundleLine[], names: Map<string, { designName: string; color: string; size: string }>): RepeatSourceLine[] {
  return lines.map((l) => {
    const n = names.get(l.variantId);
    return { variantId: l.variantId, designName: n?.designName ?? 'An item', color: n?.color ?? '', size: n?.size ?? '', qty: l.qty, unitPricePaise: l.unitPricePaise, discountPaise: l.discountPaise ?? 0, note: '' };
  });
}
