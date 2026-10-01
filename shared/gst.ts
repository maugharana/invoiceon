import type { Paise } from './money';

// ── Totals ──────────────────────────────────────────────────────────────────
// One implementation, used by the server when an invoice is issued and by the UI for the live preview,
// so the number on screen while typing is always the number that gets saved.

export interface Totals {
  subtotalPaise: Paise;
  discountPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  taxPaise: Paise;
  roundOffPaise: Paise;
  totalPaise: Paise;
}

/**
 * `inclusive` means the prices already contain GST: the subtotal and discount are tax-inclusive, the tax is carved out of
 * what's left (₹1,000 at 5% → ₹952.38 + ₹47.62) and the total is that same amount. Otherwise tax is added on top.
 */
export function computeTotals(input: { lineAmounts: Paise[]; discountPaise: Paise; ratePercent: number; intraState: boolean; inclusive?: boolean }): Totals {
  const subtotalPaise = input.lineAmounts.reduce((s, a) => s + a, 0);
  const discountPaise = Math.min(Math.max(input.discountPaise, 0), subtotalPaise);
  const payable = subtotalPaise - discountPaise;
  const taxablePaise = input.inclusive ? Math.round((payable * 100) / (100 + input.ratePercent)) : payable;
  const taxPaise = input.inclusive ? payable - taxablePaise : Math.round((taxablePaise * input.ratePercent) / 100);
  // Intra-state supplies split the tax evenly between CGST and SGST; any odd paisa goes to SGST.
  const cgstPaise = input.intraState ? Math.floor(taxPaise / 2) : 0;
  const sgstPaise = input.intraState ? taxPaise - cgstPaise : 0;
  const igstPaise = input.intraState ? 0 : taxPaise;
  const raw = taxablePaise + taxPaise;
  const totalPaise = Math.round(raw / 100) * 100; // invoices total to the whole rupee
  return { subtotalPaise, discountPaise, taxablePaise, cgstPaise, sgstPaise, igstPaise, taxPaise, roundOffPaise: totalPaise - raw, totalPaise };
}

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
