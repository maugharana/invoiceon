import type { CSSProperties } from 'react';
import { formatDate, localDateOf, rupeesInWords } from '../../shared/gst';
import { formatMoney } from '../../shared/money';
import { CREDIT_NOTE_KIND_LABEL, PAYMENT_METHOD_LABEL, type CreditNote, type Party } from '../../shared/types';

// The paper credit note. Like the invoice, the screen preview, the print dialog and the exported PDF all draw this one component.

const amount = (p: number) => formatMoney(p, { symbol: false });
const addressLines = (p: Party): string[] => [p.address, [p.city, p.state, p.pincode].filter(Boolean).join(', ')].filter(Boolean);
const rateLabel = (r: number) => `${+r.toFixed(2)}%`;

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-6 py-1 ${strong ? 'border-t border-ink pt-2 text-base font-medium' : ''} ${muted ? 'text-ink-muted' : ''}`}>
      <span>{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

export function CreditNoteDocument({ note: n }: { note: CreditNote }) {
  const tax = n.invoiceType === 'B2B';
  const cancelled = n.status === 'cancelled';
  const totalTax = n.cgstPaise + n.sgstPaise + n.igstPaise;

  return (
    <article
      className="invoice-paper relative mx-auto w-[210mm] min-h-[297mm] bg-white p-[14mm] text-[11px] leading-relaxed text-ink print:min-h-0 print:w-auto print:p-0"
      style={{ '--accent': n.branding.accent } as CSSProperties}
      aria-label={`Credit note ${n.number}`}
    >
      {cancelled && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-[24deg] rounded-lg border-4 border-status-overdue-fg/25 px-8 py-3 text-6xl tracking-widest text-status-overdue-fg/25">CANCELLED</span>
        </div>
      )}

      <header className="flex items-start justify-between gap-8 border-b-2 border-[color:var(--accent)] pb-5">
        <div className="flex items-start gap-4">
          {n.branding.logo && <img src={n.branding.logo} alt="" className="max-h-[16mm] max-w-[38mm] object-contain" />}
          <div>
            <h1 className="text-xl tracking-tight">{n.seller.name}</h1>
            <div className="mt-1 text-ink-muted">
              {addressLines(n.seller).map((l) => (
                <div key={l}>{l}</div>
              ))}
              {n.seller.phone && <div>Phone: {n.seller.phone}</div>}
              {n.seller.email && <div>{n.seller.email}</div>}
            </div>
            {n.seller.gstin && <div className="mt-1.5">GSTIN: <span className="num font-medium">{n.seller.gstin}</span></div>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl tracking-wide text-[color:var(--accent)]">CREDIT NOTE</div>
          <dl className="mt-2 space-y-0.5">
            <div className="flex justify-end gap-3"><dt className="text-ink-muted">Credit note no.</dt><dd className="num font-medium">{n.number}</dd></div>
            <div className="flex justify-end gap-3"><dt className="text-ink-muted">Date</dt><dd className="num">{formatDate(n.issueDate)}</dd></div>
            <div className="flex justify-end gap-3"><dt className="text-ink-muted">Against invoice</dt><dd className="num">{n.invoiceNumber}</dd></div>
            <div className="flex justify-end gap-3"><dt className="text-ink-muted">Invoice date</dt><dd className="num">{formatDate(n.invoiceDate)}</dd></div>
          </dl>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-8 border-b border-line py-4">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-muted">{tax ? 'Credited to' : 'Customer'}</div>
          <div className="text-sm font-medium">{n.buyer.name}</div>
          <div className="text-ink-muted">
            {addressLines(n.buyer).map((l) => (
              <div key={l}>{l}</div>
            ))}
            {n.buyer.phone && <div>Phone: {n.buyer.phone}</div>}
          </div>
          {tax && n.buyer.gstin && <div className="mt-1.5">GSTIN: <span className="num font-medium">{n.buyer.gstin}</span></div>}
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-muted">{CREDIT_NOTE_KIND_LABEL[n.kind]}</div>
          {n.reason && <div>{n.reason}</div>}
          {tax && (
            <div className="mt-1.5 text-ink-muted">
              Place of supply: <span className="text-ink">{n.placeOfSupply}</span>
              <div>{n.intraState ? 'Intra-state supply: CGST + SGST' : 'Inter-state supply: IGST'}</div>
            </div>
          )}
        </div>
      </section>

      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="border-b border-ink text-left text-[10px] uppercase tracking-wider text-ink-muted">
            <th className="w-8 py-2 pr-2">#</th>
            <th className="py-2 pr-2">Description</th>
            {tax && <th className="w-16 py-2 pr-2">HSN</th>}
            <th className="w-12 py-2 pr-2 text-right">Qty</th>
            <th className="w-24 py-2 pr-2 text-right">Rate (₹)</th>
            <th className="w-28 py-2 text-right">Credited (₹)</th>
          </tr>
        </thead>
        <tbody>
          {n.lines.map((l, i) => (
            <tr key={l.id} className="break-inside-avoid border-b border-line align-top">
              <td className="num py-2 pr-2 text-ink-muted">{i + 1}</td>
              <td className="py-2 pr-2">
                <div className="font-medium">{l.designName}</div>
                {(l.color || l.sku) && <div className="text-ink-muted">{[l.color, l.size, l.sku].filter(Boolean).join(' · ')}</div>}
              </td>
              {tax && <td className="num py-2 pr-2">{l.hsn || '—'}</td>}
              <td className="num py-2 pr-2 text-right">{l.qty}</td>
              <td className="num py-2 pr-2 text-right">{amount(l.unitPricePaise)}</td>
              <td className="num py-2 text-right">{amount(l.taxablePaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-4 grid break-inside-avoid grid-cols-[1fr_16rem] gap-8">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-muted">Amount in words</div>
          <div className="mt-0.5 font-medium">{rupeesInWords(n.totalPaise)}</div>
          {n.notes && (
            <>
              <div className="mt-4 text-[10px] uppercase tracking-wider text-ink-muted">Notes</div>
              <div className="mt-0.5 whitespace-pre-line">{n.notes}</div>
            </>
          )}
          {!cancelled && (
            <div className="mt-4 space-y-0.5 text-ink-muted">
              {n.refundPaise > 0 && <div>Refunded: <span className="num text-ink">{formatMoney(n.refundPaise)}</span> by {n.refundMethod ? PAYMENT_METHOD_LABEL[n.refundMethod] : 'refund'}{n.refundReference ? ` (${n.refundReference})` : ''}</div>}
              {n.appliedToInvoicePaise > 0 && <div>Set against invoice {n.invoiceNumber}: <span className="num text-ink">{formatMoney(n.appliedToInvoicePaise)}</span></div>}
              {n.heldAsCreditPaise > 0 && <div>Held as credit for the customer: <span className="num text-ink">{formatMoney(n.heldAsCreditPaise)}</span></div>}
            </div>
          )}
        </div>
        <div>
          <Row label="Taxable value" value={formatMoney(n.taxablePaise)} />
          {n.taxSummary.map((g) =>
            n.intraState ? (
              <div key={g.ratePercent}>
                <Row label={`CGST @ ${rateLabel(g.ratePercent / 2)}`} value={formatMoney(g.cgstPaise)} />
                <Row label={`SGST @ ${rateLabel(g.ratePercent / 2)}`} value={formatMoney(g.sgstPaise)} />
              </div>
            ) : (
              <Row key={g.ratePercent} label={`IGST @ ${rateLabel(g.ratePercent)}`} value={formatMoney(g.igstPaise)} />
            ),
          )}
          {n.roundOffPaise !== 0 && <Row muted label="Round off" value={`${n.roundOffPaise < 0 ? '− ' : '+ '}${formatMoney(Math.abs(n.roundOffPaise))}`} />}
          <Row strong label="Total credit" value={formatMoney(n.totalPaise)} />
        </div>
      </section>

      {tax && (
        <table className="mt-5 w-full break-inside-avoid border-collapse text-[10px]">
          <thead>
            <tr className="border-b border-line text-left uppercase tracking-wider text-ink-muted">
              <th className="py-1.5 pr-2">Tax summary</th>
              <th className="py-1.5 pr-2 text-right">Taxable value</th>
              <th className="py-1.5 pr-2 text-right">CGST</th>
              <th className="py-1.5 pr-2 text-right">SGST</th>
              <th className="py-1.5 pr-2 text-right">IGST</th>
              <th className="py-1.5 text-right">Total tax</th>
            </tr>
          </thead>
          <tbody>
            {n.taxSummary.map((g) => (
              <tr key={g.ratePercent} className="num">
                <td className="py-1.5 pr-2">GST @ {rateLabel(g.ratePercent)}</td>
                <td className="py-1.5 pr-2 text-right">{amount(g.taxablePaise)}</td>
                <td className="py-1.5 pr-2 text-right">{amount(g.cgstPaise)}</td>
                <td className="py-1.5 pr-2 text-right">{amount(g.sgstPaise)}</td>
                <td className="py-1.5 pr-2 text-right">{amount(g.igstPaise)}</td>
                <td className="py-1.5 text-right">{amount(g.cgstPaise + g.sgstPaise + g.igstPaise)}</td>
              </tr>
            ))}
            {n.taxSummary.length > 1 && (
              <tr className="num border-t border-line font-medium">
                <td className="py-1.5 pr-2">Total</td>
                <td className="py-1.5 pr-2 text-right">{amount(n.taxablePaise)}</td>
                <td className="py-1.5 pr-2 text-right">{amount(n.cgstPaise)}</td>
                <td className="py-1.5 pr-2 text-right">{amount(n.sgstPaise)}</td>
                <td className="py-1.5 pr-2 text-right">{amount(n.igstPaise)}</td>
                <td className="py-1.5 text-right">{amount(totalTax)}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <footer className="mt-8 break-inside-avoid border-t border-line pt-4">
        <div className={`grid items-end gap-8 ${n.branding.showSignature ? 'grid-cols-[1fr_14rem]' : 'grid-cols-1'}`}>
          <div className="space-y-3 text-[10px] text-ink-muted">
            <div>This credit note reduces the amount due on invoice {n.invoiceNumber}. Please keep it with that invoice.</div>
            {cancelled && <div className="text-status-overdue-fg">Cancelled{n.cancelledAt ? ` on ${formatDate(localDateOf(n.cancelledAt))}` : ''}{n.cancelReason ? `: ${n.cancelReason}` : ''}</div>}
          </div>
          {n.branding.showSignature && (
            <div className="text-center">
              <div className="h-14" />
              <div className="border-t border-ink pt-1">For {n.seller.name}</div>
              <div className="text-ink-muted">Authorised signatory</div>
            </div>
          )}
        </div>
        {n.seller.footer && <p className="mt-5 text-center text-[11px] text-[color:var(--accent)]">{n.seller.footer}</p>}
      </footer>
    </article>
  );
}
