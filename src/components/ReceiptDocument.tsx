import type { CSSProperties } from 'react';
import { formatDate, rupeesInWords } from '../../shared/gst';
import { formatMoney } from '../../shared/money';
import { PAYMENT_METHOD_LABEL, type Payment, type Settings } from '../../shared/types';

/** A receipt number that is always the same for the same payment: its date and the first letters of its id. */
export const receiptNumber = (p: Pick<Payment, 'id' | 'receivedOn'>): string => `R-${p.receivedOn.replaceAll('-', '')}-${p.id.slice(0, 4).toUpperCase()}`;

/** A receipt for money received: who paid, how much, how, and what it went towards. A reversed payment is marked as such. */
export function ReceiptDocument({ payment: p, settings }: { payment: Payment; settings: Settings }) {
  return (
    <article className="invoice-paper relative mx-auto min-h-[148mm] w-[210mm] bg-white p-[14mm] text-[11px] leading-relaxed text-ink print:min-h-0 print:w-auto print:p-0" style={{ '--accent': settings.invoiceAccent } as CSSProperties} aria-label={`Receipt ${receiptNumber(p)}`}>
      {p.voided && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-[16deg] rounded-lg border-4 border-status-overdue-fg/25 px-8 py-3 text-5xl tracking-widest text-status-overdue-fg/25">REVERSED</span>
        </div>
      )}
      <header className="flex items-start justify-between gap-8 border-b-2 border-[color:var(--accent)] pb-5">
        <div className="flex items-start gap-4">
          {settings.invoiceLogo && <img src={settings.invoiceLogo} alt="" className="max-h-[16mm] max-w-[38mm] object-contain" />}
          <div>
            <h1 className="text-xl tracking-tight">{settings.businessName}</h1>
            <div className="mt-1 text-ink-muted">
              {[settings.addressLine, [settings.city, settings.state, settings.pincode].filter(Boolean).join(', ')].filter(Boolean).map((l) => (
                <div key={l}>{l}</div>
              ))}
              {settings.phone && <div>Phone: {settings.phone}</div>}
            </div>
            {settings.gstin && <div className="mt-1.5">GSTIN: <span className="num font-medium">{settings.gstin}</span></div>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl tracking-wide text-[color:var(--accent)]">PAYMENT RECEIPT</div>
          <dl className="mt-2 space-y-0.5">
            <div className="flex justify-end gap-3"><dt className="text-ink-muted">Receipt no.</dt><dd className="num font-medium">{receiptNumber(p)}</dd></div>
            <div className="flex justify-end gap-3"><dt className="text-ink-muted">Date</dt><dd className="num">{formatDate(p.receivedOn)}</dd></div>
          </dl>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-8 py-5">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-muted">Received from</div>
          <div className="text-sm font-medium">{p.customerName}</div>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-muted">Paid by</div>
          <div>{PAYMENT_METHOD_LABEL[p.method]}</div>
          {p.reference && <div className="num text-ink-muted">Ref: {p.reference}</div>}
        </div>
      </section>

      <section className="rounded-lg border border-line px-5 py-4">
        <div className="flex items-baseline justify-between gap-6">
          <div className="text-ink-muted">Amount received</div>
          <div className="num text-2xl tracking-tight">{formatMoney(p.amountPaise)}</div>
        </div>
        <div className="mt-1 text-ink-muted">{rupeesInWords(p.amountPaise)}</div>
      </section>

      {(p.allocations.length > 0 || p.advancePaise > 0) && (
        <section className="mt-5">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-muted">Towards</div>
          <table className="w-full border-collapse">
            <tbody>
              {p.allocations.map((a) => (
                <tr key={a.invoiceId} className="border-b border-line">
                  <td className="num py-1.5">Invoice {a.invoiceNumber}</td>
                  <td className="num py-1.5 text-right">{formatMoney(a.amountPaise)}</td>
                </tr>
              ))}
              {p.advancePaise > 0 && (
                <tr className="border-b border-line">
                  <td className="py-1.5">Advance, to be adjusted against your next invoice</td>
                  <td className="num py-1.5 text-right">{formatMoney(p.advancePaise)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}
      {p.note && <p className="mt-4 text-ink-muted">Note: {p.note}</p>}
      {p.voided && <p className="mt-4 text-status-overdue-fg">This payment was reversed{p.voidReason ? `: ${p.voidReason}` : ''}.</p>}

      <footer className="mt-10 flex items-end justify-between gap-8 break-inside-avoid">
        <p className="text-ink-muted">{settings.invoiceFooter || 'Thank you.'}</p>
        <div className="w-56 text-center">
          <div className="h-12" />
          <div className="border-t border-ink pt-1">For {settings.businessName}</div>
          <div className="text-ink-muted">Authorised signatory</div>
        </div>
      </footer>
    </article>
  );
}
