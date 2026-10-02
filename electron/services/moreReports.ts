import { addDays, todayIso } from '../../shared/gst';
import { sameDayLastYear } from '../../shared/periods';
import type { QuotesReport } from '../../shared/types';
import type { DayBook, DayBookEntry, DayBookMode, MarginBy, MarginLine, MarginReport, MarginRow, MoverClass, MoverRow, MoversReport, PaymentMethod, ProfitAndLoss, ProfitLossFigures, StockMovementReport, StockMovementRow } from '../../shared/types';
import { all, type Db } from '../db/connection';
import { UserError } from './common';
import { listExpenses, netOf, overviewOf } from './expenses';
import { listProformas } from './proformas';
import { listDesigns } from './inventory';
import { checkRange, loadInvoices, type LoadedInvoice } from './reports';

type Range = { from: string; to: string };
const sum = <T>(items: T[], f: (t: T) => number): number => items.reduce((s, t) => s + f(t), 0);

// ── Profit and loss ─────────────────────────────────────────────────────────
function figuresFor(db: Db, range: Range): ProfitLossFigures {
  const invoices = loadInvoices(db, range);
  const salesPaise = sum(invoices, (i) => i.row.taxable_paise);
  const costOfGoodsPaise = sum(
    invoices.flatMap((i) => i.lines),
    (l) => l.cost,
  );
  // Input GST is claimed back rather than lost, so profit is worked out on what the spending cost before it (as sales are before GST).
  const expenses = overviewOf(listExpenses(db, range).map((e) => ({ ...e, amountPaise: netOf(e) })));
  const grossProfitPaise = salesPaise - costOfGoodsPaise;
  return {
    invoiceCount: invoices.length,
    salesPaise,
    costOfGoodsPaise,
    grossProfitPaise,
    expensesByCategory: expenses.byCategory.map((c) => ({ category: c.category, paise: c.paise })),
    expensesPaise: expenses.totalPaise,
    netProfitPaise: grossProfitPaise - expenses.totalPaise,
  };
}

/** Sales less the cost of what was sold, less what was spent, with the same dates a year earlier beside it. */
export function profitAndLoss(db: Db, range: Range): ProfitAndLoss {
  checkRange(range);
  const before = { from: sameDayLastYear(range.from), to: sameDayLastYear(range.to) };
  const lastYear = figuresFor(db, before);
  const hadAnything = lastYear.invoiceCount > 0 || lastYear.expensesPaise > 0;
  return { range, ...figuresFor(db, range), lastYear: hadAnything ? { range: before, ...lastYear } : null };
}

// ── Quotes: won, lost and why ───────────────────────────────────────────────
/** How the quotes dated in the range turned out. A quote with any of it invoiced counts as won, even if it was only a part. */
export function quotesReport(db: Db, range: Range): QuotesReport {
  checkRange(range);
  const quotes = listProformas(db, { from: range.from, to: range.to });
  const firstInvoice = new Map(
    all<{ proforma_id: string; first: string }>(db, "SELECT pi.proforma_id, MIN(i.issue_date) AS first FROM proforma_invoices pi JOIN invoices i ON i.id = pi.invoice_id WHERE i.status = 'issued' GROUP BY pi.proforma_id").map((r) => [r.proforma_id, r.first]),
  );
  // What was actually invoiced from each quote: the totals of its invoices that still stand.
  const invoiced = new Map(
    all<{ proforma_id: string; total: number }>(db, "SELECT pi.proforma_id, SUM(i.total_paise) AS total FROM proforma_invoices pi JOIN invoices i ON i.id = pi.invoice_id WHERE i.status = 'issued' GROUP BY pi.proforma_id").map((r) => [r.proforma_id, r.total]),
  );
  const group = () => ({ count: 0, quotedPaise: 0 });
  const won = { count: 0, quotedPaise: 0, invoicedPaise: 0 };
  const lost = group();
  const expired = group();
  const open = group();
  let withdrawn = 0;
  const reasons = new Map<string, { reason: string; count: number; quotedPaise: number }>();
  const months = new Map<string, { month: string; count: number; quotedPaise: number; wonCount: number }>();
  const wonDays: number[] = [];

  for (const q of quotes) {
    if (q.status === 'cancelled') {
      withdrawn++;
      continue;
    }
    const month = months.get(q.issueDate.slice(0, 7)) ?? { month: q.issueDate.slice(0, 7), count: 0, quotedPaise: 0, wonCount: 0 };
    month.count++;
    month.quotedPaise += q.totalPaise;
    months.set(month.month, month);

    if (q.status === 'converted' || q.status === 'partial') {
      won.count++;
      won.quotedPaise += q.totalPaise;
      won.invoicedPaise += invoiced.get(q.id) ?? 0;
      month.wonCount++;
      const first = firstInvoice.get(q.id);
      if (first) wonDays.push(Math.max(0, Math.round((Date.parse(first) - Date.parse(q.issueDate)) / 86_400_000)));
    } else if (q.status === 'lost') {
      lost.count++;
      lost.quotedPaise += q.totalPaise;
      const reason = q.lostReason.trim() || 'No reason given';
      const r = reasons.get(reason.toLowerCase()) ?? { reason, count: 0, quotedPaise: 0 };
      r.count++;
      r.quotedPaise += q.totalPaise;
      reasons.set(reason.toLowerCase(), r);
    } else if (q.status === 'expired') {
      expired.count++;
      expired.quotedPaise += q.totalPaise;
    } else {
      open.count++;
      open.quotedPaise += q.totalPaise;
    }
  }

  const decided = won.count + lost.count + expired.count;
  const decidedValue = won.quotedPaise + lost.quotedPaise + expired.quotedPaise;
  return {
    range,
    quoteCount: quotes.length - withdrawn,
    quotedPaise: sum(quotes.filter((q) => q.status !== 'cancelled'), (q) => q.totalPaise),
    won,
    lost,
    expired,
    open,
    withdrawn,
    winRatePercent: decided > 0 ? (won.count / decided) * 100 : null,
    winRateByValuePercent: decidedValue > 0 ? (won.quotedPaise / decidedValue) * 100 : null,
    averageDaysToWin: wonDays.length > 0 ? sum(wonDays, (d) => d) / wonDays.length : null,
    lostReasons: [...reasons.values()].sort((a, b) => b.count - a.count || b.quotedPaise - a.quotedPaise),
    byMonth: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
  };
}

