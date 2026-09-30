import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../electron/db/connection';
import * as creditNotes from '../electron/services/creditNotes';
import * as customers from '../electron/services/customers';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as payments from '../electron/services/payments';
import * as receivables from '../electron/services/receivables';
import * as reports from '../electron/services/reports';
import { saveSettings } from '../electron/services/settings';
import { computeTotals, computeTotalsMulti, taxByRate, todayIso } from '../shared/gst';
import type { CreditNoteInput, CustomerInput, InvoiceInput } from '../shared/types';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { state: 'Uttar Pradesh', gstin: '09AAACH7409R1ZZ' });
});

const rupees = (n: number) => n * 100;
const today = todayIso();

function stocked(stock = 10, price = 1000) {
  const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: 'Silk', hsnCode: '5007', description: '', defaultPricePaise: rupees(price) });
  const v = inventory.createVariant(db, d.id, { color: 'Maroon', size: '6.3 m', sellPricePaise: rupees(price), baseCostPaise: rupees(400), reorderLevel: 2, openingStock: stock, bom: [] });
  return { d, v };
}
const customer = (over: Partial<CustomerInput> = {}) =>
  customers.createCustomer(db, { name: 'Sunita', type: 'B2C', phone: '', email: '', gstin: '', address: '', city: 'Mau', state: 'Uttar Pradesh', pincode: '', notes: '', ...over });

function invoiceFor(variantId: string, over: Partial<InvoiceInput> = {}, qty = 1, price = 1000): InvoiceInput {
  return { type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId, qty, unitPricePaise: rupees(price) }], ...over };
}
const stockOf = (variantId: string) => inventory.getVariant(db, variantId).stock;

function returnOf(invoiceId: string, invoiceLineId: string, qty = 1, over: Partial<CreditNoteInput> = {}): CreditNoteInput {
  return { invoiceId, issueDate: today, kind: 'return', reason: 'Colour not as expected', notes: '', lines: [{ invoiceLineId, qty, restock: true }], ...over };
}

describe('multi rate tax helper', () => {
  it('matches computeTotals when there is only one rate', () => {
    const one = computeTotals({ lineAmounts: [12345, 6789], discountPaise: 1001, ratePercent: 5, intraState: true });
    const many = computeTotalsMulti({ lines: [{ amountPaise: 12345, ratePercent: 5 }, { amountPaise: 6789, ratePercent: 5 }], discountPaise: 1001, intraState: true });
    expect(many).toMatchObject({ subtotalPaise: one.subtotalPaise, taxablePaise: one.taxablePaise, cgstPaise: one.cgstPaise, sgstPaise: one.sgstPaise, igstPaise: one.igstPaise, roundOffPaise: one.roundOffPaise, totalPaise: one.totalPaise });
  });

  it('taxes each rate on its own share and shows one group per rate', () => {
    const t = computeTotalsMulti({ lines: [{ amountPaise: rupees(1000), ratePercent: 5 }, { amountPaise: rupees(3000), ratePercent: 18 }], discountPaise: rupees(400), intraState: false });
    expect(t.lineTaxablePaise).toEqual([rupees(900), rupees(2700)]);
    expect(t.groups.map((g) => g.ratePercent)).toEqual([5, 18]);
    expect(t.igstPaise).toBe(rupees(45) + rupees(486));
    expect(t.totalPaise).toBe(rupees(900 + 2700 + 45 + 486));
  });

  it('tax on already discounted amounts sums groups to the totals', () => {
    const t = taxByRate([{ taxablePaise: 3333, ratePercent: 12 }, { taxablePaise: 9999, ratePercent: 12 }, { taxablePaise: 500, ratePercent: 5 }], true);
    expect(t.groups).toHaveLength(2);
    expect(t.cgstPaise + t.sgstPaise).toBe(t.taxPaise);
    expect(t.totalPaise % 100).toBe(0);
    expect(t.totalPaise - t.roundOffPaise).toBe(t.taxablePaise + t.taxPaise);
  });
});

