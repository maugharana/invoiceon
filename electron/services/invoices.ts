import { computeTotals, financialYear, formatInvoiceNumber, invoiceStatus, isIsoDate, todayIso } from '../../shared/gst';
import { matchesAll } from '../../shared/search';
import { formatMoney } from '../../shared/money';
import { sameState } from '../../shared/states';
import type { DashboardSummary, Invoice, InvoiceBranding, InvoiceInput, InvoiceLine, InvoiceQuery, InvoiceSummary, InvoiceType, Party, SaleVariant, Settings } from '../../shared/types';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, isUniqueViolation, newId, nowIso, optionalText, requireInt } from './common';
import { getCustomer } from './customers';
import { getVariant, recordMovement } from './inventory';
import { advanceHeld, applyAdvance, loadPaid, paidFor, paymentsOnInvoice, recordPaymentTx, releaseInvoicePayments } from './payments';
import { getSettings } from './settings';

const MAX_PAISE = 100_000_000_00;

interface InvoiceRow {
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
  due_date: string | null;
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
  status: 'issued' | 'cancelled';
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
}

export function brandingOf(db: Db): InvoiceBranding {
  const s = getSettings(db);
  return { accent: s.invoiceAccent, logo: s.invoiceLogo, showSignature: s.invoiceShowSignature, showUpiQr: s.invoiceShowUpiQr, language: s.invoiceLanguage };
}

// ── Mapping ─────────────────────────────────────────────────────────────────
function toSummary(r: InvoiceRow, paid: number): InvoiceSummary {
  const buyer = JSON.parse(r.buyer_json) as Party;
  return {
    id: r.id,
    number: r.number,
    type: r.type,
    customerId: r.customer_id,
    buyerName: buyer.name,
    issueDate: r.issue_date,
    dueDate: r.due_date,
    totalPaise: r.total_paise,
    paidPaise: paid,
    status: invoiceStatus({ cancelled: r.status === 'cancelled', totalPaise: r.total_paise, paidPaise: paid, dueDate: r.due_date, today: todayIso() }),
  };
}

function toInvoice(db: Db, r: InvoiceRow): Invoice {
  const lines = all<LineRow>(db, 'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY position', r.id).map(
    (l): InvoiceLine => ({
      id: l.id,
      variantId: l.variant_id,
      designName: l.design_name,
      color: l.color,
      size: l.size,
      sku: l.sku,
      hsn: l.hsn,
      qty: l.qty,
      unitPricePaise: l.unit_price_paise,
      amountPaise: l.amount_paise,
    }),
  );
  return {
    ...toSummary(r, paidFor(db, r.id)),
    payments: paymentsOnInvoice(db, r.id),
    // Content is frozen at issue. Invoices from before "bank" and "footer" existed simply have none.
    seller: { bank: '', footer: '', upiId: '', ...JSON.parse(r.seller_json) },
    // Styling is not frozen: change the logo or colour and every invoice, old ones included, is redrawn with it.
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
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
    createdAt: r.created_at,
  };
}

// ── Reads ───────────────────────────────────────────────────────────────────
export function getInvoice(db: Db, id: string): Invoice {
  const row = get<InvoiceRow>(db, 'SELECT * FROM invoices WHERE id = ?', id);
  if (!row) throw new UserError('That invoice no longer exists.');
  return toInvoice(db, row);
}

export function listInvoices(db: Db, query: InvoiceQuery = {}): InvoiceSummary[] {
  const where: string[] = [];
  const params: string[] = [];
  if (query.type === 'B2B' || query.type === 'B2C') {
    where.push('type = ?');
    params.push(query.type);
  }
  if (query.customerId) {
    where.push('customer_id = ?');
    params.push(query.customerId);
  }
  if (query.from !== undefined && query.from !== '') {
    if (!isIsoDate(query.from)) throw new UserError('Enter a valid "from" date.');
    where.push('issue_date >= ?');
    params.push(query.from);
  }
  if (query.to !== undefined && query.to !== '') {
    if (!isIsoDate(query.to)) throw new UserError('Enter a valid "to" date.');
    where.push('issue_date <= ?');
    params.push(query.to);
  }
  const rows = all<InvoiceRow>(db, `SELECT * FROM invoices ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY issue_date DESC, seq DESC, created_at DESC`, ...params);
  const paid = loadPaid(db);
  return rows
    .map((r) => toSummary(r, paid.get(r.id) ?? 0))
    .filter((s) => matchesAll(`${s.number} ${s.buyerName}`, query.search))
    .filter((s) => {
      if (query.status === 'open') return s.status === 'unpaid' || s.status === 'partial' || s.status === 'overdue';
      if (query.status === 'overdue') return s.status === 'overdue';
      if (query.status === 'cancelled') return s.status === 'cancelled';
      return true;
    });
}

