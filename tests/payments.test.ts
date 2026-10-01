import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { LATEST_SCHEMA_VERSION } from '../electron/db/migrations';
import { openDb, type Db } from '../electron/db/connection';
import * as customers from '../electron/services/customers';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as materials from '../electron/services/materials';
import * as payments from '../electron/services/payments';
import * as receivables from '../electron/services/receivables';
import * as reports from '../electron/services/reports';
import { loadSampleData } from '../electron/services/seed';
import { getSettings, saveSettings } from '../electron/services/settings';
import { addDays, todayIso } from '../shared/gst';
import type { InvoiceInput, PaymentInput } from '../shared/types';

let db: Db;
let variantId: string;
const rupees = (n: number) => n * 100;
const today = todayIso();

beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { gstin: '09AABCK1234M1ZI' });
  const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: '', hsnCode: '5007', description: '', defaultPricePaise: rupees(1000) });
  variantId = inventory.createVariant(db, d.id, { color: 'Maroon', size: '6.3 m', sellPricePaise: rupees(1000), baseCostPaise: rupees(400), reorderLevel: 0, openingStock: 500, bom: [] }).id;
});

const customer = (name = 'Sunita') => customers.createCustomer(db, { name, type: 'B2C', phone: '', email: '', gstin: '', address: '', city: 'Mau', state: 'Uttar Pradesh', pincode: '', notes: '' });

/** An invoice for `qty` × ₹1,000 + 5% GST → total ₹1,050 × qty. */
function invoice(customerId: string | null, qty = 1, over: Partial<InvoiceInput> = {}) {
  return invoices.createInvoice(db, { type: 'B2C', customerId, issueDate: today, dueDate: addDays(today, 10), discountPaise: 0, notes: '', lines: [{ variantId, qty, unitPricePaise: rupees(1000) }], ...over });
}

const pay = (customerId: string | null, amount: number, allocations: PaymentInput['allocations'] = [], over: Partial<PaymentInput> = {}) =>
  payments.recordPayment(db, { customerId, amountPaise: rupees(amount), method: 'upi', reference: '', receivedOn: today, note: '', allocations, ...over });

const state = (id: string) => invoices.getInvoice(db, id);

describe('recording a payment against invoices', () => {
  it('part-pays an invoice and shows what is left', () => {
    const c = customer();
    const inv = invoice(c.id); // ₹1,050
    const p = pay(c.id, 400, [{ invoiceId: inv.id, amountPaise: rupees(400) }]);
    expect(p).toMatchObject({ appliedPaise: rupees(400), advancePaise: 0, customerName: 'Sunita' });
    expect(state(inv.id)).toMatchObject({ paidPaise: rupees(400), status: 'partial' });
    expect(state(inv.id).payments).toHaveLength(1);
  });

  it('settles an invoice in full across several payments', () => {
    const c = customer();
    const inv = invoice(c.id);
    pay(c.id, 400, [{ invoiceId: inv.id, amountPaise: rupees(400) }]);
    pay(c.id, 650, [{ invoiceId: inv.id, amountPaise: rupees(650) }]);
    expect(state(inv.id)).toMatchObject({ paidPaise: rupees(1050), status: 'paid' });
  });

  it('splits one payment across two invoices', () => {
    const c = customer();
    const a = invoice(c.id);
    const b = invoice(c.id);
    const p = pay(c.id, 1500, [{ invoiceId: a.id, amountPaise: rupees(1050) }, { invoiceId: b.id, amountPaise: rupees(450) }]);
    expect(p.allocations.map((x) => x.amountPaise)).toEqual([rupees(1050), rupees(450)]);
    expect(state(a.id).status).toBe('paid');
    expect(state(b.id)).toMatchObject({ paidPaise: rupees(450), status: 'partial' });
  });

  it('never lets an invoice be paid more than it is owed', () => {
    const c = customer();
    const inv = invoice(c.id);
    pay(c.id, 1000, [{ invoiceId: inv.id, amountPaise: rupees(1000) }]);
    expect(() => pay(c.id, 100, [{ invoiceId: inv.id, amountPaise: rupees(100) }])).toThrow(/only has ₹50\.00 left/);
    expect(state(inv.id).paidPaise).toBe(rupees(1000)); // the failed attempt left nothing behind
    expect(payments.listPayments(db)).toHaveLength(1);
  });

  it('rejects allocations larger than the payment, duplicates, other customers\' invoices and cancelled invoices', () => {
    const a = customer('A');
    const b = customer('B');
    const inv = invoice(a.id);
    expect(() => pay(a.id, 100, [{ invoiceId: inv.id, amountPaise: rupees(200) }])).toThrow(/More is applied/);
    expect(() => pay(a.id, 500, [{ invoiceId: inv.id, amountPaise: rupees(100) }, { invoiceId: inv.id, amountPaise: rupees(100) }])).toThrow(/twice/);
    expect(() => pay(b.id, 100, [{ invoiceId: inv.id, amountPaise: rupees(100) }])).toThrow(/different customer/);
    invoices.cancelInvoice(db, inv.id, '');
    expect(() => pay(a.id, 100, [{ invoiceId: inv.id, amountPaise: rupees(100) }])).toThrow(/cancelled/);
  });

  it('validates amount, method and date', () => {
    const c = customer();
    expect(() => pay(c.id, 0)).toThrow(/at least 1|less than 1/);
    expect(() => pay(c.id, 10, [], { method: 'barter' as never })).toThrow(/how the payment was made/);
    expect(() => pay(c.id, 10, [], { receivedOn: addDays(today, 3) })).toThrow(/future/);
    expect(() => pay(c.id, 10, [], { receivedOn: 'soon' })).toThrow(/valid payment date/);
  });
});

