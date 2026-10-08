import { Check, ChevronDown, MoreHorizontal, Minus, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { moneyToInput, parseMoney } from '../../../shared/money';
import { suggestAccount } from '../../../shared/accountChoice';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentAccount, type PaymentMethod, type SaleVariant } from '../../../shared/types';
import { Button, Input, MoneyInput, Select } from '../../components/ui';
import { toNumber } from '../../lib/format';

// Small parts of the invoice screen: how many, how much off, and the details of one item. Each keeps its own typing and reports
// finished values upward, so the page itself only deals in numbers.

/** Discounts a shop gives most often, so they are one pick instead of a typed figure. */
export const DISCOUNT_STEPS = [5, 10, 15, 20, 25, 30, 40, 50];
/** The GST rates sarees and fabric are charged at. A rate typed or saved that is not here still shows up in the list. */
export const GST_RATES = ['0', '5', '12', '18', '28'];
/** Short notes that are printed under an item, as often as not the same few. */
export const ITEM_NOTES = ['Matching blouse piece included', 'Fall and pico done', 'Blouse stitching extra', 'Gift wrapped', 'Dry clean only'];
/** Standard lines for the bottom of an invoice. */
export const BILL_NOTES = ['Thank you for shopping with us.', 'Exchange within 7 days with the tag intact.', 'Goods once sold will not be taken back.', 'Dry clean only.', 'Handloom: slight irregularities are the mark of the weave.'];
/** Days from the invoice date, for the due-date list. */
export const DUE_DAYS = [0, 7, 15, 30, 45, 60];

