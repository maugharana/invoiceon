import { financialYear, formatInvoiceNumber, isIsoDate, roundTotal, splitTax, todayIso, type RateGroup } from '../../shared/gst';
import { lineShares } from '../../shared/invoiceShares';
import { formatMoney } from '../../shared/money';
import { matchesAll } from '../../shared/search';
import {
  PAYMENT_METHODS,
  type CreditNote,
  type CreditNoteInput,
  type CreditNotePreview,
  type CreditNotePreviewLine,
  type CreditNoteQuery,
  type CreditNoteRefundInput,
  type CreditNoteSummary,
  type Invoice,
  type PaymentMethod,
} from '../../shared/types';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, newId, nowIso, optionalText, requireInt } from './common';
import { createExpense } from './expenses';
import { recordMovement } from './inventory';
import { onReturn, onReturnCancelled } from './loyalty';
import { brandingOf, getInvoice } from './invoices';
import { paidFor } from './payments';
import { getSettings } from './settings';

const MAX_QTY = 10_000;
/** The expense category money handed back to a customer goes under. */
export const REFUND_CATEGORY = 'Customer refunds';

// ── What an invoice's lines are worth ───────────────────────────────────────
interface Basis {
  lineId: string;
  variantId: string;
  designName: string;
  color: string;
  size: string;
  sku: string;
  hsn: string;
  qty: number;
  creditedQty: number;
  creditedTaxable: number;
  creditedTax: number;
  unitPricePaise: number;
  ratePercent: number;
  taxable: number;
  tax: number;
}

/** The invoice's lines with how much of each has already been credited, not counting credit notes that were cancelled. */
function basisOf(db: Db, invoice: Invoice): Basis[] {
  const shares = lineShares(invoice);
  const done = new Map(
    all<{ invoice_line_id: string; q: number; t: number; x: number }>(
      db,
      `SELECT l.invoice_line_id, SUM(l.qty) AS q, SUM(l.taxable_paise) AS t, SUM(l.tax_paise) AS x
       FROM credit_note_lines l JOIN credit_notes c ON c.id = l.credit_note_id WHERE c.invoice_id = ? AND c.status = 'issued' GROUP BY l.invoice_line_id`,
      invoice.id,
    ).map((r) => [r.invoice_line_id, r]),
  );
  return invoice.lines.map((l, i) => {
    const d = done.get(l.id);
    return {
      lineId: l.id,
      variantId: l.variantId,
      designName: l.designName,
      color: l.color,
      size: l.size,
      sku: l.sku,
      hsn: l.hsn,
      qty: l.qty,
      creditedQty: d?.q ?? 0,
      creditedTaxable: d?.t ?? 0,
      creditedTax: d?.x ?? 0,
      unitPricePaise: l.unitPricePaise,
      ratePercent: l.ratePercent,
      taxable: shares[i]!.taxable,
      tax: shares[i]!.tax,
    };
  });
}

/** A part of a line's figure for `q` of its `qty` pieces. Taking the last pieces takes exactly what is left, so the parts add up to the whole. */
function part(whole: number, alreadyTaken: number, qty: number, taken: number, q: number): number {
  if (q === qty - taken) return whole - alreadyTaken;
  return Number((BigInt(whole) * BigInt(q) + BigInt(Math.floor(qty / 2))) / BigInt(qty));
}

