import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../electron/db/connection';
import * as customers from '../electron/services/customers';
import * as expenses from '../electron/services/expenses';
import * as inventory from '../electron/services/inventory';
import { notifications } from '../electron/services/notifications';
import * as proformas from '../electron/services/proformas';
import { saveSettings } from '../electron/services/settings';
import * as weaver from '../electron/services/weaverOrders';
import { addDays, financialYear, todayIso } from '../shared/gst';
import type { WeaverOrderInput } from '../shared/types';

const rupees = (n: number) => n * 100;
const today = todayIso();
let db: Db;
let red: string;
let blue: string;
let vendorId: string;

beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { gstin: '09AABCK1234M1ZI' });
  const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: '', hsnCode: '5007', description: '', defaultPricePaise: rupees(1000) });
  const mk = (color: string, stock: number) => inventory.createVariant(db, d.id, { color, size: '6 m', sellPricePaise: rupees(20000), baseCostPaise: rupees(12000), reorderLevel: 0, openingStock: stock, bom: [] }).id;
  red = mk('Red', 0);
  blue = mk('Blue', 1);
  vendorId = expenses.createVendor(db, { name: 'Ramesh Weaver', phone: '', gstin: '', address: '', notes: '' }).id;
});

const order = (over: Partial<WeaverOrderInput> = {}) =>
  weaver.createWeaverOrder(db, {
    vendorId,
    orderedOn: today,
    expectedOn: addDays(today, 20),
    note: '',
    lines: [
      { variantId: red, qty: 3, unitCostPaise: rupees(12000) },
      { variantId: blue, qty: 1, unitCostPaise: rupees(11000) },
    ],
    ...over,
  });
const stock = (id: string) => inventory.getVariant(db, id).stock;

describe('placing an order', () => {
  it('numbers orders by financial year, remembers what each line was when ordered, and totals them', () => {
    const a = order();
    const b = order();
    expect(a.number).toBe(`WO/${financialYear(today)}/0001`);
    expect(b.number).toBe(`WO/${financialYear(today)}/0002`);
    expect(a).toMatchObject({ status: 'open', pieces: 4, receivedPieces: 0, totalPaise: rupees(47000), paidPaise: 0, vendorName: 'Ramesh Weaver', late: false });
    expect(a.lines.map((l) => [l.designName, l.color, l.qty, l.amountPaise])).toEqual([['Butidar', 'Red', 3, rupees(36000)], ['Butidar', 'Blue', 1, rupees(11000)]]);
  });

  it('refuses a missing weaver, an empty order, the same saree twice and dates that make no sense', () => {
    expect(() => order({ vendorId: 'nobody' })).toThrow(/Choose the weaver/);
    expect(() => order({ lines: [] })).toThrow(/at least one saree/);
    expect(() => order({ lines: [{ variantId: red, qty: 1, unitCostPaise: 0 }, { variantId: red, qty: 2, unitCostPaise: 0 }] })).toThrow(/twice/);
    expect(() => order({ lines: [{ variantId: red, qty: 0, unitCostPaise: 0 }] })).toThrow(/Quantity/);
    expect(() => order({ orderedOn: addDays(today, 3) })).toThrow(/not in the future/);
    expect(() => order({ expectedOn: addDays(today, -5) })).toThrow(/on or after/);
  });

  it('is late once the expected day has passed with pieces still to come', () => {
    const o = order({ orderedOn: addDays(today, -30), expectedOn: addDays(today, -2) });
    expect(weaver.listWeaverOrders(db).find((x) => x.id === o.id)!.late).toBe(true);
    weaver.receiveWeaverOrder(db, o.id, { receivedOn: today, lines: o.lines.map((l) => ({ lineId: l.id, qty: l.qty })) });
    expect(weaver.listWeaverOrders(db).find((x) => x.id === o.id)!.late).toBe(false);
  });
});

describe('receiving', () => {
  it('adds the pieces to stock through the ledger, part by part, and leaves the cost price alone', () => {
    const o = order();
    const red1 = o.lines[0]!;
    const part = weaver.receiveWeaverOrder(db, o.id, { receivedOn: today, lines: [{ lineId: red1.id, qty: 2 }] });
    expect(part).toMatchObject({ status: 'partial', receivedPieces: 2 });
    expect(stock(red)).toBe(2);
    expect(inventory.listMovements(db, red)[0]).toMatchObject({ reason: 'purchase', delta: 2, balanceAfter: 2, note: `Weaver order ${o.number}` });
    expect(inventory.getVariant(db, red).baseCostPaise).toBe(rupees(12000));

    const rest = weaver.receiveWeaverOrder(db, o.id, { receivedOn: today, lines: [{ lineId: red1.id, qty: 1 }, { lineId: o.lines[1]!.id, qty: 1 }] });
    expect(rest).toMatchObject({ status: 'received', receivedPieces: 4 });
    expect(stock(red)).toBe(3);
    expect(stock(blue)).toBe(2);
    expect(rest.receipts.map((r) => r.qty)).toEqual([2, 1, 1]);
  });

  it('refuses more than is still to come, nothing at all, a future day or a cancelled order, and changes nothing when refused', () => {
    const o = order();
    const [a, b] = o.lines;
    expect(() => weaver.receiveWeaverOrder(db, o.id, { receivedOn: today, lines: [{ lineId: a!.id, qty: 1 }, { lineId: b!.id, qty: 5 }] })).toThrow(/only 1 more is still to come/);
    expect(stock(red)).toBe(0);
    expect(() => weaver.receiveWeaverOrder(db, o.id, { receivedOn: today, lines: [] })).toThrow(/at least one/);
    expect(() => weaver.receiveWeaverOrder(db, o.id, { receivedOn: addDays(today, 2), lines: [{ lineId: a!.id, qty: 1 }] })).toThrow(/not in the future/);
    weaver.cancelWeaverOrder(db, o.id, 'Changed mind');
    expect(() => weaver.receiveWeaverOrder(db, o.id, { receivedOn: today, lines: [{ lineId: a!.id, qty: 1 }] })).toThrow(/is cancelled/);
  });
});

