import { invoiceStatus, isIsoDate, taxByRate, todayIso, localDateOf } from '../../shared/gst';
import { formatMoney } from '../../shared/money';
import { matchesAll } from '../../shared/search';
import { sameState } from '../../shared/states';
import {
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  type BillLine,
  type BillLineKind,
  type BillPayment,
  type DuesBuckets,
  type Party,
  type PayablesReport,
  type PayablesRow,
  type PaymentMethod,
  type PurchaseBill,
  type PurchaseBillInput,
  type PurchaseBillQuery,
  type PurchaseBillSummary,
  type PurchasesSummary,
  type SupplierLedger,
  type SupplierLedgerEntry,
  type SupplierPayment,
  type SupplierPaymentInput,
} from '../../shared/types';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, isUniqueViolation, newId, nowIso, optionalText, requireInt, requireText } from './common';
import { getVariant, recordMovement } from './inventory';
import { getSettings } from './settings';
import { getSupplier, listSuppliers } from './suppliers';

const MAX_PAISE = 100_000_000_00;

// ── Rows ────────────────────────────────────────────────────────────────────
interface BillRow {
  id: string;
  supplier_id: string;
  bill_number: string;
  bill_date: string;
  due_date: string | null;
  supplier_json: string;
  place_of_supply: string;
  intra_state: number;
  itc_eligible: number;
  tax_summary_json: string;
  subtotal_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  round_off_paise: number;
  total_paise: number;
  notes: string;
  status: 'open' | 'cancelled';
  cancelled_at: string | null;
  cancel_reason: string;
  created_at: string;
  supplier_name: string;
}

const SELECT = 'SELECT b.*, s.name AS supplier_name FROM purchase_bills b JOIN suppliers s ON s.id = b.supplier_id';

// Same rule as invoices: the amount on a bill is what is on live allocations of payments that have not been voided.
const LIVE_ALLOCATION = 'a.released_at IS NULL AND p.voided_at IS NULL';

function loadPaid(db: Db): Map<string, number> {
  return new Map(all<{ bill_id: string; s: number }>(db, `SELECT a.bill_id, SUM(a.amount_paise) AS s FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id = a.payment_id WHERE ${LIVE_ALLOCATION} GROUP BY a.bill_id`).map((r) => [r.bill_id, r.s]));
}
const paidFor = (db: Db, billId: string): number => get<{ s: number }>(db, `SELECT COALESCE(SUM(a.amount_paise), 0) AS s FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id = a.payment_id WHERE a.bill_id = ? AND ${LIVE_ALLOCATION}`, billId)?.s ?? 0;

function toSummary(r: BillRow, paid: number): PurchaseBillSummary {
  return {
    id: r.id,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    billNumber: r.bill_number,
    billDate: r.bill_date,
    dueDate: r.due_date,
    totalPaise: r.total_paise,
    paidPaise: paid,
    status: invoiceStatus({ cancelled: r.status === 'cancelled', totalPaise: r.total_paise, paidPaise: paid, dueDate: r.due_date, today: todayIso() }),
    itcEligible: r.itc_eligible === 1,
  };
}

function toBill(db: Db, r: BillRow): PurchaseBill {
  const lines = all<{ id: string; kind: BillLineKind; material_id: string | null; variant_id: string | null; description: string; hsn: string; qty: number; unit: string; unit_price_paise: number; amount_paise: number; gst_rate_percent: number }>(
    db,
    'SELECT * FROM purchase_bill_lines WHERE bill_id = ? ORDER BY position',
    r.id,
  ).map((l): BillLine => ({ id: l.id, kind: l.kind, materialId: l.material_id, variantId: l.variant_id, description: l.description, hsn: l.hsn, qty: l.qty, unit: l.unit, unitPricePaise: l.unit_price_paise, amountPaise: l.amount_paise, gstRatePercent: l.gst_rate_percent }));
  const payments = all<{ id: string; paid_on: string; method: PaymentMethod; reference: string; amount: number }>(
    db,
    `SELECT p.id, p.paid_on, p.method, p.reference, a.amount_paise AS amount FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id = a.payment_id
     WHERE a.bill_id = ? AND ${LIVE_ALLOCATION} ORDER BY p.paid_on, a.created_at`,
    r.id,
  ).map((p): BillPayment => ({ paymentId: p.id, paidOn: p.paid_on, method: p.method, reference: p.reference, amountPaise: p.amount }));
  return {
    ...toSummary(r, paidFor(db, r.id)),
    supplier: JSON.parse(r.supplier_json) as Party,
    placeOfSupply: r.place_of_supply,
    intraState: r.intra_state === 1,
    taxSummary: JSON.parse(r.tax_summary_json),
    subtotalPaise: r.subtotal_paise,
    taxablePaise: r.taxable_paise,
    cgstPaise: r.cgst_paise,
    sgstPaise: r.sgst_paise,
    igstPaise: r.igst_paise,
    roundOffPaise: r.round_off_paise,
    notes: r.notes,
    lines,
    payments,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
    createdAt: r.created_at,
  };
}

