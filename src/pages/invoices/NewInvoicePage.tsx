import { ChevronUp, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { suggestAccount } from '../../../shared/accountChoice';
import { fixedDiscountTooBig, lineDiscountPaise, percentOf } from '../../../shared/billLines';
import { checkCredit, dueDateFromTerms } from '../../../shared/credit';
import { addDays, computeInvoice, formatDate, isIsoDate, isValidRate, resolveRate, todayIso } from '../../../shared/gst';
import { formatMoney, mulPaise } from '../../../shared/money';
import { billCost, discountForTarget, lowestSafe, roundFigures } from '../../../shared/meetPrice';
import type { RepeatItem } from '../../../shared/repeatBill';
import { matchesAll } from '../../../shared/search';
import { parseInvoiceDraft, type InvoiceDraft } from '../../../shared/invoiceDraft';
import { sameState } from '../../../shared/states';
import { PAYMENT_METHOD_LABEL, type Customer, type Invoice, type InvoiceType, type LineInput, type PaymentMethod, type Proforma, type SaleVariant, type ShipTo } from '../../../shared/types';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorNote, Input, Money, MoneyInput, PageHeader, Select, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useQueryOnce, useRefresh } from '../../lib/data';
import { plural, toNumber } from '../../lib/format';
import { navigate, paths, type AdvancePreset } from '../../lib/router';
import { useSession } from '../../lib/session';
import { CustomerFormModal } from '../customers/CustomerFormModal';
import { HeldListModal, HoldModal } from './HeldBills';
import { Bundles } from './Bundles';
import { CustomerBrief } from './CustomerBrief';
import { QuickBillBar, type QuickApply } from './QuickBillBar';
import { RepeatBill } from './RepeatBill';
import { JUST_ISSUED_KEY } from './ShareInvoice';
import { BILL_NOTES, BrowseAdd, Choice, Chip, DUE_DAYS, DesignThumb, DiscountSelect, ExtraPayRow, ItemDetails, QtyStepper, StepTitle, type ExtraPay } from './invoiceParts';
import { QuickAddItemModal } from './QuickAddItemModal';
import { ShipToCard } from './ShipToCard';

interface Line {
  variantId: string;
  qty: string;
  price: number;
  /** Taken off this line alone, in paise. */
  discount: number;
  /** Set when the discount was picked as a percentage: it then follows the line's quantity and price. */
  discountPct: number | null;
  /** A GST rate typed for this line, as text; empty means "work it out". */
  rate: string;
  note: string;
}

const newLine = (variantId: string, qty: string, price: number): Line => ({ variantId, qty, price, discount: 0, discountPct: null, rate: '', note: '' });

