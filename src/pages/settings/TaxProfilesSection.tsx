import { formatMoney } from '../../../shared/money';
import { computeTotals, ROUND_OFF_LABEL, type RateSlab, type RoundOff } from '../../../shared/gst';
import { Button, Field, Input, MoneyInput, Segmented, Select } from '../../components/ui';
import { paths } from '../../lib/router';
import { toNumber } from '../../lib/format';
import type { SectionProps } from './draft';

const MAX_SLABS = 5;

/** Pieces priced up to a limit get a rate of their own. Kept in order; blank rows are simply not saved until filled in. */
function SlabEditor({ slabs, onChange, usual }: { slabs: RateSlab[]; onChange: (s: RateSlab[]) => void; usual: number }) {
  const sorted = [...slabs].sort((a, b) => a.upToPaise - b.upToPaise);
  const update = (i: number, patch: Partial<RateSlab>) => onChange(slabs.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  return (
    <div className="space-y-3">
      {slabs.length > 0 && (
        <ul className="space-y-2">
          {slabs.map((s, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <span className="text-ink-muted">A piece priced up to</span>
              <MoneyInput value={s.upToPaise} onChange={(p) => update(i, { upToPaise: p })} aria-label={`Price limit ${i + 1}`} className="h-9 w-32" />
              <span className="text-ink-muted">is taxed at</span>
              <div className="relative">
                <Input value={String(s.ratePercent)} onChange={(e) => update(i, { ratePercent: Number(e.target.value.replace(/[^\d.]/g, '').slice(0, 6)) || 0 })} inputMode="decimal" aria-label={`Rate ${i + 1}`} className="num h-9 w-24 pr-7 text-right" />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted">%</span>
              </div>
              <button type="button" onClick={() => onChange(slabs.filter((_, k) => k !== i))} className="rounded-lg px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={slabs.length >= MAX_SLABS} onClick={() => onChange([...slabs, { upToPaise: 0, ratePercent: usual }])}>
          Add a price slab
        </Button>
        {sorted.length > 0 && <span className="text-xs text-ink-muted">Anything priced above {formatMoney(sorted[sorted.length - 1]!.upToPaise)} is taxed at your usual rate.</span>}
      </div>
    </div>
  );
}

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
        <Field label="Usual GST rate %" hint="Used for any item that has no rate of its own and no price slab below">
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
        <div className="mb-1 text-xs font-medium text-ink-muted">Rates by price (optional)</div>
        <p className="mb-3 text-xs text-ink-muted">Sarees are often taxed at one rate up to a price per piece and at another above it. Set the limits here and each item gets the right rate on its own. Compared with what one piece sells for after any discount, as you enter it{inclusive ? ' (your prices include GST, so set the limits that way too)' : ''}. A single design can also have its own rate, and a rate can be typed on any item of an invoice.</p>
        <SlabEditor slabs={draft.rateSlabs} onChange={(s) => set('rateSlabs', s)} usual={valid ? rate : 0} />
      </div>

      <div className="max-w-sm">
        <Field label="Rounding the total" hint="The difference is shown on the invoice as its own “Round off” line.">
          <Select value={draft.roundOff} onChange={(e) => set('roundOff', e.target.value as RoundOff)}>
            {(Object.keys(ROUND_OFF_LABEL) as RoundOff[]).map((k) => (
              <option key={k} value={k}>
                {ROUND_OFF_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
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
        <li>{draft.roundOff === 'none' ? 'Invoice totals are exact, to the paisa.' : `Invoice totals are rounded (${ROUND_OFF_LABEL[draft.roundOff].toLowerCase()}), with the round-off shown as its own line.`}</li>
        <li>
          Your GSTIN is <span className="num text-ink">{draft.gstin || 'not set'}</span>
          {' · '}
          <a href={`#${paths.settingsSection('business')}`} className="text-brand underline-offset-2 hover:underline">
            change in Business Profile
          </a>
        </li>
      </ul>
      <p className="text-xs text-ink-muted">A new rate, slab or rounding choice applies to invoices you issue from now on. Invoices already issued keep what they were issued with, and a quote keeps the rates it was quoted at when it becomes an invoice.</p>
    </div>
  );
}
