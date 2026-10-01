import { addDays } from './gst';

/**
 * Festival dates move every year (they follow the lunar calendar), so they are listed rather than worked out.
 * Sources: drikpanchang.com and publicholidays.in for Diwali (Lakshmi Puja day); Raksha Bandhan and the first day of
 * Sharad Navratri from the usual published panchang calendars. A year that isn't listed here simply has no comparison until
 * the list is extended: add a line to `dates` for each new year.
 */
export interface Festival {
  id: 'diwali' | 'navratri' | 'rakhi';
  name: string;
  /** The shopping season runs from this many days before the festival date… */
  leadDays: number;
  /** …to this many days after it. */
  afterDays: number;
  /** Calendar year → the festival's date that year ("first day" for Navratri). */
  dates: Record<number, string>;
}

export const FESTIVALS: Festival[] = [
  {
    id: 'diwali',
    name: 'Diwali',
    leadDays: 30,
    afterDays: 5,
    dates: { 2020: '2020-11-14', 2021: '2021-11-04', 2022: '2022-10-24', 2023: '2023-11-12', 2024: '2024-11-01', 2025: '2025-10-20', 2026: '2026-11-08', 2027: '2027-10-29', 2028: '2028-10-17' },
  },
  {
    id: 'navratri',
    name: 'Navratri',
    leadDays: 10,
    afterDays: 10,
    dates: { 2023: '2023-10-15', 2024: '2024-10-03', 2025: '2025-09-22', 2026: '2026-10-11', 2027: '2027-09-30' },
  },
  {
    id: 'rakhi',
    name: 'Raksha Bandhan',
    leadDays: 10,
    afterDays: 2,
    dates: { 2023: '2023-08-30', 2024: '2024-08-19', 2025: '2025-08-09', 2026: '2026-08-28', 2027: '2027-08-17' },
  },
];

export const festivalById = (id: string): Festival | undefined => FESTIVALS.find((f) => f.id === id);

/** The shopping season around a festival in a given year, or null if that year's date isn't listed. */
export function festivalSeason(f: Festival, year: number): { date: string; from: string; to: string } | null {
  const date = f.dates[year];
  return date ? { date, from: addDays(date, -f.leadDays), to: addDays(date, f.afterDays) } : null;
}
