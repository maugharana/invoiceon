import { isIsoDate, todayIso } from '../../shared/gst';
import { formatMoney } from '../../shared/money';
import { matchesAll } from '../../shared/search';
import { PAYMENT_METHODS, type InvoicePayment, type Payment, type PaymentAllocation, type PaymentInput, type PaymentMethod, type PaymentQuery } from '../../shared/types';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, newId, nowIso, optionalText, requireInt } from './common';

const MAX_PAISE = 100_000_000_00;

// A payment's *applied* part is the sum of its live allocations (not released, payment not voided).
// Its *advance* is what's left. That leftover is the only place "advance" exists — there is no separate balance to drift.
const LIVE_ALLOCATION = 'a.released_at IS NULL AND p.voided_at IS NULL';

// ── Invoice-side lookups (used by the invoice service, which imports this file) ─
/** Amount received against every invoice, in one query. */
export function loadPaid(db: Db): Map<string, number> {
  const rows = all<{ invoice_id: string; s: number }>(db, `SELECT a.invoice_id, SUM(a.amount_paise) AS s FROM payment_allocations a JOIN payments p ON p.id = a.payment_id WHERE ${LIVE_ALLOCATION} GROUP BY a.invoice_id`);
  return new Map(rows.map((r) => [r.invoice_id, r.s]));
}

export function paidFor(db: Db, invoiceId: string): number {
  return get<{ s: number }>(db, `SELECT COALESCE(SUM(a.amount_paise), 0) AS s FROM payment_allocations a JOIN payments p ON p.id = a.payment_id WHERE a.invoice_id = ? AND ${LIVE_ALLOCATION}`, invoiceId)?.s ?? 0;
}

export function paymentsOnInvoice(db: Db, invoiceId: string): InvoicePayment[] {
  return all<{ id: string; received_on: string; method: PaymentMethod; reference: string; amount: number }>(
    db,
    `SELECT p.id, p.received_on, p.method, p.reference, a.amount_paise AS amount FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
     WHERE a.invoice_id = ? AND ${LIVE_ALLOCATION} ORDER BY p.received_on, a.created_at`,
    invoiceId,
  ).map((r) => ({ paymentId: r.id, receivedOn: r.received_on, method: r.method, reference: r.reference, amountPaise: r.amount }));
}

/** What's still owed on an issued invoice, or a UserError if it can't take payments. */
function outstandingOf(db: Db, invoiceId: string): { number: string; outstanding: number; customerId: string | null } {
  const inv = get<{ number: string; total_paise: number; status: string; customer_id: string | null }>(db, 'SELECT number, total_paise, status, customer_id FROM invoices WHERE id = ?', invoiceId);
  if (!inv) throw new UserError('One of the invoices no longer exists.');
  if (inv.status === 'cancelled') throw new UserError(`${inv.number} is cancelled and can't take payments.`);
  return { number: inv.number, outstanding: inv.total_paise - paidFor(db, invoiceId), customerId: inv.customer_id };
}

// ── Advance ─────────────────────────────────────────────────────────────────
interface Unapplied {
  id: string;
  unapplied: number;
}

/** A customer's payments that still have money not on any invoice, oldest first. */
function unappliedPayments(db: Db, customerId: string): Unapplied[] {
  return all<Unapplied>(
    db,
    `SELECT p.id, p.amount_paise - COALESCE((SELECT SUM(a.amount_paise) FROM payment_allocations a WHERE a.payment_id = p.id AND a.released_at IS NULL), 0) AS unapplied
     FROM payments p WHERE p.customer_id = ? AND p.voided_at IS NULL ORDER BY p.received_on, p.created_at, p.rowid`,
    customerId,
  ).filter((r) => r.unapplied > 0);
}

export const advanceHeld = (db: Db, customerId: string): number => unappliedPayments(db, customerId).reduce((s, r) => s + r.unapplied, 0);

function addAllocation(db: Db, paymentId: string, invoiceId: string, amount: number): void {
  run(db, 'INSERT INTO payment_allocations (id, payment_id, invoice_id, amount_paise, created_at) VALUES (?, ?, ?, ?, ?)', newId(), paymentId, invoiceId, amount, nowIso());
}

/** Puts up to `max` of the customer's held advance onto the invoice, oldest payment first. Returns how much was applied. */
export function applyAdvance(db: Db, customerId: string, invoiceId: string, max: number): number {
  return tx(db, () => {
    let remaining = Math.min(max, outstandingOf(db, invoiceId).outstanding);
    let applied = 0;
    for (const p of unappliedPayments(db, customerId)) {
      if (remaining <= 0) break;
      const take = Math.min(p.unapplied, remaining);
      addAllocation(db, p.id, invoiceId, take);
      remaining -= take;
      applied += take;
    }
    return applied;
  });
}

// ── Recording ───────────────────────────────────────────────────────────────
export interface PaymentDraft extends Omit<PaymentInput, 'method'> {
  method: PaymentMethod;
}