describe('sales returns', () => {
  it('puts the piece back on the shelf and sets the credit against what the customer owes', () => {
    const { v } = stocked(10);
    const c = customer();
    const inv = invoices.createInvoice(db, invoiceFor(v.id, { customerId: c.id }, 2));
    expect(stockOf(v.id)).toBe(8);

    const cn = creditNotes.createCreditNote(db, returnOf(inv.id, inv.lines[0]!.id, 1));
    expect(cn.number).toMatch(/^CN\/\d{4}-\d{2}\/0001$/);
    expect(cn.totalPaise).toBe(rupees(1050));
    expect(cn.cgstPaise + cn.sgstPaise).toBe(rupees(50));
    expect(stockOf(v.id)).toBe(9);

    const after = invoices.getInvoice(db, inv.id);
    expect(after.creditedPaise).toBe(rupees(1050));
    expect(after.paidPaise).toBe(rupees(1050));
    expect(after.totalPaise - after.paidPaise).toBe(rupees(1050)); // one of two pieces still owed
    expect(after.lines[0]!.creditedQty).toBe(1);
    expect(after.creditNotes).toHaveLength(1);
    expect(after.payments[0]).toMatchObject({ source: 'credit_note', creditNoteNumber: cn.number });

    const now = customers.getCustomer(db, c.id);
    expect(now.outstandingPaise).toBe(rupees(1050));
    expect(now.advancePaise).toBe(0);
  });

  it('holds the credit as advance when the invoice was already paid, and the ledger still adds up', () => {
    const { v } = stocked(10);
    const c = customer();
    const inv = invoices.createInvoice(db, invoiceFor(v.id, { customerId: c.id }, 1, 1000));
    payments.recordPayment(db, { customerId: c.id, amountPaise: inv.totalPaise, method: 'upi', reference: '', receivedOn: today, note: '', allocations: [{ invoiceId: inv.id, amountPaise: inv.totalPaise }] });

    const cn = creditNotes.createCreditNote(db, returnOf(inv.id, inv.lines[0]!.id, 1));
    expect(cn.appliedToInvoicePaise).toBe(0);
    expect(cn.heldAsCreditPaise).toBe(rupees(1050));

    const now = customers.getCustomer(db, c.id);
    expect(now.outstandingPaise).toBe(0);
    expect(now.advancePaise).toBe(rupees(1050));

    const ledger = receivables.customerLedger(db, c.id);
    expect(ledger.entries.map((e) => e.kind)).toEqual(['invoice', 'payment', 'credit-note']);
    expect(ledger.balancePaise).toBe(now.outstandingPaise - now.advancePaise);
    expect(ledger.entries.at(-1)!.balancePaise).toBe(ledger.balancePaise);
  });

  it('can refund instead, leaving nothing held and a matching ledger', () => {
    const { v } = stocked(10);
    const c = customer();
    const inv = invoices.createInvoice(db, invoiceFor(v.id, { customerId: c.id }));
    payments.recordPayment(db, { customerId: c.id, amountPaise: inv.totalPaise, method: 'cash', reference: '', receivedOn: today, note: '', allocations: [{ invoiceId: inv.id, amountPaise: inv.totalPaise }] });

    const cn = creditNotes.createCreditNote(db, returnOf(inv.id, inv.lines[0]!.id, 1, { refund: { amountPaise: rupees(1050), method: 'cash', reference: '' } }));
    expect(cn.refundPaise).toBe(rupees(1050));
    expect(cn.heldAsCreditPaise).toBe(0);
    const now = customers.getCustomer(db, c.id);
    expect(now.advancePaise).toBe(0);
    expect(now.outstandingPaise).toBe(0);

    const ledger = receivables.customerLedger(db, c.id);
    expect(ledger.entries.map((e) => e.kind)).toEqual(['invoice', 'payment', 'credit-note', 'refund']);
    expect(ledger.balancePaise).toBe(0);
    expect(ledger.entries.at(-1)!.balancePaise).toBe(0);
  });

  it('credits a discounted piece at what the customer actually paid', () => {
    const { v } = stocked(10);
    const c = customer();
    const inv = invoices.createInvoice(db, invoiceFor(v.id, { customerId: c.id, discountPaise: rupees(200) }, 2, 1000)); // 2000 - 200 = 1800, +5% = 1890
    expect(inv.totalPaise).toBe(rupees(1890));
    const cn = creditNotes.createCreditNote(db, returnOf(inv.id, inv.lines[0]!.id, 1));
    expect(cn.taxablePaise).toBe(rupees(900));
    expect(cn.totalPaise).toBe(rupees(945));
    expect(cn.lines[0]!.amountPaise).toBe(rupees(1000)); // the line shows the price; the credit is net of the discount share
  });

  it('credits the last piece exactly, with no paisa lost to rounding', () => {
    const { v } = stocked(10);
    const c = customer();
    const inv = invoices.createInvoice(db, invoiceFor(v.id, { customerId: c.id, discountPaise: 1 }, 3, 1000));
    const line = inv.lines[0]!.id;
    const a = creditNotes.createCreditNote(db, returnOf(inv.id, line, 1));
    const b = creditNotes.createCreditNote(db, returnOf(inv.id, line, 2));
    expect(a.taxablePaise + b.taxablePaise).toBe(inv.taxablePaise);
    // Everything was sent back, so at most the rupee of rounding slack is left either way.
    expect(Math.abs(customers.getCustomer(db, c.id).outstandingPaise - customers.getCustomer(db, c.id).advancePaise)).toBeLessThanOrEqual(100);
  });

  it('refuses to return more than was sold, or the same thing twice over', () => {
    const { v } = stocked(10);
    const c = customer();
    const inv = invoices.createInvoice(db, invoiceFor(v.id, { customerId: c.id }, 2));
    const line = inv.lines[0]!.id;
    expect(() => creditNotes.createCreditNote(db, returnOf(inv.id, line, 3))).toThrow(/only 2 can still be returned/);
    creditNotes.createCreditNote(db, returnOf(inv.id, line, 2));
    expect(() => creditNotes.createCreditNote(db, returnOf(inv.id, line, 1))).toThrow(/already been fully credited/);
    expect(stockOf(v.id)).toBe(10);
  });

  it('refuses a cancelled invoice, a bad date and an empty return', () => {
    const { v } = stocked(10);
    const inv = invoices.createInvoice(db, invoiceFor(v.id));
    expect(() => creditNotes.createCreditNote(db, returnOf(inv.id, inv.lines[0]!.id, 1, { issueDate: '2020-01-01' }))).toThrow(/before its invoice/);
    expect(() => creditNotes.createCreditNote(db, returnOf(inv.id, inv.lines[0]!.id, 1, { lines: [] }))).toThrow(/Choose the items/);
    invoices.cancelInvoice(db, inv.id, 'oops');
    expect(() => creditNotes.createCreditNote(db, returnOf(inv.id, inv.lines[0]!.id))).toThrow(/cancelled/);
  });

  it('leaves damaged pieces off the shelf when told not to restock', () => {
    const { v } = stocked(10);
    const c = customer();
    const inv = invoices.createInvoice(db, invoiceFor(v.id, { customerId: c.id }, 2));
    creditNotes.createCreditNote(db, returnOf(inv.id, inv.lines[0]!.id, 1, { lines: [{ invoiceLineId: inv.lines[0]!.id, qty: 1, restock: false }] }));
    expect(stockOf(v.id)).toBe(8);
  });

  it('a walk in sale has nobody to hold a credit for, so the customer must be refunded', () => {
    const { v } = stocked(10);
    const inv = invoices.createInvoice(db, invoiceFor(v.id, { payment: { amountPaise: rupees(1050), method: 'cash', reference: '' } }));
    const line = inv.lines[0]!.id;
    expect(() => creditNotes.createCreditNote(db, returnOf(inv.id, line))).toThrow(/walk-in invoice/);
    const cn = creditNotes.createCreditNote(db, returnOf(inv.id, line, 1, { refund: { amountPaise: rupees(1050), method: 'cash', reference: '' } }));
    expect(cn.refundPaise).toBe(rupees(1050));
    expect(stockOf(v.id)).toBe(10);
  });

  it('will not cancel an invoice that has a credit note', () => {
    const { v } = stocked(10);
    const c = customer();
    const inv = invoices.createInvoice(db, invoiceFor(v.id, { customerId: c.id }, 2));
    creditNotes.createCreditNote(db, returnOf(inv.id, inv.lines[0]!.id, 1));
    expect(() => invoices.cancelInvoice(db, inv.id, 'no')).toThrow(/credit note/);
  });
});