describe('advance', () => {
  it('holds an unallocated payment as the customer\'s advance', () => {
    const c = customer();
    const p = pay(c.id, 2000);
    expect(p).toMatchObject({ appliedPaise: 0, advancePaise: rupees(2000) });
    expect(customers.getCustomer(db, c.id)).toMatchObject({ advancePaise: rupees(2000), outstandingPaise: 0 });
  });

  it('holds the overpaid remainder as advance', () => {
    const c = customer();
    const inv = invoice(c.id);
    const p = pay(c.id, 2000, [{ invoiceId: inv.id, amountPaise: rupees(1050) }]);
    expect(p).toMatchObject({ appliedPaise: rupees(1050), advancePaise: rupees(950) });
    expect(customers.getCustomer(db, c.id)).toMatchObject({ advancePaise: rupees(950), outstandingPaise: 0 });
  });

  it('cannot hold advance for a walk-in — the payment must go fully onto an invoice', () => {
    const inv = invoice(null);
    expect(() => pay(null, 500)).toThrow(/must be applied in full/);
    expect(() => pay(null, 2000, [{ invoiceId: inv.id, amountPaise: rupees(1050) }])).toThrow(/must be applied in full/);
    expect(pay(null, 1050, [{ invoiceId: inv.id, amountPaise: rupees(1050) }]).customerName).toBe('Walk-in customer');
  });

  it('is applied automatically, oldest first, when the next invoice is issued', () => {
    const c = customer();
    pay(c.id, 300, [], { receivedOn: addDays(today, -2) });
    pay(c.id, 500);
    const inv = invoice(c.id, 1, { applyAdvancePaise: rupees(800) });
    expect(state(inv.id)).toMatchObject({ paidPaise: rupees(800), status: 'partial' });
    expect(customers.getCustomer(db, c.id)).toMatchObject({ advancePaise: 0, outstandingPaise: rupees(250) });
    expect(payments.listPayments(db).every((p) => p.advancePaise === 0)).toBe(true);
  });

  it('treats the advance to apply as a ceiling — asking for more than the invoice needs just takes what it needs', () => {
    const c = customer();
    pay(c.id, 5000);
    const inv = invoice(c.id, 1, { applyAdvancePaise: rupees(4000) });
    expect(state(inv.id).status).toBe('paid');
    expect(customers.getCustomer(db, c.id).advancePaise).toBe(rupees(3950));
  });

  it('applies only part of an advance when the invoice is smaller, leaving the rest held', () => {
    const c = customer();
    pay(c.id, 5000);
    const inv = invoice(c.id, 1, { applyAdvancePaise: rupees(1050) });
    expect(state(inv.id).status).toBe('paid');
    expect(customers.getCustomer(db, c.id).advancePaise).toBe(rupees(3950));
  });

  it('refuses to apply more advance than the customer holds, and rolls the invoice back', () => {
    const c = customer();
    pay(c.id, 200);
    expect(() => invoice(c.id, 1, { applyAdvancePaise: rupees(500) })).toThrow(/Only ₹200\.00 of advance/);
    expect(invoices.listInvoices(db)).toHaveLength(0);
    expect(inventory.getVariant(db, variantId).stock).toBe(500); // stock wasn't taken either
    expect(customers.getCustomer(db, c.id).advancePaise).toBe(rupees(200));
  });

  it('can be applied to an already-open invoice afterwards', () => {
    const c = customer();
    const inv = invoice(c.id);
    pay(c.id, 400);
    expect(customers.getCustomer(db, c.id)).toMatchObject({ advancePaise: rupees(400), outstandingPaise: rupees(1050) });
    const after = invoices.applyAdvanceToInvoice(db, inv.id);
    expect(after).toMatchObject({ paidPaise: rupees(400), status: 'partial' });
    expect(() => invoices.applyAdvanceToInvoice(db, inv.id)).toThrow(/no advance/);
  });
});

