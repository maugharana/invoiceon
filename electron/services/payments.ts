import { isIsoDate, todayIso } from '../../shared/gst';
import { formatMoney } from '../../shared/money';
import { matchesAll } from '../../shared/search';
import { CHEQUE_STATUS_LABEL, PAYMENT_METHODS, type ChequeStatus, type InvoicePayment, type Payment, type PaymentAllocation, type PaymentInput, type PaymentKind, type PaymentMethod, type PaymentQuery } from '../../shared/types';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, newId, nowIso, optionalText, requireInt } from './common';
import { getSettings } from './settings';

const MAX_PAISE = 100_000_000_00;

// A payment's *applied* part is the sum of its live allocations (not released, payment not voided).
// Its *advance* is what's left. That leftover is the only place "advance" exists — there is no separate balance to drift.
const LIVE_ALLOCATION = 'a.released_at IS NULL AND p.voided_at IS NULL';
/** Likewise a credit note's application to an invoice is live until released or the credit note is cancelled. */
const CREDIT_APPLICATION = "a.released_at IS NULL AND n.status = 'issued'";

// ── Invoice-side lookups (used by the invoice service, which imports this file) ─
/** Amount received against every invoice, in one query. */
export function loadPaid(db: Db): Map<string, number> {
  const rows = all<{ invoice_id: string; s: number }>(db, `SELECT a.invoice_id, SUM(a.amount_paise) AS s FROM payment_allocations a JOIN payments p ON p.id = a.payment_id WHERE ${LIVE_ALLOCATION} GROUP BY a.invoice_id`);
  const paid = new Map(rows.map((r) => [r.invoice_id, r.s]));
  // Credit notes settle an invoice just as a payment does, though no money arrives.
  for (const c of all<{ invoice_id: string; s: number }>(db, `SELECT a.invoice_id, SUM(a.amount_paise) AS s FROM credit_note_applications a JOIN credit_notes n ON n.id = a.credit_note_id WHERE ${CREDIT_APPLICATION} GROUP BY a.invoice_id`)) paid.set(c.invoice_id, (paid.get(c.invoice_id) ?? 0) + c.s);
  return paid;
}

