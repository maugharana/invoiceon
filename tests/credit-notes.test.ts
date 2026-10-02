import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../electron/db/connection';
import * as creditNotes from '../electron/services/creditNotes';
import * as customers from '../electron/services/customers';
import * as expenses from '../electron/services/expenses';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as payments from '../electron/services/payments';
import * as receivables from '../electron/services/receivables';
import * as reports from '../electron/services/reports';
import { saveSettings } from '../electron/services/settings';
import { gstCreditCsv, gstCsv, salesCsv } from '../shared/csv';
import { addDays, financialYear, todayIso } from '../shared/gst';
import type { CreditNoteInput, InvoiceInput } from '../shared/types';

const rupees = (n: number) => n * 100;
const today = todayIso();
let db: Db;
let red: string;
let blue: string;

beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { gstin: '09AABCK1234M1ZI' });
  const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: '', hsnCode: '5007', description: '', defaultPricePaise: rupees(1000) });
  const mk = (color: string) => inventory.createVariant(db, d.id, { color, size: '6.3 m', sellPricePaise: rupees(1000), baseCostPaise: rupees(400), reorderLevel: 0, openingStock: 20, bom: [] }).id;
  red = mk('Red');
  blue = mk('Blue');
});

const customer = (name = 'Sunita') => customers.createCustomer(db, { name, type: 'B2C', phone: '', email: '', gstin: '', address: '', city: 'Mau', state: 'Uttar Pradesh', pincode: '', notes: '' });
/** 3 red + 1 blue at ₹1,000 each + 5% GST = ₹4,200. */
const invoice = (customerId: string | null, over: Partial<InvoiceInput> = {}) =>
  invoices.createInvoice(db, { type: 'B2C', customerId, issueDate: today, dueDate: addDays(today, 10), discountPaise: 0, notes: '', lines: [{ variantId: red, qty: 3, unitPricePaise: rupees(1000) }, { variantId: blue, qty: 1, unitPricePaise: rupees(1000) }], ...over });
const pay = (customerId: string | null, amount: number, invoiceId?: string) =>
  payments.recordPayment(db, { customerId, amountPaise: rupees(amount), method: 'upi', reference: '', receivedOn: today, note: '', allocations: invoiceId ? [{ invoiceId, amountPaise: rupees(amount) }] : [] });
const stock = (id: string) => inventory.getVariant(db, id).stock;
const credit = (invoiceId: string, lines: CreditNoteInput['lines'], over: Partial<CreditNoteInput> = {}) =>
  creditNotes.createCreditNote(db, { invoiceId, issueDate: today, reason: 'Returned by the customer', lines, settlement: 'credit', ...over });
const lineId = (inv: ReturnType<typeof invoice>, variantId: string) => inv.lines.find((l) => l.variantId === variantId)!.id;

describe('previewing a credit', () => {
  it('shows what is left on each line, and what a credit for some of it would come to', () => {
    const inv = invoice(null);
    const none = creditNotes.previewCreditNote(db, { invoiceId: inv.id, lines: [] });
    expect(none.lines.map((l) => [l.color, l.soldQty, l.creditableQty, l.unitGrossPaise])).toEqual([['Red', 3, 3, rupees(1050)], ['Blue', 1, 1, rupees(1050)]]);
    expect(none.totalPaise).toBe(0);
    const two = creditNotes.previewCreditNote(db, { invoiceId: inv.id, lines: [{ invoiceLineId: lineId(inv, red), qty: 2, restock: true }] });
    expect(two).toMatchObject({ taxablePaise: rupees(2000), taxPaise: rupees(100), totalPaise: rupees(2100), owedOnInvoicePaise: rupees(4200), appliedToInvoicePaise: rupees(2100), excessPaise: 0, fullReturn: false });
  });

  it('refuses more than is left on a line, and an invoice that is cancelled', () => {
    const inv = invoice(null);
    expect(() => creditNotes.previewCreditNote(db, { invoiceId: inv.id, lines: [{ invoiceLineId: lineId(inv, red), qty: 4, restock: true }] })).toThrow(/only 3 of 3 can still be taken back/);
    invoices.cancelInvoice(db, inv.id, 'x');
    expect(() => creditNotes.previewCreditNote(db, { invoiceId: inv.id, lines: [] })).toThrow(/is cancelled/);
  });
});