describe('price adjustments', () => {
  it('credits an amount before tax with GST on top, capped at what the invoice was for', () => {
    const { v } = stocked(10);
    const c = customer();
    const inv = invoices.createInvoice(db, invoiceFor(v.id, { customerId: c.id }, 1, 1000));
    const cn = creditNotes.createCreditNote(db, { invoiceId: inv.id, issueDate: today, kind: 'adjustment', reason: 'Small flaw, agreed discount', notes: '', adjustment: { taxablePaise: rupees(200) } });
    expect(cn.totalPaise).toBe(rupees(210));
    expect(cn.lines[0]!.designName).toBe('Price adjustment');
    expect(stockOf(v.id)).toBe(9); // nothing moves for an adjustment
    expect(customers.getCustomer(db, c.id).outstandingPaise).toBe(rupees(1050 - 210));
    expect(() => creditNotes.createCreditNote(db, { invoiceId: inv.id, issueDate: today, kind: 'adjustment', reason: 'x', notes: '', adjustment: { taxablePaise: rupees(801) } })).toThrow(/At most/);
    expect(() => creditNotes.createCreditNote(db, { invoiceId: inv.id, issueDate: today, kind: 'adjustment', reason: '', notes: '', adjustment: { taxablePaise: rupees(10) } })).toThrow(/Say why/);
  });
});

