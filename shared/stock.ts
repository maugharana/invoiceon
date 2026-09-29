// 'empty' only applies to a design that has no variants yet.
export type StockStatus = 'ok' | 'low' | 'out' | 'empty';

/** A variant is out at zero, and low at or below its reorder level (a level of 0 never triggers "low"). */
export function variantStatus(stock: number, reorderLevel: number): Exclude<StockStatus, 'empty'> {
  if (stock <= 0) return 'out';
  if (stock <= reorderLevel) return 'low';
  return 'ok';
}

/** A design is out only when every variant is out; low when any variant needs restocking. */
export function designStatus(variants: { stock: number; reorderLevel: number }[]): StockStatus {
  if (variants.length === 0) return 'empty';
  const statuses = variants.map((v) => variantStatus(v.stock, v.reorderLevel));
  if (statuses.every((s) => s === 'out')) return 'out';
  if (statuses.some((s) => s === 'low' || s === 'out')) return 'low';
  return 'ok';
}

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  ok: 'In stock',
  low: 'Low stock',
  out: 'Out of stock',
  empty: 'No variants',
};