// ── Reads ───────────────────────────────────────────────────────────────────
export function getBill(db: Db, id: string): PurchaseBill {
  const row = get<BillRow>(db, `${SELECT} WHERE b.id = ?`, id);
  if (!row) throw new UserError('That bill no longer exists.');
  return toBill(db, row);
}

export function listBills(db: Db, query: PurchaseBillQuery = {}): PurchaseBillSummary[] {
  const where: string[] = [];
  const params: string[] = [];
  if (query.supplierId) {
    where.push('b.supplier_id = ?');
    params.push(query.supplierId);
  }
  const paid = loadPaid(db);
  return all<BillRow>(db, `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY b.bill_date DESC, b.created_at DESC`, ...params)
    .map((r) => toSummary(r, paid.get(r.id) ?? 0))
    .filter((b) => matchesAll(`${b.billNumber} ${b.supplierName}`, query.search))
    .filter((b) => {
      if (query.status === 'open') return b.status === 'unpaid' || b.status === 'partial' || b.status === 'overdue';
      if (query.status === 'overdue') return b.status === 'overdue';
      if (query.status === 'cancelled') return b.status === 'cancelled';
      return true;
    });
}

// ── Payments to suppliers ───────────────────────────────────────────────────
function outstandingOf(db: Db, billId: string): { number: string; outstanding: number; supplierId: string } {
  const b = get<{ bill_number: string; total_paise: number; status: string; supplier_id: string }>(db, 'SELECT bill_number, total_paise, status, supplier_id FROM purchase_bills WHERE id = ?', billId);
  if (!b) throw new UserError('One of the bills no longer exists.');
  if (b.status === 'cancelled') throw new UserError(`Bill ${b.bill_number} is cancelled and can't take payments.`);
  return { number: b.bill_number, outstanding: b.total_paise - paidFor(db, billId), supplierId: b.supplier_id };
}

interface Unapplied {
  id: string;
  unapplied: number;
}

/** A supplier's payments that still have money not on any bill, oldest first. */
function unappliedPayments(db: Db, supplierId: string): Unapplied[] {
  return all<Unapplied>(
    db,
    `SELECT p.id, p.amount_paise - COALESCE((SELECT SUM(a.amount_paise) FROM supplier_payment_allocations a WHERE a.payment_id = p.id AND a.released_at IS NULL), 0) AS unapplied
     FROM supplier_payments p WHERE p.supplier_id = ? AND p.voided_at IS NULL ORDER BY p.paid_on, p.created_at, p.rowid`,
    supplierId,
  ).filter((r) => r.unapplied > 0);
}

export const advancePaidTo = (db: Db, supplierId: string): number => unappliedPayments(db, supplierId).reduce((s, r) => s + r.unapplied, 0);

function addAllocation(db: Db, paymentId: string, billId: string, amount: number): void {
  run(db, 'INSERT INTO supplier_payment_allocations (id, payment_id, bill_id, amount_paise, created_at) VALUES (?, ?, ?, ?, ?)', newId(), paymentId, billId, amount, nowIso());
}

/** Puts up to `max` of the advance you hold with the supplier onto the bill, oldest payment first. Returns how much was applied. */
function applyAdvance(db: Db, supplierId: string, billId: string, max: number): number {
  return tx(db, () => {
    let remaining = Math.min(max, outstandingOf(db, billId).outstanding);
    let applied = 0;
    for (const p of unappliedPayments(db, supplierId)) {
      if (remaining <= 0) break;
      const take = Math.min(p.unapplied, remaining);
      addAllocation(db, p.id, billId, take);
      remaining -= take;
      applied += take;
    }
    return applied;
  });
}

