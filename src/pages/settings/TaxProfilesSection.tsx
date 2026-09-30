import { Plus, X } from 'lucide-react';
import type { GstSlab } from '../../../shared/gst';
import { formatMoney } from '../../../shared/money';
import { Button, Field, IconButton, Input, MoneyInput } from '../../components/ui';
import { paths } from '../../lib/router';
import { toNumber } from '../../lib/format';
import type { SectionProps } from './draft';

/** Charging by price: e.g. sarees up to ₹2,500 at 5%, and above that at 18%. Off by default, so nothing changes until it's switched on. */
function PriceSteps({ draft, set }: SectionProps) {
  const steps = draft.gstSlabs;
  const update = (next: GstSlab[]) => set('gstSlabs', next);
  const change = (i: number, patch: Partial<GstSlab>) => update(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const addStep = () => {
    // A new step goes just before the open ended last one, starting a little above the step before it.
    const before = steps.slice(0, -1);
    const start = (before[before.length - 1]?.upToPaise ?? 0) + 100000;
    update([...before, { upToPaise: start, ratePercent: steps[steps.length - 1]?.ratePercent ?? 5 }, steps[steps.length - 1]!]);
  };
  const remove = (i: number) => update(steps.filter((_, j) => j !== i));

  return (
    <div>
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" checked={draft.gstSlabsEnabled} onChange={(e) => set('gstSlabsEnabled', e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#0F6E56]" />
        <span>
          <span className="block">Charge a different rate depending on the price of each piece</span>
          <span className="block text-ink-muted">For example sarees priced up to ₹2,500 at 5% and above that at 18%. A design with its own GST rate always uses that instead.</span>
        </span>
      </label>
      {draft.gstSlabsEnabled && (
        <div className="mt-4 max-w-xl space-y-2 rounded-lg border border-line p-4">
          {steps.map((step, i) => {
            const last = i === steps.length - 1;
            return (
              <div key={i} className="grid grid-cols-[6.5rem_1fr_6rem_2rem] items-center gap-3">
                <span className="text-ink-muted">{last ? (i === 0 ? 'Every piece' : 'Above that') : i === 0 ? 'Up to' : 'Then up to'}</span>
                {last ? <span /> : <MoneyInput value={step.upToPaise ?? 0} onChange={(paise) => change(i, { upToPaise: paise })} aria-label={`Step ${i + 1} up to`} className="h-8" />}
                <div className="relative">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    value={step.ratePercent}
                    onChange={(e) => change(i, { ratePercent: Number(e.target.value) })}
                    aria-label={`Step ${i + 1} GST rate`}
                    className="num h-8 pr-7 text-right"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted">%</span>
                </div>
                {steps.length > 1 && !last ? (
                  <IconButton label={`Remove step ${i + 1}`} onClick={() => remove(i)}>
                    <X className="h-4 w-4" />
                  </IconButton>
                ) : (
                  <span />
                )}
              </div>
            );
          })}
          {steps.length < 6 && (
            <Button className="mt-2 h-8 px-3 text-xs" icon={<Plus className="h-3.5 w-3.5" />} onClick={addStep}>
              Add a step
            </Button>
          )}
          <p className="pt-1 text-xs text-ink-muted">The price is each piece's selling price before GST, as typed on the invoice.</p>
        </div>
      )}
    </div>
  );
}

export function TaxProfilesSection({ draft, set }: SectionProps) {
  const rate = toNumber(draft.gstRatePercent);
  const valid = Number.isFinite(rate) && rate >= 0 && rate <= 100;
  // ₹1,000 of goods, before tax — the same maths the invoice uses, worked through so the split is easy to see.
  const tax = valid ? Math.round(1000 * 100 * (rate / 100)) : 0;
  const half = Math.round(tax / 2);

  return (
    <div className="space-y-6">
      <div className="max-w-[14rem]">
        <Field label="GST rate %" hint="Your usual rate. A design's own rate, or a price step below, can override it">
          <Input value={draft.gstRatePercent} onChange={(e) => set('gstRatePercent', e.target.value)} inputMode="decimal" className="num text-right" />
        </Field>
      </div>

      <PriceSteps draft={draft} set={set} />

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
