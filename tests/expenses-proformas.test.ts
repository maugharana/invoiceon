import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, run, type Db } from '../electron/db/connection';
import { dashboardNow, dashboardOverview } from '../electron/services/dashboard';
import { festivalComparison } from '../electron/services/festival';
import * as expenses from '../electron/services/expenses';
import { reorderList } from '../electron/services/deadstock';
import { DASHBOARD_SECTIONS, defaultLayout, moveSection, normaliseLayout, toggleSection, visibleSections } from '../shared/dashboardLayout';
import { expensesBreakdownCsv, expensesCsv } from '../shared/csv';
import { FESTIVALS, festivalById, festivalSeason } from '../shared/festivals';
import { invoiceMessage, mailtoLink, quoteReminder, reorderNote, whatsappLink, whatsappPhone } from '../shared/messages';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as customers from '../electron/services/customers';
import * as payments from '../electron/services/payments';
import * as proformas from '../electron/services/proformas';
import * as reports from '../electron/services/reports';
import { loadSampleData } from '../electron/services/seed';
import { getSettings, saveSettings } from '../electron/services/settings';
import { addDays, formatDate, todayIso } from '../shared/gst';
import { comparisonRange, resolvePeriod, sameDayLastYear, trendBucketOf, trendGranularityFor, trendKeys, weekStart } from '../shared/periods';
import type { ExpenseInput, InvoiceInput, ProformaInput } from '../shared/types';

const rupees = (n: number) => n * 100;
const today = todayIso();

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});

const expense = (over: Partial<ExpenseInput> = {}): ExpenseInput => ({ date: today, category: 'Rent', vendor: 'Landlord', amountPaise: rupees(12000), method: 'bank', reference: '', note: '', ...over });

function stocked(stock = 5) {
  const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: 'Silk', hsnCode: '5007', description: '', defaultPricePaise: rupees(1000) });
  const v = inventory.createVariant(db, d.id, { color: 'Red', size: '6 m', sellPricePaise: rupees(1000), baseCostPaise: 0, reorderLevel: 0, openingStock: stock, bom: [] });
  return { d, v };
}

const quote = (variantId: string, over: Partial<ProformaInput> = {}): ProformaInput => ({
  type: 'B2C',
  customerId: null,
  issueDate: today,
  validUntil: addDays(today, 15),
  discountPaise: 0,
  notes: '',
  lines: [{ variantId, qty: 2, unitPricePaise: rupees(1000) }],
  ...over,
});

describe('expenses', () => {
  it('records, edits and removes expenses, and validates them', () => {
    const e = expenses.createExpense(db, expense({ category: ' Rent ' }));
    expect(e).toMatchObject({ category: 'Rent', amountPaise: rupees(12000), method: 'bank' });
    expect(expenses.updateExpense(db, e.id, expense({ amountPaise: rupees(13000), note: 'Raised' }))).toMatchObject({ amountPaise: rupees(13000), note: 'Raised' });
    expect(() => expenses.createExpense(db, expense({ amountPaise: 0 }))).toThrow(/Amount/);
    expect(() => expenses.createExpense(db, expense({ category: ' ' }))).toThrow(/Category is required/);
    expect(() => expenses.createExpense(db, expense({ date: '30-09-2026' }))).toThrow(/valid date/);
    expect(() => expenses.createExpense(db, expense({ method: 'barter' as never }))).toThrow(/how it was paid/);

    expenses.deleteExpense(db, e.id);
    expect(expenses.listExpenses(db)).toHaveLength(0);
    expect(() => expenses.getExpense(db, e.id)).toThrow(/no longer exists/);
    expect(() => expenses.deleteExpense(db, e.id)).toThrow(/no longer exists/);
  });

  it('filters, searches and totals by category', () => {
    expenses.createExpense(db, expense({ date: '2026-08-01', category: 'Rent', amountPaise: rupees(100) }));
    expenses.createExpense(db, expense({ date: '2026-08-15', category: 'Packaging', vendor: 'Shree Packaging', amountPaise: rupees(300) }));
    expenses.createExpense(db, expense({ date: '2026-09-02', category: 'packaging', amountPaise: rupees(50) }));
    expect(expenses.listExpenses(db, { from: '2026-08-10', to: '2026-08-31' })).toHaveLength(1);
    expect(expenses.listExpenses(db, { category: 'PACKAGING' })).toHaveLength(2);
    expect(expenses.listExpenses(db, { search: 'shree pack' })).toHaveLength(1);
    // Categories that differ only by case are one category, spelled the way it was first entered.
    expect(expenses.listExpenses(db).map((e) => e.category).sort()).toEqual(['Packaging', 'Packaging', 'Rent']);
    expect(expenses.expensesOverview(db)).toEqual({ totalPaise: rupees(450), count: 3, byCategory: [{ category: 'Packaging', paise: rupees(350), count: 2 }, { category: 'Rent', paise: rupees(100), count: 1 }] });
  });
});