describe('paying while issuing the invoice (one step)', () => {
  it('records the payment and the invoice together', () => {
    const c = customer();
    const inv = invoice(c.id, 2, { payment: { amountPaise: rupees(500), method: 'cash', reference: '' } }); // total ₹2,100
    expect(inv).toMatchObject({ paidPaise: rupees(500), status: 'partial' });
    expect(inv.payments[0]).toMatchObject({ method: 'cash', amountPaise: rupees(500) });
    expect(payments.listPayments(db)[0]).toMatchObject({ note: `With invoice ${inv.number}`, customerName: 'Sunita' });
  });

  it('marks a walk-in sale paid in full', () => {
    const inv = invoice(null, 1, { payment: { amountPaise: rupees(1050), method: 'upi', reference: 'UTR123' } });
    expect(inv.status).toBe('paid');
    expect(payments.listPayments(db)[0]).toMatchObject({ customerId: null, reference: 'UTR123' });
  });

  it('combines advance and money handed over now', () => {
    const c = customer();
    pay(c.id, 1000);
    const inv = invoice(c.id, 1, { applyAdvancePaise: rupees(1000), payment: { amountPaise: rupees(50), method: 'cash', reference: '' } });
    expect(inv.status).toBe('paid');
  });

  it('refuses a payment above what is due and leaves nothing behind (no invoice, no stock out, no payment)', () => {
    const c = customer();
    expect(() => invoice(c.id, 1, { payment: { amountPaise: rupees(2000), method: 'cash', reference: '' } })).toThrow(/more than the ₹1,050\.00 due/);
    expect(invoices.listInvoices(db)).toHaveLength(0);
    expect(payments.listPayments(db)).toHaveLength(0);
    expect(inventory.getVariant(db, variantId).stock).toBe(500);
  });

  it('cannot apply advance to a walk-in invoice', () => {
    expect(() => invoice(null, 1, { applyAdvancePaise: rupees(100) })).toThrow(/saved customer/);
  });
});

describe('status and overdue', () => {
  it('turns overdue once past the due date, and paid clears it', () => {
    const c = customer();
    const late = invoice(c.id, 1, { issueDate: addDays(today, -30), dueDate: addDays(today, -5) });
    expect(late.status).toBe('overdue');
    pay(c.id, 100, [{ invoiceId: late.id, amountPaise: rupees(100) }]);
    expect(state(late.id).status).toBe('overdue'); // part-paid but still late
    pay(c.id, 950, [{ invoiceId: late.id, amountPaise: rupees(950) }]);
    expect(state(late.id).status).toBe('paid');
  });
});

