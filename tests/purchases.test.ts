import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../electron/db/connection';
import * as customers from '../electron/services/customers';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as materials from '../electron/services/materials';
import * as purchases from '../electron/services/purchases';
import * as reports from '../electron/services/reports';
import { saveSettings } from '../electron/services/settings';
import * as suppliers from '../electron/services/suppliers';
import { addDays, setOffInputCredit, todayIso } from '../shared/gst';
import type { PurchaseBillInput, SupplierInput } from '../shared/types';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { state: 'Uttar Pradesh', gstin: '09AAACH7409R1ZZ' });
});

const rupees = (n: number) => n * 100;
const today = todayIso();

const supplierInput = (over: Partial<SupplierInput> = {}): SupplierInput => ({ name: 'Varanasi Silk Traders', gstin: '09AABCK1234M1ZI', phone: '', email: '', address: '', city: 'Varanasi', state: 'Uttar Pradesh', pincode: '', notes: '', ...over });
const supplier = (over: Partial<SupplierInput> = {}) => suppliers.createSupplier(db, supplierInput(over));
/** A supplier in Maharashtra, so its bills carry IGST. */
const otherState = () => supplier({ name: 'Mumbai Zari House', gstin: '27AAPFU0939F1ZV', state: 'Maharashtra', city: 'Mumbai' });

function saree(stock = 0) {
  const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: 'Silk', hsnCode: '5007', description: '', defaultPricePaise: rupees(9800) });
  const v = inventory.createVariant(db, d.id, { color: 'Maroon', size: '6.3 m', sellPricePaise: rupees(9800), baseCostPaise: rupees(1000), reorderLevel: 0, openingStock: stock, bom: [] });
  return { d, v };
}

function bill(supplierId: string, over: Partial<PurchaseBillInput> = {}): PurchaseBillInput {
  return { supplierId, billNumber: 'VST/101', billDate: today, dueDate: addDays(today, 30), notes: '', lines: [{ kind: 'other', description: 'Freight', qty: 1, unitPricePaise: rupees(1000), gstRatePercent: 5 }], ...over };
}

describe('input tax credit set off', () => {
  const heads = (cgstPaise: number, sgstPaise: number, igstPaise: number) => ({ cgstPaise, sgstPaise, igstPaise });

  it('uses IGST credit against IGST first, then CGST, then SGST', () => {
    const r = setOffInputCredit(heads(100, 100, 50), heads(0, 0, 200));
    // 200 of IGST credit: 50 clears the IGST, 100 clears the CGST, and the last 50 goes to SGST.
    expect(r.payable).toEqual(heads(0, 50, 0));
    expect(r.carryForward).toEqual(heads(0, 0, 0));
  });

  it('never lets CGST credit pay SGST (or the other way round), and carries the rest forward', () => {
    const r = setOffInputCredit(heads(0, 100, 0), heads(80, 0, 0));
    expect(r.payable).toEqual(heads(0, 100, 0));
    expect(r.carryForward).toEqual(heads(80, 0, 0));
    const s = setOffInputCredit(heads(100, 0, 0), heads(0, 80, 0));
    expect(s.payable).toEqual(heads(100, 0, 0));
    expect(s.carryForward).toEqual(heads(0, 80, 0));
  });

  it('lets CGST and SGST credit pay IGST once their own head is cleared', () => {
    const r = setOffInputCredit(heads(30, 10, 100), heads(80, 40, 0));
    // CGST credit 80: 30 to CGST, 50 to IGST. SGST credit 40: 10 to SGST, 30 to IGST.
    expect(r.payable).toEqual(heads(0, 0, 20));
    expect(r.carryForward).toEqual(heads(0, 0, 0));
  });

  it('pays everything in cash when there is no credit', () => {
    expect(setOffInputCredit(heads(1, 2, 3), heads(0, 0, 0))).toEqual({ payable: heads(1, 2, 3), carryForward: heads(0, 0, 0) });
  });
});