describe('proformas', () => {
  it('quotes without touching stock, and can quote pieces that are not in stock yet', () => {
    const { v } = stocked(1);
    const p = proformas.createProforma(db, quote(v.id)); // 2 asked, 1 on the shelf
    expect(p).toMatchObject({ status: 'open', totalPaise: rupees(2100), invoiceId: null });
    expect(p.number).toMatch(/^PF\/\d{4}-\d{2}\/0001$/);
    expect(inventory.getVariant(db, v.id).stock).toBe(1);
    expect(proformas.createProforma(db, quote(v.id)).number).toMatch(/\/0002$/);
    expect(proformas.nextProformaNumber(db, today)).toMatch(/\/0003$/);
  });

  it('uses the proforma prefix and terms from settings, falling back to the invoice terms', () => {
    const { v } = stocked();
    saveSettings(db, { proformaPrefix: 'qt', proformaTerms: '' });
    const p = proformas.createProforma(db, quote(v.id));
    expect(p.number.startsWith('QT/')).toBe(true);
    expect(p.seller.terms).toBe(getSettings(db).invoiceTerms);
    saveSettings(db, { proformaTerms: '50% advance' });
    expect(proformas.createProforma(db, quote(v.id)).seller.terms).toBe('50% advance');
    // Frozen: changing settings later doesn't rewrite the quote.
    saveSettings(db, { proformaTerms: 'Changed' });
    expect(proformas.getProforma(db, p.id).seller.terms).toBe(getSettings(db).invoiceTerms);
  });

  it('holds proformas to the same rules as invoices', () => {
    const { v } = stocked();
    expect(() => proformas.createProforma(db, quote(v.id, { lines: [] }))).toThrow(/at least one item/);
    expect(() => proformas.createProforma(db, quote(v.id, { validUntil: addDays(today, -1) }))).toThrow(/expire before/);
    expect(() => proformas.createProforma(db, quote(v.id, { discountPaise: rupees(9999) }))).toThrow(/discount/);
    expect(() => proformas.createProforma(db, quote(v.id, { type: 'B2B' }))).toThrow(/Choose the customer/);
    const c = customers.createCustomer(db, { name: 'Meera', type: 'B2B', phone: '', email: '', gstin: '27AAPFU0939F1ZV', address: '', city: 'Mumbai', state: 'Maharashtra', pincode: '', notes: '' });
    expect(() => proformas.createProforma(db, quote(v.id, { type: 'B2B', customerId: c.id }))).toThrow(/your own GSTIN/);
    saveSettings(db, { gstin: '09AAACH7409R1ZZ', state: 'Uttar Pradesh' });
    const p = proformas.createProforma(db, quote(v.id, { type: 'B2B', customerId: c.id }));
    expect(p).toMatchObject({ intraState: false, placeOfSupply: 'Maharashtra' }); // other state: IGST, like an invoice
    expect(p.igstPaise).toBeGreaterThan(0);
  });

  it('lapses on its own and can be cancelled, but not twice', () => {
    const { v } = stocked();
    const p = proformas.createProforma(db, quote(v.id, { issueDate: addDays(today, -20), validUntil: addDays(today, -5) }));
    expect(p.status).toBe('expired');
    const live = proformas.createProforma(db, quote(v.id));
    expect(proformas.cancelProforma(db, live.id, ' changed mind ')).toMatchObject({ status: 'cancelled', cancelReason: 'changed mind' });
    expect(() => proformas.cancelProforma(db, live.id, '')).toThrow(/already cancelled/);
    expect(proformas.listProformas(db, { status: 'expired' }).map((x) => x.id)).toEqual([p.id]);
    expect(proformas.listProformas(db, { status: 'open' })).toHaveLength(0);
  });

  it('converts into an invoice at the quoted prices, taking stock, exactly once', () => {
    const { v } = stocked(5);
    const p = proformas.createProforma(db, quote(v.id, { lines: [{ variantId: v.id, qty: 2, unitPricePaise: rupees(900) }] })); // quoted below today's list price
    // The price list moves on…
    inventory.updateVariant(db, v.id, { color: 'Red', size: '6 m', sellPricePaise: rupees(2000), baseCostPaise: 0, reorderLevel: 0, bom: [] });

    const inv = proformas.convertProforma(db, p.id);
    expect(inv).toMatchObject({ type: 'B2C', issueDate: today, subtotalPaise: rupees(1800) }); // …but the quote holds
    expect(inv.lines[0]).toMatchObject({ qty: 2, unitPricePaise: rupees(900) });
    expect(inventory.getVariant(db, v.id).stock).toBe(3);
    expect(proformas.getProforma(db, p.id)).toMatchObject({ status: 'converted', invoiceId: inv.id, invoiceNumber: inv.number });

    expect(() => proformas.convertProforma(db, p.id)).toThrow(new RegExp(`already invoice ${inv.number.replaceAll('/', '\\/')}`));
    expect(() => proformas.cancelProforma(db, p.id, '')).toThrow(/Cancel that invoice instead/);
    expect(inventory.getVariant(db, v.id).stock).toBe(3);
  });

  it('refuses to convert when the pieces are not there, changing nothing', () => {
    const { v } = stocked(1);
    const p = proformas.createProforma(db, quote(v.id)); // wants 2, one on the shelf
    expect(() => proformas.convertProforma(db, p.id)).toThrow(/stock/i);
    expect(proformas.getProforma(db, p.id)).toMatchObject({ status: 'open', invoiceId: null });
    expect(invoices.listInvoices(db)).toHaveLength(0);
    expect(inventory.getVariant(db, v.id).stock).toBe(1);
    expect(() => proformas.convertProforma(db, proformas.cancelProforma(db, p.id, '').id)).toThrow(/was cancelled/);
  });
});

