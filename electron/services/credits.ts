import { allocate, financialYear, formatInvoiceNumber, isIsoDate, roundTotal, splitTax, todayIso, type RateGroup } from '../../shared/gst';
import { matchesAll } from '../../shared/search';
import type { CreditNote, CreditNoteInput, CreditNoteLine, CreditNotePreview, CreditNoteQuery, CreditNoteSummary, InvoiceType, Party, ReturnableLine } from '../../shared/types';
import { PAYMENT_METHODS } from '../../shared/types';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, isUniqueViolation, newId, nowIso, requireText } from './common';
import { recordMovement } from './inventory';
import { onReturn } from './loyalty';
import { brandingOf } from './invoices';
import { paidFor, recordPaymentTx } from './payments';
import { getSettings } from './settings';

// A credit note is the document that takes goods back (or corrects what was charged). Like an invoice it is never edited:
// it reverses part of one invoice, to the exact paisa, and what it is worth is settled by reducing what is owed on that invoice,
// by refunding money already paid, or by holding it as credit for the customer's next purchase.

interface InvoiceRow {
  id: string;
  number: string;
  type: InvoiceType;
  customer_id: string | null;
  seller_json: string;
  buyer_json: string;
  place_of_supply: string;
  issue_date: string;
  gst_rate_percent: number;
  prices_include_gst: number;
  intra_state: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  status: 'issued' | 'cancelled';
}

interface InvoiceLineRow {
  id: string;
  variant_id: string;
  position: number;
  design_name: string;
  color: string;
  size: string;
  sku: string;
  hsn: string;
  qty: number;
  unit_price_paise: number;
  amount_paise: number;
  unit_cost_paise: number;
  gst_rate_percent: number | null;
  taxable_paise: number | null;
  tax_paise: number | null;
}

function invoiceOf(db: Db, id: string): InvoiceRow {
  const row = get<InvoiceRow>(db, 'SELECT * FROM invoices WHERE id = ?', id);
  if (!row) throw new UserError('That invoice no longer exists.');
  return row;
}

/**
 * Each line's own taxable value, tax and rate. Invoices made since lines kept their own figures have them stored; older ones had
 * one rate and no line discounts, so the invoice's figures are shared over the lines by value, as the reports always did.
 */
function lineFigures(inv: InvoiceRow, lines: InvoiceLineRow[]): { taxable: number[]; tax: number[]; rate: number[] } {
  if (lines.length > 0 && lines.every((l) => l.taxable_paise !== null && l.tax_paise !== null)) {
    return { taxable: lines.map((l) => l.taxable_paise!), tax: lines.map((l) => l.tax_paise!), rate: lines.map((l) => l.gst_rate_percent ?? inv.gst_rate_percent) };
  }
  const taxable = allocate(inv.taxable_paise, lines.map((l) => l.amount_paise));
  const tax = allocate(inv.cgst_paise + inv.sgst_paise + inv.igst_paise, taxable);
  return { taxable, tax, rate: lines.map(() => inv.gst_rate_percent) };
}

/** How many of each invoice line have already come back. */
function creditedQty(db: Db, invoiceId: string): Map<string, number> {
  return new Map(
    all<{ invoice_line_id: string; q: number }>(db, 'SELECT l.invoice_line_id, SUM(l.qty) AS q FROM credit_note_lines l JOIN credit_notes n ON n.id = l.credit_note_id WHERE n.invoice_id = ? GROUP BY l.invoice_line_id', invoiceId).map((r) => [r.invoice_line_id, r.q]),
  );
}

export function returnableLines(db: Db, invoiceId: string): ReturnableLine[] {
  const inv = invoiceOf(db, invoiceId);
  const lines = all<InvoiceLineRow>(db, 'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY position', invoiceId);
  const fig = lineFigures(inv, lines);
  const done = creditedQty(db, invoiceId);
  return lines.map((l, i) => ({
    invoiceLineId: l.id,
    variantId: l.variant_id,
    designName: l.design_name,
    color: l.color,
    size: l.size,
    sku: l.sku,
    qty: l.qty,
    creditedQty: done.get(l.id) ?? 0,
    remainingQty: l.qty - (done.get(l.id) ?? 0),
    unitPricePaise: l.unit_price_paise,
    ratePercent: fig.rate[i]!,
  }));
}

