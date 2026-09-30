import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../electron/db/connection';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as materials from '../electron/services/materials';
import * as weavers from '../electron/services/weavers';
import { addDays, todayIso } from '../shared/gst';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});

const rupees = (n: number) => n * 100;
const today = todayIso();

function setup() {
  const silk = materials.createMaterial(db, { name: 'Silk yarn', unit: 'kg', unitCostPaise: rupees(4000) });
  const zari = materials.createMaterial(db, { name: 'Zari', unit: 'kg', unitCostPaise: rupees(9000) });
  const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: 'Silk', hsnCode: '5007', description: '', defaultPricePaise: rupees(9800) });
  const v = inventory.createVariant(db, d.id, { color: 'Maroon', size: '6.3 m', sellPricePaise: rupees(9800), baseCostPaise: rupees(500), reorderLevel: 0, openingStock: 0, bom: [{ materialId: silk.id, qty: 0.5 }] });
  const w = weavers.createWeaver(db, { name: 'Rafiq Ansari', phone: '9876500077', place: 'Mau', notes: '' });
  return { silk, zari, d, v, w };
}
const order = (weaverId: string, variantId: string, over = {}) => weavers.createJobOrder(db, { weaverId, variantId, qty: 5, wagePaise: rupees(800), expectedOn: addDays(today, 20), note: '', ...over });
const stockOf = (variantId: string) => inventory.getVariant(db, variantId).stock;
const receive = (orderId: string, qty: number, over = {}) => weavers.receivePieces(db, { orderId, qty, receivedOn: today, note: '', ...over });
const pay = (weaverId: string, amount: number, over = {}) => weavers.recordWeaverPayment(db, { weaverId, amountPaise: rupees(amount), method: 'cash', reference: '', paidOn: today, note: '', ...over });

describe('weavers', () => {
  it('validates and lists them with what they hold and are owed', () => {
    const { w } = setup();
    expect(() => weavers.createWeaver(db, { name: ' ', phone: '', place: '', notes: '' })).toThrow(/required/);
    expect(weavers.getWeaver(db, w.id)).toMatchObject({ name: 'Rafiq Ansari', openOrders: 0, piecesPending: 0, balancePaise: 0 });
    expect(weavers.updateWeaver(db, w.id, { name: 'Rafiq A.', phone: '', place: 'Kopaganj', notes: 'Best katan' }).place).toBe('Kopaganj');
  });
});

