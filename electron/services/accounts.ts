import { isIsoDate, todayIso } from '../../shared/gst';
import { matchStatement, parseStatement } from '../../shared/reconcile';
import type { AccountBook, AccountBookAccount, AccountEntry, AccountTransfer, AccountTransferInput, DayClose, PaymentAccount, ReconcilePreview } from '../../shared/types';
import { all, get, run, type Db } from '../db/connection';
import { UserError, newId, nowIso, optionalText, requireInt } from './common';
import { listPayments } from './payments';
import { getSettings } from './settings';

const MAX_PAISE = 100_000_000_00;

/** One movement of money in or out of an account, before it is laid out as a book. */
interface Movement {
  /** The account key: its id, or '' for entries not linked to an account. */
  account: string;
  date: string;
  at: string;
  kind: AccountEntry['kind'];
  party: string;
  detail: string;
  inPaise: number;
  outPaise: number;
  /** How it was paid or received; the unassigned bucket uses it to tell cash from the rest. */
  method: string | null;
}

/** An account id that is not in Settings (a deleted account) is treated like no account at all. */
function accountKeyOf(known: Set<string>, id: string): string {
  return known.has(id) ? id : '';
}

function movements(db: Db, accounts: PaymentAccount[]): Movement[] {
  const known = new Set(accounts.map((a) => a.id));
  const out: Movement[] = [];

  for (const r of all<{ account_id: string; received_on: string; created_at: string; amount_paise: number; method: string; reference: string; note: string; name: string | null }>(
    db,
    `SELECT p.account_id, p.received_on, p.created_at, p.amount_paise, p.method, p.reference, p.note, c.name
     FROM payments p LEFT JOIN customers c ON c.id = p.customer_id WHERE p.voided_at IS NULL AND p.kind = 'receipt'`,
  )) {
    out.push({ account: accountKeyOf(known, r.account_id), date: r.received_on, at: r.created_at, kind: 'receipt', party: r.name ?? 'Walk-in customer', detail: [r.reference, r.note].filter(Boolean).join(' · ') || 'Payment received', inPaise: r.amount_paise, outPaise: 0, method: r.method });
  }
  for (const r of all<{ account_id: string; paid_day: string; created_at: string; amount_paise: number; method: string; category: string; vendor: string; reference: string }>(
    db,
    `SELECT account_id, COALESCE(paid_on, expense_date) AS paid_day, created_at, amount_paise, method, category, vendor, reference
     FROM expenses WHERE deleted_at IS NULL AND status = 'paid'`,
  )) {
    out.push({ account: accountKeyOf(known, r.account_id), date: r.paid_day, at: r.created_at, kind: 'expense', party: r.vendor || r.category, detail: [r.category, r.reference].filter(Boolean).join(' · '), inPaise: 0, outPaise: r.amount_paise, method: r.method });
  }
  const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'another account';
  for (const t of all<{ from_account: string; to_account: string; amount_paise: number; transfer_date: string; note: string; created_at: string }>(db, 'SELECT * FROM account_transfers WHERE deleted_at IS NULL')) {
    if (known.has(t.from_account)) out.push({ account: t.from_account, date: t.transfer_date, at: t.created_at, kind: 'transfer-out', party: `To ${name(t.to_account)}`, detail: t.note || 'Transfer', inPaise: 0, outPaise: t.amount_paise, method: null });
    if (known.has(t.to_account)) out.push({ account: t.to_account, date: t.transfer_date, at: t.created_at, kind: 'transfer-in', party: `From ${name(t.from_account)}`, detail: t.note || 'Transfer', inPaise: t.amount_paise, outPaise: 0, method: null });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
}

/**
 * Each payment account's balance, with every receipt, bill paid and transfer that moved it. Entries made before accounts were
 * linked are shown together under "Not linked to an account", so nothing goes missing from the totals.
 */
export function accountBook(db: Db, range: { from: string; to: string }): AccountBook {
  if (!isIsoDate(range.from) || !isIsoDate(range.to) || range.from > range.to) throw new UserError('Choose a valid date range.');
  const accounts = getSettings(db).paymentAccounts;
  const all_ = movements(db, accounts);

  const layout = (key: string, name: string, kind: AccountBookAccount['kind'], opening: number): AccountBookAccount => {
    const mine = all_.filter((m) => m.account === key);
    const before = mine.filter((m) => m.date < range.from).reduce((s, m) => s + m.inPaise - m.outPaise, 0);
    let running = opening + before;
    const startsAt = running;
    const entries: AccountEntry[] = mine
      .filter((m) => m.date >= range.from && m.date <= range.to)
      .map((m) => {
        running += m.inPaise - m.outPaise;
        return { date: m.date, kind: m.kind, party: m.party, detail: m.detail, inPaise: m.inPaise, outPaise: m.outPaise, balancePaise: running };
      });
    return { accountId: key, name, kind, openingPaise: startsAt, inPaise: entries.reduce((s, e) => s + e.inPaise, 0), outPaise: entries.reduce((s, e) => s + e.outPaise, 0), closingPaise: running, entries };
  };

  const books = accounts.map((a) => layout(a.id, a.name, a.kind, a.openingPaise ?? 0));
  const loose = layout('', 'Not linked to an account', null, 0);
  if (loose.entries.length > 0 || loose.openingPaise !== 0) books.push(loose);
  return { range, accounts: books, totalClosingPaise: books.reduce((s, b) => s + b.closingPaise, 0) };
}

// ── Transfers ───────────────────────────────────────────────────────────────
const toTransfer = (r: { id: string; from_account: string; to_account: string; amount_paise: number; transfer_date: string; note: string }): AccountTransfer => ({
  id: r.id,
  fromAccountId: r.from_account,
  toAccountId: r.to_account,
  amountPaise: r.amount_paise,
  date: r.transfer_date,
  note: r.note,
});

export function listTransfers(db: Db): AccountTransfer[] {
  return all<Parameters<typeof toTransfer>[0]>(db, 'SELECT * FROM account_transfers WHERE deleted_at IS NULL ORDER BY transfer_date DESC, created_at DESC').map(toTransfer);
}

/** Moving money between your own accounts, such as taking cash to the bank. It changes both balances and is not income or spending. */
export function createTransfer(db: Db, input: AccountTransferInput): AccountTransfer {
  const accounts = getSettings(db).paymentAccounts;
  if (!accounts.some((a) => a.id === input.fromAccountId) || !accounts.some((a) => a.id === input.toAccountId)) throw new UserError('Choose both accounts from the list.');
  if (input.fromAccountId === input.toAccountId) throw new UserError('Choose two different accounts.');
  const amount = requireInt(input.amountPaise, 'Amount', { min: 1, max: MAX_PAISE });
  if (!isIsoDate(input.date) || input.date > todayIso()) throw new UserError('Enter the day it moved, not in the future.');
  const id = newId();
  run(db, 'INSERT INTO account_transfers (id, from_account, to_account, amount_paise, transfer_date, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, input.fromAccountId, input.toAccountId, amount, input.date, optionalText(input.note, 'Note', 150), nowIso());
  return toTransfer(get<Parameters<typeof toTransfer>[0]>(db, 'SELECT * FROM account_transfers WHERE id = ?', id)!);
}

export function deleteTransfer(db: Db, id: string): void {
  if (!get(db, 'SELECT 1 AS x FROM account_transfers WHERE id = ? AND deleted_at IS NULL', id)) throw new UserError('That transfer no longer exists.');
  run(db, 'UPDATE account_transfers SET deleted_at = ? WHERE id = ?', nowIso(), id);
}

// ── Closing the day ─────────────────────────────────────────────────────────
/** What the books say is in the cash drawer at the end of `day`: cash accounts, plus unlinked entries paid or received in cash. */
export function expectedCash(db: Db, day: string): number {
  const accounts = getSettings(db).paymentAccounts;
  const cashIds = new Set(accounts.filter((a) => a.kind === 'cash').map((a) => a.id));
  const opening = accounts.filter((a) => a.kind === 'cash').reduce((s, a) => s + (a.openingPaise ?? 0), 0);
  return (
    opening +
    movements(db, accounts)
      .filter((m) => m.date <= day && (cashIds.has(m.account) || (m.account === '' && m.method === 'cash')))
      .reduce((s, m) => s + m.inPaise - m.outPaise, 0)
  );
}

interface CloseRow {
  day: string;
  expected_paise: number;
  counted_paise: number;
  note: string;
  updated_at: string;
}
const toClose = (r: CloseRow): DayClose => ({ day: r.day, expectedPaise: r.expected_paise, countedPaise: r.counted_paise, differencePaise: r.counted_paise - r.expected_paise, note: r.note, closedAt: r.updated_at });

/** The day's close: what was counted if it has been closed, otherwise just what the drawer should hold. */
export function dayClose(db: Db, day: string): DayClose {
  if (!isIsoDate(day)) throw new UserError('Choose a valid day.');
  const row = get<CloseRow>(db, 'SELECT * FROM cash_closes WHERE day = ?', day);
  if (row) return toClose(row);
  return { day, expectedPaise: expectedCash(db, day), countedPaise: null, differencePaise: null, note: '', closedAt: null };
}

/** Records the count for a day. Closing a day again replaces the earlier count. The books are not changed: the difference is just noted. */
export function closeDay(db: Db, day: string, countedPaise: number, note: string): DayClose {
  if (!isIsoDate(day) || day > todayIso()) throw new UserError('Choose today or an earlier day.');
  const counted = requireInt(countedPaise, 'The cash counted', { max: MAX_PAISE });
  const expected = expectedCash(db, day);
  const now = nowIso();
  const n = optionalText(note, 'Note', 200);
  if (get(db, 'SELECT 1 AS x FROM cash_closes WHERE day = ?', day)) run(db, 'UPDATE cash_closes SET expected_paise = ?, counted_paise = ?, note = ?, updated_at = ? WHERE day = ?', expected, counted, n, now, day);
  else run(db, 'INSERT INTO cash_closes (id, day, expected_paise, counted_paise, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', newId(), day, expected, counted, n, now, now);
  return dayClose(db, day);
}

export function listCloses(db: Db, limit = 30): DayClose[] {
  return all<CloseRow>(db, 'SELECT * FROM cash_closes ORDER BY day DESC LIMIT ?', limit).map(toClose);
}

// ── Matching a bank statement ───────────────────────────────────────────────
/** Reads a pasted statement and proposes which payment each money-in line is. Nothing is changed until the pairs are confirmed. */
export function reconcilePreview(db: Db, statementText: string, accountId = ''): ReconcilePreview {
  const parsed = parseStatement(statementText);
  const open = listPayments(db, { status: 'unreconciled', ...(accountId ? { accountId } : {}) });
  const result = matchStatement(parsed.lines, open.map((p) => ({ id: p.id, amountPaise: p.amountPaise, receivedOn: p.receivedOn, reference: p.reference, chequeDate: p.chequeDate })));
  const byRow = new Map(result.matches.map((m) => [m.row, m]));
  const who = new Map(open.map((p) => [p.id, p.customerName]));
  return {
    proposals: parsed.lines.map((l) => {
      const m = byRow.get(l.row);
      return { row: l.row, date: l.date, description: l.description, creditPaise: l.creditPaise, paymentId: m?.paymentId ?? null, customerName: m ? (who.get(m.paymentId) ?? '') : '', reason: m?.reason ?? null };
    }),
    problems: parsed.problems,
    skippedDebits: parsed.skippedDebits,
    unmatchedPayments: open.filter((p) => result.unmatchedPaymentIds.includes(p.id)),
  };
}
