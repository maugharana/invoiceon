import { creditedTaxable, lineNetAmounts, splitCredit } from '../../shared/credit';
import { financialYear, formatInvoiceNumber, isIsoDate, taxByRate, todayIso, type RateGroup } from '../../shared/gst';
import { formatMoney } from '../../shared/money';
import { matchesAll } from '../../shared/search';
import { PAYMENT_METHODS, type CreditNote, type CreditNoteInput, type CreditNoteKind, type CreditNoteLine, type CreditNoteQuery, type CreditNoteStatus, type CreditNoteSummary, type Invoice, type InvoiceType, type Party, type PaymentMethod } from '../../shared/types';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, isUniqueViolation, newId, nowIso, optionalText, requireInt } from './common';
import { isVariantLive, recordMovement } from './inventory';
import { brandingOf, getInvoice } from './invoices';
import { clawBack, giveBack } from './offers';
import { recordPaymentTx } from './payments';
import { getSettings } from './settings';

const MAX_PAISE = 100_000_000_00;

interface Row {
  id: string;
  number: string;
  fy: string;
  seq: number;
  invoice_id: string;
  customer_id: string | null;
  kind: CreditNoteKind;
  seller_json: string;
  buyer_json: string;
  place_of_supply: string;
  issue_date: string;
  intra_state: number;
  gst_rate_percent: number;
  tax_summary_json: string;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  round_off_paise: number;
  total_paise: number;
  reason: string;
  notes: string;
  refund_paise: number;
  refund_method: PaymentMethod | null;
  refund_reference: string;
  status: CreditNoteStatus;
  cancelled_at: string | null;
  cancel_reason: string;
  created_at: string;
  invoice_number: string;
  invoice_date: string;
  invoice_type: InvoiceType;
}

const SELECT = `SELECT c.*, i.number AS invoice_number, i.issue_date AS invoice_date, i.type AS invoice_type FROM credit_notes c JOIN invoices i ON i.id = c.invoice_id`;

function toSummary(r: Row): CreditNoteSummary {
  const buyer = JSON.parse(r.buyer_json) as Party;
  return {
    id: r.id,
    number: r.number,
    invoiceId: r.invoice_id,
    invoiceNumber: r.invoice_number,
    customerId: r.customer_id,
    buyerName: buyer.name,
    issueDate: r.issue_date,
    kind: r.kind,
    totalPaise: r.total_paise,
    refundPaise: r.refund_paise,
    status: r.status,
    reason: r.reason,
  };
}

function toCreditNote(db: Db, r: Row): CreditNote {
  const lines = all<{
    id: string;
    invoice_line_id: string | null;
    variant_id: string | null;
    design_name: string;
    color: string;
    size: string;
    sku: string;
    hsn: string;
    qty: number;
    unit_price_paise: number;
    amount_paise: number;
    taxable_paise: number;
    gst_rate_percent: number;
    restock: number;
  }>(db, 'SELECT * FROM credit_note_lines WHERE credit_note_id = ? ORDER BY position', r.id).map(
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
      taxablePaise: l.taxable_paise,
      gstRatePercent: l.gst_rate_percent,
      restock: l.restock === 1,
    }),
  );
  // Where the credit went: against the invoice, and whatever was left over stays with the customer.
  const pay = get<{ amount: number; applied: number }>(
    db,
    `SELECT p.amount_paise AS amount,
       COALESCE((SELECT SUM(a.amount_paise) FROM payment_allocations a WHERE a.payment_id = p.id AND a.released_at IS NULL), 0) AS applied
     FROM payments p WHERE p.credit_note_id = ? AND p.voided_at IS NULL`,
    r.id,
  );
  return {
    ...toSummary(r),
    invoiceDate: r.invoice_date,
    invoiceType: r.invoice_type,
    seller: { bank: '', footer: '', ...JSON.parse(r.seller_json) },
    branding: brandingOf(db),
    buyer: JSON.parse(r.buyer_json),
    placeOfSupply: r.place_of_supply,
    intraState: r.intra_state === 1,
    gstRatePercent: r.gst_rate_percent,
    taxSummary: JSON.parse(r.tax_summary_json) as RateGroup[],
    taxablePaise: r.taxable_paise,
    cgstPaise: r.cgst_paise,
    sgstPaise: r.sgst_paise,
    igstPaise: r.igst_paise,
    roundOffPaise: r.round_off_paise,
    notes: r.notes,
    refundMethod: r.refund_method,
    refundReference: r.refund_reference,
    appliedToInvoicePaise: pay?.applied ?? 0,
    heldAsCreditPaise: pay ? pay.amount - pay.applied : 0,
    lines,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
    createdAt: r.created_at,
  };
}

