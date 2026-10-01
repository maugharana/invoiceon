import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import * as customers from '../electron/services/customers';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import { loadSampleData } from '../electron/services/seed';
import { getSettings, saveSettings } from '../electron/services/settings';
import { addDays, computeTotals, financialYear, formatInvoiceNumber, invoiceStatus, isValidGstin, rupeesInWords, todayIso } from '../shared/gst';
import type { CustomerInput, InvoiceInput } from '../shared/types';
import { isValidUpiId, upiPayLink } from '../shared/upi';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});

const rupees = (n: number) => n * 100;
const today = todayIso();

// A design with one variant: 10 in stock, ₹1,000 each.
function stocked(stock = 10, price = 1000) {
  const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: 'Silk', hsnCode: '5007', description: '', defaultPricePaise: rupees(price) });
  const v = inventory.createVariant(db, d.id, { color: 'Maroon', size: '6.3 m', sellPricePaise: rupees(price), baseCostPaise: rupees(400), reorderLevel: 2, openingStock: stock, bom: [] });
  return { d, v };
}

const customer = (over: Partial<CustomerInput> = {}) =>
  customers.createCustomer(db, { name: 'Sunita', type: 'B2C', phone: '', email: '', gstin: '', address: '', city: 'Mau', state: 'Uttar Pradesh', pincode: '', notes: '', ...over });

const b2b = (over: Partial<CustomerInput> = {}) =>
  customer({ name: 'Kanchan Sarees', type: 'B2B', gstin: '09AAACH7409R1ZZ', state: 'Uttar Pradesh', ...over });

function invoiceFor(variantId: string, over: Partial<InvoiceInput> = {}, qty = 1, price = 1000): InvoiceInput {
  return { type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId, qty, unitPricePaise: rupees(price) }], ...over };
}

describe('GST maths', () => {
  it('splits tax into CGST + SGST within a state and charges IGST across states', () => {
    const local = computeTotals({ lineAmounts: [rupees(1000)], discountPaise: 0, ratePercent: 5, intraState: true });
    expect(local).toMatchObject({ taxablePaise: 100000, cgstPaise: 2500, sgstPaise: 2500, igstPaise: 0, roundOffPaise: 0, totalPaise: 105000 });
    const inter = computeTotals({ lineAmounts: [rupees(1000)], discountPaise: 0, ratePercent: 5, intraState: false });
    expect(inter).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: 5000, totalPaise: 105000 });
  });

  it('applies discount before tax and rounds the total to a whole rupee', () => {
    const t = computeTotals({ lineAmounts: [12345, 6789], discountPaise: 1001, ratePercent: 5, intraState: true });
    // subtotal 19134, taxable 18133, tax 906.65 â†’ 907, raw 19040 â†’ 190.40 rounds to 190.00
    expect(t.subtotalPaise).toBe(19134);
    expect(t.taxablePaise).toBe(18133);
    expect(t.taxPaise).toBe(907);
    expect(t.cgstPaise + t.sgstPaise).toBe(907);
    expect(t.cgstPaise).toBe(453); // the odd paisa goes to SGST
    expect(t.totalPaise % 100).toBe(0);
    expect(t.totalPaise - t.roundOffPaise).toBe(t.taxablePaise + t.taxPaise);
  });

  it('carves GST out of a GST-inclusive price instead of adding it on top', () => {
    const t = computeTotals({ lineAmounts: [rupees(1000)], discountPaise: 0, ratePercent: 5, intraState: true, inclusive: true });
    // 1000 / 1.05 = 952.38 taxable + 47.62 GST = 1000 — the customer pays exactly the price.
    expect(t).toMatchObject({ taxablePaise: 95238, taxPaise: 4762, cgstPaise: 2381, sgstPaise: 2381, totalPaise: rupees(1000), roundOffPaise: 0 });
    expect(computeTotals({ lineAmounts: [rupees(1000)], discountPaise: 0, ratePercent: 5, intraState: false, inclusive: true })).toMatchObject({ igstPaise: 4762, totalPaise: rupees(1000) });
    // a discount comes off the inclusive price before the tax is worked out
    expect(computeTotals({ lineAmounts: [rupees(1000)], discountPaise: rupees(100), ratePercent: 5, intraState: true, inclusive: true })).toMatchObject({ taxablePaise: 85714, taxPaise: 4286, totalPaise: rupees(900) });
  });

  it('caps a discount at the subtotal', () => {
    expect(computeTotals({ lineAmounts: [5000], discountPaise: 99999, ratePercent: 5, intraState: true }).totalPaise).toBe(0);
  });
});