describe('dashboard overview (sample data)', () => {
  beforeEach(() => loadSampleData(db));

  it('has quotes and expenses in every state for the demo', () => {
    expect(proformas.listProformas(db).map((p) => p.status).sort()).toEqual(['cancelled', 'expired', 'open', 'open']);
    expect(expenses.listExpenses(db)).toHaveLength(9);
    expect(invoices.listInvoices(db)).toHaveLength(6); // quotes made no invoices
  });

  it('all time agrees with the reports it is built from', () => {
    const o = dashboardOverview(db, null);
    expect(o.allTime).toBe(true);
    expect(o.previous).toBeNull();
    expect(o.range.to).toBe(today);
    const sales = reports.salesReport(db, o.range);
    expect(o.invoicedPaise).toBe(sales.invoicedPaise);
    expect(o.receivedPaise).toBe(sales.collectedPaise);
    expect(o.receivedPaise).toBe(rupees(20000 + 10710 + 14175 + 3000));
    expect(o.expensesPaise).toBe(rupees(12000 + 38500 + 24000 + 12000 + 21600 + 3200 + 2400 + 4150 + 1800));
    // The chart's points add back up to the headline figures.
    expect(o.trend.reduce((s, t) => s + t.invoicedPaise, 0)).toBe(o.invoicedPaise);
    expect(o.trend.reduce((s, t) => s + t.receivedPaise, 0)).toBe(o.receivedPaise);
    expect(o.trend.reduce((s, t) => s + t.expensesPaise, 0)).toBe(o.expensesPaise);
    expect(o.expensesByCategory.reduce((s, c) => s + c.paise, 0)).toBe(o.expensesPaise);
    // Owed today, however you slice it, is one number.
    expect(o.aging.reduce((s, b) => s + b.paise, 0)).toBe(o.outstandingPaise);
    expect(o.outstandingPaise).toBe(invoices.dashboardSummary(db).outstandingPaise);
    expect(o.overdueCount).toBe(2);
    expect(o.overduePaise).toBe(invoices.dashboardSummary(db).overduePaise);
  });

  it('splits what was received by how it was paid, biggest first, adding back to the total', () => {
    const o = dashboardOverview(db, null);
    expect(o.receivedByMethod.reduce((s, m) => s + m.paise, 0)).toBe(o.receivedPaise);
    expect(o.receivedByMethod.reduce((s, m) => s + m.count, 0)).toBe(o.paymentCount);
    expect(o.receivedByMethod.map((m) => m.paise)).toEqual([...o.receivedByMethod.map((m) => m.paise)].sort((a, b) => b - a));
    expect(o.receivedByMethod).toEqual(reports.salesReport(db, o.range).byMethod);
    // Nothing received, nothing to split.
    expect(dashboardOverview(db, { from: addDays(today, -400), to: addDays(today, -399) }).receivedByMethod).toEqual([]);
  });

  it('profit is sales before GST less what the pieces cost, less the period\'s expenses', () => {
    const o = dashboardOverview(db, null);
    const sales = reports.salesReport(db, o.range);
    expect(o.grossProfitPaise).toBe(sales.grossProfitPaise);
    expect(o.marginPercent).toBe(sales.marginPercent);
    expect(o.netProfitPaise).toBe(sales.grossProfitPaise - o.expensesPaise);
    // A quiet period has no profit and no margin to quote.
    const quiet = dashboardOverview(db, { from: addDays(today, -400), to: addDays(today, -399) });
    expect(quiet).toMatchObject({ grossProfitPaise: 0, marginPercent: null, netProfitPaise: 0 });
  });

  it('spending with no sales is a loss', () => {
    const fresh = openDb(':memory:');
    expenses.createExpense(fresh, expense({ amountPaise: rupees(500) }));
    expect(dashboardOverview(fresh, null)).toMatchObject({ grossProfitPaise: 0, expensesPaise: rupees(500), netProfitPaise: -rupees(500) });
  });

  it('counts the cost recorded when each piece was sold, not today\'s cost', () => {
    const fresh = openDb(':memory:');
    const d = inventory.createDesign(fresh, { code: 'MG-009', name: 'Costed', fabric: 'Silk', hsnCode: '5007', description: '', defaultPricePaise: rupees(1000) });
    const v = inventory.createVariant(fresh, d.id, { color: 'Red', size: '6 m', sellPricePaise: rupees(1000), baseCostPaise: rupees(600), reorderLevel: 0, openingStock: 5, bom: [] });
    invoices.createInvoice(fresh, { type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: v.id, qty: 2, unitPricePaise: rupees(1000) }] });
    inventory.updateVariant(fresh, v.id, { color: 'Red', size: '6 m', sellPricePaise: rupees(1000), baseCostPaise: rupees(900), reorderLevel: 0, bom: [] }); // cost rises afterwards
    const o = dashboardOverview(fresh, null);
    expect(o.grossProfitPaise).toBe(rupees(2 * (1000 - 600)));
    expect(o.marginPercent).toBe(40);
  });

  it('works out how long customers take, and who the top clients are', () => {
    const o = dashboardOverview(db, null);
    expect(o.paidInvoiceCount).toBe(2); // the two counter sales, paid the day they were made
    expect(o.avgPaymentDays).toBe(0);
    expect(o.topClients[0]!.name).toMatch(/^Kanchan/);
    expect(o.topClients.length).toBeLessThanOrEqual(5);
    expect(o.recent).toHaveLength(5);
  });

  it('a period narrows the figures and compares with the period before it', () => {
    const period = { from: addDays(today, -13), to: today };
    const o = dashboardOverview(db, period);
    expect(o.allTime).toBe(false);
    expect(o.invoicedPaise).toBe(reports.salesReport(db, period).invoicedPaise);
    expect(o.expensesPaise).toBe(rupees(2400 + 4150 + 1800)); // last 14 days only
    // The period before is the same length, immediately earlier: -27 … -14.
    const before = { from: addDays(today, -27), to: addDays(today, -14) };
    expect(o.previous).toEqual({
      invoicedPaise: reports.salesReport(db, before).invoicedPaise,
      receivedPaise: reports.salesReport(db, before).collectedPaise,
      expensesPaise: rupees(21600 + 3200),
      netProfitPaise: reports.salesReport(db, before).grossProfitPaise - rupees(21600 + 3200),
    });
    // The old invoice from 52 days ago still shows in "owed today" even though it's outside the period.
    expect(o.aging.reduce((s, b) => s + b.paise, 0)).toBeGreaterThan(o.outstandingPaise);
  });

  it('can compare with the same dates a year earlier instead of the period before', () => {
    const period = { from: addDays(today, -13), to: today };
    const o = dashboardOverview(db, period, 'last-year');
    expect(o.compare).toBe('last-year');
    expect(o.compareRange).toEqual({ from: sameDayLastYear(period.from), to: sameDayLastYear(period.to) });
    expect(o.previous!.invoicedPaise).toBe(reports.salesReport(db, o.compareRange!).invoicedPaise);
    // The default is still the period just before, and all time has nothing to compare with either way.
    expect(dashboardOverview(db, period).compareRange).toEqual({ from: addDays(today, -27), to: addDays(today, -14) });
    expect(dashboardOverview(db, null, 'last-year')).toMatchObject({ previous: null, compareRange: null });
    expect(() => dashboardOverview(db, period, 'next-year' as never)).toThrow(/what to compare/);
  });

  it('refuses a broken range, and works on an empty database', async () => {
    expect(() => dashboardOverview(db, { from: '2026-09-30', to: '2026-09-01' })).toThrow(/valid date range/);
    const empty = openDb(':memory:');
    const o = dashboardOverview(empty, null);
    expect(o).toMatchObject({ invoicedPaise: 0, receivedPaise: 0, expensesPaise: 0, avgPaymentDays: null, openInvoices: 0 });
    expect(o.trend.length).toBeGreaterThan(0); // somewhere for the chart to stand
    const api = createApi(empty);
    expect((await api.dashboardOverview(null as never)).allTime).toBe(true); // JSON turns undefined into null
    expect((await api.dashboardOverview(resolvePeriod({ preset: 'this-month' }))).allTime).toBe(false);
  });
});

describe('dashboard today strip', () => {
  const sale = (variantId: string, over: Partial<InvoiceInput> = {}): InvoiceInput => ({ type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId, qty: 1, unitPricePaise: rupees(1000) }], ...over });

  it('is all zeros on a quiet day', () => {
    expect(dashboardNow(db).today).toEqual({ date: today, invoiceCount: 0, invoicedPaise: 0, collectedPaise: 0, paymentCount: 0, expensesPaise: 0, dueCount: 0, duePaise: 0 });
  });

  it('counts what was issued, received, spent and falls due today, and nothing from other days', () => {
    const { v } = stocked(10);
    const paid = invoices.createInvoice(db, sale(v.id, { payment: { amountPaise: rupees(1050), method: 'upi', reference: '' } }));
    const owing = invoices.createInvoice(db, sale(v.id, { lines: [{ variantId: v.id, qty: 2, unitPricePaise: rupees(1000) }] }));
    invoices.createInvoice(db, sale(v.id, { issueDate: addDays(today, -3), dueDate: addDays(today, 5) })); // an older invoice due later: not today
    const cancelled = invoices.createInvoice(db, sale(v.id));
    invoices.cancelInvoice(db, cancelled.id, '');
    expenses.createExpense(db, expense({ amountPaise: rupees(300) }));
    expenses.createExpense(db, expense({ date: addDays(today, -1), amountPaise: rupees(999) }));

    const t = dashboardNow(db).today;
    expect(t.invoiceCount).toBe(2); // the paid one and the owing one: the cancelled one is left out, the older one isn't today's
    expect(t.invoicedPaise).toBe(paid.totalPaise + owing.totalPaise);
    expect(t.collectedPaise).toBe(rupees(1050));
    expect(t.paymentCount).toBe(1);
    expect(t.expensesPaise).toBe(rupees(300));
    expect(t.dueCount).toBe(1); // only the one still owing and due today; the paid one is settled
    expect(t.duePaise).toBe(owing.totalPaise);
  });
});