describe('a credit note on an unpaid invoice', () => {
  it('takes the credit off what is owed, puts the pieces back, and has its own number and tax', () => {
    const c = customer();
    const inv = invoice(c.id);
    const cn = credit(inv.id, [{ invoiceLineId: lineId(inv, red), qty: 2, restock: true }]);
    expect(cn.number).toBe(`CN/${financialYear(today)}/0001`);
    expect(cn).toMatchObject({ status: 'issued', totalPaise: rupees(2100), taxablePaise: rupees(2000), cgstPaise: rupees(50), sgstPaise: rupees(50), igstPaise: 0, invoiceNumber: inv.number, heldPaise: 0 });
    expect(cn.lines[0]).toMatchObject({ qty: 2, restocked: true, taxablePaise: rupees(2000), taxPaise: rupees(100), ratePercent: 5 });
    expect(stock(red)).toBe(20 - 3 + 2);
    expect(inventory.listMovements(db, red)[0]).toMatchObject({ reason: 'return', delta: 2, note: `Credit note ${cn.number}` });
    const after = invoices.getInvoice(db, inv.id);
    expect(after).toMatchObject({ paidPaise: rupees(2100), creditedPaise: rupees(2100), status: 'partial' });
    expect(after.creditNotes.map((n) => n.number)).toEqual([cn.number]);
    expect(customers.getCustomer(db, c.id)).toMatchObject({ outstandingPaise: rupees(2100), advancePaise: 0, creditedPaise: rupees(2100) });
  });

  it('settles the invoice when everything is taken back, round-off and all, so it nets to nothing', () => {
    const c = customer();
    const inv = invoice(c.id, { lines: [{ variantId: red, qty: 3, unitPricePaise: 33333 }] }); // an awkward amount that needs rounding
    const cn = credit(inv.id, [{ invoiceLineId: inv.lines[0]!.id, qty: 3, restock: true }]);
    expect(cn.totalPaise).toBe(inv.totalPaise);
    expect(cn.taxablePaise).toBe(inv.taxablePaise);
    expect(invoices.getInvoice(db, inv.id)).toMatchObject({ paidPaise: inv.totalPaise, status: 'paid' });
    expect(customers.getCustomer(db, c.id).outstandingPaise).toBe(0);
  });

  it('shares tax out so part credits of one line add up to the whole, to the paisa', () => {
    const inv = invoice(null, { lines: [{ variantId: red, qty: 3, unitPricePaise: 33333 }] });
    const l = inv.lines[0]!.id;
    const a = credit(inv.id, [{ invoiceLineId: l, qty: 1, restock: true }]);
    const b = credit(inv.id, [{ invoiceLineId: l, qty: 1, restock: true }]);
    const c = credit(inv.id, [{ invoiceLineId: l, qty: 1, restock: true }]);
    expect(a.taxablePaise + b.taxablePaise + c.taxablePaise).toBe(inv.taxablePaise);
    // CGST and SGST are each half of a note's tax, so an odd paisa can fall on either side; the tax as a whole always adds up.
    const taxOf = (n: typeof a) => n.cgstPaise + n.sgstPaise + n.igstPaise;
    expect(taxOf(a) + taxOf(b) + taxOf(c)).toBe(inv.cgstPaise + inv.sgstPaise + inv.igstPaise);
    expect(a.totalPaise + b.totalPaise + c.totalPaise).toBe(inv.totalPaise);
    expect([a.number, b.number, c.number].map((n) => n.slice(-4))).toEqual(['0001', '0002', '0003']);
  });

  it('does not put damaged pieces back on the shelf', () => {
    const inv = invoice(null);
    credit(inv.id, [{ invoiceLineId: lineId(inv, red), qty: 1, restock: false }], { reason: 'Damaged or defective' });
    expect(stock(red)).toBe(20 - 3);
  });

  it('keeps the other tax rates right on a mixed invoice', () => {
    const inv = invoice(null, { lines: [{ variantId: red, qty: 1, unitPricePaise: rupees(1000), ratePercent: 12 }, { variantId: blue, qty: 1, unitPricePaise: rupees(1000), ratePercent: 5 }] });
    const cn = credit(inv.id, [{ invoiceLineId: lineId(inv, red), qty: 1, restock: true }]);
    expect(cn).toMatchObject({ taxablePaise: rupees(1000), cgstPaise: rupees(60), sgstPaise: rupees(60), totalPaise: rupees(1120) });
    expect(cn.taxByRate).toEqual([expect.objectContaining({ ratePercent: 12, taxablePaise: rupees(1000), taxPaise: rupees(120) })]);
  });
});

