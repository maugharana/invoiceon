import { CornerDownLeft, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { formatMoney } from '../../../shared/money';
import { parseQuickBill, resolveQuickBill, type QuickDiscount, type QuickPayment, type QuickPlan } from '../../../shared/quickBill';
import { PAYMENT_METHOD_LABEL, type Customer, type SaleVariant, type Salesperson } from '../../../shared/types';
import { Button, Card, Select } from '../../components/ui';
import { Chip } from './invoiceParts';

/** What the person has confirmed, ready to be put on the bill. */
export interface QuickApply {
  items: { variant: SaleVariant; qty: number; pricePaise: number | null }[];
  customer: Customer | null;
  /** A walk-in sale, with a name when one was given. */
  walkIn: boolean;
  walkInName: string | null;
  discount: QuickDiscount | null;
  payment: QuickPayment | null;
  soldById: string | null;
  dueDays: number | null;
  note: string | null;
}

const EXAMPLES = [
  '2 kadhua ivory, 10% off, Meena, paid 5000 UPI',
  'chanderi lemon x3 at 3200, for Sunita, paid in full cash',
  '1 butidar maroon and 2 chanderi peach, 500 off, pay later, due in 15 days',
  'kadhua wine, walk-in, paid by card, sold by Ravi',
  '2 kadhua ivory, Kanchan, paid 20k bank, note: deliver to the shop',
];

const describeDiscount = (d: QuickDiscount) => (d.kind === 'percent' ? `${d.percent}% off every item` : `${formatMoney(d.paise)} off the bill`);
const describePayment = (p: QuickPayment) => (p.mode === 'later' ? 'Pay later — nothing received now' : `${p.method ? PAYMENT_METHOD_LABEL[p.method] : 'Cash'} · ${p.amountPaise === null ? 'all of it' : `${formatMoney(p.amountPaise)} received`}`);

/**
 * One line that fills in the bill: "2 kadhua ivory, 10% off, Meena, paid 5000 UPI". It is read on this computer by rules, shown back
 * for the person to check, and only then put on the bill. Where the words fit more than one item or customer the person picks; an
 * item that fits nothing can be left out. Nothing is ever issued from here.
 */
export function QuickBillBar({ variants, customers, team, quote, onApply }: { variants: SaleVariant[]; customers: Customer[]; team: Salesperson[]; quote: boolean; onApply: (a: QuickApply) => void }) {
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<QuickPlan | null>(null);
  const [itemChoice, setItemChoice] = useState<Record<number, string>>({});
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [customerChoice, setCustomerChoice] = useState('');
  const [soldByChoice, setSoldByChoice] = useState('');
  const [help, setHelp] = useState(false);

  function read(line = text) {
    if (!line.trim()) return;
    const next = resolveQuickBill(parseQuickBill(line), { variants, customers, team });
    setPlan(next);
    setItemChoice(Object.fromEntries(next.items.map((it, i) => [i, it.chosen?.variantId ?? ''])));
    setSkipped(new Set());
    setCustomerChoice(next.customer?.chosen?.id ?? '');
    setSoldByChoice(next.soldBy?.chosen?.id ?? '');
  }

  const items = plan?.items ?? [];
  const live = items.map((it, i) => ({ it, i })).filter(({ i }) => !skipped.has(i));
  const unresolvedItem = live.some(({ i }) => !itemChoice[i]);
  const unresolvedCustomer = !!plan?.customer && plan.customer.candidates.length > 0 && !customerChoice;
  const unresolvedSoldBy = !quote && !!plan?.soldBy && plan.soldBy.candidates.length > 1 && !soldByChoice;
  const nothing = !!plan && live.length === 0 && !plan.customer && !plan.walkIn && !plan.discount && !plan.payment && !plan.soldBy && plan.dueDays === null && !plan.note;

  function apply() {
    if (!plan) return;
    const variantById = new Map(variants.map((v) => [v.variantId, v]));
    const customer = plan.customer && customerChoice ? (customers.find((c) => c.id === customerChoice) ?? null) : null;
    onApply({
      // An item whose piece has since gone from the list is left out rather than breaking the bill.
      items: live.flatMap(({ it, i }) => { const variant = variantById.get(itemChoice[i]!); return variant ? [{ variant, qty: it.qty, pricePaise: it.pricePaise }] : []; }),
      customer,
      walkIn: plan.walkIn || (!!plan.customer && plan.customer.candidates.length === 0),
      walkInName: plan.customer && plan.customer.candidates.length === 0 ? plan.customer.text : null,
      discount: plan.discount,
      payment: quote ? null : plan.payment,
      soldById: quote ? null : soldByChoice || null,
      dueDays: plan.dueDays,
      note: plan.note,
    });
    setPlan(null);
    setText('');
  }

  const row = 'grid grid-cols-[6.5rem_1fr] items-start gap-3';
  const label = 'pt-1.5 text-xs text-ink-muted';

  return (
    <Card className="overflow-visible p-4">
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-tint text-brand">
          <Sparkles className="h-4 w-4" />
        </span>
        <input
          value={text}
          aria-label="Type the whole bill"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              read();
            } else if (e.key === 'Escape') setPlan(null);
          }}
          placeholder="Type the whole bill in one line — 2 kadhua ivory, 10% off, Meena, paid 5000 UPI"
          className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm transition-[border-color,box-shadow] duration-150 placeholder:text-ink-muted/60 hover:border-ink/25 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15"
        />
        <Button disabled={!text.trim()} onClick={() => read()} icon={<CornerDownLeft className="h-4 w-4" />}>
          Read it
        </Button>
      </div>
      <button type="button" onClick={() => setHelp((h) => !h)} aria-expanded={help} className="ml-12 mt-2 text-xs text-brand transition-colors hover:text-brand-hover">
        {help ? 'Hide the examples' : 'What can I type?'}
      </button>
      {help && (
        <div className="ml-12 mt-2 space-y-2 text-xs text-ink-muted">
          <p>Separate the parts with commas, in any order. Items with a quantity (“2 kadhua ivory”, “kadhua wine x3”, “at 14000” for a price), a discount (“10% off”, “500 off”), a customer (just the name, or “for Meena”), how it was paid (“paid 5000 UPI”, “paid in full cash”, “pay later”), “sold by Ravi”, “due in 15 days” and “note: …”.</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <Chip key={ex} onClick={() => { setText(ex); read(ex); }}>
                {ex}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {plan && (
        <div className="animate-fade-in mt-4 space-y-3 border-t border-line pt-4" role="group" aria-label="What was understood">
          <p className="text-sm font-medium">Here is what I understood — check it, then fill in the bill</p>
          {nothing && <p className="rounded-lg bg-status-partial-bg px-3 py-2 text-sm text-status-partial-fg">I couldn't find anything I know in that. Try a quantity and an item name, like “2 kadhua ivory”.</p>}

          {plan.customer && (
            <div className={row}>
              <span className={label}>Customer</span>
              {plan.customer.candidates.length === 0 ? (
                <span className="pt-1.5 text-sm">Walk-in, named “{plan.customer.text}” <span className="text-xs text-ink-muted">(no saved customer matches)</span></span>
              ) : plan.customer.candidates.length === 1 ? (
                <span className="pt-1.5 text-sm">{plan.customer.candidates[0]!.name}</span>
              ) : (
                <div className="max-w-sm">
                  <Select value={customerChoice} onChange={(e) => setCustomerChoice(e.target.value)} aria-label="Which customer">
                    <option value="">Which {plan.customer.text}?</option>
                    {plan.customer.candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.city ? ` · ${c.city}` : ''}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </div>
          )}
          {plan.walkIn && !plan.customer && (
            <div className={row}>
              <span className={label}>Customer</span>
              <span className="pt-1.5 text-sm">Walk-in customer</span>
            </div>
          )}

          {items.map((it, i) =>
            skipped.has(i) ? null : (
              <div key={i} className={row}>
                <span className={label}>{i === 0 ? 'Items' : ''}</span>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="num w-8 pt-1.5 text-sm">{it.qty} ×</span>
                  {it.candidates.length === 0 ? (
                    <>
                      <span className="pt-1.5 text-sm text-status-overdue-fg">Nothing matches “{it.raw}”</span>
                      <button type="button" onClick={() => setSkipped((s) => new Set(s).add(i))} className="pt-1.5 text-xs text-brand hover:text-brand-hover">
                        Leave it out
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="w-[22rem] max-w-full">
                        <Select value={itemChoice[i] ?? ''} onChange={(e) => setItemChoice((c) => ({ ...c, [i]: e.target.value }))} aria-label={`Which item for “${it.raw}”`}>
                          <option value="">Which “{it.raw}”?</option>
                          {it.candidates.map((v) => (
                            <option key={v.variantId} value={v.variantId}>
                              {v.designName} · {v.color} · {v.size} — {v.stock - v.held > 0 ? `${v.stock - v.held} in stock` : 'out of stock'}
                            </option>
                          ))}
                        </Select>
                      </div>
                      {it.pricePaise !== null && <span className="num pt-1.5 text-sm">at {formatMoney(it.pricePaise)}</span>}
                    </>
                  )}
                  {it.corrected.length > 0 && <span className="pt-1.5 text-xs text-ink-muted">read {it.corrected.map((c) => `“${c.from}” as “${c.to}”`).join(', ')}</span>}
                  {it.assumed && itemChoice[i] && <span className="pt-1.5 text-xs text-ink-muted">the only one in stock</span>}
                </div>
              </div>
            ),
          )}

          {plan.discount && (
            <div className={row}>
              <span className={label}>Discount</span>
              <span className="pt-1.5 text-sm">{describeDiscount(plan.discount)}</span>
            </div>
          )}
          {!quote && plan.payment && (
            <div className={row}>
              <span className={label}>Payment</span>
              <span className="pt-1.5 text-sm">{describePayment(plan.payment)}</span>
            </div>
          )}
          {!quote && plan.soldBy && (
            <div className={row}>
              <span className={label}>Sold by</span>
              {plan.soldBy.candidates.length === 0 ? (
                <span className="pt-1.5 text-sm text-status-overdue-fg">“{plan.soldBy.text}” is not on the sales team (Settings → Sales team)</span>
              ) : plan.soldBy.candidates.length === 1 ? (
                <span className="pt-1.5 text-sm">{plan.soldBy.candidates[0]!.name}</span>
              ) : (
                <div className="max-w-xs">
                  <Select value={soldByChoice} onChange={(e) => setSoldByChoice(e.target.value)} aria-label="Which salesperson">
                    <option value="">Which {plan.soldBy.text}?</option>
                    {plan.soldBy.candidates.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </div>
          )}
          {plan.dueDays !== null && (
            <div className={row}>
              <span className={label}>{quote ? 'Valid for' : 'Due'}</span>
              <span className="pt-1.5 text-sm">{plan.dueDays === 0 ? 'on the day' : `${plan.dueDays} days`}</span>
            </div>
          )}
          {plan.note && (
            <div className={row}>
              <span className={label}>Note</span>
              <span className="pt-1.5 text-sm">{plan.note}</span>
            </div>
          )}
          {plan.unknown.length > 0 && <p className="text-xs text-status-partial-fg">Didn't understand: {plan.unknown.map((u) => `“${u}”`).join(', ')}</p>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button onClick={() => setPlan(null)}>Cancel</Button>
            <Button variant="primary" disabled={nothing || unresolvedItem || unresolvedCustomer || unresolvedSoldBy} onClick={apply}>
              Fill in the bill
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