describe('dashboard needs-attention list', () => {
  it('is empty when nothing is wrong', () => {
    stocked(5);
    expect(dashboardNow(db).attention).toEqual([]);
  });

  it('flags a recently reversed payment, with its reason and a link to the customer', () => {
    const c = customers.createCustomer(db, { type: 'B2C', name: 'Sunita', phone: '', email: '', gstin: '', address: '', city: '', state: '', pincode: '', notes: '' });
    const pay = payments.recordPayment(db, { customerId: c.id, amountPaise: rupees(2000), method: 'cheque', reference: '', receivedOn: today, note: '', allocations: [] });
    payments.voidPayment(db, pay.id, 'Cheque bounced');
    const [item] = dashboardNow(db).attention;
    expect(item).toMatchObject({ kind: 'payment-reversed', link: { to: 'customer', id: c.id } });
    expect(item!.title).toContain('Sunita');
    expect(item!.detail).toContain('Cheque bounced');
    expect(item!.detail).toContain(formatDate(today)); // the day it was reversed, by the owner's calendar
    // A payment that was never reversed isn't on the list.
    payments.recordPayment(db, { customerId: c.id, amountPaise: rupees(500), method: 'cash', reference: '', receivedOn: today, note: '', allocations: [] });
    expect(dashboardNow(db).attention).toHaveLength(1);
  });

  it('flags open quotes lapsing within three days, and only those', () => {
    const { v } = stocked(5);
    const soon = proformas.createProforma(db, quote(v.id, { validUntil: addDays(today, 3) }));
    proformas.createProforma(db, quote(v.id, { validUntil: addDays(today, 4) })); // a day too far
    proformas.cancelProforma(db, proformas.createProforma(db, quote(v.id, { validUntil: today })).id, ''); // cancelled: no longer waiting
    const items = dashboardNow(db).attention.filter((a) => a.kind === 'quote-expiring');
    expect(items.map((i) => i.link)).toEqual([{ to: 'proforma', id: soon.id }]);
    expect(items[0]!.title).toContain('lapses in 3 days');
  });

  it('flags a design with a variant priced below its cost, naming the worst one', () => {
    const d = inventory.createDesign(db, { code: 'MG-002', name: 'Loss maker', fabric: 'Silk', hsnCode: '5007', description: '', defaultPricePaise: rupees(900) });
    inventory.createVariant(db, d.id, { color: 'Red', size: '6 m', sellPricePaise: rupees(900), baseCostPaise: rupees(1100), reorderLevel: 0, openingStock: 1, bom: [] });
    inventory.createVariant(db, d.id, { color: 'Blue', size: '6 m', sellPricePaise: rupees(900), baseCostPaise: rupees(950), reorderLevel: 0, openingStock: 1, bom: [] });
    inventory.createVariant(db, d.id, { color: 'Green', size: '6 m', sellPricePaise: rupees(900), baseCostPaise: rupees(500), reorderLevel: 0, openingStock: 1, bom: [] }); // healthy
    const items = dashboardNow(db).attention;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'below-cost', link: { to: 'design', id: d.id } });
    expect(items[0]!.detail).toContain('Red 6 m');
    expect(items[0]!.detail).toContain('1 more');
    // Unpriced variants (a price of 0) aren't "below cost", they just aren't priced yet.
    inventory.createVariant(db, d.id, { color: 'Pink', size: '6 m', sellPricePaise: 0, baseCostPaise: rupees(500), reorderLevel: 0, openingStock: 0, bom: [] });
    expect(dashboardNow(db).attention[0]!.detail).toContain('1 more');
  });

  it('puts reversed payments first and never lists more than eight', () => {
    const { v } = stocked(5);
    for (let i = 0; i < 10; i++) proformas.createProforma(db, quote(v.id, { validUntil: addDays(today, 1) }));
    const c = customers.createCustomer(db, { type: 'B2C', name: 'Meena', phone: '', email: '', gstin: '', address: '', city: '', state: '', pincode: '', notes: '' });
    const pay = payments.recordPayment(db, { customerId: c.id, amountPaise: rupees(100), method: 'cash', reference: '', receivedOn: today, note: '', allocations: [] });
    payments.voidPayment(db, pay.id, '');
    const items = dashboardNow(db).attention;
    expect(items).toHaveLength(8);
    expect(items[0]!.kind).toBe('payment-reversed');
  });
});

describe('dashboard dead stock and best sellers', () => {
  /** A design with one variant of `stock` pieces, whose stock arrived `daysAgo` days ago. */
  function shelf(code: string, name: string, stock: number, daysAgo: number, costRupees = 400) {
    const d = inventory.createDesign(db, { code, name, fabric: 'Silk', hsnCode: '5007', description: '', defaultPricePaise: rupees(1000) });
    const v = inventory.createVariant(db, d.id, { color: 'Red', size: '6 m', sellPricePaise: rupees(1000), baseCostPaise: rupees(costRupees), reorderLevel: 0, openingStock: stock, bom: [] });
    run(db, 'UPDATE stock_movements SET created_at = ? WHERE variant_id = ?', `${addDays(today, -daysAgo)}T10:00:00.000Z`, v.id);
    return { d, v };
  }
  const sell = (variantId: string, daysAgo: number, qty = 1) => invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: addDays(today, -daysAgo), dueDate: addDays(today, -daysAgo), discountPaise: 0, notes: '', lines: [{ variantId, qty, unitPricePaise: rupees(1000) }] });

  it('lists stock unsold for 90 days, and leaves out what is new, recently sold, or gone', () => {
    shelf('MG-010', 'Fresh arrival', 4, 5); // too new to judge
    const old = shelf('MG-011', 'Never sold', 3, 200);
    const stale = shelf('MG-012', 'Sold long ago', 6, 300);
    sell(stale.v.id, 100);
    const moving = shelf('MG-013', 'Moving', 5, 300);
    sell(moving.v.id, 10);
    const gone = shelf('MG-014', 'Sold out', 1, 300);
    sell(gone.v.id, 120); // sold its only piece

    const dead = dashboardNow(db).deadStock;
    expect(dead.days).toBe(90);
    expect(dead.designs.map((d) => d.name).sort()).toEqual(['Never sold', 'Sold long ago']);
    const neverSold = dead.designs.find((d) => d.designId === old.d.id)!;
    expect(neverSold).toMatchObject({ pieces: 3, variants: 1, costValuePaise: rupees(3 * 400), lastSoldOn: null });
    // 6 bought, 1 sold 100 days ago, 5 left.
    expect(dead.designs.find((d) => d.designId === stale.d.id)).toMatchObject({ pieces: 5, lastSoldOn: addDays(today, -100) });
    expect(dead).toMatchObject({ designCount: 2, pieces: 8, costValuePaise: rupees(8 * 400) });
  });

  it('ranks by money tied up, shows five, and still counts the rest', () => {
    for (let i = 0; i < 7; i++) shelf(`MG-02${i}`, `Old ${i}`, i + 1, 200);
    const dead = dashboardNow(db).deadStock;
    expect(dead.designCount).toBe(7);
    expect(dead.designs).toHaveLength(5);
    expect(dead.designs.map((d) => d.name)).toEqual(['Old 6', 'Old 5', 'Old 4', 'Old 3', 'Old 2']);
    expect(dead.pieces).toBe(1 + 2 + 3 + 4 + 5 + 6 + 7);
  });

  it('is empty on a shop with no stock', () => {
    expect(dashboardNow(db).deadStock).toEqual({ days: 90, designCount: 0, pieces: 0, costValuePaise: 0, designs: [] });
  });

  it('lists best sellers in the same order as the Sales report, five at most', () => {
    for (let i = 0; i < 7; i++) sell(shelf(`MG-03${i}`, `Seller ${i}`, 20, 5).v.id, 1, i + 1);
    const o = dashboardOverview(db, { from: addDays(today, -7), to: today });
    expect(o.bestSellers).toHaveLength(5);
    expect(o.bestSellers.map((s) => s.name)).toEqual(['Seller 6', 'Seller 5', 'Seller 4', 'Seller 3', 'Seller 2']);
    expect(o.bestSellers[0]).toMatchObject({ pieces: 7, revenuePaise: rupees(7000) });
    expect(o.bestSellers.map((s) => s.designId)).toEqual(reports.salesReport(db, o.range).topDesigns.slice(0, 5).map((d) => d.designId));
    // Nothing sold in a quiet period.
    expect(dashboardOverview(db, { from: addDays(today, -400), to: addDays(today, -399) }).bestSellers).toEqual([]);
  });
});

