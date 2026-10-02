import { isIsoDate, todayIso } from '../../shared/gst';
import { COMPARE_OPTIONS, comparisonRange, resolvePeriod, trendBucketOf, trendGranularityFor, trendKeys, type CompareWith } from '../../shared/periods';
import type { DashboardMonth, DashboardNow, DashboardOverview, DashboardToday, TrendPoint } from '../../shared/types';
import { all, get, type Db } from '../db/connection';
import { attentionItems } from './attention';
import { UserError } from './common';
import { deadStock } from './deadstock';
import { listExpenses, overviewOf } from './expenses';
import { listInvoices } from './invoices';
import { gstNet } from './expenses';
import { gstReport, salesReport } from './reports';
import { getSettings } from './settings';

const DAY = 86_400_000;
const daysBetween = (fromIso: string, toIso: string): number => Math.round((Date.parse(toIso) - Date.parse(fromIso)) / DAY);

/** From the first thing ever recorded to today. An empty database gets the current month, so charts have somewhere to stand. */
function allTimeRange(db: Db, today: string): { from: string; to: string } {
  const first = get<{ d: string | null }>(
    db,
    `SELECT MIN(d) AS d FROM (
       SELECT MIN(issue_date) AS d FROM invoices
       UNION ALL SELECT MIN(received_on) FROM payments WHERE voided_at IS NULL AND kind = 'receipt'
       UNION ALL SELECT MIN(expense_date) FROM expenses WHERE deleted_at IS NULL
     )`,
  )?.d;
  const from = first && first < today ? first : `${today.slice(0, 7)}-01`;
  return { from, to: today };
}

function todayFigures(db: Db, today: string): DashboardToday {
  const issued = get<{ n: number; s: number }>(db, "SELECT COUNT(*) AS n, COALESCE(SUM(total_paise), 0) - (SELECT COALESCE(SUM(total_paise), 0) FROM credit_notes WHERE issue_date = ?) AS s FROM invoices WHERE status = 'issued' AND issue_date = ?", today, today)!;
  const received = get<{ n: number; s: number }>(db, "SELECT COALESCE(SUM(kind = 'receipt'), 0) AS n, COALESCE(SUM(CASE WHEN kind = 'refund' THEN -amount_paise ELSE amount_paise END), 0) AS s FROM payments WHERE voided_at IS NULL AND kind IN ('receipt', 'refund') AND received_on = ?", today)!;
  const dueToday = listInvoices(db).filter((i) => i.dueDate === today && (i.status === 'unpaid' || i.status === 'partial') && i.totalPaise - i.paidPaise > 0);
  return {
    date: today,
    invoiceCount: issued.n,
    invoicedPaise: issued.s,
    collectedPaise: received.s,
    paymentCount: received.n,
    expensesPaise: overviewOf(listExpenses(db, { from: today, to: today })).totalPaise,
    dueCount: dueToday.length,
    duePaise: dueToday.reduce((s, i) => s + i.totalPaise - i.paidPaise, 0),
  };
}

function monthFigures(db: Db, today: string): DashboardMonth {
  const range = resolvePeriod({ preset: 'this-month' }, today);
  const gst = gstReport(db, range).totals;
  const inputGst = gstNet(db, range).inputPaise;
  return {
    range,
    invoiceCount: gst.invoices,
    invoicedPaise: gst.invoiceValuePaise,
    gstPaise: gst.taxPaise,
    inputGstPaise: inputGst,
    netGstPaise: gst.taxPaise - inputGst,
    cgstPaise: gst.cgstPaise,
    sgstPaise: gst.sgstPaise,
    igstPaise: gst.igstPaise,
    targetPaise: getSettings(db).monthlyTargetPaise,
    daysElapsed: Number(today.slice(8, 10)),
    daysInMonth: Number(range.to.slice(8, 10)),
  };
}

/** The figures that are about today (or this month) and so ignore the period menu. */
export function dashboardNow(db: Db): DashboardNow {
  const today = todayIso();
  return { today: todayFigures(db, today), month: monthFigures(db, today), attention: attentionItems(db, today), deadStock: deadStock(db, today) };
}

/**
 * Everything the dashboard shows for a period, worked out in one go. "Invoiced" counts invoices by their date and "received" counts payments
 * by the day the money arrived (the same two measures the Sales report keeps side by side), so the two never quietly disagree.
 */