describe('paying the weaver', () => {
  it('records advance and balance, and each payment is an expense that counts in the books', () => {
    const o = order();
    const after = weaver.payWeaverOrder(db, o.id, { paidOn: today, amountPaise: rupees(20000), method: 'bank', reference: 'UTR123' });
    expect(after).toMatchObject({ totalPaise: rupees(47000), paidPaise: rupees(20000) });
    const [expense] = expenses.listExpenses(db, { category: 'Weaver payments' });
    expect(expense).toMatchObject({ amountPaise: rupees(20000), vendor: 'Ramesh Weaver', reference: 'UTR123', status: 'paid', note: `Weaver order ${o.number}` });
    weaver.payWeaverOrder(db, o.id, { paidOn: today, amountPaise: rupees(27000), method: 'cash' });
    expect(weaver.getWeaverOrder(db, o.id).paidPaise).toBe(rupees(47000));
  });

  it('refuses paying more than the balance, or anything before a price is agreed', () => {
    const o = order();
    expect(() => weaver.payWeaverOrder(db, o.id, { paidOn: today, amountPaise: rupees(47001), method: 'cash' })).toThrow(/more than the .* still to pay/);
    const free = order({ lines: [{ variantId: red, qty: 1, unitCostPaise: 0 }] });
    expect(() => weaver.payWeaverOrder(db, free.id, { paidOn: today, amountPaise: 100, method: 'cash' })).toThrow(/price per piece/);
    expect(() => weaver.payWeaverOrder(db, o.id, { paidOn: today, amountPaise: 100, method: 'crypto' as never })).toThrow(/how it was paid/);
  });

  it('takes a payment back, which removes its expense and frees the balance', () => {
    const o = order();
    const paid = weaver.payWeaverOrder(db, o.id, { paidOn: today, amountPaise: rupees(10000), method: 'upi' });
    const back = weaver.voidWeaverPayment(db, paid.payments[0]!.id);
    expect(back.paidPaise).toBe(0);
    expect(back.payments[0]!.voidedAt).not.toBeNull();
    expect(expenses.listExpenses(db, { category: 'Weaver payments' })).toHaveLength(0);
    expect(() => weaver.voidWeaverPayment(db, paid.payments[0]!.id)).toThrow(/already taken back/);
  });
});

