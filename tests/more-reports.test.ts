import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, run, type Db } from '../electron/db/connection';
import * as customers from '../electron/services/customers';
import * as expenses from '../electron/services/expenses';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as moreReports from '../electron/services/moreReports';
import * as payments from '../electron/services/payments';
import * as reports from '../electron/services/reports';
import { saveSettings } from '../electron/services/settings';
import { dayBookCsv, marginCsv, movementCsv, moversCsv, profitLossCsv, receivablesCsv } from '../shared/csv';
import { addDays, todayIso } from '../shared/gst';
import type { PaymentMethod } from '../shared/types';
import * as receivables from '../electron/services/receivables';

const rupees = (n: number) => n * 100;
const today = todayIso();
const wide = { from: addDays(today, -400), to: today };

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { gstin: '09AABCK1234M1ZI' });
});

/** A design with a red and a blue variant, each costing ₹400 and selling at ₹1,000. */
function shop(stock = 50) {
  const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: 'Silk', hsnCode: '5007', description: '', defaultPricePaise: rupees(1000) });
  const mk = (color: string) => inventory.createVariant(db, d.id, { color, size: '6 m', sellPricePaise: rupees(1000), baseCostPaise: rupees(400), reorderLevel: 0, openingStock: stock, bom: [] });
  return { d, red: mk('Red'), blue: mk('Blue') };
}
const sell = (customerId: string | null, variantId: string, qty = 1, daysAgo = 0, discount = 0) =>
  invoices.createInvoice(db, { type: 'B2C', customerId, issueDate: addDays(today, -daysAgo), dueDate: addDays(today, -daysAgo), discountPaise: rupees(discount), notes: '', lines: [{ variantId, qty, unitPricePaise: rupees(1000) }] });
const person = (name: string) => customers.createCustomer(db, { name, type: 'B2C', phone: '', email: '', gstin: '', address: '', city: '', state: '', pincode: '', notes: '' });
const spend = (date: string, category: string, amount: number, method: PaymentMethod = 'bank') => expenses.createExpense(db, { date, category, vendor: '', amountPaise: rupees(amount), method, reference: '', note: '' });
const receive = (customerId: string | null, amount: number, daysAgo = 0, method: PaymentMethod = 'cash', invoiceId?: string) =>
  payments.recordPayment(db, { customerId, amountPaise: rupees(amount), method, reference: '', receivedOn: addDays(today, -daysAgo), note: '', allocations: invoiceId ? [{ invoiceId, amountPaise: rupees(amount) }] : [] });

describe('profit and loss', () => {
  it('is sales less cost of goods less expenses, and agrees with the Sales report', () => {
    const { red } = shop();
    sell(null, red.id, 3); // ₹3,000 sales, ₹1,200 cost
    spend(today, 'Rent', 500);
    spend(today, 'Wages', 300);
    const p = moreReports.profitAndLoss(db, wide);
    expect(p).toMatchObject({ invoiceCount: 1, salesPaise: rupees(3000), costOfGoodsPaise: rupees(1200), grossProfitPaise: rupees(1800), expensesPaise: rupees(800), netProfitPaise: rupees(1000) });
    expect(p.expensesByCategory.map((c) => c.category)).toEqual(['Rent', 'Wages']);
    expect(p.grossProfitPaise).toBe(reports.salesReport(db, wide).grossProfitPaise);
    expect(p.lastYear).toBeNull(); // nothing happened a year ago
  });

  it('puts the same dates last year beside it, and counts a loss as negative', () => {
    const { red } = shop();
    sell(null, red.id, 2, 365 + 3);
    spend(addDays(today, -365 - 3), 'Rent', 5000);
    sell(null, red.id, 1, 3);
    const p = moreReports.profitAndLoss(db, { from: addDays(today, -10), to: today });
    expect(p.netProfitPaise).toBe(rupees(600));
    expect(p.lastYear).toMatchObject({ salesPaise: rupees(2000), grossProfitPaise: rupees(1200), expensesPaise: rupees(5000), netProfitPaise: -rupees(3800) });
  });

  it('refuses a bad range and works through the API', async () => {
    expect(() => moreReports.profitAndLoss(db, { from: '2026-10-05', to: '2026-10-01' })).toThrow(/after the end/);
    expect((await createApi(db).reportProfitLoss(wide)).netProfitPaise).toBe(0);
  });
});

