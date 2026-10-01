import { InvoicePreview } from '../../components/InvoicePreview';
import { Button, Field, Input, Textarea } from '../../components/ui';
import { isValidUpiId } from '../../../shared/upi';
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
        <Field label="UPI ID" hint="Like name@bank. With it, invoices print a QR code that opens a payment for the balance in any UPI app." error={draft.upiId.trim() && !isValidUpiId(draft.upiId.trim()) ? "That doesn't look like a UPI ID. It should look like name@bank." : undefined}>
          <Input value={draft.upiId} onChange={(e) => set('upiId', e.target.value)} placeholder="yourshop@bank" autoComplete="off" />
        </Field>
        <label className="flex cursor-pointer items-center gap-2.5">
          <input type="checkbox" checked={draft.invoiceShowUpiQr} onChange={(e) => set('invoiceShowUpiQr', e.target.checked)} className="h-4 w-4 accent-[#0F6E56]" />
          <span>Print the QR code on invoices that still have a balance</span>
        </label>
        <Button onClick={fromAccounts} disabled={payable.length === 0} title={payable.length === 0 ? 'Add a bank or UPI account under Payment Accounts first' : undefined}>
          Fill from my payment accounts
        </Button>
        <p className="text-xs text-ink-muted">Saved onto each invoice when it's issued, so changing this never alters invoices you've already sent.</p>
      </div>
      <InvoicePreview settings={fromDraft(draft)} />
    </div>
  );
}