describe('cancelling a credit note', () => {
  it('takes the pieces off the shelf again and makes the invoice owe the money again', () => {
    const { v } = stocked(10);
    const c = customer();
    const inv = invoices.createInvoice(db, invoiceFor(v.id, { customerId: c.id }, 2));
    const cn = creditNotes.createCreditNote(db, returnOf(inv.id, inv.lines[0]!.id, 1));
    expect(stockOf(v.id)).toBe(9);
    const cancelled = creditNotes.cancelCreditNote(db, cn.id, 'Entered by mistake');
    expect(cancelled.status).toBe('cancelled');
    expect(stockOf(v.id)).toBe(8);
    const after = invoices.getInvoice(db, inv.id);
    expect(after.paidPaise).toBe(0);
    expect(after.lines[0]!.creditedQty).toBe(0);
    const ledger = receivables.customerLedger(db, c.id);
    expect(ledger.entries.map((e) => e.kind)).toEqual(['invoice', 'credit-note', 'credit-note-cancelled']);
    expect(ledger.balancePaise).toBe(rupees(2100));
    expect(ledger.entries.at(-1)!.balancePaise).toBe(rupees(2100));
    expect(() => creditNotes.cancelCreditNote(db, cn.id, '')).toThrow(/already cancelled/);
    // and the number is not reused
    const again = creditNotes.createCreditNote(db, returnOf(inv.id, inv.lines[0]!.id, 1));
    expect(again.number).toMatch(/0002$/);
  });

  it('cannot undo a credit note that money was refunded on', () => {
    const { v } = stocked(10);
    const c = customer();
    const inv = invoices.createInvoice(db, invoiceFor(v.id, { customerId: c.id }));
    payments.recordPayment(db, { customerId: c.id, amountPaise: inv.totalPaise, method: 'cash', reference: '', receivedOn: today, note: '', allocations: [{ invoiceId: inv.id, amountPaise: inv.totalPaise }] });
    const cn = creditNotes.createCreditNote(db, returnOf(inv.id, inv.lines[0]!.id, 1, { refund: { amountPaise: rupees(1050), method: 'cash', reference: '' } }));
    expect(() => creditNotes.cancelCreditNote(db, cn.id, 'x')).toThrow(/paid back/);
  });

  it('keeps credit note payments out of the Payments list', () => {
    const { v } = stocked(10);
    const c = customer();
    const inv = invoices.createInvoice(db, invoiceFor(v.id, { customerId: c.id }));
    const cn = creditNotes.createCreditNote(db, returnOf(inv.id, inv.lines[0]!.id));
    expect(payments.listPayments(db)).toHaveLength(0);
    expect(() => payments.voidPayment(db, creditPaymentId(db, cn.id), 'x')).toThrow(/Cancel the credit note/);
  });
});