describe('voiding a payment', () => {
  it('makes the invoice due again and is idempotent-safe', () => {
    const c = customer();
    const inv = invoice(c.id);
    const p = pay(c.id, 1050, [{ invoiceId: inv.id, amountPaise: rupees(1050) }]);
    expect(state(inv.id).status).toBe('paid');
    const v = payments.voidPayment(db, p.id, 'Cheque bounced');
    expect(v).toMatchObject({ voided: true, voidReason: 'Cheque bounced', appliedPaise: 0, advancePaise: 0 });
    expect(state(inv.id)).toMatchObject({ paidPaise: 0, status: 'unpaid' });
    expect(() => payments.voidPayment(db, p.id, '')).toThrow(/already reversed/);
    expect(customers.getCustomer(db, c.id)).toMatchObject({ outstandingPaise: rupees(1050), advancePaise: 0 });
  });

  it('removes a voided advance from what the customer holds', () => {
    const c = customer();
    const p = pay(c.id, 700);
    payments.voidPayment(db, p.id, 'Refunded');
    expect(customers.getCustomer(db, c.id).advancePaise).toBe(0);
    expect(() => invoice(c.id, 1, { applyAdvancePaise: rupees(700) })).toThrow(/Only ₹0\.00 of advance/);
  });
});

describe('cancelling an invoice that has been paid', () => {
  it('returns a customer\'s money to their advance', () => {
    const c = customer();
    const inv = invoice(c.id, 1, { payment: { amountPaise: rupees(600), method: 'cash', reference: '' } });
    invoices.cancelInvoice(db, inv.id, 'Wrong item');
    expect(customers.getCustomer(db, c.id)).toMatchObject({ advancePaise: rupees(600), outstandingPaise: 0, billedPaise: 0 });
    expect(state(inv.id)).toMatchObject({ status: 'cancelled', paidPaise: 0 });
    // and that advance can go straight onto a corrected invoice
    const fixed = invoice(c.id, 1, { applyAdvancePaise: rupees(600) });
    expect(fixed).toMatchObject({ paidPaise: rupees(600), status: 'partial' });
  });

  it('reverses a walk-in payment, since there is no customer to hold it for', () => {
    const inv = invoice(null, 1, { payment: { amountPaise: rupees(1050), method: 'cash', reference: '' } });
    invoices.cancelInvoice(db, inv.id, '');
    const [p] = payments.listPayments(db);
    expect(p).toMatchObject({ voided: true, voidReason: `Invoice ${inv.number} cancelled` });
  });
});