export function variantsForSale(db: Db): SaleVariant[] {
  return all<{
    id: string;
    design_id: string;
    code: string;
    design_name: string;
    design_nickname: string;
    hsn_code: string;
    color: string;
    size: string;
    sku: string;
    stock: number;
    sell_price_paise: number;
  }>(
    db,
    `SELECT v.id, v.design_id, d.code, d.name AS design_name, d.nickname AS design_nickname, d.hsn_code, v.color, v.size, v.sku, v.stock, v.sell_price_paise
     FROM variants v JOIN designs d ON d.id = v.design_id
     WHERE v.deleted_at IS NULL AND d.deleted_at IS NULL
     ORDER BY d.name COLLATE NOCASE, v.color COLLATE NOCASE, v.size COLLATE NOCASE`,
  ).map((r) => ({
    variantId: r.id,
    designId: r.design_id,
    designCode: r.code,
    designName: r.design_name,
    designNickname: r.design_nickname,
    hsn: r.hsn_code,
    color: r.color,
    size: r.size,
    sku: r.sku,
    stock: r.stock,
    sellPricePaise: r.sell_price_paise,
  }));
}

function nextSequence(db: Db, fy: string): number {
  return (get<{ next: number }>(db, 'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM invoices WHERE fy = ?', fy)?.next ?? 1);
}

export function nextInvoiceNumber(db: Db, issueDate: string): string {
  if (!isIsoDate(issueDate)) throw new UserError('Enter a valid invoice date.');
  const fy = financialYear(issueDate);
  return formatInvoiceNumber(getSettings(db).invoicePrefix, fy, nextSequence(db, fy));
}

// ── Issue ───────────────────────────────────────────────────────────────────
type DocumentInput = Pick<InvoiceInput, 'type' | 'customerId' | 'buyerName' | 'issueDate' | 'discountPaise' | 'notes' | 'lines'>;

/**
 * The checks and snapshots an invoice and a proforma have in common: who is buying, whether the lines are sane, which tax
 * applies. Proformas use it too, so a quote can never promise something an invoice would refuse.
 */
export function checkDocument(db: Db, settings: Settings, input: DocumentInput) {
  const type: InvoiceType = input.type === 'B2B' ? 'B2B' : 'B2C';
  if (!isIsoDate(input.issueDate)) throw new UserError('Enter a valid invoice date.');
  const discount = requireInt(input.discountPaise, 'Discount', { max: MAX_PAISE });
  const notes = optionalText(input.notes, 'Notes', 300);

  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new UserError('Add at least one item to the invoice.');
  if (input.lines.length > 100) throw new UserError('An invoice can have at most 100 items.');
  const seen = new Set<string>();
  for (const l of input.lines) {
    requireInt(l.qty, 'Quantity', { min: 1, max: 100_000 });
    requireInt(l.unitPricePaise, 'Price', { max: MAX_PAISE });
    if (seen.has(l.variantId)) throw new UserError('The same item appears twice — combine them into one line.');
    seen.add(l.variantId);
  }

  if (type === 'B2B' && !input.customerId) throw new UserError('Choose the customer for a B2B invoice.');
  if (type === 'B2B' && !settings.gstin) throw new UserError('Add your own GSTIN in Settings before issuing B2B tax invoices.');

  const customer = input.customerId ? getCustomer(db, input.customerId) : null;
  if (type === 'B2B' && !customer?.gstin) throw new UserError(`${customer?.name ?? 'This customer'} has no GSTIN, so a B2B tax invoice can't be issued. Add their GSTIN, or bill them as B2C.`);
  if (type === 'B2B' && customer && customer.gstin === settings.gstin) throw new UserError(`${customer.name} has the same GSTIN as your business. Check the customer's GSTIN.`);

  const buyer: Party = customer
    ? { name: customer.name, gstin: customer.gstin, address: customer.address, city: customer.city, state: customer.state, pincode: customer.pincode, phone: customer.phone }
    : { name: optionalText(input.buyerName, 'Customer name', 120) || 'Walk-in customer', gstin: '', address: '', city: '', state: '', pincode: '', phone: '' };

  // A buyer with no state on file is treated as local. Supply to another state is the exception that needs IGST.
  const placeOfSupply = buyer.state || settings.state;
  const intraState = !settings.state || sameState(placeOfSupply, settings.state);

  return { type, customer, buyer, placeOfSupply, intraState, discount, notes };
}

