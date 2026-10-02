import { addDays, financialYear, formatInvoiceNumber, isIsoDate, todayIso } from '../../shared/gst';
import { matchesAll } from '../../shared/search';
import type { Invoice, InvoiceType, Party, Proforma, ProformaInput, ProformaLine, ProformaQuery, ProformaRevision, ProformaStatus, ProformaSummary, QuoteStage, QuoteTemplate, QuoteTemplateInput } from '../../shared/types';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, isUniqueViolation, newId, nowIso, optionalText } from './common';
import { brandingOf, checkDocument, createInvoice, getInvoice, priceLines, sellerSnapshot } from './invoices';
import { advanceHeld, applyAdvance } from './payments';
import { getSettings } from './settings';

interface Row {
  id: string;
  number: string;
  fy: string;
  seq: number;
  type: InvoiceType;
  customer_id: string | null;
  seller_json: string;
  buyer_json: string;
  place_of_supply: string;
  issue_date: string;
  valid_until: string;
  gst_rate_percent: number;
  prices_include_gst: number;
  intra_state: number;
  subtotal_paise: number;
  discount_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  round_off_paise: number;
  total_paise: number;
  notes: string;
  status: 'open' | 'converted' | 'cancelled';
  stage: QuoteStage;
  lost_reason: string;
  invoice_id: string | null;
  invoice_number: string | null;
  deposit_paise: number;
  invoiced_paise: number;
  invoiced_lines: number;
  cancelled_at: string | null;
  cancel_reason: string;
  created_at: string;
}

interface LineRow {
  id: string;
  variant_id: string;
  design_name: string;
  color: string;
  size: string;
  sku: string;
  hsn: string;
  qty: number;
  unit_price_paise: number;
  amount_paise: number;
  invoiced_qty: number;
}

// A quote lapses on its own; nothing needs to run for that to happen.
function statusOf(r: Pick<Row, 'status' | 'stage' | 'valid_until' | 'invoiced_lines'>): ProformaStatus {
  if (r.status === 'cancelled') return 'cancelled';
  if (r.status === 'converted') return 'converted';
  if (r.stage === 'lost') return 'lost';
  if (r.invoiced_lines > 0) return 'partial';
  return r.valid_until < todayIso() ? 'expired' : 'open';
}

// The invoices that still stand are the ones not cancelled. What has been invoiced is counted line by line (invoiced_qty).
const SELECT = `SELECT p.*,
    (SELECT group_concat(i.number, ', ') FROM proforma_invoices pi JOIN invoices i ON i.id = pi.invoice_id WHERE pi.proforma_id = p.id AND i.status = 'issued') AS invoice_number,
    (SELECT pi.invoice_id FROM proforma_invoices pi JOIN invoices i ON i.id = pi.invoice_id WHERE pi.proforma_id = p.id AND i.status = 'issued' ORDER BY pi.created_at DESC, pi.rowid DESC LIMIT 1) AS latest_invoice_id,
    COALESCE((SELECT SUM(pay.amount_paise) FROM payments pay WHERE pay.proforma_id = p.id AND pay.voided_at IS NULL), 0) AS deposit_paise,
    COALESCE((SELECT SUM(l.invoiced_qty * l.unit_price_paise) FROM proforma_lines l WHERE l.proforma_id = p.id), 0) AS invoiced_paise,
    (SELECT COUNT(*) FROM proforma_lines l WHERE l.proforma_id = p.id AND l.invoiced_qty > 0) AS invoiced_lines
  FROM proformas p`;

function toSummary(r: Row): ProformaSummary {
  return {
    id: r.id,
    number: r.number,
    type: r.type,
    customerId: r.customer_id,
    buyerName: (JSON.parse(r.buyer_json) as Party).name,
    issueDate: r.issue_date,
    validUntil: r.valid_until,
    totalPaise: r.total_paise,
    status: statusOf(r),
    invoiceId: (r as Row & { latest_invoice_id: string | null }).latest_invoice_id,
    invoiceNumber: r.invoice_number,
    stage: r.stage,
    lostReason: r.lost_reason,
    depositPaise: r.deposit_paise,
    invoicedPaise: r.invoiced_paise,
  };
}