function creditPaymentId(database: Db, creditNoteId: string): string {
  return (database.prepare('SELECT id FROM payments WHERE credit_note_id = ?').get(creditNoteId) as { id: string }).id;
}

describe('reports', () => {
  it('leaves collections gross and shows returns beside the sales figures', () => {
    const { v } = stocked(10);
    const c = customer();
    const inv = invoices.createInvoice(db, invoiceFor(v.id, { customerId: c.id }, 2));
    payments.recordPayment(db, { customerId: c.id, amountPaise: rupees(500), method: 'cash', reference: '', receivedOn: today, note: '', allocations: [{ invoiceId: inv.id, amountPaise: rupees(500) }] });
    creditNotes.createCreditNote(db, returnOf(inv.id, inv.lines[0]!.id, 1));
    const sales = reports.salesReport(db, { from: today, to: today });
    expect(sales.invoicedPaise).toBe(rupees(2100));
    expect(sales.collectedPaise).toBe(rupees(500)); // the credit note's bookkeeping payment is not money received
    expect(sales.returns).toMatchObject({ count: 1, totalPaise: rupees(1050), piecesReturned: 1, taxablePaise: rupees(1000), gstPaise: rupees(50) });
    expect(sales.netInvoicedPaise).toBe(rupees(1050));
    // profit lost = taxable 1000 - cost of the restocked piece 400
    expect(sales.returns.profitLostPaise).toBe(rupees(600));
    expect(sales.netGrossProfitPaise).toBe(sales.grossProfitPaise - rupees(600));
  });

  it('nets credit notes out of the GST return and lists them in the register', () => {
    const { v } = stocked(10);
    const c = customer({ name: 'Kanchan', type: 'B2B', gstin: '27AAPFU0939F1ZV', state: 'Maharashtra' });
    const inv = invoices.createInvoice(db, invoiceFor(v.id, { type: 'B2B', customerId: c.id }, 2));
    const cn = creditNotes.createCreditNote(db, returnOf(inv.id, inv.lines[0]!.id, 1));
    const gst = reports.gstReport(db, { from: today, to: today });
    expect(gst.totals.taxablePaise).toBe(rupees(2000));
    expect(gst.creditNotes).toMatchObject({ invoices: 1, taxablePaise: rupees(1000), igstPaise: rupees(50) });
    expect(gst.netTotals).toMatchObject({ taxablePaise: rupees(1000), igstPaise: rupees(50), taxPaise: rupees(50) });
    expect(gst.creditNoteRegister).toHaveLength(1);
    expect(gst.creditNoteRegister[0]).toMatchObject({ number: cn.number, invoiceNumber: inv.number, gstin: '27AAPFU0939F1ZV', ratePercent: 5, totalPaise: rupees(1050), type: 'B2B' });
    creditNotes.cancelCreditNote(db, cn.id, 'x');
    expect(reports.gstReport(db, { from: today, to: today }).creditNotes.invoices).toBe(0);
  });
});