function recordPaymentTx(db: Db, input: SupplierPaymentInput): string {
  getSupplier(db, input.supplierId);
  const amount = requireInt(input.amountPaise, 'Amount', { min: 1, max: MAX_PAISE });
  if (!(PAYMENT_METHODS as readonly string[]).includes(input.method)) throw new UserError('Choose how the payment was made.');
  if (!isIsoDate(input.paidOn)) throw new UserError('Enter a valid payment date.');
  if (input.paidOn > todayIso()) throw new UserError("The payment date can't be in the future.");
  const reference = optionalText(input.reference, 'Reference', 60);
  const note = optionalText(input.note, 'Note', 200);

  const seen = new Set<string>();
  let allocated = 0;
  for (const al of input.allocations ?? []) {
    requireInt(al.amountPaise, 'Allocated amount', { min: 1, max: MAX_PAISE });
    if (seen.has(al.billId)) throw new UserError('The same bill is listed twice.');
    seen.add(al.billId);
    const bill = outstandingOf(db, al.billId);
    if (bill.supplierId !== input.supplierId) throw new UserError(`Bill ${bill.number} belongs to a different supplier.`);
    if (al.amountPaise > bill.outstanding) throw new UserError(`Bill ${bill.number} only has ${formatMoney(bill.outstanding)} left to pay.`);
    allocated += al.amountPaise;
  }
  if (allocated > amount) throw new UserError('More is applied to bills than was paid.');

  const id = newId();
  const now = nowIso();
  run(db, 'INSERT INTO supplier_payments (id, supplier_id, amount_paise, method, reference, paid_on, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, input.supplierId, amount, input.method, reference, input.paidOn, note, now, now);
  for (const al of input.allocations ?? []) addAllocation(db, id, al.billId, al.amountPaise);
  return id;
}

interface PaymentRow {
  id: string;
  supplier_id: string;
  supplier_name: string;
  amount_paise: number;
  method: PaymentMethod;
  reference: string;
  paid_on: string;
  note: string;
  voided_at: string | null;
  void_reason: string;
}

const PAYMENT_SELECT = 'SELECT p.*, s.name AS supplier_name FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id';

function toPayment(db: Db, r: PaymentRow): SupplierPayment {
  const allocations = all<{ bill_id: string; bill_number: string; amount_paise: number }>(
    db,
    'SELECT a.bill_id, b.bill_number, a.amount_paise FROM supplier_payment_allocations a JOIN purchase_bills b ON b.id = a.bill_id WHERE a.payment_id = ? AND a.released_at IS NULL ORDER BY a.created_at',
    r.id,
  ).map((a) => ({ billId: a.bill_id, billNumber: a.bill_number, amountPaise: a.amount_paise }));
  const voided = r.voided_at !== null;
  const applied = voided ? 0 : allocations.reduce((s, a) => s + a.amountPaise, 0);
  return {
    id: r.id,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    amountPaise: r.amount_paise,
    method: r.method,
    reference: r.reference,
    paidOn: r.paid_on,
    note: r.note,
    allocations: voided ? [] : allocations,
    appliedPaise: applied,
    advancePaise: voided ? 0 : r.amount_paise - applied,
    voided,
    voidReason: r.void_reason,
  };
}

export function getSupplierPayment(db: Db, id: string): SupplierPayment {
  const row = get<PaymentRow>(db, `${PAYMENT_SELECT} WHERE p.id = ?`, id);
  if (!row) throw new UserError('That payment no longer exists.');
  return toPayment(db, row);
}

export function listSupplierPayments(db: Db, query: { supplierId?: string } = {}): SupplierPayment[] {
  const where = query.supplierId ? 'WHERE p.supplier_id = ?' : '';
  return all<PaymentRow>(db, `${PAYMENT_SELECT} ${where} ORDER BY p.paid_on DESC, p.created_at DESC, p.rowid DESC`, ...(query.supplierId ? [query.supplierId] : [])).map((r) => toPayment(db, r));
}

export function recordSupplierPayment(db: Db, input: SupplierPaymentInput): SupplierPayment {
  return getSupplierPayment(db, tx(db, () => recordPaymentTx(db, input)));
}

export function voidSupplierPayment(db: Db, id: string, reason: string): SupplierPayment {
  const p = getSupplierPayment(db, id);
  if (p.voided) throw new UserError('This payment is already reversed.');
  const at = nowIso();
  run(db, 'UPDATE supplier_payments SET voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ?', at, optionalText(reason, 'Reason', 200), at, id);
  return getSupplierPayment(db, id);
}

/** Sets the advance you hold with a supplier against one of their open bills. */
export function applyAdvanceToBill(db: Db, billId: string): PurchaseBill {
  const bill = getBill(db, billId);
  if (bill.status === 'cancelled') throw new UserError('This bill is cancelled.');
  if (bill.totalPaise - bill.paidPaise <= 0) throw new UserError('This bill is already paid.');
  if (advancePaidTo(db, bill.supplierId) <= 0) throw new UserError('You have no advance with this supplier to apply.');
  applyAdvance(db, bill.supplierId, billId, bill.totalPaise - bill.paidPaise);
  return getBill(db, billId);
}

// ── Entering a bill ─────────────────────────────────────────────────────────
export function createBill(db: Db, input: PurchaseBillInput): PurchaseBill {
  const settings = getSettings(db);
  const supplier = getSupplier(db, input.supplierId);
  const billNumber = requireText(input.billNumber, "The supplier's bill number", 40);
  if (!isIsoDate(input.billDate)) throw new UserError('Enter a valid bill date.');
  if (input.billDate > todayIso()) throw new UserError("The bill date can't be in the future.");
  if (input.dueDate !== null && !isIsoDate(input.dueDate)) throw new UserError('Enter a valid due date.');
  if (input.dueDate !== null && input.dueDate < input.billDate) throw new UserError("The due date can't be before the bill date.");
  const notes = optionalText(input.notes, 'Notes', 300);
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new UserError('Add at least one item to the bill.');
  if (input.lines.length > 100) throw new UserError('A bill can have at most 100 items.');

  const itcEligible = input.itcEligible ?? !!supplier.gstin;
  if (itcEligible && !supplier.gstin) throw new UserError(`${supplier.name} has no GSTIN, so the GST on this bill can't be claimed back. Add their GSTIN, or untick input credit.`);

  const placeOfSupply = supplier.state || settings.state;
  const intraState = !settings.state || sameState(placeOfSupply, settings.state);

  const lines = input.lines.map((l, index) => {
    if (!['material', 'variant', 'other'].includes(l.kind)) throw new UserError(`Item ${index + 1}: choose what kind of item it is.`);
    const rate = l.gstRatePercent;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 100) throw new UserError(`Item ${index + 1}: GST rate must be between 0 and 100.`);
    if (rate > 0 && !supplier.gstin) throw new UserError(`${supplier.name} has no GSTIN, so they can't charge GST. Set the GST rate to 0 for item ${index + 1}, or add their GSTIN.`);
    const unitPrice = requireInt(l.unitPricePaise, `Item ${index + 1} price`, { max: MAX_PAISE });
    if (typeof l.qty !== 'number' || !Number.isFinite(l.qty) || l.qty <= 0 || l.qty > 1_000_000) throw new UserError(`Item ${index + 1}: enter a quantity above zero.`);

    let description = optionalText(l.description, 'Description', 120);
    let hsn = optionalText(l.hsn, 'HSN code', 12);
    let unit = '';
    let materialId: string | null = null;
    let variantId: string | null = null;
    if (l.kind === 'material') {
      const m = get<{ id: string; name: string; unit: string }>(db, 'SELECT id, name, unit FROM raw_materials WHERE id = ? AND deleted_at IS NULL', l.materialId ?? '');
      if (!m) throw new UserError(`Item ${index + 1}: choose the raw material.`);
      materialId = m.id;
      unit = m.unit;
      description = description || m.name;
    } else if (l.kind === 'variant') {
      if (!Number.isInteger(l.qty)) throw new UserError(`Item ${index + 1}: sarees come in whole pieces.`);
      const v = get<{ id: string; sku: string; color: string; size: string; name: string; hsn_code: string }>(
        db,
        'SELECT v.id, v.sku, v.color, v.size, d.name, d.hsn_code FROM variants v JOIN designs d ON d.id = v.design_id WHERE v.id = ? AND v.deleted_at IS NULL',
        l.variantId ?? '',
      );
      if (!v) throw new UserError(`Item ${index + 1}: choose the saree.`);
      variantId = v.id;
      unit = 'pc';
      description = description || `${v.name} · ${v.color} · ${v.size}`;
      hsn = hsn || v.hsn_code;
    } else if (!description) {
      throw new UserError(`Item ${index + 1}: describe what it is (freight, packing...).`);
    }
    return { l, index, kind: l.kind as BillLineKind, materialId, variantId, description, hsn, unit, unitPrice, rate, amount: Math.round(l.qty * unitPrice) };
  });

  const tax = taxByRate(lines.map((x) => ({ taxablePaise: x.amount, ratePercent: x.rate })), intraState);
  const raw = tax.taxablePaise + tax.taxPaise;
  let total = tax.totalPaise;
  let roundOff = tax.roundOffPaise;
  if (input.billTotalPaise !== undefined && input.billTotalPaise !== null) {
    const printed = requireInt(input.billTotalPaise, 'Bill total', { max: MAX_PAISE });
    // A few rupees of rounding is normal; more than that means a quantity, rate or GST rate is wrong.
    if (Math.abs(printed - raw) > 500) throw new UserError(`The bill total you entered (${formatMoney(printed)}) doesn't match its items (${formatMoney(raw)}). Check the quantities, prices and GST rates.`);
    total = printed;
    roundOff = printed - raw;
  }

  const advanceToApply = input.applyAdvancePaise ? requireInt(input.applyAdvancePaise, 'Advance to apply', { max: MAX_PAISE }) : 0;
  const paidNow = input.paidNow ? requireInt(input.paidNow.amountPaise, 'Payment', { max: MAX_PAISE }) : 0;

  const id = newId();
  tx(db, () => {
    const now = nowIso();
    try {
      run(
        db,
        `INSERT INTO purchase_bills (id, supplier_id, bill_number, bill_date, due_date, supplier_json, place_of_supply, intra_state, itc_eligible, tax_summary_json, subtotal_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise, total_paise, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, supplier.id, billNumber, input.billDate, input.dueDate, JSON.stringify({ name: supplier.name, gstin: supplier.gstin, address: supplier.address, city: supplier.city, state: supplier.state, pincode: supplier.pincode, phone: supplier.phone } satisfies Party), placeOfSupply, intraState ? 1 : 0, itcEligible ? 1 : 0, JSON.stringify(tax.groups),
        tax.taxablePaise, tax.taxablePaise, tax.cgstPaise, tax.sgstPaise, tax.igstPaise, roundOff, total, notes, now, now,
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new UserError(`You have already entered bill ${billNumber} from ${supplier.name}.`);
      throw err;
    }

    for (const x of lines) {
      // Costs first, so the stock movement below records the new cost.
      if (input.updateCosts) {
        if (x.kind === 'material') run(db, 'UPDATE raw_materials SET unit_cost_paise = ?, updated_at = ? WHERE id = ?', x.unitPrice, nowIso(), x.materialId);
        if (x.kind === 'variant') {
          const materialCost = getVariant(db, x.variantId!).materialCostPaise;
          run(db, 'UPDATE variants SET base_cost_paise = ?, updated_at = ? WHERE id = ?', Math.max(0, x.unitPrice - materialCost), nowIso(), x.variantId);
        }
      }
      run(
        db,
        'INSERT INTO purchase_bill_lines (id, bill_id, position, kind, material_id, variant_id, description, hsn, qty, unit, unit_price_paise, amount_paise, gst_rate_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        newId(), id, x.index, x.kind, x.materialId, x.variantId, x.description, x.hsn, x.l.qty, x.unit, x.unitPrice, x.amount, x.rate,
      );
      if (x.kind === 'variant') recordMovement(db, x.variantId!, x.l.qty, 'purchase', `Bill ${billNumber} from ${supplier.name}`, { type: 'purchase_bill', id });
    }

    let due = total;
    if (advanceToApply > 0) {
      const wanted = Math.min(advanceToApply, due);
      const applied = applyAdvance(db, supplier.id, id, wanted);
      if (applied < wanted) throw new UserError(`Only ${formatMoney(applied)} of advance was available to apply.`);
      due -= applied;
    }
    if (paidNow > 0) {
      if (paidNow > due) throw new UserError(`The payment (${formatMoney(paidNow)}) is more than the ${formatMoney(due)} due on this bill.`);
      recordPaymentTx(db, { supplierId: supplier.id, amountPaise: paidNow, method: input.paidNow!.method, reference: input.paidNow!.reference ?? '', paidOn: input.billDate, note: `With bill ${billNumber}`, allocations: [{ billId: id, amountPaise: paidNow }] });
    }
  });
  return getBill(db, id);
}

/** Cancels a bill that was a mistake: any stock it brought in goes out again, and money paid against it becomes an advance with the supplier. */
export function cancelBill(db: Db, id: string, reason: string): PurchaseBill {
  const bill = getBill(db, id);
  if (bill.status === 'cancelled') throw new UserError('This bill is already cancelled.');
  const why = optionalText(reason, 'Reason', 200);
  tx(db, () => {
    for (const l of bill.lines) {
      if (l.kind !== 'variant' || !l.variantId) continue;
      if (!get(db, 'SELECT 1 AS x FROM variants WHERE id = ? AND deleted_at IS NULL', l.variantId)) continue;
      try {
        recordMovement(db, l.variantId, -l.qty, 'purchase', `Bill ${bill.billNumber} cancelled`, { type: 'purchase_bill', id });
      } catch (err) {
        if (err instanceof UserError) throw new UserError(`Some of the pieces from this bill are already gone from stock (sold or adjusted), so it can't be cancelled. ${err.message}`);
        throw err;
      }
    }
    run(db, 'UPDATE supplier_payment_allocations SET released_at = ? WHERE bill_id = ? AND released_at IS NULL', nowIso(), id);
    run(db, "UPDATE purchase_bills SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?", nowIso(), why, nowIso(), id);
  });
  return getBill(db, id);
}

