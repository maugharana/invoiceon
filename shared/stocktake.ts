// A physical stock take. The shelves are counted, the count is compared with the books, and only then are the differences applied.

import type { Paise } from './money';

export interface StockTakeLine {
  variantId: string;
  designId: string;
  designName: string;
  color: string;
  size: string;
  sku: string;
  /** What the books say right now. */
  systemNow: number;
  /** What was counted, or null if this saree has not been counted yet. */
  counted: number | null;
  /** What the books said at the moment it was counted. The difference is measured against this. */
  expectedAtCount: number | null;
  /** counted minus expectedAtCount: positive is a surplus, negative a shortage. Null until counted. */
  variance: number | null;
  unitCostPaise: Paise;
}

export interface StockTake {
  id: string;
  name: string;
  status: 'open' | 'applied' | 'cancelled';
  createdAt: string;
  finishedAt: string | null;
  lines: StockTakeLine[];
  totals: StockTakeTotals;
}

export interface StockTakeTotals {
  lines: number;
  counted: number;
  /** Counted and different from the books. */
  differences: number;
  surplusPieces: number;
  shortagePieces: number;
  /** Net effect of all differences at cost. Negative means stock is worth less than the books said. */
  varianceCostPaise: Paise;
}

export interface StockTakeStart {
  name: string;
  /** Count one design only, or null for every saree. */
  designId: string | null;
}

export interface StockTakeSummary {
  id: string;
  name: string;
  status: 'applied' | 'cancelled';
  createdAt: string;
  finishedAt: string | null;
  totals: StockTakeTotals;
}

export interface StockTakeResult {
  take: StockTake;
  /** Adjustments actually made. */
  adjusted: number;
  /** Sarees where the shortage was more than the books now hold (because of sales since the count), so stock was set to zero instead. */
  clamped: string[];
}

/** The difference between the count and the books at the time of counting. */
export const varianceOf = (counted: number | null, expected: number | null): number | null => (counted === null || expected === null ? null : counted - expected);

/** Adjustment to make to the books now: the variance, but never taking stock below zero. */
export const adjustmentFor = (variance: number, systemNow: number): { delta: number; clamped: boolean } => {
  const delta = Math.max(variance, -systemNow);
  return { delta, clamped: delta !== variance };
};
