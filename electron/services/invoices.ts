import { computeInvoice, financialYear, formatInvoiceNumber, invoiceStatus, isIsoDate, isValidRate, resolveRate, splitTax, todayIso, type RateGroup } from '../../shared/gst';
import { matchesAll } from '../../shared/search';
import { formatMoney } from '../../shared/money';
import { sameState } from '../../shared/states';
import { DELIVERY_STATUS_LABEL, type DashboardSummary, type DeliveryStatus, type DeliveryUpdate, type Invoice, type InvoiceBranding, type InvoiceInput, type InvoiceLine, type InvoiceQuery, type InvoiceSummary, type InvoiceType, type Party, type SaleVariant, type Settings, type ShipTo } from '../../shared/types';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, isUniqueViolation, newId, nowIso, optionalText, requireInt } from './common';
import { getCustomer } from './customers';
import { getVariant, loadVariants, recordMovement } from './inventory';
import { advanceHeld, applyAdvance, loadPaid, paidFor, paymentsOnInvoice, recordPaymentTx, releaseInvoicePayments } from './payments';
import { fulfilWishes, onInvoiceCancelled, onInvoiceIssued } from './loyalty';
import { heldByQuotes } from './reservations';
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
  line_discount_paise: number;
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
  series: string;
  ship_to_json: string;
  transport: string;
  tracking_no: string;
  delivery_status: DeliveryStatus;
  delivered_on: string | null;
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
  gst_rate_percent: number | null;
  line_discount_paise: number;
  note: string;
  taxable_paise: number | null;
  tax_paise: number | null;
}

/** The parts of a stored document the tax summary is worked from. Invoices and quotes keep them in the same columns. */
export interface TaxSource {
  intra_state: number;
  gst_rate_percent: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
}
export interface TaxLineSource {
  gst_rate_percent: number | null;
  taxable_paise: number | null;
  tax_paise: number | null;
}

/**
 * The tax by rate, lowest first. Documents made before lines carried their own rate and tax have just one rate, the document's,
 * so their summary is the document's own figures; the rest are added up from the lines.
 */