describe('a credit note on an invoice already paid', () => {
  it('holds the excess as credit for the next invoice, and puts it there automatically', () => {
    const c = customer();
    const inv = invoice(c.id);
    pay(c.id, 4200, inv.id);
    const cn = credit(inv.id, [{ invoiceLineId: lineId(inv, red), qty: 2, restock: true }]);
    expect(cn).toMatchObject({ totalPaise: rupees(2100), heldPaise: rupees(2100), applications: [] });
    expect(customers.getCustomer(db, c.id)).toMatchObject({ outstandingPaise: 0, advancePaise: rupees(2100) });
    // The next invoice takes the credit.
    const next = invoices.createInvoice(db, { type: 'B2C', customerId: c.id, issueDate: today, dueDate: null, discountPaise: 0, notes: '', lines: [{ variantId: blue, qty: 1, unitPricePaise: rupees(1000) }], applyAdvancePaise: rupees(1050) });
    expect(next).toMatchObject({ paidPaise: rupees(1050), status: 'paid' });
    expect(creditNotes.getCreditNote(db, cn.id)).toMatchObject({ heldPaise: rupees(1050), applications: [{ invoiceNumber: next.number, amountPaise: rupees(1050) }] });
    expect(customers.getCustomer(db, c.id).advancePaise).toBe(rupees(1050));
  });

  it('can hand the excess back now, which is also an expense', () => {
    const c = customer();
    const inv = invoice(c.id);
    pay(c.id, 4200, inv.id);
    const cn = credit(inv.id, [{ invoiceLineId: lineId(inv, red), qty: 2, restock: true }], { settlement: 'refund', refund: { method: 'upi', reference: 'UTR9' } });
    expect(cn).toMatchObject({ heldPaise: 0, refunds: [{ amountPaise: rupees(2100), method: 'upi' }] });
    expect(expenses.listExpenses(db, { category: 'Customer refunds' })[0]).toMatchObject({ amountPaise: rupees(2100), vendor: 'Sunita', reference: 'UTR9', status: 'paid', note: `Credit note ${cn.number}` });
    expect(customers.getCustomer(db, c.id)).toMatchObject({ outstandingPaise: 0, advancePaise: 0 });
  });

  it('asks how to pay a refund, and always refunds a customer who is not saved', () => {
    const c = customer();
    const inv = invoice(c.id);
    pay(c.id, 4200, inv.id);
    expect(() => credit(inv.id, [{ invoiceLineId: lineId(inv, red), qty: 1, restock: true }], { settlement: 'refund' })).toThrow(/how the refund is paid/);
    const walkIn = invoice(null);
    payments.recordPayment(db, { customerId: null, amountPaise: rupees(4200), method: 'cash', reference: '', receivedOn: today, note: '', allocations: [{ invoiceId: walkIn.id, amountPaise: rupees(4200) }] });
    const cn = credit(walkIn.id, [{ invoiceLineId: lineId(walkIn, red), qty: 1, restock: true }], { settlement: 'credit', refund: { method: 'cash' } });
    expect(cn.refunds).toHaveLength(1);
  });

  it('refunds credit that was being kept, part or all of it', () => {
    const c = customer();
    const inv = invoice(c.id);
    pay(c.id, 4200, inv.id);
    const cn = credit(inv.id, [{ invoiceLineId: lineId(inv, red), qty: 2, restock: true }]);
    const part = creditNotes.refundCreditNote(db, cn.id, { method: 'cash', amountPaise: rupees(500) });
    expect(part).toMatchObject({ heldPaise: rupees(1600), refunds: [{ amountPaise: rupees(500) }] });
    expect(() => creditNotes.refundCreditNote(db, cn.id, { method: 'cash', amountPaise: rupees(2000) })).toThrow(/Only .* is being kept/);
    expect(creditNotes.refundCreditNote(db, cn.id, { method: 'cash' }).heldPaise).toBe(0);
    expect(() => creditNotes.refundCreditNote(db, cn.id, { method: 'cash' })).toThrow(/Nothing is being kept/);
  });
});