describe('GSTIN', () => {
  it('accepts real ones and rejects typos', () => {
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGstin('27aapfu0939f1zv')).toBe(true);
    expect(isValidGstin('27AAPFU0939F1ZX')).toBe(false); // wrong check character
    expect(isValidGstin('27AAPFU0939F1Z')).toBe(false);
    expect(isValidGstin('')).toBe(false);
  });
});

describe('financial year, numbering, words, status', () => {
  it('runs April to March', () => {
    expect(financialYear('2026-03-31')).toBe('2025-26');
    expect(financialYear('2026-04-01')).toBe('2026-27');
    expect(financialYear('2026-12-31')).toBe('2026-27');
    expect(financialYear('2099-06-01')).toBe('2099-00');
    expect(formatInvoiceNumber('MG', '2026-27', 7)).toBe('MG/2026-27/0007');
  });
  it('writes amounts in Indian words', () => {
    expect(rupeesInWords(0)).toBe('Rupees Zero Only');
    expect(rupeesInWords(rupees(1050))).toBe('Rupees One Thousand Fifty Only');
    expect(rupeesInWords(rupees(1234567))).toBe('Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Only');
    expect(rupeesInWords(rupees(20000000))).toBe('Rupees Two Crore Only');
    expect(rupeesInWords(12550)).toBe('Rupees One Hundred Twenty Five and Fifty Paise Only');
  });
  it('derives status from payment and due date', () => {
    const base = { cancelled: false, totalPaise: 1000, paidPaise: 0, dueDate: '2026-10-10', today: '2026-10-01' };
    expect(invoiceStatus(base)).toBe('unpaid');
    expect(invoiceStatus({ ...base, paidPaise: 400 })).toBe('partial');
    expect(invoiceStatus({ ...base, paidPaise: 1000 })).toBe('paid');
    expect(invoiceStatus({ ...base, today: '2026-10-11' })).toBe('overdue');
    expect(invoiceStatus({ ...base, today: '2026-10-11', paidPaise: 1000 })).toBe('paid');
    expect(invoiceStatus({ ...base, cancelled: true })).toBe('cancelled');
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02');
  });
});

