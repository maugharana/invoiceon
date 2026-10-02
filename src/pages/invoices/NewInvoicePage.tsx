import { Plus, Search, X } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { checkCredit, dueDateFromTerms } from '../../../shared/credit';
import { addDays, computeInvoice, isValidRate, resolveRate, todayIso } from '../../../shared/gst';
import { formatMoney, mulPaise } from '../../../shared/money';
import { matchesAll } from '../../../shared/search';
import { parseInvoiceDraft, type InvoiceDraft } from '../../../shared/invoiceDraft';
import { sameState } from '../../../shared/states';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type Customer, type Invoice, type InvoiceType, type LineInput, type PaymentMethod, type Proforma, type QuoteTemplate, type SaleVariant, type ShipTo } from '../../../shared/types';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorNote, Field, Input, Money, MoneyInput, PageHeader, Segmented, Select, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { toNumber } from '../../lib/format';
import { navigate, paths, type AdvancePreset } from '../../lib/router';
import { CustomerFormModal } from '../customers/CustomerFormModal';
import { HeldListModal, HoldModal } from './HeldBills';
import { QuickAddItemModal } from './QuickAddItemModal';
import { ShipToCard } from './ShipToCard';

interface Line {
  variantId: string;
  qty: string;
  price: number;
  /** Taken off this line alone, in paise. */
  discount: number;
  /** A GST rate typed for this line, as text; empty means "work it out". */
  rate: string;
  note: string;
}

const newLine = (variantId: string, qty: string, price: number): Line => ({ variantId, qty, price, discount: 0, rate: '', note: '' });