describe('ledger', () => {
  it('runs a balance through invoices, payments, cancellations and reversals', () => {
    const c = customer();
    const a = invoice(c.id); // +1050
    pay(c.id, 400, [{ invoiceId: a.id, amountPaise: rupees(400) }]); // −400
    const b = invoice(c.id, 2); // +2100
    invoices.cancelInvoice(db, b.id, 'Duplicate'); // −2100 (reversal)
    const p = pay(c.id, 200); // −200 advance
    payments.voidPayment(db, p.id, 'Refunded'); // +200

    const ledger = receivables.customerLedger(db, c.id);
    expect(ledger.entries.map((e) => [e.kind, e.debitPaise / 100, e.creditPaise / 100, e.balancePaise / 100])).toEqual([
      ['invoice', 1050, 0, 1050],
      ['payment', 0, 400, 650],
      ['invoice', 2100, 0, 2750],
      ['invoice-cancelled', 0, 2100, 650],
      ['payment', 0, 200, 450],
      ['payment-voided', 200, 0, 650],
    ]);
    expect(ledger).toMatchObject({ billedPaise: rupees(1050), receivedPaise: rupees(400), balancePaise: rupees(650) });
    expect(ledger.entries.at(-1)!.balancePaise).toBe(ledger.balancePaise); // the statement always agrees with the headline balance
  });

  it('shows a negative balance when the customer is in credit, and describes where each payment went', () => {
    const c = customer();
    const inv = invoice(c.id);
    pay(c.id, 2000, [{ invoiceId: inv.id, amountPaise: rupees(1050) }], { reference: 'UTR9' });
    const ledger = receivables.customerLedger(db, c.id);
    expect(ledger.balancePaise).toBe(-rupees(950));
    expect(ledger.entries[1]!.description).toBe(`Payment received (UPI · UTR9) — ${inv.number} + advance`);
    expect(ledger.balancePaise).toBe(customers.getCustomer(db, c.id).outstandingPaise - customers.getCustomer(db, c.id).advancePaise);
  });

  it('keeps balance = outstanding − advance for every customer whatever happens', () => {
    const c = customer();
    const a = invoice(c.id, 3);
    pay(c.id, 5000, [{ invoiceId: a.id, amountPaise: rupees(1000) }]);
    invoice(c.id, 1, { applyAdvancePaise: rupees(2000) });
    const p2 = pay(c.id, 100);
    payments.voidPayment(db, p2.id, '');
    invoices.cancelInvoice(db, a.id, '');
    const cu = customers.getCustomer(db, c.id);
    expect(receivables.customerLedger(db, c.id).balancePaise).toBe(cu.outstandingPaise - cu.advancePaise);
  });
});

describe('dues report', () => {
  it('ages what is owed by days past due and groups by customer', () => {
    const a = customer('Asha');
    const b = customer('Bela');
    invoice(a.id, 1, { issueDate: addDays(today, -100), dueDate: addDays(today, -70) }); // 61+  ₹1,050
    invoice(a.id, 1, { issueDate: addDays(today, -50), dueDate: addDays(today, -40) }); // 31–60 ₹1,050
    invoice(b.id, 1, { issueDate: addDays(today, -20), dueDate: addDays(today, -10) }); // 1–30 ₹1,050
    invoice(b.id, 1, { dueDate: addDays(today, 10) }); // current ₹1,050
    invoice(b.id, 1, { dueDate: null }); // no due date → falls back to issue date (today) → current
    const paid = invoice(b.id, 1);
    pay(b.id, 1050, [{ invoiceId: paid.id, amountPaise: rupees(1050) }]);

    const r = receivables.duesReport(db);
    expect(r).toMatchObject({ days61plusPaise: rupees(1050), days31to60Paise: rupees(1050), days1to30Paise: rupees(1050), currentPaise: rupees(2100), outstandingPaise: rupees(5250), overduePaise: rupees(3150) });
    expect(r.rows.map((x) => x.customerName)).toEqual(['Asha', 'Bela']); // most overdue first
    expect(r.rows[0]).toMatchObject({ openInvoices: 2, outstandingPaise: rupees(2100), overduePaise: rupees(2100), oldestDueDate: addDays(today, -70) });
    expect(r.rows[1]).toMatchObject({ openInvoices: 3, overduePaise: rupees(1050) });
  });

  it('reflects part payments, excludes cancelled and fully paid invoices, and lists walk-ins together', () => {
    const c = customer();
    const partial = invoice(c.id, 1, { issueDate: addDays(today, -10), dueDate: addDays(today, -3) });
    pay(c.id, 450, [{ invoiceId: partial.id, amountPaise: rupees(450) }]);
    const gone = invoice(c.id);
    invoices.cancelInvoice(db, gone.id, '');
    invoice(null, 1, { issueDate: addDays(today, -5), dueDate: addDays(today, -1) });

    const r = receivables.duesReport(db);
    expect(r.rows).toHaveLength(2);
    expect(r.rows.find((x) => x.customerId === c.id)).toMatchObject({ openInvoices: 1, outstandingPaise: rupees(600), days1to30Paise: rupees(600) });
    expect(r.rows.find((x) => x.customerId === null)).toMatchObject({ customerName: 'Walk-in customers', outstandingPaise: rupees(1050) });
  });

  it('reports advance held alongside dues', () => {
    const c = customer();
    pay(c.id, 750);
    expect(receivables.duesReport(db)).toMatchObject({ advanceHeldPaise: rupees(750), outstandingPaise: 0, rows: [] });
  });
});