function toProforma(db: Db, r: Row): Proforma {
  const lines = all<LineRow>(db, 'SELECT * FROM proforma_lines WHERE proforma_id = ? ORDER BY position', r.id).map(
    (l): ProformaLine => ({ id: l.id, variantId: l.variant_id, designName: l.design_name, color: l.color, size: l.size, sku: l.sku, hsn: l.hsn, qty: l.qty, unitPricePaise: l.unit_price_paise, amountPaise: l.amount_paise, invoicedQty: l.invoiced_qty }),
  );
  return {
    ...toSummary(r),
    seller: { bank: '', footer: '', upiId: '', ...JSON.parse(r.seller_json) },
    branding: brandingOf(db),
    buyer: JSON.parse(r.buyer_json),
    placeOfSupply: r.place_of_supply,
    gstRatePercent: r.gst_rate_percent,
    pricesIncludeGst: r.prices_include_gst === 1,
    intraState: r.intra_state === 1,
    subtotalPaise: r.subtotal_paise,
    discountPaise: r.discount_paise,
    taxablePaise: r.taxable_paise,
    cgstPaise: r.cgst_paise,
    sgstPaise: r.sgst_paise,
    igstPaise: r.igst_paise,
    roundOffPaise: r.round_off_paise,
    notes: r.notes,
    lines,
    invoices: all<{ id: string; number: string }>(db, "SELECT i.id, i.number FROM proforma_invoices pi JOIN invoices i ON i.id = pi.invoice_id WHERE pi.proforma_id = ? AND i.status = 'issued' ORDER BY pi.created_at, pi.rowid", r.id),
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
    createdAt: r.created_at,
  };
}

export function getProforma(db: Db, id: string): Proforma {
  const row = get<Row>(db, `${SELECT} WHERE p.id = ?`, id);
  if (!row) throw new UserError('That proforma no longer exists.');
  return toProforma(db, row);
}

export function listProformas(db: Db, query: ProformaQuery = {}): ProformaSummary[] {
  if (query.from && !isIsoDate(query.from)) throw new UserError('Enter a valid "from" date.');
  if (query.to && !isIsoDate(query.to)) throw new UserError('Enter a valid "to" date.');
  return all<Row>(db, `${SELECT} ORDER BY p.issue_date DESC, p.seq DESC, p.created_at DESC`)
    .map(toSummary)
    .filter((s) => (!query.from || s.issueDate >= query.from) && (!query.to || s.issueDate <= query.to))
    .filter((s) => matchesAll(`${s.number} ${s.buyerName}`, query.search))
    .filter((s) => !query.status || query.status === 'all' || s.status === query.status);
}

const nextSequence = (db: Db, fy: string): number => get<{ next: number }>(db, 'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM proformas WHERE fy = ?', fy)?.next ?? 1;

export function nextProformaNumber(db: Db, issueDate: string): string {
  if (!isIsoDate(issueDate)) throw new UserError('Enter a valid date.');
  const fy = financialYear(issueDate);
  return formatInvoiceNumber(getSettings(db).proformaPrefix, fy, nextSequence(db, fy));
}

