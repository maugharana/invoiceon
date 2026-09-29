import { InvoicePreview } from '../../components/InvoicePreview';
import { Button, Field, Textarea } from '../../components/ui';
import { fromDraft, type SectionProps } from './draft';

export function PaymentInstructionsSection({ draft, set }: SectionProps) {
  // Cash isn't somewhere a customer can send money, so it stays out of what's printed.
  const payable = draft.paymentAccounts.filter((a) => a.kind !== 'cash' && a.name.trim());
  const fromAccounts = () => set('invoiceBank', payable.map((a) => (a.details.trim() ? `${a.name.trim()}: ${a.details.trim()}` : a.name.trim())).join('\n'));

  return (
    <div className="flex flex-wrap items-start gap-8">
      <div className="min-w-[18rem] flex-1 basis-80 space-y-4">
        <Field label="Bank / UPI details" hint="Printed as “Pay to” at the bottom of every invoice, so customers know where to send money. One item per line.">
          <Textarea rows={5} value={draft.invoiceBank} onChange={(e) => set('invoiceBank', e.target.value)} placeholder={'Bank name, branch\nA/c number · IFSC\nUPI id'} />
        </Field>
        <Button onClick={fromAccounts} disabled={payable.length === 0} title={payable.length === 0 ? 'Add a bank or UPI account under Payment Accounts first' : undefined}>
          Fill from my payment accounts
        </Button>
        <p className="text-xs text-ink-muted">Saved onto each invoice when it's issued, so changing this never alters invoices you've already sent.</p>
      </div>
      <InvoicePreview settings={fromDraft(draft)} />
    </div>
  );
}
