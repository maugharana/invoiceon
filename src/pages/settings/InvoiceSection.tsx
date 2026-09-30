import { InvoicePreview } from '../../components/InvoicePreview';
import { Field, Input, Textarea } from '../../components/ui';
import { fromDraft, type SectionProps } from './draft';

/** Colours offered for the invoice. All dark enough to print clearly on white; "Custom" covers anything else. */
const ACCENTS = [
  { name: 'InvoiceOn teal', hex: '#0F6E56' },
  { name: 'Maroon', hex: '#7A1F3D' },
  { name: 'Navy', hex: '#1F3A6E' },
  { name: 'Forest', hex: '#2F5D2A' },
  { name: 'Bronze', hex: '#8A5A1F' },
  { name: 'Charcoal', hex: '#2B2F2D' },
];

export function InvoiceSection({ draft, set }: SectionProps) {
  return (
    <div className="flex flex-wrap items-start gap-8">
      <div className="min-w-[18rem] flex-1 basis-80 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Invoice prefix" hint="MG → MG/2026-27/0001">
            <Input value={draft.invoicePrefix} onChange={(e) => set('invoicePrefix', e.target.value.toUpperCase())} maxLength={10} className="num" />
          </Field>
          <Field label="B2B payment terms" hint="Days until due. B2C is due on the day.">
            <Input value={draft.defaultDueDays} onChange={(e) => set('defaultDueDays', e.target.value)} inputMode="numeric" className="num text-right" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Credit note prefix" hint="CN → CN/2026-27/0001">
            <Input value={draft.creditNotePrefix} onChange={(e) => set('creditNotePrefix', e.target.value.toUpperCase())} maxLength={10} className="num" />
          </Field>
        </div>
        <Field label="Terms printed on invoices">
          <Textarea rows={2} value={draft.invoiceTerms} onChange={(e) => set('invoiceTerms', e.target.value)} />
        </Field>

        <div>
          <div className="mb-1.5 text-xs font-medium text-ink-muted">Invoice color</div>
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Invoice color">
            {ACCENTS.map((a) => (
              <button
                key={a.hex}
                type="button"
                role="radio"
                aria-checked={draft.invoiceAccent.toUpperCase() === a.hex}
                aria-label={a.name}
                title={a.name}
                onClick={() => set('invoiceAccent', a.hex)}
                className={`h-8 w-8 rounded-full border-2 transition-[transform,box-shadow] duration-150 hover:scale-105 ${draft.invoiceAccent.toUpperCase() === a.hex ? 'border-surface ring-2 ring-ink' : 'border-surface ring-1 ring-line'}`}
                style={{ background: a.hex }}
              />
            ))}
            <label className="ml-2 flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
              <input type="color" value={draft.invoiceAccent} onChange={(e) => set('invoiceAccent', e.target.value.toUpperCase())} aria-label="Custom color" className="h-8 w-8 cursor-pointer rounded-full border-0 bg-transparent p-0" />
              Custom
            </label>
          </div>
          <p className="mt-1.5 text-xs text-ink-muted">Used for the title, the line under the header, and the closing note.</p>
        </div>

        <Field label="Closing note">
          <Input value={draft.invoiceFooter} onChange={(e) => set('invoiceFooter', e.target.value)} placeholder="e.g. Thank you for shopping with us!" maxLength={200} />
        </Field>
        <label className="flex cursor-pointer items-center gap-3">
          <input type="checkbox" checked={draft.invoiceShowSignature} onChange={(e) => set('invoiceShowSignature', e.target.checked)} className="h-4 w-4 accent-[#0F6E56]" />
          <span>Show the “Authorised signatory” box</span>
        </label>
        <p className="text-xs text-ink-muted">
          Your address, GSTIN, terms, bank details and closing note are saved onto each invoice when it's issued, so changing them here never alters invoices you've already sent. The logo and color restyle every invoice, old ones included.
        </p>
      </div>
      <InvoicePreview settings={fromDraft(draft)} />
    </div>
  );
}