// ── Ledger, payables, summary ───────────────────────────────────────────────
interface Event {
  date: string;
  at: string;
  kind: SupplierLedgerEntry['kind'];
  description: string;
  billId?: string;
  billed: number;
  paid: number;
}

/** A running statement with each supplier: bills add to what you owe, payments reduce it. Cancelled bills and reversed payments stay visible. */
export function supplierLedger(db: Db, supplierId: string): SupplierLedger {
  const supplier = getSupplier(db, supplierId);
  const events: Event[] = [];
  for (const b of all<{ id: string; bill_number: string; total_paise: number; bill_date: string; created_at: string; status: string; cancelled_at: string | null; cancel_reason: string }>(db, 'SELECT id, bill_number, total_paise, bill_date, created_at, status, cancelled_at, cancel_reason FROM purchase_bills WHERE supplier_id = ?', supplierId)) {
    events.push({ date: b.bill_date, at: b.created_at, kind: 'bill', description: `Bill ${b.bill_number}`, billId: b.id, billed: b.total_paise, paid: 0 });
    if (b.status === 'cancelled' && b.cancelled_at) events.push({ date: localDateOf(b.cancelled_at), at: b.cancelled_at, kind: 'bill-cancelled', description: `Bill ${b.bill_number} cancelled${b.cancel_reason ? `: ${b.cancel_reason}` : ''}`, billId: b.id, billed: 0, paid: b.total_paise });
  }
  const payments = all<{ id: string; amount_paise: number; method: PaymentMethod; reference: string; paid_on: string; created_at: string; voided_at: string | null; void_reason: string }>(db, 'SELECT id, amount_paise, method, reference, paid_on, created_at, voided_at, void_reason FROM supplier_payments WHERE supplier_id = ?', supplierId);
  for (const p of payments) {
    const detail = getSupplierPayment(db, p.id);
    const via = [PAYMENT_METHOD_LABEL[p.method], p.reference].filter(Boolean).join(' · ');
    const where = detail.voided ? '' : detail.allocations.length === 0 ? ' - advance' : detail.advancePaise > 0 ? ` - ${detail.allocations.map((a) => a.billNumber).join(', ')} + advance` : ` - ${detail.allocations.map((a) => a.billNumber).join(', ')}`;
    events.push({ date: p.paid_on, at: p.created_at, kind: 'payment', description: `Paid (${via})${where}`, billed: 0, paid: p.amount_paise });
    if (p.voided_at) events.push({ date: localDateOf(p.voided_at), at: p.voided_at, kind: 'payment-voided', description: `Payment reversed (${via})${p.void_reason ? `: ${p.void_reason}` : ''}`, billed: p.amount_paise, paid: 0 });
  }
  events.sort((a, b) => (a.date === b.date ? a.at.localeCompare(b.at) : a.date.localeCompare(b.date)));
  let balance = 0;
  const entries = events.map((e): SupplierLedgerEntry => {
    balance += e.billed - e.paid;
    return { date: e.date, kind: e.kind, description: e.description, billId: e.billId, billedPaise: e.billed, paidPaise: e.paid, balancePaise: balance };
  });
  const paid = payments.filter((p) => !p.voided_at).reduce((s, p) => s + p.amount_paise, 0);
  return { supplier, entries, billedPaise: supplier.billedPaise, paidPaise: paid, balancePaise: supplier.billedPaise - paid };
}