// ── Margin, by design / colour / customer ───────────────────────────────────
function keyOf(by: MarginBy, inv: LoadedInvoice, line: LoadedInvoice['lines'][number]): { key: string; name: string } {
  if (by === 'design') return { key: line.designId ?? `name:${line.designName.toLowerCase()}`, name: line.designName };
  if (by === 'colour') return { key: line.color.trim().toLowerCase(), name: line.color.trim() || 'No colour' };
  return inv.row.customer_id ? { key: inv.row.customer_id, name: inv.buyerName } : { key: 'walk-in', name: 'Walk-in customers' };
}

const marginOf = (profit: number, revenue: number): number | null => (revenue > 0 ? (profit / revenue) * 100 : null);

/** Sales, cost and profit grouped by design, colour or customer, best profit first. Revenue is before GST and after the invoice's discount. */
export function marginReport(db: Db, range: Range, by: MarginBy): MarginReport {
  checkRange(range);
  if (!['design', 'colour', 'customer'].includes(by)) throw new UserError('Choose design, colour or customer.');
  const rows = new Map<string, MarginRow & { invoices: Set<string> }>();
  for (const inv of loadInvoices(db, range)) {
    for (const line of inv.lines) {
      const { key, name } = keyOf(by, inv, line);
      const r = rows.get(key) ?? { key, name, pieces: 0, invoiceCount: 0, revenuePaise: 0, costPaise: 0, profitPaise: 0, marginPercent: null, invoices: new Set<string>() };
      r.pieces += line.qty;
      r.revenuePaise += line.taxable;
      r.costPaise += line.cost;
      r.invoices.add(inv.row.id);
      rows.set(key, r);
    }
  }
  const out: MarginRow[] = [...rows.values()]
    .map(({ invoices, ...r }) => ({ ...r, invoiceCount: invoices.size, profitPaise: r.revenuePaise - r.costPaise, marginPercent: marginOf(r.revenuePaise - r.costPaise, r.revenuePaise) }))
    .sort((a, b) => b.profitPaise - a.profitPaise || a.name.localeCompare(b.name));
  const revenuePaise = sum(out, (r) => r.revenuePaise);
  const costPaise = sum(out, (r) => r.costPaise);
  return { range, by, rows: out, totals: { pieces: sum(out, (r) => r.pieces), revenuePaise, costPaise, profitPaise: revenuePaise - costPaise, marginPercent: marginOf(revenuePaise - costPaise, revenuePaise) } };
}

/** The invoice lines behind one row of the margin report, newest first. */
export function marginDrill(db: Db, range: Range, by: MarginBy, key: string): MarginLine[] {
  checkRange(range);
  const lines: MarginLine[] = [];
  for (const inv of loadInvoices(db, range)) {
    for (const line of inv.lines) {
      if (keyOf(by, inv, line).key !== key) continue;
      lines.push({
        invoiceId: inv.row.id,
        number: inv.row.number,
        date: inv.row.issue_date,
        customer: inv.row.customer_id ? inv.buyerName : 'Walk-in customer',
        design: line.designName,
        color: line.color,
        size: line.size,
        qty: line.qty,
        revenuePaise: line.taxable,
        costPaise: line.cost,
      });
    }
  }
  return lines.sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
}

