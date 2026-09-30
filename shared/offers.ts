// Offers (a named discount with rules) and loyalty points. The maths lives here, in one place, so the invoice screen's preview and the
// data layer that really issues the invoice can never disagree about what an offer or a point is worth.

import type { Paise } from './money';

export type OfferKind = 'percent' | 'flat';

export interface Offer {
  id: string;
  name: string;
  kind: OfferKind;
  /** A percentage (0 to 100) for 'percent', or paise for 'flat'. */
  value: number;
  /** The bill must come to at least this much (before any discount). 0 for no minimum. */
  minBillPaise: Paise;
  /** Only this design's pieces are discounted, or null for the whole bill. */
  designId: string | null;
  /** First and last day it can be used. No end date means it runs until switched off. */
  startDate: string;
  endDate: string | null;
  active: boolean;
  createdAt: string;
}

export interface OfferInput {
  name: string;
  kind: OfferKind;
  value: number;
  minBillPaise: Paise;
  designId: string | null;
  startDate: string;
  endDate: string | null;
  active: boolean;
}

export interface OfferLine {
  designId: string | null;
  amountPaise: Paise;
}

/** Whether the offer can be used on this date. */
export const isOfferLive = (o: Pick<Offer, 'active' | 'startDate' | 'endDate'>, date: string): boolean => o.active && date >= o.startDate && (o.endDate === null || date <= o.endDate);

/** What the offer takes off this bill, in paise. 0 when it does not apply (too small a bill, or none of the design on it). */
export function offerDiscount(o: Pick<Offer, 'kind' | 'value' | 'minBillPaise' | 'designId'>, lines: OfferLine[]): Paise {
  const subtotal = lines.reduce((s, l) => s + l.amountPaise, 0);
  if (subtotal <= 0 || subtotal < o.minBillPaise) return 0;
  const base = o.designId ? lines.filter((l) => l.designId === o.designId).reduce((s, l) => s + l.amountPaise, 0) : subtotal;
  if (base <= 0) return 0;
  return o.kind === 'percent' ? Math.min(base, Math.round((base * o.value) / 100)) : Math.min(base, Math.round(o.value));
}

/** Plain words for what an offer does, for lists and invoices. */
export function describeOffer(o: Pick<Offer, 'kind' | 'value' | 'minBillPaise'>, money: (p: Paise) => string): string {
  const what = o.kind === 'percent' ? `${+o.value.toFixed(2)}% off` : `${money(Math.round(o.value))} off`;
  return o.minBillPaise > 0 ? `${what} on bills of ${money(o.minBillPaise)} or more` : what;
}

// ── Loyalty ─────────────────────────────────────────────────────────────────
export interface LoyaltyConfig {
  enabled: boolean;
  /** Points earned for every ₹100 of taxable value, after any discount. */
  pointsPer100: number;
  /** What one point is worth when spent, in paise. */
  paisePerPoint: Paise;
  /** The fewest points that can be spent at once. */
  minRedeem: number;
}

export const DEFAULT_LOYALTY: LoyaltyConfig = { enabled: false, pointsPer100: 1, paisePerPoint: 100, minRedeem: 50 };

/** Points earned on a sale: whole points only. */
export const loyaltyEarned = (taxablePaise: Paise, pointsPer100: number): number => Math.max(0, Math.floor((taxablePaise * pointsPer100) / 10_000));

export const loyaltyValue = (points: number, paisePerPoint: Paise): Paise => points * paisePerPoint;

export type LoyaltyKind = 'earn' | 'redeem' | 'reverse-earn' | 'reverse-redeem' | 'return' | 'reverse-return' | 'adjust';

export const LOYALTY_KIND_LABEL: Record<LoyaltyKind, string> = {
  earn: 'Earned on a purchase',
  redeem: 'Spent on a purchase',
  'reverse-earn': 'Taken back (invoice cancelled)',
  'reverse-redeem': 'Returned (invoice cancelled)',
  return: 'Taken back (goods returned)',
  'reverse-return': 'Given back (credit note cancelled)',
  adjust: 'Adjusted by hand',
};

export interface LoyaltyEntry {
  id: string;
  kind: LoyaltyKind;
  /** Positive adds to the balance, negative takes away. */
  points: number;
  note: string;
  invoiceNumber: string | null;
  createdAt: string;
}

export interface LoyaltyAccount {
  points: number;
  valuePaise: Paise;
  entries: LoyaltyEntry[];
}
