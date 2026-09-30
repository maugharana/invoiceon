import { allocate, taxByRate, type RateTotals } from './gst';
import type { Paise } from './money';

// The maths of a credit note that both the server (when it is issued) and the New credit note screen (as a live preview) use,
// so the figure shown while ticking boxes is the figure that gets saved.

/**
 * What one returned line credits before tax. The invoice's discount is spread over its lines, so a piece is credited at what the
 * customer really paid. Worked out cumulatively, so credits over several visits add up to exactly the line's value.
 */
export function creditedTaxable(lineNetPaise: Paise, lineQty: number, alreadyReturned: number, returning: number): Paise {
  const upTo = (q: number) => Math.round((lineNetPaise * q) / lineQty);
  return upTo(alreadyReturned + returning) - upTo(alreadyReturned);
}

/** Each invoice line's value after its share of the invoice discount. */
export function lineNetAmounts(lineAmounts: Paise[], discountPaise: Paise): Paise[] {
  const shares = allocate(discountPaise, lineAmounts);
  return lineAmounts.map((a, i) => a - shares[i]!);
}

export interface CreditPreview extends RateTotals {}

export function previewCredit(items: { taxablePaise: Paise; ratePercent: number }[], intraState: boolean): CreditPreview {
  return taxByRate(items, intraState);
}

/** How a credit note's total is split: refunded now, set against what is still owed, and the rest held for the customer. */
export function splitCredit(totalPaise: Paise, refundPaise: Paise, outstandingPaise: Paise): { refund: Paise; toInvoice: Paise; held: Paise } {
  const refund = Math.min(Math.max(refundPaise, 0), totalPaise);
  const booked = totalPaise - refund;
  const toInvoice = Math.max(0, Math.min(booked, outstandingPaise));
  return { refund, toInvoice, held: booked - toInvoice };
}