/** A quote. It checks what an invoice would check, but takes nothing off the shelf and can be made for pieces you don't have yet. */
export function createProforma(db: Db, input: ProformaInput): Proforma {
  const settings = getSettings(db);
  if (!isIsoDate(input.validUntil)) throw new UserError('Enter a valid "valid until" date.');
  if (isIsoDate(input.issueDate) && input.validUntil < input.issueDate) throw new UserError("A proforma can't expire before its date.");
  const { type, customer, buyer, placeOfSupply, intraState, discount, notes } = checkDocument(db, settings, input);
  const seller = sellerSnapshot(settings, settings.proformaTerms || settings.invoiceTerms);

  const id = newId();
  tx(db, () => {
    const { items, totals } = priceLines(db, settings, input.lines, discount, intraState);
    const fy = financialYear(input.issueDate);
    const seq = nextSequence(db, fy);
    const number = formatInvoiceNumber(settings.proformaPrefix, fy, seq);
    const now = nowIso();
    try {
      run(
        db,
        `INSERT INTO proformas (id, number, fy, seq, type, customer_id, seller_json, buyer_json, place_of_supply, issue_date, valid_until, gst_rate_percent, prices_include_gst, intra_state,
           subtotal_paise, discount_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise, total_paise, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, number, fy, seq, type, customer?.id ?? null, JSON.stringify(seller), JSON.stringify(buyer), placeOfSupply, input.issueDate, input.validUntil, settings.gstRatePercent, settings.pricesIncludeGst ? 1 : 0, intraState ? 1 : 0,
        totals.subtotalPaise, totals.discountPaise, totals.taxablePaise, totals.cgstPaise, totals.sgstPaise, totals.igstPaise, totals.roundOffPaise, totals.totalPaise, notes, now, now,
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new UserError('Another proforma took that number a moment ago. Please try again.');
      throw err;
    }
    insertLines(db, id, items);
  });
  return getProforma(db, id);
}

type PricedItems = ReturnType<typeof priceLines>['items'];

function insertLines(db: Db, proformaId: string, items: PricedItems): void {
  for (const i of items) {
    run(
      db,
      'INSERT INTO proforma_lines (id, proforma_id, variant_id, position, design_name, color, size, sku, hsn, qty, unit_price_paise, amount_paise) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId(), proformaId, i.variant.id, i.index, i.design.name, i.variant.color, i.variant.size, i.variant.sku, i.design.hsn_code, i.l.qty, i.l.unitPricePaise, i.amount,
    );
  }
}

/**
 * Changes a quote that hasn't been invoiced or cancelled: its customer, items, prices, discount, dates and notes. It keeps its
 * number. It is worked out afresh, as if made today: the current tax settings and your current details apply. A new date has
 * to stay in the same financial year, because the number carries the year.
 */
export function updateProforma(db: Db, id: string, input: ProformaInput): Proforma {
  const existing = get<Row>(db, 'SELECT * FROM proformas WHERE id = ?', id);
  if (!existing) throw new UserError('That proforma no longer exists.');
  if (existing.status === 'converted') throw new UserError('This proforma became an invoice, so it can no longer be changed.');
  if (existing.status === 'cancelled') throw new UserError('This proforma was cancelled, so it can no longer be changed.');
  if (existing.stage === 'lost') throw new UserError('This quote was marked lost. Reopen it before changing it.');
  if (get(db, 'SELECT 1 AS x FROM proforma_lines WHERE proforma_id = ? AND invoiced_qty > 0', id)) throw new UserError('Part of this quote has already been invoiced, so it can no longer be changed. Make a new quote for anything else.');
  const settings = getSettings(db);
  if (!isIsoDate(input.validUntil)) throw new UserError('Enter a valid "valid until" date.');
  if (isIsoDate(input.issueDate) && input.validUntil < input.issueDate) throw new UserError("A proforma can't expire before its date.");
  const { type, customer, buyer, placeOfSupply, intraState, discount, notes } = checkDocument(db, settings, input);
  if (financialYear(input.issueDate) !== existing.fy) throw new UserError(`The number ${existing.number} belongs to the financial year ${existing.fy}. Keep the date inside that year, or make a new proforma.`);
  const seller = sellerSnapshot(settings, settings.proformaTerms || settings.invoiceTerms);

  tx(db, () => {
    saveRevision(db, id);
    const { items, totals } = priceLines(db, settings, input.lines, discount, intraState);
    run(
      db,
      `UPDATE proformas SET type = ?, customer_id = ?, seller_json = ?, buyer_json = ?, place_of_supply = ?, issue_date = ?, valid_until = ?, gst_rate_percent = ?, prices_include_gst = ?, intra_state = ?,
         subtotal_paise = ?, discount_paise = ?, taxable_paise = ?, cgst_paise = ?, sgst_paise = ?, igst_paise = ?, round_off_paise = ?, total_paise = ?, notes = ?, updated_at = ? WHERE id = ?`,
      type, customer?.id ?? null, JSON.stringify(seller), JSON.stringify(buyer), placeOfSupply, input.issueDate, input.validUntil, settings.gstRatePercent, settings.pricesIncludeGst ? 1 : 0, intraState ? 1 : 0,
      totals.subtotalPaise, totals.discountPaise, totals.taxablePaise, totals.cgstPaise, totals.sgstPaise, totals.igstPaise, totals.roundOffPaise, totals.totalPaise, notes, nowIso(), id,
    );
    // The lines belong to this quote alone, so they are replaced as a set.
    run(db, 'DELETE FROM proforma_lines WHERE proforma_id = ?', id);
    insertLines(db, id, items);
  });
  return getProforma(db, id);
}

export function cancelProforma(db: Db, id: string, reason: string): Proforma {
  const p = getProforma(db, id);
  if (p.status === 'cancelled') throw new UserError('This proforma is already cancelled.');
  if (p.status === 'converted') throw new UserError(`This proforma became invoice ${p.invoiceNumber}. Cancel that invoice instead.`);
  run(db, "UPDATE proformas SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?", nowIso(), optionalText(reason, 'Reason', 200), nowIso(), id);
  return getProforma(db, id);
}

/**
 * Turns the quote (or some of it) into a real invoice dated today, at the quoted prices. This is the moment stock is taken, so it
 * fails, and changes nothing, if the pieces aren't there. `pick` chooses lines and quantities for a part invoice; without it
 * everything not yet invoiced goes onto this one. The discount is shared out by value, and whatever is left of it goes onto the
 * last part, so the invoices together always carry exactly the discount that was quoted. A deposit taken against the quote is
 * put toward the invoice. Once every piece is invoiced the quote is marked as invoiced.
 */
export function convertProforma(db: Db, id: string, pick?: { variantId: string; qty: number }[]): Invoice {
  const p = getProforma(db, id);
  if (p.status === 'cancelled') throw new UserError('This proforma was cancelled.');
  if (p.status === 'converted') throw new UserError(`This proforma is already invoice ${p.invoiceNumber}.`);
  if (p.status === 'lost') throw new UserError('This quote was marked lost. Reopen it first if the customer has come back.');

  const remaining = new Map(p.lines.map((l) => [l.variantId, l.qty - l.invoicedQty]));
  const wanted = pick && pick.length > 0 ? pick : p.lines.filter((l) => l.qty - l.invoicedQty > 0).map((l) => ({ variantId: l.variantId, qty: l.qty - l.invoicedQty }));
  const seen = new Set<string>();
  for (const w of wanted) {
    if (seen.has(w.variantId)) throw new UserError('The same item is listed twice.');
    seen.add(w.variantId);
    const left = remaining.get(w.variantId);
    if (left === undefined) throw new UserError('One of those items is not on this quote.');
    if (!Number.isInteger(w.qty) || w.qty < 1) throw new UserError('Each quantity should be 1 or more.');
    if (w.qty > left) throw new UserError(left === 0 ? 'That item has already been invoiced in full.' : `Only ${left} of that item is left to invoice.`);
  }
  if (wanted.length === 0) throw new UserError('There is nothing left to invoice.');

  const today = todayIso();
  const settings = getSettings(db);
  const price = new Map(p.lines.map((l) => [l.variantId, l.unitPricePaise]));
  const partValue = wanted.reduce((sum, w) => sum + w.qty * (price.get(w.variantId) ?? 0), 0);
  const finishes = p.lines.every((l) => (remaining.get(l.variantId) ?? 0) - (wanted.find((w) => w.variantId === l.variantId)?.qty ?? 0) === 0);
  const discountUsed = get<{ s: number }>(db, "SELECT COALESCE(SUM(i.discount_paise), 0) AS s FROM proforma_invoices pi JOIN invoices i ON i.id = pi.invoice_id WHERE pi.proforma_id = ? AND i.status = 'issued'", id)?.s ?? 0;
  const discountLeft = Math.max(0, p.discountPaise - discountUsed);
  const subtotal = p.lines.reduce((sum, l) => sum + l.qty * l.unitPricePaise, 0);
  let discount = finishes ? discountLeft : subtotal > 0 ? Math.floor((p.discountPaise * partValue) / subtotal) : 0;
  discount = Math.min(discount, discountLeft, partValue);

  return tx(db, () => {
    const invoice = createInvoice(db, {
      type: p.type,
      customerId: p.customerId,
      buyerName: p.customerId ? undefined : p.buyer.name,
      issueDate: today,
      dueDate: p.type === 'B2B' ? addDays(today, settings.defaultDueDays) : today,
      discountPaise: discount,
      notes: p.notes,
      lines: wanted.map((w) => ({ variantId: w.variantId, qty: w.qty, unitPricePaise: price.get(w.variantId) ?? 0 })),
    });
    const now = nowIso();
    run(db, 'INSERT INTO proforma_invoices (proforma_id, invoice_id, created_at) VALUES (?, ?, ?)', id, invoice.id, now);
    for (const w of wanted) run(db, 'UPDATE proforma_lines SET invoiced_qty = invoiced_qty + ? WHERE proforma_id = ? AND variant_id = ?', w.qty, id, w.variantId);
    const done = !get(db, 'SELECT 1 AS x FROM proforma_lines WHERE proforma_id = ? AND invoiced_qty < qty', id);
    run(db, "UPDATE proformas SET status = ?, stage = 'accepted', lost_reason = '', invoice_id = ?, updated_at = ? WHERE id = ?", done ? 'converted' : 'open', invoice.id, now, id);

    // A deposit already taken for this quote is held as the customer's advance; put what is left of it toward this invoice.
    if (p.customerId && p.depositPaise > 0) {
      const depositApplied = get<{ s: number }>(
        db,
        `SELECT COALESCE(SUM(a.amount_paise), 0) AS s FROM payment_allocations a JOIN payments pay ON pay.id = a.payment_id
         WHERE pay.proforma_id = ? AND a.released_at IS NULL AND pay.voided_at IS NULL`,
        id,
      )?.s ?? 0;
      const toApply = Math.min(p.depositPaise - depositApplied, advanceHeld(db, p.customerId), invoice.totalPaise);
      if (toApply > 0) applyAdvance(db, p.customerId, invoice.id, toApply);
    }
    return getInvoice(db, invoice.id);
  });
}

/**
 * Records where the quote stands with the customer. "Lost" closes it (with the reason, so the report can show why quotes are
 * lost); "open" and "accepted" keep it live. Reopening a lost quote clears the reason.
 */
export function setQuoteStage(db: Db, id: string, stage: QuoteStage, lostReason = ''): Proforma {
  const p = getProforma(db, id);
  if (!['open', 'accepted', 'lost'].includes(stage)) throw new UserError('Choose where the quote stands.');
  if (p.status === 'cancelled') throw new UserError('This proforma was cancelled.');
  if (p.status === 'converted') throw new UserError(`This proforma is already invoice ${p.invoiceNumber}.`);
  if (stage === 'lost' && p.status === 'partial') throw new UserError('Part of this quote is already invoiced, so it is not lost. Cancel it to close the rest.');
  run(db, 'UPDATE proformas SET stage = ?, lost_reason = ?, updated_at = ? WHERE id = ?', stage, stage === 'lost' ? optionalText(lostReason, 'Reason', 200) : '', nowIso(), id);
  return getProforma(db, id);
}

// ── Versions ────────────────────────────────────────────────────────────────
interface Snapshot {
  issueDate: string;
  validUntil: string;
  totalPaise: number;
  discountPaise: number;
  notes: string;
  lines: ProformaRevision['lines'];
}

/** Keeps the quote as it stands, just before it is changed, as the next numbered version. */
function saveRevision(db: Db, id: string): void {
  const p = getProforma(db, id);
  const snapshot: Snapshot = {
    issueDate: p.issueDate,
    validUntil: p.validUntil,
    totalPaise: p.totalPaise,
    discountPaise: p.discountPaise,
    notes: p.notes,
    lines: p.lines.map((l) => ({ designName: l.designName, color: l.color, size: l.size, sku: l.sku, qty: l.qty, unitPricePaise: l.unitPricePaise, amountPaise: l.amountPaise })),
  };
  const version = (get<{ v: number }>(db, 'SELECT COALESCE(MAX(version), 0) + 1 AS v FROM proforma_revisions WHERE proforma_id = ?', id)?.v ?? 1);
  run(db, 'INSERT INTO proforma_revisions (id, proforma_id, version, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?)', newId(), id, version, JSON.stringify(snapshot), nowIso());
}

/** The earlier versions of a quote, newest first. The quote itself is the latest version. */
export function listRevisions(db: Db, id: string): ProformaRevision[] {
  getProforma(db, id);
  return all<{ version: number; snapshot_json: string; created_at: string }>(db, 'SELECT version, snapshot_json, created_at FROM proforma_revisions WHERE proforma_id = ? ORDER BY version DESC', id).map((r) => ({
    version: r.version,
    replacedAt: r.created_at,
    ...(JSON.parse(r.snapshot_json) as Snapshot),
  }));
}

// ── Templates ───────────────────────────────────────────────────────────────
interface TemplateRow {
  id: string;
  name: string;
  notes: string;
  lines_json: string;
}
const toTemplate = (r: TemplateRow): QuoteTemplate => ({ id: r.id, name: r.name, notes: r.notes, lines: JSON.parse(r.lines_json) as QuoteTemplate['lines'] });

export function listTemplates(db: Db): QuoteTemplate[] {
  return all<TemplateRow>(db, 'SELECT * FROM quote_templates WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE').map(toTemplate);
}

export function saveTemplate(db: Db, input: QuoteTemplateInput): QuoteTemplate {
  const name = optionalText(input.name, 'Template name', 60);
  if (!name) throw new UserError('Give the template a name.');
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new UserError('A template needs at least one item.');
  if (input.lines.length > 100) throw new UserError('A template can have at most 100 items.');
  const seen = new Set<string>();
  for (const l of input.lines) {
    if (!Number.isInteger(l.qty) || l.qty < 1 || !Number.isInteger(l.unitPricePaise) || l.unitPricePaise < 0) throw new UserError('Each item needs a whole quantity and a price.');
    if (seen.has(l.variantId)) throw new UserError('The same item appears twice.');
    seen.add(l.variantId);
    if (!get(db, 'SELECT 1 AS x FROM variants WHERE id = ? AND deleted_at IS NULL', l.variantId)) throw new UserError('One of the items no longer exists.');
  }
  const now = nowIso();
  const existing = get<{ id: string }>(db, 'SELECT id FROM quote_templates WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL', name);
  const id = existing?.id ?? newId();
  const lines = JSON.stringify(input.lines.map((l) => ({ variantId: l.variantId, qty: l.qty, unitPricePaise: l.unitPricePaise })));
  const notes = optionalText(input.notes, 'Notes', 300);
  // Saving under a name already in use replaces that template, which is what "update this template" means.
  if (existing) run(db, 'UPDATE quote_templates SET notes = ?, lines_json = ?, updated_at = ? WHERE id = ?', notes, lines, now, id);
  else run(db, 'INSERT INTO quote_templates (id, name, notes, lines_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', id, name, notes, lines, now, now);
  return toTemplate(get<TemplateRow>(db, 'SELECT * FROM quote_templates WHERE id = ?', id)!);
}

export function deleteTemplate(db: Db, id: string): void {
  if (!get(db, 'SELECT 1 AS x FROM quote_templates WHERE id = ? AND deleted_at IS NULL', id)) throw new UserError('That template no longer exists.');
  run(db, 'UPDATE quote_templates SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
}