// ── Reads ───────────────────────────────────────────────────────────────────
export function getCreditNote(db: Db, id: string): CreditNote {
  const row = get<Row>(db, `${SELECT} WHERE c.id = ?`, id);
  if (!row) throw new UserError('That credit note no longer exists.');
  return toCreditNote(db, row);
}

export function listCreditNotes(db: Db, query: CreditNoteQuery = {}): CreditNoteSummary[] {
  const where: string[] = [];
  const params: string[] = [];
  if (query.customerId) {
    where.push('c.customer_id = ?');
    params.push(query.customerId);
  }
  if (query.invoiceId) {
    where.push('c.invoice_id = ?');
    params.push(query.invoiceId);
  }
  return all<Row>(db, `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.issue_date DESC, c.seq DESC, c.created_at DESC`, ...params)
    .map(toSummary)
    .filter((c) => matchesAll(`${c.number} ${c.buyerName} ${c.invoiceNumber} ${c.reason}`, query.search));
}

const nextSequence = (db: Db, fy: string): number => get<{ next: number }>(db, 'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM credit_notes WHERE fy = ?', fy)?.next ?? 1;

export function nextCreditNoteNumber(db: Db, issueDate: string): string {
  if (!isIsoDate(issueDate)) throw new UserError('Enter a valid credit note date.');
  const fy = financialYear(issueDate);
  return formatInvoiceNumber(getSettings(db).creditNotePrefix, fy, nextSequence(db, fy));
}

// ── Issue ───────────────────────────────────────────────────────────────────
/** The rate a piece was taxed at on its invoice. Invoices from before per-line rates carry one rate for the whole invoice. */
export const lineRate = (l: Invoice['lines'][number], inv: Invoice): number => l.gstRatePercent ?? inv.gstRatePercent;

interface Item {
  invoiceLineId: string | null;
  variantId: string | null;
  designName: string;
  color: string;
  size: string;
  sku: string;
  hsn: string;
  qty: number;
  unitPricePaise: number;
  amountPaise: number;
  taxablePaise: number;
  ratePercent: number;
  restock: boolean;
  unitCostPaise: number;
}

