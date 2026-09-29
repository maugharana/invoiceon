import { useEffect, useRef, useState } from 'react';
import { formatCompactMoney, formatMoney } from '../../shared/money';
import type { SalesSeriesPoint } from '../../shared/types';

// Two series on one axis, both in rupees: invoiced (by invoice date) and collected (by payment date).
// Colours were checked with the dataviz palette validator (lightness band, chroma, colour-blind separation, 3:1 contrast on white).
// Teal is the brand's, nudged up in saturation so it reads as a colour rather than grey; bronze is the brand gold, deepened.
export const INVOICED_COLOR = '#0B8264';
export const COLLECTED_COLOR = '#B4842B';

const HEIGHT = 260;
const M = { top: 12, right: 8, bottom: 30, left: 54 };
const MAX_BAR = 24;
const GAP = 2;

/** 0 … a round number above the max, in 4–5 clean steps (1, 2, 2.5, 5 × 10ⁿ). */
export function niceScale(maxPaise: number): { max: number; ticks: number[] } {
  if (maxPaise <= 0) return { max: 100_00, ticks: [0, 100_00] };
  const rough = maxPaise / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, Math.round([1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough)!));
  const max = Math.ceil(maxPaise / step) * step;
  return { max, ticks: Array.from({ length: max / step + 1 }, (_, i) => i * step) };
}

/** A column with a 4px rounded top and a square base, so it grows from the baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function bucketLabel(key: string, granularity: 'day' | 'week' | 'month', long = false): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number | undefined];
  // A week is named by its Monday: "3 Aug", or "Week of 3 Aug 2026".
  if (granularity === 'week') return long ? `Week of ${d} ${MONTHS[m - 1]} ${y}` : `${d} ${MONTHS[m - 1]}`;
  if (granularity === 'month') return long ? `${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]} ${String(y).slice(2)}`;
  return long ? `${d} ${MONTHS[m - 1]} ${y}` : String(d);
}

interface Props {
  series: SalesSeriesPoint[];
  granularity: 'day' | 'week' | 'month';
  /** What the second series is called. Reports say "Collected"; the dashboard says "Received". */
  collectedLabel?: string;
  /** Drop the "by invoice date / by payment date" detail (the dashboard's own header explains it). */
  compactLegend?: boolean;
}

export function SalesChart({ series, granularity, collectedLabel = 'Collected', compactLegend = false }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(Math.max(320, Math.floor(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const peak = Math.max(0, ...series.flatMap((p) => [p.invoicedPaise, p.collectedPaise]));
  const { max, ticks } = niceScale(peak);
  const plotW = width - M.left - M.right;
  const plotH = HEIGHT - M.top - M.bottom;
  const band = plotW / Math.max(series.length, 1);
  const barW = Math.min(MAX_BAR, Math.max(2, (band * 0.72 - GAP) / 2));
  const y = (v: number) => M.top + plotH - (v / max) * plotH;
  // Thin the x labels so they never collide.
  const every = Math.max(1, Math.ceil(series.length / Math.max(1, Math.floor(plotW / (granularity === 'day' ? 26 : granularity === 'week' ? 48 : 52)))));
  const active = hover !== null ? series[hover] : undefined;
  // Beside the pair of bars, never over them: to the right when there's room, otherwise to the left.
  const centre = M.left + band * (hover ?? 0) + band / 2;
  const TIP_W = 176;
  const tooltipLeft = centre + barW + 12 + TIP_W <= width ? centre + barW + 12 : Math.max(0, centre - barW - 12 - TIP_W);

  return (
    <div ref={wrap} className="relative">
      <div className="mb-3 flex items-center gap-5 text-xs text-ink-muted">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: INVOICED_COLOR }} aria-hidden />
          Invoiced {!compactLegend && <span>· by invoice date</span>}
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: COLLECTED_COLOR }} aria-hidden />
          {collectedLabel} {!compactLegend && <span>· by payment date</span>}
        </span>
      </div>

      <svg width={width} height={HEIGHT} role="img" aria-label={`Invoiced and ${collectedLabel.toLowerCase()}, ${series.length} ${granularity === 'day' ? 'days' : granularity === 'week' ? 'weeks' : 'months'}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke="#E8E7E0" strokeWidth={1} />
            <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="num fill-[#6B6F6A]" fontSize={11}>
              {formatCompactMoney(t)}
            </text>
          </g>
        ))}

        {series.map((p, i) => {
          const cx = M.left + band * i + band / 2;
          const bars = [
            { v: p.invoicedPaise, color: INVOICED_COLOR, x: cx - GAP / 2 - barW },
            { v: p.collectedPaise, color: COLLECTED_COLOR, x: cx + GAP / 2 },
          ];
          return (
            <g
              key={p.key}
              tabIndex={0}
              role="group"
              aria-label={`${bucketLabel(p.key, granularity, true)}: invoiced ${formatMoney(p.invoicedPaise)}, ${collectedLabel.toLowerCase()} ${formatMoney(p.collectedPaise)}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className="outline-none [&:focus-visible>rect:first-child]:fill-brand/10"
            >
              {/* The hit target is the whole band, far bigger than the bars. */}
              <rect x={M.left + band * i} y={M.top} width={band} height={plotH} fill={hover === i ? 'rgba(15,110,86,0.06)' : 'transparent'} />
              {bars.map((b, k) => (b.v > 0 ? <path key={k} className="chart-bar" style={{ animationDelay: `${Math.min(i, 14) * 18}ms` }} d={columnPath(b.x, y(b.v), barW, M.top + plotH - y(b.v))} fill={b.color} /> : null))}
              {i % every === 0 && (
                <text x={cx} y={HEIGHT - 10} textAnchor="middle" fontSize={11} className="num fill-[#6B6F6A]">
                  {bucketLabel(p.key, granularity)}
                </text>
              )}
            </g>
          );
        })}
        <line x1={M.left} x2={width - M.right} y1={M.top + plotH} y2={M.top + plotH} stroke="#D6D5CC" strokeWidth={1} />
      </svg>

      {active && (
        <div
          role="status"
          className="animate-fade-in pointer-events-none absolute z-10 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-overlay"
          style={{ top: 36, left: tooltipLeft }}
        >
          <div className="mb-1 text-ink">{bucketLabel(active.key, granularity, true)}</div>
          <div className="flex items-center justify-between gap-6">
            <span className="flex items-center gap-1.5 text-ink-muted"><span className="h-2 w-2 rounded-[2px]" style={{ background: INVOICED_COLOR }} />Invoiced</span>
            <span className="num text-ink">{formatMoney(active.invoicedPaise)}</span>
          </div>
          <div className="flex items-center justify-between gap-6">
            <span className="flex items-center gap-1.5 text-ink-muted"><span className="h-2 w-2 rounded-[2px]" style={{ background: COLLECTED_COLOR }} />{collectedLabel}</span>
            <span className="num text-ink">{formatMoney(active.collectedPaise)}</span>
          </div>
          <div className="mt-1 text-ink-muted">{active.invoices} {active.invoices === 1 ? 'invoice' : 'invoices'}</div>
        </div>
      )}
    </div>
  );
}