export function taxByRate(header: TaxSource, lines: TaxLineSource[]): RateGroup[] {
  if (lines.length === 0 || lines.some((l) => l.taxable_paise === null || l.tax_paise === null)) {
    return [{ ratePercent: header.gst_rate_percent, taxablePaise: header.taxable_paise, taxPaise: header.cgst_paise + header.sgst_paise + header.igst_paise, cgstPaise: header.cgst_paise, sgstPaise: header.sgst_paise, igstPaise: header.igst_paise }];
  }
  const groups = new Map<number, { taxable: number; tax: number }>();
  for (const l of lines) {
    const rate = l.gst_rate_percent ?? header.gst_rate_percent;
    const g = groups.get(rate) ?? { taxable: 0, tax: 0 };
    g.taxable += l.taxable_paise!;
    g.tax += l.tax_paise!;
    groups.set(rate, g);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ratePercent, g]) => ({ ratePercent, taxablePaise: g.taxable, taxPaise: g.tax, ...splitTax(g.tax, header.intra_state === 1) }));
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
    deliveryStatus: r.delivery_status,
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
  const lineRows = all<LineRow>(db, 'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY position', r.id);
  const lines = lineRows.map(
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
      discountPaise: l.line_discount_paise,
      ratePercent: l.gst_rate_percent ?? r.gst_rate_percent,
      note: l.note,
      taxablePaise: l.taxable_paise,
      taxPaise: l.tax_paise,
    }),
  );
  return {
    ...toSummary(r, paidFor(db, r.id)),
    payments: paymentsOnInvoice(db, r.id),
    creditNotes: all<{ id: string; number: string; issue_date: string; total_paise: number; status: 'issued' | 'cancelled' }>(db, 'SELECT id, number, issue_date, total_paise, status FROM credit_notes WHERE invoice_id = ? ORDER BY issue_date, seq', r.id).map((c) => ({ id: c.id, number: c.number, issueDate: c.issue_date, totalPaise: c.total_paise, status: c.status })),
    creditedPaise: get<{ s: number }>(db, "SELECT COALESCE(SUM(a.amount_paise), 0) AS s FROM credit_note_applications a JOIN credit_notes n ON n.id = a.credit_note_id WHERE a.invoice_id = ? AND a.released_at IS NULL AND n.status = 'issued'", r.id)?.s ?? 0,
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
    lineDiscountPaise: r.line_discount_paise,
    discountPaise: r.discount_paise,
    taxablePaise: r.taxable_paise,
    cgstPaise: r.cgst_paise,
    sgstPaise: r.sgst_paise,
    igstPaise: r.igst_paise,
    roundOffPaise: r.round_off_paise,
    taxByRate: taxByRate(r, lineRows),
    notes: r.notes,
    lines,
    shipTo: r.ship_to_json ? (JSON.parse(r.ship_to_json) as ShipTo) : null,
    transport: r.transport,
    trackingNo: r.tracking_no,
    deliveredOn: r.delivered_on,
    series: r.series,
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
  if (query.delivery && query.delivery in DELIVERY_STATUS_LABEL) {
    where.push('delivery_status = ?');
    params.push(query.delivery);
  }
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
  const held = heldByQuotes(db);
  const cost = new Map(loadVariants(db).map((v) => [v.id, v.unitCostPaise]));
  return all<{
    id: string;
    design_id: string;
    code: string;
    design_name: string;
    design_nickname: string;
    hsn_code: string;
    gst_rate_percent: number | null;
    color: string;
    size: string;
    sku: string;
    barcode: string;
    stock: number;
    sell_price_paise: number;
  }>(
    db,
    `SELECT v.id, v.design_id, d.code, d.name AS design_name, d.nickname AS design_nickname, d.hsn_code, d.gst_rate_percent, v.color, v.size, v.sku, v.barcode, v.stock, v.sell_price_paise
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
    gstRatePercent: r.gst_rate_percent,
    color: r.color,
    size: r.size,
    sku: r.sku,
    barcode: r.barcode,
    held: held.get(r.id)?.qty ?? 0,
    stock: r.stock,
    sellPricePaise: r.sell_price_paise,
    unitCostPaise: cost.get(r.id) ?? 0,
  }));
}

/** The piece a scanned or typed code belongs to: its barcode or its SKU, ignoring case. Null when nothing matches. */
export function variantByCode(db: Db, code: string): SaleVariant | null {
  const c = String(code ?? '').trim().toLowerCase();
  if (!c) return null;
  return variantsForSale(db).find((v) => v.barcode.toLowerCase() === c || v.sku.toLowerCase() === c) ?? null;
}

function nextSequence(db: Db, fy: string, series: string): number {
  return (get<{ next: number }>(db, 'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM invoices WHERE fy = ? AND series = ?', fy, series)?.next ?? 1);
}

/** B2B tax invoices run their own numbers when a B2B prefix is set in Settings; everything else shares the main run. */
function seriesOf(settings: Settings, type: InvoiceType): { series: string; prefix: string } {
  return type === 'B2B' && settings.b2bPrefix ? { series: 'B2B', prefix: settings.b2bPrefix } : { series: '', prefix: settings.invoicePrefix };
}

export function nextInvoiceNumber(db: Db, issueDate: string, type: InvoiceType = 'B2C'): string {
  if (!isIsoDate(issueDate)) throw new UserError('Enter a valid invoice date.');
  const fy = financialYear(issueDate);
  const { series, prefix } = seriesOf(getSettings(db), type === 'B2B' ? 'B2B' : 'B2C');
  return formatInvoiceNumber(prefix, fy, nextSequence(db, fy, series));
}

function checkShipTo(input: ShipTo | null | undefined): ShipTo | null {
  if (!input) return null;
  const ship: ShipTo = {
    name: optionalText(input.name, 'Ship-to name', 120),
    address: optionalText(input.address, 'Ship-to address', 200),
    city: optionalText(input.city, 'Ship-to city', 60),
    state: optionalText(input.state, 'Ship-to state', 60),
    pincode: optionalText(input.pincode, 'Ship-to pincode', 6),
    phone: optionalText(input.phone, 'Ship-to phone', 20),
  };
  if (!ship.address && !ship.city && !ship.pincode) return null; // nothing to ship to is the same as no ship-to
  if (ship.pincode && !/^\d{6}$/.test(ship.pincode)) throw new UserError('The ship-to pincode should be 6 digits.');
  return ship;
}

/**
 * Updates the logistics of an issued invoice: who carries it, the tracking number and how far it has got. This is the one part of
 * an invoice that changes after issue, because it isn't part of the tax document — what was billed and to whom stays frozen.
 */
export function setDelivery(db: Db, id: string, update: DeliveryUpdate): Invoice {
  const invoice = getInvoice(db, id);
  if (invoice.status === 'cancelled') throw new UserError('This invoice is cancelled.');
  if (!(update.status in DELIVERY_STATUS_LABEL)) throw new UserError('Choose a delivery status.');
  const deliveredOn = update.status === 'delivered' ? (update.deliveredOn || invoice.deliveredOn || todayIso()) : null;
  if (deliveredOn !== null && !isIsoDate(deliveredOn)) throw new UserError('Enter a valid delivery date.');
  if (deliveredOn !== null && deliveredOn < invoice.issueDate) throw new UserError("It can't have been delivered before the invoice date.");
  run(db, 'UPDATE invoices SET delivery_status = ?, transport = ?, tracking_no = ?, delivered_on = ?, updated_at = ? WHERE id = ?', update.status, optionalText(update.transport, 'Transport', 80), optionalText(update.trackingNo, 'Tracking number', 60), deliveredOn, nowIso(), id);
  return getInvoice(db, id);
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
    if (requireInt(l.discountPaise ?? 0, 'Item discount', { max: MAX_PAISE }) > l.qty * l.unitPricePaise) throw new UserError("An item's discount can't be more than the item itself.");
    if (l.ratePercent !== undefined && l.ratePercent !== null && !isValidRate(l.ratePercent)) throw new UserError('The GST rate on an item should be a number from 0 to 100, with at most two decimals.');
    optionalText(l.note ?? '', 'Item note', 120);
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
    const design = get<{ name: string; hsn_code: string; gst_rate_percent: number | null }>(db, 'SELECT name, hsn_code, gst_rate_percent FROM designs WHERE id = ?', variant.designId)!;
    const amount = l.qty * l.unitPricePaise;
    const lineDiscount = l.discountPaise ?? 0;
    const rate = resolveRate({ override: l.ratePercent, designRate: design.gst_rate_percent, qty: l.qty, netPaise: amount - lineDiscount }, settings);
    return { l, variant, design, index, amount, lineDiscount, rate, note: optionalText(l.note ?? '', 'Item note', 120) };
  });
  const net = items.reduce((s, i) => s + i.amount - i.lineDiscount, 0);
  if (discount > net) throw new UserError("The discount can't be more than the invoice subtotal.");
  const totals = computeInvoice({
    lines: items.map((i) => ({ amountPaise: i.amount, discountPaise: i.lineDiscount, ratePercent: i.rate })),
    discountPaise: discount,
    intraState,
    inclusive: settings.pricesIncludeGst,
    roundOff: settings.roundOff,
  });
  return { items, totals };
}

/**
 * Issues an invoice. `exceptQuoteId` is the quote this invoice is being made from: pieces held by that quote are its own to take,
 * while pieces held by any other live quote are not for sale.
 */
export function createInvoice(db: Db, input: InvoiceInput, opts: { exceptQuoteId?: string } = {}): Invoice {
  const settings = getSettings(db);

  if (input.dueDate !== null && !isIsoDate(input.dueDate)) throw new UserError('Enter a valid due date.');
  if (input.dueDate !== null && isIsoDate(input.issueDate) && input.dueDate < input.issueDate) throw new UserError("The due date can't be before the invoice date.");
  const { type, customer, buyer, placeOfSupply, intraState, discount, notes } = checkDocument(db, settings, input);

  const receivedNow = input.payment ? requireInt(input.payment.amountPaise, 'Payment', { max: MAX_PAISE }) : 0;
  const advanceToApply = input.applyAdvancePaise ? requireInt(input.applyAdvancePaise, 'Advance to apply', { max: MAX_PAISE }) : 0;
  if (advanceToApply > 0 && !customer) throw new UserError("Advance can only be applied to a saved customer's invoice.");

  const seller = sellerSnapshot(settings, settings.invoiceTerms);
  const shipTo = checkShipTo(input.shipTo);
  const transport = optionalText(input.transport, 'Transport', 80);
  const trackingNo = optionalText(input.trackingNo, 'Tracking number', 60);
  const deliveryStatus: DeliveryStatus = input.deliveryStatus && input.deliveryStatus in DELIVERY_STATUS_LABEL ? input.deliveryStatus : shipTo || transport ? 'pending' : 'none';
  const { series, prefix } = seriesOf(settings, type);

  const id = newId();
  tx(db, () => {
    const { items, totals } = priceLines(db, settings, input.lines, discount, intraState);

    const fy = financialYear(input.issueDate);
    const seq = nextSequence(db, fy, series);
    const number = formatInvoiceNumber(prefix, fy, seq);
    const now = nowIso();

    try {
      run(
        db,
        `INSERT INTO invoices (id, number, fy, seq, series, type, customer_id, seller_json, buyer_json, place_of_supply, issue_date, due_date, gst_rate_percent, prices_include_gst, intra_state,
           subtotal_paise, line_discount_paise, discount_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise, total_paise, notes, ship_to_json, transport, tracking_no, delivery_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, number, fy, seq, series, type, customer?.id ?? null, JSON.stringify(seller), JSON.stringify(buyer), placeOfSupply, input.issueDate, input.dueDate, settings.gstRatePercent, settings.pricesIncludeGst ? 1 : 0, intraState ? 1 : 0,
        totals.subtotalPaise, totals.lineDiscountPaise, totals.discountPaise, totals.taxablePaise, totals.cgstPaise, totals.sgstPaise, totals.igstPaise, totals.roundOffPaise, totals.totalPaise, notes, shipTo ? JSON.stringify(shipTo) : '', transport, trackingNo, deliveryStatus, now, now,
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new UserError('Another invoice took that number a moment ago. Please try again.');
      throw err;
    }

    const held = heldByQuotes(db, opts.exceptQuoteId ?? '');
    for (const i of items) {
      const h = held.get(i.variant.id);
      if (h && i.variant.stock - i.l.qty < h.qty) {
        const free = Math.max(0, i.variant.stock - h.qty);
        throw new UserError(`Only ${free} of ${i.variant.sku} can be sold: ${h.qty} ${h.qty === 1 ? 'is' : 'are'} being held for ${h.quotes.length === 1 ? 'quote' : 'quotes'} ${h.quotes.join(', ')}.`);
      }
      run(
        db,
        'INSERT INTO invoice_lines (id, invoice_id, variant_id, position, design_name, color, size, sku, hsn, qty, unit_price_paise, amount_paise, unit_cost_paise, gst_rate_percent, line_discount_paise, note, taxable_paise, tax_paise) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        newId(), id, i.variant.id, i.index, i.design.name, i.variant.color, i.variant.size, i.variant.sku, i.design.hsn_code, i.l.qty, i.l.unitPricePaise, i.amount, i.variant.unitCostPaise, i.rate, i.lineDiscount, i.note, totals.lines[i.index]!.taxablePaise, totals.lines[i.index]!.taxPaise,
      );
      // Throws "Not enough stock" if short, which rolls back the whole invoice.
      recordMovement(db, i.variant.id, -i.l.qty, 'sale', `Invoice ${number}`, { type: 'invoice', id });
    }

    onInvoiceIssued(db, { customerId: customer?.id ?? null, invoiceId: id, number, totalPaise: totals.totalPaise, discountPaise: totals.discountPaise, redeemPoints: input.redeemPoints ? requireInt(input.redeemPoints, 'Loyalty points', { max: 1_000_000 }) : 0 });
    fulfilWishes(db, customer?.id ?? null, items.map((i) => i.variant.designId));

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
        accountId: input.payment!.accountId,
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
  const live = invoice.creditNotes.filter((c) => c.status === 'issued');
  if (live.length > 0) throw new UserError(`${invoice.number} has ${live.length === 1 ? 'a credit note' : 'credit notes'} (${live.map((c) => c.number).join(', ')}). Cancel ${live.length === 1 ? 'it' : 'them'} first.`);
  const why = optionalText(reason, 'Reason', 200);

  tx(db, () => {
    onInvoiceCancelled(db, id, invoice.number);
    releaseInvoicePayments(db, id, `Invoice ${invoice.number} cancelled`);
    for (const line of invoice.lines) {
      // If the variant has since been archived there is no shelf to put the pieces back on.
      const live = get(db, 'SELECT 1 AS x FROM variants WHERE id = ? AND deleted_at IS NULL', line.variantId);
      if (live) recordMovement(db, line.variantId, line.qty, 'return', `Invoice ${invoice.number} cancelled`, { type: 'invoice', id });
    }
    run(db, "UPDATE invoices SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?", nowIso(), why, nowIso(), id);
    reopenQuoteLines(db, invoice);
  });
  return getInvoice(db, id);
}

/**
 * If this invoice was made from a quote, the pieces on it are available to invoice again: the quote's "invoiced" counts go back
 * down, and a quote that had been fully invoiced is open once more.
 */
function reopenQuoteLines(db: Db, invoice: Invoice): void {
  const quotes = all<{ proforma_id: string }>(db, 'SELECT proforma_id FROM proforma_invoices WHERE invoice_id = ?', invoice.id);
  for (const q of quotes) {
    for (const line of invoice.lines) {
      run(db, 'UPDATE proforma_lines SET invoiced_qty = MAX(0, invoiced_qty - ?) WHERE proforma_id = ? AND variant_id = ?', line.qty, q.proforma_id, line.variantId);
    }
    run(db, "UPDATE proformas SET status = 'open', updated_at = ? WHERE id = ? AND status = 'converted'", nowIso(), q.proforma_id);
  }
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