describe('dashboard layout', () => {
  const ALL = DASHBOARD_SECTIONS.map((s) => s.id);

  it('starts with every section shown, in the page\'s natural order', () => {
    expect(defaultLayout()).toEqual({ order: ALL, hidden: [] });
    expect(visibleSections(defaultLayout())).toEqual(ALL);
    expect(ALL[0]).toBe('attention');
  });

  it('moves a section up or down, and stops at the ends', () => {
    let l = defaultLayout();
    l = moveSection(l, 'today', -1);
    expect(l.order.slice(0, 2)).toEqual(['today', 'attention']);
    l = moveSection(l, 'today', -1); // already first
    expect(l.order.slice(0, 2)).toEqual(['today', 'attention']);
    l = moveSection(l, 'activity', 1); // already last
    expect(l.order.at(-1)).toBe('activity');
    expect(l.order).toHaveLength(ALL.length);
  });

  it('hides and shows sections without losing their place', () => {
    let l = toggleSection(defaultLayout(), 'charts');
    expect(l.hidden).toEqual(['charts']);
    expect(visibleSections(l)).not.toContain('charts');
    expect(l.order).toContain('charts'); // still in the order, ready to come back
    l = toggleSection(l, 'charts');
    expect(l).toEqual(defaultLayout());
  });

  it('repairs whatever was saved: unknown ids dropped, repeats removed, new sections added at the end', () => {
    expect(normaliseLayout({ order: ['charts', 'bogus', 'charts', 'today'], hidden: ['today', 'nope', 'today'] })).toEqual({
      order: ['charts', 'today', ...ALL.filter((id) => id !== 'charts' && id !== 'today')],
      hidden: ['today'],
    });
    for (const junk of [null, undefined, 5, 'x', [], { order: 'abc', hidden: 7 }]) expect(normaliseLayout(junk)).toEqual(defaultLayout());
  });
});

describe('reminders and reorder notes', () => {
  it('writes an invoice message that says what is owed, by when, and where to pay', () => {
    const inv = { number: 'MG/2026-27/0004', buyerName: 'Sunita Devi', totalPaise: rupees(10500), paidPaise: rupees(2500), dueDate: '2026-10-20' };
    const m = invoiceMessage(inv, { name: 'Mau Gharana', upiId: 'maugharana@sbi' });
    expect(m.subject).toBe('Invoice MG/2026-27/0004 from Mau Gharana');
    expect(m.body).toContain('Hello Sunita Devi,');
    expect(m.body).toContain('₹10,500');
    expect(m.body).toContain('We have received ₹2,500.');
    expect(m.body).toContain('balance of ₹8,000 is due by');
    expect(m.body).toContain('maugharana@sbi');
    const paid = invoiceMessage({ ...inv, paidPaise: inv.totalPaise }, { name: 'Mau Gharana', upiId: 'maugharana@sbi' });
    expect(paid.body).toContain('paid in full');
    expect(paid.body).not.toContain('maugharana@sbi');
    expect(invoiceMessage({ ...inv, buyerName: 'Walk-in customer', dueDate: null }, { name: '', upiId: '' }).body).toMatch(/^Hello there,[\s\S]*is due\./);
    expect(mailtoLink('a b@x.com', 'Hi there', 'Line 1\nLine 2')).toBe('mailto:a%20b%40x.com?subject=Hi%20there&body=Line%201%0ALine%202');
  });

  it('turns a phone number into one WhatsApp understands', () => {
    expect(whatsappPhone('98765 43210')).toBe('919876543210');
    expect(whatsappPhone('09876543210')).toBe('919876543210');
    expect(whatsappPhone('+91 98765-43210')).toBe('919876543210');
    expect(whatsappPhone('+1 (415) 555-0100')).toBe('14155550100');
    expect(whatsappPhone('12345')).toBeNull();
    expect(whatsappPhone('')).toBeNull();
    expect(whatsappLink('919876543210', 'Hi & bye?')).toBe('https://wa.me/919876543210?text=Hi%20%26%20bye%3F');
  });

  it('writes a polite quote reminder', () => {
    const text = quoteReminder({ number: 'PF/2026-27/0003', buyerName: 'Sunita Devi', totalPaise: rupees(21000), validUntil: '2026-10-05' }, 'Mau Gharana');
    expect(text).toContain('Hello Sunita Devi,');
    expect(text).toContain('PF/2026-27/0003');
    expect(text).toContain('₹21,000');
    expect(text).toContain('Mau Gharana');
    expect(quoteReminder({ number: 'PF/1', buyerName: 'Walk-in customer', totalPaise: 100, validUntil: '2026-10-05' }, '')).toContain('Hello there,');
  });

  it('lists low and out-of-stock variants by saree, and says so when there are none', () => {
    const d = inventory.createDesign(db, { code: 'MG-050', name: 'Banarasi Katan Kadhua', nickname: 'Kadhua', fabric: 'Silk', hsnCode: '5007', description: '', defaultPricePaise: rupees(1000) });
    const mk =(color: string, stock: number, reorderLevel: number) => inventory.createVariant(db, d.id, { color, size: '6.3 m', sellPricePaise: rupees(1000), baseCostPaise: rupees(400), reorderLevel, openingStock: stock, bom: [] });
    mk('Red', 1, 3); // low
    mk('Blue', 0, 3); // out
    mk('Green', 10, 3); // fine
    mk('Pink', 5, 0); // a level of 0 never counts as low
    const rows = reorderList(db);
    expect(rows.map((r) => `${r.color}:${r.stock}`)).toEqual(['Blue:0', 'Red:1']);
    expect(rows[0]).toMatchObject({ designName: 'Banarasi Katan Kadhua', nickname: 'Kadhua', size: '6.3 m', reorderLevel: 3 });
    const note = reorderNote(rows, 'Mau Gharana', '2026-10-02');
    expect(note).toContain('Banarasi Katan Kadhua (Kadhua)');
    expect(note).toContain('Blue, 6.3 m: out of stock (reorder at 3)');
    expect(note).toContain('Red, 6.3 m: 1 left (reorder at 3)');
    expect(note).not.toContain('Green');
    expect(reorderNote([], 'Mau Gharana', '2026-10-02')).toBe('Nothing needs reordering.');
  });

  it('is available through the API', async () => {
    expect(await createApi(openDb(':memory:')).dashboardReorderList()).toEqual([]);
  });
});