describe('a job order', () => {
  it('numbers by financial year, checks the details and starts in progress', () => {
    const { w, v } = setup();
    const o = order(w.id, v.id);
    expect(o.number).toMatch(/^WO\/\d{4}-\d{2}\/0001$/);
    expect(o).toMatchObject({ status: 'open', qty: 5, receivedQty: 0, wagePaise: rupees(800), overdue: false, designName: 'Butidar', color: 'Maroon' });
    expect(order(w.id, v.id).number).toMatch(/0002$/);
    expect(() => order(w.id, v.id, { qty: 0 })).toThrow(/at least 1|can't be less/);
    expect(() => order(w.id, v.id, { qty: 1.5 })).toThrow(/whole number/);
    expect(() => order(w.id, v.id, { expectedOn: addDays(today, -1) })).toThrow(/past/);
    expect(() => order(w.id, 'nope')).toThrow(/Choose the saree/);
    expect(weavers.getWeaver(db, w.id)).toMatchObject({ openOrders: 2, piecesPending: 10 });
  });

  it('records material handed over and handed back, valued at the cost then', () => {
    const { w, v, silk, zari } = setup();
    const o = order(w.id, v.id);
    weavers.issueMaterial(db, { orderId: o.id, materialId: silk.id, qty: 3, issuedOn: today, note: '' });
    weavers.issueMaterial(db, { orderId: o.id, materialId: zari.id, qty: 0.4, issuedOn: today, note: 'for borders' });
    materials.updateMaterial(db, silk.id, { name: 'Silk yarn', unit: 'kg', unitCostPaise: rupees(5000) }); // price rises later
    const after = weavers.issueMaterial(db, { orderId: o.id, materialId: silk.id, qty: -0.5, issuedOn: today, note: 'leftover' });
    // 3 kg at 4000 and 0.4 kg at 9000, and 0.5 kg back at today's 5000
    expect(after.materialsValuePaise).toBe(Math.round(3 * rupees(4000) + 0.4 * rupees(9000) - 0.5 * rupees(5000)));
    expect(after.materials.map((m) => m.qty)).toEqual([3, 0.4, -0.5]);
    expect(() => weavers.issueMaterial(db, { orderId: o.id, materialId: zari.id, qty: -1, issuedOn: today, note: '' })).toThrow(/Only 0\.4 kg of Zari is out/);
    expect(() => weavers.issueMaterial(db, { orderId: o.id, materialId: silk.id, qty: 0, issuedOn: today, note: '' })).toThrow(/Enter how much/);
  });

  it('brings received pieces into stock through the ledger and owes the wage for them', () => {
    const { w, v } = setup();
    const o = order(w.id, v.id);
    const after = receive(o.id, 2);
    expect(stockOf(v.id)).toBe(2);
    expect(after).toMatchObject({ receivedQty: 2, status: 'open', earnedPaise: rupees(1600) });
    const move = inventory.listMovements(db, v.id)[0]!;
    expect(move).toMatchObject({ delta: 2, reason: 'production' });
    expect(move.note).toContain('Rafiq Ansari');
    expect(weavers.getWeaver(db, w.id)).toMatchObject({ earnedPaise: rupees(1600), balancePaise: rupees(1600), piecesPending: 3 });

    const done = receive(o.id, 3);
    expect(done.status).toBe('complete');
    expect(weavers.getWeaver(db, w.id)).toMatchObject({ openOrders: 0, piecesPending: 0, balancePaise: rupees(4000) });
  });

  it('works out what a piece really costs and can set the design cost to it', () => {
    const { w, v, silk } = setup();
    const o = order(w.id, v.id); // wage 800 for 5 pieces
    weavers.issueMaterial(db, { orderId: o.id, materialId: silk.id, qty: 3, issuedOn: today, note: '' }); // 3 kg at 4000 = 12000, so 2400 a piece
    expect(weavers.getJobOrder(db, o.id).realCostPerPiecePaise).toBe(rupees(800 + 2400));
    expect(inventory.getVariant(db, v.id).unitCostPaise).toBe(rupees(500 + 2000)); // as it was: making cost 500 + 0.5 kg of silk
    receive(o.id, 1, { updateCost: true });
    // Real cost 3200 less the 2000 of raw materials in its costing leaves a making cost of 1200.
    expect(inventory.getVariant(db, v.id)).toMatchObject({ baseCostPaise: rupees(1200), unitCostPaise: rupees(3200) });
    expect(inventory.listMovements(db, v.id)[0]!.unitCostPaise).toBe(rupees(3200));
  });

  it('refuses a receipt that is clearly a typo, one dated before the order, and one on a closed order', () => {
    const { w, v } = setup();
    const o = order(w.id, v.id);
    expect(() => receive(o.id, 50)).toThrow(/Check the number/);
    expect(() => receive(o.id, 1, { receivedOn: addDays(today, 3) })).toThrow(/not in the future/);
    expect(() => receive(o.id, 1, { receivedOn: addDays(today, -3) })).toThrow(/before the order/);
    receive(o.id, 7); // a couple extra is fine
    expect(weavers.getJobOrder(db, o.id).status).toBe('complete');
    const other = order(w.id, v.id);
    weavers.closeJobOrder(db, other.id, 'weaver fell ill');
    expect(() => receive(other.id, 1)).toThrow(/is closed/);
    expect(stockOf(v.id)).toBe(7);
  });

  it('marks an order overdue once its expected date has passed', () => {
    const { w, v } = setup();
    const o = order(w.id, v.id, { expectedOn: addDays(today, 5) });
    db.prepare('UPDATE job_orders SET expected_on = ? WHERE id = ?').run(addDays(today, -2), o.id);
    expect(weavers.getJobOrder(db, o.id).overdue).toBe(true);
    expect(weavers.listJobOrders(db, { status: 'overdue' }).map((x) => x.id)).toEqual([o.id]);
    receive(o.id, 5);
    expect(weavers.getJobOrder(db, o.id).overdue).toBe(false);
    expect(weavers.listJobOrders(db, { status: 'done' })).toHaveLength(1);
  });

  it('reverses a receipt: the pieces leave stock and the wage is no longer owed', () => {
    const { w, v } = setup();
    const o = order(w.id, v.id);
    receive(o.id, 2);
    const second = receive(o.id, 3).receipts[1]!;
    expect(stockOf(v.id)).toBe(5);

    const undone = weavers.reverseReceipt(db, second.id, 'counted twice');
    expect(stockOf(v.id)).toBe(2);
    expect(undone).toMatchObject({ receivedQty: 2, status: 'open', earnedPaise: rupees(1600) });
    expect(undone.receipts[1]).toMatchObject({ reversed: true, reverseReason: 'counted twice' });
    expect(weavers.getWeaver(db, w.id).balancePaise).toBe(rupees(1600));
    expect(weavers.weaverLedger(db, w.id).entries.map((e) => e.kind)).toEqual(['received', 'received', 'received-reversed']);
    expect(weavers.weaverLedger(db, w.id).entries.at(-1)!.balancePaise).toBe(rupees(1600));
    expect(() => weavers.reverseReceipt(db, second.id, '')).toThrow(/already reversed/);
    expect(receive(o.id, 3).receivedQty).toBe(5); // and the right number can be entered again
  });

  it('will not reverse a receipt whose pieces have been sold', () => {
    const { w, v } = setup();
    const o = order(w.id, v.id);
    const first = receive(o.id, 2).receipts[0]!;
    receive(o.id, 3);
    invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: v.id, qty: 4, unitPricePaise: rupees(9800) }] });
    expect(() => weavers.reverseReceipt(db, first.id, 'wrong count')).toThrow(/already gone from stock/);
    expect(weavers.getJobOrder(db, o.id).receivedQty).toBe(5); // nothing changed
    expect(stockOf(v.id)).toBe(1);
  });

  it('cancels only an order with nothing received, and closes one that came up short', () => {
    const { w, v } = setup();
    const a = order(w.id, v.id);
    expect(weavers.cancelJobOrder(db, a.id, 'changed plan').status).toBe('cancelled');
    expect(() => weavers.cancelJobOrder(db, a.id, '')).toThrow(/is cancelled/);
    const b = order(w.id, v.id);
    receive(b.id, 2);
    expect(() => weavers.cancelJobOrder(db, b.id, '')).toThrow(/already has pieces/);
    const closed = weavers.closeJobOrder(db, b.id, 'delivered 2 of 5');
    expect(closed).toMatchObject({ status: 'closed', receivedQty: 2, closeReason: 'delivered 2 of 5' });
    expect(weavers.getWeaver(db, w.id)).toMatchObject({ openOrders: 0, balancePaise: rupees(1600) });
    expect(() => weavers.closeJobOrder(db, b.id, '')).toThrow(/is closed/);
  });
});