describe('the customer statement', () => {
  it('still balances: billed less credit notes, payments and write-offs, plus refunds, is outstanding less advance', () => {
    const c = customer();
    const a = invoice(c.id);
    const b = invoice(c.id);
    pay(c.id, 4200, a.id);
    credit(a.id, [{ invoiceLineId: lineId(a, red), qty: 2, restock: true }]);
    const cn2 = credit(b.id, [{ invoiceLineId: lineId(b, blue), qty: 1, restock: true }]);
    creditNotes.refundCreditNote(db, creditNotes.listCreditNotes(db, { invoiceId: a.id })[0]!.id, { method: 'cash', amountPaise: rupees(300) });
    const ledger = receivables.customerLedger(db, c.id);
    const cust = customers.getCustomer(db, c.id);
    expect(ledger.balancePaise).toBe(cust.outstandingPaise - cust.advancePaise);
    expect(ledger.entries.at(-1)!.balancePaise).toBe(ledger.balancePaise);
    expect(ledger).toMatchObject({ creditedPaise: rupees(2100) + cn2.totalPaise, refundedPaise: rupees(300) });
    expect(ledger.entries.map((e) => e.kind)).toEqual(expect.arrayContaining(['credit-note', 'refund']));
  });
});

describe('cancelling', () => {
  it('takes the credit back off the invoice and the pieces off the shelf, and shows it on the statement', () => {
    const c = customer();
    const inv = invoice(c.id);
    const cn = credit(inv.id, [{ invoiceLineId: lineId(inv, red), qty: 2, restock: true }]);
    const gone = creditNotes.cancelCreditNote(db, cn.id, 'Entered by mistake');
    expect(gone).toMatchObject({ status: 'cancelled', cancelReason: 'Entered by mistake' });
    expect(stock(red)).toBe(20 - 3);
    expect(invoices.getInvoice(db, inv.id)).toMatchObject({ paidPaise: 0, creditedPaise: 0 });
    expect(customers.getCustomer(db, c.id)).toMatchObject({ outstandingPaise: rupees(4200), creditedPaise: 0 });
    expect(receivables.customerLedger(db, c.id).entries.map((e) => e.kind)).toContain('credit-note-cancelled');
    // The pieces can be taken back again on a new credit note.
    expect(credit(inv.id, [{ invoiceLineId: lineId(inv, red), qty: 3, restock: true }]).number.slice(-4)).toBe('0002');
  });

  it('is refused once money was handed back or the credit went onto another invoice', () => {
    const c = customer();
    const inv = invoice(c.id);
    pay(c.id, 4200, inv.id);
    const cn = credit(inv.id, [{ invoiceLineId: lineId(inv, red), qty: 2, restock: true }]);
    invoices.createInvoice(db, { type: 'B2C', customerId: c.id, issueDate: today, dueDate: null, discountPaise: 0, notes: '', lines: [{ variantId: blue, qty: 1, unitPricePaise: rupees(1000) }], applyAdvancePaise: rupees(1050) });
    expect(() => creditNotes.cancelCreditNote(db, cn.id, '')).toThrow(/was put toward/);
    creditNotes.refundCreditNote(db, cn.id, { method: 'cash' });
    expect(() => creditNotes.cancelCreditNote(db, cn.id, '')).toThrow(/Money was handed back/);
  });

  it('is refused when the pieces it put back have been sold on, and changes nothing', () => {
    const inv = invoice(null);
    inventory.adjustStock(db, { variantId: red, delta: -(stock(red) - 1), reason: 'adjustment', note: '' });
    const cn = credit(inv.id, [{ invoiceLineId: lineId(inv, red), qty: 3, restock: true }]);
    inventory.adjustStock(db, { variantId: red, delta: -stock(red), reason: 'adjustment', note: '' });
    expect(() => creditNotes.cancelCreditNote(db, cn.id, '')).toThrow(/Not enough stock/);
    expect(creditNotes.getCreditNote(db, cn.id).status).toBe('issued');
  });

  it('stops an invoice being cancelled while it has a credit note', () => {
    const inv = invoice(null);
    const cn = credit(inv.id, [{ invoiceLineId: lineId(inv, red), qty: 1, restock: true }]);
    expect(() => invoices.cancelInvoice(db, inv.id, '')).toThrow(/Cancel it first/);
    creditNotes.cancelCreditNote(db, cn.id, '');
    expect(invoices.cancelInvoice(db, inv.id, '').status).toBe('cancelled');
  });
});

