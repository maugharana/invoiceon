import { Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { addDays, taxByRate, todayIso } from '../../../shared/gst';
import { formatMoney } from '../../../shared/money';
import { sameState } from '../../../shared/states';
import { BILL_LINE_KIND_LABEL, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type BillLineKind, type PaymentMethod } from '../../../shared/types';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorNote, Field, IconButton, Input, Money, MoneyInput, PageHeader, Select, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { toNumber } from '../../lib/format';
import { navigate, paths } from '../../lib/router';
import { SupplierFormModal } from './SupplierFormModal';

interface Line {
  key: number;
  kind: BillLineKind;
  materialId: string;
  variantId: string;
  description: string;
  qty: string;
  price: number;
  rate: string;
}

let nextKey = 1;
const blankLine = (rate: string): Line => ({ key: nextKey++, kind: 'material', materialId: '', variantId: '', description: '', qty: '1', price: 0, rate });

/** Enter a supplier's bill: what you bought, at what price and GST, and what you paid. Sarees on it come into stock. */
export function NewBillPage({ presetSupplierId }: { presetSupplierId: string | null }) {
  const toast = useToast();
  const refresh = useRefresh();
  const settings = useQuery(() => api.getSettings());
  const suppliers = useQuery(() => api.suppliersList());
  const materials = useQuery(() => api.materialsList());
  const variants = useQuery(() => api.variantsForSale());

  const [supplierId, setSupplierId] = useState(presetSupplierId ?? '');
  const [billNumber, setBillNumber] = useState('');
  const [billDate, setBillDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState(addDays(todayIso(), 30));
  const dueTouched = useRef(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [itc, setItc] = useState<boolean | null>(null); // null = follow the supplier (yes when they have a GSTIN)
  const [updateCosts, setUpdateCosts] = useState(false);
  const [printedTotal, setPrintedTotal] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [paid, setPaid] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('bank');
  const [reference, setReference] = useState('');
  const [useAdvance, setUseAdvance] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const supplier = suppliers.data?.find((s) => s.id === supplierId) ?? null;
  const defaultRate = supplier?.gstin ? String(settings.data?.gstRatePercent ?? 5) : '0';
  const shopState = settings.data?.state ?? '';
  const placeOfSupply = supplier?.state || shopState;
  const intraState = !shopState || sameState(placeOfSupply, shopState);
  const itcEligible = itc ?? !!supplier?.gstin;

  // Start with one empty line; when the supplier changes, lines still at the old default rate follow the new default.
  useEffect(() => {
    if (lines.length === 0 && settings.data) setLines([blankLine(defaultRate)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data]);
  const lastDefault = useRef(defaultRate);
  useEffect(() => {
    if (lastDefault.current !== defaultRate) {
      const old = lastDefault.current;
      setLines((ls) => ls.map((l) => (l.rate === old ? { ...l, rate: defaultRate } : l)));
      lastDefault.current = defaultRate;
    }
  }, [defaultRate]);

  useEffect(() => {
    if (!dueTouched.current) setDueDate(addDays(billDate, 30));
  }, [billDate]);

  const rows = lines.map((l) => {
    const qty = toNumber(l.qty);
    const rate = toNumber(l.rate);
    const validQty = Number.isFinite(qty) && qty > 0 && (l.kind !== 'variant' || Number.isInteger(qty));
    const validRate = Number.isFinite(rate) && rate >= 0 && rate <= 100;
    return { line: l, qty, rate, validQty, validRate, amount: validQty ? Math.round(qty * l.price) : 0 };
  });
  const tax = taxByRate(rows.map((r) => ({ taxablePaise: r.amount, ratePercent: r.validRate ? r.rate : 0 })), intraState);
  const raw = tax.taxablePaise + tax.taxPaise;
  const total = printedTotal && printedTotal > 0 ? printedTotal : tax.totalPaise;
  const advanceHeld = supplier?.advancePaise ?? 0;
  const advanceApplied = useAdvance ? Math.min(advanceHeld, total) : 0;
  const maxPayable = total - advanceApplied;

  const problems: string[] = [];
  if (!supplier) problems.push('Choose the supplier.');
  if (!billNumber.trim()) problems.push("Enter the supplier's bill number.");
  if (rows.some((r) => !r.validQty)) problems.push('Every item needs a quantity above zero (whole pieces for sarees).');
  if (rows.some((r) => !r.validRate)) problems.push('GST rates must be between 0 and 100.');
  if (rows.some((r) => r.line.kind === 'material' && !r.line.materialId)) problems.push('Choose the raw material on each material line.');
  if (rows.some((r) => r.line.kind === 'variant' && !r.line.variantId)) problems.push('Choose the saree on each saree line.');
  if (rows.some((r) => r.line.kind === 'other' && !r.line.description.trim())) problems.push('Describe each "other" item.');
  if (paid > maxPayable) problems.push(`The payment is ${formatMoney(paid - maxPayable)} more than this bill needs.`);
  if (printedTotal && Math.abs(printedTotal - raw) > 500) problems.push(`The total you typed (${formatMoney(printedTotal)}) is more than ₹5 away from the items (${formatMoney(raw)}).`);
  const canSubmit = problems.length === 0 && !saving;

  const change = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const bill = await api.purchaseBillCreate({
        supplierId,
        billNumber,
        billDate,
        dueDate: dueDate || null,
        itcEligible: itcEligible,
        billTotalPaise: printedTotal && printedTotal > 0 ? printedTotal : undefined,
        updateCosts,
        notes,
        lines: rows.map((r) => ({
          kind: r.line.kind,
          materialId: r.line.kind === 'material' ? r.line.materialId : undefined,
          variantId: r.line.kind === 'variant' ? r.line.variantId : undefined,
          description: r.line.description || undefined,
          qty: r.qty,
          unitPricePaise: r.line.price,
          gstRatePercent: r.rate,
        })),
        paidNow: paid > 0 ? { amountPaise: paid, method, reference } : undefined,
        applyAdvancePaise: advanceApplied > 0 ? advanceApplied : undefined,
      });
      refresh();
      toast.success(`Bill ${bill.billNumber} entered`);
      navigate(paths.bill(bill.id));
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  const back = (
    <a href={`#${paths.purchases()}`} className="text-ink-muted transition-colors hover:text-ink">
      ← Purchases
    </a>
  );

  return (
    <>
      <PageHeader back={back} title="Enter a supplier bill" subtitle="Copy it from the bill you received. Sarees on it come into stock." />
      <div className="grid grid-cols-[1fr_18rem] items-start gap-6">
        <div className="space-y-6">
          <Card className="space-y-5 p-6">
            <div className="grid grid-cols-[1fr_auto] items-end gap-3">
              <Field label="Supplier">
                <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-label="Supplier">
                  <option value="">Choose a supplier</option>
                  {(suppliers.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.city ? ` (${s.city})` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating('')}>
                New supplier
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Their bill number">
                <Input value={billNumber} onChange={(e) => setBillNumber(e.target.value)} placeholder="e.g. VST/101" />
              </Field>
              <Field label="Bill date">
                <Input type="date" value={billDate} max={todayIso()} onChange={(e) => setBillDate(e.target.value)} className="num" />
              </Field>
              <Field label="Due date">
                <Input type="date" value={dueDate} min={billDate} onChange={(e) => { dueTouched.current = true; setDueDate(e.target.value); }} className="num" />
              </Field>
            </div>
            {supplier && (
              <p className="text-xs text-ink-muted">
                {supplier.gstin ? `GSTIN ${supplier.gstin} · ` : 'No GSTIN, so no GST can be charged or claimed. · '}
                {placeOfSupply ? `${placeOfSupply}: ${intraState ? 'CGST + SGST' : 'IGST'}` : ''}
              </p>
            )}
          </Card>

          <Card className="overflow-x-auto">
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <h2 className="text-base">Items</h2>
              <Button className="h-8 px-3 text-xs" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setLines((ls) => [...ls, blankLine(defaultRate)])}>
                Add an item
              </Button>
            </div>
            <div className="divide-y divide-line/70">
              {rows.map((r, i) => {
                const l = r.line;
                return (
                  <div key={l.key} className="space-y-3 px-6 py-4">
                    <div className="grid grid-cols-[9rem_1fr_2rem] items-start gap-3">
                      <Select value={l.kind} onChange={(e) => change(l.key, { kind: e.target.value as BillLineKind })} aria-label={`Item ${i + 1} kind`}>
                        {(Object.keys(BILL_LINE_KIND_LABEL) as BillLineKind[]).map((k) => (
                          <option key={k} value={k}>
                            {BILL_LINE_KIND_LABEL[k]}
                          </option>
                        ))}
                      </Select>
                      <div>
                        {l.kind === 'material' && (
                          <Select value={l.materialId} onChange={(e) => change(l.key, { materialId: e.target.value })} aria-label={`Item ${i + 1} raw material`}>
                            <option value="">Choose a raw material</option>
                            {(materials.data ?? []).map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name} ({m.unit})
                              </option>
                            ))}
                          </Select>
                        )}
                        {l.kind === 'variant' && (
                          <Select value={l.variantId} onChange={(e) => change(l.key, { variantId: e.target.value })} aria-label={`Item ${i + 1} saree`}>
                            <option value="">Choose a saree</option>
                            {(variants.data ?? []).map((v) => (
                              <option key={v.variantId} value={v.variantId}>
                                {v.designName} · {v.color} · {v.size}
                              </option>
                            ))}
                          </Select>
                        )}
                        {l.kind === 'other' && <Input value={l.description} onChange={(e) => change(l.key, { description: e.target.value })} placeholder="e.g. Freight, packing" aria-label={`Item ${i + 1} description`} />}
                      </div>
                      {lines.length > 1 ? (
                        <IconButton label={`Remove item ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                          <X className="h-4 w-4" />
                        </IconButton>
                      ) : (
                        <span />
                      )}
                    </div>
                    <div className="grid grid-cols-[1fr_1fr_1fr_1fr_2rem] items-end gap-3 pl-[calc(9rem+0.75rem)]">
                      <Field label={l.kind === 'material' ? `Quantity (${materials.data?.find((m) => m.id === l.materialId)?.unit ?? 'units'})` : l.kind === 'variant' ? 'Pieces' : 'Quantity'} error={r.validQty ? undefined : l.kind === 'variant' ? 'Whole pieces only' : 'Enter a quantity'}>
                        <Input value={l.qty} onChange={(e) => change(l.key, { qty: e.target.value })} inputMode="decimal" className="num text-right" aria-label={`Item ${i + 1} quantity`} />
                      </Field>
                      <Field label="Price each, before GST">
                        <MoneyInput value={l.price} onChange={(p) => change(l.key, { price: p })} aria-label={`Item ${i + 1} price`} />
                      </Field>
                      <Field label="GST rate">
                        <div className="relative">
                          <Input value={l.rate} onChange={(e) => change(l.key, { rate: e.target.value })} inputMode="decimal" className="num pr-6 text-right" aria-label={`Item ${i + 1} GST rate`} />
                          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted">%</span>
                        </div>
                      </Field>
                      <div className="pb-2 text-right">
                        <div className="mb-1.5 text-xs font-medium text-ink-muted">Amount</div>
                        <Money paise={r.amount} />
                      </div>
                      <span />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="space-y-4 p-6">
            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" checked={itcEligible} disabled={!supplier?.gstin} onChange={(e) => setItc(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#0F6E56]" />
                <span>
                  <span className="block">Claim the GST on this bill as input credit</span>
                  <span className="block text-xs text-ink-muted">{supplier?.gstin ? 'It is set off against the GST you owe in the GST report.' : 'Needs the supplier to have a GSTIN.'}</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" checked={updateCosts} onChange={(e) => setUpdateCosts(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#0F6E56]" />
                <span>
                  <span className="block">Update costs to this bill's prices</span>
                  <span className="block text-xs text-ink-muted">Raw material costs and the cost of sarees you bought finished.</span>
                </span>
              </label>
            </div>
            <Field label="Notes">
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </Field>
          </Card>

          <Card className="p-6">
            <h2 className="mb-1 text-base">Payment</h2>
            <p className="mb-4 text-xs text-ink-muted">
              {advanceHeld > 0 && (
                <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={useAdvance} onChange={(e) => setUseAdvance(e.target.checked)} className="h-4 w-4 accent-[#0F6E56]" />
                  Use the <Money paise={advanceHeld} /> advance you hold with {supplier?.name}
                </label>
              )}
              Did you pay now? Record it here, or pay later from the bill.
            </p>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Paid now">
                <MoneyInput value={paid} onChange={setPaid} aria-label="Paid now" />
              </Field>
              <Field label="Paid by">
                <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} disabled={paid === 0}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABEL[m]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reference">
                <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." disabled={paid === 0} />
              </Field>
            </div>
          </Card>
        </div>

        <aside className="sticky top-6">
          <Card className="p-6">
            <h2 className="mb-4 text-base">Summary</h2>
            <dl className="space-y-2">
              <div className="flex justify-between"><dt className="text-ink-muted">Items</dt><dd><Money paise={tax.taxablePaise} /></dd></div>
              {tax.groups.map((g) =>
                intraState ? (
                  <div key={g.ratePercent} className="space-y-2">
                    <div className="flex justify-between"><dt className="text-ink-muted">CGST {+(g.ratePercent / 2).toFixed(2)}%</dt><dd><Money paise={g.cgstPaise} /></dd></div>
                    <div className="flex justify-between"><dt className="text-ink-muted">SGST {+(g.ratePercent / 2).toFixed(2)}%</dt><dd><Money paise={g.sgstPaise} /></dd></div>
                  </div>
                ) : (
                  <div key={g.ratePercent} className="flex justify-between"><dt className="text-ink-muted">IGST {+g.ratePercent.toFixed(2)}%</dt><dd><Money paise={g.igstPaise} /></dd></div>
                ),
              )}
              <div className="flex items-center justify-between gap-4">
                <dt className="text-ink-muted" title="Only if the total on their bill differs from the items by a few rupees">Total on their bill</dt>
                <dd className="w-32"><MoneyInput value={printedTotal ?? 0} onChange={(p) => setPrintedTotal(p > 0 ? p : null)} placeholder={String(Math.round(tax.totalPaise / 100))} aria-label="Total printed on the supplier's bill" className="h-8" /></dd>
              </div>
            </dl>
            <div className="mt-4 border-t border-line pt-4">
              <div className="flex items-baseline justify-between">
                <span className="text-ink-muted">Bill total</span>
                <span key={total} className="animate-tick text-2xl tracking-tight"><Money paise={total} /></span>
              </div>
              <div aria-hidden className="mt-2 h-0.5 w-8 rounded-full bg-gold" />
              {(advanceApplied > 0 || paid > 0) && (
                <dl className="mt-3 space-y-1 text-xs text-ink-muted">
                  {advanceApplied > 0 && <div className="flex justify-between"><dt>From advance</dt><dd><Money paise={advanceApplied} /></dd></div>}
                  {paid > 0 && <div className="flex justify-between"><dt>Paid now</dt><dd><Money paise={paid} /></dd></div>}
                  <div className="flex justify-between text-ink"><dt>Left to pay</dt><dd><Money paise={Math.max(0, maxPayable - paid)} /></dd></div>
                </dl>
              )}
            </div>
            <Button variant="primary" className="mt-5 w-full" loading={saving} disabled={!canSubmit} onClick={() => void submit()}>
              Save bill
            </Button>
            {problems.length > 0 && lines.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-ink-muted">
                {problems.slice(0, 3).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
          </Card>
        </aside>
      </div>
      {creating !== null && (
        <SupplierFormModal
          defaultName={creating}
          onClose={() => setCreating(null)}
          onSaved={(s) => {
            setSupplierId(s.id);
            setCreating(null);
          }}
        />
      )}
    </>
  );
}
