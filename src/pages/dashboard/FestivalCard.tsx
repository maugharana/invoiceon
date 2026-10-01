import { PartyPopper } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { FESTIVALS } from '../../../shared/festivals';
import { formatDate } from '../../../shared/gst';
import type { FestivalFigures } from '../../../shared/types';
import { Card, ErrorNote, Money, Select } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { plural } from '../../lib/format';
import { Delta } from './StatCard';

const STORE_KEY = 'invoiceon.dashboard.festival';

function loadFestival(): string {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return FESTIVALS.some((f) => f.id === v) ? (v as string) : FESTIVALS[0]!.id;
  } catch {
    return FESTIVALS[0]!.id;
  }
}

function Side({ heading, range, f, delta }: { heading: string; range: string; f: FestivalFigures; delta?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-ink-muted">{heading}</div>
      <div className="mt-1 text-2xl tracking-tight">
        <Money paise={f.invoicedPaise} fractionDigits={0} />
      </div>
      <div className="mt-1 text-xs text-ink-muted">
        {plural(f.invoiceCount, 'invoice')} · {plural(f.piecesSold, 'piece')}
      </div>
      <div className="num mt-0.5 text-xs text-ink-muted">{range}</div>
      <div className="mt-2 h-5">{delta}</div>
    </div>
  );
}

const span = (r: { from: string; to: string }) => `${formatDate(r.from)} – ${formatDate(r.to)}`;

/** This festival season so far against the same stretch of last year's: the comparison that matters most to a saree shop. */
export function FestivalCard() {
  const [id, setIdState] = useState(loadFestival);
  const setId = (v: string) => {
    setIdState(v);
    try {
      localStorage.setItem(STORE_KEY, v);
    } catch {
      /* remembering the choice is a nicety */
    }
  };
  const q = useQuery(() => api.dashboardFestival(id), [id]);
  const c = q.data;
  const year = new Date().getFullYear();

  return (
    <Card className="p-6 shadow-card">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-tint text-brand">
            <PartyPopper className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="text-base">Festival season</h3>
            <p className="mt-0.5 text-ink-muted">
              {c?.date ? (
                <>
                  {c.name} {year} is on <span className="num">{formatDate(c.date)}</span>
                </>
              ) : (
                `This year against last`
              )}
            </p>
          </div>
        </div>
        <div className="w-40 shrink-0">
          <Select value={id} onChange={(e) => setId(e.target.value)} aria-label="Festival">
            {FESTIVALS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {q.error && <ErrorNote>{q.error}</ErrorNote>}

      {c?.state === 'unknown' && (
        <p className="text-ink-muted">
          The date for {c.name} {year} isn't in InvoiceOn's festival list yet, so there's nothing to compare. {c.lastSeason ? <>Last year's season brought in <Money paise={c.lastSeason.invoicedPaise} fractionDigits={0} className="text-ink" />.</> : null}
        </p>
      )}

      {c?.state === 'upcoming' && (
        <div className="space-y-4">
          <p className="text-ink">
            The season starts in <span className="num">{plural(c.startsInDays ?? 0, 'day')}</span>
            {c.season && <span className="text-ink-muted"> · {span(c.season)}</span>}
          </p>
          {c.lastSeason ? (
            <Side heading={`Last year's season to beat (${c.name} ${year - 1})`} range={span(c.lastSeason.range)} f={c.lastSeason} />
          ) : (
            <p className="text-ink-muted">Last year's date isn't in the list, so there's no season to measure against.</p>
          )}
        </div>
      )}

      {(c?.state === 'running' || c?.state === 'done') && c.thisSeason && (
        <div className="space-y-3">
          {c.state === 'running' && c.season && <p className="text-xs text-ink-muted">Season under way · {span(c.season)}. Both years are cut to the same number of days.</p>}
          <div className="grid grid-cols-2 gap-6">
            <Side
              heading={c.state === 'running' ? `${c.name} ${year} so far` : `${c.name} ${year}`}
              range={span(c.thisSeason.range)}
              f={c.thisSeason}
              delta={c.lastSeason ? <Delta now={c.thisSeason.invoicedPaise} before={c.lastSeason.invoicedPaise} compare="last-year" /> : undefined}
            />
            {c.lastSeason ? <Side heading={`${c.name} ${year - 1}`} range={span(c.lastSeason.range)} f={c.lastSeason} /> : <p className="text-ink-muted">Last year's date isn't in the list.</p>}
          </div>
        </div>
      )}
    </Card>
  );
}
