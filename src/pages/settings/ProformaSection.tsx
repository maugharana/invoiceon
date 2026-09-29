import { Field, Input, Textarea } from '../../components/ui';
import type { SectionProps } from './draft';

export function ProformaSection({ draft, set }: SectionProps) {
  return (
    <div className="space-y-5">
      <p className="rounded-lg bg-canvas px-3 py-2 text-ink-muted">
        A proforma invoice is a quote the customer can pay against before you issue the real invoice. These defaults apply to proformas you create from now on; ones already made keep the terms they were made with.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Proforma prefix" hint="PF → PF/2026-27/0001">
          <Input value={draft.proformaPrefix} onChange={(e) => set('proformaPrefix', e.target.value.toUpperCase())} maxLength={10} className="num" />
        </Field>
        <Field label="Valid for (days)" hint="How long the quote stands">
          <Input value={draft.proformaValidDays} onChange={(e) => set('proformaValidDays', e.target.value)} inputMode="numeric" className="num text-right" />
        </Field>
      </div>
      <Field label="Terms printed on proformas">
        <Textarea rows={3} value={draft.proformaTerms} onChange={(e) => set('proformaTerms', e.target.value)} placeholder="e.g. 50% advance to confirm the order." />
      </Field>
    </div>
  );
}
