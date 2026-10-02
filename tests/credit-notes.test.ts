import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import { LATEST_SCHEMA_VERSION, migrate } from '../electron/db/migrations';
import { accountBook } from '../electron/services/accounts';
import * as credits from '../electron/services/credits';
import * as customers from '../electron/services/customers';
import { dayBook } from '../electron/services/moreReports';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as payments from '../electron/services/payments';
import { customerLedger } from '../electron/services/receivables';
import { gstReport, salesReport } from '../electron/services/reports';
import { saveSettings } from '../electron/services/settings';
import { todayIso } from '../shared/gst';
import type { CreditNoteInput, InvoiceInput, LineInput } from '../shared/types';

const rupees = (n: number) => n * 100;
const today = todayIso();
let db: Db;
let cottonId: string;
let silkId: string;
let customerId: string;

const stock = (variantId: string) => inventory.getVariant(db, variantId).stock;

beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { gstin: '09AABCK1234M1ZI', invoicePrefix: 'MG', state: 'Uttar Pradesh', paymentAccounts: [{ id: 'cash', name: 'Cash drawer', kind: 'cash', details: '', openingPaise: 0 }] });
  const d1 = inventory.createDesign(db, { code: 'MG-001', name: 'Cotton', fabric: '', hsnCode: '5208', description: '', defaultPricePaise: rupees(800) });
  cottonId = inventory.createVariant(db, d1.id, { color: 'Red', size: '6 m', sellPricePaise: rupees(800), baseCostPaise: rupees(300), reorderLevel: 0, openingStock: 20, bom: [] }).id;
  const d2 = inventory.createDesign(db, { code: 'MG-002', name: 'Banarasi', fabric: '', hsnCode: '5007', description: '', defaultPricePaise: rupees(3000), gstRatePercent: 18 });
  silkId = inventory.createVariant(db, d2.id, { color: 'Gold', size: '6 m', sellPricePaise: rupees(3000), baseCostPaise: rupees(1500), reorderLevel: 0, openingStock: 20, bom: [] }).id;
  customerId = customers.createCustomer(db, { name: 'Meena', type: 'B2C', phone: '', email: '', gstin: '', address: '', city: 'Mau', state: 'Uttar Pradesh', pincode: '', notes: '' }).id;
});

const sell = (lines: LineInput[], over: Partial<InvoiceInput> = {}) =>
  invoices.createInvoice(db, { type: 'B2C', customerId, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines, ...over });
const pay = (invoiceId: string, amountPaise: number, cust: string | null = customerId) =>
  payments.recordPayment(db, { customerId: cust, amountPaise, method: 'cash', reference: '', receivedOn: today, note: '', allocations: [{ invoiceId, amountPaise }], accountId: 'cash' });
const lineOf = (invoiceId: string, variantId: string) => invoices.getInvoice(db, invoiceId).lines.find((l) => l.variantId === variantId)!;
const note = (invoiceId: string, picks: { variantId: string; qty: number; restock?: boolean }[], over: Partial<CreditNoteInput> = {}) =>
  credits.createCreditNote(db, {
    invoiceId,
    issueDate: today,
    reason: 'Returned by customer',
    lines: picks.map((p) => ({ invoiceLineId: lineOf(invoiceId, p.variantId).id, qty: p.qty, restock: p.restock ?? true })),
    ...over,
  });

