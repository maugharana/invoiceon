import { TEMPLATE_BLANKS, TEMPLATE_LABEL, fillTemplate, type TemplateKind } from '../../../shared/prefs';
import { Field, Textarea } from '../../components/ui';
import type { SectionProps } from './draft';

const FIELD: Record<TemplateKind, 'msgInvoice' | 'msgQuote' | 'msgDue'> = { invoice: 'msgInvoice', quote: 'msgQuote', due: 'msgDue' };

const SAMPLE: Record<TemplateKind, Record<string, string>> = {
  invoice: { name: 'Sunita Devi', business: 'Your Shop', number: 'INV/2026-27/0042', total: '₹10,500', balance: '₹8,000', due: '20 Oct 2026', upi: 'yourshop@bank' },
  quote: { name: 'Sunita Devi', business: 'Your Shop', number: 'PF/2026-27/0007', total: '₹21,000', valid_until: '5 Oct 2026' },
  due: { name: 'Sunita Devi', business: 'Your Shop', owed: '₹10,500', overdue: '₹4,000', invoices: '3', oldest_due: '1 Sept 2026', upi: 'yourshop@bank' },
};

/** Write the messages you send in your own words. Blank keeps the built-in wording, which also adapts to the situation. */
export function MessagesSection({ draft, set }: SectionProps) {
  return (
    <div className="max-w-2xl space-y-8">
      <p className="text-ink-muted">Put a blank in curly brackets, like <span className="num text-ink">{'{name}'}</span>, where the real detail should go. Leave a message empty to use the built-in wording.</p>
      {(Object.keys(FIELD) as TemplateKind[]).map((kind) => {
        const value = draft[FIELD[kind]];
        return (
          <section key={kind} className="space-y-2">
            <Field label={TEMPLATE_LABEL[kind]}>
              <Textarea rows={5} value={value} onChange={(e) => set(FIELD[kind], e.target.value)} placeholder="Built-in wording" />
            </Field>
            <p className="text-xs text-ink-muted">
              Blanks you can use:{' '}
              {TEMPLATE_BLANKS[kind].map((b, i) => (
                <span key={b.key}>
                  {i > 0 && ', '}
                  <button type="button" className="num text-brand hover:underline" onClick={() => set(FIELD[kind], `${value}${value && !value.endsWith(' ') && !value.endsWith('\n') ? ' ' : ''}{${b.key}}`)} title={`Add the ${b.label}`}>
                    {`{${b.key}}`}
                  </button>
                </span>
              ))}
            </p>
            {value.trim() && (
              <div className="rounded-lg bg-canvas px-4 py-3">
                <div className="mb-1 text-xs text-ink-muted">How it will read</div>
                <p className="whitespace-pre-line">{fillTemplate(value, SAMPLE[kind])}</p>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
