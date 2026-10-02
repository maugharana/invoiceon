import { DATE_FORMATS, DATE_FORMAT_LABEL, LANGUAGES, LANGUAGE_LABEL, PAPER_LABEL, PAPER_SIZES } from '../../../shared/prefs';
import { Field, Input, MoneyInput, Select } from '../../components/ui';
import type { SectionProps } from './draft';

export function PreferencesSection({ draft, set }: SectionProps) {
  return (
    <div className="space-y-6">
      <div className="grid max-w-2xl grid-cols-2 gap-6">
        <Field label="Default reorder level" hint="Prefilled for new variants. A variant at or below its level counts as low stock.">
          <Input value={draft.defaultReorderLevel} onChange={(e) => set('defaultReorderLevel', e.target.value)} inputMode="numeric" className="num text-right" />
        </Field>
        <Field label="Paper size" hint="For printed and PDF invoices, quotes, statements and receipts.">
          <Select value={draft.paperSize} onChange={(e) => set('paperSize', e.target.value as typeof draft.paperSize)}>
            {PAPER_SIZES.map((p) => (
              <option key={p} value={p}>
                {PAPER_LABEL[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date format" hint="How dates are written on screen and on paper.">
          <Select value={draft.dateFormat} onChange={(e) => set('dateFormat', e.target.value as typeof draft.dateFormat)}>
            {DATE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {DATE_FORMAT_LABEL[f]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Language on invoices" hint="The words printed on an invoice (Bill to, Qty, Total…). Names, numbers and amounts stay as they are.">
          <Select value={draft.invoiceLanguage} onChange={(e) => set('invoiceLanguage', e.target.value as typeof draft.invoiceLanguage)}>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_LABEL[l]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="max-w-2xl rounded-lg border border-line p-4">
        <h3 className="text-base">Loyalty points</h3>
        <p className="mb-3 text-xs text-ink-muted">A saved customer earns points on what they are billed, and can spend them as a discount on a later bill. Leave the first box empty (zero) to keep loyalty switched off.</p>
        <div className="grid grid-cols-2 gap-6">
          <Field label="One point for every" hint="Rupees billed. For example ₹100 gives 1 point on a ₹1,000 bill: 10 points.">
            <MoneyInput value={draft.loyaltySpendPaise} onChange={(p) => set('loyaltySpendPaise', p)} />
          </Field>
          <Field label="One point is worth" hint="Taken off the bill when points are spent.">
            <MoneyInput value={draft.loyaltyPointValuePaise} onChange={(p) => set('loyaltyPointValuePaise', p)} />
          </Field>
        </div>
      </div>
      <dl className="divide-y divide-line/70 rounded-lg border border-line">
        {[
          ['Currency', 'Indian rupee (₹), amounts shown with lakh/crore grouping'],
          ['Financial year', 'April to March. Invoice numbers restart each year.'],
        ].map(([k, v]) => (
          <div key={k} className="flex gap-6 px-4 py-2.5">
            <dt className="w-32 shrink-0 text-ink-muted">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-ink-muted">Currency and the financial year follow Indian business practice (GST), so they are fixed. The Hindi and Gujarati invoice words are a first translation: please have a fluent reader look them over before you rely on them.</p>
    </div>
  );
}