describe('taking part of an unpaid invoice back', () => {
  it('reduces what is owed, puts the pieces back on the shelf, and numbers the note', () => {
    const inv = sell([{ variantId: cottonId, qty: 4, unitPricePaise: rupees(800) }]); // 3200 + 5% = 3360
    expect(inv.totalPaise).toBe(rupees(3360));
    expect(stock(cottonId)).toBe(16);

    const cn = note(inv.id, [{ variantId: cottonId, qty: 1 }]);
    expect(cn.number).toMatch(/^CN\/.*\/0001$/);
    expect(cn).toMatchObject({ totalPaise: rupees(840), taxablePaise: rupees(800), appliedPaise: rupees(840), heldPaise: 0, refundedPaise: 0, reason: 'Returned by customer' });
    expect(cn.lines[0]).toMatchObject({ qty: 1, amountPaise: rupees(800), ratePercent: 5, restocked: true });
    expect(stock(cottonId)).toBe(17);

    const after = invoices.getInvoice(db, inv.id);
    expect(after.paidPaise).toBe(rupees(840)); // the credit counts toward the invoice
    expect(after.creditedPaise).toBe(rupees(840));
    expect(after.credits.map((c) => c.number)).toEqual([cn.number]);
    expect(after.totalPaise - after.paidPaise).toBe(rupees(2520)); // 3 pieces still owed
    expect(credits.nextCreditNoteNumber(db, today)).toMatch(/\/0002$/);
  });

  it('does not put damaged pieces back on the shelf', () => {
    const inv = sell([{ variantId: cottonId, qty: 2, unitPricePaise: rupees(800) }]);
    note(inv.id, [{ variantId: cottonId, qty: 1, restock: false }]);
    expect(stock(cottonId)).toBe(18);
  });

  it('the credit note is never paid out as money, and the money paid for the rest stays untouched', () => {
    const inv = sell([{ variantId: cottonId, qty: 4, unitPricePaise: rupees(800) }]);
    pay(inv.id, rupees(1000));
    note(inv.id, [{ variantId: cottonId, qty: 1 }]);
    const after = invoices.getInvoice(db, inv.id);
    expect(after.paidPaise).toBe(rupees(1840));
    expect(payments.listPayments(db).filter((p) => p.kind === 'receipt').map((p) => p.amountPaise)).toEqual([rupees(1000)]);
  });
});

describe('when the customer has already paid', () => {
  it('asks what to do with the money, and refunds it out of the chosen account', () => {
    const inv = sell([{ variantId: cottonId, qty: 2, unitPricePaise: rupees(800) }]); // 1680
    pay(inv.id, inv.totalPaise);
    expect(credits.previewCreditNote(db, { invoiceId: inv.id, issueDate: today, reason: 'x', lines: [{ invoiceLineId: lineOf(inv.id, cottonId).id, qty: 1, restock: true }] })).toMatchObject({ totalPaise: rupees(840), appliedPaise: 0, leftoverPaise: rupees(840) });
    expect(() => note(inv.id, [{ variantId: cottonId, qty: 1 }])).toThrow(/refund the money or keep it as credit/);
    expect(() => note(inv.id, [{ variantId: cottonId, qty: 1 }], { leftover: 'refund' })).toThrow(/how the refund is being paid/);
    expect(credits.listCreditNotes(db)).toEqual([]); // the failed attempts left nothing behind
    expect(stock(cottonId)).toBe(18);

    const cn = note(inv.id, [{ variantId: cottonId, qty: 1 }], { leftover: 'refund', refund: { method: 'cash', accountId: 'cash' } });
    expect(cn).toMatchObject({ refundedPaise: rupees(840), heldPaise: 0, appliedPaise: 0 });
    const refund = payments.listPayments(db).find((p) => p.kind === 'refund')!;
    expect(refund).toMatchObject({ amountPaise: rupees(840), method: 'cash', accountId: 'cash', creditNoteId: cn.id });

    // money out of the cash drawer, and out of the day's cash
    const cash = accountBook(db, { from: today, to: today }).accounts.find((a) => a.accountId === 'cash')!;
    expect([cash.inPaise, cash.outPaise, cash.closingPaise]).toEqual([inv.totalPaise, rupees(840), inv.totalPaise - rupees(840)]);
    const book = dayBook(db, { from: today, to: today }, 'cash');
    expect(book.entries.map((e) => e.kind)).toEqual(['receipt', 'refund']);
    expect(book.closingPaise).toBe(inv.totalPaise - rupees(840));
    // the customer neither owes nor is owed anything
    expect(customerLedger(db, customerId).balancePaise).toBe(0);
    expect(customers.getCustomer(db, customerId).advancePaise).toBe(0);
  });

  it('can instead keep the money as credit for the next purchase', () => {
    const inv = sell([{ variantId: cottonId, qty: 2, unitPricePaise: rupees(800) }]);
    pay(inv.id, inv.totalPaise);
    const cn = note(inv.id, [{ variantId: cottonId, qty: 1 }], { leftover: 'credit' });
    expect(cn).toMatchObject({ heldPaise: rupees(840), refundedPaise: 0 });
    expect(customers.getCustomer(db, customerId).advancePaise).toBe(rupees(840));
    expect(customerLedger(db, customerId).balancePaise).toBe(-rupees(840)); // the shop owes the customer

    // The credit pays for their next invoice like any advance.
    const next = sell([{ variantId: cottonId, qty: 1, unitPricePaise: rupees(800) }]);
    expect(payments.applyAdvance(db, customerId, next.id, next.totalPaise)).toBe(rupees(840));
    expect(invoices.getInvoice(db, next.id).status).toBe('paid');
    expect(customers.getCustomer(db, customerId).advancePaise).toBe(0);
  });

  it('a walk-in sale can only be refunded: there is nobody to hold credit for', () => {
    const inv = sell([{ variantId: cottonId, qty: 1, unitPricePaise: rupees(800) }], { customerId: null, buyerName: 'Anita' });
    pay(inv.id, inv.totalPaise, null);
    expect(() => note(inv.id, [{ variantId: cottonId, qty: 1 }], { leftover: 'credit' })).toThrow(/saved customer/);
    const cn = note(inv.id, [{ variantId: cottonId, qty: 1 }], { leftover: 'refund', refund: { method: 'cash' } });
    expect(cn.refundedPaise).toBe(inv.totalPaise);
  });

  it('splits a note between clearing what is owed and refunding the rest', () => {
    const inv = sell([{ variantId: cottonId, qty: 4, unitPricePaise: rupees(800) }]); // 3360
    pay(inv.id, rupees(3000)); // 360 still owed
    const cn = note(inv.id, [{ variantId: cottonId, qty: 1 }], { leftover: 'refund', refund: { method: 'upi' } }); // 840 credit
    expect(cn).toMatchObject({ appliedPaise: rupees(360), refundedPaise: rupees(480) });
    expect(invoices.getInvoice(db, inv.id).status).toBe('paid');
  });
});

