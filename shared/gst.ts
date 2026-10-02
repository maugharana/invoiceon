import type { Paise } from './money';

// ── Totals ──────────────────────────────────────────────────────────────────
// One implementation, used by the server when an invoice is issued and by the UI for the live preview,
// so the number on screen while typing is always the number that gets saved.

export interface Totals {
  subtotalPaise: Paise;
  /** What was taken off individual lines (before any discount on the whole invoice). */
  lineDiscountPaise: Paise;
  /** The discount on the whole invoice. */
  discountPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  taxPaise: Paise;
  roundOffPaise: Paise;
  totalPaise: Paise;
}

/** How the grand total is brought to a round figure: the nearest rupee, always up, always down, or not at all (exact paise). */
export type RoundOff = 'nearest' | 'up' | 'down' | 'none';
export const ROUND_OFF_LABEL: Record<RoundOff, string> = { nearest: 'Nearest rupee', up: 'Up to the next rupee', down: 'Down to the rupee', none: 'No rounding (exact paise)' };

export function roundTotal(rawPaise: Paise, policy: RoundOff = 'nearest'): Paise {
  switch (policy) {
    case 'up':
      return Math.ceil(rawPaise / 100) * 100;
    case 'down':
      return Math.floor(rawPaise / 100) * 100;
    case 'none':
      return rawPaise;
    default:
      return Math.round(rawPaise / 100) * 100;
  }
}

export interface PricedLine {
  /** Quantity × price, before any discount. */
  amountPaise: Paise;
  /** Taken off this line only. */
  discountPaise?: Paise;
  ratePercent: number;
}

/** What one line works out to after the invoice-level discount is spread over it. Adds up exactly to the invoice. */
export interface LineTax {
  /** What the customer pays for it: the line less its own discount and its share of the invoice discount. Includes GST when prices do. */
  payablePaise: Paise;
  taxablePaise: Paise;
  taxPaise: Paise;
}

/** One GST rate's share of an invoice, as the tax summary and the GST returns want it. */
export interface RateGroup {
  ratePercent: number;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  taxPaise: Paise;
}

export interface InvoiceTotals extends Totals {
  lines: LineTax[];
  /** One entry per distinct rate, lowest first. */
  byRate: RateGroup[];
}

/** Intra-state supplies split the tax evenly between CGST and SGST; any odd paisa goes to SGST. */
export function splitTax(taxPaise: Paise, intraState: boolean): { cgstPaise: Paise; sgstPaise: Paise; igstPaise: Paise } {
  const cgstPaise = intraState ? Math.floor(taxPaise / 2) : 0;
  return { cgstPaise, sgstPaise: intraState ? taxPaise - cgstPaise : 0, igstPaise: intraState ? 0 : taxPaise };
}

/**
 * Works out an invoice. Each line may have its own discount and its own GST rate. The invoice-level discount is spread over
 * the lines by value, then the tax is worked out once for each rate (not once per line, so a one-rate invoice comes to exactly
 * what it always did) and shared back to the lines to the exact paisa.
 *
 * `inclusive` means the prices already contain GST: the subtotal and discounts are tax-inclusive, the tax is carved out of
 * what's left (₹1,000 at 5% → ₹952.38 + ₹47.62). Otherwise tax is added on top.
 */