// ── Stock movement ──────────────────────────────────────────────────────────
/** The moment a local calendar day begins, as the UTC timestamp the stock ledger uses. */
const startOfDay = (isoDate: string): string => {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toISOString();
};

/** What came in and went out, design by design, between two dates; the opening and closing figures tie it together. */
export function stockMovementReport(db: Db, range: Range): StockMovementReport {
  checkRange(range);
  const start = startOfDay(range.from);
  const end = startOfDay(addDays(range.to, 1));
  const names = new Map(all<{ id: string; name: string }>(db, 'SELECT id, name FROM designs').map((d) => [d.id, d.name]));
  const opening = new Map(
    all<{ design_id: string; q: number }>(db, 'SELECT v.design_id, SUM(m.delta) AS q FROM stock_movements m JOIN variants v ON v.id = m.variant_id WHERE m.created_at < ? GROUP BY v.design_id', start).map((r) => [r.design_id, r.q]),
  );
  const moves = all<{ design_id: string; reason: string; q: number }>(
    db,
    'SELECT v.design_id, m.reason, SUM(m.delta) AS q FROM stock_movements m JOIN variants v ON v.id = m.variant_id WHERE m.created_at >= ? AND m.created_at < ? GROUP BY v.design_id, m.reason',
    start,
    end,
  );

  const rows = new Map<string, StockMovementRow>();
  const row = (designId: string): StockMovementRow => {
    let r = rows.get(designId);
    if (!r) {
      r = { designId, name: names.get(designId) ?? 'Removed design', opening: opening.get(designId) ?? 0, added: 0, returned: 0, sold: 0, damaged: 0, adjusted: 0, closing: 0 };
      rows.set(designId, r);
    }
    return r;
  };
  for (const [designId, q] of opening) if (q !== 0) row(designId);
  for (const m of moves) {
    const r = row(m.design_id);
    if (m.reason === 'purchase' || m.reason === 'production' || m.reason === 'opening') r.added += m.q;
    else if (m.reason === 'return') r.returned += m.q;
    else if (m.reason === 'sale') r.sold += -m.q;
    else if (m.reason === 'damage') r.damaged += -m.q;
    else r.adjusted += m.q;
  }
  const out = [...rows.values()].map((r) => ({ ...r, closing: r.opening + r.added + r.returned - r.sold - r.damaged + r.adjusted })).sort((a, b) => a.name.localeCompare(b.name));
  const total = (f: (r: StockMovementRow) => number) => sum(out, f);
  return {
    range,
    rows: out,
    totals: { opening: total((r) => r.opening), added: total((r) => r.added), returned: total((r) => r.returned), sold: total((r) => r.sold), damaged: total((r) => r.damaged), adjusted: total((r) => r.adjusted), closing: total((r) => r.closing) },
  };
}

// ── Fast movers and dead stock ──────────────────────────────────────────────
/** Every design sorted into fast sellers, steady sellers, and stock that hasn't moved, looking back over the last `days` days. */
export function moversReport(db: Db, days = 90, today: string = todayIso()): MoversReport {
  if (!Number.isInteger(days) || days < 7 || days > 730) throw new UserError('Look back between 7 and 730 days.');
  const since = addDays(today, -(days - 1));
  const sold = new Map(
    all<{ design_id: string; q: number }>(
      db,
      "SELECT v.design_id, SUM(l.qty) AS q FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN variants v ON v.id = l.variant_id WHERE i.status = 'issued' AND i.issue_date >= ? GROUP BY v.design_id",
      since,
    ).map((r) => [r.design_id, r.q]),
  );
  const designs = listDesigns(db);
  // The best third of the designs that sold anything count as fast.
  const sellers = designs.filter((d) => (sold.get(d.id) ?? 0) > 0).sort((a, b) => (sold.get(b.id) ?? 0) - (sold.get(a.id) ?? 0));
  const fast = new Set(sellers.slice(0, Math.ceil(sellers.length / 3)).map((d) => d.id));
  const rows: MoverRow[] = designs.map((d) => {
    const n = sold.get(d.id) ?? 0;
    const cls: MoverClass = n > 0 ? (fast.has(d.id) ? 'fast' : 'steady') : d.totalStock > 0 ? 'dead' : 'none';
    return {
      designId: d.id,
      name: d.name,
      stock: d.totalStock,
      sold: n,
      lastSoldOn: d.lastSoldOn,
      daysOfStock: n > 0 ? (d.totalStock > 0 ? Math.round(d.totalStock / (n / days)) : 0) : null,
      stockValuePaise: d.stockValuePaise,
      class: cls,
    };
  });
  const order: Record<MoverClass, number> = { fast: 0, steady: 1, dead: 2, none: 3 };
  return { days, rows: rows.sort((a, b) => order[a.class] - order[b.class] || b.sold - a.sold || b.stockValuePaise - a.stockValuePaise || a.name.localeCompare(b.name)) };
}