/** Seller details as they are right now, to be frozen onto a document. `terms` differ between an invoice and a proforma. */
export function sellerSnapshot(settings: Settings, terms: string) {
  return { name: settings.businessName, gstin: settings.gstin, address: settings.addressLine, city: settings.city, state: settings.state, pincode: settings.pincode, phone: settings.phone, email: settings.email, terms, bank: settings.invoiceBank, footer: settings.invoiceFooter, upiId: settings.upiId };
}

/** Prices and descriptions are frozen from the variant as it is right now; the discount and tax are worked out once. */
export function priceLines(db: Db, settings: Settings, lines: DocumentInput['lines'], discount: number, intraState: boolean) {
  const items = lines.map((l, index) => {
    const variant = getVariant(db, l.variantId);
    const design = get<{ name: string; hsn_code: string }>(db, 'SELECT name, hsn_code FROM designs WHERE id = ?', variant.designId)!;
    return { l, variant, design, index, amount: l.qty * l.unitPricePaise };
  });
  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  if (discount > subtotal) throw new UserError("The discount can't be more than the invoice subtotal.");
  const totals = computeTotals({ lineAmounts: items.map((i) => i.amount), discountPaise: discount, ratePercent: settings.gstRatePercent, intraState, inclusive: settings.pricesIncludeGst });
  return { items, totals };
}