describe('suppliers', () => {
  it('validates the GSTIN and state, and fills the state in from the GSTIN', () => {
    expect(() => supplier({ gstin: '09AABCK1234M1ZX' })).toThrow(/doesn't look right/);
    expect(() => supplier({ gstin: '27AAPFU0939F1ZV', state: 'Uttar Pradesh' })).toThrow(/registered in Maharashtra/);
    expect(supplier({ name: 'Auto state', gstin: '27AAPFU0939F1ZV', state: '' }).state).toBe('Maharashtra');
    expect(() => supplier({ name: '' })).toThrow(/required/);
  });

  it('cannot be archived while money is owed or held', () => {
    const s = supplier();
    purchases.createBill(db, bill(s.id));
    expect(() => suppliers.archiveSupplier(db, s.id)).toThrow(/still owe/);
    const b = purchases.listBills(db)[0]!;
    purchases.recordSupplierPayment(db, { supplierId: s.id, amountPaise: rupees(1100), method: 'bank', reference: '', paidOn: today, note: '', allocations: [{ billId: b.id, amountPaise: rupees(1050) }] });
    expect(() => suppliers.archiveSupplier(db, s.id)).toThrow(/holding ₹50\.00/);
  });
});

describe('entering a bill', () => {
  it('works out GST by rate, CGST and SGST within the state, and rounds the total to the rupee', () => {
    const s = supplier();
    const b = purchases.createBill(db, bill(s.id, { lines: [{ kind: 'other', description: 'Freight', qty: 1, unitPricePaise: 12345, gstRatePercent: 5 }, { kind: 'other', description: 'Packing', qty: 3, unitPricePaise: 1000, gstRatePercent: 18 }] }));
    expect(b.intraState).toBe(true);
    expect(b.taxSummary.map((g) => g.ratePercent)).toEqual([5, 18]);
    expect(b.taxablePaise).toBe(12345 + 3000);
    expect(b.igstPaise).toBe(0);
    expect(b.cgstPaise + b.sgstPaise).toBe(Math.round((12345 * 5) / 100) + Math.round((3000 * 18) / 100));
    expect(b.totalPaise % 100).toBe(0);
    expect(b.totalPaise - b.roundOffPaise).toBe(b.taxablePaise + b.cgstPaise + b.sgstPaise);
    expect(b.status).toBe('unpaid');
  });

  it('charges IGST for a supplier in another state', () => {
    const s = otherState();
    const b = purchases.createBill(db, bill(s.id));
    expect(b.intraState).toBe(false);
    expect(b).toMatchObject({ igstPaise: rupees(50), cgstPaise: 0, sgstPaise: 0, totalPaise: rupees(1050) });
  });

  it('accepts the total printed on the supplier bill when it is a few rupees off, and refuses a bigger gap', () => {
    const s = supplier();
    const b = purchases.createBill(db, bill(s.id, { billTotalPaise: 105200 }));
    expect(b.totalPaise).toBe(105200);
    expect(b.roundOffPaise).toBe(200);
    expect(() => purchases.createBill(db, bill(s.id, { billNumber: 'VST/102', billTotalPaise: rupees(1100) }))).toThrow(/doesn't match its items/);
  });

  it('brings finished sarees into stock through the ledger, and can update costs', () => {
    const s = supplier();
    const { v } = saree(2);
    const b = purchases.createBill(db, bill(s.id, { updateCosts: true, lines: [{ kind: 'variant', variantId: v.id, qty: 5, unitPricePaise: rupees(1400), gstRatePercent: 5 }] }));
    expect(inventory.getVariant(db, v.id).stock).toBe(7);
    expect(inventory.getVariant(db, v.id).unitCostPaise).toBe(rupees(1400)); // the bill's price is now the cost
    const moves = inventory.listMovements(db, v.id);
    expect(moves[0]).toMatchObject({ delta: 5, reason: 'purchase', unitCostPaise: rupees(1400) });
    expect(moves[0]!.note).toContain('VST/101');
    expect(b.lines[0]).toMatchObject({ kind: 'variant', hsn: '5007', unit: 'pc' });
  });

  it('updates a raw material cost only when asked', () => {
    const s = supplier();
    const zari = materials.createMaterial(db, { name: 'Zari thread', unit: 'kg', unitCostPaise: rupees(9000) });
    const line = { kind: 'material' as const, materialId: zari.id, qty: 2.5, unitPricePaise: rupees(9600), gstRatePercent: 5 };
    purchases.createBill(db, bill(s.id, { lines: [line] }));
    expect(materials.listMaterials(db)[0]!.unitCostPaise).toBe(rupees(9000));
    const b2 = purchases.createBill(db, bill(s.id, { billNumber: 'VST/102', updateCosts: true, lines: [line] }));
    expect(materials.listMaterials(db)[0]!.unitCostPaise).toBe(rupees(9600));
    expect(b2.lines[0]).toMatchObject({ qty: 2.5, unit: 'kg', amountPaise: rupees(24000), description: 'Zari thread' });
  });

  it('refuses GST from a supplier with no GSTIN, and input credit for them', () => {
    const s = supplier({ name: 'Local weaver', gstin: '' });
    expect(() => purchases.createBill(db, bill(s.id))).toThrow(/no GSTIN, so they can't charge GST/);
    const zeroRated = { lines: [{ kind: 'other' as const, description: 'Weaving charges', qty: 1, unitPricePaise: rupees(500), gstRatePercent: 0 }] };
    expect(purchases.createBill(db, bill(s.id, zeroRated)).itcEligible).toBe(false);
    expect(() => purchases.createBill(db, bill(s.id, { ...zeroRated, billNumber: 'W-2', itcEligible: true }))).toThrow(/can't be claimed back/);
  });

  it('checks the details: duplicates, dates, quantities and kinds', () => {
    const s = supplier();
    const { v } = saree();
    purchases.createBill(db, bill(s.id));
    expect(() => purchases.createBill(db, bill(s.id))).toThrow(/already entered bill VST\/101/);
    expect(() => purchases.createBill(db, bill(s.id, { billNumber: 'X', billDate: addDays(today, 3) }))).toThrow(/future/);
    expect(() => purchases.createBill(db, bill(s.id, { billNumber: 'X', dueDate: addDays(today, -3) }))).toThrow(/before the bill date/);
    expect(() => purchases.createBill(db, bill(s.id, { billNumber: 'X', lines: [] }))).toThrow(/at least one/);
    expect(() => purchases.createBill(db, bill(s.id, { billNumber: 'X', lines: [{ kind: 'variant', variantId: v.id, qty: 1.5, unitPricePaise: 100, gstRatePercent: 5 }] }))).toThrow(/whole pieces/);
    expect(() => purchases.createBill(db, bill(s.id, { billNumber: 'X', lines: [{ kind: 'other', qty: 1, unitPricePaise: 100, gstRatePercent: 5 }] }))).toThrow(/describe what it is/);
    expect(() => purchases.createBill(db, bill(s.id, { billNumber: 'X', lines: [{ kind: 'other', description: 'x', qty: 1, unitPricePaise: 100, gstRatePercent: 150 }] }))).toThrow(/between 0 and 100/);
    expect(inventory.getVariant(db, v.id).stock).toBe(0); // nothing half done
  });

  it('lets a cancelled bill number be entered again, corrected', () => {
    const s = supplier();
    const first = purchases.createBill(db, bill(s.id));
    purchases.cancelBill(db, first.id, 'typo');
    expect(purchases.createBill(db, bill(s.id)).billNumber).toBe('VST/101');
  });
});

describe('paying suppliers', () => {
  it('records what was paid with the bill, and shows partly paid and paid', () => {
    const s = supplier();
    const b = purchases.createBill(db, bill(s.id, { paidNow: { amountPaise: rupees(500), method: 'cash', reference: '' } }));
    expect(b).toMatchObject({ paidPaise: rupees(500), status: 'partial' });
    expect(suppliers.getSupplier(db, s.id).outstandingPaise).toBe(rupees(550));
    purchases.recordSupplierPayment(db, { supplierId: s.id, amountPaise: rupees(550), method: 'upi', reference: 'UPI 1', paidOn: today, note: '', allocations: [{ billId: b.id, amountPaise: rupees(550) }] });
    expect(purchases.getBill(db, b.id).status).toBe('paid');
  });

  it('holds an overpayment as an advance and can set it against the next bill', () => {
    const s = supplier();
    const b1 = purchases.createBill(db, bill(s.id));
    purchases.recordSupplierPayment(db, { supplierId: s.id, amountPaise: rupees(2000), method: 'bank', reference: '', paidOn: today, note: '', allocations: [{ billId: b1.id, amountPaise: rupees(1050) }] });
    expect(suppliers.getSupplier(db, s.id)).toMatchObject({ outstandingPaise: 0, advancePaise: rupees(950) });
    const b2 = purchases.createBill(db, bill(s.id, { billNumber: 'VST/102' }));
    expect(purchases.applyAdvanceToBill(db, b2.id)).toMatchObject({ paidPaise: rupees(950), status: 'partial' });
    // The advance is used up now, so asking to apply more is refused rather than silently ignored.
    expect(() => purchases.createBill(db, bill(s.id, { billNumber: 'VST/103', applyAdvancePaise: rupees(999) }))).toThrow(/Only ₹0\.00 of advance/);
    expect(purchases.listBills(db).some((x) => x.billNumber === 'VST/103')).toBe(false);
  });

  it('will not settle more than a bill has left, or another supplier’s bill', () => {
    const s = supplier();
    const other = supplier({ name: 'Other', gstin: '' });
    const b = purchases.createBill(db, bill(s.id));
    const pay = (supplierId: string, amount: number, billId: string, allocate: number) => () => purchases.recordSupplierPayment(db, { supplierId, amountPaise: amount, method: 'cash', reference: '', paidOn: today, note: '', allocations: [{ billId, amountPaise: allocate }] });
    expect(pay(s.id, rupees(2000), b.id, rupees(1051))).toThrow(/only has ₹1,050\.00 left/);
    expect(pay(s.id, rupees(500), b.id, rupees(600))).toThrow(/More is applied/);
    expect(pay(other.id, rupees(500), b.id, rupees(500))).toThrow(/different supplier/);
  });

  it('reverses a payment so the bill is owed again, and the ledger always adds up', () => {
    const s = supplier();
    const b = purchases.createBill(db, bill(s.id));
    const p = purchases.recordSupplierPayment(db, { supplierId: s.id, amountPaise: rupees(1300), method: 'bank', reference: 'NEFT 9', paidOn: today, note: '', allocations: [{ billId: b.id, amountPaise: rupees(1050) }] });
    let ledger = purchases.supplierLedger(db, s.id);
    expect(ledger.entries.map((e) => e.kind)).toEqual(['bill', 'payment']);
    expect(ledger.balancePaise).toBe(-rupees(250)); // they hold 250 of your money
    const now = suppliers.getSupplier(db, s.id);
    expect(ledger.balancePaise).toBe(now.outstandingPaise - now.advancePaise);

    purchases.voidSupplierPayment(db, p.id, 'bounced');
    expect(purchases.getBill(db, b.id)).toMatchObject({ paidPaise: 0, status: 'unpaid' });
    ledger = purchases.supplierLedger(db, s.id);
    expect(ledger.entries.map((e) => e.kind)).toEqual(['bill', 'payment', 'payment-voided']);
    expect(ledger.balancePaise).toBe(rupees(1050));
    expect(ledger.entries.at(-1)!.balancePaise).toBe(ledger.balancePaise);
    expect(() => purchases.voidSupplierPayment(db, p.id, '')).toThrow(/already reversed/);
  });
});

describe('cancelling a bill', () => {
  it('takes the sarees back out of stock and turns payments into an advance', () => {
    const s = supplier();
    const { v } = saree(1);
    const b = purchases.createBill(db, bill(s.id, { lines: [{ kind: 'variant', variantId: v.id, qty: 4, unitPricePaise: rupees(1400), gstRatePercent: 5 }], paidNow: { amountPaise: rupees(1000), method: 'cash', reference: '' } }));
    expect(inventory.getVariant(db, v.id).stock).toBe(5);
    purchases.cancelBill(db, b.id, 'wrong supplier');
    expect(inventory.getVariant(db, v.id).stock).toBe(1);
    expect(purchases.getBill(db, b.id).status).toBe('cancelled');
    expect(suppliers.getSupplier(db, s.id)).toMatchObject({ billedPaise: 0, outstandingPaise: 0, advancePaise: rupees(1000) });
    const ledger = purchases.supplierLedger(db, s.id);
    expect(ledger.entries.map((e) => e.kind)).toEqual(['bill', 'payment', 'bill-cancelled']);
    expect(ledger.balancePaise).toBe(-rupees(1000));
    expect(() => purchases.cancelBill(db, b.id, '')).toThrow(/already cancelled/);
  });

  it('refuses when the pieces have already been sold', () => {
    const s = supplier();
    const { v } = saree();
    const b = purchases.createBill(db, bill(s.id, { lines: [{ kind: 'variant', variantId: v.id, qty: 2, unitPricePaise: rupees(1400), gstRatePercent: 5 }] }));
    invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: v.id, qty: 2, unitPricePaise: rupees(9800) }] });
    expect(() => purchases.cancelBill(db, b.id, '')).toThrow(/already gone from stock/);
    expect(purchases.getBill(db, b.id).status).toBe('unpaid');
    expect(customers.listCustomers(db)).toHaveLength(0);
  });
});