// ── Day book, cash book and bank book ───────────────────────────────────────
/**
 * Everything that happened, day by day. "all" is the day book: sales, money received and money spent. "cash" and "bank" are the
 * cash book and the bank book: only the money that moved by that route, with a running balance from the day before the range.
 * Sales don't move money by themselves, so they appear only in the day book. "Bank" means every method except cash (UPI, transfer,
 * cheque, card…).
 */
export function dayBook(db: Db, range: Range, mode: DayBookMode): DayBook {
  checkRange(range);
  if (!['all', 'cash', 'bank'].includes(mode)) throw new UserError('Choose the day book, cash book or bank book.');
  const inMode = (m: PaymentMethod) => mode === 'all' || (mode === 'cash' ? m === 'cash' : m !== 'cash');

  const receipts = (where: string, ...p: string[]) =>
    all<{ received_on: string; method: PaymentMethod; amount_paise: number; reference: string; note: string; name: string | null; created_at: string }>(
      db,
      `SELECT p.received_on, p.method, p.amount_paise, p.reference, p.note, c.name, p.created_at FROM payments p LEFT JOIN customers c ON c.id = p.customer_id WHERE p.voided_at IS NULL AND p.kind = 'receipt' AND ${where} ORDER BY p.received_on, p.created_at`,
      ...p,
    ).filter((r) => inMode(r.method));
  const spendings = (where: string, ...p: string[]) =>
    all<{ expense_date: string; method: PaymentMethod; amount_paise: number; category: string; vendor: string; reference: string; created_at: string }>(
      db,
      `SELECT COALESCE(paid_on, expense_date) AS expense_date, method, amount_paise, category, vendor, reference, created_at FROM expenses WHERE deleted_at IS NULL AND status = 'paid' AND ${where} ORDER BY COALESCE(paid_on, expense_date), created_at`,
      ...p,
    ).filter((r) => inMode(r.method));

  const opening = mode === 'all' ? null : sum(receipts('p.received_on < ?', range.from), (r) => r.amount_paise) - sum(spendings('COALESCE(paid_on, expense_date) < ?', range.from), (r) => r.amount_paise);

  const entries: (DayBookEntry & { order: string })[] = [];
  if (mode === 'all') {
    for (const inv of loadInvoices(db, range)) {
      entries.push({ order: `${inv.row.issue_date}1`, date: inv.row.issue_date, kind: 'sale', party: inv.row.customer_id ? inv.buyerName : 'Walk-in customer', detail: `Invoice ${inv.row.number}`, method: null, inPaise: 0, outPaise: 0, invoicedPaise: inv.row.total_paise, balancePaise: null });
    }
  }
  for (const r of receipts('p.received_on BETWEEN ? AND ?', range.from, range.to)) {
    entries.push({ order: `${r.received_on}2${r.created_at}`, date: r.received_on, kind: 'receipt', party: r.name ?? 'Walk-in customer', detail: [r.reference, r.note].filter(Boolean).join(' · ') || 'Payment received', method: r.method, inPaise: r.amount_paise, outPaise: 0, invoicedPaise: 0, balancePaise: null });
  }
  for (const r of spendings('COALESCE(paid_on, expense_date) BETWEEN ? AND ?', range.from, range.to)) {
    entries.push({ order: `${r.expense_date}3${r.created_at}`, date: r.expense_date, kind: 'expense', party: r.vendor || r.category, detail: [r.category, r.reference].filter(Boolean).join(' · '), method: r.method, inPaise: 0, outPaise: r.amount_paise, invoicedPaise: 0, balancePaise: null });
  }
  entries.sort((a, b) => a.order.localeCompare(b.order));

  let running = opening ?? 0;
  const out: DayBookEntry[] = entries.map(({ order: _order, ...e }) => {
    running += e.inPaise - e.outPaise;
    return { ...e, balancePaise: mode === 'all' ? null : running };
  });
  return { range, mode, openingPaise: opening, closingPaise: opening === null ? null : running, inPaise: sum(out, (e) => e.inPaise), outPaise: sum(out, (e) => e.outPaise), invoicedPaise: sum(out, (e) => e.invoicedPaise), entries: out };
}