// ── Working a note out ──────────────────────────────────────────────────────
interface BuiltLine {
  source: InvoiceLineRow;
  qty: number;
  restock: boolean;
  amount: number;
  discount: number;
  rate: number;
  taxable: number;
  tax: number;
}

interface Built {
  inv: InvoiceRow;
  lines: BuiltLine[];
  taxByRate: RateGroup[];
  preview: CreditNotePreview;
}

/**
 * What the chosen pieces are worth. Each line's taxable value and tax are shared out by quantity, each piece taking the difference
 * between what the pieces returned so far would carry and what they carry with this one: so returns in any number of parts add up
 * to exactly the line. A note that takes back the last of an invoice is worth exactly what is left of it, rounding and all.
 */
function build(db: Db, input: CreditNoteInput): Built {
  const inv = invoiceOf(db, String(input.invoiceId));
  if (inv.status === 'cancelled') throw new UserError(`${inv.number} is cancelled, so there is nothing to credit.`);
  if (!isIsoDate(input.issueDate)) throw new UserError('Enter a valid date for the credit note.');
  if (input.issueDate < inv.issue_date) throw new UserError("A credit note can't be dated before the invoice it is for.");
  if (input.issueDate > todayIso()) throw new UserError("A credit note can't be dated in the future.");
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new UserError('Choose at least one item to take back.');

  const all_ = all<InvoiceLineRow>(db, 'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY position', inv.id);
  const fig = lineFigures(inv, all_);
  const done = creditedQty(db, inv.id);
  const chosen = new Map<string, { qty: number; restock: boolean }>();
  for (const c of input.lines) {
    if (chosen.has(c.invoiceLineId)) throw new UserError('The same item is listed twice.');
    const index = all_.findIndex((l) => l.id === c.invoiceLineId);
    if (index < 0) throw new UserError(`One of those items is not on ${inv.number}.`);
    const line = all_[index]!;
    const left = line.qty - (done.get(line.id) ?? 0);
    if (!Number.isInteger(c.qty) || c.qty < 1) throw new UserError('Each quantity to take back should be 1 or more.');
    if (c.qty > left) throw new UserError(left === 0 ? `${line.design_name} (${line.color}, ${line.size}) has already been taken back in full.` : `Only ${left} of ${line.design_name} (${line.color}, ${line.size}) can still be taken back.`);
    chosen.set(line.id, { qty: c.qty, restock: !!c.restock });
  }

  const inclusive = inv.prices_include_gst === 1;
  const lines: BuiltLine[] = [];
  all_.forEach((line, i) => {
    const pick = chosen.get(line.id);
    if (!pick) return;
    const before = done.get(line.id) ?? 0;
    const part = (x: number) => Math.floor((x * (before + pick.qty)) / line.qty) - Math.floor((x * before) / line.qty);
    const taxable = part(fig.taxable[i]!);
    const tax = part(fig.tax[i]!);
    const amount = pick.qty * line.unit_price_paise;
    const net = inclusive ? taxable + tax : taxable;
    lines.push({ source: line, qty: pick.qty, restock: pick.restock, amount, discount: Math.max(0, amount - net), rate: fig.rate[i]!, taxable, tax });
  });

  const intra = inv.intra_state === 1;
  const groups = new Map<number, { taxable: number; tax: number }>();
  for (const l of lines) {
    const g = groups.get(l.rate) ?? { taxable: 0, tax: 0 };
    g.taxable += l.taxable;
    g.tax += l.tax;
    groups.set(l.rate, g);
  }
  const taxByRate: RateGroup[] = [...groups.entries()].sort(([a], [b]) => a - b).map(([ratePercent, g]) => ({ ratePercent, taxablePaise: g.taxable, taxPaise: g.tax, ...splitTax(g.tax, intra) }));
  const taxablePaise = lines.reduce((s, l) => s + l.taxable, 0);
  const taxPaise = lines.reduce((s, l) => s + l.tax, 0);
  const raw = taxablePaise + taxPaise;

  const finishes = all_.every((l) => (done.get(l.id) ?? 0) + (chosen.get(l.id)?.qty ?? 0) === l.qty);
  const creditedBefore = get<{ s: number }>(db, 'SELECT COALESCE(SUM(total_paise), 0) AS s FROM credit_notes WHERE invoice_id = ?', inv.id)?.s ?? 0;
  const totalPaise = finishes ? Math.max(0, inv.total_paise - creditedBefore) : roundTotal(raw, getSettings(db).roundOff);

  const owed = Math.max(0, inv.total_paise - paidFor(db, inv.id));
  const appliedPaise = Math.min(totalPaise, owed);
  return {
    inv,
    lines,
    taxByRate,
    preview: {
      subtotalPaise: lines.reduce((s, l) => s + l.amount, 0),
      lineDiscountPaise: lines.reduce((s, l) => s + l.discount, 0),
      taxablePaise,
      taxPaise,
      roundOffPaise: totalPaise - raw,
      totalPaise,
      taxByRate,
      appliedPaise,
      leftoverPaise: totalPaise - appliedPaise,
    },
  };
}