const DAY = 86_400_000;
const daysBetween = (fromIso: string, toIso: string): number => Math.round((Date.parse(toIso) - Date.parse(fromIso)) / DAY);
const emptyBuckets = (): DuesBuckets => ({ currentPaise: 0, days1to30Paise: 0, days31to60Paise: 0, days61plusPaise: 0 });
function addToBucket(b: DuesBuckets, daysPastDue: number, amount: number): void {
  if (daysPastDue <= 0) b.currentPaise += amount;
  else if (daysPastDue <= 30) b.days1to30Paise += amount;
  else if (daysPastDue <= 60) b.days31to60Paise += amount;
  else b.days61plusPaise += amount;
}

/** What you owe, to whom, aged by how far past each bill's due date it is (the bill date if no due date was set). */
export function payablesReport(db: Db): PayablesReport {
  const today = todayIso();
  const suppliers = new Map(listSuppliers(db).map((s) => [s.id, s]));
  const rows = new Map<string, PayablesRow>();
  const totals = emptyBuckets();
  for (const bill of listBills(db, { status: 'open' })) {
    const owed = bill.totalPaise - bill.paidPaise;
    if (owed <= 0) continue;
    let row = rows.get(bill.supplierId);
    if (!row) {
      const s = suppliers.get(bill.supplierId);
      row = { supplierId: bill.supplierId, supplierName: bill.supplierName, phone: s?.phone ?? '', openBills: 0, outstandingPaise: 0, overduePaise: 0, oldestDueDate: null, advancePaise: s?.advancePaise ?? 0, ...emptyBuckets() };
      rows.set(bill.supplierId, row);
    }
    const due = bill.dueDate ?? bill.billDate;
    const past = daysBetween(due, today);
    row.openBills += 1;
    row.outstandingPaise += owed;
    if (past > 0) row.overduePaise += owed;
    if (!row.oldestDueDate || due < row.oldestDueDate) row.oldestDueDate = due;
    addToBucket(row, past, owed);
    addToBucket(totals, past, owed);
  }
  const list = [...rows.values()].sort((a, b) => b.overduePaise - a.overduePaise || b.outstandingPaise - a.outstandingPaise);
  return {
    rows: list,
    ...totals,
    outstandingPaise: list.reduce((s, r) => s + r.outstandingPaise, 0),
    overduePaise: list.reduce((s, r) => s + r.overduePaise, 0),
    advancePaidPaise: [...suppliers.values()].reduce((s, x) => s + Math.max(x.advancePaise, 0), 0),
  };
}

