import { isIsoDate, isValidGstin, todayIso } from '../../shared/gst';
import { bucketKeys, comparisonRange } from '../../shared/periods';
import { nextOccurrenceOf } from '../../shared/recurring';
import { matchesAll } from '../../shared/search';
import {
  PAYMENT_METHODS,
  RECURRING_FREQUENCIES,
  type BudgetLine,
  type Expense,
  type ExpenseInput,
  type ExpenseQuery,
  type ExpensesBreakdown,
  type ExpensesOverview,
  type ExpenseStatus,
  type GstNet,
  type PayablesSummary,
  type PaymentMethod,
  type PurchasesReport,
  type RecurringExpense,
  type RecurringExpenseInput,
  type Vendor,
  type VendorInput,
} from '../../shared/types';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, isUniqueViolation, newId, nowIso, optionalText, requireInt, requireText } from './common';
import { getSettings } from './settings';

const MAX_PAISE = 100_000_000_00;

interface Row {
  id: string;
  expense_date: string;
  category: string;
  vendor: string;
  amount_paise: number;
  method: PaymentMethod;
  reference: string;
  note: string;
  created_at: string;
  vendor_id: string | null;
  gst_paise: number;
  account_id: string;
  status: ExpenseStatus;
  due_date: string | null;
  paid_on: string | null;
  recurring_id: string | null;
}

const toExpense = (r: Row): Expense => ({
  id: r.id,
  date: r.expense_date,
  category: r.category,
  vendor: r.vendor,
  amountPaise: r.amount_paise,
  method: r.method,
  reference: r.reference,
  note: r.note,
  createdAt: r.created_at,
  vendorId: r.vendor_id,
  gstPaise: r.gst_paise,
  accountId: r.account_id,
  status: r.status,
  dueDate: r.due_date,
  paidOn: r.paid_on,
  recurringId: r.recurring_id,
});

/** What the expense cost before the GST you can claim back. */
export const netOf = (e: Pick<Expense, 'amountPaise' | 'gstPaise'>): number => e.amountPaise - e.gstPaise;

function checkAccount(db: Db, accountId: unknown): string {
  const id = typeof accountId === 'string' ? accountId : '';
  if (id && !getSettings(db).paymentAccounts.some((a) => a.id === id)) throw new UserError('Choose the account from the list.');
  return id;
}

/** The vendor a name belongs to, created the first time it is used so the list builds itself. */
function vendorIdFor(db: Db, name: string): string | null {
  if (!name) return null;
  const existing = get<{ id: string }>(db, 'SELECT id FROM vendors WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL', name);
  if (existing) return existing.id;
  const id = newId();
  const now = nowIso();
  run(db, 'INSERT INTO vendors (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', id, name, now, now);
  return id;
}

function validate(db: Db, input: ExpenseInput) {
  if (!isIsoDate(input.date)) throw new UserError('Enter a valid date for the expense.');
  const amount = requireInt(input.amountPaise, 'Amount', { min: 1, max: MAX_PAISE });
  if (!(PAYMENT_METHODS as readonly string[]).includes(input.method)) throw new UserError('Choose how it was paid.');
  const typed = requireText(input.category, 'Category', 40);
  // "packaging" and "Packaging" are one category: keep whichever spelling was used first.
  const category = get<{ category: string }>(db, 'SELECT category FROM expenses WHERE category = ? COLLATE NOCASE AND deleted_at IS NULL ORDER BY created_at LIMIT 1', typed)?.category ?? typed;

  const gst = input.gstPaise === undefined || input.gstPaise === null ? 0 : requireInt(input.gstPaise, 'GST', { max: MAX_PAISE });
  if (gst > amount) throw new UserError("The GST can't be more than the amount.");

  const status: ExpenseStatus = input.status === 'unpaid' ? 'unpaid' : 'paid';
  const dueDate = input.dueDate ? input.dueDate : null;
  if (dueDate !== null && !isIsoDate(dueDate)) throw new UserError('Enter a valid due date.');
  let paidOn: string | null = null;
  if (status === 'paid') {
    paidOn = input.paidOn || input.date;
    if (!isIsoDate(paidOn)) throw new UserError('Enter a valid date for when it was paid.');
    if (paidOn > todayIso()) throw new UserError("The payment date can't be in the future. Record it as unpaid with a due date instead.");
  }
  return {
    date: input.date,
    category,
    vendor: optionalText(input.vendor, 'Paid to', 80),
    amount,
    method: input.method,
    reference: optionalText(input.reference, 'Reference', 60),
    note: optionalText(input.note, 'Note', 300),
    gst,
    accountId: checkAccount(db, input.accountId),
    status,
    dueDate: status === 'unpaid' ? dueDate : null,
    paidOn,
  };
}

