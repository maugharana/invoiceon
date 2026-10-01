import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PERIOD_LABEL, resolvePeriod, type PeriodPreset } from '../../shared/periods';
import { Input, Select } from './ui';

// ── Date range ──────────────────────────────────────────────────────────────
export interface DateRangeValue {
  from?: string;
  to?: string;
}

type Choice = 'any' | PeriodPreset;
const CHOICES: Choice[] = ['any', 'this-month', 'last-month', 'this-quarter', 'this-fy', 'last-fy', 'custom'];
const choiceLabel = (c: Choice) => (c === 'any' ? 'Any date' : c === 'custom' ? 'Custom dates…' : PERIOD_LABEL[c]);

/** A date filter for lists: "Any date", a preset ("This month", "Last year"…), or two dates of your own. */
export function DateRangeFilter({ onChange, label = 'Date' }: { onChange: (range: DateRangeValue) => void; label?: string }) {
  const [choice, setChoice] = useState<Choice>('any');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    if (choice === 'any') onChange({});
    else if (choice === 'custom') onChange({ from: from || undefined, to: to || undefined });
    else {
      const r = resolvePeriod({ preset: choice });
      onChange({ from: r.from, to: r.to });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice, from, to]);

  return (
    <div className="flex items-center gap-2">
      <div className="w-40">
        <Select value={choice} onChange={(e) => setChoice(e.target.value as Choice)} aria-label={label}>
          {CHOICES.map((c) => (
            <option key={c} value={c}>
              {choiceLabel(c)}
            </option>
          ))}
        </Select>
      </div>
      {choice === 'custom' && (
        <>
          <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label={`${label} from`} className="num w-36" />
          <span className="text-ink-muted">to</span>
          <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label={`${label} to`} className="num w-36" />
        </>
      )}
    </div>
  );
}

// ── Sorting ─────────────────────────────────────────────────────────────────
export type SortDir = 'asc' | 'desc';

/** A column heading that sorts the table when clicked, and says which way it's sorted. */
export function SortableTh({ label, active, dir, onSort, right }: { label: string; active: boolean; dir: SortDir; onSort: () => void; right?: boolean }) {
  const Icon = dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={`th ${right ? 'text-right' : ''}`} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={onSort} className={`inline-flex items-center gap-1 transition-colors hover:text-ink ${active ? 'text-ink' : ''}`}>
        {label}
        <Icon className={`h-3 w-3 ${active ? '' : 'opacity-0'}`} aria-hidden />
      </button>
    </th>
  );
}

/** Sort state for a table: click a heading to sort by it, click again to reverse. */
export function useSort<K extends string>(initial: K, initialDir: SortDir = 'desc') {
  const [key, setKey] = useState<K>(initial);
  const [dir, setDir] = useState<SortDir>(initialDir);
  const toggle = (k: K, firstDir: SortDir = 'asc') => {
    if (k === key) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setKey(k);
      setDir(firstDir);
    }
  };
  return { key, dir, toggle };
}

/** Orders items by a value pulled from each (numbers and text both work), keeping the original order for ties. */
export function sortBy<T>(items: T[], value: (t: T) => string | number, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { sensitivity: 'base', numeric: true })) * sign;
  });
}

// ── Paging ──────────────────────────────────────────────────────────────────
export const PAGE_SIZE = 25;

/** Splits a list into pages. Going to a page that no longer exists (after filtering) lands on the last one. */
export function usePager<T>(items: T[], pageSize = PAGE_SIZE) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pages - 1);
  const pageItems = useMemo(() => items.slice(current * pageSize, (current + 1) * pageSize), [items, current, pageSize]);
  return { page: current, setPage, pages, pageItems, total: items.length, from: items.length === 0 ? 0 : current * pageSize + 1, to: Math.min(items.length, (current + 1) * pageSize) };
}

/** "Showing 26–50 of 140" with previous and next. Renders nothing when everything fits on one page. */
export function Pager({ pager, noun }: { pager: ReturnType<typeof usePager>; noun: string }) {
  const { page, pages, setPage, from, to, total } = pager;
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-ink-muted">
      <span>
        Showing <span className="num">{from}–{to}</span> of <span className="num">{total}</span> {total === 1 ? noun : `${noun}s`}
      </span>
      {pages > 1 && (
        <span className="flex items-center gap-1">
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page" className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-ink/5 disabled:opacity-30">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="num px-1">
            Page {page + 1} of {pages}
          </span>
          <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Next page" className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-ink/5 disabled:opacity-30">
            <ChevronRight className="h-4 w-4" />
          </button>
        </span>
      )}
    </div>
  );
}