// An invoice that was being built is kept as you go, so a crash or a closed window doesn't lose it.
const DRAFT_KEY = 'invoiceon.draft.invoice';
function loadDraft(): InvoiceDraft | null {
  try {
    return parseInvoiceDraft(JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null'));
  } catch {
    return null;
  }
}
function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* nothing to clear */
  }
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
export function ItemPicker({ variants, taken, onPick, onCreate, allowOutOfStock = false }: { variants: SaleVariant[]; taken: Set<string>; onPick: (v: SaleVariant) => void; onCreate: (name: string) => void; allowOutOfStock?: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  // A scanner types a Saree ID and presses Enter: an exact ID is that piece and nothing else, so Enter picks it.
  const results = useMemo(() => {
    const code = q.trim().toLowerCase();
    const scanned = code ? variants.filter((v) => v.sku.toLowerCase() === code || (v.barcode !== '' && v.barcode.toLowerCase() === code)) : [];
    return scanned.length === 1 ? scanned : variants.filter((v) => matchesAll(`${v.designName} ${v.designNickname} ${v.designCode} ${v.color} ${v.size} ${v.sku} ${v.barcode}`, q)).slice(0, 50);
  }, [variants, q]);

  const pick = (v: SaleVariant) => {
    if (v.stock <= 0 && !allowOutOfStock) return;
    onPick(v);
    setQ('');
    setActive(0);
    setOpen(false); // typing (or clicking back in) reopens the list
  };

  const create = () => {
    onCreate(q);
    setQ('');
    setActive(0);
    setOpen(false);
  };

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
      <input
        value={q}
        role="combobox"
        aria-expanded={open}
        aria-label="Add item"
        placeholder="Add an item — search, or scan its barcode"
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
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const v = results[active];
            if (v) pick(v);
            else if (active === results.length) create();
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
                    <span className="block text-xs text-ink-muted">{[v.designNickname, v.sku].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <Money paise={v.sellPricePaise} fractionDigits={0} className="block" />
                    <span className={`num block text-xs ${out ? 'text-status-overdue-fg' : 'text-ink-muted'}`}>{v.stock <= 0 ? 'Out of stock' : `${v.stock} in stock`}{v.held > 0 ? ` · ${v.held} held for quotes` : ''}{taken.has(v.variantId) ? ' · on invoice' : ''}</span>
                  </span>
                </button>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={create} onMouseEnter={() => setActive(results.length)} className={`flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-brand ${active === results.length ? 'bg-brand-tint' : ''}`}>
              <Plus className="h-4 w-4" aria-hidden /> Not in inventory? Add{q.trim() ? ` “${q.trim()}”` : ' a new item'}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
/** One editor for both documents: an invoice takes stock and money; a proforma is a quote that does neither until it becomes an invoice. */
export function NewInvoicePage({ presetCustomerId, advance, copyFrom = null, editId = null, mode = 'invoice' }: { presetCustomerId: string | null; advance?: AdvancePreset | null; copyFrom?: string | null; /** Change this existing proforma instead of making a new one. */ editId?: string | null; mode?: 'invoice' | 'proforma' }) {
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
  const [reserve, setReserve] = useState(false);
  const [usePoints, setUsePoints] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const templates = useQuery(() => (quote ? api.quoteTemplatesList() : Promise.resolve([])), [quote]);
  const [shipTo, setShipTo] = useState<ShipTo | null>(null);
  const [transport, setTransport] = useState('');
  const [trackingNo, setTrackingNo] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  /** The text typed in the item box when "add to inventory" was chosen; null when the dialog is closed. */
  const [addingItem, setAddingItem] = useState<string | null>(null);
  /** Items added to the inventory from this screen, kept here until the list of items has loaded them. */
  const [justAdded, setJustAdded] = useState<SaleVariant[]>([]);
  /** Items whose discount / GST / note boxes are open. Ones that already have something typed open by themselves. */
  const [openMore, setMore] = useState<Set<string>>(new Set());
  const more = useMemo(() => new Set([...openMore, ...lines.filter((l) => l.discount > 0 || l.rate !== '' || l.note !== '').map((l) => l.variantId)]), [openMore, lines]);
  // Money received as the invoice is made. It can arrive pre-filled from "Record payment → Record & create invoice".
  const [received, setReceived] = useState(advance?.amountPaise ?? 0);
  const [payMethod, setPayMethod] = useState<PaymentMethod>(advance?.method ?? 'cash');
  const [payRef, setPayRef] = useState(advance?.reference ?? '');
  const [useAdvance, setUseAdvance] = useState(true);
  const [creating, setCreating] = useState<string | null>(null); // name typed into "New customer", or null when closed
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Unfinished-invoice recovery: offered once on arrival (only for a fresh invoice), and saved a moment after each change.
  const draftable = !quote && !editId && !copyFrom && !advance;
  const [draft, setDraft] = useState<InvoiceDraft | null>(() => (draftable ? loadDraft() : null));
  useEffect(() => {
    if (!draftable || draft) return; // while a saved draft is waiting for a decision, don't overwrite it with an empty page
    const t = setTimeout(() => {
      try {
        if (lines.length === 0 && !customerId) localStorage.removeItem(DRAFT_KEY);
        else localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: new Date().toISOString(), type, customerId, buyerName, issueDate, dueDate, discountPaise: discount, notes, lines, receivedPaise: received, payMethod }));
      } catch {
        /* a convenience, not a record */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [draftable, draft, type, customerId, buyerName, issueDate, dueDate, discount, notes, lines, received, payMethod]);
  /** Fills the form from a saved bill: the unfinished one found on arrival, or one picked up from "On hold". */
  function applyDraft(d: InvoiceDraft) {
    if (!variants.data) return;
    const known = new Set(variants.data.map((v) => v.variantId));
    setType(d.type);
    setCustomerId(d.customerId);
    setBuyerName(d.buyerName);
    if (d.issueDate) setIssueDate(d.issueDate);
    if (d.dueDate) {
      setDueDate(d.dueDate);
      dueTouched.current = true;
    }
    setDiscount(d.discountPaise);
    setNotes(d.notes);
    setLines(d.lines.filter((l) => known.has(l.variantId)).map((l) => ({ ...newLine(l.variantId, l.qty, l.price), discount: l.discount ?? 0, rate: l.rate ?? '', note: l.note ?? '' })));
    setReceived(d.receivedPaise);
    setPayMethod(d.payMethod);
  }
  function restoreDraft() {
    if (!draft || !variants.data) return;
    applyDraft(draft);
    setDraft(null);
  }
  const [holding, setHolding] = useState(false);
  const [showHeld, setShowHeld] = useState(false);
  const heldCount = useQuery(() => (quote || editId ? Promise.resolve([]) : api.heldList('invoice')), [quote, editId]);
  /** The bill as it stands, in the form saved drafts and held bills share. */
  const currentDraft = (): InvoiceDraft => ({ savedAt: new Date().toISOString(), type, customerId, buyerName, issueDate, dueDate, discountPaise: discount, notes, lines, receivedPaise: received, payMethod });
  function discardDraft() {
    clearDraft();
    setDraft(null);
  }

  // "Duplicate": start from an earlier invoice's (or quote's) customer, items, prices, discount and notes (today's date, nothing paid).
  // "Edit" starts from the quote itself, with its own dates.
  const sourceId = editId ?? copyFrom;
  const source = useQuery(() => (sourceId ? ((quote ? api.proformaGet(sourceId) : api.invoiceGet(sourceId)) as Promise<Invoice | Proforma>) : Promise.resolve(null)), [sourceId, quote]);
  const copied = useRef(false);
  useEffect(() => {
    const inv = source.data;
    if (copied.current || !inv || !variants.data) return;
    copied.current = true;
    const available = new Map(variants.data.map((v) => [v.variantId, v]));
    const kept = inv.lines.filter((l) => available.has(l.variantId));
    if (editId) {
      setIssueDate(inv.issueDate);
      setDueDate('validUntil' in inv ? inv.validUntil : (inv.dueDate ?? inv.issueDate));
      dueTouched.current = true;
    }
    if (editId && 'reserveStock' in inv) setReserve(inv.reserveStock);
    setType(inv.type);
    setCustomerId(inv.customerId);
    if (!inv.customerId && inv.buyer.name && inv.buyer.name !== 'Walk-in customer') setBuyerName(inv.buyer.name);
    setDiscount(inv.discountPaise);
    setNotes(inv.notes);
    // Item discounts and notes come along; GST rates are worked out afresh, as for any new invoice.
    setLines(kept.map((l) => ({ ...newLine(l.variantId, String(l.qty), l.unitPricePaise), discount: l.discountPaise, note: l.note })));
    const dropped = inv.lines.length - kept.length;
    if (editId) return;
    toast.info(dropped > 0 ? `Copied from ${inv.number}. ${dropped} item${dropped === 1 ? ' is' : 's are'} no longer available and left out.` : `Copied from ${inv.number}. Check the quantities and prices, then ${quote ? 'create the proforma' : 'issue'}.`);
  }, [source.data, variants.data, toast]);

  const nextNumber = useQuery(() => (quote ? api.proformaNextNumber(issueDate) : api.invoiceNextNumber(issueDate, type)), [issueDate, quote, type]);
  const editing = source.data && editId ? source.data : null;

  const customer = customers.data?.find((c) => c.id === customerId) ?? null;
  const sellable = useMemo(() => {
    const loaded = variants.data ?? [];
    const have = new Set(loaded.map((v) => v.variantId));
    return [...loaded, ...justAdded.filter((v) => !have.has(v.variantId))];
  }, [variants.data, justAdded]);
  const variantById = useMemo(() => new Map(sellable.map((v) => [v.variantId, v])), [sellable]);

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
    // A customer with agreed payment terms gets their own due date; everyone else follows the shop's default for the type.
    const byTerms = quote ? null : dueDateFromTerms(issueDate, customer?.paymentTermsDays);
    setDueDate(quote ? addDays(issueDate, settings.data.proformaValidDays) : (byTerms ?? (type === 'B2B' ? addDays(issueDate, settings.data.defaultDueDays) : issueDate)));
  }, [type, issueDate, settings.data, quote, customer?.paymentTermsDays]);

  // A template brings its items at the prices it was saved with, and its note. Items that no longer exist are left out, and the person is told.
  function applyTemplate(t: QuoteTemplate) {
    const known = new Set((variants.data ?? []).map((v) => v.variantId));
    const kept = t.lines.filter((l) => known.has(l.variantId));
    setLines(kept.map((l) => newLine(l.variantId, String(l.qty), l.unitPricePaise)));
    if (t.notes) setNotes(t.notes);
    const dropped = t.lines.length - kept.length;
    toast.info(dropped > 0 ? `“${t.name}” added. ${dropped} item${dropped === 1 ? ' is' : 's are'} no longer available and left out.` : `“${t.name}” added. Check the quantities, then create the proforma.`);
  }

  function changeType(next: InvoiceType) {
    setType(next);
    if (next === 'B2B' && customer && !customer.gstin) setCustomerId(null); // a B2B invoice needs a GSTIN
  }

  const shop = { gstRatePercent: settings.data?.gstRatePercent ?? 0, rateSlabs: settings.data?.rateSlabs ?? [] };
  const rows = lines.map((l) => {
    const v = variantById.get(l.variantId);
    const qty = toNumber(l.qty);
    const validQty = Number.isInteger(qty) && qty >= 1;
    const amount = validQty ? mulPaise(qty, l.price) : 0;
    const discount = Math.min(l.discount, amount);
    const typed = l.rate.trim() === '' ? null : Number(l.rate);
    const typedValid = typed === null || isValidRate(typed);
    const worked = (override: number | null) => resolveRate({ override, designRate: v?.gstRatePercent ?? null, qty: validQty ? qty : 1, netPaise: amount - discount }, shop);
    return { line: l, variant: v, qty, validQty, amount, discount, typed: typedValid ? typed : null, typedValid, rate: worked(typedValid ? typed : null), autoRate: worked(null), short: !quote && v && validQty && qty > v.stock - v.held };
  });
  /** What goes to the server for a line: only what was typed. The rate is left out unless one was typed, so it is worked out there. */
  const lineInput = (r: (typeof rows)[number]): LineInput => ({
    variantId: r.line.variantId,
    qty: r.qty,
    unitPricePaise: r.line.price,
    ...(r.line.discount > 0 ? { discountPaise: r.line.discount } : {}),
    ...(r.typed !== null ? { ratePercent: r.typed } : {}),
    ...(r.line.note.trim() ? { note: r.line.note.trim() } : {}),
  });
  const placeOfSupply = customer?.state || settings.data?.state || '';
  const intraState = !settings.data?.state || sameState(placeOfSupply, settings.data.state);
  const inclusive = settings.data?.pricesIncludeGst ?? false;
  // Loyalty points are spent as a part of the discount: as many as the customer has, up to what the bill can take.
  const pointValue = settings.data?.loyaltyPointValuePaise ?? 100;
  const netBeforeDiscount = rows.reduce((s, r) => s + r.amount - r.discount, 0);
  const pointsAvailable = !quote && customer && (settings.data?.loyaltySpendPaise ?? 0) > 0 ? Math.min(customer.loyaltyPoints, Math.floor(Math.max(0, netBeforeDiscount - discount) / pointValue)) : 0;
  const pointsUsed = usePoints ? pointsAvailable : 0;
  const effectiveDiscount = discount + pointsUsed * pointValue;
  const totals = computeInvoice({
    lines: rows.map((r) => ({ amountPaise: r.amount, discountPaise: r.discount, ratePercent: r.rate })),
    discountPaise: effectiveDiscount,
    intraState,
    inclusive,
    roundOff: settings.data?.roundOff,
  });

  // Advance the customer already holds goes onto this invoice first, then whatever is handed over now.
  const advanceHeld = quote ? 0 : (customer?.advancePaise ?? 0);
  const advanceApplied = useAdvance ? Math.min(advanceHeld, totals.totalPaise) : 0;
  const maxReceivable = totals.totalPaise - advanceApplied;
  const balanceDue = maxReceivable - Math.min(received, maxReceivable);
  // A warning, not a block: the shop can still choose to bill a regular customer past their limit.
  const credit = !quote && customer ? checkCredit(customer.creditLimitPaise, customer.outstandingPaise, Math.max(0, balanceDue)) : null;

  const sellerGstinMissing = type === 'B2B' && !!settings.data && !settings.data.gstin;
  const problems: string[] = [];
  if (!quote && lines.length > 0 && received > maxReceivable) problems.push(`The payment is ${formatMoney(received - maxReceivable)} more than this invoice needs. Lower it — record any extra separately as an advance.`);
  if (lines.length === 0) problems.push('Add at least one item.');
  if (rows.some((r) => !r.validQty)) problems.push('Every item needs a quantity of 1 or more.');
  if (rows.some((r) => r.short)) problems.push('Some items are short of stock.');
  if (type === 'B2B' && !customer) problems.push('Choose the business customer.');
  if (type === 'B2B' && customer && !customer.gstin) problems.push(`${customer.name} has no GSTIN — add it, or bill as B2C.`);
  if (effectiveDiscount > totals.subtotalPaise - totals.lineDiscountPaise) problems.push('The discount is more than the subtotal.');
  if (rows.some((r) => !r.typedValid)) problems.push('Check the GST rate on an item: it should be a number from 0 to 100.');
  if (rows.some((r) => r.line.discount > r.amount)) problems.push("An item's discount is more than the item.");
  if (sellerGstinMissing) problems.push('Add your GSTIN in Settings first.');
  const canSubmit = problems.length === 0 && !saving;

  function addVariant(v: SaleVariant) {
    setLines((ls) => {
      const existing = ls.find((l) => l.variantId === v.variantId);
      if (existing) return ls.map((l) => (l === existing ? { ...l, qty: String((toNumber(l.qty) || 0) + 1) } : l));
      return [...ls, newLine(v.variantId, '1', v.sellPricePaise)];
    });
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      if (quote) {
        const input = { type, customerId, buyerName: customerId ? undefined : buyerName, issueDate, validUntil: dueDate, discountPaise: discount, notes, lines: rows.map(lineInput), reserve };
        const p = editId ? await api.proformaUpdate(editId, input) : await api.proformaCreate(input);
        refresh();
        toast.success(editId ? `Proforma ${p.number} updated` : `Proforma ${p.number} created`);
        navigate(paths.proforma(p.id));
        return;
      }
      const inv = await api.invoiceCreate({
        type,
        customerId,
        buyerName: customerId ? undefined : buyerName,
        issueDate,
        dueDate: dueDate || null,
        discountPaise: effectiveDiscount,
        redeemPoints: pointsUsed > 0 ? pointsUsed : undefined,
        notes,
        shipTo,
        transport,
        trackingNo,
        lines: rows.map(lineInput),
        payment: received > 0 ? { amountPaise: received, method: payMethod, reference: payRef } : undefined,
        applyAdvancePaise: advanceApplied > 0 ? advanceApplied : undefined,
      });
      clearDraft();
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
      <PageHeader
        back={back}
        title={editing ? `Edit ${editing.number}` : quote ? 'New proforma' : 'New invoice'}
        subtitle={editing ? 'Changes the quote itself; it keeps its number.' : nextNumber.data ? <>Will be numbered <span className="num text-ink">{nextNumber.data}</span></> : undefined}
        actions={
          !quote && !editId ? (
            <>
              {(heldCount.data?.length ?? 0) > 0 && (
                <Button onClick={() => setShowHeld(true)} disabled={!variants.data}>
                  On hold ({heldCount.data!.length})
                </Button>
              )}
              <Button disabled={lines.length === 0} onClick={() => setHolding(true)} title="Set this bill aside to finish later, so you can serve the next customer">
                Hold
              </Button>
            </>
          ) : undefined
        }
      />

      {draft && (
        <div className="animate-fade-in mb-6 flex items-center justify-between gap-4 rounded-lg bg-status-partial-bg px-4 py-3 text-status-partial-fg">
          <span>
            You have an unfinished invoice
            {draft.savedAt && <> from {new Date(draft.savedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</>} — {draft.lines.length} {draft.lines.length === 1 ? 'item' : 'items'}.
          </span>
          <span className="flex shrink-0 gap-2">
            <Button className="h-8 text-xs" onClick={discardDraft}>
              Discard
            </Button>
            <Button variant="primary" className="h-8 text-xs" disabled={!variants.data} onClick={restoreDraft}>
              Restore it
            </Button>
          </span>
        </div>
      )}

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
              <CustomerPicker customers={customers.data ?? []} type={type} value={customer} onChange={(c) => { setCustomerId(c?.id ?? null); setShipTo(null); }} onCreate={(name) => setCreating(name)} />
            </Field>
            {customer && !quote && customer.paymentTermsDays != null && (
              <p className="-mt-3 text-xs text-ink-muted">
                {customer.name} pays within {customer.paymentTermsDays === 0 ? 'the day' : `${customer.paymentTermsDays} days`} — the due date follows that.
              </p>
            )}
            {credit?.overLimit && (
              <div role="alert" className="-mt-2 rounded-lg bg-status-partial-bg px-4 py-3 text-status-partial-fg">
                {balanceDue > 0 ? (
                  <>
                    This takes {customer?.name} to <Money paise={credit.afterPaise} />, which is <Money paise={credit.excessPaise} /> over their <Money paise={credit.limitPaise} /> credit limit.
                  </>
                ) : (
                  <>
                    {customer?.name} already owes <Money paise={credit.afterPaise} />, <Money paise={credit.excessPaise} /> over their <Money paise={credit.limitPaise} /> credit limit.
                  </>
                )}
              </div>
            )}
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
            {quote && (
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" checked={reserve} onChange={(e) => setReserve(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#0F6E56]" />
                <span>
                  Hold these pieces for the customer
                  <span className="block text-xs text-ink-muted">They stay on the shelf but can't be sold to anyone else until the quote expires, is invoiced, or is marked lost.</span>
                </span>
              </label>
            )}
          </Card>


          {quote && !editId && !copyFrom && lines.length === 0 && (templates.data?.length ?? 0) > 0 && (
            <Card className="flex flex-wrap items-center gap-3 p-4">
              <span className="text-ink-muted">Start from a template:</span>
              {templates.data?.map((t) => (
                <span key={t.id} className="inline-flex items-center overflow-hidden rounded-lg border border-line">
                  <button type="button" onClick={() => applyTemplate(t)} className="px-3 py-1.5 transition-colors hover:bg-brand-tint hover:text-brand">
                    {t.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete template ${t.name}`}
                    onClick={() => void api.quoteTemplateDelete(t.id).then(() => refresh())}
                    className="border-l border-line px-2 py-1.5 text-ink-muted transition-colors hover:bg-status-overdue-bg hover:text-status-overdue-fg"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </Card>
          )}
          {!quote && <ShipToCard customer={customer} shipTo={shipTo} onShipTo={setShipTo} transport={transport} onTransport={setTransport} trackingNo={trackingNo} onTrackingNo={setTrackingNo} />}

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
                    <Fragment key={r.line.variantId}>
                    <tr className="animate-fade-in border-b border-line/70 align-top last:border-0">
                      <td className="td">
                        <div>{r.variant?.designName}</div>
                        <div className="text-xs text-ink-muted">
                          {r.variant?.color} · {r.variant?.size} · {r.variant?.sku}
                        </div>
                        {r.short && <div className="mt-1 text-xs text-status-overdue-fg">Only {Math.max(0, (r.variant?.stock ?? 0) - (r.variant?.held ?? 0))} can be sold{(r.variant?.held ?? 0) > 0 ? ` (${r.variant?.held} held for quotes)` : ''}</div>}
                        {!more.has(r.line.variantId) && (
                          <button type="button" onClick={() => setMore((s) => new Set(s).add(r.line.variantId))} className="mt-1 text-xs text-brand hover:underline">
                            {r.line.discount > 0 || r.typed !== null || r.line.note ? 'Edit discount, GST, note' : 'Discount, GST, note'}
                          </button>
                        )}
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
                    {more.has(r.line.variantId) && (
                      <tr className="border-b border-line/70 bg-canvas last:border-0">
                        <td colSpan={5} className="px-4 pb-3 pt-1">
                          <div className="grid grid-cols-[8rem_7rem_1fr] gap-3">
                            <label className="block text-xs text-ink-muted">
                              Discount on this item
                              <MoneyInput value={r.line.discount} onChange={(d) => setLines((ls) => ls.map((l) => (l === r.line ? { ...l, discount: d } : l)))} aria-label={`Discount on ${r.variant?.color} ${r.variant?.size}`} className="mt-1 h-8" />
                            </label>
                            <label className="block text-xs text-ink-muted">
                              GST rate
                              <div className="relative mt-1">
                                <Input
                                  value={r.line.rate}
                                  onChange={(e) => setLines((ls) => ls.map((l) => (l === r.line ? { ...l, rate: e.target.value.replace(/[^\d.]/g, '').slice(0, 6) } : l)))}
                                  inputMode="decimal"
                                  aria-label={`GST rate on ${r.variant?.color} ${r.variant?.size}`}
                                  aria-invalid={!r.typedValid}
                                  placeholder={`Auto ${r.autoRate}`}
                                  className="num h-8 pr-6 text-right"
                                />
                                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ink-muted">%</span>
                              </div>
                            </label>
                            <label className="block text-xs text-ink-muted">
                              Note printed under the item
                              <Input value={r.line.note} onChange={(e) => setLines((ls) => ls.map((l) => (l === r.line ? { ...l, note: e.target.value.slice(0, 120) } : l)))} aria-label={`Note on ${r.variant?.color} ${r.variant?.size}`} placeholder="e.g. Matching blouse piece included" className="mt-1 h-8" />
                            </label>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
            <div className="p-4">
              <ItemPicker variants={sellable} taken={new Set(lines.map((l) => l.variantId))} onPick={addVariant} onCreate={(name) => setAddingItem(name)} allowOutOfStock={quote} />
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
              <div className="flex justify-between"><dt className="text-ink-muted">{inclusive ? 'Subtotal (incl. GST)' : 'Subtotal'}</dt><dd><Money paise={totals.subtotalPaise} /></dd></div>
              {pointsAvailable > 0 && (
                <div className="flex items-center justify-between gap-3">
                  <dt>
                    <label className="flex cursor-pointer items-center gap-2 text-ink-muted">
                      <input type="checkbox" checked={usePoints} onChange={(e) => setUsePoints(e.target.checked)} className="h-4 w-4 accent-[#0F6E56]" />
                      Use {pointsAvailable} points
                    </label>
                  </dt>
                  <dd className="num">{usePoints ? `−${formatMoney(pointsUsed * pointValue)}` : formatMoney(pointsAvailable * pointValue)}</dd>
                </div>
              )}
              {totals.lineDiscountPaise > 0 && <div className="flex justify-between"><dt className="text-ink-muted">Item discounts</dt><dd className="num">−{formatMoney(totals.lineDiscountPaise)}</dd></div>}
              <div className="flex items-center justify-between gap-4">
                <dt className="text-ink-muted">Discount</dt>
                <dd className="w-32"><MoneyInput value={discount} onChange={setDiscount} aria-label="Discount" className="h-8" /></dd>
              </div>
              {(totals.discountPaise > 0 || totals.lineDiscountPaise > 0 || inclusive) && <div className="flex justify-between"><dt className="text-ink-muted">Taxable value</dt><dd><Money paise={totals.taxablePaise} /></dd></div>}
              {totals.byRate.map((g) =>
                intraState ? (
                  <div key={g.ratePercent}>
                    <div className="flex justify-between"><dt className="text-ink-muted">CGST {g.ratePercent / 2}%</dt><dd><Money paise={g.cgstPaise} /></dd></div>
                    <div className="mt-2 flex justify-between"><dt className="text-ink-muted">SGST {g.ratePercent / 2}%</dt><dd><Money paise={g.sgstPaise} /></dd></div>
                  </div>
                ) : (
                  <div key={g.ratePercent} className="flex justify-between"><dt className="text-ink-muted">IGST {g.ratePercent}%</dt><dd><Money paise={g.igstPaise} /></dd></div>
                ),
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
              {editing ? 'Save changes' : quote ? 'Create proforma' : 'Issue invoice'}
            </Button>
            {!canSubmit && !saving && problems.length > 0 && lines.length > 0 && <p className="mt-2 text-xs text-ink-muted">{problems[0]}</p>}
            <p className="mt-3 text-xs text-ink-muted">
              {quote ? 'A proforma is a quote. It takes nothing off your shelves and isn\'t counted as a sale until you turn it into an invoice.' : 'Issuing takes the stock off your shelves. An issued invoice can be cancelled, not edited.'}
            </p>
          </Card>
        </aside>
      </div>

      {holding && (
        <HoldModal
          suggestion={customer?.name ?? (buyerName.trim() || `Bill at ${new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`)}
          draft={currentDraft()}
          onClose={() => setHolding(false)}
          onHeld={() => {
            // The bill is safe on the shelf: clear the counter for the next one.
            setHolding(false);
            clearDraft();
            setLines([]);
            setCustomerId(null);
            setBuyerName('');
            setDiscount(0);
            setNotes('');
            setReceived(0);
            setShipTo(null);
            dueTouched.current = false;
          }}
        />
      )}
      {showHeld && (
        <HeldListModal
          onClose={() => setShowHeld(false)}
          onResume={(bill, d) => {
            setShowHeld(false);
            applyDraft(d);
            toast.success(`Picked up “${bill.name}”`);
          }}
        />
      )}
      {addingItem !== null && (
        <QuickAddItemModal
          initialName={addingItem}
          quote={quote}
          onClose={() => setAddingItem(null)}
          onAdded={(v) => {
            setJustAdded((a) => [...a, v]);
            addVariant(v);
            setAddingItem(null);
            refresh();
            toast.success(`${v.designName} (${v.color}) is now in your inventory.`);
          }}
        />
      )}
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
