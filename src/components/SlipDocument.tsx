import type { CSSProperties } from 'react';
import { formatDate } from '../../shared/gst';
import { formatMoney } from '../../shared/money';
import type { Invoice } from '../../shared/types';

/** The page for a slip: 80 mm wide (a thermal roll), as tall as its contents need. */
export const slipPage = (lines: number, extras: number): { w: number; h: number } => ({ w: 80, h: Math.max(80, Math.round(62 + lines * 11 + extras * 4.5)) });

const money = (p: number) => formatMoney(p, { fractionDigits: p % 100 === 0 ? 0 : 2 });

/**
 * A short receipt for a thermal printer: shop, number and date, one two-line entry per item, the totals and what was paid. No logo,
 * no colours, no QR; only text that prints sharply on a 80 mm roll. The full invoice is the tax document; this is the customer's copy at the counter.
 */
export function SlipDocument({ invoice: inv }: { invoice: Invoice }) {
  const tax = inv.cgstPaise + inv.sgstPaise + inv.igstPaise;
  const style: CSSProperties = { width: '72mm', fontSize: '10px', lineHeight: 1.35 };
  const Row = ({ a, b, strong }: { a: string; b: string; strong?: boolean }) => (
    <div className={`flex justify-between gap-2 ${strong ? 'text-[13px] font-medium' : ''}`}>
      <span>{a}</span>
      <span className="num">{b}</span>
    </div>
  );
  return (
    <article className="mx-auto bg-white text-black" style={style} aria-label={`Receipt ${inv.number}`}>
      <header className="border-b border-dashed border-black pb-2 text-center">
        <div className="text-[13px] font-medium">{inv.seller.name}</div>
        {[inv.seller.address, [inv.seller.city, inv.seller.pincode].filter(Boolean).join(' ')].filter(Boolean).map((l) => (
          <div key={l}>{l}</div>
        ))}
        {inv.seller.phone && <div>Ph: {inv.seller.phone}</div>}
        {inv.seller.gstin && <div>GSTIN {inv.seller.gstin}</div>}
      </header>
      <section className="border-b border-dashed border-black py-1.5">
        <Row a={inv.type === 'B2B' ? 'Tax invoice' : 'Bill'} b={inv.number} />
        <Row a="Date" b={formatDate(inv.issueDate)} />
        <div className="truncate">To: {inv.buyer.name}</div>
      </section>
      <section className="border-b border-dashed border-black py-1.5">
        {inv.lines.map((l) => (
          <div key={l.id} className="mb-1 last:mb-0">
            <div className="truncate">{l.designName}</div>
            <div className="flex justify-between gap-2 text-[9px]">
              <span className="truncate">{[l.color, l.size].filter(Boolean).join(' · ')}</span>
            </div>
            <Row a={`${l.qty} × ${money(l.unitPricePaise)}${l.discountPaise > 0 ? ` − ${money(l.discountPaise)}` : ''}`} b={money(l.amountPaise - l.discountPaise)} />
          </div>
        ))}
      </section>
      <section className="border-b border-dashed border-black py-1.5">
        {(inv.discountPaise > 0 || inv.lineDiscountPaise > 0) && <Row a="Discount" b={`− ${money(inv.discountPaise + 0)}`} />}
        {tax > 0 && inv.taxByRate.map((g) => <Row key={g.ratePercent} a={`GST ${g.ratePercent}%`} b={money(g.taxPaise)} />)}
        {inv.roundOffPaise !== 0 && <Row a="Round off" b={`${inv.roundOffPaise < 0 ? '−' : '+'} ${money(Math.abs(inv.roundOffPaise))}`} />}
        <Row a="TOTAL" b={money(inv.totalPaise)} strong />
        {inv.paidPaise > 0 && <Row a="Paid" b={money(inv.paidPaise)} />}
        {inv.totalPaise - inv.paidPaise > 0 && inv.status !== 'cancelled' && <Row a="Balance due" b={money(inv.totalPaise - inv.paidPaise)} />}
      </section>
      <footer className="pt-2 text-center">
        <div>{inv.seller.footer || 'Thank you. Visit again.'}</div>
        {inv.seller.terms && <div className="mt-1 text-[8px]">{inv.seller.terms}</div>}
      </footer>
    </article>
  );
}