describe('upgrading an existing database', () => {
  it('adds the payment tables to a stage-2 database in place, keeping its invoices and stock', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'invoiceon-')), 'upgrade.db');
    const first = openDb(file);
    saveSettings(first, { gstin: '09AABCK1234M1ZI' });
    const d = inventory.createDesign(first, { code: 'MG-9', name: 'Old design', fabric: '', hsnCode: '5007', description: '', defaultPricePaise: 100000 });
    const v = inventory.createVariant(first, d.id, { color: 'Red', size: '6 m', sellPricePaise: 100000, baseCostPaise: 0, reorderLevel: 0, openingStock: 5, bom: [] });
    const legacy = invoices.createInvoice(first, { type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: v.id, qty: 2, unitPricePaise: 100000 }] });
    // Put the file back into exactly the shape stage 2 left it in.
    first.exec('ALTER TABLE designs DROP COLUMN nickname; ALTER TABLE variants DROP COLUMN mrp_paise; DROP TABLE proforma_lines; DROP TABLE proformas; DROP TABLE expenses; DROP TABLE payment_allocations; DROP TABLE payments; ALTER TABLE invoices DROP COLUMN prices_include_gst; PRAGMA user_version = 2;');
    first.close();

    const upgraded = openDb(file);
    expect((upgraded.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(LATEST_SCHEMA_VERSION);
    // Nothing was lost…
    expect(inventory.getVariant(upgraded, v.id).stock).toBe(3);
    expect(invoices.getInvoice(upgraded, legacy.id)).toMatchObject({ number: legacy.number, totalPaise: 210000, paidPaise: 0, status: 'unpaid', payments: [] });
    // …and the new features work on the old data.
    payments.recordPayment(upgraded, { customerId: null, amountPaise: 210000, method: 'cash', reference: '', receivedOn: today, note: '', allocations: [{ invoiceId: legacy.id, amountPaise: 210000 }] });
    expect(invoices.getInvoice(upgraded, legacy.id).status).toBe('paid');
    upgraded.close();
  });
});

describe('sample data populates every screen', () => {
  it('gives every tab and report something to show, with money that reconciles', () => {
    const demo = openDb(':memory:');
    loadSampleData(demo);
    const range = { from: addDays(today, -400), to: today };

    // Inventory
    expect(inventory.listDesigns(demo)).toHaveLength(5);
    expect(materials.listMaterials(demo)).toHaveLength(6);
    // Customers
    expect(customers.listCustomers(demo)).toHaveLength(4);
    // Invoices: five live ones in different states, plus one cancelled
    const list = invoices.listInvoices(demo);
    expect(list).toHaveLength(6);
    expect(list.map((i) => i.status).sort()).toEqual(['cancelled', 'overdue', 'overdue', 'paid', 'paid', 'unpaid']);
    expect(new Set(list.map((i) => i.type))).toEqual(new Set(['B2B', 'B2C']));
    // Payments: four, one of them an advance that is still held
    const pays = payments.listPayments(demo);
    expect(pays).toHaveLength(4);
    expect(pays.filter((p) => p.advancePaise > 0)).toHaveLength(1);
    // Dues: two customers owe, spread across "not yet due" and overdue
    const dues = receivables.duesReport(demo);
    expect(dues.rows.map((r) => r.customerName).sort()).toEqual(['Kanchan Sarees & Fabrics', 'Meera Textiles']);
    expect(dues.currentPaise).toBeGreaterThan(0);
    expect(dues.days31to60Paise).toBeGreaterThan(0);
    expect(dues.days1to30Paise).toBeGreaterThan(0);
    expect(dues.advanceHeldPaise).toBe(rupees(3000));
    // Reports
    const sales = reports.salesReport(demo, range);
    expect(sales.invoiceCount).toBe(5);
    expect(sales.cancelledCount).toBe(1);
    expect(sales.collectedPaise).toBe(rupees(20000 + 10710 + 14175 + 3000));
    expect(sales.grossProfitPaise).toBeGreaterThan(0);
    const gst = reports.gstReport(demo, range);
    expect(gst.b2bRegister).toHaveLength(3);
    expect(gst.b2c.invoices).toBe(2);
    expect(gst.totals.igstPaise).toBeGreaterThan(0); // Meera is in Maharashtra
    expect(gst.totals.cgstPaise).toBeGreaterThan(0);
    expect(gst.totals.taxablePaise).toBe(sales.taxablePaise);
    const stock = reports.stockReport(demo);
    expect(stock.pieces).toBe(45);
    expect(stock.outOfStockVariants).toBeGreaterThan(0);
    // The invoices carry the sample business's design details, so PDFs show a bank block and footer
    const inv = invoices.getInvoice(demo, list[0]!.id);
    expect(inv.seller.bank).toContain('IFSC');
    expect(inv.seller.footer).toContain('Thank you');
  });
});

