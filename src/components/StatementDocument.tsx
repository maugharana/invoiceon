import type { CSSProperties } from 'react';
import { formatDate, todayIso } from '../../shared/gst';
import { formatMoney } from '../../shared/money';
import { upiPayLink } from '../../shared/upi';
import type { Ledger, Settings } from '../../shared/types';
import { QrCode } from './UpiQr';

const amount = (p: number) => formatMoney(p, { symbol: false });

/** A customer's statement of account on paper: every invoice and payment in order, with the running balance and how to settle it. */
export function StatementDocument({ ledger, settings }: { ledger: Ledger; settings: Settings }) {
  const c = ledger.customer;
  const owes = ledger.balancePaise > 0;
  const holds = ledger.balancePaise < 0;
  const upi = owes && settings.upiId && settings.invoiceShowUpiQr ? upiPayLink({ upiId: settings.upiId, payeeName: settings.businessName, amountPaise: ledger.balancePaise, note: 'Statement' }) : null;
  const address = [c.address, [c.city, c.state, c.pincode].filter(Boolean).join(', ')].filter(Boolean);

  return (
    <article className="invoice-paper relative mx-auto min-h-[297mm] w-[210mm] bg-white p-[14mm] text-[11px] leading-relaxed text-ink print:min-h-0 print:w-auto print:p-0" style={{ '--accent': settings.invoiceAccent } as CSSProperties} aria-label={`Statement for ${c.name}`}>
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
              {settings.email && <div>{settings.email}</div>}
            </div>
            {settings.gstin && <div className="mt-1.5">GSTIN: <span className="num font-medium">{settings.gstin}</span></div>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl tracking-wide text-[color:var(--accent)]">STATEMENT</div>
          <div className="mt-2 text-ink-muted">
            As of <span className="num text-ink">{formatDate(todayIso())}</span>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-[1fr_16rem] gap-8 border-b border-line py-4">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-muted">Account of</div>
          <div className="text-sm font-medium">{c.name}</div>
          <div className="text-ink-muted">
            {address.map((l) => (
              <div key={l}>{l}</div>
            ))}
            {c.phone && <div>Phone: {c.phone}</div>}
          </div>
          {c.gstin && <div className="mt-1.5">GSTIN: <span className="num font-medium">{c.gstin}</span></div>}
        </div>
        <dl className="space-y-1">
          <div className="flex justify-between"><dt className="text-ink-muted">Total billed</dt><dd className="num">{formatMoney(ledger.billedPaise)}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-muted">Total received</dt><dd className="num">{formatMoney(ledger.receivedPaise)}</dd></div>
          <div className="flex justify-between border-t border-ink pt-1.5 text-base font-medium">
            <dt>{owes ? 'Balance due' : holds ? 'Advance held' : 'Settled'}</dt>
            <dd className="num">{formatMoney(Math.abs(ledger.balancePaise))}</dd>
          </div>
        </dl>
      </section>

      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="border-b border-ink text-left text-[10px] uppercase tracking-wider text-ink-muted">
            <th className="w-24 py-2 pr-2">Date</th>
            <th className="py-2 pr-2">Details</th>
            <th className="w-28 py-2 pr-2 text-right">Billed (₹)</th>
            <th className="w-28 py-2 pr-2 text-right">Received (₹)</th>
            <th className="w-28 py-2 text-right">Balance (₹)</th>
          </tr>
        </thead>
        <tbody>
          {ledger.entries.length === 0 && (
            <tr>
              <td colSpan={5} className="py-6 text-center text-ink-muted">
                No invoices or payments yet.
              </td>
            </tr>
          )}
          {ledger.entries.map((e, i) => (
            <tr key={i} className={`break-inside-avoid border-b border-line align-top ${e.kind === 'invoice-cancelled' || e.kind === 'payment-voided' || e.kind === 'credit-note-cancelled' ? 'text-ink-muted' : ''}`}>
              <td className="num py-1.5 pr-2">{formatDate(e.date)}</td>
              <td className="py-1.5 pr-2">{e.description}</td>
              <td className="num py-1.5 pr-2 text-right">{e.debitPaise ? amount(e.debitPaise) : ''}</td>
              <td className="num py-1.5 pr-2 text-right">{e.creditPaise ? amount(e.creditPaise) : ''}</td>
              <td className="num py-1.5 text-right">{e.balancePaise < 0 ? `(${amount(-e.balancePaise)})` : amount(e.balancePaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[10px] text-ink-muted">A balance in brackets is money you have paid in advance. Cancelled invoices and reversed payments are shown, and cancel each other out.</p>

      {(settings.invoiceBank || upi) && owes && (
        <footer className="mt-8 break-inside-avoid border-t border-line pt-4">
          <div className="flex items-start gap-4 text-[10px] text-ink-muted">
            <div>
              <div className="mb-0.5 uppercase tracking-wider">Pay to</div>
              <div className="whitespace-pre-line text-ink">{settings.invoiceBank}</div>
            </div>
            {upi && (
              <div className="text-center">
                <QrCode text={upi} size={78} label="QR code to pay the balance by UPI" />
                <div className="mt-0.5 text-ink">Scan to pay <span className="num">{formatMoney(ledger.balancePaise, { fractionDigits: ledger.balancePaise % 100 === 0 ? 0 : 2 })}</span></div>
              </div>
            )}
          </div>
        </footer>
      )}
    </article>
  );
}
