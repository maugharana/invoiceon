import type { ReactNode } from 'react';
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
    </div>
  );
}