// An invoice that was being built is kept as you go, so a crash or a closed window doesn't lose it.
const DRAFT_KEY = 'invoiceon.draft.invoice';
const SOLD_BY_KEY = 'invoiceon.soldBy';
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
export function ItemPicker({ variants, taken, onPick, onCreate, allowOutOfStock = false, direction = 'up', large = false, autoFocus = false, covers = {} }: { variants: SaleVariant[]; taken: Set<string>; onPick: (v: SaleVariant, qty?: number) => void; onCreate: (name: string) => void; allowOutOfStock?: boolean; direction?: 'up' | 'down'; large?: boolean; autoFocus?: boolean; covers?: Record<string, string> }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  // A scanner types a Saree ID and presses Enter: an exact ID is that piece and nothing else, so Enter picks it.
  // "kadhua ivory x2" means two of whatever that finds: a quantity typed after the name, with an x, a × or a *.
  const { results, qty } = useMemo(() => {
    const whole = q.trim().toLowerCase();
    const exact = whole ? variants.filter((v) => v.sku.toLowerCase() === whole || (v.barcode !== '' && v.barcode.toLowerCase() === whole)) : [];
    if (exact.length === 1) return { results: exact, qty: 1 };
    const m = /^(.*\S)\s*[x×*]\s*(\d{1,4})$/i.exec(q.trim());
    const text = m ? m[1]! : q;
    const code = text.trim().toLowerCase();
    const scanned = code ? variants.filter((v) => v.sku.toLowerCase() === code || (v.barcode !== '' && v.barcode.toLowerCase() === code)) : [];
    return { results: scanned.length === 1 ? scanned : variants.filter((v) => matchesAll(`${v.designName} ${v.designNickname} ${v.designCode} ${v.color} ${v.size} ${v.sku} ${v.barcode}`, text)).slice(0, 50), qty: m ? Math.max(1, Number(m[2])) : 1 };
  }, [variants, q]);

  const pick = (v: SaleVariant) => {
    if (v.stock <= 0 && !allowOutOfStock) return;
    onPick(v, qty);
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
      <Search className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted ${large ? 'h-5 w-5' : 'h-4 w-4'}`} aria-hidden />
      <input
        value={q}
        role="combobox"
        aria-expanded={open}
        aria-label="Add item"
        autoFocus={autoFocus}
        placeholder={large ? 'Add an item — type a name, scan a barcode, or add a quantity like “kadhua ivory x2”' : 'Add an item — search, or scan its barcode'}
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
        className={`w-full rounded-lg border bg-surface pr-3 transition-[border-color,box-shadow] duration-150 placeholder:text-ink-muted/60 hover:border-ink/25 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15 ${large ? 'h-12 border-line pl-11 text-base shadow-card' : 'h-9 border-dashed border-line pl-9 text-sm'}`}
      />
      {open && (
        <ul role="listbox" onMouseDown={(e) => e.preventDefault()} className={`animate-pop-in absolute z-30 max-h-80 w-full overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-overlay ${direction === 'down' ? 'top-full mt-1.5' : 'bottom-full mb-1.5'}`}>
          {qty > 1 && results.length > 0 && <li className="px-3 py-1.5 text-xs text-brand">Adding {qty} of the one you choose</li>}
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
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left ${i === active && !out ? 'bg-brand-tint' : ''} ${out ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  <DesignThumb src={covers[v.designId]} name={v.designName} size={40} />
                  <span className="min-w-0 flex-1">
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
  const session = useSession();
  /** What the pieces cost is shown only to an owner (or when nobody has signed in): it is the shop's own margin. */
  const canSeeCost = !session.enabled || session.current?.role === 'owner';
  const settings = useQuery(() => api.getSettings());
  const customers = useQuery(() => api.customersList());
  const variants = useQuery(() => api.variantsForSale());

  const [type, setType] = useState<InvoiceType>('B2C');
  const [customerId, setCustomerId] = useState<string | null>(presetCustomerId);
  /** Once the person has switched between retail and GST invoice themselves, choosing a customer no longer changes it. */
  const typeTouched = useRef(false);
  const [buyerName, setBuyerName] = useState('');
  const [issueDate, setIssueDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState(todayIso());
  const dueTouched = useRef(false);
  const [reserve, setReserve] = useState(false);
  const [usePoints, setUsePoints] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [shipTo, setShipTo] = useState<ShipTo | null>(null);
  const [transport, setTransport] = useState('');
  const [trackingNo, setTrackingNo] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  /** The text typed in the item box when "add to inventory" was chosen; null when the dialog is closed. */
  const [addingItem, setAddingItem] = useState<string | null>(null);
  /** Items added to the inventory from this screen, kept here until the list of items has loaded them. */
  const [justAdded, setJustAdded] = useState<SaleVariant[]>([]);
  /** Who is making this sale, when the shop keeps a sales team. The last person chosen on this computer is remembered. */
  const [soldBy, setSoldByState] = useState('');
  const soldByTouched = useRef(false);
  const setSoldBy = (id: string) => {
    soldByTouched.current = true;
    setSoldByState(id);
    try {
      localStorage.setItem(SOLD_BY_KEY, id);
    } catch {
      /* remembering is a nicety */
    }
  };
  const [pickIssue, setPickIssue] = useState(false);
  const [pickDue, setPickDue] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  /** "Agree a price": the figure the customer has agreed to pay, in paise, and whether its panel is open. */
  /** A design to show in the item picker: one the customer asked for. */
  const [wantDesign, setWantDesign] = useState<{ id: string; n: number } | undefined>(undefined);
  const [meetOpen, setMeetOpen] = useState(false);
  const [meetTarget, setMeetTarget] = useState(0);
  /** Which of the shop's accounts the money handed over now goes into. */
  const [accountId, setAccountId] = useState('');
  // Money received as the invoice is made. It can arrive pre-filled from "Record payment → Record & create invoice".
  const [received, setReceived] = useState(advance?.amountPaise ?? 0);
  const [payMethod, setPayMethod] = useState<PaymentMethod>(advance?.method ?? 'cash');
  /** How it is being paid: later, or by which method. "Full" keeps the amount at whatever the bill comes to as items change. */
  const [payMode, setPayMode] = useState<'later' | PaymentMethod>(advance?.amountPaise ? advance.method : 'later');
  const [payFull, setPayFull] = useState(false);
  /** More parts of the payment, when it is made in parts (part cash, part UPI). The first part is the one above. */
  const [extras, setExtras] = useState<ExtraPay[]>([]);
  const extraId = useRef(0);
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
        else localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: new Date().toISOString(), type, customerId, buyerName, issueDate, dueDate, discountPaise: discount, notes, lines, receivedPaise: received, payMethod, ...(extras.length > 0 ? { extras } : {}) }));
      } catch {
        /* a convenience, not a record */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [draftable, draft, type, customerId, buyerName, issueDate, dueDate, discount, notes, lines, received, payMethod, extras]);
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
    setLines(d.lines.filter((l) => known.has(l.variantId)).map((l) => ({ ...newLine(l.variantId, l.qty, l.price), discount: l.discount ?? 0, discountPct: l.discountPct ?? null, rate: l.rate ?? '', note: l.note ?? '' })));
    setReceived(d.receivedPaise);
    setPayMethod(d.payMethod);
    setPayMode(d.receivedPaise > 0 ? d.payMethod : 'later');
    setPayFull(false);
    setExtras((d.extras ?? []).map((e) => ({ ...e, id: String((extraId.current += 1)) })));
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
  const currentDraft = (): InvoiceDraft => ({ savedAt: new Date().toISOString(), type, customerId, buyerName, issueDate, dueDate, discountPaise: discount, notes, lines, receivedPaise: received, payMethod, ...(extras.length > 0 ? { extras: extras.map(({ method, amountPaise, reference, accountId }) => ({ method, amountPaise, reference, accountId })) } : {}) });
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
  const accounts = settings.data?.paymentAccounts ?? [];
  const teamQuery = useQuery(() => api.salespeopleList());
  const team = (teamQuery.data ?? []).filter((p) => !p.archived);
  // Start from whoever sold last on this computer, if they are still on the team.
  useEffect(() => {
    if (soldByTouched.current || soldBy || team.length === 0) return;
    try {
      const last = localStorage.getItem(SOLD_BY_KEY) ?? '';
      if (team.some((p) => p.id === last)) setSoldByState(last);
    } catch {
      /* no memory to read */
    }
  }, [team, soldBy]);
  const coverQuery = useQueryOnce(() => api.designCovers());
  const covers = coverQuery.data ?? {};
  // Tap-to-choose helpers: the people billed most recently, and what the chosen customer has bought before.
  const recentInvoices = useQueryOnce(() => (editId ? Promise.resolve([]) : api.invoicesList()), [editId]);
  const purchases = useQuery(() => (customerId ? api.customerPurchases(customerId) : Promise.resolve([])), [customerId]);
  const sellable = useMemo(() => {
    const loaded = variants.data ?? [];
    const have = new Set(loaded.map((v) => v.variantId));
    return [...loaded, ...justAdded.filter((v) => !have.has(v.variantId))];
  }, [variants.data, justAdded]);
  const variantById = useMemo(() => new Map(sellable.map((v) => [v.variantId, v])), [sellable]);
  const recentCustomers = useMemo(() => {
    const seen = new Set<string>();
    const out: Customer[] = [];
    for (const i of recentInvoices.data ?? []) {
      if (!i.customerId || seen.has(i.customerId)) continue;
      seen.add(i.customerId);
      const c = customers.data?.find((x) => x.id === i.customerId);
      if (c && (type !== 'B2B' || c.gstin)) out.push(c);
      if (out.length >= 6) break;
    }
    return out;
  }, [recentInvoices.data, customers.data, type]);
  const boughtBefore = useMemo(() => {
    const taken = new Set(lines.map((l) => l.variantId));
    const out: SaleVariant[] = [];
    for (const p of purchases.data ?? []) {
      for (const vs of p.variants) {
        const v = sellable.find((x) => x.designName === p.designName && `${x.color} ${x.size}`.trim() === vs);
        if (v && (v.stock > 0 || quote) && !taken.has(v.variantId) && !out.includes(v)) out.push(v);
        if (out.length >= 8) return out;
      }
    }
    return out;
  }, [purchases.data, sellable, lines, quote]);

  // When arriving from a customer's page, follow their usual billing type once their record loads.
  const presetApplied = useRef(false);
  useEffect(() => {
    if (presetApplied.current || !customer) return;
    presetApplied.current = true;
    if (customer.type === 'B2B') setType('B2B');
  }, [customer]);

  // Due date follows the invoice type and date until the user picks one themselves.
  useEffect(() => {
    if (dueTouched.current || !settings.data || !isIsoDate(issueDate)) return;
    // A customer with agreed payment terms gets their own due date; everyone else follows the shop's default for the type.
    const byTerms = quote ? null : dueDateFromTerms(issueDate, customer?.paymentTermsDays);
    setDueDate(quote ? addDays(issueDate, settings.data.proformaValidDays) : (byTerms ?? (type === 'B2B' ? addDays(issueDate, settings.data.defaultDueDays) : issueDate)));
  }, [type, issueDate, settings.data, quote, customer?.paymentTermsDays]);

  function changeType(next: InvoiceType) {
    typeTouched.current = true;
    setType(next);
    if (next === 'B2B' && customer && !customer.gstin) setCustomerId(null); // a B2B invoice needs a GSTIN
  }
  /** Choosing a customer sets the kind of bill: someone with a GSTIN gets a GST tax invoice, everyone else a retail bill. */
  function chooseCustomer(c: Customer | null) {
    setCustomerId(c?.id ?? null);
    setShipTo(null);
    if (!typeTouched.current) setType(c?.gstin ? 'B2B' : 'B2C');
  }

  const shop = { gstRatePercent: settings.data?.gstRatePercent ?? 0, rateSlabs: settings.data?.rateSlabs ?? [] };
  const rows = lines.map((l) => {
    const v = variantById.get(l.variantId);
    const qty = toNumber(l.qty);
    const validQty = Number.isInteger(qty) && qty >= 1;
    const amount = validQty ? mulPaise(qty, l.price) : 0;
    const discount = lineDiscountPaise(amount, { discountPaise: l.discount, discountPct: l.discountPct });
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
    ...(r.discount > 0 ? { discountPaise: r.discount } : {}),
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
  const receivedAll = received + extras.reduce((sum, e) => sum + e.amountPaise, 0);
  const balanceDue = maxReceivable - Math.min(receivedAll, maxReceivable);
  // A warning, not a block: the shop can still choose to bill a regular customer past their limit.
  const credit = !quote && customer ? checkCredit(customer.creditLimitPaise, customer.outstandingPaise, Math.max(0, balanceDue)) : null;

  const sellerGstinMissing = type === 'B2B' && !!settings.data && !settings.data.gstin;
  const problems: string[] = [];
  if (!quote && lines.length > 0 && receivedAll > maxReceivable) problems.push(`The ${extras.length > 0 ? 'payments are' : 'payment is'} ${formatMoney(receivedAll - maxReceivable)} more than this invoice needs. Lower it — record any extra separately as an advance.`);
  if (lines.length === 0) problems.push('Add at least one item.');
  if (rows.some((r) => !r.validQty)) problems.push('Every item needs a quantity of 1 or more.');
  if (rows.some((r) => r.short)) problems.push('Some items are short of stock.');
  if (type === 'B2B' && !customer) problems.push('Choose the business customer.');
  if (type === 'B2B' && customer && !customer.gstin) problems.push(`${customer.name} has no GSTIN — add it, or bill as B2C.`);
  if (effectiveDiscount > totals.subtotalPaise - totals.lineDiscountPaise) problems.push('The discount is more than the subtotal.');
  if (rows.some((r) => !r.typedValid)) problems.push('Check the GST rate on an item: it should be a number from 0 to 100.');
  if (rows.some((r) => fixedDiscountTooBig(r.amount, { discountPaise: r.line.discount, discountPct: r.line.discountPct }))) problems.push("An item's discount is more than the item.");
  if (sellerGstinMissing) problems.push('Add your GSTIN in Settings first.');
  const canSubmit = problems.length === 0 && !saving;

  /** Items from an earlier bill: a piece already on this one just gets the extra quantity. */
  function addRepeat(items: RepeatItem[]) {
    setLines((ls) => {
      const next = [...ls];
      for (const it of items) {
        const i = next.findIndex((l) => l.variantId === it.variantId);
        if (i >= 0) next[i] = { ...next[i]!, qty: String((toNumber(next[i]!.qty) || 0) + it.qty) };
        else next.push({ ...newLine(it.variantId, String(it.qty), it.price), discount: it.discount, note: it.note });
      }
      return next;
    });
  }

  function addVariant(v: SaleVariant, qty = 1) {
    setLines((ls) => {
      const existing = ls.find((l) => l.variantId === v.variantId);
      if (existing) return ls.map((l) => (l === existing ? { ...l, qty: String((toNumber(l.qty) || 0) + qty) } : l));
      return [...ls, newLine(v.variantId, String(qty), v.sellPricePaise)];
    });
  }

  // How it is being paid. "Later" means nothing is received; a method with "full" keeps the amount equal to what is left to pay.
  useEffect(() => {
    if (quote) return;
    if (payMode === 'later') {
      if (received !== 0) setReceived(0);
      if (extras.length > 0) setExtras([]);
    } else if (payFull && extras.length === 0 && received !== maxReceivable) setReceived(maxReceivable);
  }, [quote, payMode, payFull, maxReceivable, received, extras.length]);
  function chooseMode(mode: 'later' | PaymentMethod) {
    setPayMode(mode);
    if (mode === 'later') {
      setPayFull(false);
      setReceived(0);
      setExtras([]);
    } else {
      setPayMethod(mode);
      setPayFull(true);
      setAccountId(suggestAccount(mode, accounts));
    }
  }

  /** Puts a line typed in the "Type the whole bill" box, once the person has checked it, onto the bill. It fills in; it never issues. */
  function applyQuick(a: QuickApply) {
    if (a.customer) chooseCustomer(a.customer);
    else if (a.walkIn) {
      chooseCustomer(null);
      if (a.walkInName) setBuyerName(a.walkInName);
    }
    const percent = a.discount?.kind === 'percent' ? a.discount.percent : null;
    setLines((ls) => {
      const next = [...ls];
      for (const it of a.items) {
        const i = next.findIndex((l) => l.variantId === it.variant.variantId);
        if (i >= 0) next[i] = { ...next[i]!, qty: String((toNumber(next[i]!.qty) || 0) + it.qty), ...(it.pricePaise !== null ? { price: it.pricePaise } : {}) };
        else next.push(newLine(it.variant.variantId, String(it.qty), it.pricePaise ?? it.variant.sellPricePaise));
      }
      // A percentage is on every item, so it keeps up if a quantity changes.
      return percent === null ? next : next.map((l) => ({ ...l, discountPct: percent, discount: percentOf((toNumber(l.qty) || 0) * l.price, percent) }));
    });
    if (a.discount?.kind === 'amount') setDiscount(a.discount.paise);
    if (!quote && a.payment) {
      if (a.payment.mode === 'later') chooseMode('later');
      else {
        chooseMode(a.payment.method ?? 'cash');
        if (a.payment.amountPaise !== null) {
          setPayFull(false);
          setReceived(a.payment.amountPaise);
        }
      }
    }
    if (!quote && a.soldById) setSoldBy(a.soldById);
    if (a.dueDays !== null) {
      dueTouched.current = true;
      setPickDue(false);
      setDueDate(addDays(isIsoDate(issueDate) ? issueDate : todayIso(), a.dueDays));
    }
    if (a.note) setNotes(a.note);
    toast.success('Filled in. Check the bill, then issue it.');
  }

  /** Starts a second part: the first is cut to half if it was the whole bill, and the new part takes what is left, by another method. */
  function addSplit() {
    const first = extras.length === 0 && received >= maxReceivable ? Math.round(maxReceivable / 2) : received;
    if (extras.length === 0) {
      setPayFull(false);
      setReceived(first);
    }
    const taken = first + extras.reduce((sum, e) => sum + e.amountPaise, 0);
    const method: PaymentMethod = [payMethod === 'cash' ? 'upi' : 'cash', 'cash', 'upi', 'card', 'bank', 'cheque', 'other'].find((m) => m !== payMethod && !extras.some((e) => e.method === m)) as PaymentMethod;
    extraId.current += 1;
    setExtras((list) => [...list, { id: String(extraId.current), method, amountPaise: Math.max(0, maxReceivable - taken), reference: '', accountId: suggestAccount(method, accounts) }]);
  }

  // Ctrl+Enter issues the invoice from anywhere on the page, unless a dialog is open.
  const submitNow = useRef<() => void>(() => {});
  submitNow.current = () => {
    if (canSubmit) void submit();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.repeat && !document.querySelector('[role="dialog"]')) {
        e.preventDefault();
        submitNow.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

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
        salespersonId: soldBy && team.some((p) => p.id === soldBy) ? soldBy : null,
        payments: [
          ...(received > 0 ? [{ amountPaise: received, method: payMethod, reference: payRef, accountId: accountId || undefined }] : []),
          ...extras.filter((e) => e.amountPaise > 0).map((e) => ({ amountPaise: e.amountPaise, method: e.method, reference: e.reference, accountId: e.accountId || undefined })),
        ],
        applyAdvancePaise: advanceApplied > 0 ? advanceApplied : undefined,
      });
      clearDraft();
      try {
        sessionStorage.setItem(JUST_ISSUED_KEY, inv.id);
      } catch {
        /* the offer to send it is a nicety */
      }
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

  const hasItems = lines.length > 0;
  const pricedLines = rows.map((r) => ({ amountPaise: r.amount, discountPaise: r.discount, ratePercent: r.rate }));
  const meetBill = { lines: pricedLines, intraState, inclusive, roundOff: settings.data?.roundOff, otherDiscountPaise: pointsUsed * pointValue };
  const billWorth = billCost(rows.map((r) => ({ qty: r.validQty ? r.qty : 0, unitCostPaise: r.variant ? r.variant.unitCostPaise : null })));
  // Worked out only while the panel is open: it searches for the discount that gives the agreed total.
  const fullTotal = meetOpen ? computeInvoice({ lines: pricedLines, discountPaise: pointsUsed * pointValue, intraState, inclusive, roundOff: settings.data?.roundOff }).totalPaise : 0;
  const meet = meetOpen && meetTarget > 0 ? discountForTarget(meetBill, meetTarget) : null;
  const meetTaxable = meet ? computeInvoice({ lines: pricedLines, discountPaise: pointsUsed * pointValue + meet.discountPaise, intraState, inclusive, roundOff: settings.data?.roundOff }).taxablePaise : 0;
  const meetBelowCost = !!meet && billWorth.known && meetTaxable < billWorth.costPaise;
  const meetSafe = meetOpen && billWorth.known && canSeeCost ? lowestSafe(meetBill, billWorth.costPaise) : null;
  const billNet = rows.reduce((sum, r) => sum + r.amount - r.discount, 0);
  const today = todayIso();
  const issueSelect = pickIssue || !isIsoDate(issueDate) ? 'custom' : issueDate === today ? 'today' : issueDate === addDays(today, -1) ? 'yesterday' : 'custom';
  const dueDiff = isIsoDate(issueDate) && isIsoDate(dueDate) ? Math.round((Date.parse(dueDate) - Date.parse(issueDate)) / 86_400_000) : -1;
  // The usual periods, plus whatever the due date works out to now (a customer's own terms, say) so it is shown rather than called "another date".
  const dueChoices = [...new Set([...DUE_DAYS, ...(dueDiff >= 0 ? [dueDiff] : [])])].filter((n) => !quote || n > 0).sort((a, b) => a - b);
  const dueSelect = pickDue || !dueChoices.includes(dueDiff) ? 'custom' : String(dueDiff);
  const amountChoice = received === maxReceivable ? 'full' : received === Math.round(maxReceivable / 2) ? 'half' : received === Math.round(maxReceivable / 4) ? 'quarter' : 'custom';
  const PAY_CHIPS: { value: 'later' | PaymentMethod; label: string }[] = [
    { value: 'later', label: 'Pay later' },
    { value: 'cash', label: 'Cash' },
    { value: 'upi', label: 'UPI' },
    { value: 'card', label: 'Card' },
    { value: 'bank', label: 'Bank' },
    { value: 'cheque', label: 'Cheque' },
    { value: 'other', label: 'Other' },
  ];
  const showWarnings = !!error || sellerGstinMissing || (!canSubmit && !saving && hasItems && problems.length > 0);

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
                Hold bill
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

      <div className="mx-auto max-w-4xl space-y-5">
        {!editId && <QuickBillBar variants={sellable} customers={customers.data ?? []} team={team} quote={quote} onApply={applyQuick} />}

        {/* 1. Who is it for */}
        <Card className="space-y-4 overflow-visible p-5">
          <StepTitle n={1} title="Who is it for?" />
          <div className={!customer && type === 'B2C' ? 'grid grid-cols-2 items-start gap-4' : ''}>
            <Choice label="Customer">
              <CustomerPicker customers={customers.data ?? []} type={type} value={customer} onChange={chooseCustomer} onCreate={(name) => setCreating(name)} />
            </Choice>
            {!customer && type === 'B2C' && (
              <Choice label="Name on the invoice" hint="Optional. Blank prints “Walk-in customer”.">
                <Input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="Walk-in customer" />
              </Choice>
            )}
          </div>
          {!customer && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-ink-muted">Quick pick</span>
              <Chip active>Walk-in customer</Chip>
              {recentCustomers.map((c) => (
                <Chip key={c.id} onClick={() => chooseCustomer(c)}>
                  {c.name}
                </Chip>
              ))}
            </div>
          )}
          {customer && <CustomerBrief key={customer.id} customer={customer} onWant={(id) => setWantDesign({ id, n: Date.now() })} />}
          {customer && !quote && customer.paymentTermsDays != null && (
            <p className="-mt-2 text-xs text-ink-muted">
              {customer.name} pays within {customer.paymentTermsDays === 0 ? 'the day' : `${customer.paymentTermsDays} days`} — the due date follows that.
            </p>
          )}
          {credit?.overLimit && (
            <div role="alert" className="rounded-lg bg-status-partial-bg px-4 py-3 text-status-partial-fg">
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
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
            <span className={`rounded-full px-2 py-0.5 ${type === 'B2B' ? 'bg-brand-tint text-brand' : 'bg-status-neutral-bg'}`}>{type === 'B2B' ? 'GST tax invoice · B2B' : 'Retail bill · B2C'}</span>
            <span>{type === 'B2B' ? (customer ? `Uses ${customer.name}'s GSTIN and shows the tax breakup.` : "Needs the buyer's GSTIN, and shows HSN codes and a tax breakup.") : quote ? 'Walk-ins are fine.' : 'No GSTIN needed. Walk-ins are fine.'}</span>
            <button type="button" onClick={() => changeType(type === 'B2B' ? 'B2C' : 'B2B')} className="text-brand transition-colors hover:text-brand-hover">
              {type === 'B2B' ? 'Make it a retail bill' : 'Make it a GST tax invoice'}
            </button>
          </p>
        </Card>

        {/* 2. What are they buying */}
        <Card className="overflow-visible">
          <div className="space-y-4 border-b border-line p-5">
            <StepTitle n={2} title="What are they buying?" />
            {customer && !editId && <RepeatBill key={customer.id} customerId={customer.id} customerName={customer.name} variants={sellable} covers={covers} allowOutOfStock={quote} onAdd={addRepeat} />}
            <ItemPicker direction="down" large autoFocus covers={covers} variants={sellable} taken={new Set(lines.map((l) => l.variantId))} onPick={addVariant} onCreate={(name) => setAddingItem(name)} allowOutOfStock={quote} />
            <div>
              <p className="mb-2 text-xs text-ink-muted">Or choose from your stock</p>
              <BrowseAdd variants={sellable} onAdd={addVariant} covers={covers} allowOutOfStock={quote} focusDesign={wantDesign} />
            </div>
            {boughtBefore.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-ink-muted">{customer?.name.split(' ')[0]} bought before</span>
                {boughtBefore.map((v) => (
                  <Chip key={v.variantId} onClick={() => addVariant(v)} title={`${v.designName} · ${v.color} · ${v.size} — ${v.stock} in stock`}>
                    <DesignThumb src={covers[v.designId]} name={v.designName} size={20} /> {v.designName} · {v.color}
                  </Chip>
                ))}
              </div>
            )}
            <Bundles
              variants={sellable}
              quote={quote}
              current={rows.filter((r) => r.validQty).map((r) => ({ variantId: r.line.variantId, qty: r.qty, unitPricePaise: r.line.price, discountPaise: r.discount }))}
              onAdd={addRepeat}
              onNote={(n) => setNotes((cur) => (cur.trim() ? cur : n))}
            />
            {variants.data?.length === 0 && <p className="text-xs text-ink-muted">There's nothing to sell yet — add designs and stock under Inventory first.</p>}
          </div>

          {rows.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <p>No items yet</p>
              <p className="mt-1 text-xs text-ink-muted">Search above, pick from the lists, or scan a barcode. Type “x2” after a name to add two.</p>
            </div>
          ) : (
            <ul>
              {rows.map((r, i) => {
                const name = `${r.variant?.color ?? ''} ${r.variant?.size ?? ''}`.trim();
                const set = (patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l === r.line ? { ...l, ...patch } : l)));
                const tax = totals.lines[i]?.taxPaise ?? 0;
                return (
                  <li key={r.line.variantId} className="animate-fade-in flex items-start gap-3 border-b border-line/70 px-5 py-3.5 last:border-0">
                    <DesignThumb src={r.variant ? covers[r.variant.designId] : undefined} name={r.variant?.designName ?? '?'} size={48} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{r.variant?.designName}</div>
                      <div className="truncate text-xs text-ink-muted">
                        {r.variant?.color} · {r.variant?.size} · {r.variant?.sku}
                      </div>
                      <div className="num mt-0.5 text-xs text-ink-muted">
                        {r.variant?.hsn ? `HSN ${r.variant.hsn} · ` : ''}GST {r.rate}%{tax > 0 ? ` (${formatMoney(tax)})` : ''} · {r.variant?.stock ?? 0} in stock
                      </div>
                      {r.short && <div className="mt-1 text-xs text-status-overdue-fg">Only {Math.max(0, (r.variant?.stock ?? 0) - (r.variant?.held ?? 0))} can be sold{(r.variant?.held ?? 0) > 0 ? ` (${r.variant?.held} held for quotes)` : ''}</div>}
                      {r.line.note && <div className="mt-1 truncate text-xs text-ink-muted">“{r.line.note}”</div>}
                    </div>
                    <QtyStepper value={r.line.qty} onChange={(v) => set({ qty: v })} label={name} invalid={!r.validQty || !!r.short} />
                    <div className="w-28">
                      <MoneyInput value={r.line.price} onChange={(p) => set({ price: p })} aria-label={`Rate, ${name}`} className="h-8" />
                    </div>
                    <DiscountSelect
                      amountPaise={r.amount}
                      discountPaise={r.discount}
                      pct={r.line.discountPct}
                      label={name}
                      onPick={(p) => set({ discountPct: p, discount: p === null ? 0 : percentOf(r.amount, p) })}
                    />
                    <div className="w-24 pt-1.5 text-right">
                      <Money paise={r.amount - r.discount} />
                      {r.discount > 0 && <div className="num text-xs text-ink-muted line-through">{formatMoney(r.amount)}</div>}
                    </div>
                    <ItemDetails
                      label={name}
                      basePaise={r.amount}
                      discountPaise={r.discount}
                      onDiscount={(d) => set({ discount: d, discountPct: null })}
                      rate={r.line.rate}
                      onRate={(v) => set({ rate: v })}
                      rateValid={r.typedValid}
                      autoRate={r.autoRate}
                      note={r.line.note}
                      onNote={(v) => set({ note: v })}
                    />
                    <button type="button" aria-label={`Remove ${name}`} onClick={() => setLines((ls) => ls.filter((l) => l !== r.line))} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink">
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* 3. Dates, delivery and notes */}
        <Card className="space-y-4 overflow-visible p-5">
          <StepTitle n={3} title="Dates, delivery and notes" />
          <div className="grid grid-cols-2 items-start gap-4">
            <Choice label={quote ? 'Proforma date' : 'Invoice date'} hint={isIsoDate(issueDate) ? formatDate(issueDate) : undefined}>
              <Select
                value={issueSelect}
                onChange={(e) => {
                  if (e.target.value === 'custom') setPickIssue(true);
                  else {
                    setPickIssue(false);
                    setIssueDate(e.target.value === 'today' ? todayIso() : addDays(todayIso(), -1));
                  }
                }}
                aria-label={quote ? 'Proforma date' : 'Invoice date'}
              >
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="custom">Another date…</option>
              </Select>
              {issueSelect === 'custom' && <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} aria-label="Pick the date" className="num mt-2" />}
            </Choice>
            <Choice label={quote ? 'Valid until' : 'Payment due'} hint={isIsoDate(dueDate) ? formatDate(dueDate) : undefined}>
              <Select
                value={dueSelect}
                onChange={(e) => {
                  dueTouched.current = true;
                  if (e.target.value === 'custom') setPickDue(true);
                  else {
                    setPickDue(false);
                    setDueDate(addDays(isIsoDate(issueDate) ? issueDate : todayIso(), Number(e.target.value)));
                  }
                }}
                aria-label={quote ? 'Valid until' : 'Payment due'}
              >
                {dueChoices.map((n) => (
                  <option key={n} value={n}>
                    {quote ? `Valid for ${n} days` : n === 0 ? 'On the day' : `In ${n} days`}
                    {isIsoDate(issueDate) ? ` · ${formatDate(addDays(issueDate, n))}` : ''}
                  </option>
                ))}
                <option value="custom">Another date…</option>
              </Select>
              {dueSelect === 'custom' && (
                <Input
                  type="date"
                  value={dueDate}
                  min={issueDate}
                  onChange={(e) => {
                    dueTouched.current = true;
                    setDueDate(e.target.value);
                  }}
                  aria-label="Pick the date"
                  className="num mt-2"
                />
              )}
            </Choice>
          </div>
          {!quote && team.length > 0 && (
            <Choice label="Sold by" hint="Credited on the invoice. Reports show what each person sold.">
              <Select value={soldBy} onChange={(e) => setSoldBy(e.target.value)} aria-label="Sold by">
                <option value="">No one in particular</option>
                {team.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Choice>
          )}
          {quote && (
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={reserve} onChange={(e) => setReserve(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#0F6E56]" />
              <span>
                Hold these pieces for the customer
                <span className="block text-xs text-ink-muted">They stay on the shelf but can't be sold to anyone else until the quote expires, is invoiced, or is marked lost.</span>
              </span>
            </label>
          )}
          {!quote && <ShipToCard customer={customer} shipTo={shipTo} onShipTo={setShipTo} transport={transport} onTransport={setTransport} trackingNo={trackingNo} onTrackingNo={setTrackingNo} />}
          <Choice label={quote ? 'Note on the proforma' : 'Note on the invoice'}>
            <Select
              value=""
              onChange={(e) => e.target.value && setNotes((n) => (n.trim() ? `${n.trim()} ${e.target.value}` : e.target.value).slice(0, 300))}
              aria-label="Add a standard note"
            >
              <option value="">Add a standard note…</option>
              {BILL_NOTES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={quote ? 'Optional — printed on the proforma' : 'Optional — printed on the invoice'} className="mt-2" />
          </Choice>
        </Card>
      </div>

      {/* The total, how it is paid and the button that finishes it stay in view while the bill is built. */}
      <div className="sticky bottom-4 z-20 mx-auto mt-8 max-w-4xl">
        {showWarnings && (
          <div className="mb-2 space-y-2">
            {sellerGstinMissing && (
              <ErrorNote>
                B2B tax invoices need your own GSTIN. <a href={`#${paths.settingsSection('business')}`} className="underline underline-offset-2">Add it in Settings</a>.
              </ErrorNote>
            )}
            {error && <ErrorNote>{error}</ErrorNote>}
            {!canSubmit && !saving && hasItems && problems.length > 0 && !error && !sellerGstinMissing && <p className="rounded-lg bg-surface/95 px-3 py-1.5 text-xs text-ink-muted shadow-card">{problems[0]}</p>}
          </div>
        )}
        <div className="rounded-xl border border-line bg-surface px-5 py-3.5 shadow-overlay">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="relative">
              <button type="button" onClick={() => { setShowDetails((v) => !v); setMeetOpen(false); }} aria-expanded={showDetails} className="block text-left" title="Show how this total is made up">
                <span className="flex items-center gap-1 text-xs text-ink-muted">
                  Total · {plural(rows.length, 'item')}
                  <ChevronUp className={`h-3 w-3 transition-transform duration-150 ${showDetails ? '' : 'rotate-180'}`} aria-hidden />
                </span>
                <span key={totals.totalPaise} className="animate-tick block text-2xl leading-tight tracking-tight">
                  <Money paise={totals.totalPaise} />
                </span>
              </button>
              <div aria-hidden className="mt-1 h-0.5 w-8 rounded-full bg-gold" />
              {hasItems && totals.totalPaise > 0 && (
                <button
                  type="button"
                  aria-expanded={meetOpen}
                  onClick={() => {
                    setMeetOpen((o) => !o);
                    setShowDetails(false);
                  }}
                  className="mt-1.5 text-xs text-brand transition-colors hover:text-brand-hover"
                  title="The customer has agreed to a round figure: work out the discount that gets the bill there"
                >
                  Agree a price
                </button>
              )}
              {!quote && totals.totalPaise > 0 && (advanceApplied > 0 || receivedAll > 0) && (
                <div className="num mt-1 text-xs text-ink-muted">
                  {balanceDue > 0 ? <>Balance due {formatMoney(balanceDue)}</> : 'Paid in full'}
                </div>
              )}
              {meetOpen && (
                <div
                  role="group"
                  aria-label="Agree a price"
                  onKeyDown={(e) => e.key === 'Escape' && setMeetOpen(false)}
                  className="animate-pop-in absolute bottom-full left-0 mb-3 w-[26rem] space-y-3 rounded-lg border border-line bg-surface p-5 shadow-overlay"
                >
                  <div>
                    <p className="font-medium">The customer agreed to pay</p>
                    <p className="mt-0.5 text-xs text-ink-muted">The bill comes to {formatMoney(fullTotal)} now. Enter the figure they agreed, GST included, and the discount is worked out for you.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="w-36">
                      <MoneyInput autoFocus value={meetTarget} onChange={setMeetTarget} aria-label="Agreed price" className="h-9" />
                    </div>
                    {roundFigures(fullTotal).map((f) => (
                      <Chip key={f} onClick={() => setMeetTarget(f)} active={meetTarget === f}>
                        {formatMoney(f, { fractionDigits: 0 })}
                      </Chip>
                    ))}
                  </div>

                  {meetSafe && meetSafe.totalPaise < fullTotal && (
                    <button type="button" onClick={() => setMeetTarget(meetSafe.totalPaise)} className="text-xs text-brand transition-colors hover:text-brand-hover">
                      Lowest without a loss: {formatMoney(meetSafe.totalPaise)} — use it
                    </button>
                  )}

                  {meet && meetTarget > fullTotal && <p className="rounded-lg bg-status-partial-bg px-3 py-2 text-xs text-status-partial-fg">That is more than the bill ({formatMoney(fullTotal)}), so there is nothing to take off.</p>}
                  {meet && meetTarget <= fullTotal && (
                    <dl className="space-y-1.5 rounded-lg bg-canvas px-4 py-3">
                      <div className="flex justify-between">
                        <dt className="text-ink-muted">Discount on the bill</dt>
                        <dd className="num">
                          {formatMoney(meet.discountPaise)}
                          {billNet > 0 && <span className="text-ink-muted"> · {((meet.discountPaise / billNet) * 100).toFixed(1)}%</span>}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-ink-muted">New total</dt>
                        <dd className="num font-medium">{formatMoney(meet.totalPaise)}</dd>
                      </div>
                      {meet.totalPaise !== meetTarget && <p className="text-xs text-ink-muted">The nearest the bill can get to {formatMoney(meetTarget)} is {formatMoney(meet.totalPaise)}.</p>}
                      {canSeeCost && billWorth.known && !meetBelowCost && (
                        <div className="flex justify-between border-t border-line pt-1.5 text-xs text-ink-muted">
                          <dt>You still keep</dt>
                          <dd className="num">
                            {formatMoney(meetTaxable - billWorth.costPaise)}
                            {meetTaxable > 0 && ` · ${(((meetTaxable - billWorth.costPaise) / meetTaxable) * 100).toFixed(0)}%`}
                          </dd>
                        </div>
                      )}
                    </dl>
                  )}
                  {meetBelowCost && (
                    <div role="alert" className="rounded-lg bg-status-overdue-bg px-3 py-2 text-xs text-status-overdue-fg">
                      {canSeeCost ? `This is ${formatMoney(billWorth.costPaise - meetTaxable)} below what these pieces cost you.` : 'This is below what these pieces cost. Check with the owner before agreeing.'}
                    </div>
                  )}
                  {discount > 0 && meet && meetTarget <= fullTotal && <p className="text-xs text-ink-muted">This replaces the {formatMoney(discount)} discount already on the bill.</p>}

                  <div className="flex items-center justify-between gap-2">
                    {discount > 0 ? (
                      <button type="button" onClick={() => setDiscount(0)} className="text-xs text-ink-muted transition-colors hover:text-ink">
                        Remove the {formatMoney(discount)} discount
                      </button>
                    ) : (
                      <span />
                    )}
                    <span className="flex gap-2">
                      <Button onClick={() => setMeetOpen(false)}>Close</Button>
                      <Button
                        variant="primary"
                        disabled={!meet || meetTarget > fullTotal}
                        onClick={() => {
                          if (!meet) return;
                          setDiscount(meet.discountPaise);
                          setMeetOpen(false);
                          setMeetTarget(0);
                          toast.success(`Bill set to ${formatMoney(meet.totalPaise)}`);
                        }}
                      >
                        Apply
                      </Button>
                    </span>
                  </div>
                </div>
              )}
              {showDetails && (
                <div className="animate-pop-in absolute bottom-full left-0 mb-3 w-80 rounded-lg border border-line bg-surface p-5 shadow-overlay">
                  <dl className="space-y-2">
                    <div className="flex justify-between"><dt className="text-ink-muted">{inclusive ? 'Subtotal (incl. GST)' : 'Subtotal'}</dt><dd><Money paise={totals.subtotalPaise} /></dd></div>
                    {totals.lineDiscountPaise > 0 && <div className="flex justify-between"><dt className="text-ink-muted">Item discounts</dt><dd className="num">−{formatMoney(totals.lineDiscountPaise)}</dd></div>}
                    <div className="flex items-center justify-between gap-4">
                      <dt className="text-ink-muted">Discount on the bill</dt>
                      <dd className="w-32"><MoneyInput value={discount} onChange={setDiscount} aria-label="Discount" className="h-8" /></dd>
                    </div>
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
                    {totals.roundOffPaise !== 0 && <div className="flex justify-between text-ink-muted"><dt>Round off</dt><dd className="num">{totals.roundOffPaise < 0 ? '−' : '+'}{formatMoney(Math.abs(totals.roundOffPaise))}</dd></div>}
                  </dl>
                  <p className="mt-3 border-t border-line pt-3 text-xs text-ink-muted">
                    {placeOfSupply ? `Supply to ${placeOfSupply}` : 'Place of supply not set'} · {intraState ? 'CGST + SGST' : 'IGST'}
                  </p>
                </div>
              )}
            </div>

            {!quote && (
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
                {advanceHeld > 0 && (
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-status-partial-bg px-3 py-1.5 text-xs text-status-partial-fg" title="Any left over stays as their advance">
                    <input type="checkbox" checked={useAdvance} onChange={(e) => setUseAdvance(e.target.checked)} className="h-4 w-4 accent-[#0F6E56]" />
                    Use {formatMoney(advanceHeld)} advance
                  </label>
                )}
                <div role="group" aria-label="How the customer paid" className="inline-flex flex-wrap rounded-lg border border-line bg-surface p-0.5">
                  {PAY_CHIPS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      aria-pressed={payMode === c.value}
                      onClick={() => chooseMode(c.value)}
                      className={`flex h-8 items-center whitespace-nowrap rounded-[6px] px-3 text-sm transition-colors duration-150 ${payMode === c.value ? 'bg-brand-tint font-medium text-brand' : 'text-ink-muted hover:text-ink'}`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Button variant="primary" className="ml-auto h-11 px-6 text-base" loading={saving} disabled={!canSubmit} onClick={() => void submit()} title="Ctrl+Enter">
              {editing ? 'Save changes' : quote ? 'Create proforma' : 'Issue invoice'}
            </Button>
          </div>

          {!quote && payMode !== 'later' && (
            <div className="mt-3 max-h-[40vh] space-y-3 overflow-y-auto border-t border-line pt-3">
              <div className="grid grid-cols-[10rem_9rem_1fr_1fr_2rem] items-end gap-3">
                {extras.length === 0 ? (
                  <Choice label="How much was paid">
                    <Select
                      value={amountChoice}
                      aria-label="How much was paid"
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === 'full') {
                          setPayFull(true);
                          setReceived(maxReceivable);
                        } else if (v === 'half' || v === 'quarter') {
                          setPayFull(false);
                          setReceived(Math.round(maxReceivable / (v === 'half' ? 2 : 4)));
                        }
                      }}
                    >
                      <option value="full">All of it</option>
                      <option value="half">Half</option>
                      <option value="quarter">A quarter</option>
                      <option value="custom">Another amount</option>
                    </Select>
                  </Choice>
                ) : (
                  <Choice label="Part 1 paid by">
                    <div className="flex h-9 items-center text-sm">{PAYMENT_METHOD_LABEL[payMethod]}</div>
                  </Choice>
                )}
                <Choice label="Received">
                  <MoneyInput
                    value={received}
                    onChange={(p) => {
                      setPayFull(false);
                      setReceived(p);
                    }}
                    aria-label="Received now"
                    className="h-9"
                  />
                </Choice>
                <Choice label="Into account">
                  <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Into account">
                    <option value="">Not recorded</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </Choice>
                {payMode !== 'cash' ? (
                  <Choice label={payMode === 'cheque' ? 'Cheque number' : 'UTR / reference'}>
                    <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} aria-label="Payment reference" />
                  </Choice>
                ) : (
                  <span />
                )}
                <span />
              </div>
              {extras.map((e, i) => (
                <ExtraPayRow
                  key={e.id}
                  line={e}
                  index={i + 2}
                  accounts={accounts}
                  onChange={(patch) => setExtras((list) => list.map((x) => (x.id === e.id ? { ...x, ...patch } : x)))}
                  onRemove={() => setExtras((list) => list.filter((x) => x.id !== e.id))}
                />
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <button type="button" onClick={addSplit} disabled={extras.length >= 3 || maxReceivable <= 0} className="text-brand transition-colors hover:text-brand-hover disabled:text-ink-muted disabled:opacity-50">
                  + Split with another method
                </button>
                <span className="num text-ink-muted">
                  Received {formatMoney(receivedAll)} of {formatMoney(maxReceivable)}
                  {maxReceivable > receivedAll && ` · ${formatMoney(maxReceivable - receivedAll)} left to pay later`}
                  {extras.length > 0 && maxReceivable > receivedAll && (
                    <button type="button" onClick={() => setExtras((list) => list.map((x, i) => (i === list.length - 1 ? { ...x, amountPaise: x.amountPaise + (maxReceivable - receivedAll) } : x)))} className="ml-2 text-brand hover:text-brand-hover">
                      Put it on part {extras.length + 1}
                    </button>
                  )}
                </span>
              </div>
            </div>
          )}
        </div>
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
            setExtras([]);
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
            chooseCustomer(c);
            setCreating(null);
          }}
        />
      )}
    </>
  );
}