describe('returns in parts always add up to the invoice', () => {
  it('a multi-rate invoice with discounts, returned a piece at a time, credits exactly what was charged', () => {
    saveSettings(db, { roundOff: 'nearest' });
    const inv = sell(
      [
        { variantId: cottonId, qty: 3, unitPricePaise: 77777, discountPaise: 1234 },
        { variantId: silkId, qty: 2, unitPricePaise: 301333 },
      ],
      { discountPaise: 4567 },
    );
    pay(inv.id, inv.totalPaise);
    const totals = { taxable: 0, cgst: 0, sgst: 0, total: 0 };
    const all_ = [
      [cottonId, 1], [silkId, 1], [cottonId, 2], [silkId, 1],
    ] as const;
    for (const [v, q] of all_) {
      const cn = note(inv.id, [{ variantId: v, qty: q }], { leftover: 'credit' });
      totals.taxable += cn.taxablePaise;
      totals.cgst += cn.cgstPaise;
      totals.sgst += cn.sgstPaise;
      totals.total += cn.totalPaise;
    }
    // CGST and SGST are each note's tax split in two, so across several notes they can differ from the invoice's own split by a paisa
    // a note; the tax as a whole, the taxable value and the money never do.
    expect(totals.taxable).toBe(inv.taxablePaise);
    expect(totals.total).toBe(inv.totalPaise);
    expect(totals.cgst + totals.sgst).toBe(inv.cgstPaise + inv.sgstPaise);
    expect(Math.abs(totals.cgst - inv.cgstPaise)).toBeLessThanOrEqual(all_.length);
    expect(credits.returnableLines(db, inv.id).every((l) => l.remainingQty === 0)).toBe(true);
    expect(() => note(inv.id, [{ variantId: cottonId, qty: 1 }], { leftover: 'credit' })).toThrow(/already been taken back in full/);
  });

  it('works for prices that include GST, and with the other rounding choices', () => {
    for (const roundOff of ['up', 'down', 'none'] as const) {
      saveSettings(db, { pricesIncludeGst: true, roundOff });
      const inv = sell([{ variantId: cottonId, qty: 3, unitPricePaise: 99999 }, { variantId: silkId, qty: 1, unitPricePaise: 123457 }]);
      let sum = 0;
      for (const [v, q] of [[cottonId, 1], [cottonId, 2], [silkId, 1]] as const) sum += note(inv.id, [{ variantId: v, qty: q }], { leftover: 'credit' }).totalPaise;
      expect(sum).toBe(inv.totalPaise);
    }
  });

  it('a note for the whole invoice is worth exactly the invoice, round-off and all', () => {
    const inv = sell([{ variantId: cottonId, qty: 1, unitPricePaise: 77777 }]);
    const cn = note(inv.id, [{ variantId: cottonId, qty: 1 }]);
    expect(cn.totalPaise).toBe(inv.totalPaise);
    expect(cn.roundOffPaise).toBe(inv.roundOffPaise);
    expect(invoices.getInvoice(db, inv.id).status).toBe('paid'); // nothing owed any more
  });
});

