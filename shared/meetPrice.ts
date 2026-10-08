import { computeInvoice, type PricedLine, type RoundOff } from './gst';
import type { Paise } from './money';

// "Meet at a price": the customer has agreed to pay a round figure, and the bill has to come to exactly that. The maths is the same
// one the saved invoice uses (computeInvoice), searched for the discount that gets the grand total to the figure, so what the
// screen promises is what is issued, GST and round-off included.

export interface MeetBill {
  lines: PricedLine[];
  intraState: boolean;
  inclusive?: boolean;
  roundOff?: RoundOff;
  /** Discount that is already spoken for and stays (loyalty points being spent). */
  otherDiscountPaise?: Paise;
}

export interface MeetResult {
  /** The discount on the whole bill that brings the total to (or as near as possible under) the figure. */
  discountPaise: Paise;
  /** What the bill then comes to. */
  totalPaise: Paise;
  /** What it comes to with no discount on the whole bill. */
  fullTotalPaise: Paise;
  /** False when the figure is above the bill, or lower than a discount can take it. */
  reachable: boolean;
}

const totalAt = (bill: MeetBill, discountPaise: Paise) =>
  computeInvoice({ lines: bill.lines, discountPaise: (bill.otherDiscountPaise ?? 0) + discountPaise, intraState: bill.intraState, inclusive: bill.inclusive, roundOff: bill.roundOff });

/** What can still be taken off the bill as a whole: the lines after their own discounts, less what is already spoken for. */
const room = (bill: MeetBill): Paise => Math.max(0, bill.lines.reduce((s, l) => s + l.amountPaise - Math.min(Math.max(l.discountPaise ?? 0, 0), l.amountPaise), 0) - (bill.otherDiscountPaise ?? 0));

/**
 * The discount that makes the grand total `targetPaise`. The total only ever falls as the discount grows, so this halves the range
 * until it finds the smallest discount that is low enough, then steps back over any rounding wrinkle so it is the smallest of all.
 */
export function discountForTarget(bill: MeetBill, targetPaise: Paise): MeetResult {
  const full = totalAt(bill, 0).totalPaise;
  if (targetPaise >= full) return { discountPaise: 0, totalPaise: full, fullTotalPaise: full, reachable: targetPaise === full };
  const max = room(bill);
  const floor = totalAt(bill, max).totalPaise;
  if (floor > targetPaise) return { discountPaise: max, totalPaise: floor, fullTotalPaise: full, reachable: false };
  let lo = 0;
  let hi = max;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (totalAt(bill, mid).totalPaise <= targetPaise) hi = mid;
    else lo = mid + 1;
  }
  let d = lo;
  while (d > 0 && totalAt(bill, d - 1).totalPaise <= targetPaise) d--;
  return { discountPaise: d, totalPaise: totalAt(bill, d).totalPaise, fullTotalPaise: full, reachable: true };
}

/**
 * The lowest the bill can go without selling below cost: the largest discount that still leaves the sales value (before GST) at or
 * above what the pieces cost. Null when the bill is already below cost with no discount on the whole.
 */
export function lowestSafe(bill: MeetBill, costPaise: Paise): { discountPaise: Paise; totalPaise: Paise } | null {
  if (totalAt(bill, 0).taxablePaise < costPaise) return null;
  let lo = 0;
  let hi = room(bill);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (totalAt(bill, mid).taxablePaise >= costPaise) lo = mid;
    else hi = mid - 1;
  }
  return { discountPaise: lo, totalPaise: totalAt(bill, lo).totalPaise };
}

/** Round figures just under the total, so the usual "make it ₹27,000" is one tap: the next hundred, five hundred, thousand and five thousand down. */
export function roundFigures(totalPaise: Paise): Paise[] {
  const out = new Set<Paise>();
  for (const step of [100_00, 500_00, 1000_00, 5000_00]) {
    const figure = Math.floor((totalPaise - 1) / step) * step;
    if (figure > 0) out.add(figure);
  }
  return [...out].sort((a, b) => b - a);
}

/** What the pieces on a bill cost in all: quantity times the cost of each, for the lines whose cost is known. */
export function billCost(lines: { qty: number; unitCostPaise: Paise | null }[]): { costPaise: Paise; known: boolean } {
  let costPaise = 0;
  let known = lines.length > 0;
  for (const l of lines) {
    if (l.unitCostPaise === null || l.unitCostPaise <= 0) known = false; // a cost of nothing is a cost never entered
    else costPaise += l.qty * l.unitCostPaise;
  }
  return { costPaise, known };
}