describe('festival seasons', () => {
  // Raksha Bandhan 2025 was 9 Aug (season 30 Jul – 11 Aug); 2026 is 28 Aug (season 18 – 30 Aug).
  function sales() {
    const { v } = stocked(50);
    const sell = (date: string, qty = 1) => invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: date, dueDate: date, discountPaise: 0, notes: '', lines: [{ variantId: v.id, qty, unitPricePaise: rupees(1000) }] });
    sell('2025-07-29'); // just before last year's season: not counted
    sell('2025-08-01', 2);
    sell('2025-08-10', 3); // late in last year's season
    sell('2026-08-19', 4);
    sell('2026-08-21');
  }

  it('lists the festivals, with a season around each date and the dates checked', () => {
    expect(FESTIVALS.map((f) => f.id)).toEqual(['diwali', 'navratri', 'rakhi']);
    expect(festivalSeason(festivalById('diwali')!, 2026)).toEqual({ date: '2026-11-08', from: '2026-10-09', to: '2026-11-13' });
    expect(festivalSeason(festivalById('rakhi')!, 2025)).toEqual({ date: '2025-08-09', from: '2025-07-30', to: '2025-08-11' });
    expect(festivalSeason(festivalById('rakhi')!, 2035)).toBeNull();
  });

  it('refuses a festival it does not know', () => {
    expect(() => festivalComparison(db, 'holi', '2026-08-01')).toThrow(/Choose a festival/);
  });

  it('before the season, shows last year\'s to beat and nothing for this year', () => {
    sales();
    const c = festivalComparison(db, 'rakhi', '2026-08-10');
    expect(c).toMatchObject({ state: 'upcoming', startsInDays: 8, date: '2026-08-28', thisSeason: null, season: { from: '2026-08-18', to: '2026-08-30' } });
    expect(c.lastSeason).toMatchObject({ range: { from: '2025-07-30', to: '2025-08-11' }, invoiceCount: 2, piecesSold: 5, invoicedPaise: rupees(5250) });
  });

  it('while it runs, cuts last year to the same number of days', () => {
    sales();
    const c = festivalComparison(db, 'rakhi', '2026-08-22'); // 5 days in: 18, 19, 20, 21, 22
    expect(c.state).toBe('running');
    expect(c.thisSeason).toMatchObject({ range: { from: '2026-08-18', to: '2026-08-22' }, invoiceCount: 2, piecesSold: 5 });
    expect(c.lastSeason).toMatchObject({ range: { from: '2025-07-30', to: '2025-08-03' }, invoiceCount: 1, piecesSold: 2 }); // the 10th Aug sale is later than day 5
  });

  it('afterwards, sets the two whole seasons side by side', () => {
    sales();
    const c = festivalComparison(db, 'rakhi', '2026-09-05');
    expect(c.state).toBe('done');
    expect(c.thisSeason).toMatchObject({ range: { from: '2026-08-18', to: '2026-08-30' }, invoicedPaise: rupees(5250), piecesSold: 5 });
    expect(c.lastSeason).toMatchObject({ range: { from: '2025-07-30', to: '2025-08-11' }, invoicedPaise: rupees(5250), piecesSold: 5 });
  });

  it('copes with a year that is not in the list, and with no sales at all', () => {
    expect(festivalComparison(db, 'diwali', '2035-06-01')).toMatchObject({ state: 'unknown', date: null, season: null, thisSeason: null, lastSeason: null });
    const quiet = festivalComparison(db, 'diwali', '2026-11-20');
    expect(quiet.thisSeason).toMatchObject({ invoicedPaise: 0, invoiceCount: 0, piecesSold: 0 });
    expect(quiet.lastSeason).toMatchObject({ invoicedPaise: 0 });
  });

  it('is available through the API', async () => {
    const api = createApi(db);
    expect((await api.dashboardFestival('diwali')).festivalId).toBe('diwali');
    await expect(api.dashboardFestival('nope')).rejects.toThrow(/Choose a festival/);
  });
});