export function paidFor(db: Db, invoiceId: string): number {
  const payments = get<{ s: number }>(db, `SELECT COALESCE(SUM(a.amount_paise), 0) AS s FROM payment_allocations a JOIN payments p ON p.id = a.payment_id WHERE a.invoice_id = ? AND ${LIVE_ALLOCATION}`, invoiceId)?.s ?? 0;
  const credits = get<{ s: number }>(db, `SELECT COALESCE(SUM(a.amount_paise), 0) AS s FROM credit_note_applications a JOIN credit_notes n ON n.id = a.credit_note_id WHERE a.invoice_id = ? AND ${CREDIT_APPLICATION}`, invoiceId)?.s ?? 0;
  return payments + credits;
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
     FROM payments p WHERE p.customer_id = ? AND p.voided_at IS NULL AND p.kind = 'receipt' ORDER BY p.received_on, p.created_at, p.rowid`,
    customerId,
  ).filter((r) => r.unapplied > 0);
}

/** Credit kept for the customer on their credit notes: not yet put on an invoice and not handed back. Oldest first. */
function storeCredits(db: Db, customerId: string): { id: string; held: number }[] {
  return all<{ id: string; held: number }>(
    db,
    `SELECT n.id, n.total_paise
       - COALESCE((SELECT SUM(a.amount_paise) FROM credit_note_applications a WHERE a.credit_note_id = n.id AND a.released_at IS NULL), 0)
       - COALESCE((SELECT SUM(f.amount_paise) FROM credit_note_refunds f WHERE f.credit_note_id = n.id), 0) AS held
     FROM credit_notes n WHERE n.customer_id = ? AND n.status = 'issued' ORDER BY n.issue_date, n.created_at, n.rowid`,
    customerId,
  ).filter((r) => r.held > 0);
}

export const advanceHeld = (db: Db, customerId: string): number => unappliedPayments(db, customerId).reduce((s, r) => s + r.unapplied, 0) + storeCredits(db, customerId).reduce((s, r) => s + r.held, 0);

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
    // Then credit kept from credit notes.
    for (const c of storeCredits(db, customerId)) {
      if (remaining <= 0) break;
      const take = Math.min(c.held, remaining);
      run(db, 'INSERT INTO credit_note_applications (id, credit_note_id, invoice_id, amount_paise, created_at) VALUES (?, ?, ?, ?, ?)', newId(), c.id, invoiceId, take, nowIso());
      remaining -= take;
      applied += take;
    }
    return applied;
  });
}

// ── Recording ───────────────────────────────────────────────────────────────
export interface PaymentDraft extends Omit<PaymentInput, 'method'> {
  method: PaymentMethod;
  /** A write-off settles a balance without money arriving. Only the write-off function sets this. */
  kind?: PaymentKind;
}

/** Validates and writes a payment and its allocations. Callers wrap it in their own transaction when it belongs to a bigger step. */
export function recordPaymentTx(db: Db, input: PaymentDraft): string {
  const amount = requireInt(input.amountPaise, 'Amount', { min: 1, max: MAX_PAISE });
  if (!(PAYMENT_METHODS as readonly string[]).includes(input.method)) throw new UserError('Choose how the payment was made.');
  if (!isIsoDate(input.receivedOn)) throw new UserError('Enter a valid payment date.');
  if (input.receivedOn > todayIso()) throw new UserError('The payment date can\'t be in the future.');
  const reference = optionalText(input.reference, 'Reference', 60);
  const note = optionalText(input.note, 'Note', 200);
  const kind: PaymentKind = input.kind ?? 'receipt';

  // Which account it went into must be one that exists in Settings.
  const accountId = input.accountId ?? '';
  if (accountId && !getSettings(db).paymentAccounts.some((a) => a.id === accountId)) throw new UserError('Choose the account from the list.');

  // A cheque can carry the date written on it. It starts out waiting to be deposited, and is tracked from there.
  const chequeDate = input.chequeDate || null;
  if (chequeDate !== null) {
    if (input.method !== 'cheque') throw new UserError('A cheque date only goes with a cheque payment.');
    if (!isIsoDate(chequeDate)) throw new UserError('Enter a valid date for the cheque.');
  }
  const chequeStatus: ChequeStatus | null = chequeDate !== null ? 'pending' : null;

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

  // A deposit is tied to one quote of the same customer that can still be invoiced.
  let proformaId: string | null = null;
  if (input.proformaId) {
    const quote = get<{ customer_id: string | null; status: string; stage: string; number: string }>(db, 'SELECT customer_id, status, stage, number FROM proformas WHERE id = ?', input.proformaId);
    if (!quote) throw new UserError('That quote no longer exists.');
    if (!input.customerId || quote.customer_id !== input.customerId) throw new UserError(`A deposit for ${quote.number} has to be recorded against that quote's own customer.`);
    if (quote.status !== 'open' || quote.stage === 'lost') throw new UserError(`${quote.number} is closed, so it can't take a deposit.`);
    proformaId = input.proformaId;
  }

  const id = newId();
  const now = nowIso();
  run(
    db,
    'INSERT INTO payments (id, customer_id, amount_paise, method, reference, received_on, note, proforma_id, kind, account_id, cheque_date, cheque_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, input.customerId ?? null, amount, input.method, reference, input.receivedOn, note, proformaId, kind, accountId, chequeDate, chequeStatus, now, now,
  );
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
  kind: PaymentKind;
  account_id: string;
  cheque_date: string | null;
  cheque_status: ChequeStatus | null;
  reconciled_on: string | null;
  proforma_id: string | null;
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
    kind: r.kind,
    accountId: r.account_id,
    chequeDate: r.cheque_date,
    chequeStatus: r.cheque_status,
    reconciledOn: r.reconciled_on,
    proformaId: r.proforma_id,
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
  if (query.accountId !== undefined && query.accountId !== '') {
    where.push('p.account_id = ?');
    params.push(query.accountId);
  }
  const rows = all<PaymentRow>(db, `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.received_on DESC, p.created_at DESC, p.rowid DESC`, ...params);
  if (query.from && !isIsoDate(query.from)) throw new UserError('Enter a valid "from" date.');
  if (query.to && !isIsoDate(query.to)) throw new UserError('Enter a valid "to" date.');
  if (query.method && !(PAYMENT_METHODS as readonly string[]).includes(query.method)) throw new UserError('Choose a payment method from the list.');
  return rows
    .map((r) => toPayment(db, r))
    .filter((p) => (!query.method || p.method === query.method) && (!query.from || p.receivedOn >= query.from) && (!query.to || p.receivedOn <= query.to))
    .filter((p) => matchesAll(`${p.customerName} ${p.reference} ${p.method} ${p.allocations.map((a) => a.invoiceNumber).join(' ')}`, query.search))
    .filter((p) => {
      switch (query.status) {
        case 'advance':
          return !p.voided && p.kind === 'receipt' && p.advancePaise > 0;
        case 'voided':
          return p.voided;
        case 'writeoff':
          return p.kind === 'writeoff';
        case 'cheque':
          return p.chequeStatus !== null;
        // Money that came in by bank, UPI, card or cheque and has not yet been ticked off against a statement.
        case 'unreconciled':
          return !p.voided && p.kind === 'receipt' && p.method !== 'cash' && p.reconciledOn === null;
        default:
          return true;
      }
    });
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
    // A walk-in's money goes back across the counter, and a write-off was never money: neither becomes an advance.
    const kind = get<{ kind: PaymentKind }>(db, 'SELECT kind FROM payments WHERE id = ?', a.payment_id)?.kind;
    if (a.customer_id === null || kind === 'writeoff') run(db, "UPDATE payments SET voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ? AND voided_at IS NULL", nowIso(), reason, nowIso(), a.payment_id);
  }
}

