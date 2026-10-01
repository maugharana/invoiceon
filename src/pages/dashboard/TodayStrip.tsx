import type { ReactNode } from 'react';
import type { DashboardToday } from '../../../shared/types';
import { Money, rolling } from '../../components/ui';
import { plural } from '../../lib/format';
import { navigate, paths } from '../../lib/router';

function Cell({ label, value, sub, onClick }: { label: string; value: ReactNode; sub: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-w-0 rounded-lg px-4 py-3 text-left transition-colors duration-150 hover:bg-canvas">
      <div className="text-[11px] uppercase tracking-wider text-ink-muted">{label}</div>
      <div className="mt-1 text-xl tracking-tight">{rolling(value)}</div>
      <div className="mt-0.5 truncate text-xs text-ink-muted">{sub}</div>
    </button>
  );
}

/** What happened today. It ignores the period menu: this is the first thing to check in the morning and the last at night. */
export function TodayStrip({ today }: { today: DashboardToday }) {
  const date = new Date(`${today.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <section aria-label="Today" className="animate-fade-up rounded-lg border border-line bg-surface p-2 shadow-card">
      <div className="px-4 pb-1 pt-2 text-xs text-ink-muted">
        <span className="text-ink">Today</span> · {date}
      </div>
      <div className="grid grid-cols-4 divide-x divide-line">
        <Cell
          label="Invoices issued"
          value={today.invoiceCount}
          sub={today.invoiceCount === 0 ? 'None yet' : <Money paise={today.invoicedPaise} fractionDigits={0} />}
          onClick={() => navigate(paths.invoices())}
        />
        <Cell label="Collected" value={<Money paise={today.collectedPaise} fractionDigits={0} />} sub={today.paymentCount === 0 ? 'No payments yet' : plural(today.paymentCount, 'payment')} onClick={() => navigate(paths.payments)} />
        <Cell label="Spent" value={<Money paise={today.expensesPaise} fractionDigits={0} />} sub="Expenses logged today" onClick={() => navigate(paths.expenses())} />
        <Cell
          label="Due today"
          value={<Money paise={today.duePaise} fractionDigits={0} />}
          sub={today.dueCount === 0 ? 'Nothing falls due today' : `${plural(today.dueCount, 'invoice')} to collect`}
          onClick={() => navigate(paths.dues)}
        />
      </div>
    </section>
  );
}
