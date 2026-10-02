export type RecentKind = 'invoice' | 'proforma' | 'customer' | 'design';

/** Something opened lately, kept so Ctrl+K can offer it again. */
export interface RecentItem {
  kind: RecentKind;
  id: string;
  title: string;
  hint?: string;
}

export const MAX_RECENT = 8;
const KINDS: RecentKind[] = ['invoice', 'proforma', 'customer', 'design'];

/** Puts an item at the front. Opening something again moves it to the front instead of listing it twice; the oldest fall off the end. */
export function pushRecent(list: RecentItem[], item: RecentItem, max = MAX_RECENT): RecentItem[] {
  return [item, ...list.filter((r) => !(r.kind === item.kind && r.id === item.id))].slice(0, max);
}

/** Turns whatever was saved into a clean list, dropping anything malformed (an older version, a hand-edited file). */
export function cleanRecent(raw: unknown, max = MAX_RECENT): RecentItem[] {
  if (!Array.isArray(raw)) return [];
  const out: RecentItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const { kind, id, title, hint } = r as Record<string, unknown>;
    if (!KINDS.includes(kind as RecentKind) || typeof id !== 'string' || !id || typeof title !== 'string' || !title) continue;
    if (out.some((o) => o.kind === kind && o.id === id)) continue;
    out.push({ kind: kind as RecentKind, id, title, ...(typeof hint === 'string' && hint ? { hint } : {}) });
  }
  return out.slice(0, max);
}
