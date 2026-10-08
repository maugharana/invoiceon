import type { Paise } from './money';

// How much is taken off one line of a bill. A discount is either a fixed amount typed or picked in rupees, or a share of the line
// ("10% off") that keeps up when the quantity or price changes. The rules live here, away from the screen, so they can be tested.

export interface LineDiscountInput {
  /** The fixed amount, in paise. For a share it is only what was worked out when it was picked. */
  discountPaise: Paise;
  /** Set when the discount was picked as a percentage of the line. */
  discountPct: number | null;
}

/** A share of an amount, to the nearest paisa. */
export const percentOf = (amountPaise: Paise, percent: number): Paise => Math.round((amountPaise * percent) / 100);

/** What comes off the line now: its share of the line as it stands, or the fixed amount (never more than the line). */
export function lineDiscountPaise(amountPaise: Paise, line: LineDiscountInput): Paise {
  return line.discountPct !== null ? percentOf(amountPaise, line.discountPct) : Math.min(Math.max(line.discountPaise, 0), amountPaise);
}

/**
 * A fixed amount typed for a line that is more than the line itself. A share can never be, and the amount kept alongside it is just
 * what it came to when it was picked (it goes stale when the quantity falls), so it is not looked at.
 */
export const fixedDiscountTooBig = (amountPaise: Paise, line: LineDiscountInput): boolean => line.discountPct === null && line.discountPaise > amountPaise;