describe('what a credit note will not do', () => {
  it('refuses bad input in plain words', () => {
    const inv = sell([{ variantId: cottonId, qty: 2, unitPricePaise: rupees(800) }]);
    const id = lineOf(inv.id, cottonId).id;
    const base: CreditNoteInput = { invoiceId: inv.id, issueDate: today, reason: 'Returned', lines: [{ invoiceLineId: id, qty: 1, restock: true }] };
    expect(() => credits.createCreditNote(db, { ...base, reason: ' ' })).toThrow(/reason is required/i);
    expect(() => credits.createCreditNote(db, { ...base, lines: [] })).toThrow(/at least one item/);
    expect(() => credits.createCreditNote(db, { ...base, lines: [{ invoiceLineId: id, qty: 3, restock: true }] })).toThrow(/Only 2 of/);
    expect(() => credits.createCreditNote(db, { ...base, lines: [{ invoiceLineId: id, qty: 0, restock: true }] })).toThrow(/1 or more/);
    expect(() => credits.createCreditNote(db, { ...base, lines: [{ invoiceLineId: id, qty: 1, restock: true }, { invoiceLineId: id, qty: 1, restock: true }] })).toThrow(/listed twice/);
    expect(() => credits.createCreditNote(db, { ...base, lines: [{ invoiceLineId: 'nope', qty: 1, restock: true }] })).toThrow(/not on/);
    expect(() => credits.createCreditNote(db, { ...base, issueDate: '2999-01-01' })).toThrow(/future/);
    expect(() => credits.createCreditNote(db, { ...base, issueDate: '2020-01-01' })).toThrow(/before the invoice/);
    expect(() => credits.createCreditNote(db, { ...base, invoiceId: 'nope' })).toThrow(/no longer exists/);
    expect(credits.listCreditNotes(db)).toEqual([]);
  });

  it('does not credit a cancelled invoice, and an invoice with credit notes can no longer be cancelled', () => {
    const a = sell([{ variantId: cottonId, qty: 1, unitPricePaise: rupees(800) }]);
    invoices.cancelInvoice(db, a.id, 'wrong');
    expect(() => note(a.id, [{ variantId: cottonId, qty: 1 }])).toThrow(/cancelled/);
    const b = sell([{ variantId: cottonId, qty: 2, unitPricePaise: rupees(800) }]);
    const cn = note(b.id, [{ variantId: cottonId, qty: 1 }]);
    expect(() => invoices.cancelInvoice(db, b.id, 'oops')).toThrow(/credit notes against it/);
    expect(() => invoices.cancelInvoice(db, b.id, 'oops')).toThrow(cn.number);
  });

  it('cannot be undone by reversing the credit it created', () => {
    const inv = sell([{ variantId: cottonId, qty: 2, unitPricePaise: rupees(800) }]);
    note(inv.id, [{ variantId: cottonId, qty: 1 }]);
    const credit = payments.listPayments(db).find((p) => p.kind === 'credit')!;
    expect(() => payments.voidPayment(db, credit.id, 'mistake')).toThrow(/cannot be undone/);
  });
});