describe('margin by design, colour and customer', () => {
  it('adds up to the same profit whichever way it is grouped', () => {
    const { d, red, blue } = shop();
    const a = person('Anita');
    const b = person('Bela');
    sell(a.id, red.id, 2);
    sell(b.id, blue.id, 3, 5, 100); // ₹100 off
    sell(null, red.id, 1, 9);
    const total = reports.salesReport(db, wide).grossProfitPaise;
    for (const by of ['design', 'colour', 'customer'] as const) {
      const m = moreReports.marginReport(db, wide, by);
      expect(m.totals.profitPaise).toBe(total);
      expect(m.rows.reduce((s, r) => s + r.profitPaise, 0)).toBe(total);
      expect(m.totals.pieces).toBe(6);
    }
    const byDesign = moreReports.marginReport(db, wide, 'design');
    expect(byDesign.rows).toHaveLength(1);
    expect(byDesign.rows[0]).toMatchObject({ key: d.id, name: 'Butidar', pieces: 6, invoiceCount: 3 });
    const byColour = moreReports.marginReport(db, wide, 'colour');
    expect(byColour.rows.map((r) => [r.name, r.pieces])).toEqual([['Red', 3], ['Blue', 3]]);
    expect(byColour.rows[0]!.marginPercent).toBeCloseTo(60, 5); // (1000 − 400) / 1000
    const byCustomer = moreReports.marginReport(db, wide, 'customer');
    expect(byCustomer.rows.map((r) => r.name).sort()).toEqual(['Anita', 'Bela', 'Walk-in customers']);
    const bela = byCustomer.rows.find((r) => r.name === 'Bela')!;
    expect(bela).toMatchObject({ revenuePaise: rupees(2900), costPaise: rupees(1200), profitPaise: rupees(1700) }); // the discount comes off sales
  });

  it('shows the invoice lines behind a row, and they add up to the row', () => {
    const { red, blue } = shop();
    const a = person('Anita');
    sell(a.id, red.id, 2, 3);
    sell(a.id, blue.id, 1, 1);
    sell(null, red.id, 4);
    const m = moreReports.marginReport(db, wide, 'customer');
    const row = m.rows.find((r) => r.name === 'Anita')!;
    const lines = moreReports.marginDrill(db, wide, 'customer', row.key);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.color)).toEqual(['Blue', 'Red']); // newest first
    expect(lines.reduce((s, l) => s + l.revenuePaise, 0)).toBe(row.revenuePaise);
    expect(lines.reduce((s, l) => s + l.costPaise, 0)).toBe(row.costPaise);
    expect(moreReports.marginDrill(db, wide, 'colour', 'red')).toHaveLength(2);
    expect(moreReports.marginDrill(db, wide, 'design', 'nope')).toEqual([]);
  });

  it('leaves out cancelled invoices, is empty with no sales, and refuses an unknown grouping', async () => {
    const { red } = shop();
    invoices.cancelInvoice(db, sell(null, red.id, 5).id, '');
    expect(moreReports.marginReport(db, wide, 'design')).toMatchObject({ rows: [], totals: { pieces: 0, marginPercent: null } });
    expect(() => moreReports.marginReport(db, wide, 'size' as never)).toThrow(/design, colour or customer/);
    expect((await createApi(db).reportMargin(wide, 'colour')).rows).toEqual([]);
    expect(await createApi(db).reportMarginDrill(wide, 'colour', 'red')).toEqual([]);
  });
});