export function getExpense(db: Db, id: string): Expense {
  const row = get<Row>(db, 'SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL', id);
  if (!row) throw new UserError('That expense no longer exists.');
  return toExpense(row);
}

export function listExpenses(db: Db, query: ExpenseQuery = {}): Expense[] {
  const where = ['deleted_at IS NULL'];
  const params: string[] = [];
  if (query.from) {
    where.push('expense_date >= ?');
    params.push(query.from);
  }
  if (query.to) {
    where.push('expense_date <= ?');
    params.push(query.to);
  }
  if (query.category) {
    where.push('category = ? COLLATE NOCASE');
    params.push(query.category);
  }
  if (query.status === 'paid' || query.status === 'unpaid') {
    where.push('status = ?');
    params.push(query.status);
  }
  if (query.vendorId) {
    where.push('vendor_id = ?');
    params.push(query.vendorId);
  }
  return all<Row>(db, `SELECT * FROM expenses WHERE ${where.join(' AND ')} ORDER BY expense_date DESC, created_at DESC`, ...params)
    .map(toExpense)
    .filter((e) => matchesAll(`${e.category} ${e.vendor} ${e.note} ${e.reference}`, query.search));
}

export function createExpense(db: Db, input: ExpenseInput, extra: { recurringId?: string } = {}): Expense {
  const v = validate(db, input);
  const id = newId();
  const now = nowIso();
  tx(db, () => {
    run(
      db,
      `INSERT INTO expenses (id, expense_date, category, vendor, vendor_id, amount_paise, gst_paise, method, account_id, status, due_date, paid_on, reference, note, recurring_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, v.date, v.category, v.vendor, vendorIdFor(db, v.vendor), v.amount, v.gst, v.method, v.accountId, v.status, v.dueDate, v.paidOn, v.reference, v.note, extra.recurringId ?? null, now, now,
    );
  });
  return getExpense(db, id);
}

export function updateExpense(db: Db, id: string, input: ExpenseInput): Expense {
  getExpense(db, id);
  const v = validate(db, input);
  tx(db, () => {
    run(
      db,
      `UPDATE expenses SET expense_date = ?, category = ?, vendor = ?, vendor_id = ?, amount_paise = ?, gst_paise = ?, method = ?, account_id = ?, status = ?, due_date = ?, paid_on = ?, reference = ?, note = ?, updated_at = ? WHERE id = ?`,
      v.date, v.category, v.vendor, vendorIdFor(db, v.vendor), v.amount, v.gst, v.method, v.accountId, v.status, v.dueDate, v.paidOn, v.reference, v.note, nowIso(), id,
    );
  });
  return getExpense(db, id);
}

/** Settles a bill you owed: records when it was paid, how and from which account. */
export function markExpensePaid(db: Db, id: string, input: { paidOn: string; method: PaymentMethod; accountId?: string; reference?: string }): Expense {
  const e = getExpense(db, id);
  if (e.status === 'paid') throw new UserError('This is already marked paid.');
  if (!isIsoDate(input.paidOn) || input.paidOn > todayIso()) throw new UserError('Enter the day it was paid, not in the future.');
  if (!(PAYMENT_METHODS as readonly string[]).includes(input.method)) throw new UserError('Choose how it was paid.');
  run(db, "UPDATE expenses SET status = 'paid', paid_on = ?, due_date = NULL, method = ?, account_id = ?, reference = ?, updated_at = ? WHERE id = ?", input.paidOn, input.method, checkAccount(db, input.accountId), optionalText(input.reference ?? e.reference, 'Reference', 60), nowIso(), id);
  return getExpense(db, id);
}

/** Expenses are removed from view, not from the file, so a mistaken delete can be recovered from a backup. */
export function deleteExpense(db: Db, id: string): void {
  getExpense(db, id);
  run(db, 'UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
}

/** Totals for a set of expenses (whatever the list is currently showing), biggest category first. */
export function overviewOf(expenses: Expense[]): ExpensesOverview {
  const byCategory = new Map<string, { category: string; paise: number; count: number }>();
  for (const e of expenses) {
    const key = e.category.toLowerCase();
    const c = byCategory.get(key) ?? { category: e.category, paise: 0, count: 0 };
    c.paise += e.amountPaise;
    c.count += 1;
    byCategory.set(key, c);
  }
  return { totalPaise: expenses.reduce((s, e) => s + e.amountPaise, 0), count: expenses.length, byCategory: [...byCategory.values()].sort((a, b) => b.paise - a.paise) };
}

export const expensesOverview = (db: Db, query: ExpenseQuery = {}): ExpensesOverview => overviewOf(listExpenses(db, query));

/**
 * Spending by category and month. With a start and end date, every month in between is a column (quiet ones too); without, the
 * columns run from the first month with spending to the last. When there is a start and end, the stretch of the same length just
 * before is added up too, so each category can be set against what it cost then.
 */
export function expensesBreakdown(db: Db, query: ExpenseQuery = {}): ExpensesBreakdown {
  const rows = listExpenses(db, query);
  const bounded = !!query.from && !!query.to && isIsoDate(query.from) && isIsoDate(query.to) && query.from <= query.to;
  const keys = [...new Set(rows.map((e) => e.date.slice(0, 7)))].sort();
  const months = bounded ? bucketKeys({ from: query.from!, to: query.to! }, 'month') : keys.length ? bucketKeys({ from: `${keys[0]}-01`, to: `${keys[keys.length - 1]}-28` }, 'month') : [];

  let previous: ExpensesBreakdown['previous'] = null;
  let previousByCategory = new Map<string, number>();
  if (bounded) {
    const range = comparisonRange({ from: query.from!, to: query.to! }, 'previous');
    const before = listExpenses(db, { ...query, from: range.from, to: range.to });
    previousByCategory = new Map(overviewOf(before).byCategory.map((c) => [c.category.toLowerCase(), c.paise]));
    previous = { ...range, totalPaise: before.reduce((s, e) => s + e.amountPaise, 0) };
  }

  const byCategory = new Map<string, { category: string; byMonth: number[]; totalPaise: number }>();
  for (const e of rows) {
    const key = e.category.toLowerCase();
    const row = byCategory.get(key) ?? { category: e.category, byMonth: months.map(() => 0), totalPaise: 0 };
    row.byMonth[months.indexOf(e.date.slice(0, 7))] += e.amountPaise;
    row.totalPaise += e.amountPaise;
    byCategory.set(key, row);
  }
  const out = [...byCategory.entries()]
    .map(([key, r]) => ({ ...r, previousPaise: previous ? (previousByCategory.get(key) ?? 0) : null }))
    .sort((a, b) => b.totalPaise - a.totalPaise || a.category.localeCompare(b.category));
  return { months, rows: out, monthTotals: months.map((_, i) => out.reduce((s, r) => s + r.byMonth[i]!, 0)), totalPaise: rows.reduce((s, e) => s + e.amountPaise, 0), previous };
}

/** Brings back an expense that was deleted (the "Undo" after deleting one). */
export function restoreExpense(db: Db, id: string): Expense {
  const row = get<Row>(db, 'SELECT * FROM expenses WHERE id = ? AND deleted_at IS NOT NULL', id);
  if (!row) throw new UserError("That expense can't be brought back.");
  run(db, 'UPDATE expenses SET deleted_at = NULL, updated_at = ? WHERE id = ?', nowIso(), id);
  return getExpense(db, id);
}

// ── Bills you owe ───────────────────────────────────────────────────────────
/** What is unpaid, and how much of it is past its due date (a bill with no due date is never counted overdue). */
export function payablesSummary(db: Db, today: string = todayIso()): PayablesSummary {
  const unpaid = listExpenses(db, { status: 'unpaid' });
  const late = unpaid.filter((e) => e.dueDate !== null && e.dueDate < today);
  return { unpaidPaise: unpaid.reduce((s, e) => s + e.amountPaise, 0), unpaidCount: unpaid.length, overduePaise: late.reduce((s, e) => s + e.amountPaise, 0), overdueCount: late.length };
}

// ── Vendors ─────────────────────────────────────────────────────────────────
interface VendorRow {
  id: string;
  name: string;
  phone: string;
  gstin: string;
  address: string;
  notes: string;
  spend: number;
  n: number;
  unpaid: number;
  last_on: string | null;
}

const VENDOR_SELECT = `
  SELECT v.*,
    COALESCE((SELECT SUM(e.amount_paise) FROM expenses e WHERE e.vendor_id = v.id AND e.deleted_at IS NULL), 0) AS spend,
    (SELECT COUNT(*) FROM expenses e WHERE e.vendor_id = v.id AND e.deleted_at IS NULL) AS n,
    COALESCE((SELECT SUM(e.amount_paise) FROM expenses e WHERE e.vendor_id = v.id AND e.deleted_at IS NULL AND e.status = 'unpaid'), 0) AS unpaid,
    (SELECT MAX(e.expense_date) FROM expenses e WHERE e.vendor_id = v.id AND e.deleted_at IS NULL) AS last_on
  FROM vendors v WHERE v.deleted_at IS NULL`;

const toVendor = (r: VendorRow): Vendor => ({ id: r.id, name: r.name, phone: r.phone, gstin: r.gstin, address: r.address, notes: r.notes, spendPaise: r.spend, expenseCount: r.n, unpaidPaise: r.unpaid, lastSpentOn: r.last_on });

function validateVendor(input: VendorInput): VendorInput {
  const gstin = optionalText(input.gstin, 'GSTIN', 15).toUpperCase();
  if (gstin && !isValidGstin(gstin)) throw new UserError("That GSTIN doesn't look right — it should be 15 characters, like 09ABCDE1234F1Z5.");
  return { name: requireText(input.name, 'Vendor name', 80), phone: optionalText(input.phone, 'Phone', 20), gstin, address: optionalText(input.address, 'Address', 200), notes: optionalText(input.notes, 'Notes', 300) };
}

/** Everyone you have paid or been billed by, with what that came to, biggest first. */
export function listVendors(db: Db, query: { search?: string } = {}): Vendor[] {
  return all<VendorRow>(db, `${VENDOR_SELECT} ORDER BY spend DESC, v.name COLLATE NOCASE`)
    .map(toVendor)
    .filter((v) => matchesAll(`${v.name} ${v.phone} ${v.gstin}`, query.search));
}

export function getVendor(db: Db, id: string): Vendor {
  const row = get<VendorRow>(db, `${VENDOR_SELECT} AND v.id = ?`, id);
  if (!row) throw new UserError('That vendor no longer exists.');
  return toVendor(row);
}

export function createVendor(db: Db, input: VendorInput): Vendor {
  const v = validateVendor(input);
  const id = newId();
  const now = nowIso();
  try {
    run(db, 'INSERT INTO vendors (id, name, phone, gstin, address, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, v.name, v.phone, v.gstin, v.address, v.notes, now, now);
  } catch (err) {
    if (isUniqueViolation(err)) throw new UserError(`You already have a vendor called “${v.name}”.`);
    throw err;
  }
  return getVendor(db, id);
}

/** Renaming a vendor renames it on its expenses too, so searches and reports stay in step. */
export function updateVendor(db: Db, id: string, input: VendorInput): Vendor {
  getVendor(db, id);
  const v = validateVendor(input);
  tx(db, () => {
    try {
      run(db, 'UPDATE vendors SET name = ?, phone = ?, gstin = ?, address = ?, notes = ?, updated_at = ? WHERE id = ?', v.name, v.phone, v.gstin, v.address, v.notes, nowIso(), id);
    } catch (err) {
      if (isUniqueViolation(err)) throw new UserError(`You already have a vendor called “${v.name}”.`);
      throw err;
    }
    run(db, 'UPDATE expenses SET vendor = ? WHERE vendor_id = ?', v.name, id);
  });
  return getVendor(db, id);
}

export function archiveVendor(db: Db, id: string): void {
  const v = getVendor(db, id);
  if (v.unpaidPaise > 0) throw new UserError(`You still owe ${v.name} money. Mark their bills paid first.`);
  run(db, 'UPDATE vendors SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
}

// ── Standing expenses (rent, salaries, subscriptions) ───────────────────────
interface RecurringRow {
  id: string;
  category: string;
  vendor: string;
  amount_paise: number;
  gst_paise: number;
  method: PaymentMethod;
  account_id: string;
  note: string;
  frequency: RecurringExpense['frequency'];
  next_date: string;
  end_date: string | null;
}

const toRecurring = (r: RecurringRow): RecurringExpense => ({
  id: r.id,
  category: r.category,
  vendor: r.vendor,
  amountPaise: r.amount_paise,
  gstPaise: r.gst_paise,
  method: r.method,
  accountId: r.account_id,
  note: r.note,
  frequency: r.frequency,
  nextDate: r.next_date,
  endDate: r.end_date,
});

function validateRecurring(db: Db, input: RecurringExpenseInput) {
  const amount = requireInt(input.amountPaise, 'Amount', { min: 1, max: MAX_PAISE });
  const gst = input.gstPaise ? requireInt(input.gstPaise, 'GST', { max: MAX_PAISE }) : 0;
  if (gst > amount) throw new UserError("The GST can't be more than the amount.");
  if (!(PAYMENT_METHODS as readonly string[]).includes(input.method)) throw new UserError('Choose how it is paid.');
  if (!(RECURRING_FREQUENCIES as readonly string[]).includes(input.frequency)) throw new UserError('Choose how often it repeats.');
  if (!isIsoDate(input.nextDate)) throw new UserError('Enter the next day it is due.');
  const endDate = input.endDate ? input.endDate : null;
  if (endDate !== null && (!isIsoDate(endDate) || endDate < input.nextDate)) throw new UserError('The end date should not be before the next due day.');
  return {
    category: requireText(input.category, 'Category', 40),
    vendor: optionalText(input.vendor, 'Paid to', 80),
    amount,
    gst,
    method: input.method,
    accountId: checkAccount(db, input.accountId),
    note: optionalText(input.note, 'Note', 300),
    frequency: input.frequency,
    nextDate: input.nextDate,
    endDate,
  };
}

export function listRecurring(db: Db): RecurringExpense[] {
  return all<RecurringRow>(db, 'SELECT * FROM recurring_expenses WHERE deleted_at IS NULL ORDER BY next_date, category COLLATE NOCASE').map(toRecurring);
}

export function createRecurring(db: Db, input: RecurringExpenseInput): RecurringExpense {
  const v = validateRecurring(db, input);
  const id = newId();
  const now = nowIso();
  run(
    db,
    'INSERT INTO recurring_expenses (id, category, vendor, amount_paise, gst_paise, method, account_id, note, frequency, next_date, end_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, v.category, v.vendor, v.amount, v.gst, v.method, v.accountId, v.note, v.frequency, v.nextDate, v.endDate, now, now,
  );
  return toRecurring(get<RecurringRow>(db, 'SELECT * FROM recurring_expenses WHERE id = ?', id)!);
}

export function updateRecurring(db: Db, id: string, input: RecurringExpenseInput): RecurringExpense {
  if (!get(db, 'SELECT 1 AS x FROM recurring_expenses WHERE id = ? AND deleted_at IS NULL', id)) throw new UserError('That standing expense no longer exists.');
  const v = validateRecurring(db, input);
  run(
    db,
    'UPDATE recurring_expenses SET category = ?, vendor = ?, amount_paise = ?, gst_paise = ?, method = ?, account_id = ?, note = ?, frequency = ?, next_date = ?, end_date = ?, updated_at = ? WHERE id = ?',
    v.category, v.vendor, v.amount, v.gst, v.method, v.accountId, v.note, v.frequency, v.nextDate, v.endDate, nowIso(), id,
  );
  return toRecurring(get<RecurringRow>(db, 'SELECT * FROM recurring_expenses WHERE id = ?', id)!);
}

export function deleteRecurring(db: Db, id: string): void {
  if (!get(db, 'SELECT 1 AS x FROM recurring_expenses WHERE id = ? AND deleted_at IS NULL', id)) throw new UserError('That standing expense no longer exists.');
  run(db, 'UPDATE recurring_expenses SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
}

/** Entries that have come due and not yet been made: for each standing expense, every due day up to today. */
export function dueRecurring(db: Db, today: string = todayIso()): { recurring: RecurringExpense; dates: string[] }[] {
  const out: { recurring: RecurringExpense; dates: string[] }[] = [];
  for (const r of listRecurring(db)) {
    const dates: string[] = [];
    let next = r.nextDate;
    while (next <= today && (r.endDate === null || next <= r.endDate) && dates.length < 60) {
      dates.push(next);
      next = nextOccurrenceOf(next, r.frequency, r.nextDate);
    }
    if (dates.length > 0) out.push({ recurring: r, dates });
  }
  return out;
}

/** Makes the entries that are due (paid, on their due days) and moves each standing expense on to its next day. All or nothing. */
export function runRecurring(db: Db, today: string = todayIso()): number {
  let made = 0;
  tx(db, () => {
    for (const { recurring: r, dates } of dueRecurring(db, today)) {
      for (const date of dates) {
        createExpense(db, { date, category: r.category, vendor: r.vendor, amountPaise: r.amountPaise, gstPaise: r.gstPaise, method: r.method, accountId: r.accountId, reference: '', note: r.note }, { recurringId: r.id });
        made++;
      }
      let next = r.nextDate;
      for (let i = 0; i < dates.length; i++) next = nextOccurrenceOf(next, r.frequency, r.nextDate);
      run(db, 'UPDATE recurring_expenses SET next_date = ?, updated_at = ? WHERE id = ?', next, nowIso(), r.id);
    }
  });
  return made;
}

// ── Budgets ─────────────────────────────────────────────────────────────────
/** This month's spending in each category that has a budget, against that budget. Categories are matched ignoring case. */
export function budgetStatus(db: Db, today: string = todayIso()): BudgetLine[] {
  const budgets = getSettings(db).expenseBudgets;
  const month = today.slice(0, 7);
  const spent = new Map<string, number>();
  for (const e of listExpenses(db, { from: `${month}-01`, to: `${month}-31` })) spent.set(e.category.toLowerCase(), (spent.get(e.category.toLowerCase()) ?? 0) + e.amountPaise);
  return Object.entries(budgets)
    .map(([category, budgetPaise]) => {
      const spentPaise = spent.get(category.toLowerCase()) ?? 0;
      const percent = budgetPaise > 0 ? (spentPaise / budgetPaise) * 100 : 0;
      return { category, budgetPaise, spentPaise, percent, status: (percent > 100 ? 'over' : percent >= 80 ? 'near' : 'ok') as BudgetLine['status'] };
    })
    .sort((a, b) => b.percent - a.percent || a.category.localeCompare(b.category));
}

// ── GST: collected on sales less paid on purchases ──────────────────────────
function checkRange(range: { from: string; to: string }): void {
  if (!isIsoDate(range.from) || !isIsoDate(range.to)) throw new UserError('Choose a valid date range.');
  if (range.from > range.to) throw new UserError('The start date is after the end date.');
}

/** GST on the invoices issued in the range (output) less GST on the expenses dated in it (input). */
export function gstNet(db: Db, range: { from: string; to: string }): GstNet {
  checkRange(range);
  const output = get<{ s: number }>(db, "SELECT COALESCE(SUM(cgst_paise + sgst_paise + igst_paise), 0) AS s FROM invoices WHERE status = 'issued' AND issue_date BETWEEN ? AND ?", range.from, range.to)?.s ?? 0;
  const input = get<{ s: number }>(db, 'SELECT COALESCE(SUM(gst_paise), 0) AS s FROM expenses WHERE deleted_at IS NULL AND expense_date BETWEEN ? AND ?', range.from, range.to)?.s ?? 0;
  return { range, outputPaise: output, inputPaise: input, netPaise: output - input };
}

/** Spending with its GST split out, by entry, vendor and month, for claiming input tax. */
export function purchasesReport(db: Db, range: { from: string; to: string }): PurchasesReport {
  checkRange(range);
  const rows = listExpenses(db, { from: range.from, to: range.to });
  const gstins = new Map(all<{ id: string; gstin: string }>(db, 'SELECT id, gstin FROM vendors').map((v) => [v.id, v.gstin]));
  const withGst = rows.filter((e) => e.gstPaise > 0).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const byVendor = new Map<string, { vendor: string; gstin: string; totalPaise: number; gstPaise: number }>();
  const byMonth = new Map<string, { month: string; totalPaise: number; gstPaise: number }>();
  for (const e of withGst) {
    const name = e.vendor || 'No vendor named';
    const v = byVendor.get(name.toLowerCase()) ?? { vendor: name, gstin: e.vendorId ? (gstins.get(e.vendorId) ?? '') : '', totalPaise: 0, gstPaise: 0 };
    v.totalPaise += e.amountPaise;
    v.gstPaise += e.gstPaise;
    byVendor.set(name.toLowerCase(), v);
    const m = byMonth.get(e.date.slice(0, 7)) ?? { month: e.date.slice(0, 7), totalPaise: 0, gstPaise: 0 };
    m.totalPaise += e.amountPaise;
    m.gstPaise += e.gstPaise;
    byMonth.set(m.month, m);
  }
  const gst = withGst.reduce((s, e) => s + e.gstPaise, 0);
  const total = withGst.reduce((s, e) => s + e.amountPaise, 0);
  return {
    range,
    totalPaise: total,
    gstPaise: gst,
    taxablePaise: total - gst,
    entries: withGst.map((e) => ({ id: e.id, date: e.date, vendor: e.vendor, vendorGstin: e.vendorId ? (gstins.get(e.vendorId) ?? '') : '', category: e.category, totalPaise: e.amountPaise, gstPaise: e.gstPaise, taxablePaise: netOf(e) })),
    byVendor: [...byVendor.values()].sort((a, b) => b.gstPaise - a.gstPaise),
    byMonth: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
    withoutGstPaise: rows.filter((e) => e.gstPaise === 0).reduce((s, e) => s + e.amountPaise, 0),
  };
}
