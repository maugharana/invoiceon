// What to make or buy next, and what is sitting on the shelf. The rules are plain and stated in the README: a piece's speed of selling over
// the recent past, looked forward over how long a new batch takes and how long you want it to last.

import type { Paise } from './money';

export interface InsightParams {
  /** How far back to look at sales. */
  lookbackDays: number;
  /** How long a new batch takes to arrive (a weaver's time, say). */
  leadDays: number;
  /** How many days of sales a new batch should cover once it arrives. */
  coverDays: number;
  /** Stock that has not sold for this long counts as dead. */
  deadDays: number;
}

export const DEFAULT_INSIGHTS: InsightParams = { lookbackDays: 90, leadDays: 21, coverDays: 30, deadDays: 90 };

export interface ReorderRow {
  variantId: string;
  designId: string;
  designName: string;
  color: string;
  size: string;
  sku: string;
  stock: number;
  /** Pieces kept in another place, which count as on hand. */
  elsewhere: number;
  /** Pieces already ordered from weavers and not yet received. */
  onOrder: number;
  soldInPeriod: number;
  /** Pieces sold a day, over the look-back period. */
  perDay: number;
  /** Days the stock lasts at that speed, or null when nothing has been selling. */
  daysOfCover: number | null;
  /** How many to make or buy. */
  suggestedQty: number;
  /** It will run out before a new batch could arrive. */
  urgent: boolean;
  unitCostPaise: Paise;
  /** What the suggested batch would cost at today's cost per piece. */
  costOfBatchPaise: Paise;
}

export interface DeadStockRow {
  variantId: string;
  designId: string;
  designName: string;
  color: string;
  size: string;
  sku: string;
  stock: number;
  lastSoldOn: string | null;
  /** Days since the last sale, or since it was added when it has never sold. */
  idleDays: number;
  unitCostPaise: Paise;
  /** Cost of the pieces sitting there. */
  tiedUpPaise: Paise;
  sellPricePaise: Paise;
}

export interface StockInsights {
  params: InsightParams;
  asOf: string;
  reorder: ReorderRow[];
  dead: DeadStockRow[];
  totals: { urgent: number; reorderPieces: number; reorderCostPaise: Paise; deadPieces: number; deadTiedUpPaise: Paise };
}

/** Pieces sold a day. */
export const perDay = (sold: number, lookbackDays: number): number => (lookbackDays > 0 ? sold / lookbackDays : 0);

/**
 * How many to bring in: enough for the lead time plus the days you want a batch to cover, less what is on the shelf and already ordered.
 * A piece with a reorder level is never allowed to sit below it, even when it has not been selling.
 */
export function suggestedQty(o: { stock: number; onOrder: number; perDay: number; reorderLevel: number; leadDays: number; coverDays: number }): number {
  const target = Math.max(Math.ceil(o.perDay * (o.leadDays + o.coverDays)), o.reorderLevel);
  return Math.max(0, target - o.stock - o.onOrder);
}

/** Days the stock lasts at the current speed. Null when nothing is selling, so it is not reported as "forever". */
export const daysOfCover = (stock: number, rate: number): number | null => (rate > 0 ? stock / rate : null);

/** It will be gone before a new batch could arrive: already out, or less than the lead time left. Only for things that sell. */
export const isUrgent = (stock: number, rate: number, leadDays: number, onOrder: number): boolean => rate > 0 && onOrder === 0 && (stock === 0 || stock / rate < leadDays);

export function checkParams(input: Partial<InsightParams> | undefined): InsightParams {
  const take = (v: unknown, fallback: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
  };
  return {
    lookbackDays: take(input?.lookbackDays, DEFAULT_INSIGHTS.lookbackDays, 7, 730),
    leadDays: take(input?.leadDays, DEFAULT_INSIGHTS.leadDays, 0, 365),
    coverDays: take(input?.coverDays, DEFAULT_INSIGHTS.coverDays, 1, 365),
    deadDays: take(input?.deadDays, DEFAULT_INSIGHTS.deadDays, 7, 730),
  };
}
