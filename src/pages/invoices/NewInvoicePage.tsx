import { Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, computeTotals, todayIso } from '../../../shared/gst';
import { formatMoney, mulPaise } from '../../../shared/money';
import { matchesAll } from '../../../shared/search';
import { sameState } from '../../../shared/states';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type Customer, type InvoiceType, type PaymentMethod, type SaleVariant } from '../../../shared/types';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorNote, Field, Input, Money, MoneyInput, PageHeader, Segmented, Select, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { toNumber } from '../../lib/format';
import { navigate, paths, type AdvancePreset } from '../../lib/router';
import { CustomerFormModal } from '../customers/CustomerFormModal';

interface Line {
  variantId: string;
  qty: string;
  price: number;
}

// ── Customer picker ─────────────────────────────────────────────────────────
function CustomerPicker({ customers, type, value, onChange, onCreate }: { customers: Customer[]; type: InvoiceType; value: Customer | null; onChange: (c: Customer | null) => void; onCreate: (name: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const results = useMemo(
    () =>
      customers
        .filter((c) => (type === 'B2B' ? !!c.gstin : true))
        .filter((c) => matchesAll([c.name, c.phone, c.gstin, c.city].join(' '), q))
        .slice(0, 30),
    [customers, q, type],
  );

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-line bg-canvas px-3 py-2">
        <div className="min-w-0">
          <div className="truncate">{value.name}</div>
          <div className="truncate text-xs text-ink-muted">{[value.gstin && `GSTIN ${value.gstin}`, [value.city, value.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || 'No details saved'}</div>
        </div>
        <button type="button" onClick={() => onChange(null)} aria-label="Change customer" className="ml-3 rounded-lg px-2 py-1 text-xs text-brand transition-colors hover:bg-brand-tint">
          Change
        </button>
      </div>
    );
  }

  const pick = (c: Customer) => {
    onChange(c);
    setQ('');
    setOpen(false);
  };

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
      <input
        value={q}
        role="combobox"
        aria-expanded={open}
        aria-label="Customer"
        placeholder={type === 'B2B' ? 'Search business customers…' : 'Search saved customers, or leave blank for walk-in'}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            const c = results[active];
            if (c) pick(c);
            else onCreate(q);
          } else if (e.key === 'Escape') setOpen(false);
        }}
        className="h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-sm transition-[border-color,box-shadow] duration-150 placeholder:text-ink-muted/60 hover:border-ink/25 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15"
      />
      {open && (
        <ul role="listbox" onMouseDown={(e) => e.preventDefault()} className="animate-pop-in absolute z-30 mt-1.5 max-h-72 w-full overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-overlay">
          {results.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === active}>
              <button type="button" onClick={() => pick(c)} onMouseEnter={() => setActive(i)} className={`flex w-full items-center justify-between px-3 py-2 text-left ${i === active ? 'bg-brand-tint' : ''}`}>
                <span className="min-w-0">
                  <span className="block truncate">{c.name}</span>
                  <span className="block truncate text-xs text-ink-muted">{[c.phone, c.city].filter(Boolean).join(' · ') || c.gstin}</span>
                </span>
                <span className="num ml-3 shrink-0 text-xs text-ink-muted">{c.gstin}</span>
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="px-3 py-2 text-ink-muted">{type === 'B2B' ? 'No business customers with a GSTIN match.' : 'No saved customer matches.'}</li>}
          <li>
            <button type="button" onClick={() => onCreate(q)} onMouseEnter={() => setActive(results.length)} className={`flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-brand ${active === results.length ? 'bg-brand-tint' : ''}`}>
              <Plus className="h-4 w-4" aria-hidden /> New customer{q.trim() ? ` “${q.trim()}”` : ''}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

// ── Item picker ─────────────────────────────────────────────────────────────
function ItemPicker({ variants, taken, onPick, allowOutOfStock = false }: { variants: SaleVariant[]; taken: Set<string>; onPick: (v: SaleVariant) => void; allowOutOfStock?: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const results = useMemo(() => variants.filter((v) => matchesAll(`${v.designName} ${v.designCode} ${v.color} ${v.size} ${v.sku}`, q)).slice(0, 50), [variants, q]);

  const pick = (v: SaleVariant) => {
    if (v.stock <= 0 && !allowOutOfStock) return;
    onPick(v);
    setQ('');
    setActive(0);
    setOpen(false); // typing (or clicking back in) reopens the list
  };

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
      <input
        value={q}
        role="combobox"
        aria-expanded={open}
        aria-label="Add item"
        placeholder="Add an item — search design, color or SKU"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const v = results[active];
            if (v) pick(v);
          } else if (e.key === 'Escape') setOpen(false);
        }}
        className="h-9 w-full rounded-lg border border-dashed border-line bg-surface pl-9 pr-3 text-sm transition-[border-color,box-shadow] duration-150 placeholder:text-ink-muted/60 hover:border-ink/25 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15"
      />
      {open && (
        <ul role="listbox" onMouseDown={(e) => e.preventDefault()} className="animate-pop-in absolute bottom-full z-30 mb-1.5 max-h-72 w-full overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-overlay">
          {results.length === 0 && <li className="px-3 py-2 text-ink-muted">No item matches.</li>}
          {results.map((v, i) => {
            const out = v.stock <= 0 && !allowOutOfStock;
            return (
              <li key={v.variantId} role="option" aria-selected={i === active} aria-disabled={out}>
                <button
                  type="button"
                  disabled={out}
                  onClick={() => pick(v)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center justify-between gap-4 px-3 py-2 text-left ${i === active && !out ? 'bg-brand-tint' : ''} ${out ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate">
                      {v.designName} <span className="text-ink-muted">· {v.color} · {v.size}</span>
                    </span>
                    <span className="block text-xs text-ink-muted">{v.sku}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <Money paise={v.sellPricePaise} fractionDigits={0} className="block" />
                    <span className={`num block text-xs ${out ? 'text-status-overdue-fg' : 'text-ink-muted'}`}>{v.stock <= 0 ? 'Out of stock' : `${v.stock} in stock`}{taken.has(v.variantId) ? ' · on invoice' : ''}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
/** One editor for both documents: an invoice takes stock and money; a proforma is a quote that does neither until it becomes an invoice. */
export function NewInvoicePage({ presetCustomerId, advance, mode = 'invoice' }: { presetCustomerId: string | null; advance?: AdvancePreset | null; mode?: 'invoice' | 'proforma' }) {
  const quote = mode === 'proforma';
  const toast = useToast();
  const refresh = useRefresh();
  const settings = useQuery(() => api.getSettings());
  const customers = useQuery(() => api.customersList());
  const variants = useQuery(() => api.variantsForSale());

  const [type, setType] = useState<InvoiceType>('B2C');
  const [customerId, setCustomerId] = useState<string | null>(presetCustomerId);
  const [buyerName, setBuyerName] = useState('');
  const [issueDate, setIssueDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState(todayIso());
  const dueTouched = useRef(false);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  // Money received as the invoice is made. It can arrive pre-filled from "Record payment → Record & create invoice".
  const [received, setReceived] = useState(advance?.amountPaise ?? 0);
  const [payMethod, setPayMethod] = useState<PaymentMethod>(advance?.method ?? 'cash');
  const [payRef, setPayRef] = useState(advance?.reference ?? '');
  const [useAdvance, setUseAdvance] = useState(true);
  const [creating, setCreating] = useState<string | null>(null); // name typed into "New customer", or null when closed
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const nextNumber = useQuery(() => (quote ? api.proformaNextNumber(issueDate) : api.invoiceNextNumber(issueDate)), [issueDate, quote]);

  const customer = customers.data?.find((c) => c.id === customerId) ?? null;
  const variantById = useMemo(() => new Map((variants.data ?? []).map((v) => [v.variantId, v])), [variants.data]);

  // When arriving from a customer's page, follow their usual billing type once their record loads.
  const presetApplied = useRef(false);
  useEffect(() => {
    if (presetApplied.current || !customer) return;
    presetApplied.current = true;
    if (customer.type === 'B2B') setType('B2B');
  }, [customer]);

  // Due date follows the invoice type and date until the user picks one themselves.
  useEffect(() => {
    if (dueTouched.current || !settings.data) return;
    setDueDate(quote ? addDays(issueDate, settings.data.proformaValidDays) : type === 'B2B' ? addDays(issueDate, settings.data.defaultDueDays) : issueDate);
  }, [type, issueDate, settings.data, quote]);

  function changeType(next: InvoiceType) {
    setType(next);
    if (next === 'B2B' && customer && !customer.gstin) setCustomerId(null); // a B2B invoice needs a GSTIN
  }

  const rows = lines.map((l) => {
    const v = variantById.get(l.variantId);
    const qty = toNumber(l.qty);
    const validQty = Number.isInteger(qty) && qty >= 1;
    return { line: l, variant: v, qty, validQty, amount: validQty ? mulPaise(qty, l.price) : 0, short: !quote && v && validQty && qty > v.stock };
  });

  const rate = settings.data?.gstRatePercent ?? 0;
  const placeOfSupply = customer?.state || settings.data?.state || '';
  const intraState = !settings.data?.state || sameState(placeOfSupply, settings.data.state);
  const totals = computeTotals({ lineAmounts: rows.map((r) => r.amount), discountPaise: discount, ratePercent: rate, intraState });

  // Advance the customer already holds goes onto this invoice first, then whatever is handed over now.
  const advanceHeld = quote ? 0 : (customer?.advancePaise ?? 0);
  const advanceApplied = useAdvance ? Math.min(advanceHeld, totals.totalPaise) : 0;
  const maxReceivable = totals.totalPaise - advanceApplied;
  const balanceDue = maxReceivable - Math.min(received, maxReceivable);

  const sellerGstinMissing = type === 'B2B' && !!settings.data && !settings.data.gstin;
  const problems: string[] = [];
  if (!quote && lines.length > 0 && received > maxReceivable) problems.push(`The payment is ${formatMoney(received - maxReceivable)} more than this invoice needs. Lower it — record any extra separately as an advance.`);
  if (lines.length === 0) problems.push('Add at least one item.');
  if (rows.some((r) => !r.validQty)) problems.push('Every item needs a quantity of 1 or more.');
  if (rows.some((r) => r.short)) problems.push('Some items are short of stock.');
  if (type === 'B2B' && !customer) problems.push('Choose the business customer.');
  if (type === 'B2B' && customer && !customer.gstin) problems.push(`${customer.name} has no GSTIN — add it, or bill as B2C.`);
  if (discount > totals.subtotalPaise) problems.push('The discount is more than the subtotal.');
  if (sellerGstinMissing) problems.push('Add your GSTIN in Settings first.');
  const canSubmit = problems.length === 0 && !saving;

  function addVariant(v: SaleVariant) {
    setLines((ls) => {
      const existing = ls.find((l) => l.variantId === v.variantId);
      if (existing) return ls.map((l) => (l === existing ? { ...l, qty: String((toNumber(l.qty) || 0) + 1) } : l));
      return [...ls, { variantId: v.variantId, qty: '1', price: v.sellPricePaise }];
    });
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      if (quote) {
        const p = await api.proformaCreate({ type, customerId, buyerName: customerId ? undefined : buyerName, issueDate, validUntil: dueDate, discountPaise: discount, notes, lines: rows.map((r) => ({ variantId: r.line.variantId, qty: r.qty, unitPricePaise: r.line.price })) });
        refresh();
        toast.success(`Proforma ${p.number} created`);
        navigate(paths.proforma(p.id));
        return;
      }
      const inv = await api.invoiceCreate({
        type,
        customerId,
        buyerName: customerId ? undefined : buyerName,
        issueDate,
        dueDate: dueDate || null,
        discountPaise: discount,
        notes,
        lines: rows.map((r) => ({ variantId: r.line.variantId, qty: r.qty, unitPricePaise: r.line.price })),
        payment: received > 0 ? { amountPaise: received, method: payMethod, reference: payRef } : undefined,
        applyAdvancePaise: advanceApplied > 0 ? advanceApplied : undefined,
      });
      refresh();
      toast.success(inv.paidPaise > 0 ? `Invoice ${inv.number} issued — ${formatMoney(inv.paidPaise)} received` : `Invoice ${inv.number} issued`);
      navigate(paths.invoice(inv.id));
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  const back = (
    <a href={`#${quote ? paths.proformas() : paths.invoices()}`} className="text-ink-muted transition-colors hover:text-ink">
      ← {quote ? 'Proformas' : 'Invoices'}
    </a>
  );

  return (
    <>
      <PageHeader back={back} title={quote ? 'New proforma' : 'New invoice'} subtitle={nextNumber.data ? <>Will be numbered <span className="num text-ink">{nextNumber.data}</span></> : undefined} />

      <div className="grid grid-cols-[1fr_18rem] items-start gap-6">
        <div className="space-y-6">
          {/* Who and when */}
          <Card className="space-y-5 p-6">
            <div className="space-y-2">
              <Segmented
                label="Invoice type"
                value={type}
                onChange={changeType}
                options={[
                  { value: 'B2C', label: 'B2C · Retail' },
                  { value: 'B2B', label: 'B2B · GST tax invoice' },
                ]}
              />
              <p className="text-xs text-ink-muted">{quote ? (type === 'B2B' ? 'For a business customer: shows their GSTIN and the tax that will apply.' : 'For a retail customer. Walk-ins are fine.') : type === 'B2B' ? 'A GST tax invoice: needs the buyer\'s GSTIN, and shows HSN codes and a tax breakup.' : 'A simple retail bill. Walk-in customers are fine.'}</p>
            </div>

            <Field label="Customer">
              <CustomerPicker customers={customers.data ?? []} type={type} value={customer} onChange={(c) => setCustomerId(c?.id ?? null)} onCreate={(name) => setCreating(name)} />
            </Field>
            {!customer && type === 'B2C' && (
              <Field label="Name on invoice" hint="Optional. Leave blank to print “Walk-in customer”.">
                <Input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="Walk-in customer" />
              </Field>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Field label={quote ? 'Proforma date' : 'Invoice date'}>
                <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="num" />
              </Field>
              <Field label={quote ? 'Valid until' : 'Due date'}>
                <Input
                  type="date"
                  value={dueDate}
                  min={issueDate}
                  onChange={(e) => {
                    dueTouched.current = true;
                    setDueDate(e.target.value);
                  }}
                  className="num"
                />
              </Field>
            </div>
          </Card>

          {/* Items */}
          <Card className="overflow-visible">
            <div className="border-b border-line px-6 py-4">
              <h2 className="text-base">Items</h2>
            </div>
            {rows.length > 0 && (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className="th">Item</th>
                    <th className="th w-20 text-right">Qty</th>
                    <th className="th w-32 text-right">Rate</th>
                    <th className="th w-28 text-right">Amount</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.line.variantId} className="animate-fade-in border-b border-line/70 align-top last:border-0">
                      <td className="td">
                        <div>{r.variant?.designName}</div>
                        <div className="text-xs text-ink-muted">
                          {r.variant?.color} · {r.variant?.size} · {r.variant?.sku}
                        </div>
                        {r.short && <div className="mt-1 text-xs text-status-overdue-fg">Only {r.variant?.stock} in stock</div>}
                      </td>
                      <td className="td">
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          value={r.line.qty}
                          aria-label={`Quantity, ${r.variant?.color} ${r.variant?.size}`}
                          aria-invalid={!r.validQty || !!r.short}
                          onChange={(e) => setLines((ls) => ls.map((l) => (l === r.line ? { ...l, qty: e.target.value } : l)))}
                          className="num h-8 text-right"
                        />
                      </td>
                      <td className="td">
                        <MoneyInput value={r.line.price} onChange={(p) => setLines((ls) => ls.map((l) => (l === r.line ? { ...l, price: p } : l)))} aria-label={`Rate, ${r.variant?.color} ${r.variant?.size}`} className="h-8" />
                      </td>
                      <td className="td pt-4 text-right">
                        <Money paise={r.amount} />
                      </td>
                      <td className="td">
                        <button type="button" aria-label={`Remove ${r.variant?.color} ${r.variant?.size}`} onClick={() => setLines((ls) => ls.filter((l) => l !== r.line))} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink">
                          <X className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="p-4">
              <ItemPicker variants={variants.data ?? []} taken={new Set(lines.map((l) => l.variantId))} onPick={addVariant} allowOutOfStock={quote} />
              {variants.data?.length === 0 && <p className="mt-2 text-xs text-ink-muted">There's nothing to sell yet — add designs and stock under Inventory first.</p>}
            </div>
          </Card>

          {/* Payment — recorded in the same step as issuing the invoice */}
          {!quote && (
          <Card className="space-y-4 p-6">
            <div>
              <h2 className="text-base">Payment</h2>
              <p className="mt-0.5 text-xs text-ink-muted">Anything handed over now is recorded with this invoice, in one step. Leave it at zero if nothing is being paid today — it stays as balance due.</p>
            </div>

            {advanceHeld > 0 && (
              <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-status-partial-bg px-4 py-3 text-status-partial-fg">
                <input type="checkbox" checked={useAdvance} onChange={(e) => setUseAdvance(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#0F6E56]" />
                <span>
                  <span className="block">
                    Use the <Money paise={advanceHeld} /> advance {customer?.name} has paid
                    {totals.totalPaise > 0 && useAdvance && <> — <Money paise={advanceApplied} /> goes onto this invoice</>}
                  </span>
                  <span className="block text-xs opacity-80">Any left over stays as their advance.</span>
                </span>
              </label>
            )}

            <div className="grid grid-cols-[1fr_1fr_1fr] items-end gap-4">
              <Field label="Received now">
                <MoneyInput value={received} onChange={setReceived} aria-label="Received now" />
              </Field>
              <Field label="Method">
                <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value as PaymentMethod)} disabled={received === 0}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABEL[m]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reference">
                <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="UTR / cheque no." disabled={received === 0} />
              </Field>
            </div>
            {maxReceivable > 0 && received !== maxReceivable && (
              <button type="button" onClick={() => setReceived(maxReceivable)} className="text-xs text-brand transition-colors hover:text-brand-hover">
                Received in full — {formatMoney(maxReceivable)}
              </button>
            )}
          </Card>
          )}

          <Field label={quote ? 'Notes on the proforma' : 'Notes on the invoice'}>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={quote ? 'Optional — printed on the proforma' : 'Optional — printed on the invoice'} />
          </Field>
        </div>

        {/* Summary */}
        <aside className="sticky top-6">
          <Card className="p-6">
            <h2 className="mb-4 text-base">Summary</h2>
            <dl className="space-y-2">
              <div className="flex justify-between"><dt className="text-ink-muted">Subtotal</dt><dd><Money paise={totals.subtotalPaise} /></dd></div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-ink-muted">Discount</dt>
                <dd className="w-32"><MoneyInput value={discount} onChange={setDiscount} aria-label="Discount" className="h-8" /></dd>
              </div>
              {totals.discountPaise > 0 && <div className="flex justify-between"><dt className="text-ink-muted">Taxable value</dt><dd><Money paise={totals.taxablePaise} /></dd></div>}
              {intraState ? (
                <>
                  <div className="flex justify-between"><dt className="text-ink-muted">CGST {rate / 2}%</dt><dd><Money paise={totals.cgstPaise} /></dd></div>
                  <div className="flex justify-between"><dt className="text-ink-muted">SGST {rate / 2}%</dt><dd><Money paise={totals.sgstPaise} /></dd></div>
                </>
              ) : (
                <div className="flex justify-between"><dt className="text-ink-muted">IGST {rate}%</dt><dd><Money paise={totals.igstPaise} /></dd></div>
              )}
              {totals.roundOffPaise !== 0 && (
                <div className="flex justify-between text-ink-muted"><dt>Round off</dt><dd className="num">{totals.roundOffPaise < 0 ? '−' : '+'}{formatMoney(Math.abs(totals.roundOffPaise))}</dd></div>
              )}
            </dl>
            <div className="mt-4 border-t border-line pt-4">
              <div className="flex items-baseline justify-between">
                <span className="text-ink-muted">Total</span>
                <span key={totals.totalPaise} className="animate-tick text-2xl tracking-tight"><Money paise={totals.totalPaise} /></span>
              </div>
              <div aria-hidden className="mt-2 h-0.5 w-8 rounded-full bg-gold" />
              <p className="mt-3 text-xs text-ink-muted">
                {placeOfSupply ? `Supply to ${placeOfSupply}` : 'Place of supply not set'} · {intraState ? 'CGST + SGST' : 'IGST'}
              </p>
            </div>

            {!quote && totals.totalPaise > 0 && (advanceApplied > 0 || received > 0) && (
              <dl className="mt-4 space-y-2 border-t border-line pt-4">
                {advanceApplied > 0 && <div className="flex justify-between"><dt className="text-ink-muted">Advance applied</dt><dd className="num">−{formatMoney(advanceApplied)}</dd></div>}
                {received > 0 && <div className="flex justify-between"><dt className="text-ink-muted">Received now</dt><dd className="num">−{formatMoney(Math.min(received, maxReceivable))}</dd></div>}
                <div className="flex justify-between font-medium">
                  <dt>Balance due</dt>
                  <dd key={balanceDue} className="animate-tick"><Money paise={balanceDue} /></dd>
                </div>
              </dl>
            )}

            {sellerGstinMissing && (
              <div className="mt-4">
                <ErrorNote>
                  B2B tax invoices need your own GSTIN. <a href={`#${paths.settingsSection('business')}`} className="underline underline-offset-2">Add it in Settings</a>.
                </ErrorNote>
              </div>
            )}
            {error && <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>}

            <Button variant="primary" className="mt-5 w-full" loading={saving} disabled={!canSubmit} onClick={() => void submit()}>
              {quote ? 'Create proforma' : 'Issue invoice'}
            </Button>
            {!canSubmit && !saving && problems.length > 0 && lines.length > 0 && <p className="mt-2 text-xs text-ink-muted">{problems[0]}</p>}
            <p className="mt-3 text-xs text-ink-muted">
              {quote ? 'A proforma is a quote. It takes nothing off your shelves and isn\'t counted as a sale until you turn it into an invoice.' : 'Issuing takes the stock off your shelves. An issued invoice can be cancelled, not edited.'}
            </p>
          </Card>
        </aside>
      </div>

      {creating !== null && (
        <CustomerFormModal
          defaultType={type}
          defaultName={creating}
          onClose={() => setCreating(null)}
          onSaved={(c) => {
            setCustomerId(c.id);
            if (c.type === 'B2B') setType('B2B');
            setCreating(null);
          }}
        />
      )}
    </>
  );
}