describe('paying a weaver', () => {
  it('reduces what you owe, treats paying ahead as an advance, and keeps the ledger adding up', () => {
    const { w, v } = setup();
    pay(w.id, 1000, { note: 'advance for yarn' }); // before anything came back
    expect(weavers.getWeaver(db, w.id).balancePaise).toBe(-rupees(1000));
    const o = order(w.id, v.id);
    receive(o.id, 3); // earns 2400
    expect(weavers.getWeaver(db, w.id)).toMatchObject({ earnedPaise: rupees(2400), paidPaise: rupees(1000), balancePaise: rupees(1400) });
    const p = pay(w.id, 1400, { orderId: o.id, method: 'upi', reference: 'UPI 9' });
    expect(p.orderNumber).toBe(o.number);
    const ledger = weavers.weaverLedger(db, w.id);
    expect(ledger.entries.map((e) => e.kind)).toEqual(['payment', 'received', 'payment']);
    expect(ledger.entries.at(-1)!.balancePaise).toBe(0);
    expect(weavers.getWeaver(db, w.id).balancePaise).toBe(0);

    weavers.voidWeaverPayment(db, p.id, 'bounced');
    const after = weavers.weaverLedger(db, w.id);
    expect(after.entries.map((e) => e.kind)).toEqual(['payment', 'received', 'payment', 'payment-voided']);
    expect(after.entries.at(-1)!.balancePaise).toBe(rupees(1400));
    expect(after.entries.at(-1)!.balancePaise).toBe(weavers.getWeaver(db, w.id).balancePaise);
    expect(() => weavers.voidWeaverPayment(db, p.id, '')).toThrow(/already reversed/);
  });

  it('checks the payment', () => {
    const { w, v } = setup();
    const other = weavers.createWeaver(db, { name: 'Other', phone: '', place: '', notes: '' });
    const o = order(other.id, v.id);
    expect(() => pay(w.id, 0)).toThrow(/can't be less than 1/);
    expect(() => pay(w.id, 100, { paidOn: addDays(today, 2) })).toThrow(/not in the future/);
    expect(() => pay(w.id, 100, { orderId: o.id })).toThrow(/isn't this weaver's/);
  });

  it('cannot archive a weaver with open orders or money in play', () => {
    const { w, v } = setup();
    const o = order(w.id, v.id);
    expect(() => weavers.archiveWeaver(db, w.id)).toThrow(/open order/);
    receive(o.id, 5);
    expect(() => weavers.archiveWeaver(db, w.id)).toThrow(/still owe/);
    pay(w.id, 4000);
    pay(w.id, 100);
    expect(() => weavers.archiveWeaver(db, w.id)).toThrow(/advance/);
    const last = weavers.listWeaverPayments(db, { weaverId: w.id })[0]!;
    weavers.voidWeaverPayment(db, last.id, '');
    weavers.archiveWeaver(db, w.id);
    expect(weavers.listWeavers(db)).toHaveLength(0);
  });
});