// ── Working out a credit ────────────────────────────────────────────────────
function compute(db: Db, invoice: Invoice, requested: { invoiceLineId: string; qty: number }[]): { preview: CreditNotePreview; basis: Basis[] } {
  const basis = basisOf(db, invoice);
  const ask = new Map<string, number>();
  for (const r of requested) {
    if (ask.has(r.invoiceLineId)) throw new UserError('The same item is listed twice.');
    ask.set(r.invoiceLineId, r.qty);
  }
  for (const id of ask.keys()) if (!basis.some((b) => b.lineId === id)) throw new UserError('One of the items is not on this invoice.');

  let taxable = 0;
  let tax = 0;
  const lines: CreditNotePreviewLine[] = basis.map((b) => {
    const q = ask.get(b.lineId) ?? 0;
    const creditable = b.qty - b.creditedQty;
    if (q > creditable) throw new UserError(`${b.designName} (${b.color}, ${b.size}): only ${creditable} of ${b.qty} can still be taken back${b.creditedQty > 0 ? `, ${b.creditedQty} already has a credit note` : ''}.`);
    const t = q > 0 ? part(b.taxable, b.creditedTaxable, b.qty, b.creditedQty, q) : 0;
    const x = q > 0 ? part(b.tax, b.creditedTax, b.qty, b.creditedQty, q) : 0;
    taxable += t;
    tax += x;
    return {
      invoiceLineId: b.lineId,
      designName: b.designName,
      color: b.color,
      size: b.size,
      sku: b.sku,
      soldQty: b.qty,
      creditedQty: b.creditedQty,
      creditableQty: creditable,
      unitGrossPaise: b.qty > 0 ? Math.round((b.taxable + b.tax) / b.qty) : 0,
      qty: q,
      taxablePaise: t,
      taxPaise: x,
    };
  });

  const asked = lines.filter((l) => l.qty > 0);
  // Taking back everything that is left on the invoice credits exactly what the invoice still stands at, round-off included, so it nets to nothing.
  const fullReturn = asked.length > 0 && lines.every((l) => l.qty === l.creditableQty);
  const gross = taxable + tax;
  const creditedBefore = get<{ s: number }>(db, "SELECT COALESCE(SUM(total_paise), 0) AS s FROM credit_notes WHERE invoice_id = ? AND status = 'issued'", invoice.id)?.s ?? 0;
  const total = asked.length === 0 ? 0 : fullReturn ? invoice.totalPaise - creditedBefore : roundTotal(gross, getSettings(db).roundOff);
  const owed = Math.max(0, invoice.totalPaise - paidFor(db, invoice.id));
  const applied = Math.min(total, owed);
  return { basis, preview: { lines, taxablePaise: taxable, taxPaise: tax, roundOffPaise: total - gross, totalPaise: total, owedOnInvoicePaise: owed, appliedToInvoicePaise: applied, excessPaise: total - applied, fullReturn } };
}

export function previewCreditNote(db: Db, input: Pick<CreditNoteInput, 'invoiceId' | 'lines'>): CreditNotePreview {
  const invoice = getInvoice(db, input.invoiceId);
  if (invoice.status === 'cancelled') throw new UserError(`${invoice.number} is cancelled, so there is nothing to take back from it.`);
  return compute(db, invoice, (input.lines ?? []).filter((l) => Number(l.qty) > 0).map((l) => ({ invoiceLineId: l.invoiceLineId, qty: requireInt(l.qty, 'Quantity', { min: 1, max: MAX_QTY }) }))).preview;
}

// ── Reading ─────────────────────────────────────────────────────────────────
interface Row {
  id: string;
  number: string;
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  customer_id: string | null;
  issue_date: string;
  reason: string;
  note: string;
  seller_json: string;
  buyer_json: string;
  place_of_supply: string;
  intra_state: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  round_off_paise: number;
  total_paise: number;
  status: 'issued' | 'cancelled';
  cancelled_at: string | null;
  cancel_reason: string;
  created_at: string;
}

const SELECT = 'SELECT c.*, i.number AS invoice_number, i.issue_date AS invoice_date FROM credit_notes c JOIN invoices i ON i.id = c.invoice_id';

const toSummary = (r: Row): CreditNoteSummary => ({
  id: r.id,
  number: r.number,
  invoiceId: r.invoice_id,
  invoiceNumber: r.invoice_number,
  customerId: r.customer_id,
  buyerName: (JSON.parse(r.buyer_json) as { name: string }).name,
  issueDate: r.issue_date,
  reason: r.reason,
  totalPaise: r.total_paise,
  status: r.status,
});

export function listCreditNotes(db: Db, query: CreditNoteQuery = {}): CreditNoteSummary[] {
  const where: string[] = [];
  const params: string[] = [];
  const add = (sql: string, v: string | undefined) => {
    if (v) {
      where.push(sql);
      params.push(v);
    }
  };
  add('c.customer_id = ?', query.customerId);
  add('c.invoice_id = ?', query.invoiceId);
  add('c.status = ?', query.status);
  if (query.from) {
    if (!isIsoDate(query.from)) throw new UserError('Enter a valid "from" date.');
    add('c.issue_date >= ?', query.from);
  }
  if (query.to) {
    if (!isIsoDate(query.to)) throw new UserError('Enter a valid "to" date.');
    add('c.issue_date <= ?', query.to);
  }
  return all<Row>(db, `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.issue_date DESC, c.seq DESC, c.created_at DESC`, ...params)
    .map(toSummary)
    .filter((c) => matchesAll(`${c.number} ${c.invoiceNumber} ${c.buyerName}`, query.search));
}

