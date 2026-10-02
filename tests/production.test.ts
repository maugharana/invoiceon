import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import * as expenses from '../electron/services/expenses';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as materials from '../electron/services/materials';
import * as production from '../electron/services/production';
import * as proformas from '../electron/services/proformas';
import { saveSettings } from '../electron/services/settings';
import { addDays, todayIso } from '../shared/gst';

const rupees = (n: number) => n * 100;
const today = todayIso();
let db: Db;
let designId: string;
let variantId: string;
let zariId: string;
let silkId: string;
let vendorId: string;

beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { gstin: '09AABCK1234M1ZI', state: 'Uttar Pradesh' });
  silkId = materials.createMaterial(db, { name: 'Silk yarn', unit: 'kg', unitCostPaise: rupees(4600), openingQty: 5, reorderQty: 0 }).id;
  zariId = materials.createMaterial(db, { name: 'Zari', unit: 'kg', unitCostPaise: rupees(9000), openingQty: 1, reorderQty: 0 }).id;
  const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: '', hsnCode: '', description: '', defaultPricePaise: rupees(9800) });
  designId = d.id;
  // each piece takes 0.5 kg silk (+10% lost) and 0.1 kg zari
  variantId = inventory.createVariant(db, d.id, {
    color: 'Red', size: '6 m', sellPricePaise: rupees(9800), baseCostPaise: 0, reorderLevel: 0, openingStock: 2,
    bom: [{ materialId: silkId, qty: 0.5, wastagePercent: 10 }, { materialId: zariId, qty: 0.1 }],
  }).id;
  vendorId = expenses.createVendor(db, { name: 'Ramesh karigar', phone: '', gstin: '', address: '', notes: '' }).id;
});

const stockOf = (id: string) => materials.getMaterial(db, id).stockQty;
const order = (over: Partial<Parameters<typeof production.createOrder>[1]> = {}) => production.createOrder(db, { variantId, qty: 4, vendorId, wagePaise: rupees(1500), dueOn: addDays(today, 10), ...over });