describe('stock movement', () => {
  /** Puts the whole stock ledger `daysAgo` days in the past, so a range can start after it. */
  const backdate = (daysAgo: number) => run(db, 'UPDATE stock_movements SET created_at = ?', `${addDays(today, -daysAgo)}T06:00:00.000Z`);

  it('ties opening, additions and sales to the closing stock', () => {
    const { red, blue } = shop(20);
    backdate(30);
    sell(null, red.id, 4, 5);
    inventory.adjustStock(db, { variantId: blue.id, delta: 6, reason: 'purchase', note: '' });
    inventory.adjustStock(db, { variantId: blue.id, delta: -2, reason: 'damage', note: '' });
    inventory.adjustStock(db, { variantId: red.id, delta: -1, reason: 'adjustment', note: 'count' });
    const m = moreReports.stockMovementReport(db, { from: addDays(today, -10), to: today });
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]).toMatchObject({ name: 'Butidar', opening: 40, added: 6, returned: 0, sold: 4, damaged: 2, adjusted: -1, closing: 39 });
    expect(m.totals.closing).toBe(inventory.getDesign(db, m.rows[0]!.designId).totalStock);
    for (const r of m.rows) expect(r.opening + r.added + r.returned - r.sold - r.damaged + r.adjusted).toBe(r.closing);
  });

  it('counts stock arriving in the range as additions, and a return as a return', () => {
    const { red } = shop(10);
    const inv = sell(null, red.id, 3);
    invoices.cancelInvoice(db, inv.id, ''); // puts the pieces back as a return
    const m = moreReports.stockMovementReport(db, { from: today, to: today });
    expect(m.rows[0]).toMatchObject({ opening: 0, added: 20, returned: 3, sold: 3, closing: 20 });
  });

  it('is empty when nothing ever moved, and works through the API', async () => {
    expect(moreReports.stockMovementReport(db, wide)).toMatchObject({ rows: [], totals: { opening: 0, closing: 0 } });
    shop(5);
    expect((await createApi(db).reportMovement(wide)).totals.closing).toBe(10);
  });
});

describe('fast movers and dead stock', () => {
  function designs() {
    const mk = (code: string, name: string, stock: number) => {
      const d = inventory.createDesign(db, { code, name, fabric: '', hsnCode: '', description: '', defaultPricePaise: rupees(1000) });
      return inventory.createVariant(db, d.id, { color: 'Red', size: '6 m', sellPricePaise: rupees(1000), baseCostPaise: rupees(400), reorderLevel: 0, openingStock: stock, bom: [] });
    };
    return { hit: mk('A-1', 'Hit', 100), ok: mk('A-2', 'Okay', 100), ok2: mk('A-3', 'Okay too', 100), stuck: mk('A-4', 'Stuck', 5), gone: mk('A-5', 'Gone', 0) };
  }

  it('sorts designs into fast, steady, not moving and no stock', () => {
    const { hit, ok, ok2 } = designs();
    sell(null, hit.id, 30, 10);
    sell(null, ok.id, 5, 10);
    sell(null, ok2.id, 2, 10);
    sell(null, ok2.id, 7, 200); // outside the 90 days
    const r = moreReports.moversReport(db, 90);
    const by = Object.fromEntries(r.rows.map((x) => [x.name, x]));
    expect(by['Hit']).toMatchObject({ class: 'fast', sold: 30 });
    expect(by['Okay']).toMatchObject({ class: 'steady', sold: 5 });
    expect(by['Okay too']).toMatchObject({ class: 'steady', sold: 2 });
    expect(by['Stuck']).toMatchObject({ class: 'dead', sold: 0, stock: 5, daysOfStock: null });
    expect(by['Gone']).toMatchObject({ class: 'none', stock: 0 });
    expect(r.rows.map((x) => x.name)).toEqual(['Hit', 'Okay', 'Okay too', 'Stuck', 'Gone']); // fast, steady, not moving, none
    expect(by['Hit']!.daysOfStock).toBe(Math.round(70 / (30 / 90)));
  });

  it('only counts sales inside the window, refuses silly windows, and says 0 days for a sold-out seller', async () => {
    const { ok } = designs();
    sell(null, ok.id, 100, 10); // sells everything
    expect(moreReports.moversReport(db, 90).rows.find((x) => x.name === 'Okay')).toMatchObject({ stock: 0, daysOfStock: 0, class: 'fast' });
    expect(moreReports.moversReport(db, 7).rows.find((x) => x.name === 'Okay')!.sold).toBe(0); // the sale was 10 days ago
    expect(() => moreReports.moversReport(db, 3)).toThrow(/between 7 and 730/);
    expect((await createApi(db).reportMovers()).days).toBe(90);
  });
});

