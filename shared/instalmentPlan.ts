import { addDays } from './gst';
import type { InstalmentInput } from './types';

/**
 * Splits an amount into `count` instalments `gapDays` apart, the first one `gapDays` after `from`. Paise that do not divide evenly
 * are spread one each over the first instalments, so the parts always add up to exactly the total.
 */
export function splitInstalments(totalPaise: number, count: number, from: string, gapDays: number): InstalmentInput[] {
  const n = Math.max(1, Math.floor(count));
  const base = Math.floor(totalPaise / n);
  const extra = totalPaise - base * n;
  return Array.from({ length: n }, (_, i) => ({ dueDate: addDays(from, gapDays * (i + 1)), amountPaise: base + (i < extra ? 1 : 0) }));
}