/** What is still held for the customer on a credit note: its value less what went on invoices and what was handed back. */
export function heldOn(db: Db, id: string): number {
  return (
    get<{ held: number }>(
      db,
      `SELECT c.total_paise
         - COALESCE((SELECT SUM(a.amount_paise) FROM credit_note_applications a WHERE a.credit_note_id = c.id AND a.released_at IS NULL), 0)
         - COALESCE((SELECT SUM(r.amount_paise) FROM credit_note_refunds r WHERE r.credit_note_id = c.id), 0) AS held
       FROM credit_notes c WHERE c.id = ? AND c.status = 'issued'`,
      id,
    )?.held ?? 0
  );
}

export function getCreditNote(db: Db, id: string): CreditNote {
  const r = get<Row>(db, `${SELECT} WHERE c.id = ?`, id);
  if (!r) throw new UserError('That credit note no longer exists.');
  const lineRows = all<{ id: string; invoice_line_id: string; variant_id: string; design_name: string; color: string; size: string; sku: string; hsn: string; qty: number; unit_price_paise: number; gst_rate_percent: number; taxable_paise: number; tax_paise: number; restocked: number }>(
    db,
    'SELECT * FROM credit_note_lines WHERE credit_note_id = ? ORDER BY position',
    id,
  );
  const groups = new Map<number, { taxable: number; tax: number }>();
  for (const l of lineRows) {
    const g = groups.get(l.gst_rate_percent) ?? { taxable: 0, tax: 0 };
    g.taxable += l.taxable_paise;
    g.tax += l.tax_paise;
    groups.set(l.gst_rate_percent, g);
  }
  const taxByRate: RateGroup[] = [...groups.entries()].sort(([a], [b]) => a - b).map(([ratePercent, g]) => ({ ratePercent, taxablePaise: g.taxable, taxPaise: g.tax, ...splitTax(g.tax, r.intra_state === 1) }));
  return {
    ...toSummary(r),
    invoiceDate: r.invoice_date,
    seller: { bank: '', footer: '', upiId: '', ...JSON.parse(r.seller_json) },
    branding: brandingOf(db),
    buyer: JSON.parse(r.buyer_json),
    placeOfSupply: r.place_of_supply,
    intraState: r.intra_state === 1,
    taxablePaise: r.taxable_paise,
    cgstPaise: r.cgst_paise,
    sgstPaise: r.sgst_paise,
    igstPaise: r.igst_paise,
    roundOffPaise: r.round_off_paise,
    taxByRate,
    note: r.note,
    lines: lineRows.map((l) => ({ id: l.id, invoiceLineId: l.invoice_line_id, variantId: l.variant_id, designName: l.design_name, color: l.color, size: l.size, sku: l.sku, hsn: l.hsn, qty: l.qty, unitPricePaise: l.unit_price_paise, ratePercent: l.gst_rate_percent, taxablePaise: l.taxable_paise, taxPaise: l.tax_paise, restocked: l.restocked === 1 })),
    applications: all<{ invoice_id: string; number: string; amount_paise: number }>(
      db,
      'SELECT a.invoice_id, i.number, a.amount_paise FROM credit_note_applications a JOIN invoices i ON i.id = a.invoice_id WHERE a.credit_note_id = ? AND a.released_at IS NULL ORDER BY a.created_at',
      id,
    ).map((a) => ({ invoiceId: a.invoice_id, invoiceNumber: a.number, amountPaise: a.amount_paise })),
    refunds: all<{ id: string; amount_paise: number; paid_on: string; method: PaymentMethod }>(db, 'SELECT id, amount_paise, paid_on, method FROM credit_note_refunds WHERE credit_note_id = ? ORDER BY paid_on, created_at', id).map((f) => ({ id: f.id, amountPaise: f.amount_paise, paidOn: f.paid_on, method: f.method })),
    heldPaise: heldOn(db, id),
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
    createdAt: r.created_at,
  };
}