/** What a credit note would come to and how it would be settled, without making it. */
export function previewCreditNote(db: Db, input: CreditNoteInput): CreditNotePreview {
  return build(db, input).preview;
}

// ── Making one ──────────────────────────────────────────────────────────────
const nextSequence = (db: Db, fy: string): number => get<{ next: number }>(db, 'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM credit_notes WHERE fy = ?', fy)?.next ?? 1;

export function nextCreditNoteNumber(db: Db, issueDate: string): string {
  if (!isIsoDate(issueDate)) throw new UserError('Enter a valid date.');
  const fy = financialYear(issueDate);
  return formatInvoiceNumber(getSettings(db).creditNotePrefix, fy, nextSequence(db, fy));
}

export function createCreditNote(db: Db, input: CreditNoteInput): CreditNote {
  const reason = requireText(input.reason, 'The reason', 200);
  const { inv, lines, taxByRate, preview } = build(db, input);
  const settings = getSettings(db);

  // When the customer has already paid, something is left over after the invoice is cleared: it has to go somewhere.
  const leftover = preview.leftoverPaise;
  if (leftover > 0) {
    if (input.leftover !== 'refund' && input.leftover !== 'credit') throw new UserError('The customer has already paid for these. Choose whether to refund the money or keep it as credit for their next purchase.');
    if (input.leftover === 'credit' && !inv.customer_id) throw new UserError('Credit can only be kept for a saved customer. Refund the money instead.');
    if (input.leftover === 'refund' && !(PAYMENT_METHODS as readonly string[]).includes(input.refund?.method as string)) throw new UserError('Choose how the refund is being paid.');
  }

  const id = newId();
  tx(db, () => {
    const fy = financialYear(input.issueDate);
    const seq = nextSequence(db, fy);
    const number = formatInvoiceNumber(settings.creditNotePrefix, fy, seq);
    const now = nowIso();
    const seller = { ...(JSON.parse(inv.seller_json) as object) };
    try {
      run(
        db,
        `INSERT INTO credit_notes (id, number, fy, seq, invoice_id, customer_id, type, seller_json, buyer_json, place_of_supply, issue_date, reason, gst_rate_percent, prices_include_gst, intra_state,
           subtotal_paise, line_discount_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise, total_paise, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, number, fy, seq, inv.id, inv.customer_id, inv.type, JSON.stringify(seller), inv.buyer_json, inv.place_of_supply, input.issueDate, reason, inv.gst_rate_percent, inv.prices_include_gst, inv.intra_state,
        preview.subtotalPaise, preview.lineDiscountPaise, preview.taxablePaise, taxByRate.reduce((s, g) => s + g.cgstPaise, 0), taxByRate.reduce((s, g) => s + g.sgstPaise, 0), taxByRate.reduce((s, g) => s + g.igstPaise, 0), preview.roundOffPaise, preview.totalPaise, now, now,
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new UserError('Another credit note took that number a moment ago. Please try again.');
      throw err;
    }

    lines.forEach((l, position) => {
      run(
        db,
        `INSERT INTO credit_note_lines (id, credit_note_id, invoice_line_id, variant_id, position, design_name, color, size, sku, hsn, qty, unit_price_paise, amount_paise, line_discount_paise, gst_rate_percent, taxable_paise, tax_paise, restocked, unit_cost_paise)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId(), id, l.source.id, l.source.variant_id, position, l.source.design_name, l.source.color, l.source.size, l.source.sku, l.source.hsn, l.qty, l.source.unit_price_paise, l.amount, l.discount, l.rate, l.taxable, l.tax, l.restock ? 1 : 0, l.source.unit_cost_paise,
      );
      if (l.restock) {
        // If the colour has since been archived there is no shelf to put the pieces on; the credit still stands.
        const live = get(db, 'SELECT 1 AS x FROM variants WHERE id = ? AND deleted_at IS NULL', l.source.variant_id);
        if (live) recordMovement(db, l.source.variant_id, l.qty, 'return', `Credit note ${number}`, { type: 'credit_note', id });
      }
    });

    onReturn(db, inv.customer_id, inv.id, number, preview.totalPaise);

    // Money. The credit is first put toward the invoice first; what is left is refunded, or kept as the customer's credit.
    const keepAsCredit = leftover > 0 && input.leftover === 'credit';
    const creditAmount = keepAsCredit ? preview.totalPaise : preview.appliedPaise;
    if (creditAmount > 0) {
      recordPaymentTx(db, {
        customerId: inv.customer_id,
        amountPaise: creditAmount,
        method: 'other',
        reference: number,
        receivedOn: input.issueDate,
        note: `Credit note ${number}`,
        allocations: preview.appliedPaise > 0 ? [{ invoiceId: inv.id, amountPaise: preview.appliedPaise }] : [],
        kind: 'credit',
        creditNoteId: id,
      });
    }
    if (leftover > 0 && input.leftover === 'refund') {
      recordPaymentTx(db, {
        customerId: inv.customer_id,
        amountPaise: leftover,
        method: input.refund!.method,
        reference: input.refund!.reference ?? number,
        receivedOn: input.issueDate,
        note: `Refund for credit note ${number}`,
        allocations: [],
        accountId: input.refund!.accountId,
        kind: 'refund',
        creditNoteId: id,
      });
    }
  });
  return getCreditNote(db, id);
}