describe('production orders', () => {
  it('start planned, say what they need, and warn about what is short', () => {
    const o = order(); // 4 pieces: silk 4 × 0.5 × 1.1 = 2.2, zari 0.4
    expect(o).toMatchObject({ status: 'planned', qty: 4, receivedQty: 0, remainingQty: 4, vendorName: 'Ramesh karigar', materialsIssued: false });
    expect(o.number).toMatch(/^PRD\/.*\/0001$/);
    expect(o.materials.map((m) => [m.name, m.neededQty, m.shortQty])).toEqual([['Silk yarn', 2.2, 0], ['Zari', 0.4, 0]]);
    expect(order({ qty: 20 }).materials.map((m) => [m.name, m.neededQty, m.shortQty])).toEqual([['Silk yarn', 11, 6], ['Zari', 2, 1]]);
  });

  it('hand over the materials when work starts, and refuse, taking nothing, if any is short', () => {
    const big = order({ qty: 20 });
    expect(() => production.issueMaterials(db, big.id)).toThrow(/Not enough raw material: Silk yarn \(need 11 kg, have 5\); Zari/);
    expect(stockOf(silkId)).toBe(5);
    const o = order();
    const started = production.issueMaterials(db, o.id);
    expect(started).toMatchObject({ status: 'making', materialsIssued: true });
    expect(stockOf(silkId)).toBeCloseTo(2.8, 3);
    expect(stockOf(zariId)).toBeCloseTo(0.6, 3);
    expect(() => production.issueMaterials(db, o.id)).toThrow(/already been handed over/);
  });

  it('put pieces on the shelf as they arrive, bill the wage for each batch, and finish with the last', () => {
    const o = order();
    const part = production.receivePieces(db, o.id, { qty: 3 });
    expect(part).toMatchObject({ status: 'making', receivedQty: 3, remainingQty: 1 });
    expect(inventory.getVariant(db, variantId).stock).toBe(5);
    // starting by receiving took the materials too
    expect(stockOf(silkId)).toBeCloseTo(2.8, 3);
    const bill = expenses.getExpense(db, part.receipts[0]!.expenseId!);
    expect(bill).toMatchObject({ amountPaise: rupees(4500), vendor: 'Ramesh karigar', category: 'Job work', status: 'unpaid' });

    const done = production.receivePieces(db, o.id, { qty: 1 });
    expect(done).toMatchObject({ status: 'done', receivedQty: 4, closedOn: today });
    expect(inventory.getVariant(db, variantId).stock).toBe(6);
    expect(done.receipts.map((r) => r.qty)).toEqual([3, 1]);
    expect(() => production.receivePieces(db, o.id, { qty: 1 })).toThrow(/already finished/);
  });

  it('refuse more than expected, a future date, and a date before the order', () => {
    const o = order();
    expect(() => production.receivePieces(db, o.id, { qty: 5 })).toThrow(/Only 4 more pieces/);
    expect(() => production.receivePieces(db, o.id, { qty: 0 })).toThrow();
    expect(() => production.receivePieces(db, o.id, { qty: 1, receivedOn: addDays(today, 1) })).toThrow(/not in the future/);
    expect(() => production.receivePieces(db, o.id, { qty: 1, receivedOn: addDays(today, -3) })).toThrow(/before the order/);
    expect(inventory.getVariant(db, variantId).stock).toBe(2);
  });

  it('close early: only the materials for pieces never made go back', () => {
    const o = order();
    production.receivePieces(db, o.id, { qty: 3 });
    const closed = production.closeShort(db, o.id);
    expect(closed).toMatchObject({ status: 'done', receivedQty: 3 });
    // 1 of 4 pieces was never made: a quarter of 2.2 kg silk and 0.4 kg zari returns
    expect(stockOf(silkId)).toBeCloseTo(2.8 + 0.55, 3);
    expect(stockOf(zariId)).toBeCloseTo(0.6 + 0.1, 3);
    expect(() => production.closeShort(db, o.id)).toThrow(/already finished/);
  });

  it('cancel gives every material back, but only before anything arrives', () => {
    const planned = order();
    expect(production.cancelOrder(db, planned.id).status).toBe('cancelled');
    const started = order();
    production.issueMaterials(db, started.id);
    expect(stockOf(silkId)).toBeCloseTo(2.8, 3);
    production.cancelOrder(db, started.id);
    expect(stockOf(silkId)).toBe(5);
    const part = order();
    production.receivePieces(db, part.id, { qty: 1 });
    expect(() => production.cancelOrder(db, part.id)).toThrow(/Close the order early/);
  });

  it('can be changed only until work starts; a wage needs someone to pay', () => {
    const o = order();
    expect(production.updateOrder(db, o.id, { variantId, qty: 6, vendorId, wagePaise: rupees(1200) })).toMatchObject({ qty: 6, wagePaise: rupees(1200) });
    expect(() => order({ vendorId: null })).toThrow(/Choose who is making it/);
    expect(order({ vendorId: null, wagePaise: 0 }).vendorName).toBe('');
    production.issueMaterials(db, o.id);
    expect(() => production.updateOrder(db, o.id, { variantId, qty: 2 })).toThrow(/can no longer be changed/);
  });

  it('in-house work with no wage raises no bill, and an order with no costing needs no materials', () => {
    const plain = inventory.createVariant(db, designId, { color: 'Blue', size: '6 m', sellPricePaise: 1, baseCostPaise: 0, reorderLevel: 0, bom: [] }).id;
    const o = production.createOrder(db, { variantId: plain, qty: 2 });
    expect(o.materials).toEqual([]);
    const done = production.receivePieces(db, o.id, { qty: 2 });
    expect(done.status).toBe('done');
    expect(done.receipts[0]!.expenseId).toBeNull();
    expect(expenses.listExpenses(db).length).toBe(0);
  });

  it('are listed with the ones needing attention first, and found by search', () => {
    const a = order();
    const b = order({ qty: 1, dueOn: addDays(today, -2) });
    production.issueMaterials(db, b.id);
    const c = order();
    production.cancelOrder(db, c.id);
    expect(production.listOrders(db).map((o) => o.number)).toEqual([b.number, a.number, c.number]);
    expect(production.listOrders(db, { status: 'open' }).map((o) => o.number)).toEqual([b.number, a.number]);
    expect(production.listOrders(db, { search: 'ramesh' })).toHaveLength(3);
    expect(production.overdueOrders(db).map((o) => o.number)).toEqual([b.number]);
  });

  it('go through the typed API and into the activity log', async () => {
    const api = createApi(db);
    const o = await api.productionCreate({ variantId, qty: 2 });
    await api.productionReceive(o.id, { qty: 2 });
    expect((await api.productionGet(o.id)).status).toBe('done');
    expect((await api.auditList())[0]).toMatchObject({ label: 'Received pieces from an order' });
  });
});