describe('changing and cancelling', () => {
  it('lets quantities, prices and lines change, but never below what has arrived', () => {
    const o = order();
    weaver.receiveWeaverOrder(db, o.id, { receivedOn: today, lines: [{ lineId: o.lines[0]!.id, qty: 2 }] });
    const [a, b] = o.lines;
    expect(() => weaver.updateWeaverOrder(db, o.id, { vendorId, orderedOn: today, note: '', lines: [{ id: a!.id, variantId: red, qty: 1, unitCostPaise: 0 }] })).toThrow(/2 received already/);
    expect(() => weaver.updateWeaverOrder(db, o.id, { vendorId, orderedOn: today, note: '', lines: [{ id: b!.id, variantId: blue, qty: 1, unitCostPaise: 0 }] })).toThrow(/can't be removed/);
    const changed = weaver.updateWeaverOrder(db, o.id, { vendorId, orderedOn: today, note: 'Rush', lines: [{ id: a!.id, variantId: red, qty: 5, unitCostPaise: rupees(13000) }, { id: b!.id, variantId: blue, qty: 1, unitCostPaise: rupees(11000) }] });
    expect(changed).toMatchObject({ note: 'Rush', pieces: 6, totalPaise: rupees(76000) });
  });

  it('keeps the weaver fixed once money has been paid, and cancels only an order with nothing received or paid', () => {
    const o = order();
    const other = expenses.createVendor(db, { name: 'Suresh', phone: '', gstin: '', address: '', notes: '' }).id;
    const paid = weaver.payWeaverOrder(db, o.id, { paidOn: today, amountPaise: rupees(5000), method: 'cash' });
    const sameLines = o.lines.map((l) => ({ id: l.id, variantId: l.variantId, qty: l.qty, unitCostPaise: l.unitCostPaise }));
    expect(() => weaver.updateWeaverOrder(db, o.id, { vendorId: other, orderedOn: today, note: '', lines: sameLines })).toThrow(/weaver can't be changed/);
    expect(() => weaver.cancelWeaverOrder(db, o.id, '')).toThrow(/Take those payments back/);
    weaver.voidWeaverPayment(db, paid.payments[0]!.id);
    expect(weaver.cancelWeaverOrder(db, o.id, 'Customer cancelled')).toMatchObject({ status: 'cancelled', cancelReason: 'Customer cancelled' });

    const arrived = order();
    weaver.receiveWeaverOrder(db, arrived.id, { receivedOn: today, lines: [{ lineId: arrived.lines[0]!.id, qty: 1 }] });
    expect(() => weaver.cancelWeaverOrder(db, arrived.id, '')).toThrow(/can't be cancelled/);
  });
});

describe('ordering for a customer quote', () => {
  let customerId: string;
  beforeEach(() => {
    customerId = customers.createCustomer(db, { name: 'Meena', type: 'B2C', phone: '', email: '', gstin: '', address: '', city: '', state: '', pincode: '', notes: '' }).id;
  });
  const quote = (lines: { variantId: string; qty: number }[]) =>
    proformas.createProforma(db, { type: 'B2C', customerId, issueDate: today, validUntil: addDays(today, 15), discountPaise: 0, notes: '', lines: lines.map((l) => ({ ...l, unitPricePaise: rupees(20000) })) });

  it('starts an order from what the quote is short of, counting stock and what is already ordered', () => {
    const q = quote([{ variantId: red, qty: 3 }, { variantId: blue, qty: 1 }]); // red: 0 in stock, blue: 1 in stock
    const draft = weaver.draftFromQuote(db, q.id);
    expect(draft.lines).toEqual([{ variantId: red, qty: 3, unitCostPaise: rupees(12000) }]);
    expect(draft.note).toBe(`For quote ${q.number}`);

    order({ proformaId: q.id, lines: [{ variantId: red, qty: 2, unitCostPaise: rupees(12000) }] });
    expect(weaver.draftFromQuote(db, q.id).lines).toEqual([{ variantId: red, qty: 1, unitCostPaise: rupees(12000) }]);

    order({ proformaId: q.id, lines: [{ variantId: red, qty: 1, unitCostPaise: rupees(12000) }] });
    expect(() => weaver.draftFromQuote(db, q.id)).toThrow(/in stock or already on order/);
  });

  it('lists the orders made for a quote, and brings the weaver in when every short saree has the same supplier', () => {
    const q = quote([{ variantId: red, qty: 2 }]);
    const design = inventory.listDesigns(db)[0]!;
    inventory.updateDesign(db, design.id, { code: design.code, name: design.name, fabric: '', hsnCode: '5007', description: '', defaultPricePaise: 0, supplierId: vendorId });
    expect(weaver.draftFromQuote(db, q.id).vendorId).toBe(vendorId);
    const o = order({ proformaId: q.id });
    expect(weaver.listWeaverOrders(db, { proformaId: q.id }).map((x) => x.id)).toEqual([o.id]);
    expect(o.proformaNumber).toBe(q.number);
  });
});

describe('notifications', () => {
  it('points out an order that is late, and goes away when it arrives', () => {
    const o = order({ orderedOn: addDays(today, -30), expectedOn: addDays(today, -2) });
    const late = notifications(db).find((n) => n.kind === 'weaver-late');
    expect(late).toMatchObject({ title: '1 weaver order late', link: { to: 'path', path: '/inventory/weaver-orders' } });
    expect(late!.detail).toContain('Ramesh Weaver');
    weaver.receiveWeaverOrder(db, o.id, { receivedOn: today, lines: o.lines.map((l) => ({ lineId: l.id, qty: l.qty })) });
    expect(notifications(db).some((n) => n.kind === 'weaver-late')).toBe(false);
  });

  it('tells you when everything ordered for a quote has arrived, and stops once the quote is invoiced', () => {
    const customerId = customers.createCustomer(db, { name: 'Meena', type: 'B2C', phone: '', email: '', gstin: '', address: '', city: '', state: '', pincode: '', notes: '' }).id;
    const q = proformas.createProforma(db, { type: 'B2C', customerId, issueDate: today, validUntil: addDays(today, 15), discountPaise: 0, notes: '', lines: [{ variantId: red, qty: 2, unitPricePaise: rupees(20000) }] });
    const o = order({ proformaId: q.id, lines: [{ variantId: red, qty: 2, unitCostPaise: rupees(12000) }] });
    expect(notifications(db).some((n) => n.kind === 'weaver-arrived')).toBe(false);
    weaver.receiveWeaverOrder(db, o.id, { receivedOn: today, lines: [{ lineId: o.lines[0]!.id, qty: 2 }] });
    expect(notifications(db).find((n) => n.kind === 'weaver-arrived')).toMatchObject({ title: `The sarees for ${q.number} have arrived`, detail: 'Meena: ready to invoice' });
    proformas.convertProforma(db, q.id);
    expect(notifications(db).some((n) => n.kind === 'weaver-arrived')).toBe(false);
  });
});