// ── Reading ─────────────────────────────────────────────────────────────────
interface NoteRow {
  id: string;
  number: string;
  invoice_id: string;
  invoice_number: string;
  customer_id: string | null;
  type: InvoiceType;
  seller_json: string;
  buyer_json: string;
  place_of_supply: string;
  issue_date: string;
  reason: string;
  gst_rate_percent: number;
  prices_include_gst: number;
  intra_state: number;
  subtotal_paise: number;
  line_discount_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  round_off_paise: number;
  total_paise: number;
  created_at: string;
}

const SELECT = 'SELECT n.*, i.number AS invoice_number FROM credit_notes n JOIN invoices i ON i.id = n.invoice_id';

const toSummary = (r: NoteRow): CreditNoteSummary => ({
  id: r.id,
  number: r.number,
  invoiceId: r.invoice_id,
  invoiceNumber: r.invoice_number,
  customerId: r.customer_id,
  buyerName: (JSON.parse(r.buyer_json) as Party).name,
  type: r.type,
  issueDate: r.issue_date,
  reason: r.reason,
  totalPaise: r.total_paise,
});

export function getCreditNote(db: Db, id: string): CreditNote {
  const r = get<NoteRow>(db, `${SELECT} WHERE n.id = ?`, id);
  if (!r) throw new UserError('That credit note no longer exists.');
  const lineRows = all<{
    id: string; invoice_line_id: string; variant_id: string | null; design_name: string; color: string; size: string; sku: string; hsn: string; qty: number;
    unit_price_paise: number; amount_paise: number; line_discount_paise: number; gst_rate_percent: number; taxable_paise: number; tax_paise: number; restocked: number;
  }>(db, 'SELECT * FROM credit_note_lines WHERE credit_note_id = ? ORDER BY position', id);
  const lines = lineRows.map(
    (l): CreditNoteLine => ({
      id: l.id,
      invoiceLineId: l.invoice_line_id,
      variantId: l.variant_id,
      designName: l.design_name,
      color: l.color,
      size: l.size,
      sku: l.sku,
      hsn: l.hsn,
      qty: l.qty,
      unitPricePaise: l.unit_price_paise,
      amountPaise: l.amount_paise,
      discountPaise: l.line_discount_paise,
      ratePercent: l.gst_rate_percent,
      taxablePaise: l.taxable_paise,
      taxPaise: l.tax_paise,
      restocked: l.restocked === 1,
    }),
  );
  const credit = get<{ amount: number | null; applied: number | null; refunded_of: number | null }>(
    db,
    `SELECT p.amount_paise AS amount,
       (SELECT COALESCE(SUM(a.amount_paise), 0) FROM payment_allocations a WHERE a.payment_id = p.id AND a.released_at IS NULL) AS applied,
       (SELECT COALESCE(SUM(x.amount_paise), 0) FROM payments x WHERE x.refund_of = p.id AND x.voided_at IS NULL) AS refunded_of
     FROM payments p WHERE p.credit_note_id = ? AND p.kind = 'credit' AND p.voided_at IS NULL`,
    id,
  );
  const refunded = (get<{ s: number }>(db, "SELECT COALESCE(SUM(amount_paise), 0) AS s FROM payments WHERE credit_note_id = ? AND kind = 'refund' AND voided_at IS NULL", id)?.s ?? 0) + (credit?.refunded_of ?? 0);
  const applied = credit?.applied ?? 0;
  return {
    ...toSummary(r),
    seller: { bank: '', footer: '', upiId: '', email: '', terms: '', ...JSON.parse(r.seller_json) },
    branding: brandingOf(db),
    buyer: JSON.parse(r.buyer_json),
    placeOfSupply: r.place_of_supply,
    gstRatePercent: r.gst_rate_percent,
    pricesIncludeGst: r.prices_include_gst === 1,
    intraState: r.intra_state === 1,
    subtotalPaise: r.subtotal_paise,
    lineDiscountPaise: r.line_discount_paise,
    taxablePaise: r.taxable_paise,
    cgstPaise: r.cgst_paise,
    sgstPaise: r.sgst_paise,
    igstPaise: r.igst_paise,
    roundOffPaise: r.round_off_paise,
    taxByRate: groupsOf(r, lines),
    lines,
    appliedPaise: applied,
    heldPaise: Math.max(0, (credit?.amount ?? 0) - applied - (credit?.refunded_of ?? 0)),
    refundedPaise: refunded,
    createdAt: r.created_at,
  };
}

