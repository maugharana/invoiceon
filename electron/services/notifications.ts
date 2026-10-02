import { addDays, formatDate, todayIso } from '../../shared/gst';
import { formatMoney } from '../../shared/money';
import type { AttentionItem, Notification } from '../../shared/types';
import { readyWishes } from './loyalty';
import { listProformas } from './proformas';
import { listWeaverOrders } from './weaverOrders';
import { overdueOrders } from './production';
import { OCCASION_WARNING_DAYS, belowCost, dueNotes, expiringQuotes, lowMargin, lowMaterials, occasions, reversedPayments } from './attention';
import type { Db } from '../db/connection';
import { budgetStatus, dueRecurring, listExpenses, payablesSummary } from './expenses';
import { listDesigns } from './inventory';
import { dueInstalments } from './instalments';
import { listInvoices } from './invoices';
import { listPayments } from './payments';

const money = (paise: number) => formatMoney(paise, { fractionDigits: 0 });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** How seriously each kind of attention item should be taken. */
const SEVERITY: Record<AttentionItem['kind'], Notification['severity']> = {
  'payment-reversed': 'urgent',
  'quote-expiring': 'soon',
  'below-cost': 'urgent',
  'follow-up': 'soon',
  promise: 'urgent',
  occasion: 'info',
  'low-margin': 'soon',
  'low-material': 'soon',
};

const fromAttention = (items: AttentionItem[], severity?: Notification['severity']): Notification[] => items.map((i) => ({ ...i, severity: severity ?? SEVERITY[i.kind] }));

/**
 * Everything that wants attention, worked out fresh each time from the books: nothing is stored, so a notification disappears the
 * moment the problem does. Urgent ones first, then those to do soon, then the nice-to-knows.
 */