describe('day book, cash book and bank book', () => {
  it('lists sales, money in and money out in order, with the totals', () => {
    const { red } = shop();
    const c = person('Anita');
    const inv = sell(c.id, red.id, 1, 2);
    receive(c.id, 500, 1, 'upi', inv.id);
    spend(today, 'Rent', 200, 'cash');
    const b = moreReports.dayBook(db, wide, 'all');
    expect(b.entries.map((e) => e.kind)).toEqual(['sale', 'receipt', 'expense']);
    expect(b).toMatchObject({ invoicedPaise: inv.totalPaise, inPaise: rupees(500), outPaise: rupees(200), openingPaise: null, closingPaise: null });
    expect(b.entries[0]).toMatchObject({ party: 'Anita', detail: `Invoice ${inv.number}`, method: null });
    expect(b.entries.every((e) => e.balancePaise === null)).toBe(true);
  });

  it('keeps cash and bank money apart and runs a balance from the day before', () => {
    const { red } = shop();
    const c = person('Anita');
    receive(c.id, 1000, 30, 'cash'); // before the range: becomes the opening cash
    spend(addDays(today, -29), 'Tea', 100, 'cash');
    receive(c.id, 400, 5, 'cash');
    receive(c.id, 700, 4, 'upi');
    spend(addDays(today, -3), 'Rent', 150, 'cash');
    spend(addDays(today, -2), 'Packaging', 50, 'bank');
    sell(c.id, red.id, 1); // sales never reach the cash or bank book

    const range = { from: addDays(today, -10), to: today };
    const cash = moreReports.dayBook(db, range, 'cash');
    expect(cash.openingPaise).toBe(rupees(900)); // 1,000 in, 100 out
    expect(cash.entries.map((e) => [e.inPaise, e.outPaise, e.balancePaise])).toEqual([[rupees(400), 0, rupees(1300)], [0, rupees(150), rupees(1150)]]);
    expect(cash.closingPaise).toBe(rupees(1150));

    const bank = moreReports.dayBook(db, range, 'bank');
    expect(bank.openingPaise).toBe(0);
    expect(bank.entries.map((e) => e.method)).toEqual(['upi', 'bank']);
    expect(bank.closingPaise).toBe(rupees(650));
    expect(cash.entries.concat(bank.entries).some((e) => e.kind === 'sale')).toBe(false);
  });

  it('leaves out reversed payments and deleted expenses', () => {
    const c = person('Anita');
    const bad = receive(c.id, 300, 0, 'cash');
    payments.voidPayment(db, bad.id, 'Bounced');
    const gone = spend(today, 'Rent', 100, 'cash');
    expenses.deleteExpense(db, gone.id);
    expect(moreReports.dayBook(db, wide, 'cash')).toMatchObject({ entries: [], inPaise: 0, outPaise: 0, openingPaise: 0, closingPaise: 0 });
  });

  it('refuses an unknown book and works through the API', async () => {
    expect(() => moreReports.dayBook(db, wide, 'safe' as never)).toThrow(/day book, cash book or bank book/);
    expect((await createApi(db).reportDayBook(wide, 'all')).mode).toBe('all');
  });
});

describe('report spreadsheets', () => {
  it('writes each report with a title, headings and totals', () => {
    const { red } = shop();
    const c = person('Anita, Devi');
    const inv = sell(c.id, red.id, 2);
    receive(c.id, 100, 0, 'cash', inv.id);
    spend(today, 'Rent', 50, 'cash');
    const lines = (csv: string) => csv.replace('﻿', '').trim().split('\r\n');

    expect(lines(profitLossCsv(moreReports.profitAndLoss(db, wide)))).toContain('Net profit,1150.00');
    const margin = lines(marginCsv(moreReports.marginReport(db, wide, 'customer')));
    expect(margin[2]).toBe('Customer,Pieces,Invoices,Sales (excl. GST),Cost,Profit,Margin %');
    expect(margin[3]).toBe('"Anita, Devi",2,1,2000.00,800.00,1200.00,60.0');
    expect(lines(movementCsv(moreReports.stockMovementReport(db, wide)))[2]).toBe('Design,Opening,Added,Returned,Sold,Damaged,Adjusted,Closing');
    expect(lines(moversCsv(moreReports.moversReport(db, 90)))[3]).toContain('Butidar,Fast mover,2,98');
    const book = lines(dayBookCsv(moreReports.dayBook(db, wide, 'cash')));
    expect(book[0]).toBe(`Cash book,${wide.from} to ${wide.to}`);
    expect(book.at(-1)).toBe(',,,,,0.00,100.00,50.00,50.00'.replace(/^,/, 'Totals,'));
    const aged = lines(receivablesCsv(receivables.duesReport(db)));
    expect(aged[2]).toContain('Customer,Open invoices');
    expect(aged[3]).toContain('"Anita, Devi"');
  });
});
