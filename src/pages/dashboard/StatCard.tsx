import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import type { CompareWith } from '../../../shared/periods';
import { C_INVOICED, Sparkline } from '../../components/charts';
import { rolling } from '../../components/ui';

/** Up or down against the comparison stretch. Nothing is shown when there was nothing before to compare with. */
export function Delta({ now, before, compare }: { now: number; before: number | undefined; compare: CompareWith }) {
  if (before === undefined || before <= 0) return null;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return <span className="text-xs text-ink-muted">Same as before</span>;
  const up = pct > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs ${up ? 'bg-status-paid-bg text-status-paid-fg' : 'bg-status-overdue-bg text-status-overdue-fg'}`} title={compare === 'last-year' ? 'Compared with the same dates last year' : 'Compared with the period just before'}>
      <Icon className="h-3 w-3" aria-hidden />
      {Math.abs(pct)}%
    </span>
  );
}

export function StatCard({ label, icon: Icon, tone = 'brand', value, sub, spark, sparkColor, delta, onClick, index }: { label: string; icon: LucideIcon; tone?: 'brand' | 'amber' | 'red'; value: ReactNode; sub: ReactNode; spark?: number[]; sparkColor?: string; delta?: ReactNode; onClick: () => void; index: number }) {
  const tint = tone === 'red' ? 'bg-status-overdue-bg text-status-overdue-fg' : tone === 'amber' ? 'bg-status-partial-bg text-status-partial-fg' : 'bg-brand-tint text-brand';
  return (
    <button type="button" onClick={onClick} style={{ ['--i' as string]: index } as CSSProperties} className="card-hover animate-fade-up stagger flex flex-col justify-start rounded-lg border border-line bg-surface p-5 text-left shadow-card">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] uppercase tracking-wider text-ink-muted">{label}</span>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tint}`}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div className="text-[26px] leading-none tracking-tight">{rolling(value)}</div>
        {spark && <Sparkline values={spark} color={sparkColor ?? C_INVOICED} width={52} />}
      </div>
      <div className="mt-3 text-xs text-ink-muted">
        <div>{sub}</div>
        <div className="mt-1.5 h-5">{delta}</div>
      </div>
    </button>
  );
}