// ── Cheques ─────────────────────────────────────────────────────────────────
const CHEQUE_NEXT: Record<ChequeStatus, ChequeStatus[]> = { pending: ['deposited', 'cleared', 'bounced'], deposited: ['cleared', 'bounced'], cleared: [], bounced: [] };

/**
 * Moves a tracked cheque along: waiting to be deposited, deposited, cleared. A cheque counts as received from the day you record
 * it; if it bounces the payment is reversed, so the invoices it paid owe the money again.
 */
export function setChequeStatus(db: Db, id: string, status: ChequeStatus, reason = ''): Payment {
  const payment = getPayment(db, id);
  if (payment.chequeStatus === null) throw new UserError('This payment is not a tracked cheque.');
  if (!(status in CHEQUE_STATUS_LABEL)) throw new UserError('Choose where the cheque has got to.');
  if (!CHEQUE_NEXT[payment.chequeStatus].includes(status)) throw new UserError(`A cheque that is "${CHEQUE_STATUS_LABEL[payment.chequeStatus].toLowerCase()}" can't be marked "${CHEQUE_STATUS_LABEL[status].toLowerCase()}".`);
  return tx(db, () => {
    run(db, 'UPDATE payments SET cheque_status = ?, updated_at = ? WHERE id = ?', status, nowIso(), id);
    if (status === 'bounced') return voidPayment(db, id, optionalText(reason, 'Reason', 150) ? `Cheque bounced — ${reason.trim()}` : 'Cheque bounced');
    return getPayment(db, id);
  });
}

// ── Bank statement matching ─────────────────────────────────────────────────
/** Ticks payments off as matched against a bank statement on `on`, or clears the tick when `on` is null. */
export function setReconciled(db: Db, ids: string[], on: string | null): number {
  const list = [...new Set(ids)];
  if (list.length === 0) throw new UserError('Choose at least one payment.');
  if (on !== null && (!isIsoDate(on) || on > todayIso())) throw new UserError('Enter a valid date, not in the future.');
  tx(db, () => {
    for (const id of list) {
      const p = getPayment(db, id);
      if (p.voided) throw new UserError('A reversed payment can not be matched to a statement.');
      if (p.kind !== 'receipt' || p.method === 'cash') throw new UserError('Only bank, UPI, card and cheque receipts are matched against a statement.');
      run(db, 'UPDATE payments SET reconciled_on = ?, updated_at = ? WHERE id = ?', on, nowIso(), id);
    }
  });
  return list.length;
}

// ── Write-offs ──────────────────────────────────────────────────────────────
/**
 * Clears a small balance you have decided not to chase. It settles the invoice like a payment would, but no money came in, so it
 * is kept apart: it never counts as received, in reports or on the day book. Reverse it like a payment if you change your mind.
 */
export function writeOffBalance(db: Db, input: { invoiceId: string; amountPaise: number; reason?: string }): Payment {
  const inv = outstandingOf(db, input.invoiceId);
  const amount = requireInt(input.amountPaise, 'Amount', { min: 1, max: MAX_PAISE });
  if (amount > inv.outstanding) throw new UserError(`${inv.number} only has ${formatMoney(inv.outstanding)} left to pay.`);
  const reason = optionalText(input.reason ?? '', 'Reason', 150);
  const id = tx(db, () =>
    recordPaymentTx(db, {
      customerId: inv.customerId,
      amountPaise: amount,
      method: 'other',
      reference: '',
      receivedOn: todayIso(),
      note: reason ? `Written off — ${reason}` : 'Written off',
      allocations: [{ invoiceId: input.invoiceId, amountPaise: amount }],
      kind: 'writeoff',
    }),
  );
  return getPayment(db, id);
}
