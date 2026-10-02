import { headingKey, mapHeadings, parseTable } from './csvParse';
import { addDays } from './gst';
import { parseMoney, type Paise } from './money';
import { readDate } from './importRows';

/**
 * Matching a bank statement against the payments you recorded. The statement comes in as text copied from the bank's spreadsheet
 * or CSV; each money-in line is paired with the payment that most plausibly caused it, and the pairs are offered for a tick —
 * nothing is changed until the person confirms.
 */

export interface StatementLine {
  /** The line as the person sees it in the sheet (the heading row is row 1). */
  row: number;
  date: string;
  description: string;
  /** Money that came in. 0 for a withdrawal. */
  creditPaise: Paise;
}

export interface StatementParse {
  lines: StatementLine[];
  /** Rows that could not be read, with why. A withdrawal is not a problem: it is simply left out. */
  problems: { row: number; message: string }[];
  /** How many withdrawal lines were left out. */
  skippedDebits: number;
}

const HEADINGS = {
  date: ['date', 'txndate', 'transactiondate', 'valuedate', 'postdate', 'postingdate'],
  description: ['description', 'narration', 'particulars', 'details', 'remarks', 'transactiondetails', 'transactionremarks'],
  credit: ['credit', 'creditamount', 'deposit', 'deposits', 'cr', 'moneyin', 'received', 'depositamt'],
  debit: ['debit', 'debitamount', 'withdrawal', 'withdrawals', 'dr', 'moneyout', 'withdrawalamt'],
  amount: ['amount'],
} as const;

const money = (text: string): number | null => {
  const t = text.replace(/[₹\s]/g, '').replace(/(cr|dr)$/i, '');
  return t === '' ? 0 : parseMoney(t);
};

/** Reads a statement. It needs a heading row naming at least a date and a credit (or amount) column. */
export function parseStatement(text: string): StatementParse {
  const table = parseTable(text);
  const out: StatementParse = { lines: [], problems: [], skippedDebits: 0 };
  const mapped = table.length ? mapHeadings(table[0]!, HEADINGS as unknown as Record<keyof typeof HEADINGS, string[]>) : null;
  if (!mapped || mapped.date === undefined || (mapped.credit === undefined && mapped.amount === undefined)) {
    out.problems.push({ row: 1, message: 'I could not find the headings. The first row should name a Date column and a Credit (or Amount) column.' });
    return out;
  }
  const cell = (cells: string[], i: number | undefined) => (i === undefined ? '' : (cells[i] ?? '').trim());
  table.slice(1).forEach((cells, i) => {
    const row = i + 2;
    const date = readDate(cell(cells, mapped.date));
    if (!date) return void out.problems.push({ row, message: `“${cell(cells, mapped.date)}” isn't a date I can read.` });
    let credit: number | null;
    let debit = 0;
    if (mapped.credit !== undefined) {
      credit = money(cell(cells, mapped.credit));
      if (mapped.debit !== undefined) debit = money(cell(cells, mapped.debit)) ?? 0;
    } else {
      // A single signed amount column: a minus sign (or "Dr") is money out.
      const raw = cell(cells, mapped.amount);
      const negative = /^[-−(]/.test(raw) || /dr$/i.test(raw);
      const value = money(raw.replace(/^[-−(]|\)$/g, ''));
      credit = negative ? 0 : value;
      if (negative && value) debit = value;
    }
    if (credit === null) return void out.problems.push({ row, message: `“${cell(cells, mapped.credit ?? mapped.amount)}” isn't an amount.` });
    if (credit === 0) {
      if (debit > 0) out.skippedDebits++;
      return;
    }
    out.lines.push({ row, date, description: cell(cells, mapped.description), creditPaise: credit });
  });
  return out;
}

export interface ReconcilePayment {
  id: string;
  amountPaise: Paise;
  receivedOn: string;
  reference: string;
  /** For a cheque, the date written on it. The bank credits it around then rather than the day you got it. */
  chequeDate: string | null;
}

export interface ReconcileMatch {
  row: number;
  paymentId: string;
  /** What made the pair likely: the reference appears on the line, or the amount and date fit. */
  reason: 'reference' | 'date';
}

/** A reference is only worth matching on if it is long enough to be specific (a UPI or cheque number, not "1"). */
const usableReference = (ref: string): string => {
  const key = headingKey(ref);
  return key.length >= 4 ? key : '';
};

/**
 * Pairs statement lines with payments. A pair needs the same amount, and either the payment's reference in the description or a
 * date within `days` of each other. Lines are taken in order and each payment is used once; when several payments would fit, one
 * whose reference appears on the line is preferred, then the nearest in date.
 */
export function matchStatement(lines: StatementLine[], payments: ReconcilePayment[], days = 4): { matches: ReconcileMatch[]; unmatchedRows: number[]; unmatchedPaymentIds: string[] } {
  const used = new Set<string>();
  const matches: ReconcileMatch[] = [];
  const unmatchedRows: number[] = [];
  const dayDiff = (a: string, b: string) => Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000));

  for (const line of lines) {
    const text = headingKey(line.description);
    let best: { p: ReconcilePayment; reason: ReconcileMatch['reason']; gap: number } | null = null;
    for (const p of payments) {
      if (used.has(p.id) || p.amountPaise !== line.creditPaise) continue;
      const ref = usableReference(p.reference);
      const byRef = ref !== '' && text.includes(ref);
      const gap = Math.min(dayDiff(p.receivedOn, line.date), p.chequeDate ? dayDiff(p.chequeDate, line.date) : Infinity);
      const byDate = gap <= days || (p.chequeDate !== null && line.date >= p.chequeDate && line.date <= addDays(p.chequeDate, days + 3));
      if (!byRef && !byDate) continue;
      const reason = byRef ? 'reference' : 'date';
      const better = !best || (reason === 'reference' && best.reason !== 'reference') || (reason === best.reason && gap < best.gap);
      if (better) best = { p, reason, gap };
    }
    if (best) {
      used.add(best.p.id);
      matches.push({ row: line.row, paymentId: best.p.id, reason: best.reason });
    } else unmatchedRows.push(line.row);
  }
  return { matches, unmatchedRows, unmatchedPaymentIds: payments.filter((p) => !used.has(p.id)).map((p) => p.id) };
}
