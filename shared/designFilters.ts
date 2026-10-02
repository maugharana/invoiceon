import { addDays } from './gst';
import { splitWorks } from './nomenclature';
import { hasTag } from './tags';
import type { DesignSummary } from './types';

export type MarginBand = 'any' | 'none' | 'low' | 'mid' | 'high';
export type SoldBand = 'any' | 'recent' | 'stale' | 'never';

/** The column filters on the Inventory list. An empty filter lets everything through. */
export interface DesignFilters {
  /** Exactly this fabric, or '' for any. */
  fabric: string;
  /** Exactly this weave style, technique or pattern, or '' for any. */
  weaveStyle: string;
  technique: string;
  pattern: string;
  /** Carrying this work among its works, or '' for any. */
  work: string;
  /** Designs with a price in this range (before GST). 0 means no limit on that side. */
  minPricePaise: number;
  maxPricePaise: number;
  /** none = not priced, low = under 20%, mid = 20–40%, high = over 40%. */
  margin: MarginBand;
  /** recent = sold in the last 30 days, stale = not sold for 90 days (or ever), never = has never sold. */
  sold: SoldBand;
  /** Carrying this tag, or '' for any. */
  tag: string;
}

export const NO_FILTERS: DesignFilters = { fabric: '', weaveStyle: '', technique: '', pattern: '', work: '', minPricePaise: 0, maxPricePaise: 0, margin: 'any', sold: 'any', tag: '' };

export const MARGIN_LABEL: Record<MarginBand, string> = { any: 'Any margin', none: 'Not priced', low: 'Under 20%', mid: '20% to 40%', high: 'Over 40%' };
export const SOLD_LABEL: Record<SoldBand, string> = { any: 'Any sales', recent: 'Sold in the last 30 days', stale: 'Not sold for 90 days', never: 'Never sold' };

export const filtersActive = (f: DesignFilters): boolean => f.fabric !== '' || f.weaveStyle !== '' || f.technique !== '' || f.pattern !== '' || f.work !== '' || f.minPricePaise > 0 || f.maxPricePaise > 0 || f.margin !== 'any' || f.sold !== 'any' || f.tag !== '';

export function marginBand(d: Pick<DesignSummary, 'marginPercent'>): Exclude<MarginBand, 'any'> {
  if (d.marginPercent === null) return 'none';
  return d.marginPercent < 20 ? 'low' : d.marginPercent <= 40 ? 'mid' : 'high';
}

export function applyDesignFilters(rows: DesignSummary[], f: DesignFilters, today: string): DesignSummary[] {
  const recent = addDays(today, -29);
  const stale = addDays(today, -90);
  return rows.filter((d) => {
    if (f.fabric && d.fabric.trim().toLowerCase() !== f.fabric.trim().toLowerCase()) return false;
    if (f.weaveStyle && d.weaveStyle.trim().toLowerCase() !== f.weaveStyle.trim().toLowerCase()) return false;
    if (f.technique && d.technique.trim().toLowerCase() !== f.technique.trim().toLowerCase()) return false;
    if (f.pattern && d.pattern.trim().toLowerCase() !== f.pattern.trim().toLowerCase()) return false;
    if (f.work && !splitWorks(d.work).some((w) => w.toLowerCase() === f.work.trim().toLowerCase())) return false;
    // A design matches when any part of its price range falls inside the asked range.
    if (f.minPricePaise > 0 && d.maxPricePaise < f.minPricePaise) return false;
    if (f.maxPricePaise > 0 && (d.minPricePaise === 0 || d.minPricePaise > f.maxPricePaise)) return false;
    if (f.tag && !hasTag(d.tags, f.tag)) return false;
    if (f.margin !== 'any' && marginBand(d) !== f.margin) return false;
    if (f.sold === 'recent' && !(d.lastSoldOn !== null && d.lastSoldOn >= recent)) return false;
    if (f.sold === 'stale' && !(d.lastSoldOn === null || d.lastSoldOn < stale)) return false;
    if (f.sold === 'never' && d.lastSoldOn !== null) return false;
    return true;
  });
}

/** The distinct fabrics in use, spelled the way they were first entered, in alphabetical order. */
export function fabricsOf(rows: Pick<DesignSummary, 'fabric'>[]): string[] {
  const seen = new Map<string, string>();
  for (const r of rows) {
    const name = r.fabric.trim();
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** The distinct values of one of the choices in use, spelled the way they were first entered, in alphabetical order. Works are listed one by one. */
export function choicesOf(rows: Pick<DesignSummary, 'weaveStyle' | 'technique' | 'pattern' | 'work'>[], field: 'weaveStyle' | 'technique' | 'pattern' | 'work'): string[] {
  const seen = new Map<string, string>();
  for (const r of rows) {
    for (const name of field === 'work' ? splitWorks(r.work) : [r[field].trim()]) {
      if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