describe('payables', () => {
  it('ages what you owe by how far past due each bill is, and summarises it', () => {
    const s1 = supplier();
    const s2 = supplier({ name: 'Second', gstin: '' });
    const line = (rate: number) => [{ kind: 'other' as const, description: 'Goods', qty: 1, unitPricePaise: rupees(1000), gstRatePercent: rate }];
    purchases.createBill(db, bill(s1.id, { billNumber: 'A', billDate: addDays(today, -100), dueDate: addDays(today, -70), lines: line(5) })); // 61+ days past due
    purchases.createBill(db, bill(s1.id, { billNumber: 'B', billDate: addDays(today, -20), dueDate: addDays(today, -10), lines: line(5) })); // 1 to 30
    purchases.createBill(db, bill(s2.id, { billNumber: 'C', dueDate: addDays(today, 20), lines: line(0) })); // not yet due
    const r = purchases.payablesReport(db);
    expect(r.rows.map((x) => x.supplierName)).toEqual(['Varanasi Silk Traders', 'Second']);
    expect(r).toMatchObject({ days61plusPaise: rupees(1050), days1to30Paise: rupees(1050), currentPaise: rupees(1000), outstandingPaise: rupees(3100), overduePaise: rupees(2100) });
    expect(purchases.purchasesSummary(db)).toMatchObject({ outstandingPaise: rupees(3100), overduePaise: rupees(2100), openBills: 3, supplierCount: 2 });
  });
});

