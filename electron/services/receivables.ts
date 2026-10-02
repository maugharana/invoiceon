import { localDateOf, todayIso } from '../../shared/gst';
import { PAYMENT_METHOD_LABEL, type DuesBuckets, type DuesReport, type DuesRow, type Ledger, type LedgerEntry, type PaymentMethod, type PaymentsSummary } from '../../shared/types';
import { all, type Db } from '../db/connection';
import { getCustomer, listCustomers } from './customers';
import { listInvoices } from './invoices';
import { openDueNotes } from './notes';
import { getPayment } from './payments';

// ── Customer ledger ─────────────────────────────────────────────────────────
interface Event {
  date: string;
  /** Tie-break inside a day: when it was actually entered. */
  at: string;
  kind: LedgerEntry['kind'];
  description: string;
  invoiceId?: string;
  debit: number;
  credit: number;
}

/**
 * A running statement: invoices are debits (what they owe), payments are credits. Cancelled invoices and voided
 * payments stay visible with a matching reversal, so the trail shows what happened rather than quietly rewriting it.
 */
export function customerLedger(db: Db, customerId: string): Ledger {
  const customer = getCustomer(db, customerId);
  const events: Event[] = [];

  const invoices = all<{ id: string; number: string; total_paise: number; issue_date: string; created_at: string; status: string; cancelled_at: string | null; cancel_reason: string }>(
    db,
    'SELECT id, number, total_paise, issue_date, created_at, status, cancelled_at, cancel_reason FROM invoices WHERE customer_id = ?',
    customerId,
  );
  for (const i of invoices) {
    events.push({ date: i.issue_date, at: i.created_at, kind: 'invoice', description: `Invoice ${i.number}`, invoiceId: i.id, debit: i.total_paise, credit: 0 });
    if (i.status === 'cancelled' && i.cancelled_at) {
      events.push({ date: localDateOf(i.cancelled_at), at: i.cancelled_at, kind: 'invoice-cancelled', description: `Invoice ${i.number} cancelled${i.cancel_reason ? ` — ${i.cancel_reason}` : ''}`, invoiceId: i.id, debit: 0, credit: i.total_paise });
    }
  }

  const notes = all<{ id: string; number: string; total_paise: number; issue_date: string; created_at: string; status: string; cancelled_at: string | null; cancel_reason: string; invoice_number: string; invoice_id: string }>(
    db,
    'SELECT n.id, n.number, n.total_paise, n.issue_date, n.created_at, n.status, n.cancelled_at, n.cancel_reason, n.invoice_id, i.number AS invoice_number FROM credit_notes n JOIN invoices i ON i.id = n.invoice_id WHERE n.customer_id = ?',
    customerId,
  );
  for (const n of notes) {
    events.push({ date: n.issue_date, at: n.created_at, kind: 'credit-note', description: `Credit note ${n.number} — goods returned from ${n.invoice_number}`, invoiceId: n.invoice_id, debit: 0, credit: n.total_paise });
    if (n.status === 'cancelled' && n.cancelled_at) events.push({ date: localDateOf(n.cancelled_at), at: n.cancelled_at, kind: 'credit-note-cancelled', description: `Credit note ${n.number} cancelled${n.cancel_reason ? ` — ${n.cancel_reason}` : ''}`, invoiceId: n.invoice_id, debit: n.total_paise, credit: 0 });
  }
  const refunds = all<{ amount_paise: number; paid_on: string; created_at: string; number: string; method: PaymentMethod }>(
    db,
    "SELECT f.amount_paise, f.paid_on, f.created_at, f.method, n.number FROM credit_note_refunds f JOIN credit_notes n ON n.id = f.credit_note_id WHERE n.customer_id = ? AND n.status = 'issued'",
    customerId,
  );
  for (const f of refunds) events.push({ date: f.paid_on, at: f.created_at, kind: 'refund', description: `Refund paid (${PAYMENT_METHOD_LABEL[f.method]}) — ${f.number}`, debit: f.amount_paise, credit: 0 });

  const payments = all<{ id: string; voided_at: string | null; void_reason: string; received_on: string; created_at: string; amount_paise: number; method: PaymentMethod; reference: string; kind: 'receipt' | 'writeoff'; note: string }>(
    db,
    'SELECT id, voided_at, void_reason, received_on, created_at, amount_paise, method, reference, kind, note FROM payments WHERE customer_id = ?',
    customerId,
  );
  for (const p of payments) {
    if (p.kind === 'writeoff') {
      const on = getPayment(db, p.id).allocations.map((a) => a.invoiceNumber).join(', ');
      events.push({ date: p.received_on, at: p.created_at, kind: 'writeoff', description: `Written off${on ? ` — ${on}` : ''}${p.note.replace(/^Written off/, '') ? ` ${p.note.replace(/^Written off/, '').trim()}` : ''}`, debit: 0, credit: p.amount_paise });
      if (p.voided_at) events.push({ date: localDateOf(p.voided_at), at: p.voided_at, kind: 'payment-voided', description: `Write-off reversed${p.void_reason ? ` — ${p.void_reason}` : ''}`, debit: p.amount_paise, credit: 0 });
      continue;
    }
    const detail = getPayment(db, p.id);
    const via = [PAYMENT_METHOD_LABEL[p.method], p.reference].filter(Boolean).join(' · ');
    const invoicesPaid = detail.allocations.map((a) => a.invoiceNumber).join(', ');
    const where = detail.voided ? '' : detail.allocations.length === 0 ? ' — advance' : detail.advancePaise > 0 ? ` — ${invoicesPaid} + advance` : ` — ${invoicesPaid}`;
    events.push({ date: p.received_on, at: p.created_at, kind: 'payment', description: `Payment received (${via})${where}`, debit: 0, credit: p.amount_paise });
    if (p.voided_at) {
      events.push({ date: localDateOf(p.voided_at), at: p.voided_at, kind: 'payment-voided', description: `Payment reversed (${via})${p.void_reason ? ` — ${p.void_reason}` : ''}`, debit: p.amount_paise, credit: 0 });
    }
  }

  events.sort((a, b) => (a.date === b.date ? a.at.localeCompare(b.at) : a.date.localeCompare(b.date)));
  let balance = 0;
  const entries: LedgerEntry[] = events.map((e) => {
    balance += e.debit - e.credit;
    return { date: e.date, kind: e.kind, description: e.description, invoiceId: e.invoiceId, debitPaise: e.debit, creditPaise: e.credit, balancePaise: balance };
  });

  const live = payments.filter((p) => !p.voided_at);
  const received = live.filter((p) => p.kind === 'receipt').reduce((s, p) => s + p.amount_paise, 0);
  const writtenOff = live.filter((p) => p.kind === 'writeoff').reduce((s, p) => s + p.amount_paise, 0);
  const credited = notes.filter((n) => n.status === 'issued').reduce((s, n) => s + n.total_paise, 0);
  const refunded = refunds.reduce((s, f) => s + f.amount_paise, 0);
  return { customer, entries, billedPaise: customer.billedPaise, creditedPaise: credited, refundedPaise: refunded, receivedPaise: received, writtenOffPaise: writtenOff, balancePaise: customer.billedPaise - credited - received - writtenOff + refunded };
}