describe('dashboard month figures', () => {
  it('adds up this month\'s GST the way the GST report does, and ignores other months and cancelled invoices', () => {
    const { v } = stocked(10);
    const sale = (over: Partial<InvoiceInput> = {}): InvoiceInput => ({ type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: v.id, qty: 1, unitPricePaise: rupees(1000) }], ...over });
    const first = invoices.createInvoice(db, sale());
    invoices.createInvoice(db, sale({ lines: [{ variantId: v.id, qty: 3, unitPricePaise: rupees(1000) }] }));
    invoices.cancelInvoice(db, invoices.createInvoice(db, sale()).id, '');
    invoices.createInvoice(db, sale({ issueDate: addDays(`${today.slice(0, 7)}-01`, -1) })); // last day of last month

    const m = dashboardNow(db).month;
    const monthRange = resolvePeriod({ preset: 'this-month' });
    expect(m.range).toEqual(monthRange);
    const gst = reports.gstReport(db, monthRange).totals;
    expect(m).toMatchObject({ invoiceCount: 2, gstPaise: gst.taxPaise, cgstPaise: gst.cgstPaise, sgstPaise: gst.sgstPaise, igstPaise: gst.igstPaise, invoicedPaise: gst.invoiceValuePaise });
    expect(first.totalPaise).toBe(rupees(1050));
    expect(m.gstPaise).toBe(rupees(200)); // 5% of ₹1,000 plus 5% of ₹3,000
  });

  it('is zero on an empty database', () => {
    expect(dashboardNow(db).month).toMatchObject({ invoiceCount: 0, invoicedPaise: 0, gstPaise: 0 });
  });

  it('carries the monthly target and how far through the month we are', () => {
    expect(dashboardNow(db).month.targetPaise).toBe(0); // none set by default
    saveSettings(db, { monthlyTargetPaise: rupees(500000) });
    const m = dashboardNow(db).month;
    expect(m.targetPaise).toBe(rupees(500000));
    expect(m.daysElapsed).toBe(Number(today.slice(8, 10)));
    expect(m.daysInMonth).toBe(Number(m.range.to.slice(8, 10)));
    expect(m.daysElapsed).toBeLessThanOrEqual(m.daysInMonth);
    saveSettings(db, { monthlyTargetPaise: 0 }); // turning it off
    expect(dashboardNow(db).month.targetPaise).toBe(0);
  });

  it('rejects a target that is negative or not a whole number of paise', () => {
    expect(() => saveSettings(db, { monthlyTargetPaise: -1 })).toThrow(/less than 0/);
    expect(() => saveSettings(db, { monthlyTargetPaise: 100.5 })).toThrow(/whole number/);
    expect(() => saveSettings(db, { monthlyTargetPaise: 1e15 })).toThrow(/too large/);
    expect(getSettings(db).monthlyTargetPaise).toBe(0);
  });
});

describe('comparison ranges', () => {
  it('finds the same date a year earlier, keeping 29 February valid', () => {
    expect(sameDayLastYear('2026-10-02')).toBe('2025-10-02');
    expect(sameDayLastYear('2028-02-29')).toBe('2027-02-28');
    expect(sameDayLastYear('2029-03-01')).toBe('2028-03-01');
    expect(sameDayLastYear('2029-02-28')).toBe('2028-02-28');
  });
  it('compares with the stretch before, or the same dates last year', () => {
    const r = { from: '2026-09-01', to: '2026-09-30' };
    expect(comparisonRange(r, 'previous')).toEqual({ from: '2026-08-02', to: '2026-08-31' });
    expect(comparisonRange(r, 'last-year')).toEqual({ from: '2025-09-01', to: '2025-09-30' });
  });
});

describe('dashboard trend buckets', () => {
  it('picks days for a few weeks, weeks for a few months, months beyond', () => {
    expect(trendGranularityFor({ from: '2026-09-01', to: '2026-09-21' })).toBe('day'); // 21 days
    expect(trendGranularityFor({ from: '2026-09-01', to: '2026-09-22' })).toBe('week'); // 22 days
    expect(trendGranularityFor({ from: '2026-04-01', to: '2026-09-29' })).toBe('week'); // 182 days
    expect(trendGranularityFor({ from: '2026-04-01', to: '2026-09-30' })).toBe('month'); // 183 days
  });

  it('weeks start on Monday and are keyed by that Monday', () => {
    expect(weekStart('2026-09-28')).toBe('2026-09-28'); // a Monday
    expect(weekStart('2026-09-30')).toBe('2026-09-28'); // Wednesday
    expect(weekStart('2026-10-04')).toBe('2026-09-28'); // Sunday belongs to the week before it starts
    expect(weekStart('2026-10-05')).toBe('2026-10-05');
    expect(weekStart('2026-01-01')).toBe('2025-12-29'); // across a year end
  });

  it('every date in a range lands in a bucket that exists, whatever the granularity', () => {
    const range = { from: '2026-08-03', to: '2026-09-30' };
    for (const g of ['day', 'week', 'month'] as const) {
      const keys = new Set(trendKeys(range, g));
      for (let d = range.from; d <= range.to; d = addDays(d, 1)) expect(keys.has(trendBucketOf(d, g))).toBe(true);
    }
    expect(trendKeys(range, 'week')[0]).toBe('2026-08-03');
    expect(trendKeys({ from: '2026-08-05', to: '2026-08-20' }, 'week')[0]).toBe('2026-08-03'); // starts before the range's first day
    expect(trendKeys(range, 'month')).toEqual(['2026-08', '2026-09']);
  });
});