describe('customers', () => {
  it('validates GSTIN, fills state from it, and enforces B2B needing one', () => {
    const c = customer({ name: 'M', type: 'B2B', gstin: '27aapfu0939f1zv', state: '' });
    expect(c.gstin).toBe('27AAPFU0939F1ZV');
    expect(c.state).toBe('Maharashtra');
    expect(() => customer({ type: 'B2B', gstin: '' })).toThrow(/needs a GSTIN/);
    expect(() => customer({ gstin: '27AAPFU0939F1ZX' })).toThrow(/doesn't look right/);
    expect(() => customer({ type: 'B2B', gstin: '27AAPFU0939F1ZV', state: 'Kerala' })).toThrow(/registered in Maharashtra/);
    expect(() => customer({ name: ' ' })).toThrow(/required/);
    expect(() => customer({ pincode: '12' })).toThrow(/6 digits/);
  });
  it('searches by name, phone and city', () => {
    customer({ name: 'Sunita', phone: '98765', city: 'Mau' });
    customer({ name: 'Rekha', phone: '11111', city: 'Agra' });
    expect(customers.listCustomers(db, { search: 'agra' }).map((c) => c.name)).toEqual(['Rekha']);
    expect(customers.listCustomers(db, { search: '9876' }).map((c) => c.name)).toEqual(['Sunita']);
  });
});

describe('issuing invoices', () => {
  it('issues a B2C walk-in invoice, takes stock out through the ledger, and numbers it', () => {
    const { v } = stocked();
    const inv = invoices.createInvoice(db, invoiceFor(v.id, {}, 2));
    expect(inv.number).toBe(formatInvoiceNumber('MG', financialYear(today), 1));
    expect(inv).toMatchObject({ type: 'B2C', buyerName: 'Walk-in customer', subtotalPaise: rupees(2000), taxablePaise: rupees(2000), cgstPaise: 5000, sgstPaise: 5000, totalPaise: rupees(2100), intraState: true, status: 'unpaid' }); // due today is not yet overdue
    expect(inv.lines[0]).toMatchObject({ designName: 'Butidar', color: 'Maroon', hsn: '5007', qty: 2, amountPaise: rupees(2000) });

    expect(inventory.getVariant(db, v.id).stock).toBe(8);
    const [move] = inventory.listMovements(db, v.id);
    expect(move).toMatchObject({ reason: 'sale', delta: -2, balanceAfter: 8, note: `Invoice ${inv.number}` });
  });

  it('numbers consecutively within a financial year and restarts in the next', () => {
    const { v } = stocked(20);
    const a = invoices.createInvoice(db, invoiceFor(v.id, { issueDate: '2026-04-01', dueDate: null }));
    const b = invoices.createInvoice(db, invoiceFor(v.id, { issueDate: '2026-09-01', dueDate: null }));
    const c = invoices.createInvoice(db, invoiceFor(v.id, { issueDate: '2027-04-02', dueDate: null }));
    expect([a.number, b.number, c.number]).toEqual(['MG/2026-27/0001', 'MG/2026-27/0002', 'MG/2027-28/0001']);
    expect(invoices.nextInvoiceNumber(db, '2026-05-05')).toBe('MG/2026-27/0003');
  });

  it('uses IGST for a buyer in another state and CGST+SGST for the same state', () => {
    saveSettings(db, { gstin: '09AABCK1234M1ZI' });
    const { v } = stocked();
    const local = invoices.createInvoice(db, invoiceFor(v.id, { type: 'B2B', customerId: b2b().id }));
    const far = invoices.createInvoice(db, invoiceFor(v.id, { type: 'B2B', customerId: b2b({ name: 'Meera', gstin: '27AAPFU0939F1ZV', state: 'Maharashtra' }).id }));
    expect(local).toMatchObject({ intraState: true, cgstPaise: 2500, sgstPaise: 2500, igstPaise: 0, placeOfSupply: 'Uttar Pradesh' });
    expect(far).toMatchObject({ intraState: false, cgstPaise: 0, sgstPaise: 0, igstPaise: 5000, placeOfSupply: 'Maharashtra' });
  });

  it('refuses B2B without seller GSTIN, without customer, or to a customer with no GSTIN', () => {
    const { v } = stocked();
    const c = b2b();
    expect(() => invoices.createInvoice(db, invoiceFor(v.id, { type: 'B2B', customerId: c.id }))).toThrow(/your own GSTIN in Settings/);
    saveSettings(db, { gstin: '09AABCK1234M1ZI' });
    expect(() => invoices.createInvoice(db, invoiceFor(v.id, { type: 'B2B', customerId: null }))).toThrow(/Choose the customer/);
    expect(() => invoices.createInvoice(db, invoiceFor(v.id, { type: 'B2B', customerId: customer().id }))).toThrow(/has no GSTIN/);
    expect(inventory.getVariant(db, v.id).stock).toBe(10);
  });

  it('refuses a B2B invoice to a customer carrying the business\'s own GSTIN', () => {
    saveSettings(db, { gstin: '09AAACH7409R1ZZ' });
    const { v } = stocked();
    expect(() => invoices.createInvoice(db, invoiceFor(v.id, { type: 'B2B', customerId: b2b().id }))).toThrow(/same GSTIN as your business/);
  });

  it('applies the invoice discount before GST', () => {
    const { v } = stocked();
    const inv = invoices.createInvoice(db, invoiceFor(v.id, { discountPaise: rupees(100) }, 2));
    expect(inv).toMatchObject({ subtotalPaise: rupees(2000), discountPaise: rupees(100), taxablePaise: rupees(1900), totalPaise: rupees(1995) });
    expect(() => invoices.createInvoice(db, invoiceFor(v.id, { discountPaise: rupees(5000) }, 2))).toThrow(/discount can't be more/);
  });

  it('bills a GST-inclusive price at that price, and keeps the choice frozen on the invoice', () => {
    const { v } = stocked();
    const before = invoices.createInvoice(db, invoiceFor(v.id, {}, 1)); // exclusive: 1,000 + 50
    saveSettings(db, { pricesIncludeGst: true });
    const inv = invoices.createInvoice(db, invoiceFor(v.id, {}, 1));
    expect(inv).toMatchObject({ pricesIncludeGst: true, subtotalPaise: rupees(1000), taxablePaise: 95238, cgstPaise: 2381, sgstPaise: 2381, totalPaise: rupees(1000) });
    expect(inv.lines[0]).toMatchObject({ unitPricePaise: rupees(1000), amountPaise: rupees(1000) });
    // switching the setting later never rewrites an invoice already issued
    saveSettings(db, { pricesIncludeGst: false });
    expect(invoices.getInvoice(db, inv.id)).toMatchObject({ pricesIncludeGst: true, totalPaise: rupees(1000) });
    expect(invoices.getInvoice(db, before.id)).toMatchObject({ pricesIncludeGst: false, totalPaise: rupees(1050) });
  });

  it('rolls the whole invoice back when any line is short of stock', () => {
    const { d, v } = stocked(5);
    const other = inventory.createVariant(db, d.id, { color: 'Wine', size: '6.3 m', sellPricePaise: 100000, baseCostPaise: 0, reorderLevel: 0, openingStock: 1, bom: [] });
    const input = invoiceFor(v.id, {}, 2);
    input.lines.push({ variantId: other.id, qty: 3, unitPricePaise: 100000 });
    expect(() => invoices.createInvoice(db, input)).toThrow(/Not enough stock/);
    expect(inventory.getVariant(db, v.id).stock).toBe(5); // the first line's deduction was undone
    expect(invoices.listInvoices(db)).toHaveLength(0);
    expect(invoices.nextInvoiceNumber(db, today)).toBe(formatInvoiceNumber('MG', financialYear(today), 1)); // and the number wasn't burned
  });

  it('validates inputs', () => {
    const { v } = stocked();
    expect(() => invoices.createInvoice(db, { ...invoiceFor(v.id), lines: [] })).toThrow(/at least one item/);
    expect(() => invoices.createInvoice(db, invoiceFor(v.id, {}, 0))).toThrow(/at least 1|less than 1/);
    expect(() => invoices.createInvoice(db, invoiceFor(v.id, { issueDate: 'yesterday' }))).toThrow(/valid invoice date/);
    expect(() => invoices.createInvoice(db, invoiceFor(v.id, { dueDate: '2000-01-01' }))).toThrow(/before the invoice date/);
    const dup = invoiceFor(v.id);
    dup.lines.push({ ...dup.lines[0]! });
    expect(() => invoices.createInvoice(db, dup)).toThrow(/twice/);
    expect(() => invoices.createInvoice(db, invoiceFor('ghost'))).toThrow(/no longer exists/);
  });

  it('freezes seller, buyer, prices and descriptions on the invoice', () => {
    saveSettings(db, { gstin: '09AABCK1234M1ZI', businessName: 'Mau Gharana' });
    const { d, v } = stocked();
    const c = b2b();
    const inv = invoices.createInvoice(db, invoiceFor(v.id, { type: 'B2B', customerId: c.id }));

    customers.updateCustomer(db, c.id, { ...c, name: 'Renamed Ltd' });
    inventory.updateDesign(db, d.id, { code: 'MG-001', name: 'Something else', fabric: '', hsnCode: '9999', description: '', defaultPricePaise: 1 });
    saveSettings(db, { businessName: 'New Name' });

    const again = invoices.getInvoice(db, inv.id);
    expect(again.buyer.name).toBe('Kanchan Sarees');
    expect(again.seller.name).toBe('Mau Gharana');
    expect(again.lines[0]).toMatchObject({ designName: 'Butidar', hsn: '5007' });
  });

  it('carries the sale cost on each line for later profit reports', () => {
    const { v } = stocked();
    invoices.createInvoice(db, invoiceFor(v.id));
    const row = db.prepare('SELECT unit_cost_paise AS c FROM invoice_lines').get() as { c: number };
    expect(row.c).toBe(rupees(400));
  });
});

describe('cancelling', () => {
  it('puts the stock back, keeps the number, and can only happen once', () => {
    const { v } = stocked();
    const inv = invoices.createInvoice(db, invoiceFor(v.id, {}, 3));
    expect(inventory.getVariant(db, v.id).stock).toBe(7);

    const cancelled = invoices.cancelInvoice(db, inv.id, 'Customer changed mind');
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'Customer changed mind' });
    expect(inventory.getVariant(db, v.id).stock).toBe(10);
    expect(inventory.listMovements(db, v.id)[0]).toMatchObject({ reason: 'return', delta: 3 });
    expect(() => invoices.cancelInvoice(db, inv.id, '')).toThrow(/already cancelled/);

    // The number is never reused.
    expect(invoices.createInvoice(db, invoiceFor(v.id)).number).toBe(formatInvoiceNumber('MG', financialYear(today), 2));
  });

  it('skips restocking a variant that has since been archived', () => {
    const { v } = stocked();
    const inv = invoices.createInvoice(db, invoiceFor(v.id));
    inventory.archiveVariant(db, v.id);
    expect(invoices.cancelInvoice(db, inv.id, '').status).toBe('cancelled');
  });
});

