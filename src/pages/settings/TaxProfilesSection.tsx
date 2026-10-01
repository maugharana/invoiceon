import { formatMoney } from '../../../shared/money';
import { computeTotals } from '../../../shared/gst';
import { Field, Input, Segmented } from '../../components/ui';
import { paths } from '../../lib/router';
import { toNumber } from '../../lib/format';
import type { SectionProps } from './draft';

export function TaxProfilesSection({ draft, set }: SectionProps) {
  const rate = toNumber(draft.gstRatePercent);
  const valid = Number.isFinite(rate) && rate >= 0 && rate <= 100;
  const inclusive = draft.pricesIncludeGst;
  // A ₹1,000 price — the same maths the invoice uses, worked through so the split is easy to see.
  const t = computeTotals({ lineAmounts: [1000 * 100], discountPaise: 0, ratePercent: valid ? rate : 0, intraState: true, inclusive });
  const tax = valid ? t.taxPaise : 0;
  const half = Math.round(tax / 2);

  return (
    <div className="space-y-6">
      <div className="max-w-[14rem]">
        <Field label="GST rate %" hint="One rate for every item you sell">
          <Input value={draft.gstRatePercent} onChange={(e) => set('gstRatePercent', e.target.value)} inputMode="decimal" className="num text-right" />
        </Field>
      </div>

      <div className="space-y-2">
        <Segmented
          label="Are your prices with or without GST?"
          value={inclusive ? 'inclusive' : 'exclusive'}
          onChange={(v) => set('pricesIncludeGst', v === 'inclusive')}
          options={[
            { value: 'exclusive', label: 'Exclusive — GST added on top' },
            { value: 'inclusive', label: 'Inclusive — GST already in the price' },
          ]}
        />
        <p className="text-xs text-ink-muted">
          {inclusive
            ? `A ₹1,000 saree bills at ₹1,000: ${valid ? formatMoney(t.taxablePaise) : '—'} price + ${valid ? formatMoney(t.taxPaise) : '—'} GST. The customer pays what the price says.`
            : `A ₹1,000 saree bills at ${valid ? formatMoney(t.totalPaise) : '—'}: ₹1,000 price + ${valid ? formatMoney(t.taxPaise) : '—'} GST on top.`}
        </p>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium text-ink-muted">How it's charged on a ₹1,000 {inclusive ? 'price' : 'sale'}</div>
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-left">
            <thead className="bg-canvas text-xs text-ink-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Buyer is…</th>
                <th className="px-4 py-2 font-medium">Tax lines on the invoice</th>
                <th className="px-4 py-2 text-right font-medium">Total tax</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line/70">
                <td className="px-4 py-2.5">In {draft.state || 'your state'}</td>
                <td className="px-4 py-2.5 text-ink-muted">
                  CGST <span className="num">{valid ? formatMoney(half) : '—'}</span> + SGST <span className="num">{valid ? formatMoney(tax - half) : '—'}</span>
                </td>
                <td className="num px-4 py-2.5 text-right">{valid ? formatMoney(tax) : '—'}</td>
              </tr>
              <tr className="border-t border-line/70">
                <td className="px-4 py-2.5">In another state</td>
                <td className="px-4 py-2.5 text-ink-muted">
                  IGST <span className="num">{valid ? formatMoney(tax) : '—'}</span>
                </td>
                <td className="num px-4 py-2.5 text-right">{valid ? formatMoney(tax) : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <ul className="space-y-1.5 text-ink-muted">
        <li>
          {inclusive ? (
            <>Your prices are entered <span className="text-ink">with GST included</span>; the invoice works the tax out of them, so the total never goes above the price.</>
          ) : (
            <>Your prices are entered <span className="text-ink">before GST</span>; the tax is added on the invoice.</>
          )}
        </li>
        <li>Invoice totals round to the whole rupee, with the round-off shown as its own line.</li>
        <li>
          Your GSTIN is <span className="num text-ink">{draft.gstin || 'not set'}</span>
          {' · '}
          <a href={`#${paths.settingsSection('business')}`} className="text-brand underline-offset-2 hover:underline">
            change in Business Profile
          </a>
        </li>
      </ul>
      <p className="text-xs text-ink-muted">A new rate or pricing choice applies to invoices you issue from now on. Invoices already issued keep the rate they were issued with.</p>
    </div>
  );
}