describe('GST return with input credit', () => {
  const b2cSale = (v: string, qty: number, price: number) => invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: v, qty, unitPricePaise: rupees(price) }] });

  it('sets bills\' GST off against the tax on sales, head by head, and shows the cash payable and the carry forward', () => {
    const { v } = saree(10);
    b2cSale(v.id, 1, 10000); // output: CGST 250 + SGST 250
    const local = supplier();
    const far = otherState();
    purchases.createBill(db, bill(local.id, { billNumber: 'L1', lines: [{ kind: 'other', description: 'Goods', qty: 1, unitPricePaise: rupees(2000), gstRatePercent: 5 }] })); // input CGST 50 + SGST 50
    purchases.createBill(db, bill(far.id, { billNumber: 'F1', lines: [{ kind: 'other', description: 'Zari', qty: 1, unitPricePaise: rupees(10000), gstRatePercent: 5 }] })); // input IGST 500

    const r = reports.gstReport(db, { from: today, to: today });
    expect(r.inputCredit).toMatchObject({ bills: 2, cgstPaise: rupees(50), sgstPaise: rupees(50), igstPaise: rupees(500), taxPaise: rupees(600) });
    expect(r.liability.outputTaxPaise).toBe(rupees(500));
    // IGST credit 500 goes to IGST (0), then CGST (250), then SGST (250): everything is covered, and the CGST/SGST credit is left over.
    expect(r.liability.payable).toEqual({ cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 0 });
    expect(r.liability.carryForward).toEqual({ cgstPaise: rupees(50), sgstPaise: rupees(50), igstPaise: 0, totalPaise: rupees(100) });
  });

  it('leaves out bills marked not eligible and bills that were cancelled', () => {
    const s = supplier();
    purchases.createBill(db, bill(s.id, { billNumber: 'N1', itcEligible: false }));
    const gone = purchases.createBill(db, bill(s.id, { billNumber: 'N2' }));
    purchases.cancelBill(db, gone.id, 'x');
    const kept = purchases.createBill(db, bill(s.id, { billNumber: 'N3' }));
    const r = reports.gstReport(db, { from: today, to: today });
    expect(r.inputCredit).toMatchObject({ bills: 1, taxPaise: kept.cgstPaise + kept.sgstPaise });
    expect(r.liability.payable.totalPaise).toBe(0);
  });
});