export function computeInvoice(input: { lines: PricedLine[]; discountPaise: Paise; intraState: boolean; inclusive?: boolean; roundOff?: RoundOff }): InvoiceTotals {
  const gross = input.lines.map((l) => l.amountPaise);
  const ownDiscount = input.lines.map((l) => Math.min(Math.max(l.discountPaise ?? 0, 0), l.amountPaise));
  const net = gross.map((g, i) => g - ownDiscount[i]!);
  const subtotalPaise = gross.reduce((s, a) => s + a, 0);
  const lineDiscountPaise = ownDiscount.reduce((s, a) => s + a, 0);
  const netTotal = subtotalPaise - lineDiscountPaise;
  const discountPaise = Math.min(Math.max(input.discountPaise, 0), netTotal);
  const shares = allocate(discountPaise, net);
  const payable = net.map((n, i) => n - shares[i]!);

  const rates = [...new Set(input.lines.map((l) => l.ratePercent))].sort((a, b) => a - b);
  const lines: LineTax[] = payable.map((p) => ({ payablePaise: p, taxablePaise: 0, taxPaise: 0 }));
  const byRate: RateGroup[] = [];
  for (const rate of rates) {
    const idx = input.lines.map((l, i) => (l.ratePercent === rate ? i : -1)).filter((i) => i >= 0);
    const groupPayable = idx.reduce((s, i) => s + payable[i]!, 0);
    const taxable = input.inclusive ? Math.round((groupPayable * 100) / (100 + rate)) : groupPayable;
    const tax = input.inclusive ? groupPayable - taxable : Math.round((taxable * rate) / 100);
    const weights = idx.map((i) => payable[i]!);
    const taxableParts = allocate(taxable, weights);
    const taxParts = allocate(tax, weights);
    idx.forEach((lineIndex, k) => {
      lines[lineIndex]!.taxablePaise = taxableParts[k]!;
      lines[lineIndex]!.taxPaise = taxParts[k]!;
    });
    byRate.push({ ratePercent: rate, taxablePaise: taxable, taxPaise: tax, ...splitTax(tax, input.intraState) });
  }

  const sum = (f: (g: RateGroup) => number) => byRate.reduce((s, g) => s + f(g), 0);
  const taxablePaise = sum((g) => g.taxablePaise);
  const taxPaise = sum((g) => g.taxPaise);
  const raw = taxablePaise + taxPaise;
  const totalPaise = roundTotal(raw, input.roundOff);
  return {
    subtotalPaise,
    lineDiscountPaise,
    discountPaise,
    taxablePaise,
    cgstPaise: sum((g) => g.cgstPaise),
    sgstPaise: sum((g) => g.sgstPaise),
    igstPaise: sum((g) => g.igstPaise),
    taxPaise,
    roundOffPaise: totalPaise - raw,
    totalPaise,
    lines,
    byRate,
  };
}

/** The simple case: every line at one rate, no line discounts. */
export function computeTotals(input: { lineAmounts: Paise[]; discountPaise: Paise; ratePercent: number; intraState: boolean; inclusive?: boolean; roundOff?: RoundOff }): Totals {
  const { lines: _lines, byRate: _byRate, ...totals } = computeInvoice({
    lines: input.lineAmounts.map((amountPaise) => ({ amountPaise, ratePercent: input.ratePercent })),
    discountPaise: input.discountPaise,
    intraState: input.intraState,
    inclusive: input.inclusive,
    roundOff: input.roundOff,
  });
  return totals;
}

// ── Which rate a line gets ──────────────────────────────────────────────────
/** Pieces priced up to this much (per piece, after any discount) are charged this rate. */
export interface RateSlab {
  upToPaise: Paise;
  ratePercent: number;
}

/**
 * The GST rate for a line. In order: a rate typed on the line, then a rate set on the design, then a price slab (sarees, for
 * instance, are often taxed at one rate up to a price per piece and another above it), then the shop's usual rate. The slab test
 * uses what one piece sells for after the line's discount, as entered (so with GST-inclusive prices, set the limits inclusive too).
 */
export function resolveRate(
  line: { override?: number | null; designRate?: number | null; qty: number; netPaise: Paise },
  shop: { gstRatePercent: number; rateSlabs: RateSlab[] },
): number {
  if (line.override !== undefined && line.override !== null) return line.override;
  if (line.designRate !== undefined && line.designRate !== null) return line.designRate;
  for (const slab of [...shop.rateSlabs].sort((a, b) => a.upToPaise - b.upToPaise)) {
    if (line.netPaise <= slab.upToPaise * Math.max(line.qty, 1)) return slab.ratePercent;
  }
  return shop.gstRatePercent;
}

/** A GST rate someone typed: a number from 0 to 100 with at most two decimals. */
export const isValidRate = (r: unknown): r is number => typeof r === 'number' && Number.isFinite(r) && r >= 0 && r <= 100 && Math.round(r * 100) / 100 === r;

