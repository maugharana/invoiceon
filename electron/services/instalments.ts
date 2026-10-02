import { isIsoDate, todayIso } from '../../shared/gst';
import type { DueInstalment, Instalment, InstalmentInput } from '../../shared/types';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, newId, nowIso, requireInt } from './common';
import { paidFor } from './payments';

const MAX_PAISE = 100_000_000_00;

interface Row {
  id: string;
  invoice_id: string;
  position: number;
  due_date: string;
  amount_paise: number;
}

/**
 * The plan for an invoice, with how far each instalment is paid. Payments fill the instalments in date order, so whatever has
 * been paid on the invoice counts toward the earliest one first.
 */
export function listInstalments(db: Db, invoiceId: string, today: string = todayIso()): Instalment[] {
  const rows = all<Row>(db, 'SELECT * FROM instalments WHERE invoice_id = ? AND deleted_at IS NULL ORDER BY position', invoiceId);
  let remaining = paidFor(db, invoiceId);
  return rows.map((r): Instalment => {
    const paid = Math.min(r.amount_paise, remaining);
    remaining -= paid;
    return { id: r.id, position: r.position, dueDate: r.due_date, amountPaise: r.amount_paise, paidPaise: paid, status: paid >= r.amount_paise ? 'paid' : r.due_date < today ? 'overdue' : 'upcoming' };
  });
}

/** Sets (or replaces) the instalment plan for an issued invoice. The instalments have to add up to the invoice total. */
export function setInstalments(db: Db, invoiceId: string, plan: InstalmentInput[]): Instalment[] {
  const inv = get<{ number: string; total_paise: number; status: string; issue_date: string }>(db, 'SELECT number, total_paise, status, issue_date FROM invoices WHERE id = ?', invoiceId);
  if (!inv) throw new UserError('That invoice no longer exists.');
  if (inv.status === 'cancelled') throw new UserError(`${inv.number} is cancelled.`);
  if (!Array.isArray(plan) || plan.length === 0) throw new UserError('Add at least one instalment, or remove the plan.');
  if (plan.length > 24) throw new UserError('Keep it to 24 instalments or fewer.');
  let total = 0;
  let last = '';
  for (const p of plan) {
    if (!isIsoDate(p.dueDate)) throw new UserError('Every instalment needs a valid due date.');
    if (p.dueDate < inv.issue_date) throw new UserError("An instalment can't fall due before the invoice date.");
    if (p.dueDate < last) throw new UserError('List the instalments in date order.');
    last = p.dueDate;
    total += requireInt(p.amountPaise, 'Each instalment amount', { min: 1, max: MAX_PAISE });
  }
  if (total !== inv.total_paise) throw new UserError(`The instalments add up to ${(total / 100).toFixed(2)} but the invoice is ${(inv.total_paise / 100).toFixed(2)}. They need to match.`);
  tx(db, () => {
    run(db, 'UPDATE instalments SET deleted_at = ? WHERE invoice_id = ? AND deleted_at IS NULL', nowIso(), invoiceId);
    plan.forEach((p, i) => run(db, 'INSERT INTO instalments (id, invoice_id, position, due_date, amount_paise, created_at) VALUES (?, ?, ?, ?, ?, ?)', newId(), invoiceId, i, p.dueDate, p.amountPaise, nowIso()));
  });
  return listInstalments(db, invoiceId);
}

export function clearInstalments(db: Db, invoiceId: string): void {
  run(db, 'UPDATE instalments SET deleted_at = ? WHERE invoice_id = ? AND deleted_at IS NULL', nowIso(), invoiceId);
}

/** Instalments not fully paid that fall due on or before `onOrBefore` (overdue ones included), soonest first. */
export function dueInstalments(db: Db, onOrBefore: string, today: string = todayIso()): DueInstalment[] {
  const invoices = all<{ invoice_id: string; number: string; customer_id: string | null; buyer_json: string }>(
    db,
    `SELECT DISTINCT i.id AS invoice_id, i.number, i.customer_id, i.buyer_json FROM instalments n JOIN invoices i ON i.id = n.invoice_id WHERE n.deleted_at IS NULL AND i.status = 'issued'`,
  );
  const out: DueInstalment[] = [];
  for (const inv of invoices) {
    for (const n of listInstalments(db, inv.invoice_id, today)) {
      if (n.status !== 'paid' && n.dueDate <= onOrBefore) {
        out.push({ ...n, invoiceId: inv.invoice_id, invoiceNumber: inv.number, customerId: inv.customer_id, customerName: (JSON.parse(inv.buyer_json) as { name: string }).name });
      }
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.invoiceNumber.localeCompare(b.invoiceNumber));
}