describe('refunding money a customer is holding', () => {
  it('hands back an advance, oldest first, and can be reversed', () => {
    payments.recordPayment(db, { customerId, amountPaise: rupees(1000), method: 'upi', reference: '', receivedOn: today, note: '', allocations: [] });
    payments.recordPayment(db, { customerId, amountPaise: rupees(500), method: 'cash', reference: '', receivedOn: today, note: '', allocations: [] });
    expect(customers.getCustomer(db, customerId).advancePaise).toBe(rupees(1500));

    const made = payments.refundAdvance(db, { customerId, amountPaise: rupees(1200), method: 'bank', date: today, accountId: 'cash', note: 'changed her mind' });
    expect(made.map((p) => p.amountPaise)).toEqual([rupees(1000), rupees(200)]); // oldest money first
    expect(made.every((p) => p.kind === 'refund' && !!p.refundOf)).toBe(true);
    expect(customers.getCustomer(db, customerId).advancePaise).toBe(rupees(300));
    expect(payments.advanceHeld(db, customerId)).toBe(rupees(300));

    // a payment with part of it refunded cannot be reversed until the refund is
    const first = payments.getPayment(db, made[0]!.refundOf!);
    expect(first.refundedPaise).toBe(rupees(1000));
    expect(() => payments.voidPayment(db, first.id, 'x')).toThrow(/Reverse the refund first/);

    payments.voidPayment(db, made[1]!.id, 'entered twice');
    expect(customers.getCustomer(db, customerId).advancePaise).toBe(rupees(500));
  });

  it('refuses more than is held, nothing held, and a walk-in', () => {
    expect(() => payments.refundAdvance(db, { customerId, amountPaise: 100, method: 'cash', date: today })).toThrow(/not holding any/);
    payments.recordPayment(db, { customerId, amountPaise: rupees(100), method: 'cash', reference: '', receivedOn: today, note: '', allocations: [] });
    expect(() => payments.refundAdvance(db, { customerId, amountPaise: rupees(101), method: 'cash', date: today })).toThrow(/holding ₹100/);
    expect(() => payments.refundAdvance(db, { customerId: 'nobody', amountPaise: 100, method: 'cash', date: today })).toThrow(/no longer exists/);
  });
});