export function dashboardOverview(db: Db, requested: { from: string; to: string } | null, compare: CompareWith = 'previous'): DashboardOverview {
  const today = todayIso();
  if (requested && (!isIsoDate(requested.from) || !isIsoDate(requested.to) || requested.from > requested.to)) throw new UserError('Choose a valid date range.');
  if (!COMPARE_OPTIONS.includes(compare)) throw new UserError('Choose what to compare with.');
  const range = requested ?? allTimeRange(db, today);
  const inRange = (d: string) => d >= range.from && d <= range.to;

  const sales = salesReport(db, range);
  const expenses = listExpenses(db, range);
  const expenseOverview = overviewOf(expenses);

  // One point per day, week or month, carrying all three measures. Built from the same records the Sales report reads
  // (issued invoices by invoice date, live payments by the day they arrived), so the points add up to the headline figures.
  const granularity = trendGranularityFor(range);
  const trend: TrendPoint[] = trendKeys(range, granularity).map((key) => ({ key, invoicedPaise: 0, receivedPaise: 0, expensesPaise: 0 }));
  const byKey = new Map(trend.map((t) => [t.key, t]));
  for (const i of all<{ issue_date: string; total_paise: number }>(db, "SELECT issue_date, total_paise FROM invoices WHERE status = 'issued' AND issue_date BETWEEN ? AND ?", range.from, range.to)) byKey.get(trendBucketOf(i.issue_date, granularity))!.invoicedPaise += i.total_paise;
  for (const c of all<{ issue_date: string; total_paise: number }>(db, 'SELECT issue_date, total_paise FROM credit_notes WHERE issue_date BETWEEN ? AND ?', range.from, range.to)) byKey.get(trendBucketOf(c.issue_date, granularity))!.invoicedPaise -= c.total_paise;
  for (const p of all<{ received_on: string; amount_paise: number }>(db, "SELECT received_on, CASE WHEN kind = 'refund' THEN -amount_paise ELSE amount_paise END AS amount_paise FROM payments WHERE voided_at IS NULL AND kind IN ('receipt', 'refund') AND received_on BETWEEN ? AND ?", range.from, range.to)) byKey.get(trendBucketOf(p.received_on, granularity))!.receivedPaise += p.amount_paise;
  for (const e of expenses) byKey.get(trendBucketOf(e.date, granularity))!.expensesPaise += e.amountPaise;

  const invoices = listInvoices(db);
  const owed = (i: { totalPaise: number; paidPaise: number }) => i.totalPaise - i.paidPaise;
  const open = invoices.filter((i) => (i.status === 'unpaid' || i.status === 'partial' || i.status === 'overdue') && owed(i) > 0);
  // What is owed is a fact about today, whatever period is being looked at: an invoice from last month that is still unpaid is still owed.
  const overdueOpen = open.filter((i) => i.status === 'overdue');

  // How long customers really take: from the invoice date to the day the last rupee arrived, for invoices paid in full.
  const lastPaid = new Map(
    all<{ invoice_id: string; last_paid: string }>(
      db,
      `SELECT a.invoice_id, MAX(p.received_on) AS last_paid FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
       WHERE a.released_at IS NULL AND p.voided_at IS NULL GROUP BY a.invoice_id`,
    ).map((r) => [r.invoice_id, r.last_paid]),
  );
  const settled = invoices.filter((i) => i.status === 'paid' && inRange(i.issueDate) && lastPaid.has(i.id));
  // Money that arrived before the invoice (an advance) counts as paid on the day, not as negative days.
  const days = settled.map((i) => Math.max(0, daysBetween(i.issueDate, lastPaid.get(i.id)!)));
  const avgPaymentDays = days.length ? Math.round((days.reduce((s, d) => s + d, 0) / days.length) * 10) / 10 : null;

  // Everything owed today, by how old the invoice is. This is a picture of now, so the period filter doesn't apply.
  const aging = [
    { label: '0–30 days', from: 0, to: 30 },
    { label: '31–60 days', from: 31, to: 60 },
    { label: '61–90 days', from: 61, to: 90 },
    { label: '90+ days', from: 91, to: Infinity },
  ].map((b) => {
    const inBucket = open.filter((i) => {
      const age = daysBetween(i.issueDate, today);
      return age >= b.from && age <= b.to;
    });
    return { label: b.label, paise: inBucket.reduce((s, i) => s + owed(i), 0), count: inBucket.length };
  });

  let previous: DashboardOverview['previous'] = null;
  const compareRange = requested ? comparisonRange(range, compare) : null;
  if (compareRange) {
    const prev = salesReport(db, compareRange);
    const prevExpenses = overviewOf(listExpenses(db, compareRange)).totalPaise;
    previous = { invoicedPaise: prev.invoicedPaise, receivedPaise: prev.collectedPaise, expensesPaise: prevExpenses, netProfitPaise: prev.grossProfitPaise - prevExpenses };
  }

  return {
    range,
    allTime: requested === null,
    compare,
    compareRange,
    invoicedPaise: sales.invoicedPaise,
    invoiceCount: sales.invoiceCount,
    receivedPaise: sales.collectedPaise,
    paymentCount: sales.paymentCount,
    outstandingPaise: open.reduce((s, i) => s + owed(i), 0),
    openInvoices: open.length,
    overduePaise: overdueOpen.reduce((s, i) => s + owed(i), 0),
    overdueCount: overdueOpen.length,
    expensesPaise: expenseOverview.totalPaise,
    grossProfitPaise: sales.grossProfitPaise,
    marginPercent: sales.marginPercent,
    netProfitPaise: sales.grossProfitPaise - expenseOverview.totalPaise,
    avgPaymentDays,
    paidInvoiceCount: settled.length,
    previous,
    granularity,
    trend,
    aging,
    topClients: sales.topCustomers.slice(0, 5).map((c) => ({ customerId: c.customerId, name: c.name, invoicedPaise: c.invoicedPaise })),
    receivedByMethod: sales.byMethod,
    // The same ranking as the Sales report's "best-selling designs" (by sales before GST), so the two never disagree.
    bestSellers: sales.topDesigns.slice(0, 5).map((d) => ({ designId: d.designId, name: d.name, pieces: d.pieces, revenuePaise: d.revenuePaise })),
    expensesByCategory: expenseOverview.byCategory.map((c) => ({ category: c.category, paise: c.paise })),
    recent: invoices.slice(0, 5),
  };
}