export function purchasesSummary(db: Db): PurchasesSummary {
  const payables = payablesReport(db);
  const month = todayIso().slice(0, 7);
  const bills = listBills(db).filter((b) => b.status !== 'cancelled');
  const thisMonth = bills.filter((b) => b.billDate.startsWith(month));
  return {
    outstandingPaise: payables.outstandingPaise,
    overduePaise: payables.overduePaise,
    openBills: payables.rows.reduce((s, r) => s + r.openBills, 0),
    monthBilledPaise: thisMonth.reduce((s, b) => s + b.totalPaise, 0),
    monthBills: thisMonth.length,
    supplierCount: listSuppliers(db).length,
  };
}

/** Input tax credit on bills dated in the range, for the GST return. */
export function inputCreditIn(db: Db, range: { from: string; to: string }) {
  const r = get<{ n: number; taxable: number; cgst: number; sgst: number; igst: number }>(
    db,
    `SELECT COUNT(*) AS n, COALESCE(SUM(taxable_paise), 0) AS taxable, COALESCE(SUM(cgst_paise), 0) AS cgst, COALESCE(SUM(sgst_paise), 0) AS sgst, COALESCE(SUM(igst_paise), 0) AS igst
     FROM purchase_bills WHERE status = 'open' AND itc_eligible = 1 AND bill_date BETWEEN ? AND ?`,
    range.from,
    range.to,
  )!;
  return { bills: r.n, taxablePaise: r.taxable, cgstPaise: r.cgst, sgstPaise: r.sgst, igstPaise: r.igst, taxPaise: r.cgst + r.sgst + r.igst };
}