/**
 * Splits `total` across `weights` in proportion, in whole paise, so the parts always add back to exactly `total`
 * (largest-remainder). Used to spread an invoice's discount and tax over its lines for HSN and profit reporting.
 * BigInt for the multiply: paise × paise overflows a double long before it overflows a real invoice.
 */
export function allocate(total: Paise, weights: Paise[]): Paise[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const T = BigInt(total);
  const S = BigInt(sum);
  const parts = weights.map((w, i) => ({ i, base: Number((T * BigInt(w)) / S), rem: Number((T * BigInt(w)) % S) }));
  let left = total - parts.reduce((a, p) => a + p.base, 0);
  for (const p of [...parts].sort((a, b) => b.rem - a.rem || a.i - b.i)) {
    if (left <= 0) break;
    p.base += 1;
    left -= 1;
  }
  return parts.map((p) => p.base);
}

// ── GSTIN ───────────────────────────────────────────────────────────────────
const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Format check plus the official mod-36 check character. */
export function isValidGstin(input: string): boolean {
  const gstin = input.trim().toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(gstin[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === gstin[14];
}

// ── Financial year & numbering ──────────────────────────────────────────────
/** Indian FY runs April–March: 2026-09-29 → "2026-27". */
export function financialYear(isoDate: string): string {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export const formatInvoiceNumber = (prefix: string, fy: string, seq: number): string => `${prefix}/${fy}/${String(seq).padStart(4, '0')}`;

// ── Dates (local calendar dates as YYYY-MM-DD) ──────────────────────────────
export function todayIso(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** The local calendar date of a stored UTC timestamp (so 1 a.m. on the 30th in India stays the 30th). */
export const localDateOf = (isoTimestamp: string): string => todayIso(new Date(isoTimestamp));

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return todayIso(new Date(y, m - 1, d + days));
}

/** A real calendar date written YYYY-MM-DD. "2026-02-29" and "2026-04-31" are not: the engine would quietly roll them into the next month. */
export const isIsoDate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
};

// How dates are written. It is a setting (Preferences), applied once when the app loads, so every screen and printout agrees.
let dateFormat: 'short' | 'slash' | 'iso' = 'short';
export function setDateFormat(f: 'short' | 'slash' | 'iso'): void {
  dateFormat = f;
}

export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  if (dateFormat === 'iso') return isoDate;
  if (dateFormat === 'slash') return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Status ──────────────────────────────────────────────────────────────────
export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'overdue' | 'cancelled';

export function invoiceStatus(i: { cancelled: boolean; totalPaise: Paise; paidPaise: Paise; dueDate: string | null; today: string }): InvoiceStatus {
  if (i.cancelled) return 'cancelled';
  if (i.paidPaise >= i.totalPaise) return 'paid';
  if (i.dueDate && i.dueDate < i.today) return 'overdue';
  return i.paidPaise > 0 ? 'partial' : 'unpaid';
}

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  unpaid: 'Unpaid',
  partial: 'Partly paid',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
};

// ── Amount in words (Indian numbering) ──────────────────────────────────────
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) parts.push(TENS[Math.floor(n / 10)]! + (n % 10 ? ` ${ONES[n % 10]}` : ''));
  else if (n > 0) parts.push(ONES[n]!);
  return parts.join(' ');
}

export function rupeesInWords(paise: Paise): string {
  const rupees = Math.floor(Math.abs(paise) / 100);
  const ps = Math.abs(paise) % 100;
  const units: [number, string][] = [[10_000_000, 'Crore'], [100_000, 'Lakh'], [1000, 'Thousand']];
  let rest = rupees;
  const words: string[] = [];
  for (const [size, label] of units) {
    if (rest >= size) {
      words.push(`${below1000(Math.floor(rest / size))} ${label}`);
      rest %= size;
    }
  }
  if (rest > 0) words.push(below1000(rest));
  const rupeeText = words.length ? words.join(' ') : 'Zero';
  return `Rupees ${rupeeText}${ps ? ` and ${below1000(ps)} Paise` : ''} Only`;
}
