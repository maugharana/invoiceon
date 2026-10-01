import { addDays, todayIso } from './gst';

/** An inclusive range of local calendar dates, "YYYY-MM-DD". */
export interface DateRange {
  from: string;
  to: string;
}

export const PERIOD_PRESETS = ['this-month', 'last-month', 'this-quarter', 'this-fy', 'last-fy', 'custom'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_LABEL: Record<PeriodPreset, string> = {
  'this-month': 'This month',
  'last-month': 'Last month',
  'this-quarter': 'This quarter',
  'this-fy': 'This year',
  'last-fy': 'Last year',
  custom: 'Custom',
};

export interface PeriodSpec {
  preset: PeriodPreset;
  /** Only used when preset is 'custom'. */
  from?: string;
  to?: string;
}

const p2 = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${p2(m)}-${p2(d)}`;
const lastDayOf = (y: number, m: number) => new Date(y, m, 0).getDate();

/**
 * Turns a preset into real dates. "Year" is the Indian financial year (1 April – 31 March) and quarters follow it
 * (Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar). Accounts and GST returns are kept on this calendar, so that's what "year" means here.
 */
export function resolvePeriod(spec: PeriodSpec, today: string = todayIso()): DateRange {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const fyStart = m >= 4 ? y : y - 1;

  switch (spec.preset) {
    case 'this-month':
      return { from: ymd(y, m, 1), to: ymd(y, m, lastDayOf(y, m)) };
    case 'last-month': {
      const ly = m === 1 ? y - 1 : y;
      const lm = m === 1 ? 12 : m - 1;
      return { from: ymd(ly, lm, 1), to: ymd(ly, lm, lastDayOf(ly, lm)) };
    }
    case 'this-quarter': {
      // Months since April, in groups of three.
      const offset = (m - 4 + 12) % 12;
      const qStartOffset = Math.floor(offset / 3) * 3;
      const startMonth = ((4 + qStartOffset - 1) % 12) + 1;
      const startYear = startMonth >= 4 ? fyStart : fyStart + 1;
      const endMonthRaw = startMonth + 2;
      const endMonth = endMonthRaw > 12 ? endMonthRaw - 12 : endMonthRaw;
      const endYear = endMonthRaw > 12 ? startYear + 1 : startYear;
      return { from: ymd(startYear, startMonth, 1), to: ymd(endYear, endMonth, lastDayOf(endYear, endMonth)) };
    }
    case 'this-fy':
      return { from: ymd(fyStart, 4, 1), to: ymd(fyStart + 1, 3, 31) };
    case 'last-fy':
      return { from: ymd(fyStart - 1, 4, 1), to: ymd(fyStart, 3, 31) };
    case 'custom': {
      const from = spec.from && /^\d{4}-\d{2}-\d{2}$/.test(spec.from) ? spec.from : ymd(y, m, 1);
      const to = spec.to && /^\d{4}-\d{2}-\d{2}$/.test(spec.to) ? spec.to : today;
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

export const daysInRange = (r: DateRange): number => Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000) + 1;

// ── Comparing with an earlier stretch ───────────────────────────────────────
/** What the dashboard's up/down arrows compare against: the stretch just before, or the same dates a year earlier. */
export const COMPARE_OPTIONS = ['previous', 'last-year'] as const;
export type CompareWith = (typeof COMPARE_OPTIONS)[number];

export const COMPARE_LABEL: Record<CompareWith, string> = { previous: 'Previous period', 'last-year': 'Same dates last year' };

/** The same calendar date a year earlier. 29 February lands on 28 February when the earlier year had no leap day. */
export function sameDayLastYear(isoDate: string): string {
  const year = Number(isoDate.slice(0, 4)) - 1;
  const month = Number(isoDate.slice(5, 7));
  const day = Math.min(Number(isoDate.slice(8, 10)), lastDayOf(year, month));
  return ymd(year, month, day);
}

/** The range the dashboard compares with. "Previous" is the same length, ending the day before this one starts. */
export function comparisonRange(r: DateRange, compare: CompareWith): DateRange {
  if (compare === 'last-year') return { from: sameDayLastYear(r.from), to: sameDayLastYear(r.to) };
  const length = daysInRange(r);
  return { from: addDays(r.from, -length), to: addDays(r.from, -1) };
}

/** Short ranges read best day by day; long ones month by month. */
export const granularityFor = (r: DateRange): 'day' | 'month' => (daysInRange(r) <= 62 ? 'day' : 'month');

/** Every bucket key in the range (empty ones included, so the chart shows quiet days as gaps rather than skipping them). */
export function bucketKeys(r: DateRange, granularity: 'day' | 'month'): string[] {
  const keys: string[] = [];
  if (granularity === 'day') {
    for (let d = r.from; d <= r.to; d = addDays(d, 1)) keys.push(d);
    return keys;
  }
  let y = Number(r.from.slice(0, 4));
  let m = Number(r.from.slice(5, 7));
  const endKey = r.to.slice(0, 7);
  while (`${y}-${p2(m)}` <= endKey) {
    keys.push(`${y}-${p2(m)}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return keys;
}

export const bucketOf = (isoDate: string, granularity: 'day' | 'month'): string => (granularity === 'day' ? isoDate : isoDate.slice(0, 7));

// ── Dashboard trend buckets ─────────────────────────────────────────────────
// The dashboard's trend charts want fewer, rounder points than the Sales report: days for a few weeks, weeks for a few months,
// months beyond that. (Weeks start on Monday and are keyed by that Monday's date.)
export type TrendGranularity = 'day' | 'week' | 'month';

export const trendGranularityFor = (r: DateRange): TrendGranularity => {
  const days = daysInRange(r);
  return days <= 21 ? 'day' : days <= 182 ? 'week' : 'month';
};

/** The Monday on or before a date. */
export function weekStart(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(isoDate, -back);
}

export const trendBucketOf = (isoDate: string, g: TrendGranularity): string => (g === 'day' ? isoDate : g === 'week' ? weekStart(isoDate) : isoDate.slice(0, 7));

/** Every bucket key from the range's start to its end, quiet ones included. */
export function trendKeys(r: DateRange, g: TrendGranularity): string[] {
  if (g === 'month') return bucketKeys(r, 'month');
  const keys: string[] = [];
  const step = g === 'day' ? 1 : 7;
  for (let d = g === 'day' ? r.from : weekStart(r.from); d <= r.to; d = addDays(d, step)) keys.push(d);
  return keys;
}
