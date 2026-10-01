import { isIsoDate } from '../../shared/gst';
import { bucketKeys, comparisonRange } from '../../shared/periods';
import { matchesAll } from '../../shared/search';
import { PAYMENT_METHODS, type Expense, type ExpenseInput, type ExpenseQuery, type ExpensesBreakdown, type ExpensesOverview, type PaymentMethod } from '../../shared/types';
import { all, get, run, type Db } from '../db/connection';
import { UserError, newId, nowIso, optionalText, requireInt, requireText } from './common';

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
}

const toExpense = (r: Row): Expense => ({ id: r.id, date: r.expense_date, category: r.category, vendor: r.vendor, amountPaise: r.amount_paise, method: r.method, reference: r.reference, note: r.note, createdAt: r.created_at });

function validate(db: Db, input: ExpenseInput) {
  if (!isIsoDate(input.date)) throw new UserError('Enter a valid date for the expense.');
  const amount = requireInt(input.amountPaise, 'Amount', { min: 1, max: MAX_PAISE });
  if (!(PAYMENT_METHODS as readonly string[]).includes(input.method)) throw new UserError('Choose how it was paid.');
  const typed = requireText(input.category, 'Category', 40);
  // "packaging" and "Packaging" are one category: keep whichever spelling was used first.
  const category = get<{ category: string }>(db, 'SELECT category FROM expenses WHERE category = ? COLLATE NOCASE AND deleted_at IS NULL ORDER BY created_at LIMIT 1', typed)?.category ?? typed;
  return {
    date: input.date,
    category,
    vendor: optionalText(input.vendor, 'Paid to', 80),
    amount,
    method: input.method,
    reference: optionalText(input.reference, 'Reference', 60),
    note: optionalText(input.note, 'Note', 300),
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
  return all<Row>(db, `SELECT * FROM expenses WHERE ${where.join(' AND ')} ORDER BY expense_date DESC, created_at DESC`, ...params)
    .map(toExpense)
    .filter((e) => matchesAll(`${e.category} ${e.vendor} ${e.note} ${e.reference}`, query.search));
}

export function createExpense(db: Db, input: ExpenseInput): Expense {
  const v = validate(db, input);
  const id = newId();
  const now = nowIso();
  run(db, 'INSERT INTO expenses (id, expense_date, category, vendor, amount_paise, method, reference, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, v.date, v.category, v.vendor, v.amount, v.method, v.reference, v.note, now, now);
  return getExpense(db, id);
}

export function updateExpense(db: Db, id: string, input: ExpenseInput): Expense {
  getExpense(db, id);
  const v = validate(db, input);
  run(db, 'UPDATE expenses SET expense_date = ?, category = ?, vendor = ?, amount_paise = ?, method = ?, reference = ?, note = ?, updated_at = ? WHERE id = ?', v.date, v.category, v.vendor, v.amount, v.method, v.reference, v.note, nowIso(), id);
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
