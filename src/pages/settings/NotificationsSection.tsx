import type { ReactNode } from 'react';
import { Field, Input } from '../../components/ui';
import type { SectionProps } from './draft';

function Row({ checked, onChange, title, children }: { checked: boolean; onChange: (v: boolean) => void; title: string; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-4">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#0F6E56]" />
      <span>
        <span className="block">{title}</span>
        <span className="block text-ink-muted">{children}</span>
      </span>
    </label>
  );
}

export function NotificationsSection({ draft, set }: SectionProps) {
  return (
    <div>
      <p className="text-ink-muted">Small count badges in the left menu, so problems are visible without opening a report. Nothing is sent outside the app.</p>
      <div className="mt-2 divide-y divide-line/70">
        <Row checked={draft.notifyLowStock} onChange={(v) => set('notifyLowStock', v)} title="Low stock">
          Show how many designs are at or below their reorder level, next to Inventory.
        </Row>
        <Row checked={draft.notifyOverdue} onChange={(v) => set('notifyOverdue', v)} title="Overdue invoices">
          Show how many invoices are past their due date, next to Payments.
        </Row>
      </div>
      <div className="mt-4 max-w-sm border-t border-line pt-5">
        <Field label="Warn me when a saree earns less than" hint="A saree whose profit margin falls below this percent is listed under “Needs attention” on the dashboard. Enter 0 to switch it off.">
          <div className="relative">
            <Input value={draft.marginAlertPercent} onChange={(e) => set('marginAlertPercent', e.target.value.replace(/\D/g, '').slice(0, 2))} inputMode="numeric" className="num pr-8 text-right" />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted">%</span>
          </div>
        </Field>
      </div>
    </div>
  );
}