export function createInvoice(db: Db, input: InvoiceInput): Invoice {
  const settings = getSettings(db);

  if (input.dueDate !== null && !isIsoDate(input.dueDate)) throw new UserError('Enter a valid due date.');
  if (input.dueDate !== null && isIsoDate(input.issueDate) && input.dueDate < input.issueDate) throw new UserError("The due date can't be before the invoice date.");
  const { type, customer, buyer, placeOfSupply, intraState, discount, notes } = checkDocument(db, settings, input);

  const receivedNow = input.payment ? requireInt(input.payment.amountPaise, 'Payment', { max: MAX_PAISE }) : 0;
  const advanceToApply = input.applyAdvancePaise ? requireInt(input.applyAdvancePaise, 'Advance to apply', { max: MAX_PAISE }) : 0;
  if (advanceToApply > 0 && !customer) throw new UserError("Advance can only be applied to a saved customer's invoice.");

  const seller = sellerSnapshot(settings, settings.invoiceTerms);

  const id = newId();
  tx(db, () => {
    const { items, totals } = priceLines(db, settings, input.lines, discount, intraState);

    const fy = financialYear(input.issueDate);
    const seq = nextSequence(db, fy);
    const number = formatInvoiceNumber(settings.invoicePrefix, fy, seq);
    const now = nowIso();

    try {
      run(
        db,
        `INSERT INTO invoices (id, number, fy, seq, type, customer_id, seller_json, buyer_json, place_of_supply, issue_date, due_date, gst_rate_percent, prices_include_gst, intra_state,
           subtotal_paise, discount_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise, total_paise, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, number, fy, seq, type, customer?.id ?? null, JSON.stringify(seller), JSON.stringify(buyer), placeOfSupply, input.issueDate, input.dueDate, settings.gstRatePercent, settings.pricesIncludeGst ? 1 : 0, intraState ? 1 : 0,
        totals.subtotalPaise, totals.discountPaise, totals.taxablePaise, totals.cgstPaise, totals.sgstPaise, totals.igstPaise, totals.roundOffPaise, totals.totalPaise, notes, now, now,
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new UserError('Another invoice took that number a moment ago. Please try again.');
      throw err;
    }

    for (const i of items) {
      run(
        db,
        'INSERT INTO invoice_lines (id, invoice_id, variant_id, position, design_name, color, size, sku, hsn, qty, unit_price_paise, amount_paise, unit_cost_paise) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        newId(), id, i.variant.id, i.index, i.design.name, i.variant.color, i.variant.size, i.variant.sku, i.design.hsn_code, i.l.qty, i.l.unitPricePaise, i.amount, i.variant.unitCostPaise,
      );
      // Throws "Not enough stock" if short, which rolls back the whole invoice.
      recordMovement(db, i.variant.id, -i.l.qty, 'sale', `Invoice ${number}`, { type: 'invoice', id });
    }

    // Money handed over as the invoice is made is recorded in this same step, so an invoice and its advance can never get out of sync.
    let due = totals.totalPaise;
    if (advanceToApply > 0) {
      // "Apply up to X" — an invoice smaller than the advance simply takes what it needs.
      const wanted = Math.min(advanceToApply, due);
      const applied = applyAdvance(db, customer!.id, id, wanted);
      if (applied < wanted) throw new UserError(`Only ${formatMoney(applied)} of advance was available to apply.`);
      due -= applied;
    }
    if (receivedNow > 0) {
      if (receivedNow > due) throw new UserError(`The payment (${formatMoney(receivedNow)}) is more than the ${formatMoney(due)} due on this invoice.`);
      recordPaymentTx(db, {
        customerId: customer?.id ?? null,
        amountPaise: receivedNow,
        method: input.payment!.method,
        reference: input.payment!.reference ?? '',
        receivedOn: input.issueDate > todayIso() ? todayIso() : input.issueDate,
        note: `With invoice ${number}`,
        allocations: [{ invoiceId: id, amountPaise: receivedNow }],
      });
    }
  });
  return getInvoice(db, id);
}

/** Puts whatever advance the customer holds toward this invoice's balance. */
export function applyAdvanceToInvoice(db: Db, invoiceId: string): Invoice {
  const invoice = getInvoice(db, invoiceId);
  if (invoice.status === 'cancelled') throw new UserError('This invoice is cancelled.');
  if (!invoice.customerId) throw new UserError('Walk-in invoices have no customer to hold an advance for.');
  if (invoice.totalPaise - invoice.paidPaise <= 0) throw new UserError('This invoice is already paid.');
  if (advanceHeld(db, invoice.customerId) <= 0) throw new UserError('This customer has no advance to apply.');
  applyAdvance(db, invoice.customerId, invoiceId, invoice.totalPaise - invoice.paidPaise);
  return getInvoice(db, invoiceId);
}

// ── Cancel ──────────────────────────────────────────────────────────────────
export function cancelInvoice(db: Db, id: string, reason: string): Invoice {
  const invoice = getInvoice(db, id);
  if (invoice.status === 'cancelled') throw new UserError('This invoice is already cancelled.');
  const why = optionalText(reason, 'Reason', 200);

  tx(db, () => {
    releaseInvoicePayments(db, id, `Invoice ${invoice.number} cancelled`);
    for (const line of invoice.lines) {
      // If the variant has since been archived there is no shelf to put the pieces back on.
      const live = get(db, 'SELECT 1 AS x FROM variants WHERE id = ? AND deleted_at IS NULL', line.variantId);
      if (live) recordMovement(db, line.variantId, line.qty, 'return', `Invoice ${invoice.number} cancelled`, { type: 'invoice', id });
    }
    run(db, "UPDATE invoices SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?", nowIso(), why, nowIso(), id);
  });
  return getInvoice(db, id);
}

// ── Dashboard ───────────────────────────────────────────────────────────────
export function dashboardSummary(db: Db): DashboardSummary {
  const all_ = listInvoices(db);
  const live = all_.filter((i) => i.status !== 'cancelled');
  const open = live.filter((i) => i.status !== 'paid');
  const month = todayIso().slice(0, 7);
  const overdue = live.filter((i) => i.status === 'overdue');
  const owed = (i: InvoiceSummary) => i.totalPaise - i.paidPaise;
  return {
    outstandingPaise: open.reduce((s, i) => s + owed(i), 0),
    openInvoices: open.length,
    monthPaise: live.filter((i) => i.issueDate.startsWith(month)).reduce((s, i) => s + i.totalPaise, 0),
    monthInvoices: live.filter((i) => i.issueDate.startsWith(month)).length,
    overdueCount: overdue.length,
    overduePaise: overdue.reduce((s, i) => s + owed(i), 0),
    recent: all_.slice(0, 5),
  };
}
