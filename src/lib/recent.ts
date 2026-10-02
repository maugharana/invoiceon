import { useEffect } from 'react';
import { cleanRecent, pushRecent, type RecentItem } from '../../shared/recent';

const KEY = 'invoiceon.recent';

export function loadRecent(): RecentItem[] {
  try {
    return cleanRecent(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return [];
  }
}

/** Remembers that this was opened, so Ctrl+K can offer it again. Quietly does nothing if the browser won't store it. */
export function rememberRecent(item: RecentItem): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(pushRecent(loadRecent(), item)));
  } catch {
    /* a convenience, not a record */
  }
}

/** Call on a detail page with the thing being shown (null while it loads). */
export function useRecent(item: RecentItem | null): void {
  const key = item ? `${item.kind}:${item.id}:${item.title}:${item.hint ?? ''}` : '';
  useEffect(() => {
    if (item) rememberRecent(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