describe('lists, customer stats, dashboard', () => {
  it('filters and searches invoices', () => {
    saveSettings(db, { gstin: '09AABCK1234M1ZI' });
    const { v } = stocked(50);
    const c = b2b();
    const a = invoices.createInvoice(db, invoiceFor(v.id, { type: 'B2B', customerId: c.id, dueDate: addDays(today, 10) }));
    const past = invoices.createInvoice(db, invoiceFor(v.id, { issueDate: addDays(today, -40), dueDate: addDays(today, -10) }));
    const gone = invoices.createInvoice(db, invoiceFor(v.id));
    invoices.cancelInvoice(db, gone.id, '');

    expect(invoices.listInvoices(db).map((i) => i.id)).toContain(a.id);
    expect(invoices.listInvoices(db, { type: 'B2B' }).map((i) => i.id)).toEqual([a.id]);
    expect(invoices.listInvoices(db, { status: 'overdue' }).map((i) => i.id)).toEqual([past.id]);
    expect(invoices.listInvoices(db, { status: 'cancelled' }).map((i) => i.id)).toEqual([gone.id]);
    expect(invoices.listInvoices(db, { status: 'open' }).map((i) => i.id).sort()).toEqual([a.id, past.id].sort());
    expect(invoices.listInvoices(db, { search: 'kanchan' }).map((i) => i.id)).toEqual([a.id]);
    expect(invoices.listInvoices(db, { customerId: c.id })).toHaveLength(1);
  });

  it('filters invoices by date, inclusive at both ends, and refuses a bad date', () => {
    const { v } = stocked(50);
    const old = invoices.createInvoice(db, invoiceFor(v.id, { issueDate: addDays(today, -40), dueDate: addDays(today, -40) }));
    const mid = invoices.createInvoice(db, invoiceFor(v.id, { issueDate: addDays(today, -10), dueDate: addDays(today, -10) }));
    const recent = invoices.createInvoice(db, invoiceFor(v.id));
    const ids = (q: Parameters<typeof invoices.listInvoices>[1]) => invoices.listInvoices(db, q).map((i) => i.id).sort();
    expect(ids({ from: addDays(today, -10) })).toEqual([mid.id, recent.id].sort());
    expect(ids({ to: addDays(today, -10) })).toEqual([old.id, mid.id].sort());
    expect(ids({ from: addDays(today, -10), to: addDays(today, -10) })).toEqual([mid.id]);
    expect(ids({ from: addDays(today, 1) })).toEqual([]);
    expect(ids({ from: '', to: '' })).toHaveLength(3); // blank means no limit
    expect(() => invoices.listInvoices(db, { from: '10-09-2026' })).toThrow(/valid "from" date/);
    expect(() => invoices.listInvoices(db, { to: 'soon' })).toThrow(/valid "to" date/);
  });

  it('counts a customer\'s issued invoices and what they have been billed, excluding cancelled ones', () => {
    saveSettings(db, { gstin: '09AABCK1234M1ZI' });
    const { v } = stocked(50);
    const c = b2b();
    invoices.createInvoice(db, invoiceFor(v.id, { type: 'B2B', customerId: c.id }));
    const second = invoices.createInvoice(db, invoiceFor(v.id, { type: 'B2B', customerId: c.id }, 2));
    invoices.cancelInvoice(db, second.id, '');
    expect(customers.getCustomer(db, c.id)).toMatchObject({ invoiceCount: 1, billedPaise: rupees(1050) });
  });

  it('summarises the dashboard', () => {
    const { v } = stocked(50);
    invoices.createInvoice(db, invoiceFor(v.id, { dueDate: addDays(today, 10) }));
    invoices.createInvoice(db, invoiceFor(v.id, { issueDate: addDays(today, -40), dueDate: addDays(today, -10) }, 2));
    const cancelled = invoices.createInvoice(db, invoiceFor(v.id, {}, 5));
    invoices.cancelInvoice(db, cancelled.id, '');

    const s = invoices.dashboardSummary(db);
    expect(s.outstandingPaise).toBe(rupees(1050) + rupees(2100));
    expect(s.openInvoices).toBe(2);
    expect(s.overdueCount).toBe(1);
    expect(s.overduePaise).toBe(rupees(2100));
    expect(s.recent).toHaveLength(3);
    // "This month" only counts invoices dated this month (the 40-day-old one is usually last month or earlier).
    const thisMonth = [0, -40].filter((d) => addDays(today, d).startsWith(today.slice(0, 7))).length;
    expect(s.monthInvoices).toBe(thisMonth);
  });
});

