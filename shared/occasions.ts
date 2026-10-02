import { isIsoDate } from './gst';

/**
 * Birthdays and anniversaries. Stored as a full date (the year may be a placeholder if the customer never said it); only the month
 * and day matter for reminders, which come round every year.
 */

export type OccasionKind = 'birthday' | 'anniversary';

export interface Occasion {
  kind: OccasionKind;
  /** Next time it falls on or after today, as YYYY-MM-DD. */
  date: string;
  daysAway: number;
}

const DAY_MS = 86_400_000;

function utc(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d);
}

/**
 * The next time an annual date (month and day of `stored`) comes round, counting today. 29 February falls on the 28th in years
 * with no leap day. Returns null if the stored date isn't a real date.
 */
export function nextOccurrence(stored: string, today: string): { date: string; daysAway: number } | null {
  if (!isIsoDate(stored) || !isIsoDate(today)) return null;
  const month = Number(stored.slice(5, 7));
  const day = Number(stored.slice(8, 10));
  const [ty, tm, td] = today.split('-').map(Number);
  const on = (year: number) => {
    const d = month === 2 && day === 29 && new Date(Date.UTC(year, 1, 29)).getUTCMonth() !== 1 ? 28 : day;
    return utc(year, month, d);
  };
  const todayMs = utc(ty, tm, td);
  let year = ty;
  let when = on(year);
  if (when < todayMs) {
    year += 1;
    when = on(year);
  }
  return { date: new Date(when).toISOString().slice(0, 10), daysAway: Math.round((when - todayMs) / DAY_MS) };
}

/** Birthdays and anniversaries coming up within `withinDays` (today counts), soonest first. */
export function upcomingOccasions(person: { birthday?: string; anniversary?: string }, today: string, withinDays: number): Occasion[] {
  const out: Occasion[] = [];
  for (const kind of ['birthday', 'anniversary'] as const) {
    const stored = person[kind];
    if (!stored) continue;
    const next = nextOccurrence(stored, today);
    if (next && next.daysAway <= withinDays) out.push({ kind, ...next });
  }
  return out.sort((a, b) => a.daysAway - b.daysAway);
}

export function occasionLabel(kind: OccasionKind): string {
  return kind === 'birthday' ? 'Birthday' : 'Anniversary';
}
