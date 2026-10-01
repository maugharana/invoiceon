import { Pencil, Target } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { formatMoney } from '../../../shared/money';
import type { DashboardMonth } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, IconButton, Money, MoneyInput } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useRefresh } from '../../lib/data';

function TargetModal({ current, onClose }: { current: number; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [target, setTarget] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.saveSettings({ monthlyTargetPaise: target });
      refresh();
      toast.success(target > 0 ? `Monthly target set to ${formatMoney(target, { fractionDigits: 0 })}` : 'Monthly target removed');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Monthly sales target"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="target-form" loading={saving}>
            Save target
          </Button>
        </>
      }
    >
      <form id="target-form" onSubmit={submit} className="space-y-4">
        <Field label="Invoiced each month" hint="The total of the invoices you issue in a month, GST included. Leave at 0 to turn the target off.">
          <MoneyInput value={target} onChange={setTarget} data-autofocus />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}

/** How this month is going against the target: a bar for what's been invoiced, and a tick for where an even pace would be by today. */
export function TargetCard({ month }: { month: DashboardMonth }) {
  const [editing, setEditing] = useState(false);
  const monthName = new Date(`${month.range.from}T00:00:00`).toLocaleDateString('en-IN', { month: 'long' });
  const { targetPaise: target, invoicedPaise: done } = month;
  const paceFraction = month.daysElapsed / month.daysInMonth;
  const pacePaise = Math.round(target * paceFraction);
  const behind = pacePaise - done;
  const reached = target > 0 && done >= target;

  return (
    <div className="animate-fade-up stagger flex flex-col rounded-lg border border-line bg-surface p-5 shadow-card" style={{ ['--i' as string]: 6 } as React.CSSProperties}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] uppercase tracking-wider text-ink-muted">Target · {monthName}</span>
        <span className="flex items-center gap-1">
          {target > 0 && (
            <IconButton label="Change monthly target" className="h-8 w-8" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" />
            </IconButton>
          )}
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-tint text-brand">
            <Target className="h-4 w-4" aria-hidden />
          </span>
        </span>
      </div>

      {target > 0 ? (
        <>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-[26px] leading-none tracking-tight">
              <Money paise={done} fractionDigits={0} animate />
            </span>
            <span className="text-xs text-ink-muted">of {formatMoney(target, { fractionDigits: 0 })}</span>
          </div>
          <div
            className="relative mt-4 h-2 rounded-full bg-status-neutral-bg"
            role="progressbar"
            aria-label="Progress towards this month's target"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.round((done / target) * 100))}
          >
            <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${Math.min(100, (done / target) * 100)}%` }} />
            {!reached && <div aria-hidden className="absolute -top-1 h-4 w-0.5 rounded-full bg-ink/40" style={{ left: `${paceFraction * 100}%` }} title="Where an even pace would be today" />}
          </div>
          <div className="mt-3 text-xs text-ink-muted">
            {reached ? (
              <span className="text-status-paid-fg">Target reached{done > target ? ` — ${formatMoney(done - target, { fractionDigits: 0 })} over` : ''}</span>
            ) : behind > 0 ? (
              <>
                <span className="num text-ink">{Math.round((done / target) * 100)}%</span> there · <span className="num">{formatMoney(behind, { fractionDigits: 0 })}</span> behind an even pace
              </>
            ) : (
              <>
                <span className="num text-ink">{Math.round((done / target) * 100)}%</span> there · on or ahead of pace
              </>
            )}
          </div>
          <div className="mt-1 text-xs text-ink-muted">
            Day {month.daysElapsed} of {month.daysInMonth}
          </div>
        </>
      ) : (
        <div className="mt-3 flex flex-1 flex-col items-start justify-between gap-3">
          <p className="text-ink-muted">Set what you want to invoice each month and watch the bar fill.</p>
          <Button className="h-8 text-xs" onClick={() => setEditing(true)}>
            Set a target
          </Button>
        </div>
      )}
      {editing && <TargetModal current={target} onClose={() => setEditing(false)} />}
    </div>
  );
}