describe('sample data & api', () => {
  it('loads customers along with the designs', () => {
    loadSampleData(db);
    const list = customers.listCustomers(db);
    expect(list.map((c) => c.name)).toEqual(['Anjali Gupta', 'Kanchan Sarees & Fabrics', 'Meera Textiles', 'Sunita Verma']);
    expect(list.map((c) => c.type)).toEqual(['B2C', 'B2B', 'B2B', 'B2C']);
    expect(list.every((c) => c.type === 'B2C' || isValidGstin(c.gstin))).toBe(true);
    expect(invoices.variantsForSale(db)).toHaveLength(14);
  });

  it('PDF and print explain themselves outside the desktop app, and call the host inside it', async () => {
    const { v } = stocked();
    const inv = invoices.createInvoice(db, invoiceFor(v.id));
    await expect(createApi(db).invoiceExportPdf(inv.id)).rejects.toThrow(/desktop app only/);
    await expect(createApi(db).invoicePrint(inv.id)).rejects.toThrow(/desktop app only/);

    const calls: string[] = [];
    const api = createApi(db, {
      exportDocumentPdf: async (route, name) => (calls.push(`${route}|${name}`), { saved: true, path: 'x' }),
      printDocument: async (route) => void calls.push(`print|${route}`),
      saveTextFile: async () => ({ saved: false }),
    });
    expect(await api.invoiceExportPdf(inv.id)).toEqual({ saved: true, path: 'x' });
    await api.invoicePrint(inv.id);
    expect(calls[0]).toBe(`/print/invoice/${inv.id}|Invoice ${inv.number.replaceAll('/', '-')}.pdf`);
    expect(calls[1]).toBe(`print|/print/invoice/${inv.id}`);
  });

  it('settings validate the profile', () => {
    expect(saveSettings(db, { gstin: '09aaach7409r1zz', state: 'Uttar Pradesh', invoicePrefix: 'mg' })).toMatchObject({ gstin: '09AAACH7409R1ZZ', invoicePrefix: 'MG' });
    expect(() => saveSettings(db, { gstin: '09AAACH7409R1ZX' })).toThrow(/doesn't look right/);
    expect(() => saveSettings(db, { state: 'Atlantis' })).toThrow(/from the list/);
    expect(() => saveSettings(db, { invoicePrefix: 'a/b' })).toThrow(/letters, numbers/);
    expect(getSettings(db).defaultDueDays).toBe(15);
  });
});

describe('UPI payment link and QR setting', () => {
  it('recognises UPI IDs', () => {
    for (const ok of ['maugharana@sbi', 'shop.name-1@okhdfcbank', '9876543210@ybl']) expect(isValidUpiId(ok)).toBe(true);
    for (const bad of ['', 'nope', '@sbi', 'a@', 'a b@sbi', 'name@1bank', 'name@@sbi']) expect(isValidUpiId(bad)).toBe(false);
  });

  it('builds the link a UPI app opens, with the amount in rupees and the text escaped', () => {
    expect(upiPayLink({ upiId: 'maugharana@sbi', payeeName: 'Mau Gharana', amountPaise: 105050, note: 'MG/2026-27/0004' })).toBe('upi://pay?pa=maugharana%40sbi&pn=Mau%20Gharana&am=1050.50&cu=INR&tn=MG%2F2026-27%2F0004');
    expect(upiPayLink({ upiId: 'a@b', payeeName: 'X & Y', amountPaise: 0, note: '' })).toBe('upi://pay?pa=a%40b&pn=X%20%26%20Y&cu=INR'); // no amount: the customer types it
  });

  it('saves a UPI ID tidied of spaces, refuses a malformed one, and can be cleared', () => {
    expect(saveSettings(db, { upiId: ' maugharana @sbi ' }).upiId).toBe('maugharana@sbi');
    expect(() => saveSettings(db, { upiId: 'not a upi id' })).toThrow(/UPI ID/);
    expect(saveSettings(db, { upiId: '' }).upiId).toBe('');
    expect(getSettings(db).invoiceShowUpiQr).toBe(true); // on by default
    expect(saveSettings(db, { invoiceShowUpiQr: false }).invoiceShowUpiQr).toBe(false);
  });

  it('freezes the UPI ID on each invoice, while whether to print the QR follows the current setting', () => {
    const { v } = stocked(10);
    saveSettings(db, { upiId: 'old@sbi' });
    const inv = invoices.createInvoice(db, invoiceFor(v.id));
    saveSettings(db, { upiId: 'new@sbi', invoiceShowUpiQr: false });
    const again = invoices.getInvoice(db, inv.id);
    expect(again.seller.upiId).toBe('old@sbi');
    expect(again.branding.showUpiQr).toBe(false);
    expect(invoices.createInvoice(db, invoiceFor(v.id)).seller.upiId).toBe('new@sbi');
  });
});
