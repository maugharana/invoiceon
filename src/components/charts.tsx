import { BarChart3, Table2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { formatCompactMoney, formatMoney } from '../../shared/money';
import type { TrendPoint } from '../../shared/types';
import { bucketLabel, niceScale } from './SalesChart';

// Chart colours, checked together with the dataviz palette validator (lightness, chroma, colour-blind separation, contrast).
// The same colour always means the same thing on the dashboard: invoiced = teal, received = bronze, expenses = brick.
export const C_INVOICED = '#0B8264';
export const C_RECEIVED = '#B4842B';
export const C_EXPENSES = '#A63D2F';

const GRID = '#E8E7E0';
const AXIS = '#D6D5CC';
const TICK = '#6B6F6A';

/** The width of an element, kept up to date as it resizes. */
export function useWidth(ref: RefObject<HTMLElement | null>, min = 260, initial = 560): number {
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(Math.max(min, Math.floor(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, min]);
  return width;
}

// ── A card for a chart: title, legend, and a switch to the same numbers as a table ──
export interface ChartTable {
  columns: string[];
  rows: string[][];
}

export function ChartCard({ title, subtitle, legend, table, children, className = '' }: { title: string; subtitle?: string; legend?: { color: string; label: string }[]; table?: ChartTable; children: ReactNode; className?: string }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <section className={`rounded-lg border border-line bg-surface p-6 shadow-card ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-base">{title}</h3>
          {subtitle && <p className="mt-0.5 text-ink-muted">{subtitle}</p>}
        </div>
        {table && (
          <div role="group" aria-label={`${title} view`} className="flex shrink-0 rounded-lg border border-line p-0.5">
            {([['chart', BarChart3, 'Chart'], ['table', Table2, 'Table']] as const).map(([v, Icon, label]) => (
              <button key={v} type="button" aria-pressed={view === v} title={`${label} view`} onClick={() => setView(v)} className={`flex h-7 w-7 items-center justify-center rounded-[6px] transition-colors ${view === v ? 'bg-brand-tint text-brand' : 'text-ink-muted hover:text-ink'}`}>
                <Icon className="h-4 w-4" aria-hidden />
              </button>
            ))}
          </div>
        )}
      </div>
      {legend && legend.length > 0 && view === 'chart' && (
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-muted">
          {legend.map((l) => (
            <span key={l.label} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: l.color }} aria-hidden />
              {l.label}
            </span>
          ))}
        </div>
      )}
      {view === 'chart' || !table ? (
        children
      ) : (
        <div className="animate-fade-in max-h-72 overflow-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                {table.columns.map((c, i) => (
                  <th key={c} className={`th ${i > 0 ? 'text-right' : ''}`}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-b border-line/70 last:border-0">
                  {r.map((cell, j) => (
                    <td key={j} className={`td ${j > 0 ? 'num text-right' : ''}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Smooth line through points that never overshoots (monotone cubic), so a quiet month can't dip below zero ──
function smoothPath(pts: [number, number][]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0]![0]},${pts[0]![1]}`;
  const n = pts.length;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1]![0] - pts[i]![0]);
    slope.push((pts[i + 1]![1] - pts[i]![1]) / dx[i]!);
  }
  const m: number[] = [slope[0]!];
  for (let i = 1; i < n - 1; i++) m.push(slope[i - 1]! * slope[i]! <= 0 ? 0 : (slope[i - 1]! + slope[i]!) / 2);
  m.push(slope[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) m[i] = m[i + 1] = 0;
    else {
      const a = m[i]! / slope[i]!;
      const b = m[i + 1]! / slope[i]!;
      const h = Math.hypot(a, b);
      if (h > 3) {
        m[i] = (3 * a * slope[i]!) / h;
        m[i + 1] = (3 * b * slope[i]!) / h;
      }
    }
  }
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    const h = dx[i]! / 3;
    d += ` C${x0 + h},${y0 + m[i]! * h} ${x1 - h},${y1 - m[i + 1]! * h} ${x1},${y1}`;
  }
  return d;
}

// ── Revenue trend: money received against money spent, over time ──
const TH = 270;
const TM = { top: 12, right: 12, bottom: 30, left: 54 };

export function TrendChart({ points, granularity }: { points: TrendPoint[]; granularity: 'day' | 'week' | 'month' }) {
  const wrap = useRef<HTMLDivElement>(null);
  const width = useWidth(wrap, 320, 720);
  const [hover, setHover] = useState<number | null>(null);

  const peak = Math.max(0, ...points.flatMap((p) => [p.receivedPaise, p.expensesPaise]));
  const { max, ticks } = niceScale(peak);
  const plotW = width - TM.left - TM.right;
  const plotH = TH - TM.top - TM.bottom;
  const x = (i: number) => TM.left + (points.length === 1 ? plotW / 2 : (plotW * i) / (points.length - 1));
  const y = (v: number) => TM.top + plotH - (v / max) * plotH;
  const received = points.map((p, i): [number, number] => [x(i), y(p.receivedPaise)]);
  const spent = points.map((p, i): [number, number] => [x(i), y(p.expensesPaise)]);
  const receivedPath = smoothPath(received);
  const base = TM.top + plotH;
  const every = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotW / (granularity === 'day' ? 48 : 64)))));
  const active = hover !== null ? points[hover] : undefined;

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - box.left) / box.width;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(rel * (points.length - 1)))));
  }

  const TIP_W = 190;
  const tipLeft = active && hover !== null ? (x(hover) + 16 + TIP_W <= width ? x(hover) + 16 : Math.max(0, x(hover) - 16 - TIP_W)) : 0;

  return (
    <div ref={wrap} className="relative">
      <svg width={width} height={TH} role="img" aria-label={`Received and expenses over ${points.length} ${granularity === 'day' ? 'days' : granularity === 'week' ? 'weeks' : 'months'}`} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={TM.left} x2={width - TM.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeDasharray={t === 0 ? undefined : '3 4'} />
            <text x={TM.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="num" fill={TICK} fontSize={11}>
              {formatCompactMoney(t)}
            </text>
          </g>
        ))}
        <line x1={TM.left} x2={width - TM.right} y1={base} y2={base} stroke={AXIS} />

        {points.length > 1 && <path d={`${receivedPath} L${x(points.length - 1)},${base} L${x(0)},${base} Z`} fill={C_RECEIVED} fillOpacity={0.1} className="animate-fade-in" style={{ animationDelay: '500ms' }} />}
        <path d={smoothPath(spent)} fill="none" stroke={C_EXPENSES} strokeWidth={2} strokeLinecap="round" pathLength={1} className="draw-line" style={{ animationDelay: '120ms' }} />
        <path d={receivedPath} fill="none" stroke={C_RECEIVED} strokeWidth={2} strokeLinecap="round" pathLength={1} className="draw-line" />

        {points.map((p, i) =>
          i % every === 0 ? (
            <text key={p.key} x={x(i)} y={TH - 10} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} fontSize={11} className="num" fill={TICK}>
              {bucketLabel(p.key, granularity)}
            </text>
          ) : null,
        )}

        {hover !== null && active && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={TM.top} y2={base} stroke={AXIS} />
            <circle cx={x(hover)} cy={y(active.expensesPaise)} r={4.5} fill={C_EXPENSES} stroke="#fff" strokeWidth={2} />
            <circle cx={x(hover)} cy={y(active.receivedPaise)} r={4.5} fill={C_RECEIVED} stroke="#fff" strokeWidth={2} />
          </g>
        )}
        {/* One wide hit target over the whole plot, far bigger than the line. */}
        <rect x={TM.left} y={TM.top} width={plotW} height={plotH} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} />
      </svg>

      {active && (
        <div role="status" className="animate-fade-in pointer-events-none absolute top-2 z-10 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-overlay" style={{ left: tipLeft, width: TIP_W }}>
          <div className="mb-1 text-ink">{bucketLabel(active.key, granularity, true)}</div>
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-muted"><span className="h-2 w-2 rounded-full" style={{ background: C_RECEIVED }} />Received</span>
            <span className="num text-ink">{formatMoney(active.receivedPaise)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-muted"><span className="h-2 w-2 rounded-full" style={{ background: C_EXPENSES }} />Expenses</span>
            <span className="num text-ink">{formatMoney(active.expensesPaise)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Owed today, by how old the invoice is ──
const AGING_TINTS = ['#7FC4B0', '#3FA48A', '#0B8264', '#0A4A3B']; // one hue, lighter → darker as invoices get older

export function AgingChart({ buckets }: { buckets: { label: string; paise: number; count: number }[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const width = useWidth(wrap, 280, 520);
  const [hover, setHover] = useState<number | null>(null);
  const H = 232;
  const M = { top: 22, right: 8, bottom: 30, left: 44 };
  const { max, ticks } = niceScale(Math.max(0, ...buckets.map((b) => b.paise)));
  const plotW = width - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const band = plotW / buckets.length;
  const barW = Math.min(56, band * 0.55);
  const y = (v: number) => M.top + plotH - (v / max) * plotH;

  return (
    <div ref={wrap} className="relative">
      <svg width={width} height={H} role="img" aria-label="Outstanding invoices by age" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeDasharray={t === 0 ? undefined : '3 4'} />
            <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="num" fill={TICK} fontSize={11}>
              {formatCompactMoney(t)}
            </text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const cx = M.left + band * i + band / 2;
          const h = M.top + plotH - y(b.paise);
          const r = Math.min(4, h, barW / 2);
          return (
            <g key={b.label} onMouseEnter={() => setHover(i)} tabIndex={0} onFocus={() => setHover(i)} onBlur={() => setHover(null)} className="outline-none" role="group" aria-label={`${b.label}: ${formatMoney(b.paise)} across ${b.count} invoices`}>
              <rect x={M.left + band * i} y={M.top} width={band} height={plotH} fill={hover === i ? 'rgba(15,110,86,0.06)' : 'transparent'} />
              {b.paise > 0 && (
                <path
                  className="chart-bar"
                  style={{ animationDelay: `${i * 70}ms` }}
                  d={`M${cx - barW / 2},${y(b.paise) + h} V${y(b.paise) + r} Q${cx - barW / 2},${y(b.paise)} ${cx - barW / 2 + r},${y(b.paise)} H${cx + barW / 2 - r} Q${cx + barW / 2},${y(b.paise)} ${cx + barW / 2},${y(b.paise) + r} V${y(b.paise) + h} Z`}
                  fill={AGING_TINTS[i]}
                />
              )}
              {b.paise > 0 && (
                <text x={cx} y={y(b.paise) - 7} textAnchor="middle" fontSize={11} className="num animate-fade-in" fill="#1A1D1B" style={{ animationDelay: `${300 + i * 70}ms` }}>
                  {formatCompactMoney(b.paise)}
                </text>
              )}
              <text x={cx} y={H - 10} textAnchor="middle" fontSize={11} fill={TICK}>
                {b.label}
              </text>
            </g>
          );
        })}
        <line x1={M.left} x2={width - M.right} y1={M.top + plotH} y2={M.top + plotH} stroke={AXIS} />
      </svg>
      {hover !== null && buckets[hover] && (
        <div role="status" className="animate-fade-in pointer-events-none absolute top-0 z-10 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-overlay" style={{ left: Math.min(width - 170, Math.max(0, M.left + band * hover + band / 2 - 80)) }}>
          <div className="text-ink">{buckets[hover]!.label}</div>
          <div className="num text-ink">{formatMoney(buckets[hover]!.paise)}</div>
          <div className="text-ink-muted">{buckets[hover]!.count} {buckets[hover]!.count === 1 ? 'invoice' : 'invoices'}</div>
        </div>
      )}
    </div>
  );
}

// ── Ranked horizontal bars: top clients, expenses by category ──
export function RankedBars({ rows, color, empty, onPick }: { rows: { key: string; label: string; paise: number; note?: string }[]; color: string; empty: ReactNode; onPick?: (key: string) => void }) {
  if (rows.length === 0) return <div className="flex h-40 flex-col items-center justify-center gap-2 text-center text-ink-muted">{empty}</div>;
  const top = Math.max(...rows.map((r) => r.paise), 1);
  return (
    <ul className="space-y-3.5">
      {rows.map((r, i) => {
        const inner = (
          <>
            <div className="mb-1 flex items-baseline justify-between gap-4">
              <span className="min-w-0 truncate">{r.label}</span>
              <span className="num shrink-0">{formatMoney(r.paise, { fractionDigits: 0 })}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-ink/5">
              <div className="chart-hbar h-full rounded-full" style={{ width: `${Math.max(2, (r.paise / top) * 100)}%`, background: color, animationDelay: `${i * 70}ms` }} />
            </div>
            {r.note && <div className="mt-1 text-xs text-ink-muted">{r.note}</div>}
          </>
        );
        return (
          <li key={r.key} className="animate-fade-up stagger" style={{ ['--i' as string]: i } as React.CSSProperties}>
            {onPick ? (
              <button type="button" onClick={() => onPick(r.key)} className="-mx-2 block w-[calc(100%+1rem)] rounded-lg px-2 py-1 text-left transition-colors hover:bg-canvas">
                {inner}
              </button>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ── A tiny trend line for a stat card ──
export function Sparkline({ values, color, width = 84, height = 28 }: { values: number[]; color: string; width?: number; height?: number }) {
  if (values.length < 2 || values.every((v) => v === 0)) return <svg width={width} height={height} aria-hidden />;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i): [number, number] => [2 + ((width - 4) * i) / (values.length - 1), height - 3 - ((height - 6) * v) / max]);
  return (
    <svg width={width} height={height} aria-hidden>
      <path d={smoothPath(pts)} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" pathLength={1} className="draw-line" />
      <circle cx={pts[pts.length - 1]![0]} cy={pts[pts.length - 1]![1]} r={2.5} fill={color} className="animate-fade-in" style={{ animationDelay: '900ms' }} />
    </svg>
  );
}
