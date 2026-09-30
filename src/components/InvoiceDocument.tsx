import type { CSSProperties } from 'react';
import { formatDate, localDateOf, rupeesInWords } from '../../shared/gst';
import { formatMoney } from '../../shared/money';
import { upiPaymentLink } from '../../shared/share';
import { QrCode } from './QrCode';
import type { Invoice, Party } from '../../shared/types';

// The paper invoice. The on-screen preview, the print dialog and the exported PDF all render this one
// component, so what you see is what you print. B2B gets a GST tax invoice (GSTIN, HSN, tax breakup);
// B2C gets a plainer retail invoice.

const amount = (p: number) => formatMoney(p, { symbol: false });

const addressLines = (p: Party): string[] => [p.address, [p.city, p.state, p.pincode].filter(Boolean).join(', ')].filter(Boolean);

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-6 py-1 ${strong ? 'border-t border-ink pt-2 text-base font-medium' : ''} ${muted ? 'text-ink-muted' : ''}`}>
      <span>{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

/** `variant="proforma"` dresses the same document as a quote: its own title and number label, "valid until", and no claim to be a tax invoice. */
export function InvoiceDocument({ invoice: inv, variant = 'invoice' }: { invoice: Invoice; variant?: 'invoice' | 'proforma' }) {
  const proforma = variant === 'proforma';
  const tax = inv.type === 'B2B';
  const cancelled = inv.status === 'cancelled';
  const totalTax = inv.cgstPaise + inv.sgstPaise + inv.igstPaise;
  // What the QR asks for: the balance still due on an invoice, or the whole of a quote. Nothing once it's paid or cancelled.
  const payAmount = cancelled ? 0 : proforma ? inv.totalPaise : inv.totalPaise - inv.paidPaise;
  const rateLabel = (r: number) => `${+r.toFixed(2)}%`; // 2.5%, 6%, 9%
  // One tax row per rate. Most invoices have one; a mixed one (say silk at 5% and a brocade at 18%) shows each on its own.
  const rateGroups = inv.taxSummary;
  const mixed = rateGroups.length > 1;

  return (
    <article
      className="invoice-paper relative mx-auto w-[210mm] min-h-[297mm] bg-white p-[14mm] text-[11px] leading-relaxed text-ink print:min-h-0 print:w-auto print:p-0"
      // The one colour the owner chooses in Settings → Invoice Settings. Everything else stays in the brand's ink tones.
      style={{ '--accent': inv.branding.accent } as CSSProperties}
      aria-label={`${proforma ? 'Proforma' : 'Invoice'} ${inv.number}`}
    >
      {cancelled && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-[24deg] rounded-lg border-4 border-status-overdue-fg/25 px-8 py-3 text-6xl tracking-widest text-status-overdue-fg/25">CANCELLED</span>
        </div>
      )}

      {/* Header */}
      <header className="flex items-start justify-between gap-8 border-b-2 border-[color:var(--accent)] pb-5">
        <div className="flex items-start gap-4">
          {inv.branding.logo && <img src={inv.branding.logo} alt="" className="max-h-[16mm] max-w-[38mm] object-contain" />}
          <div>
            <h1 className="text-xl tracking-tight">{inv.seller.name}</h1>
            <div className="mt-1 text-ink-muted">
              {addressLines(inv.seller).map((l) => (
                <div key={l}>{l}</div>
              ))}
              {inv.seller.phone && <div>Phone: {inv.seller.phone}</div>}
              {inv.seller.email && <div>{inv.seller.email}</div>}
            </div>
            {inv.seller.gstin && <div className="mt-1.5">GSTIN: <span className="num font-medium">{inv.seller.gstin}</span></div>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl tracking-wide text-[color:var(--accent)]">{proforma ? 'PROFORMA INVOICE' : tax ? 'TAX INVOICE' : 'INVOICE'}</div>
          <dl className="mt-2 space-y-0.5">
            <div className="flex justify-end gap-3"><dt className="text-ink-muted">{proforma ? 'Proforma no.' : 'Invoice no.'}</dt><dd className="num font-medium">{inv.number}</dd></div>
            <div className="flex justify-end gap-3"><dt className="text-ink-muted">Date</dt><dd className="num">{formatDate(inv.issueDate)}</dd></div>
            {(proforma || tax) && inv.dueDate && <div className="flex justify-end gap-3"><dt className="text-ink-muted">{proforma ? 'Valid until' : 'Due'}</dt><dd className="num">{formatDate(inv.dueDate)}</dd></div>}
          </dl>
        </div>
      </header>

      {/* Parties */}
      <section className="grid grid-cols-2 gap-8 border-b border-line py-4">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-muted">{tax ? 'Billed to' : 'Customer'}</div>
          <div className="text-sm font-medium">{inv.buyer.name}</div>
          <div className="text-ink-muted">
            {addressLines(inv.buyer).map((l) => (
              <div key={l}>{l}</div>
            ))}
            {inv.buyer.phone && <div>Phone: {inv.buyer.phone}</div>}
          </div>
          {tax && inv.buyer.gstin && <div className="mt-1.5">GSTIN: <span className="num font-medium">{inv.buyer.gstin}</span></div>}
        </div>
        {tax && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-muted">Supply</div>
            <div>Place of supply: <span className="font-medium">{inv.placeOfSupply}</span></div>
            <div className="text-ink-muted">{inv.intraState ? 'Intra-state supply — CGST + SGST' : 'Inter-state supply — IGST'}</div>
          </div>
        )}
      </section>

      {/* Items */}
      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="border-b border-ink text-left text-[10px] uppercase tracking-wider text-ink-muted">
            <th className="w-8 py-2 pr-2">#</th>
            <th className="py-2 pr-2">Description</th>
            {tax && <th className="w-16 py-2 pr-2">HSN</th>}
            <th className="w-12 py-2 pr-2 text-right">Qty</th>
            {mixed && <th className="w-12 py-2 pr-2 text-right">GST</th>}
            <th className="w-24 py-2 pr-2 text-right">Rate (₹)</th>
            <th className="w-28 py-2 text-right">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l, i) => (
            <tr key={l.id} className="break-inside-avoid border-b border-line align-top">
              <td className="num py-2 pr-2 text-ink-muted">{i + 1}</td>
              <td className="py-2 pr-2">
                <div className="font-medium">{l.designName}</div>
                <div className="text-ink-muted">{l.color} · {l.size} · {l.sku}</div>
              </td>
              {tax && <td className="num py-2 pr-2">{l.hsn || '—'}</td>}
              <td className="num py-2 pr-2 text-right">{l.qty}</td>
              {mixed && <td className="num py-2 pr-2 text-right">{rateLabel(l.gstRatePercent ?? inv.gstRatePercent)}</td>}
              <td className="num py-2 pr-2 text-right">{amount(l.unitPricePaise)}</td>
              <td className="num py-2 text-right">{amount(l.amountPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <section className="mt-4 grid break-inside-avoid grid-cols-[1fr_16rem] gap-8">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-muted">Amount in words</div>
          <div className="mt-0.5 font-medium">{rupeesInWords(inv.totalPaise)}</div>
          {inv.notes && (
            <>
              <div className="mt-4 text-[10px] uppercase tracking-wider text-ink-muted">Notes</div>
              <div className="mt-0.5 whitespace-pre-line">{inv.notes}</div>
            </>
          )}
        </div>
        <div>
          <Row label="Subtotal" value={formatMoney(inv.subtotalPaise)} />
          {inv.discountPaise > 0 && <Row label="Discount" value={`− ${formatMoney(inv.discountPaise)}`} />}
          {inv.discountPaise > 0 && <Row label="Taxable value" value={formatMoney(inv.taxablePaise)} />}
          {rateGroups.map((g) =>
            tax && inv.intraState ? (
              <div key={g.ratePercent}>
                <Row label={`CGST @ ${rateLabel(g.ratePercent / 2)}`} value={formatMoney(g.cgstPaise)} />
                <Row label={`SGST @ ${rateLabel(g.ratePercent / 2)}`} value={formatMoney(g.sgstPaise)} />
              </div>
            ) : tax ? (
              <Row key={g.ratePercent} label={`IGST @ ${rateLabel(g.ratePercent)}`} value={formatMoney(g.igstPaise)} />
            ) : (
              <Row key={g.ratePercent} label={`GST @ ${rateLabel(g.ratePercent)}`} value={formatMoney(g.cgstPaise + g.sgstPaise + g.igstPaise)} />
            ),
          )}
          {inv.roundOffPaise !== 0 && <Row muted label="Round off" value={`${inv.roundOffPaise < 0 ? '− ' : '+ '}${formatMoney(Math.abs(inv.roundOffPaise))}`} />}
          <Row strong label="Total" value={formatMoney(inv.totalPaise)} />
          {!cancelled && inv.paidPaise > 0 && (
            <>
              {(inv.creditedPaise ?? 0) > 0 && <Row muted label="Credit notes" value={`− ${formatMoney(inv.creditedPaise ?? 0)}`} />}
              {inv.paidPaise - (inv.creditedPaise ?? 0) > 0 && <Row muted label="Received" value={`− ${formatMoney(inv.paidPaise - (inv.creditedPaise ?? 0))}`} />}
              <Row label="Balance due" value={formatMoney(inv.totalPaise - inv.paidPaise)} />
            </>
          )}
        </div>
      </section>

      {/* Tax breakup (B2B) */}
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
            {rateGroups.map((g) => (
              <tr key={g.ratePercent} className="num">
                <td className="py-1.5 pr-2">GST @ {rateLabel(g.ratePercent)}</td>
                <td className="py-1.5 pr-2 text-right">{amount(g.taxablePaise)}</td>
                <td className="py-1.5 pr-2 text-right">{amount(g.cgstPaise)}</td>
                <td className="py-1.5 pr-2 text-right">{amount(g.sgstPaise)}</td>
                <td className="py-1.5 pr-2 text-right">{amount(g.igstPaise)}</td>
                <td className="py-1.5 text-right">{amount(g.cgstPaise + g.sgstPaise + g.igstPaise)}</td>
              </tr>
            ))}
            {mixed && (
              <tr className="num border-t border-line font-medium">
                <td className="py-1.5 pr-2">Total</td>
                <td className="py-1.5 pr-2 text-right">{amount(inv.taxablePaise)}</td>
                <td className="py-1.5 pr-2 text-right">{amount(inv.cgstPaise)}</td>
                <td className="py-1.5 pr-2 text-right">{amount(inv.sgstPaise)}</td>
                <td className="py-1.5 pr-2 text-right">{amount(inv.igstPaise)}</td>
                <td className="py-1.5 text-right">{amount(totalTax)}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {/* Footer */}
      <footer className="mt-8 break-inside-avoid border-t border-line pt-4">
        <div className={`grid items-end gap-8 ${inv.branding.showSignature ? 'grid-cols-[1fr_14rem]' : 'grid-cols-1'}`}>
          <div className="space-y-3 text-[10px] text-ink-muted">
            {inv.seller.bank && (
              <div>
                <div className="mb-0.5 uppercase tracking-wider">Pay to</div>
                <div className="whitespace-pre-line text-ink">{inv.seller.bank}</div>
              </div>
            )}
            {payAmount > 0 && inv.payByUpi && (
              <div className="flex items-center gap-3">
                <QrCode value={upiPaymentLink({ upiId: inv.payByUpi, payeeName: inv.seller.name, amountPaise: payAmount, note: `${proforma ? 'Proforma' : 'Invoice'} ${inv.number}` })} className="h-[26mm] w-[26mm] shrink-0 border border-line" />
                <div>
                  <div className="mb-0.5 uppercase tracking-wider">Pay by UPI</div>
                  <div className="text-ink">Scan with any UPI app to pay <span className="num font-medium">{formatMoney(payAmount)}</span></div>
                  <div className="num">{inv.payByUpi}</div>
                </div>
              </div>
            )}
            {inv.seller.terms && (
              <div>
                <div className="mb-0.5 uppercase tracking-wider">Terms</div>
                <div>{inv.seller.terms}</div>
              </div>
            )}
            {proforma && !cancelled && <div>This is a proforma invoice — a quotation for your order, not a tax invoice. No goods are reserved until it is invoiced.</div>}
            {cancelled && <div className="text-status-overdue-fg">Cancelled{inv.cancelledAt ? ` on ${formatDate(localDateOf(inv.cancelledAt))}` : ''}{inv.cancelReason ? ` — ${inv.cancelReason}` : ''}</div>}
          </div>
          {inv.branding.showSignature && (
            <div className="text-center">
              <div className="h-14" />
              <div className="border-t border-ink pt-1">For {inv.seller.name}</div>
              <div className="text-ink-muted">Authorised signatory</div>
            </div>
          )}
        </div>
        {inv.seller.footer && <p className="mt-5 text-center text-[11px] text-[color:var(--accent)]">{inv.seller.footer}</p>}
      </footer>
    </article>
  );
}
