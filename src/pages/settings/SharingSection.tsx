import { isValidUpiId, renderTemplate, DEFAULT_EMAIL_SUBJECT, DEFAULT_INVOICE_MESSAGE, DEFAULT_REMINDER_MESSAGE } from '../../../shared/share';
import { Button, Field, Input, Textarea } from '../../components/ui';
import type { SectionProps } from './draft';

const SAMPLE = {
  customer: 'Sunita Verma',
  business: 'Your business',
  number: 'INV/2026-27/0012',
  total: '₹10,710',
  balance: '₹4,200',
  dueDate: '15 Oct 2026',
  dueLine: ' ₹4,200 is due by 15 Oct 2026.',
  owedLine: 'you have ₹8,400 outstanding, of which ₹4,200 is overdue.',
  invoices: '• INV/2026-27/0009: ₹4,200 (due 2 Oct 2026)\n• INV/2026-27/0012: ₹4,200 (due 15 Oct 2026)',
};

function Preview({ text }: { text: string }) {
  return <div className="whitespace-pre-line rounded-lg border border-line bg-canvas px-3 py-2.5 text-ink-muted">{text}</div>;
}

export function SharingSection({ draft, set }: SectionProps) {
  const upiOk = !draft.upiId || isValidUpiId(draft.upiId);
  const vars = { ...SAMPLE, business: draft.businessName || SAMPLE.business, upi: draft.upiId, upiLine: draft.upiId ? `\nYou can pay by UPI to ${draft.upiId}.` : '' };

  return (
    <div className="max-w-2xl space-y-8">
      <div className="space-y-3">
        <Field label="Your UPI id" hint="Like maugharana@sbi. Customers scan the QR code on an invoice to pay the amount due in any UPI app." error={upiOk ? undefined : 'A UPI id looks like name@bank'}>
          <Input value={draft.upiId} onChange={(e) => set('upiId', e.target.value.trim())} placeholder="name@bank" className="num max-w-xs" />
        </Field>
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={draft.invoiceShowUpiQr} onChange={(e) => set('invoiceShowUpiQr', e.target.checked)} className="h-4 w-4 accent-[#0F6E56]" />
          Print a pay by UPI QR code on invoices that still have something to pay
        </label>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-base">Message with an invoice</h3>
          <p className="text-ink-muted">Used by Share, on WhatsApp and by email. Placeholders in curly brackets are filled in: <span className="num">{'{customer} {business} {number} {total} {balance} {dueDate} {dueLine} {upi} {upiLine}'}</span>.</p>
        </div>
        <Textarea rows={7} value={draft.shareInvoiceMessage} onChange={(e) => set('shareInvoiceMessage', e.target.value)} aria-label="Invoice message" />
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-ink-muted">What it looks like</span>
          <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => set('shareInvoiceMessage', DEFAULT_INVOICE_MESSAGE)}>
            Use the standard wording
          </Button>
        </div>
        <Preview text={renderTemplate(draft.shareInvoiceMessage, vars)} />
        <Field label="Email subject">
          <Input value={draft.shareEmailSubject} onChange={(e) => set('shareEmailSubject', e.target.value)} onBlur={() => !draft.shareEmailSubject.trim() && set('shareEmailSubject', DEFAULT_EMAIL_SUBJECT)} />
        </Field>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-base">Payment reminder</h3>
          <p className="text-ink-muted">Used by Remind on the Dues screen and on an invoice. Placeholders: <span className="num">{'{customer} {business} {owedLine} {invoices} {upiLine} {balance} {number}'}</span>.</p>
        </div>
        <Textarea rows={7} value={draft.shareReminderMessage} onChange={(e) => set('shareReminderMessage', e.target.value)} aria-label="Reminder message" />
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-ink-muted">What it looks like</span>
          <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => set('shareReminderMessage', DEFAULT_REMINDER_MESSAGE)}>
            Use the standard wording
          </Button>
        </div>
        <Preview text={renderTemplate(draft.shareReminderMessage, vars)} />
      </div>

      <p className="text-xs text-ink-muted">Nothing is sent by InvoiceOn itself: Share opens WhatsApp or your email program with the message ready, and you press send. The invoice PDF is attached by hand (Save PDF first).</p>
    </div>
  );
}