/** The credit notes on an invoice, for showing on it. */
export function creditNotesOnInvoice(db: Db, invoiceId: string): Invoice['creditNotes'] {
  return all<{ id: string; number: string; issue_date: string; total_paise: number; status: 'issued' | 'cancelled' }>(db, 'SELECT id, number, issue_date, total_paise, status FROM credit_notes WHERE invoice_id = ? ORDER BY issue_date, seq', invoiceId).map((c) => ({ id: c.id, number: c.number, issueDate: c.issue_date, totalPaise: c.total_paise, status: c.status }));
}

// ── Writing ─────────────────────────────────────────────────────────────────
function checkMethod(method: unknown): PaymentMethod {
  if (!(PAYMENT_METHODS as readonly unknown[]).includes(method)) throw new UserError('Choose how the refund is paid.');
  return method as PaymentMethod;
}

function checkAccount(db: Db, accountId: unknown): string {
  const id = typeof accountId === 'string' ? accountId : '';
  if (id && !getSettings(db).paymentAccounts.some((a) => a.id === id)) throw new UserError('Choose the account from the list.');
  return id;
}

/** Hands money back to the customer: recorded against the credit note and entered as an expense, in one step. */
function payRefund(db: Db, note: { id: string; number: string }, buyerName: string, amount: number, refund: NonNullable<CreditNoteInput['refund']>, paidOn: string): void {
  const method = checkMethod(refund.method);
  const accountId = checkAccount(db, refund.accountId);
  const reference = optionalText(refund.reference, 'Reference', 60);
  const expense = createExpense(db, { date: paidOn, category: REFUND_CATEGORY, vendor: buyerName, amountPaise: amount, method, accountId, reference: reference || note.number, note: `Credit note ${note.number}`, status: 'paid' });
  run(db, 'INSERT INTO credit_note_refunds (id, credit_note_id, amount_paise, paid_on, method, account_id, reference, expense_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', newId(), note.id, amount, paidOn, method, accountId, reference, expense.id, nowIso());
}

export function createCreditNote(db: Db, input: CreditNoteInput): CreditNote {
  const invoice = getInvoice(db, input.invoiceId);
  if (invoice.status === 'cancelled') throw new UserError(`${invoice.number} is cancelled, so there is nothing to take back from it.`);
  if (!isIsoDate(input.issueDate) || input.issueDate > todayIso()) throw new UserError('Enter the day the goods came back, not in the future.');
  if (input.issueDate < invoice.issueDate) throw new UserError("A credit note can't be dated before the invoice it is for.");
  const requested = (Array.isArray(input.lines) ? input.lines : []).filter((l) => Number(l.qty) > 0);
  if (requested.length === 0) throw new UserError('Enter how many of at least one item are being taken back.');
  const lines = requested.map((l) => ({ invoiceLineId: l.invoiceLineId, qty: requireInt(l.qty, 'Quantity', { min: 1, max: MAX_QTY }), restock: !!l.restock }));
  const reason = optionalText(input.reason, 'Reason', 100);
  if (!reason) throw new UserError('Choose why the goods are being taken back.');
  const note = optionalText(input.note, 'Note', 300);
  const { preview, basis } = compute(db, invoice, lines);
  if (preview.totalPaise <= 0) throw new UserError('The credit comes to nothing, so there is nothing to record.');

  const buyerName = invoice.buyer.name;
  // A customer who is not saved has nowhere to keep credit, so whatever they are owed is handed back now.
  const settlement = invoice.customerId ? input.settlement : 'refund';
  if (preview.excessPaise > 0 && settlement === 'refund' && !input.refund) throw new UserError('Choose how the refund is paid.');

  const id = newId();
  tx(db, () => {
    const fy = financialYear(input.issueDate);
    const seq = (get<{ n: number }>(db, 'SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM credit_notes WHERE fy = ?', fy)?.n ?? 1);
    const number = formatInvoiceNumber('CN', fy, seq);
    const now = nowIso();
    const tax = splitTax(preview.taxPaise, invoice.intraState);
    run(
      db,
      `INSERT INTO credit_notes (id, number, fy, seq, invoice_id, customer_id, issue_date, reason, note, seller_json, buyer_json, place_of_supply, intra_state,
         taxable_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise, total_paise, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, number, fy, seq, invoice.id, invoice.customerId, input.issueDate, reason, note, JSON.stringify(invoice.seller), JSON.stringify(invoice.buyer), invoice.placeOfSupply, invoice.intraState ? 1 : 0,
      preview.taxablePaise, tax.cgstPaise, tax.sgstPaise, tax.igstPaise, preview.roundOffPaise, preview.totalPaise, now, now,
    );
    let position = 0;
    for (const l of lines) {
      const b = basis.find((x) => x.lineId === l.invoiceLineId)!;
      const p = preview.lines.find((x) => x.invoiceLineId === l.invoiceLineId)!;
      // If the saree has since been archived there is no shelf to put it back on.
      const live = !!get(db, 'SELECT 1 AS x FROM variants WHERE id = ? AND deleted_at IS NULL', b.variantId);
      const restock = l.restock && live;
      run(
        db,
        `INSERT INTO credit_note_lines (id, credit_note_id, invoice_line_id, variant_id, position, design_name, color, size, sku, hsn, qty, unit_price_paise, gst_rate_percent, taxable_paise, tax_paise, restocked)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId(), id, b.lineId, b.variantId, position++, b.designName, b.color, b.size, b.sku, b.hsn, l.qty, b.unitPricePaise, b.ratePercent, p.taxablePaise, p.taxPaise, restock ? 1 : 0,
      );
      if (restock) recordMovement(db, b.variantId, l.qty, 'return', `Credit note ${number}`, { type: 'credit_note', id });
    }
    onReturn(db, invoice.customerId, invoice.id, number, preview.totalPaise);
    if (preview.appliedToInvoicePaise > 0) run(db, 'INSERT INTO credit_note_applications (id, credit_note_id, invoice_id, amount_paise, created_at) VALUES (?, ?, ?, ?, ?)', newId(), id, invoice.id, preview.appliedToInvoicePaise, now);
    if (preview.excessPaise > 0 && settlement === 'refund') payRefund(db, { id, number }, buyerName, preview.excessPaise, input.refund!, input.issueDate);
  });
  return getCreditNote(db, id);
}