describe('credit notes in the books', () => {
  it('come off sales, profit, GST and the register, with a register of their own', () => {
    const inv = sell([{ variantId: cottonId, qty: 4, unitPricePaise: rupees(800) }, { variantId: silkId, qty: 2, unitPricePaise: rupees(3000) }]);
    const cn = note(inv.id, [{ variantId: cottonId, qty: 1 }, { variantId: silkId, qty: 1 }]);
    const range = { from: today, to: today };

    const sales = salesReport(db, range);
    expect(sales).toMatchObject({ creditNoteCount: 1, creditNotePaise: cn.totalPaise, invoicedPaise: inv.totalPaise - cn.totalPaise, taxablePaise: inv.taxablePaise - cn.taxablePaise, piecesSold: 6 - 2 });
    // profit: taxable less the cost of what was kept (3 cotton at 300, 1 silk at 1500)
    expect(sales.grossProfitPaise).toBe(sales.taxablePaise - (3 * rupees(300) + rupees(1500)));
    expect(sales.series.reduce((s, p) => s + p.invoicedPaise, 0)).toBe(inv.totalPaise - cn.totalPaise);

    const gst = gstReport(db, range);
    const tax = (i: { cgstPaise: number; sgstPaise: number }) => i.cgstPaise + i.sgstPaise;
    expect(gst.totals.taxablePaise).toBe(inv.taxablePaise - cn.taxablePaise);
    expect(gst.totals.taxPaise).toBe(tax(inv) - tax(cn));
    expect(gst.totals.invoiceValuePaise).toBe(inv.totalPaise - cn.totalPaise);
    expect(gst.credits).toMatchObject({ count: 1, taxablePaise: cn.taxablePaise, taxPaise: tax(cn), valuePaise: cn.totalPaise });
    expect(gst.hsn.reduce((s, h) => s + h.taxablePaise, 0)).toBe(gst.totals.taxablePaise);
    expect(gst.hsn.reduce((s, h) => s + h.taxPaise, 0)).toBe(gst.totals.taxPaise);
    expect(gst.b2cByState.reduce((s, r) => s + r.taxablePaise, 0)).toBe(gst.totals.taxablePaise);
    expect(gst.creditNoteRegister.map((r) => [r.number, r.invoiceNumber, r.ratePercent, r.totalPaise])).toEqual([
      [cn.number, inv.number, 5, cn.totalPaise],
      [cn.number, inv.number, 18, 0],
    ]);
  });

  it('show on the customer ledger and the day book', () => {
    const inv = sell([{ variantId: cottonId, qty: 2, unitPricePaise: rupees(800) }]);
    const cn = note(inv.id, [{ variantId: cottonId, qty: 1 }]);
    const ledger = customerLedger(db, customerId);
    expect(ledger.entries.map((e) => e.kind)).toEqual(['invoice', 'credit-note']);
    expect(ledger).toMatchObject({ billedPaise: inv.totalPaise, creditedPaise: cn.totalPaise, balancePaise: inv.totalPaise - cn.totalPaise });
    expect(ledger.entries[1]!.description).toContain(cn.number);

    const book = dayBook(db, { from: today, to: today }, 'all');
    expect(book.entries.map((e) => e.kind)).toEqual(['sale', 'credit-note']);
    expect(book.invoicedPaise).toBe(inv.totalPaise - cn.totalPaise);
  });

  it('go through the typed API and are written to the activity log', async () => {
    const api = createApi(db);
    const inv = sell([{ variantId: cottonId, qty: 2, unitPricePaise: rupees(800) }]);
    const returnable = await api.creditNoteReturnable(inv.id);
    expect(returnable[0]).toMatchObject({ qty: 2, creditedQty: 0, remainingQty: 2, ratePercent: 5 });
    const made = await api.creditNoteCreate({ invoiceId: inv.id, issueDate: today, reason: 'Wrong colour', lines: [{ invoiceLineId: returnable[0]!.invoiceLineId, qty: 1, restock: true }] });
    expect((await api.creditNoteGet(made.id)).number).toBe(made.number);
    expect((await api.creditNotesList({ invoiceId: inv.id })).map((c) => c.number)).toEqual([made.number]);
    expect((await api.creditNotesList({ search: 'wrong colour' })).length).toBe(1);
    expect((await api.auditList())[0]).toMatchObject({ label: 'Issued a credit note', entityType: 'invoice', entityId: inv.id });
    await expect(api.creditNotePrint(made.id)).rejects.toThrow(/desktop app/);
  });
});