/** Validates and writes a payment and its allocations. Callers wrap it in their own transaction when it belongs to a bigger step. */
export function recordPaymentTx(db: Db, input: PaymentDraft): string {
  const amount = requireInt(input.amountPaise, 'Amount', { min: 1, max: MAX_PAISE });
  if (!(PAYMENT_METHODS as readonly string[]).includes(input.method)) throw new UserError('Choose how the payment was made.');
  if (!isIsoDate(input.receivedOn)) throw new UserError('Enter a valid payment date.');
  if (input.receivedOn > todayIso()) throw new UserError('The payment date can\'t be in the future.');
  const reference = optionalText(input.reference, 'Reference', 60);
  const note = optionalText(input.note, 'Note', 200);

  if (input.customerId && !get(db, 'SELECT 1 AS x FROM customers WHERE id = ? AND deleted_at IS NULL', input.customerId)) throw new UserError('That customer no longer exists.');

  const allocations = input.allocations ?? [];
  const seen = new Set<string>();
  let allocated = 0;
  for (const al of allocations) {
    requireInt(al.amountPaise, 'Allocated amount', { min: 1, max: MAX_PAISE });
    if (seen.has(al.invoiceId)) throw new UserError('The same invoice is listed twice.');
    seen.add(al.invoiceId);
    const inv = outstandingOf(db, al.invoiceId);
    // A payment can only settle its own customer's invoices; walk-in invoices only take walk-in payments.
    if ((inv.customerId ?? null) !== (input.customerId ?? null)) throw new UserError(`${inv.number} belongs to a different customer.`);
    if (al.amountPaise > inv.outstanding) throw new UserError(`${inv.number} only has ${formatMoney(inv.outstanding)} left to pay.`);
    allocated += al.amountPaise;
  }
  if (allocated > amount) throw new UserError('More is applied to invoices than was received.');
  if (allocated < amount && !input.customerId) throw new UserError('A payment with no customer must be applied in full to an invoice. Choose a customer to keep the rest as advance.');

  const id = newId();
  const now = nowIso();
  run(db, 'INSERT INTO payments (id, customer_id, amount_paise, method, reference, received_on, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, input.customerId ?? null, amount, input.method, reference, input.receivedOn, note, now, now);
  for (const al of allocations) addAllocation(db, id, al.invoiceId, al.amountPaise);
  return id;
}

export function recordPayment(db: Db, input: PaymentInput): Payment {
  const id = tx(db, () => recordPaymentTx(db, input));
  return getPayment(db, id);
}

// ── Reading ─────────────────────────────────────────────────────────────────
interface PaymentRow {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  amount_paise: number;
  method: PaymentMethod;
  reference: string;
  received_on: string;
  note: string;
  voided_at: string | null;
  void_reason: string;
  created_at: string;
}

const SELECT = `SELECT p.*, c.name AS customer_name FROM payments p LEFT JOIN customers c ON c.id = p.customer_id`;

function toPayment(db: Db, r: PaymentRow): Payment {
  const allocations = all<{ invoice_id: string; number: string; amount_paise: number }>(
    db,
    'SELECT a.invoice_id, i.number, a.amount_paise FROM payment_allocations a JOIN invoices i ON i.id = a.invoice_id WHERE a.payment_id = ? AND a.released_at IS NULL ORDER BY a.created_at',
    r.id,
  ).map((a): PaymentAllocation => ({ invoiceId: a.invoice_id, invoiceNumber: a.number, amountPaise: a.amount_paise }));
  const voided = r.voided_at !== null;
  const applied = voided ? 0 : allocations.reduce((s, a) => s + a.amountPaise, 0);
  return {
    id: r.id,
    customerId: r.customer_id,
    customerName: r.customer_name ?? 'Walk-in customer',
    amountPaise: r.amount_paise,
    method: r.method,
    reference: r.reference,
    receivedOn: r.received_on,
    note: r.note,
    allocations: voided ? [] : allocations,
    appliedPaise: applied,
    advancePaise: voided ? 0 : r.amount_paise - applied,
    voided,
    voidReason: r.void_reason,
    createdAt: r.created_at,
  };
}

export function getPayment(db: Db, id: string): Payment {
  const row = get<PaymentRow>(db, `${SELECT} WHERE p.id = ?`, id);
  if (!row) throw new UserError('That payment no longer exists.');
  return toPayment(db, row);
}

export function listPayments(db: Db, query: PaymentQuery = {}): Payment[] {
  const where: string[] = [];
  const params: string[] = [];
  if (query.customerId) {
    where.push('p.customer_id = ?');
    params.push(query.customerId);
  }
  const rows = all<PaymentRow>(db, `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.received_on DESC, p.created_at DESC, p.rowid DESC`, ...params);
  return rows
    .map((r) => toPayment(db, r))
    .filter((p) => matchesAll(`${p.customerName} ${p.reference} ${p.method} ${p.allocations.map((a) => a.invoiceNumber).join(' ')}`, query.search))
    .filter((p) => (query.status === 'advance' ? !p.voided && p.advancePaise > 0 : query.status === 'voided' ? p.voided : true));
}

// ── Reversing ───────────────────────────────────────────────────────────────
export function voidPayment(db: Db, id: string, reason: string): Payment {
  const payment = getPayment(db, id);
  if (payment.voided) throw new UserError('This payment is already reversed.');
  const why = optionalText(reason, 'Reason', 200);
  run(db, 'UPDATE payments SET voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ?', nowIso(), why, nowIso(), id);
  return getPayment(db, id);
}

/**
 * Called when an invoice is cancelled. Money that was on it goes back to the customer as advance. For a walk-in
 * sale there is no customer to hold it for, so that payment is reversed (the cash goes back across the counter).
 */
export function releaseInvoicePayments(db: Db, invoiceId: string, reason: string): void {
  const live = all<{ id: string; payment_id: string; customer_id: string | null }>(
    db,
    `SELECT a.id, a.payment_id, p.customer_id FROM payment_allocations a JOIN payments p ON p.id = a.payment_id WHERE a.invoice_id = ? AND ${LIVE_ALLOCATION}`,
    invoiceId,
  );
  for (const a of live) {
    run(db, 'UPDATE payment_allocations SET released_at = ? WHERE id = ?', nowIso(), a.id);
    if (a.customer_id === null) run(db, "UPDATE payments SET voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ? AND voided_at IS NULL", nowIso(), reason, nowIso(), a.payment_id);
  }
}