/** Hands back credit that was being kept for the customer. */
export function refundCreditNote(db: Db, id: string, input: CreditNoteRefundInput): CreditNote {
  const note = getCreditNote(db, id);
  if (note.status === 'cancelled') throw new UserError(`${note.number} is cancelled.`);
  if (note.heldPaise <= 0) throw new UserError('Nothing is being kept on this credit note.');
  const amount = input.amountPaise === undefined ? note.heldPaise : requireInt(input.amountPaise, 'Amount', { min: 1, max: 100_000_000_00 });
  if (amount > note.heldPaise) throw new UserError(`Only ${formatMoney(note.heldPaise)} is being kept on ${note.number}.`);
  tx(db, () => payRefund(db, note, note.buyer.name, amount, input, todayIso()));
  return getCreditNote(db, id);
}

/**
 * Cancels a credit note made by mistake: the credit comes off the invoice again and the pieces that went back on the shelf come off
 * it, which only works while they are still there. Refused once money was handed back or the credit was put toward another invoice.
 */
export function cancelCreditNote(db: Db, id: string, reason: string): CreditNote {
  const note = getCreditNote(db, id);
  if (note.status === 'cancelled') throw new UserError(`${note.number} is already cancelled.`);
  if (note.refunds.length > 0) throw new UserError(`Money was handed back on ${note.number}, so it can't be cancelled. Make a new invoice for the goods instead.`);
  const elsewhere = note.applications.filter((a) => a.invoiceId !== note.invoiceId);
  if (elsewhere.length > 0) throw new UserError(`${note.number} was put toward ${elsewhere.map((a) => a.invoiceNumber).join(', ')}, so it can't be cancelled.`);
  const why = optionalText(reason, 'Reason', 200);
  tx(db, () => {
    for (const l of note.lines) if (l.restocked) recordMovement(db, l.variantId, -l.qty, 'adjustment', `Credit note ${note.number} cancelled`, { type: 'credit_note', id });
    run(db, 'UPDATE credit_note_applications SET released_at = ? WHERE credit_note_id = ? AND released_at IS NULL', nowIso(), id);
    run(db, "UPDATE credit_notes SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?", nowIso(), why, nowIso(), id);
    onReturnCancelled(db, note.customerId, note.invoiceId, note.number);
  });
  return getCreditNote(db, id);
}