describe('older books', () => {
  it('credits an invoice made before lines kept their own tax, using the invoice\'s figures', () => {
    const old = new DatabaseSync(':memory:');
    old.exec('PRAGMA foreign_keys = ON');
    migrate(old, 14);
    const t = '2026-09-01T10:00:00.000Z';
    old.exec(`
      INSERT INTO designs (id, code, name, hsn_code, created_at, updated_at) VALUES ('d1', 'MG-001', 'Butidar', '5007', '${t}', '${t}');
      INSERT INTO variants (id, design_id, sku, color, size, stock, created_at, updated_at) VALUES ('v1', 'd1', 'MG-001-RED', 'Red', '6 m', 5, '${t}', '${t}');
      INSERT INTO invoices (id, number, fy, seq, type, seller_json, buyer_json, place_of_supply, issue_date, gst_rate_percent, intra_state, subtotal_paise, discount_paise, taxable_paise, cgst_paise, sgst_paise, round_off_paise, total_paise, created_at, updated_at)
        VALUES ('i1', 'MG/2026-27/0001', '2026-27', 1, 'B2C', '{}', '{"name":"Sunita","gstin":""}', 'Uttar Pradesh', '2026-09-01', 12, 1, 300000, 0, 300000, 18000, 18000, 0, 336000, '${t}', '${t}');
      INSERT INTO invoice_lines (id, invoice_id, variant_id, position, design_name, color, size, sku, hsn, qty, unit_price_paise, amount_paise, unit_cost_paise, gst_rate_percent)
        VALUES ('l1', 'i1', 'v1', 0, 'Butidar', 'Red', '6 m', 'MG-001-RED', '5007', 3, 100000, 300000, 40000, 12);
    `);
    migrate(old);
    const book = old as unknown as Db;
    const cn = credits.createCreditNote(book, { invoiceId: 'i1', issueDate: '2026-09-02', reason: 'Returned', lines: [{ invoiceLineId: 'l1', qty: 1, restock: true }] });
    expect(cn).toMatchObject({ taxablePaise: 100000, cgstPaise: 6000, sgstPaise: 6000, totalPaise: 112000, appliedPaise: 112000 });
    expect(inventory.getVariant(book, 'v1').stock).toBe(6);
    const rest = credits.createCreditNote(book, { invoiceId: 'i1', issueDate: '2026-09-02', reason: 'Returned', lines: [{ invoiceLineId: 'l1', qty: 2, restock: true }] });
    expect(cn.totalPaise + rest.totalPaise).toBe(336000);
  });

  it('keeps every payment, allocation and kind when the payments table is rebuilt', () => {
    const old = new DatabaseSync(':memory:');
    old.exec('PRAGMA foreign_keys = ON');
    migrate(old, 14);
    const t = '2026-09-01T10:00:00.000Z';
    old.exec(`
      INSERT INTO customers (id, name, type, created_at, updated_at) VALUES ('c1', 'Sunita', 'B2C', '${t}', '${t}');
      INSERT INTO invoices (id, number, fy, seq, type, customer_id, seller_json, buyer_json, place_of_supply, issue_date, gst_rate_percent, intra_state, subtotal_paise, taxable_paise, total_paise, created_at, updated_at)
        VALUES ('i1', 'MG/2026-27/0001', '2026-27', 1, 'B2C', 'c1', '{}', '{}', 'UP', '2026-09-01', 5, 1, 100000, 100000, 105000, '${t}', '${t}');
      INSERT INTO payments (id, customer_id, amount_paise, method, received_on, kind, account_id, created_at, updated_at, cheque_date, cheque_status)
        VALUES ('p1', 'c1', 60000, 'cheque', '2026-09-01', 'receipt', 'bank', '${t}', '${t}', '2026-09-05', 'pending'),
               ('p2', 'c1', 5000, 'other', '2026-09-01', 'writeoff', '', '${t}', '${t}', NULL, NULL);
      INSERT INTO payment_allocations (id, payment_id, invoice_id, amount_paise, created_at) VALUES ('a1', 'p1', 'i1', 60000, '${t}'), ('a2', 'p2', 'i1', 5000, '${t}');
    `);
    migrate(old);
    expect((old.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(LATEST_SCHEMA_VERSION);
    expect(old.prepare('SELECT id, kind, amount_paise, account_id, cheque_status, credit_note_id, refund_of FROM payments ORDER BY id').all().map((r) => ({ ...r }))).toEqual([
      { id: 'p1', kind: 'receipt', amount_paise: 60000, account_id: 'bank', cheque_status: 'pending', credit_note_id: null, refund_of: null },
      { id: 'p2', kind: 'writeoff', amount_paise: 5000, account_id: '', cheque_status: null, credit_note_id: null, refund_of: null },
    ]);
    expect(old.prepare('SELECT COUNT(*) AS n FROM payment_allocations').get()).toEqual({ n: 2 });
    expect(old.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    // the new kinds are accepted, and an unknown one still is not
    old.exec(`INSERT INTO payments (id, amount_paise, method, received_on, kind, created_at, updated_at) VALUES ('p3', 100, 'cash', '2026-09-02', 'refund', '${t}', '${t}')`);
    expect(() => old.exec(`INSERT INTO payments (id, amount_paise, method, received_on, kind, created_at, updated_at) VALUES ('p4', 100, 'cash', '2026-09-02', 'gift', '${t}', '${t}')`)).toThrow();
    // the payments an allocation points at are still found (the foreign key survived the swap)
    expect(() => old.exec(`INSERT INTO payment_allocations (id, payment_id, invoice_id, amount_paise, created_at) VALUES ('a9', 'ghost', 'i1', 1, '${t}')`)).toThrow();
  });
});