export function createCreditNote(db: Db, input: CreditNoteInput): CreditNote {
  const inv = getInvoice(db, input.invoiceId);
  if (inv.status === 'cancelled') throw new UserError(`${inv.number} is cancelled, so it can't be credited.`);
  if (input.kind !== 'return' && input.kind !== 'adjustment') throw new UserError('Choose whether this is a sales return or a price adjustment.');
  if (!isIsoDate(input.issueDate)) throw new UserError('Enter a valid credit note date.');
  if (input.issueDate < inv.issueDate) throw new UserError("A credit note can't be dated before its invoice.");
  if (input.issueDate > todayIso()) throw new UserError("The credit note date can't be in the future.");
  const reason = optionalText(input.reason, 'Reason', 200);
  const notes = optionalText(input.notes, 'Notes', 300);
  if (input.kind === 'adjustment' && !reason) throw new UserError('Say why the price is being adjusted. It is printed on the credit note.');

  const settings = getSettings(db);
  const items: Item[] = [];

  if (input.kind === 'return') {
    if (!Array.isArray(input.lines) || input.lines.length === 0) throw new UserError('Choose the items being returned.');
    // The invoice's discount is spread over its lines, so a returned piece is credited at what the customer actually paid for it.
    const nets = lineNetAmounts(inv.lines.map((l) => l.amountPaise), inv.discountPaise);
    const seen = new Set<string>();
    for (const row of input.lines) {
      const index = inv.lines.findIndex((l) => l.id === row.invoiceLineId);
      if (index < 0) throw new UserError('One of the items is not on this invoice.');
      const line = inv.lines[index]!;
      if (seen.has(line.id)) throw new UserError('The same item is listed twice.');
      seen.add(line.id);
      const qty = requireInt(row.qty, 'Quantity', { min: 1, max: 100_000 });
      const already = line.creditedQty ?? 0;
      const remaining = line.qty - already;
      if (remaining <= 0) throw new UserError(`${line.designName} (${line.color}) has already been fully credited.`);
      if (qty > remaining) throw new UserError(`${line.designName} (${line.color}): only ${remaining} can still be returned.`);
      const cost = get<{ unit_cost_paise: number }>(db, 'SELECT unit_cost_paise FROM invoice_lines WHERE id = ?', line.id)?.unit_cost_paise ?? 0;
      items.push({
        invoiceLineId: line.id,
        variantId: line.variantId,
        designName: line.designName,
        color: line.color,
        size: line.size,
        sku: line.sku,
        hsn: line.hsn,
        qty,
        unitPricePaise: line.unitPricePaise,
        amountPaise: qty * line.unitPricePaise,
        taxablePaise: creditedTaxable(nets[index]!, line.qty, already, qty),
        ratePercent: lineRate(line, inv),
        restock: !!row.restock,
        unitCostPaise: cost,
      });
    }
  } else {
    const adj = input.adjustment;
    if (!adj) throw new UserError('Enter the amount to credit.');
    const taxable = requireInt(adj.taxablePaise, 'Amount', { min: 1, max: MAX_PAISE });
    const already = get<{ s: number }>(db, "SELECT COALESCE(SUM(taxable_paise), 0) AS s FROM credit_notes WHERE invoice_id = ? AND status = 'issued'", inv.id)?.s ?? 0;
    if (taxable > inv.taxablePaise - already) throw new UserError(`At most ${formatMoney(Math.max(0, inv.taxablePaise - already))} more can be credited, before tax, on ${inv.number}.`);
    const rates = [...new Set(inv.lines.map((l) => lineRate(l, inv)))];
    const rate = adj.ratePercent ?? (rates.length === 1 ? rates[0]! : NaN);
    if (Number.isNaN(rate)) throw new UserError('This invoice has items at different GST rates. Choose which rate the adjustment applies to.');
    if (!rates.includes(rate)) throw new UserError('That GST rate is not on this invoice.');
    items.push({ invoiceLineId: null, variantId: null, designName: 'Price adjustment', color: '', size: '', sku: '', hsn: inv.lines.find((l) => lineRate(l, inv) === rate)?.hsn ?? '', qty: 1, unitPricePaise: taxable, amountPaise: taxable, taxablePaise: taxable, ratePercent: rate, restock: false, unitCostPaise: 0 });
  }

  const tax = taxByRate(items.map((i) => ({ taxablePaise: i.taxablePaise, ratePercent: i.ratePercent })), inv.intraState);
  if (tax.totalPaise <= 0) throw new UserError('There is nothing to credit: the amount comes to zero.');
  const creditedBefore = get<{ s: number }>(db, "SELECT COALESCE(SUM(total_paise), 0) AS s FROM credit_notes WHERE invoice_id = ? AND status = 'issued'", inv.id)?.s ?? 0;
  // A whole rupee of slack: totals are rounded to the rupee, so credits summing to a fully credited invoice can differ by that much.
  if (creditedBefore + tax.totalPaise > inv.totalPaise + 100) throw new UserError(`This would credit more than ${inv.number} was for (${formatMoney(inv.totalPaise)}).`);

  const refund = input.refund && input.refund.amountPaise > 0 ? input.refund : null;
  let refundPaise = 0;
  if (refund) {
    refundPaise = requireInt(refund.amountPaise, 'Refund', { min: 1, max: tax.totalPaise });
    if (!(PAYMENT_METHODS as readonly string[]).includes(refund.method)) throw new UserError('Choose how the refund is paid.');
  }
  const { toInvoice, held } = splitCredit(tax.totalPaise, refundPaise, inv.totalPaise - inv.paidPaise);
  const booked = tax.totalPaise - refundPaise;
  if (held > 0 && !inv.customerId) {
    throw new UserError(`${inv.number} is a walk-in invoice, so there is no customer to hold a credit for. Refund at least ${formatMoney(held)} in cash, UPI or bank.`);
  }

  const seller = JSON.stringify(inv.seller);
  const buyer = JSON.stringify(inv.buyer);
  // The tax row with the most value is the one printed in the register's single "rate" column for old-style readers.
  const mainRate = [...tax.groups].sort((a, b) => b.taxablePaise - a.taxablePaise)[0]?.ratePercent ?? inv.gstRatePercent;
  const id = newId();
  const fy = financialYear(input.issueDate);

  tx(db, () => {
    const seq = nextSequence(db, fy);
    const number = formatInvoiceNumber(settings.creditNotePrefix, fy, seq);
    const now = nowIso();
    try {
      run(
        db,
        `INSERT INTO credit_notes (id, number, fy, seq, invoice_id, customer_id, kind, seller_json, buyer_json, place_of_supply, issue_date, intra_state, gst_rate_percent, tax_summary_json,
           taxable_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise, total_paise, reason, notes, refund_paise, refund_method, refund_reference, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, number, fy, seq, inv.id, inv.customerId, input.kind, seller, buyer, inv.placeOfSupply, input.issueDate, inv.intraState ? 1 : 0, mainRate, JSON.stringify(tax.groups),
        tax.taxablePaise, tax.cgstPaise, tax.sgstPaise, tax.igstPaise, tax.roundOffPaise, tax.totalPaise, reason, notes, refundPaise, refund ? refund.method : null, refund ? optionalText(refund.reference, 'Refund reference', 60) : '', now, now,
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new UserError('Another credit note took that number a moment ago. Please try again.');
      throw err;
    }

    items.forEach((i, position) => {
      run(
        db,
        `INSERT INTO credit_note_lines (id, credit_note_id, invoice_line_id, variant_id, position, design_name, color, size, sku, hsn, qty, unit_price_paise, amount_paise, taxable_paise, gst_rate_percent, restock, unit_cost_paise)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId(), id, i.invoiceLineId, i.variantId, position, i.designName, i.color, i.size, i.sku, i.hsn, i.qty, i.unitPricePaise, i.amountPaise, i.taxablePaise, i.ratePercent, i.restock ? 1 : 0, i.unitCostPaise,
      );
      // Pieces that came back in good condition go back on the shelf. If the design has since been archived there is no shelf to put them on.
      if (i.restock && i.variantId && isVariantLive(db, i.variantId)) recordMovement(db, i.variantId, i.qty, 'return', `Credit note ${number}`, { type: 'credit_note', id });
    });

    if (booked > 0) {
      recordPaymentTx(db, {
        customerId: inv.customerId,
        amountPaise: booked,
        method: 'other',
        reference: number,
        receivedOn: input.issueDate,
        note: `Credit note ${number}`,
        allocations: toInvoice > 0 ? [{ invoiceId: inv.id, amountPaise: toInvoice }] : [],
        source: 'credit_note',
        creditNoteId: id,
      });
    }
    // Goods that came back take back the loyalty points they earned.
    clawBack(db, { id, number, taxablePaise: tax.taxablePaise }, { id: inv.id, customerId: inv.customerId, taxablePaise: inv.taxablePaise });
  });
  return getCreditNote(db, id);
}

