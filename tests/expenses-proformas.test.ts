import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import { dashboardOverview } from '../electron/services/dashboard';
import * as expenses from '../electron/services/expenses';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as customers from '../electron/services/customers';
import * as proformas from '../electron/services/proformas';
import * as reports from '../electron/services/reports';
import { loadSampleData } from '../electron/services/seed';
import { getSettings, saveSettings } from '../electron/services/settings';
import { addDays, todayIso } from '../shared/gst';
import { resolvePeriod, trendBucketOf, trendGranularityFor, trendKeys, weekStart } from '../shared/periods';
import type { ExpenseInput, ProformaInput } from '../shared/types';

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
    expect(o.previous).toEqual({ invoicedPaise: reports.salesReport(db, before).invoicedPaise, receivedPaise: reports.salesReport(db, before).collectedPaise, expensesPaise: rupees(21600 + 3200) });
    // The old invoice from 52 days ago still shows in "owed today" even though it's outside the period.
    expect(o.aging.reduce((s, b) => s + b.paise, 0)).toBeGreaterThan(o.outstandingPaise);
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