function groupsOf(r: NoteRow, lines: CreditNoteLine[]): RateGroup[] {
  const groups = new Map<number, { taxable: number; tax: number }>();
  for (const l of lines) {
    const g = groups.get(l.ratePercent) ?? { taxable: 0, tax: 0 };
    g.taxable += l.taxablePaise;
    g.tax += l.taxPaise;
    groups.set(l.ratePercent, g);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([ratePercent, g]) => ({ ratePercent, taxablePaise: g.taxable, taxPaise: g.tax, ...splitTax(g.tax, r.intra_state === 1) }));
}

export function listCreditNotes(db: Db, query: CreditNoteQuery = {}): CreditNoteSummary[] {
  if (query.from && !isIsoDate(query.from)) throw new UserError('Enter a valid "from" date.');
  if (query.to && !isIsoDate(query.to)) throw new UserError('Enter a valid "to" date.');
  const where: string[] = [];
  const params: string[] = [];
  if (query.invoiceId) {
    where.push('n.invoice_id = ?');
    params.push(query.invoiceId);
  }
  if (query.customerId) {
    where.push('n.customer_id = ?');
    params.push(query.customerId);
  }
  return all<NoteRow>(db, `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY n.issue_date DESC, n.seq DESC`, ...params)
    .map(toSummary)
    .filter((s) => (!query.from || s.issueDate >= query.from) && (!query.to || s.issueDate <= query.to))
    .filter((s) => matchesAll(`${s.number} ${s.invoiceNumber} ${s.buyerName} ${s.reason}`, query.search));
}
