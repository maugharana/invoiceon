import { formatMoney } from '../../../shared/money';
import { Field, Input } from '../../components/ui';
import { paths } from '../../lib/router';
import { toNumber } from '../../lib/format';
import type { SectionProps } from './draft';

export function TaxProfilesSection({ draft, set }: SectionProps) {
  const rate = toNumber(draft.gstRatePercent);
  const valid = Number.isFinite(rate) && rate >= 0 && rate <= 100;
  // ₹1,000 of goods, before tax — the same maths the invoice uses, worked through so the split is easy to see.
  const tax = valid ? Math.round(1000 * 100 * (rate / 100)) : 0;
  const half = Math.round(tax / 2);

  return (
    <div className="space-y-6">
      <div className="max-w-[14rem]">
        <Field label="GST rate %" hint="One rate for every item you sell">
          <Input value={draft.gstRatePercent} onChange={(e) => set('gstRatePercent', e.target.value)} inputMode="decimal" className="num text-right" />
        </Field>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium text-ink-muted">How it's charged on a ₹1,000 sale</div>
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
        <li>Your prices are entered <span className="text-ink">before GST</span>; the tax is added on the invoice.</li>
        <li>Invoice totals round to the whole rupee, with the round-off shown as its own line.</li>
        <li>
          Your GSTIN is <span className="num text-ink">{draft.gstin || 'not set'}</span>
          {' · '}
          <a href={`#${paths.settingsSection('business')}`} className="text-brand underline-offset-2 hover:underline">
            change in Business Profile
          </a>
        </li>
      </ul>
      <p className="text-xs text-ink-muted">A new rate applies to invoices you issue from now on. Invoices already issued keep the rate they were issued with.</p>
    </div>
  );
}