describe('holding stock for a quote', () => {
  const quote = (qty: number, reserve: boolean) =>
    proformas.createProforma(db, { type: 'B2C', customerId: null, buyerName: 'Meena', issueDate: today, validUntil: addDays(today, 5), discountPaise: 0, notes: '', lines: [{ variantId, qty, unitPricePaise: rupees(9800) }], reserve });
  const sell = (qty: number) => invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId, qty, unitPricePaise: rupees(9800) }] });

  it('keeps the pieces on the shelf but not for sale to anyone else', () => {
    const q = quote(2, true);
    expect(q.reserveStock).toBe(true);
    expect(inventory.getVariant(db, variantId)).toMatchObject({ stock: 2, heldQty: 2 });
    expect(invoices.variantsForSale(db).find((v) => v.variantId === variantId)).toMatchObject({ stock: 2, held: 2 });
    expect(() => sell(1)).toThrow(new RegExp(`Only 0 of .* can be sold: 2 are being held for quote ${q.number}`));
    // the customer the pieces are held for can have them
    const inv = proformas.convertProforma(db, q.id);
    expect(inv.lines[0]!.qty).toBe(2);
    expect(inventory.getVariant(db, variantId)).toMatchObject({ stock: 0, heldQty: 0 });
  });

  it('lets the rest be sold, and frees the pieces when the quote is lost, cancelled or lapses', () => {
    const q = quote(1, true);
    expect(sell(1).lines[0]!.qty).toBe(1);
    expect(() => sell(1)).toThrow(/being held/);
    proformas.setQuoteStage(db, q.id, 'lost', 'went elsewhere');
    expect(inventory.getVariant(db, variantId).heldQty).toBe(0);
    expect(sell(1).lines[0]!.qty).toBe(1);

    const again = quote(1, false);
    expect(again.reserveStock).toBe(false);
    expect(inventory.getVariant(db, variantId).heldQty).toBe(0);
  });

  it('holds only what is really there and not already promised', () => {
    expect(() => quote(3, true)).toThrow(/Only 2 of .* can be held/);
    quote(2, true);
    expect(() => quote(1, true)).toThrow(/Only 0 of .* can be held.*already held for other quotes/);
    expect(quote(5, false).reserveStock).toBe(false); // a quote that holds nothing may promise more than there is
  });

  it('a held quote can be edited without being blocked by its own hold', () => {
    const q = quote(2, true);
    const edited = proformas.updateProforma(db, q.id, { type: 'B2C', customerId: null, buyerName: 'Meena', issueDate: today, validUntil: addDays(today, 5), discountPaise: 0, notes: 'x', lines: [{ variantId, qty: 2, unitPricePaise: rupees(9800) }], reserve: true });
    expect(edited.reserveStock).toBe(true);
    expect(proformas.updateProforma(db, q.id, { type: 'B2C', customerId: null, buyerName: 'Meena', issueDate: today, validUntil: addDays(today, 5), discountPaise: 0, notes: 'x', lines: [{ variantId, qty: 2, unitPricePaise: rupees(9800) }] }).reserveStock).toBe(false);
  });
});
