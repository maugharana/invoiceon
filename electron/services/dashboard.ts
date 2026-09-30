import { addDays, isIsoDate, todayIso } from '../../shared/gst';
import { daysInRange, trendBucketOf, trendGranularityFor, trendKeys } from '../../shared/periods';
import type { DashboardOverview, TrendPoint } from '../../shared/types';
import { all, get, type Db } from '../db/connection';
import { UserError } from './common';
import { listExpenses, overviewOf } from './expenses';
import { listInvoices } from './invoices';
import { salesReport } from './reports';

const DAY = 86_400_000;
const daysBetween = (fromIso: string, toIso: string): number => Math.round((Date.parse(toIso) - Date.parse(fromIso)) / DAY);

/** From the first thing ever recorded to today. An empty database gets the current month, so charts have somewhere to stand. */
function allTimeRange(db: Db, today: string): { from: string; to: string } {
  const first = get<{ d: string | null }>(
    db,
    `SELECT MIN(d) AS d FROM (
       SELECT MIN(issue_date) AS d FROM invoices
       UNION ALL SELECT MIN(received_on) FROM payments WHERE voided_at IS NULL AND source = 'receipt'
       UNION ALL SELECT MIN(expense_date) FROM expenses WHERE deleted_at IS NULL
     )`,
  )?.d;
  const from = first && first < today ? first : `${today.slice(0, 7)}-01`;
  return { from, to: today };
}

/**
 * Everything the dashboard shows, worked out in one go. "Invoiced" counts invoices by their date and "received" counts payments
 * by the day the money arrived (the same two measures the Sales report keeps side by side), so the two never quietly disagree.
 */
export function dashboardOverview(db: Db, requested: { from: string; to: string } | null): DashboardOverview {
  const today = todayIso();
  if (requested && (!isIsoDate(requested.from) || !isIsoDate(requested.to) || requested.from > requested.to)) throw new UserError('Choose a valid date range.');
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
  for (const p of all<{ received_on: string; amount_paise: number }>(db, "SELECT received_on, amount_paise FROM payments WHERE voided_at IS NULL AND source = 'receipt' AND received_on BETWEEN ? AND ?", range.from, range.to)) byKey.get(trendBucketOf(p.received_on, granularity))!.receivedPaise += p.amount_paise;
  for (const e of expenses) byKey.get(trendBucketOf(e.date, granularity))!.expensesPaise += e.amountPaise;

  const invoices = listInvoices(db);
  const owed = (i: { totalPaise: number; paidPaise: number }) => i.totalPaise - i.paidPaise;
  const open = invoices.filter((i) => (i.status === 'unpaid' || i.status === 'partial' || i.status === 'overdue') && owed(i) > 0);
  const openInRange = open.filter((i) => inRange(i.issueDate));
  const overdueInRange = openInRange.filter((i) => i.status === 'overdue');

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
  if (requested) {
    const length = daysInRange(range);
    const before = { from: addDays(range.from, -length), to: addDays(range.from, -1) };
    const prev = salesReport(db, before);
    previous = { invoicedPaise: prev.invoicedPaise, receivedPaise: prev.collectedPaise, expensesPaise: overviewOf(listExpenses(db, before)).totalPaise };
  }

  return {
    range,
    allTime: requested === null,
    invoicedPaise: sales.invoicedPaise,
    invoiceCount: sales.invoiceCount,
    receivedPaise: sales.collectedPaise,
    paymentCount: sales.paymentCount,
    outstandingPaise: openInRange.reduce((s, i) => s + owed(i), 0),
    openInvoices: openInRange.length,
    overduePaise: overdueInRange.reduce((s, i) => s + owed(i), 0),
    overdueCount: overdueInRange.length,
    expensesPaise: expenseOverview.totalPaise,
    avgPaymentDays,
    paidInvoiceCount: settled.length,
    previous,
    granularity,
    trend,
    aging,
    topClients: sales.topCustomers.slice(0, 5).map((c) => ({ customerId: c.customerId, name: c.name, invoicedPaise: c.invoicedPaise })),
    expensesByCategory: expenseOverview.byCategory.map((c) => ({ category: c.category, paise: c.paise })),
    recent: invoices.slice(0, 5),
  };
}