export function notifications(db: Db, today: string = todayIso()): Notification[] {
  const out: Notification[] = [];

  // Money owed to you.
  const overdue = listInvoices(db, { status: 'overdue' });
  if (overdue.length > 0) {
    const total = overdue.reduce((s, i) => s + i.totalPaise - i.paidPaise, 0);
    out.push({ kind: 'overdue-invoices', id: 'overdue-invoices', severity: 'urgent', title: `${plural(overdue.length, 'invoice')} overdue`, detail: `${money(total)} is past its due date`, link: { to: 'path', path: '/invoices?status=overdue' } });
  }
  out.push(...fromAttention(reversedPayments(db, today)));
  out.push(...fromAttention(dueNotes(db, today)));
  for (const n of dueInstalments(db, addDays(today, 3), today)) {
    out.push({
      kind: 'instalment-due',
      id: `instalment:${n.id}`,
      severity: n.status === 'overdue' ? 'urgent' : 'soon',
      title: `${n.customerName} owes instalment ${n.position + 1} of ${n.invoiceNumber}`,
      detail: `${money(n.amountPaise - n.paidPaise)} ${n.status === 'overdue' ? 'was due' : 'due'} ${formatDate(n.dueDate)}`,
      link: { to: 'path', path: `/invoices/${encodeURIComponent(n.invoiceId)}` },
    });
  }
  for (const p of listPayments(db, { status: 'cheque' })) {
    if (p.chequeStatus !== 'pending' || !p.chequeDate || p.chequeDate > addDays(today, 2)) continue;
    out.push({ kind: 'cheque-due', id: `cheque:${p.id}`, severity: 'soon', title: `Cheque from ${p.customerName} is ready to deposit`, detail: `${money(p.amountPaise)} · dated ${formatDate(p.chequeDate)}${p.reference ? ` · ${p.reference}` : ''}`, link: { to: 'path', path: '/payments/cheques' } });
  }
  out.push(...fromAttention(expiringQuotes(db, today)));

  // Money you owe, and money going out faster than planned.
  const bills = payablesSummary(db, today);
  if (bills.overdueCount > 0) out.push({ kind: 'bill-due', id: 'bills-overdue', severity: 'urgent', title: `${plural(bills.overdueCount, 'bill')} past due`, detail: `${money(bills.overduePaise)} you owe`, link: { to: 'path', path: '/expenses' } });
  const soon = listExpenses(db, { status: 'unpaid' }).filter((e) => e.dueDate !== null && e.dueDate >= today && e.dueDate <= addDays(today, 3));
  if (soon.length > 0) out.push({ kind: 'bill-due', id: 'bills-soon', severity: 'soon', title: `${plural(soon.length, 'bill')} due in the next 3 days`, detail: money(soon.reduce((s, e) => s + e.amountPaise, 0)), link: { to: 'path', path: '/expenses' } });
  const standing = dueRecurring(db, today);
  if (standing.length > 0) {
    const n = standing.reduce((s, d) => s + d.dates.length, 0);
    out.push({ kind: 'recurring-due', id: 'recurring-due', severity: 'soon', title: `${plural(n, 'standing expense')} to enter`, detail: standing.map((d) => d.recurring.category).join(', '), link: { to: 'path', path: '/expenses' } });
  }
  for (const b of budgetStatus(db, today)) {
    if (b.status === 'ok') continue;
    out.push({
      kind: 'budget',
      id: `budget:${b.category.toLowerCase()}:${today.slice(0, 7)}`,
      severity: b.status === 'over' ? 'urgent' : 'soon',
      title: b.status === 'over' ? `${b.category} is over budget` : `${b.category} is close to its budget`,
      detail: `${money(b.spentPaise)} of ${money(b.budgetPaise)} spent this month`,
      link: { to: 'path', path: `/expenses?category=${encodeURIComponent(b.category)}` },
    });
  }

  // Work that was due to come in.
  const late = overdueOrders(db);
  if (late.length > 0) {
    out.push({ kind: 'production-late', id: 'production-late', severity: 'soon', title: `${plural(late.length, 'production order')} late`, detail: late.slice(0, 3).map((o) => `${o.designName} ${o.color}${o.vendorName ? ` (${o.vendorName})` : ''}`).join(', '), link: { to: 'path', path: '/inventory/production' } });
  }

  for (const w of readyWishes(db)) {
    out.push({ kind: 'wishlist-ready', id: `wish:${w.id}`, severity: 'info', title: `${w.customerName} was waiting for ${w.designName}`, detail: 'It is in stock now. Let them know.', link: { to: 'path', path: `/customers/${w.customerId}` } });
  }

  // Sarees ordered from weavers: ones that are late, and customers whose sarees have all arrived and can now be invoiced.
  const weaverOrders = listWeaverOrders(db, {}, today);
  const lateOrders = weaverOrders.filter((o) => o.late);
  if (lateOrders.length > 0) {
    out.push({ kind: 'weaver-late', id: 'weaver-late', severity: 'soon', title: `${plural(lateOrders.length, 'weaver order')} late`, detail: lateOrders.slice(0, 3).map((o) => `${o.vendorName} (${o.number}, expected ${formatDate(o.expectedOn!)})`).join(', ') + (lateOrders.length > 3 ? ` and ${lateOrders.length - 3} more` : ''), link: { to: 'path', path: '/inventory/weaver-orders' } });
  }
  const forQuote = new Map<string, typeof weaverOrders>();
  for (const o of weaverOrders) if (o.proformaId && o.status !== 'cancelled') forQuote.set(o.proformaId, [...(forQuote.get(o.proformaId) ?? []), o]);
  for (const q of listProformas(db)) {
    const orders = forQuote.get(q.id);
    if (!orders || !(q.status === 'open' || q.status === 'expired' || q.status === 'partial')) continue;
    if (orders.some((o) => o.status !== 'received')) continue;
    out.push({ kind: 'weaver-arrived', id: `weaver-arrived:${q.id}`, severity: 'soon', title: `The sarees for ${q.number} have arrived`, detail: `${q.buyerName}: ready to invoice`, link: { to: 'path', path: `/proformas/${encodeURIComponent(q.id)}` } });
  }

  // Stock and prices.
  const lowDesigns = listDesigns(db).filter((d) => d.status === 'low' || d.status === 'out');
  if (lowDesigns.length > 0) out.push({ kind: 'low-stock', id: 'low-stock', severity: 'soon', title: `${plural(lowDesigns.length, 'design')} low on stock`, detail: lowDesigns.slice(0, 3).map((d) => d.name).join(', ') + (lowDesigns.length > 3 ? ` and ${lowDesigns.length - 3} more` : ''), link: { to: 'path', path: '/inventory?status=low' } });
  out.push(...fromAttention(lowMaterials(db)));
  out.push(...fromAttention(belowCost(db)));
  out.push(...fromAttention(lowMargin(db)));

  // People.
  out.push(...fromAttention(occasions(db, today, Math.max(OCCASION_WARNING_DAYS, 7))));

  const rank = { urgent: 0, soon: 1, info: 2 } as const;
  return out.map((n, i) => ({ n, i })).sort((a, b) => rank[a.n.severity] - rank[b.n.severity] || a.i - b.i).map((x) => x.n);
}
