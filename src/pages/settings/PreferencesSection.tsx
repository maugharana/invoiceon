import { Field, Input } from '../../components/ui';
import type { SectionProps } from './draft';

export function PreferencesSection({ draft, set }: SectionProps) {
  return (
    <div className="space-y-6">
      <div className="max-w-[14rem]">
        <Field label="Default reorder level" hint="Prefilled for new variants. A variant at or below its level counts as low stock.">
          <Input value={draft.defaultReorderLevel} onChange={(e) => set('defaultReorderLevel', e.target.value)} inputMode="numeric" className="num text-right" />
        </Field>
      </div>
      <dl className="divide-y divide-line/70 rounded-lg border border-line">
        {[
          ['Currency', 'Indian rupee (₹), amounts shown with lakh/crore grouping'],
          ['Financial year', 'April to March. Invoice numbers restart each year.'],
          ['Dates', '12 Mar 2027'],
        ].map(([k, v]) => (
          <div key={k} className="flex gap-6 px-4 py-2.5">
            <dt className="w-32 shrink-0 text-ink-muted">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-ink-muted">Currency, financial year and date format follow Indian business practice and aren't configurable yet.</p>
    </div>
  );
}
