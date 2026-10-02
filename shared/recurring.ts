import { isIsoDate } from './gst';
import type { RecurringFrequency } from './types';

const MONTHS: Record<Exclude<RecurringFrequency, 'weekly'>, number> = { monthly: 1, quarterly: 3, yearly: 12 };

/**
 * The day after `date` that a standing expense falls due. Monthly, quarterly and yearly keep to the day of the month the series
 * started on (`anchor`), so "the 31st" becomes the last day of a short month and goes back to the 31st afterwards, rather than
 * drifting to the 28th for good.
 */
export function nextOccurrenceOf(date: string, frequency: RecurringFrequency, anchor: string = date): string {
  if (!isIsoDate(date)) throw new Error(`Not a date: ${date}`);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  if (frequency === 'weekly') {
    const t = new Date(Date.UTC(y, m - 1, d + 7));
    return t.toISOString().slice(0, 10);
  }
  const anchorDay = isIsoDate(anchor) ? Number(anchor.slice(8, 10)) : d;
  const total = y * 12 + (m - 1) + MONTHS[frequency];
  const year = Math.floor(total / 12);
  const month = total % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(anchorDay, lastDay);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