// ── Dues ────────────────────────────────────────────────────────────────────
const DAY = 86_400_000;
const daysBetween = (fromIso: string, toIso: string): number => Math.round((Date.parse(toIso) - Date.parse(fromIso)) / DAY);

const emptyBuckets = (): DuesBuckets => ({ currentPaise: 0, days1to30Paise: 0, days31to60Paise: 0, days61plusPaise: 0 });

function addToBucket(b: DuesBuckets, daysPastDue: number, amount: number): void {
  if (daysPastDue <= 0) b.currentPaise += amount;
  else if (daysPastDue <= 30) b.days1to30Paise += amount;
  else if (daysPastDue <= 60) b.days31to60Paise += amount;
  else b.days61plusPaise += amount;
}

/** Everyone who owes money, aged by how far past their due date each invoice is (issue date if no due date was set). */
export function duesReport(db: Db): DuesReport {
  const today = todayIso();
  const customers = new Map(listCustomers(db).map((c) => [c.id, c]));
  const rows = new Map<string, DuesRow>();
  const totals = emptyBuckets();

  for (const inv of listInvoices(db, { status: 'open' })) {
    const owed = inv.totalPaise - inv.paidPaise;
    if (owed <= 0) continue;
    const key = inv.customerId ?? 'walk-in';
    let row = rows.get(key);
    if (!row) {
      const c = inv.customerId ? customers.get(inv.customerId) : undefined;
      row = { customerId: inv.customerId, customerName: c?.name ?? (inv.customerId ? inv.buyerName : 'Walk-in customers'), phone: c?.phone ?? '', openInvoices: 0, outstandingPaise: 0, overduePaise: 0, oldestDueDate: null, advancePaise: c?.advancePaise ?? 0, promisedOn: null, promisedPaise: 0, ...emptyBuckets() };
      rows.set(key, row);
    }
    const due = inv.dueDate ?? inv.issueDate;
    const past = daysBetween(due, today);
    row.openInvoices += 1;
    row.outstandingPaise += owed;
    if (past > 0) row.overduePaise += owed;
    if (!row.oldestDueDate || due < row.oldestDueDate) row.oldestDueDate = due;
    addToBucket(row, past, owed);
    addToBucket(totals, past, owed);
  }

  // What people have promised, from the open promises noted against them or their invoices.
  for (const n of openDueNotes(db, { kind: 'promise' })) {
    const row = rows.get(n.customerId ?? 'walk-in');
    if (!row || !n.dueDate) continue;
    row.promisedPaise += n.amountPaise;
    if (!row.promisedOn || n.dueDate < row.promisedOn) row.promisedOn = n.dueDate;
  }

  const list = [...rows.values()].sort((a, b) => b.overduePaise - a.overduePaise || b.outstandingPaise - a.outstandingPaise);
  return {
    rows: list,
    ...totals,
    outstandingPaise: list.reduce((s, r) => s + r.outstandingPaise, 0),
    overduePaise: list.reduce((s, r) => s + r.overduePaise, 0),
    advanceHeldPaise: [...customers.values()].reduce((s, c) => s + Math.max(c.advancePaise, 0), 0),
  };
}

// ── Summary ─────────────────────────────────────────────────────────────────
export function paymentsSummary(db: Db): PaymentsSummary {
  const month = todayIso().slice(0, 7);
  const monthPayments = all<{ amount_paise: number }>(db, "SELECT amount_paise FROM payments WHERE voided_at IS NULL AND kind = 'receipt' AND received_on LIKE ? || '%'", month);
  const dues = duesReport(db);
  const withAdvance = listCustomers(db).filter((c) => c.advancePaise > 0);
  return {
    receivedThisMonthPaise: monthPayments.reduce((s, p) => s + p.amount_paise, 0),
    paymentsThisMonth: monthPayments.length,
    advanceHeldPaise: dues.advanceHeldPaise,
    customersWithAdvance: withAdvance.length,
    outstandingPaise: dues.outstandingPaise,
    overduePaise: dues.overduePaise,
  };
}