describe('rules', () => {
  it('needs items, a reason, a date that makes sense, and refuses dates before the invoice or in the future', () => {
    const inv = invoice(null);
    const l = lineId(inv, red);
    expect(() => credit(inv.id, [])).toThrow(/at least one item/);
    expect(() => credit(inv.id, [{ invoiceLineId: l, qty: 1, restock: true }], { reason: '' })).toThrow(/why the goods/);
    expect(() => credit(inv.id, [{ invoiceLineId: l, qty: 1, restock: true }], { issueDate: addDays(today, 2) })).toThrow(/not in the future/);
    const old = invoice(null, { issueDate: addDays(today, -5) });
    expect(() => credit(old.id, [{ invoiceLineId: lineId(old, red), qty: 1, restock: true }], { issueDate: addDays(today, -9) })).toThrow(/before the invoice/);
  });

  it('lists credit notes by customer, invoice and search', () => {
    const c = customer();
    const a = invoice(c.id);
    const b = invoice(null);
    credit(a.id, [{ invoiceLineId: lineId(a, red), qty: 1, restock: true }]);
    credit(b.id, [{ invoiceLineId: lineId(b, red), qty: 1, restock: true }]);
    expect(creditNotes.listCreditNotes(db)).toHaveLength(2);
    expect(creditNotes.listCreditNotes(db, { customerId: c.id })).toHaveLength(1);
    expect(creditNotes.listCreditNotes(db, { invoiceId: b.id })).toHaveLength(1);
    expect(creditNotes.listCreditNotes(db, { search: 'sunita' })).toHaveLength(1);
  });
});

describe('reports', () => {
  const range = { from: addDays(today, -30), to: today };

  it('shows credit notes in the sales report and takes returned goods out of profit', () => {
    const inv = invoice(null); // 4 pieces, ₹4,000 taxable, cost ₹400 each
    const before = reports.salesReport(db, range);
    expect(before.grossProfitPaise).toBe(rupees(4000) - rupees(1600));
    credit(inv.id, [{ invoiceLineId: lineId(inv, red), qty: 2, restock: true }]); // goes back on the shelf: cost returns too
    credit(inv.id, [{ invoiceLineId: lineId(inv, blue), qty: 1, restock: false }]); // damaged: the cost is lost
    const r = reports.salesReport(db, range);
    expect(r).toMatchObject({ invoicedPaise: rupees(4200), creditNoteCount: 2, creditedPaise: rupees(3150), creditedTaxablePaise: rupees(3000), netInvoicedPaise: rupees(1050) });
    // Sales fell by ₹3,000. The two returned reds give back their ₹800 cost; the damaged blue does not.
    expect(r.grossProfitPaise).toBe(rupees(4000) - rupees(1600) - (rupees(2000) - rupees(800)) - rupees(1000));
    expect(salesCsv(r)).toContain('Credit notes (goods taken back),3150.00');
  });

  it('lists credit notes in the GST report with a row for each rate, and works out the tax due after them', () => {
    const c = customers.createCustomer(db, { name: 'Biz Ltd', type: 'B2B', phone: '', email: '', gstin: '27AAPFU0939F1ZV', address: '', city: 'Mumbai', state: 'Maharashtra', pincode: '', notes: '' });
    const inv = invoice(c.id, { type: 'B2B', lines: [{ variantId: red, qty: 1, unitPricePaise: rupees(1000), ratePercent: 12 }, { variantId: blue, qty: 1, unitPricePaise: rupees(1000), ratePercent: 5 }] });
    const cn = credit(inv.id, [{ invoiceLineId: lineId(inv, red), qty: 1, restock: true }]);
    const g = reports.gstReport(db, range);
    expect(g.totals.taxPaise).toBe(rupees(120) + rupees(50));
    expect(g.creditNotes).toMatchObject({ invoices: 1, taxablePaise: rupees(1000), taxPaise: rupees(120), invoiceValuePaise: cn.totalPaise });
    expect(g.netTotals).toMatchObject({ taxablePaise: rupees(1000), taxPaise: rupees(50) });
    expect(g.creditRegister).toEqual([expect.objectContaining({ number: cn.number, invoiceNumber: inv.number, gstin: '27AAPFU0939F1ZV', type: 'B2B', placeOfSupply: 'Maharashtra', ratePercent: 12, taxablePaise: rupees(1000), cgstPaise: 0, sgstPaise: 0, igstPaise: rupees(120), totalPaise: cn.totalPaise })]);
    expect(gstCreditCsv(g)).toContain(`${cn.number},${today},${inv.number}`);
    expect(gstCsv(g)).toContain('Tax due after credit notes,50.00');
    // A cancelled credit note is not counted.
    creditNotes.cancelCreditNote(db, cn.id, '');
    expect(reports.gstReport(db, range).creditRegister).toHaveLength(0);
    expect(reports.gstReport(db, range).netTotals.taxPaise).toBe(rupees(170));
  });
});