/** The cover photo of a design, small; a tinted tile with its first letter when it has none yet. */
export function DesignThumb({ src, name, size = 40 }: { src?: string; name: string; size?: number }) {
  const box = { width: size, height: size };
  return src ? (
    <img src={src} alt="" style={box} className="shrink-0 rounded-lg border border-line object-cover" />
  ) : (
    <span aria-hidden style={{ ...box, fontSize: Math.max(10, Math.round(size * 0.4)) }} className="flex shrink-0 items-center justify-center rounded-lg bg-brand-tint text-brand">
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** − 2 + : the quantity as a stepper you can also type into. The value stays text so a half-typed number is never rewritten. */
export function QtyStepper({ value, onChange, label, invalid }: { value: string; onChange: (v: string) => void; label: string; invalid?: boolean }) {
  const n = toNumber(value);
  const step = (by: number) => onChange(String(Math.max(1, (Number.isFinite(n) ? n : 0) + by)));
  const btn = 'flex h-8 w-8 items-center justify-center text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent';
  return (
    <div className={`inline-flex items-center overflow-hidden rounded-lg border bg-surface ${invalid ? 'border-status-overdue-fg' : 'border-line'}`}>
      <button type="button" className={btn} aria-label={`One fewer, ${label}`} disabled={!(n > 1)} onClick={() => step(-1)}>
        <Minus className="h-3.5 w-3.5" aria-hidden />
      </button>
      <input
        value={value}
        inputMode="numeric"
        aria-label={`Quantity, ${label}`}
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
        className="num h-8 w-11 border-x border-line bg-transparent text-center text-sm focus:outline-none"
      />
      <button type="button" className={btn} aria-label={`One more, ${label}`} onClick={() => step(1)}>
        <Plus className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

/**
 * A discount typed as rupees ("500") or as a share of the line ("10%"). A percentage is turned into rupees on the line as it stands
 * when it is typed, so what is saved is always a plain amount.
 */
export function AmountOrPercentInput({ valuePaise, basePaise, onChange, label, autoFocus }: { valuePaise: number; basePaise: number; onChange: (paise: number) => void; label: string; autoFocus?: boolean }) {
  const toPaise = (t: string): number | null => {
    const s = t.trim();
    if (s === '') return 0;
    if (s.endsWith('%')) {
      const pct = Number(s.slice(0, -1).trim());
      return Number.isFinite(pct) && pct >= 0 && pct <= 100 ? Math.round((basePaise * pct) / 100) : null;
    }
    return parseMoney(s);
  };
  const [text, setText] = useState(() => moneyToInput(valuePaise));
  useEffect(() => {
    // Typed as a percentage, the box keeps what was typed; otherwise it follows the value.
    if (!text.trim().endsWith('%') && (toPaise(text) ?? -1) !== valuePaise) setText(moneyToInput(valuePaise));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuePaise]);
  const invalid = text.trim() !== '' && toPaise(text) === null;
  return (
    <Input
      value={text}
      autoFocus={autoFocus}
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid}
      placeholder="₹ or %  e.g. 500 or 10%"
      onChange={(e) => {
        setText(e.target.value);
        const p = toPaise(e.target.value);
        if (p !== null) onChange(p);
      }}
      className="num"
    />
  );
}

/** The ⋯ on an item row: its own discount, GST rate and note, in a small popover so no wide extra row is needed. */
export function ItemDetails({
  label,
  basePaise,
  discountPaise,
  onDiscount,
  rate,
  onRate,
  rateValid,
  autoRate,
  note,
  onNote,
}: {
  label: string;
  basePaise: number;
  discountPaise: number;
  onDiscount: (paise: number) => void;
  rate: string;
  onRate: (v: string) => void;
  rateValid: boolean;
  autoRate: number;
  note: string;
  onNote: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  const has = discountPaise > 0 || rate !== '' || note !== '';
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={`Discount, GST and note for ${label}`}
        aria-expanded={open}
        title="Discount, GST rate, note"
        onClick={() => setOpen((o) => !o)}
        className={`relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${open ? 'bg-ink/5 text-ink' : 'text-ink-muted hover:bg-ink/5 hover:text-ink'}`}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
        {has && <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-brand" />}
      </button>
      {open && (
        <div role="group" aria-label={`Details for ${label}`} className="animate-pop-in absolute right-0 z-30 mt-1.5 w-72 space-y-3 rounded-lg border border-line bg-surface p-4 shadow-overlay">
          <label className="block text-xs text-ink-muted">
            <span className="mb-1 block font-medium">Exact discount (₹ or %)</span>
            <AmountOrPercentInput valuePaise={discountPaise} basePaise={basePaise} onChange={onDiscount} label={`Discount on ${label}`} autoFocus />
          </label>
          <label className="block text-xs text-ink-muted">
            <span className="mb-1 block font-medium">GST rate</span>
            <Select value={rate} onChange={(e) => onRate(e.target.value)} aria-label={`GST rate on ${label}`} aria-invalid={!rateValid}>
              <option value="">Automatic · {autoRate}%</option>
              {[...new Set([...GST_RATES, ...(rate !== '' && !GST_RATES.includes(rate) ? [rate] : [])])].map((r) => (
                <option key={r} value={r}>
                  {r}%
                </option>
              ))}
            </Select>
          </label>
          <label className="block text-xs text-ink-muted">
            <span className="mb-1 block font-medium">Note printed under the item</span>
            <Select
              value=""
              onChange={(e) => e.target.value && onNote(e.target.value)}
              aria-label={`Standard note for ${label}`}
            >
              <option value="">Pick a standard note…</option>
              {ITEM_NOTES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
            <Input value={note} onChange={(e) => onNote(e.target.value.slice(0, 120))} aria-label={`Note on ${label}`} placeholder="…or write your own" className="mt-1.5" />
          </label>
          <div className="flex justify-end">
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-sm text-brand transition-colors hover:bg-brand-tint">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The discount on an item as a pick: none, or one of the usual percentages. It works from the line's own price and quantity, so it
 * stays the right share if either changes. A discount typed in the ⋯ box that matches none of them shows as "Custom".
 */
export function DiscountSelect({ amountPaise, discountPaise, pct, onPick, label }: { amountPaise: number; discountPaise: number; pct: number | null; onPick: (pct: number | null) => void; label: string }) {
  const matched = pct ?? DISCOUNT_STEPS.find((p) => Math.round((amountPaise * p) / 100) === discountPaise);
  const value = discountPaise === 0 && pct === null ? 'none' : matched !== undefined ? String(matched) : 'custom';
  return (
    <Select
      value={value}
      aria-label={`Discount on ${label}`}
      onChange={(e) => (e.target.value === 'none' ? onPick(null) : e.target.value !== 'custom' ? onPick(Number(e.target.value)) : undefined)}
      className="h-8 w-24 pl-2 pr-7 text-xs"
    >
      <option value="none">No discount</option>
      {DISCOUNT_STEPS.map((p) => (
        <option key={p} value={p}>
          {p}% off
        </option>
      ))}
      {value === 'custom' && <option value="custom">Custom</option>}
    </Select>
  );
}

/** A small label above a control, for the rows of choices around the bill. */
export function Choice({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs font-medium text-ink-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}

/**
 * Choosing a piece without typing: design, then colour, then size, then how many. Each list only holds what the one before leaves, and
 * a list with a single choice fills itself in. Pieces with nothing in stock are shown but cannot be picked (unless a quote allows it).
 */
export function BrowseAdd({ variants, onAdd, covers = {}, allowOutOfStock = false, focusDesign }: { variants: SaleVariant[]; onAdd: (v: SaleVariant, qty: number) => void; covers?: Record<string, string>; allowOutOfStock?: boolean; /** Choose this design, as if picked from the list. Pick the same one again by changing `n`. */ focusDesign?: { id: string; n: number } }) {
  const [designId, setDesignId] = useState('');
  const [color, setColor] = useState('');
  const [size, setSize] = useState('');
  const [qty, setQty] = useState('1');

  const designs = (() => {
    const m = new Map<string, { id: string; name: string; stock: number }>();
    for (const v of variants) {
      const d = m.get(v.designId) ?? { id: v.designId, name: v.designName, stock: 0 };
      d.stock += Math.max(0, v.stock);
      m.set(v.designId, d);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  })();
  const ofDesign = variants.filter((v) => v.designId === designId);
  const colors = [...new Set(ofDesign.map((v) => v.color))];
  const sizes = [...new Set(ofDesign.filter((v) => v.color === color).map((v) => v.size))];
  const chosen = ofDesign.find((v) => v.color === color && v.size === size) ?? null;
  const sellable = !!chosen && (chosen.stock > 0 || allowOutOfStock);

  // Told from outside (a design the customer asked for): the same as choosing it from the list.
  const focusKey = focusDesign?.n;
  useEffect(() => {
    if (focusDesign && variants.some((v) => v.designId === focusDesign.id)) pickDesign(focusDesign.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  function pickDesign(id: string) {
    setDesignId(id);
    const mine = variants.filter((v) => v.designId === id);
    const cs = [...new Set(mine.map((v) => v.color))];
    const nextColor = cs.length === 1 ? cs[0]! : '';
    setColor(nextColor);
    const ss = [...new Set(mine.filter((v) => v.color === nextColor).map((v) => v.size))];
    setSize(nextColor && ss.length === 1 ? ss[0]! : '');
  }
  function pickColor(c: string) {
    setColor(c);
    const ss = [...new Set(ofDesign.filter((v) => v.color === c).map((v) => v.size))];
    setSize(ss.length === 1 ? ss[0]! : '');
  }
  function add() {
    if (!chosen || !sellable) return;
    onAdd(chosen, Math.max(1, Number(qty) || 1));
    // The design stays, so another colour of it is two picks away.
    setColor('');
    setSize('');
    setQty('1');
  }

  return (
    <div className="grid grid-cols-[1.6fr_1fr_1fr_5.5rem_auto] items-end gap-3">
      <div>
        <span className="mb-1.5 block text-xs font-medium text-ink-muted">Design</span>
        <DesignSelect designs={designs} value={designId} onChange={pickDesign} covers={covers} />
      </div>
      <Choice label="Colour">
        <Select value={color} onChange={(e) => pickColor(e.target.value)} disabled={!designId} aria-label="Colour">
          <option value="">{designId ? 'Choose…' : '—'}</option>
          {colors.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </Choice>
      <Choice label="Size">
        <Select value={size} onChange={(e) => setSize(e.target.value)} disabled={!color} aria-label="Size">
          <option value="">{color ? 'Choose…' : '—'}</option>
          {sizes.map((z) => {
            const v = ofDesign.find((x) => x.color === color && x.size === z);
            const out = !!v && v.stock <= 0 && !allowOutOfStock;
            return (
              <option key={z} value={z} disabled={out}>
                {z}
                {v ? ` · ${v.stock > 0 ? `${v.stock} left` : 'out'}` : ''}
              </option>
            );
          })}
        </Select>
      </Choice>
      <Choice label="How many">
        <Select value={qty} onChange={(e) => setQty(e.target.value)} aria-label="How many">
          {[1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </Choice>
      <Button variant="primary" disabled={!sellable} onClick={add} icon={<Plus className="h-4 w-4" />}>
        Add
      </Button>
    </div>
  );
}

/** A pill to tap instead of typing: a recent customer, a piece they bought before. */
export function Chip({ children, onClick, active, title }: { children: ReactNode; onClick?: () => void; active?: boolean; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      disabled={!onClick}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 transition-colors duration-150 ${active ? 'border-brand/30 bg-brand-tint text-brand' : 'border-line bg-surface text-ink hover:border-brand/40 hover:text-brand'}`}
    >
      {children}
    </button>
  );
}

/** "1  Who is it for?" — the numbered heading of a step on the invoice screen. */
export function StepTitle({ n, title }: { n: number; title: string }) {
  return (
    <h2 className="flex items-center gap-2.5 text-base">
      <span aria-hidden className="num flex h-6 w-6 items-center justify-center rounded-full bg-brand-tint text-xs text-brand">
        {n}
      </span>
      {title}
    </h2>
  );
}

/**
 * The design list with a photo beside each name. A plain drop-down can't show pictures, so this is a button that opens a list
 * (arrow keys and Enter work, Escape closes). A design with no photo yet shows its first letter.
 */
export function DesignSelect({ designs, value, onChange, covers }: { designs: { id: string; name: string; stock: number }[]; value: string; onChange: (id: string) => void; covers: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const picked = designs.find((d) => d.id === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
  };
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label="Design"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setActive(Math.max(0, designs.findIndex((d) => d.id === value)));
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) {
              setActive(Math.max(0, designs.findIndex((d) => d.id === value)));
              setOpen(true);
            } else setActive((a) => Math.min(designs.length - 1, Math.max(0, a + (e.key === 'ArrowDown' ? 1 : -1))));
          } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            const d = designs[active];
            if (d) choose(d.id);
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        className="flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-surface px-2 text-left text-sm transition-[border-color,box-shadow] duration-150 hover:border-ink/25 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15"
      >
        {picked ? (
          <>
            <DesignThumb src={covers[picked.id]} name={picked.name} size={24} />
            <span className="min-w-0 flex-1 truncate">{picked.name}</span>
          </>
        ) : (
          <span className="flex-1 pl-1 text-ink-muted/60">Choose a design…</span>
        )}
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
      </button>
      {open && (
        <ul role="listbox" aria-label="Designs" className="animate-pop-in absolute z-30 mt-1.5 max-h-80 w-[22rem] overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-overlay">
          {designs.map((d, i) => (
            <li key={d.id} role="option" aria-selected={d.id === value}>
              <button
                type="button"
                onClick={() => choose(d.id)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left ${i === active ? 'bg-brand-tint' : ''}`}
              >
                <DesignThumb src={covers[d.id]} name={d.name} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{d.name}</span>
                  <span className={`num block text-xs ${d.stock > 0 ? 'text-ink-muted' : 'text-status-overdue-fg'}`}>{d.stock > 0 ? `${d.stock} in stock` : 'Out of stock'}</span>
                </span>
                {d.id === value && <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden />}
              </button>
            </li>
          ))}
          {designs.length === 0 && <li className="px-3 py-2 text-ink-muted">No designs yet.</li>}
        </ul>
      )}
    </div>
  );
}

/** One more part of a payment made in parts: by its own method, into its own account. */
export interface ExtraPay {
  id: string;
  method: PaymentMethod;
  amountPaise: number;
  reference: string;
  accountId: string;
}

/** A row for one extra part of a split payment. Changing the method moves the account to the one that usually goes with it. */
export function ExtraPayRow({ line, index, accounts, onChange, onRemove }: { line: ExtraPay; index: number; accounts: PaymentAccount[]; onChange: (patch: Partial<ExtraPay>) => void; onRemove: () => void }) {
  return (
    <div className="grid grid-cols-[10rem_9rem_1fr_1fr_2rem] items-end gap-3">
      <Choice label={`Part ${index} paid by`}>
        <Select value={line.method} onChange={(e) => onChange({ method: e.target.value as PaymentMethod, accountId: suggestAccount(e.target.value as PaymentMethod, accounts) })} aria-label={`Method of part ${index}`}>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABEL[m]}
            </option>
          ))}
        </Select>
      </Choice>
      <Choice label="Received">
        <MoneyInput value={line.amountPaise} onChange={(p) => onChange({ amountPaise: p })} aria-label={`Amount of part ${index}`} className="h-9" />
      </Choice>
      <Choice label="Into account">
        <Select value={line.accountId} onChange={(e) => onChange({ accountId: e.target.value })} aria-label={`Account of part ${index}`}>
          <option value="">Not recorded</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Choice>
      {line.method !== 'cash' ? (
        <Choice label={line.method === 'cheque' ? 'Cheque number' : 'UTR / reference'}>
          <Input value={line.reference} onChange={(e) => onChange({ reference: e.target.value })} aria-label={`Reference of part ${index}`} />
        </Choice>
      ) : (
        <span />
      )}
      <button type="button" aria-label={`Remove part ${index}`} onClick={onRemove} className="flex h-9 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