describe('invoice design settings', () => {
  it('validates the logo, colour and text, and defaults sensibly', () => {
    expect(getSettings(db)).toMatchObject({ invoiceAccent: '#0F6E56', invoiceLogo: '', invoiceBank: '', invoiceFooter: '', invoiceShowSignature: true });
    expect(saveSettings(db, { invoiceAccent: '#7a1f3d', invoiceShowSignature: false, invoiceFooter: 'Thanks!' })).toMatchObject({ invoiceAccent: '#7A1F3D', invoiceShowSignature: false, invoiceFooter: 'Thanks!' });
    expect(() => saveSettings(db, { invoiceAccent: 'red' })).toThrow(/six-digit colour/);
    expect(() => saveSettings(db, { invoiceLogo: 'http://evil.example/logo.png' })).toThrow(/PNG, JPEG or WebP/);
    expect(() => saveSettings(db, { invoiceLogo: 'data:image/svg+xml;base64,PHN2Zz4=' })).toThrow(/PNG, JPEG or WebP/);
    expect(() => saveSettings(db, { invoiceLogo: `data:image/png;base64,${'A'.repeat(200_001)}` })).toThrow(/too large/);
    expect(saveSettings(db, { invoiceLogo: 'data:image/png;base64,iVBORw0KGgo=' }).invoiceLogo).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('freezes bank details and footer on an invoice but restyles it live', () => {
    const c = customer('Design tester');
    saveSettings(db, { invoiceBank: 'Old Bank A/c 1', invoiceFooter: 'Old footer', invoiceAccent: '#7A1F3D' });
    const inv = invoice(c.id);
    expect(inv.seller).toMatchObject({ bank: 'Old Bank A/c 1', footer: 'Old footer' });
    expect(inv.branding.accent).toBe('#7A1F3D');

    saveSettings(db, { invoiceBank: 'New Bank A/c 2', invoiceFooter: 'New footer', invoiceAccent: '#1F3A6E', invoiceLogo: 'data:image/png;base64,iVBORw0KGgo=' });
    const again = invoices.getInvoice(db, inv.id);
    expect(again.seller).toMatchObject({ bank: 'Old Bank A/c 1', footer: 'Old footer' }); // what was promised on the invoice doesn't change
    expect(again.branding).toEqual({ accent: '#1F3A6E', logo: 'data:image/png;base64,iVBORw0KGgo=', showSignature: true, showUpiQr: true }); // but the look does
  });

  it('reads an invoice issued before bank and footer existed', () => {
    const c = customer('Legacy');
    const inv = invoice(c.id);
    const legacy = JSON.parse((db.prepare('SELECT seller_json AS j FROM invoices WHERE id = ?').get(inv.id) as { j: string }).j);
    delete legacy.bank;
    delete legacy.footer;
    db.prepare('UPDATE invoices SET seller_json = ? WHERE id = ?').run(JSON.stringify(legacy), inv.id);
    expect(invoices.getInvoice(db, inv.id).seller).toMatchObject({ bank: '', footer: '' });
  });
});

describe('archiving customers with money in play', () => {
  it('is blocked while they owe money or you hold their advance, and allowed once settled', () => {
    const c = customer();
    const inv = invoice(c.id);
    expect(() => customers.archiveCustomer(db, c.id)).toThrow(/still owes ₹1,050\.00/);
    pay(c.id, 1200, [{ invoiceId: inv.id, amountPaise: rupees(1050) }]);
    expect(() => customers.archiveCustomer(db, c.id)).toThrow(/holding ₹150\.00 in advance/);
    invoice(c.id, 1, { applyAdvancePaise: rupees(150) }); // now owes 900
    const open = invoices.listInvoices(db, { customerId: c.id, status: 'open' })[0]!;
    pay(c.id, 900, [{ invoiceId: open.id, amountPaise: rupees(900) }]);
    expect(() => customers.archiveCustomer(db, c.id)).not.toThrow();
  });
});

describe('summaries and API', () => {
  it('feeds the dashboard from real payments', () => {
    const c = customer();
    invoice(c.id, 2); // 2100
    const inv = invoice(c.id); // 1050
    pay(c.id, 1050, [{ invoiceId: inv.id, amountPaise: rupees(1050) }]);
    const s = invoices.dashboardSummary(db);
    expect(s).toMatchObject({ outstandingPaise: rupees(2100), openInvoices: 1, monthPaise: rupees(3150) });
    expect(s.recent.map((i) => i.status)).toEqual(['paid', 'unpaid']);
  });

  it('summarises payments for the screen header', () => {
    const c = customer();
    const inv = invoice(c.id, 1, { issueDate: addDays(today, -9), dueDate: addDays(today, -2) });
    pay(c.id, 300, [{ invoiceId: inv.id, amountPaise: rupees(300) }]);
    pay(c.id, 200);
    expect(receivables.paymentsSummary(db)).toMatchObject({ receivedThisMonthPaise: rupees(500), paymentsThisMonth: 2, advanceHeldPaise: rupees(200), customersWithAdvance: 1, outstandingPaise: rupees(750), overduePaise: rupees(750) });
  });

  it('lists and filters payments', () => {
    const c = customer('Meera');
    const other = customer('Zoya');
    const inv = invoice(c.id);
    pay(c.id, 1050, [{ invoiceId: inv.id, amountPaise: rupees(1050) }], { reference: 'CHQ 88', method: 'cheque' });
    pay(other.id, 500);
    const voided = pay(other.id, 100);
    payments.voidPayment(db, voided.id, '');
    expect(payments.listPayments(db)).toHaveLength(3);
    expect(payments.listPayments(db, { status: 'advance' }).map((p) => p.customerName)).toEqual(['Zoya']);
    expect(payments.listPayments(db, { status: 'voided' })).toHaveLength(1);
    expect(payments.listPayments(db, { search: 'chq' }).map((p) => p.customerName)).toEqual(['Meera']);
    expect(payments.listPayments(db, { search: inv.number.slice(-4) }).map((p) => p.customerName)).toEqual(['Meera']);
    expect(payments.listPayments(db, { customerId: other.id })).toHaveLength(2);
  });

  it('exposes it all through the API with user-safe errors', async () => {
    const api = createApi(db);
    const c = customer();
    const inv = invoice(c.id);
    await api.paymentRecord({ customerId: c.id, amountPaise: rupees(100), method: 'cash', reference: '', receivedOn: today, note: '', allocations: [{ invoiceId: inv.id, amountPaise: rupees(100) }] });
    expect((await api.duesReport()).outstandingPaise).toBe(rupees(950));
    expect((await api.customerLedger(c.id)).entries).toHaveLength(2);
    await expect(api.paymentVoid('nope', '')).rejects.toThrow(/no longer exists/);
  });
});
