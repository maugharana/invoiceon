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

export function computeTotals(input: { lineAmounts: Paise[]; discountPaise: Paise; ratePercent: number; intraState: boolean }): Totals {
  const subtotalPaise = input.lineAmounts.reduce((s, a) => s + a, 0);
  const discountPaise = Math.min(Math.max(input.discountPaise, 0), subtotalPaise);
  const taxablePaise = subtotalPaise - discountPaise;
  const taxPaise = Math.round((taxablePaise * input.ratePercent) / 100);
  // Intra-state supplies split the tax evenly between CGST and SGST; any odd paisa goes to SGST.
  const cgstPaise = input.intraState ? Math.floor(taxPaise / 2) : 0;
  const sgstPaise = input.intraState ? taxPaise - cgstPaise : 0;
  const igstPaise = input.intraState ? 0 : taxPaise;
  const raw = taxablePaise + taxPaise;
  const totalPaise = Math.round(raw / 100) * 100; // invoices total to the whole rupee
  return { subtotalPaise, discountPaise, taxablePaise, cgstPaise, sgstPaise, igstPaise, taxPaise, roundOffPaise: totalPaise - raw, totalPaise };
}

// ── Which rate applies to a piece ───────────────────────────────────────────
/** One step of a price based rate: pieces priced up to this much (before GST) are taxed at this rate. `null` means "and above". */
export interface GstSlab {
  upToPaise: Paise | null;
  ratePercent: number;
}

export interface RateRule {
  /** The shop's one rate, used when neither the design nor the price slabs say otherwise. */
  gstRatePercent: number;
  gstSlabsEnabled: boolean;
  gstSlabs: GstSlab[];
}

/**
 * The GST rate for one piece: the design's own rate if it has one, otherwise the price slab it falls in (when the shop uses
 * slabs), otherwise the shop's single rate. With no design rates and slabs off, every piece gets the shop rate, which is exactly
 * how the app behaved before rates could differ.
 */
export function resolveGstRate(rule: RateRule, designRatePercent: number | null | undefined, unitPricePaise: Paise): number {
  if (designRatePercent !== null && designRatePercent !== undefined) return designRatePercent;
  if (rule.gstSlabsEnabled && rule.gstSlabs.length > 0) {
    const slab = rule.gstSlabs.find((s) => s.upToPaise === null || unitPricePaise <= s.upToPaise) ?? rule.gstSlabs[rule.gstSlabs.length - 1]!;
    return slab.ratePercent;
  }
  return rule.gstRatePercent;
}

// ── Input tax credit ────────────────────────────────────────────────────────
export interface TaxHeads {
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
}

/**
 * Sets input tax credit off against output tax in the order the GST rules require: IGST credit first against IGST, then CGST, then
 * SGST; CGST credit against CGST, then IGST; SGST credit against SGST, then IGST (CGST and SGST credit never cross). What is left
 * of the tax is payable in cash; what is left of a credit is carried forward.
 */
export function setOffInputCredit(output: TaxHeads, credit: TaxHeads): { payable: TaxHeads; carryForward: TaxHeads } {
  const out = { c: output.cgstPaise, s: output.sgstPaise, i: output.igstPaise };
  const cr = { c: credit.cgstPaise, s: credit.sgstPaise, i: credit.igstPaise };
  const use = (from: 'c' | 's' | 'i', to: 'c' | 's' | 'i') => {
    const n = Math.min(cr[from], out[to]);
    cr[from] -= n;
    out[to] -= n;
  };
  use('i', 'i'); use('i', 'c'); use('i', 's');
  use('c', 'c'); use('c', 'i');
  use('s', 's'); use('s', 'i');
  return { payable: { cgstPaise: out.c, sgstPaise: out.s, igstPaise: out.i }, carryForward: { cgstPaise: cr.c, sgstPaise: cr.s, igstPaise: cr.i } };
}

// ── Several rates on one document ───────────────────────────────────────────
/** The tax on one rate's share of a document. */
export interface RateGroup {
  ratePercent: number;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
}

export interface RateTotals {
  groups: RateGroup[];
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  taxPaise: Paise;
  roundOffPaise: Paise;
  totalPaise: Paise;
}

/**
 * Tax on amounts that are already net of any discount, worked out once per rate (so a document with 5% and 18% pieces shows
 * one tax row for each), then rounded to the whole rupee. With a single rate this gives exactly what `computeTotals` gives.
 */
export function taxByRate(items: { taxablePaise: Paise; ratePercent: number }[], intraState: boolean): RateTotals {
  const byRate = new Map<number, number>();
  for (const i of items) byRate.set(i.ratePercent, (byRate.get(i.ratePercent) ?? 0) + i.taxablePaise);
  const groups = [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ratePercent, taxablePaise]): RateGroup => {
      const tax = Math.round((taxablePaise * ratePercent) / 100);
      const cgstPaise = intraState ? Math.floor(tax / 2) : 0;
      return { ratePercent, taxablePaise, cgstPaise, sgstPaise: intraState ? tax - cgstPaise : 0, igstPaise: intraState ? 0 : tax };
    });
  const sum = (f: (g: RateGroup) => number) => groups.reduce((s, g) => s + f(g), 0);
  const taxablePaise = sum((g) => g.taxablePaise);
  const cgstPaise = sum((g) => g.cgstPaise);
  const sgstPaise = sum((g) => g.sgstPaise);
  const igstPaise = sum((g) => g.igstPaise);
  const taxPaise = cgstPaise + sgstPaise + igstPaise;
  const raw = taxablePaise + taxPaise;
  const totalPaise = Math.round(raw / 100) * 100;
  return { groups, taxablePaise, cgstPaise, sgstPaise, igstPaise, taxPaise, roundOffPaise: totalPaise - raw, totalPaise };
}

export interface MultiTotals extends Totals {
  groups: RateGroup[];
  /** Each line's amount after its share of the discount, in the order the lines were given. */
  lineTaxablePaise: Paise[];
}

/** Like `computeTotals`, but every line carries its own GST rate. The discount is spread over the lines in proportion to their value. */
export function computeTotalsMulti(input: { lines: { amountPaise: Paise; ratePercent: number }[]; discountPaise: Paise; intraState: boolean }): MultiTotals {
  const amounts = input.lines.map((l) => l.amountPaise);
  const subtotalPaise = amounts.reduce((s, a) => s + a, 0);
  const discountPaise = Math.min(Math.max(input.discountPaise, 0), subtotalPaise);
  const shares = allocate(discountPaise, amounts);
  const lineTaxablePaise = amounts.map((a, i) => a - shares[i]!);
  const t = taxByRate(lineTaxablePaise.map((taxablePaise, i) => ({ taxablePaise, ratePercent: input.lines[i]!.ratePercent })), input.intraState);
  return {
    subtotalPaise,
    discountPaise,
    taxablePaise: t.taxablePaise,
    cgstPaise: t.cgstPaise,
    sgstPaise: t.sgstPaise,
    igstPaise: t.igstPaise,
    taxPaise: t.taxPaise,
    roundOffPaise: t.roundOffPaise,
    totalPaise: t.totalPaise,
    groups: t.groups,
    lineTaxablePaise,
  };
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

export const isIsoDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
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