describe('editing a proforma', () => {
  it('changes the items, prices and dates but keeps the same quote and number', () => {
    const { v } = stocked(5);
    const p = proformas.createProforma(db, quote(v.id));
    expect(p.totalPaise).toBe(rupees(2100)); // 2 × ₹1,000 + 5%
    const edited = proformas.updateProforma(db, p.id, quote(v.id, { lines: [{ variantId: v.id, qty: 3, unitPricePaise: rupees(900) }], notes: 'Festival price', validUntil: addDays(today, 30) }));
    expect(edited).toMatchObject({ id: p.id, number: p.number, notes: 'Festival price', totalPaise: rupees(2835), validUntil: addDays(today, 30), status: 'open' });
    expect(edited.lines).toHaveLength(1);
    expect(edited.lines[0]).toMatchObject({ qty: 3, unitPricePaise: rupees(900), amountPaise: rupees(2700) });
    expect(proformas.listProformas(db)).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM proforma_lines').get()).toEqual({ n: 1 }); // replaced, not piled up
  });

  it('can move a quote to a different customer or add lines for pieces not in stock', () => {
    const { v } = stocked(1);
    const p = proformas.createProforma(db, quote(v.id, { lines: [{ variantId: v.id, qty: 1, unitPricePaise: rupees(1000) }] }));
    const bigger = proformas.updateProforma(db, p.id, quote(v.id, { lines: [{ variantId: v.id, qty: 20, unitPricePaise: rupees(1000) }] })); // a quote takes no stock
    expect(bigger.totalPaise).toBe(rupees(21000));
    expect(proformas.updateProforma(db, p.id, quote(v.id, { buyerName: 'Meena' })).buyer.name).toBe('Meena');
  });

  it('brings a lapsed quote back to life when given a later date', () => {
    const { v } = stocked(5);
    const p = proformas.createProforma(db, quote(v.id, { issueDate: addDays(today, -20), validUntil: addDays(today, -5) }));
    expect(p.status).toBe('expired');
    expect(proformas.updateProforma(db, p.id, quote(v.id, { issueDate: addDays(today, -20), validUntil: addDays(today, 10) })).status).toBe('open');
  });

  it('refuses once it is invoiced or cancelled, or on bad input, and leaves the quote as it was', () => {
    const { v } = stocked(5);
    const done = proformas.createProforma(db, quote(v.id));
    proformas.convertProforma(db, done.id);
    expect(() => proformas.updateProforma(db, done.id, quote(v.id))).toThrow(/became an invoice/);
    const gone = proformas.cancelProforma(db, proformas.createProforma(db, quote(v.id)).id, '');
    expect(() => proformas.updateProforma(db, gone.id, quote(v.id))).toThrow(/was cancelled/);
    expect(() => proformas.updateProforma(db, 'nope', quote(v.id))).toThrow(/no longer exists/);

    const p = proformas.createProforma(db, quote(v.id));
    expect(() => proformas.updateProforma(db, p.id, quote(v.id, { lines: [] }))).toThrow();
    expect(() => proformas.updateProforma(db, p.id, quote(v.id, { validUntil: addDays(today, -400), issueDate: today }))).toThrow(/can't expire before/);
    expect(proformas.getProforma(db, p.id).totalPaise).toBe(rupees(2100));
    expect(proformas.getProforma(db, p.id).lines).toHaveLength(1);
  });

  it('keeps the quote inside the financial year its number belongs to', () => {
    const { v } = stocked(5);
    const p = proformas.createProforma(db, quote(v.id));
    const otherYear = addDays(today, 400);
    expect(() => proformas.updateProforma(db, p.id, quote(v.id, { issueDate: otherYear, validUntil: addDays(otherYear, 10) }))).toThrow(/financial year/);
  });

  it('is available through the API', async () => {
    const { v } = stocked(5);
    const api = createApi(db);
    const p = await api.proformaCreate(quote(v.id));
    expect((await api.proformaUpdate(p.id, quote(v.id, { notes: 'via api' }))).notes).toBe('via api');
  });
});

describe('proforma list by date', () => {
  it('filters by quote date, inclusive, and refuses a bad date', () => {
    const { v } = stocked(5);
    const old = proformas.createProforma(db, quote(v.id, { issueDate: addDays(today, -30), validUntil: addDays(today, -20) }));
    const mid = proformas.createProforma(db, quote(v.id, { issueDate: addDays(today, -10) }));
    const recent = proformas.createProforma(db, quote(v.id));
    const ids = (q: Parameters<typeof proformas.listProformas>[1]) => proformas.listProformas(db, q).map((p) => p.id).sort();
    expect(ids({ from: addDays(today, -10) })).toEqual([mid.id, recent.id].sort());
    expect(ids({ to: addDays(today, -10) })).toEqual([old.id, mid.id].sort());
    expect(ids({ from: addDays(today, -10), to: addDays(today, -10) })).toEqual([mid.id]);
    expect(ids({ from: '', to: '' })).toHaveLength(3);
    expect(() => proformas.listProformas(db, { from: 'x' })).toThrow(/valid "from" date/);
  });
});

describe('expenses by category and month', () => {
  const on = (date: string, category: string, rupeesAmount: number) => expenses.createExpense(db, expense({ date, category, amountPaise: rupees(rupeesAmount) }));

  it('lays spending out by category and month, with totals that add up both ways', () => {
    on('2026-07-10', 'Rent', 1000);
    on('2026-08-10', 'Rent', 1000);
    on('2026-08-20', 'Wages', 500);
    on('2026-09-05', 'Rent', 1200);
    on('2026-09-06', 'wages', 700); // same category, different case
    const b = expenses.expensesBreakdown(db, { from: '2026-07-01', to: '2026-09-30' });
    expect(b.months).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(b.rows.map((r) => [r.category, r.byMonth, r.totalPaise])).toEqual([
      ['Rent', [rupees(1000), rupees(1000), rupees(1200)], rupees(3200)],
      ['Wages', [0, rupees(500), rupees(700)], rupees(1200)],
    ]);
    expect(b.monthTotals).toEqual([rupees(1000), rupees(1500), rupees(1900)]);
    expect(b.totalPaise).toBe(rupees(4400));
    expect(b.rows.reduce((s, r) => s + r.totalPaise, 0)).toBe(b.totalPaise);
    expect(b.monthTotals.reduce((s, m) => s + m, 0)).toBe(b.totalPaise);
  });

  it('shows quiet months as empty columns when the dates are fixed', () => {
    on('2026-07-10', 'Rent', 1000);
    on('2026-09-10', 'Rent', 1000);
    const b = expenses.expensesBreakdown(db, { from: '2026-07-01', to: '2026-09-30' });
    expect(b.rows[0]!.byMonth).toEqual([rupees(1000), 0, rupees(1000)]);
  });

  it('compares each category with the stretch of the same length just before', () => {
    on('2026-04-15', 'Rent', 900); // previous quarter: Apr–Jun
    on('2026-05-15', 'Packaging', 300);
    on('2026-07-15', 'Rent', 1000);
    on('2026-08-15', 'Wages', 400);
    const b = expenses.expensesBreakdown(db, { from: '2026-07-01', to: '2026-09-30' });
    expect(b.previous).toMatchObject({ totalPaise: rupees(1200) });
    expect(b.previous!.to).toBe('2026-06-30');
    const byName = Object.fromEntries(b.rows.map((r) => [r.category, r.previousPaise]));
    expect(byName).toEqual({ Rent: rupees(900), Wages: 0 }); // wages are new; packaging didn't recur so isn't listed
  });

  it('runs from the first to the last month with spending when there is no date range, and has nothing to compare with', () => {
    on('2026-06-10', 'Rent', 1000);
    on('2026-09-10', 'Rent', 1000);
    const b = expenses.expensesBreakdown(db);
    expect(b.months).toEqual(['2026-06', '2026-07', '2026-08', '2026-09']);
    expect(b.previous).toBeNull();
    expect(b.rows[0]!.previousPaise).toBeNull();
    expect(expenses.expensesBreakdown(openDb(':memory:'))).toMatchObject({ months: [], rows: [], totalPaise: 0, previous: null });
  });

  it('respects a category filter and works through the API', async () => {
    on('2026-07-10', 'Rent', 1000);
    on('2026-07-11', 'Wages', 500);
    const b = await createApi(db).expensesBreakdown({ category: 'wages', from: '2026-07-01', to: '2026-07-31' });
    expect(b.rows.map((r) => r.category)).toEqual(['Wages']);
  });

  it('exports the list and the breakdown as spreadsheets', () => {
    on('2026-07-10', 'Rent', 1000);
    const e = expenses.listExpenses(db)[0]!;
    expect(expensesCsv([e]).replace('﻿', '').trim().split('\r\n')).toEqual(['Date,Category,Paid to,Paid by,Reference,Amount,Note', '2026-07-10,Rent,Landlord,Bank transfer,,1000.00,']);
    const b = expenses.expensesBreakdown(db, { from: '2026-07-01', to: '2026-08-31' });
    expect(expensesBreakdownCsv(b).replace('﻿', '').trim().split('\r\n')).toEqual(['Category,2026-07,2026-08,Total,Previous period', 'Rent,1000.00,0.00,1000.00,0.00', 'Total,1000.00,0.00,1000.00,0.00']);
  });
});