// ── Cancel ──────────────────────────────────────────────────────────────────
/** Undoes a credit note that was a mistake: the pieces leave the shelf again and the invoice owes the money again. It stays on record. */
export function cancelCreditNote(db: Db, id: string, reason: string): CreditNote {
  const cn = getCreditNote(db, id);
  if (cn.status === 'cancelled') throw new UserError('This credit note is already cancelled.');
  if (cn.refundPaise > 0) throw new UserError(`${formatMoney(cn.refundPaise)} was paid back to the customer on ${cn.number}, so it can't be cancelled. Issue a fresh invoice for anything the customer still owes.`);
  const why = optionalText(reason, 'Reason', 200);

  tx(db, () => {
    const at = nowIso();
    // The bookkeeping payment is voided, so the invoice owes the money again and any held credit disappears with it.
    run(db, "UPDATE payments SET voided_at = ?, void_reason = ?, updated_at = ? WHERE credit_note_id = ? AND voided_at IS NULL", at, `Credit note ${cn.number} cancelled`, at, id);
    for (const l of cn.lines) {
      if (l.restock && l.variantId && isVariantLive(db, l.variantId)) recordMovement(db, l.variantId, -l.qty, 'return', `Credit note ${cn.number} cancelled`, { type: 'credit_note', id });
    }
    giveBack(db, id, cn.number);
    run(db, "UPDATE credit_notes SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?", at, why, at, id);
  });
  return getCreditNote(db, id);
}
