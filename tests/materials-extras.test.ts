import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../electron/db/connection';
import { attentionItems } from '../electron/services/attention';
import { reorderList } from '../electron/services/deadstock';
import * as expenses from '../electron/services/expenses';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as locations from '../electron/services/locations';
import * as materials from '../electron/services/materials';
import * as purchases from '../electron/services/purchases';
import { saveSettings } from '../electron/services/settings';
import { todayIso } from '../shared/gst';
import { reorderNote } from '../shared/messages';
import { addDays } from '../shared/gst';

const rupees = (n: number) => n * 100;
const today = todayIso();
let db: Db;

beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { gstin: '09AABCK1234M1ZI', paymentAccounts: [{ id: 'bank', name: 'SBI', kind: 'bank', details: '', openingPaise: 0 }] });
});

const silk = (over: Partial<Parameters<typeof materials.createMaterial>[1]> = {}) => materials.createMaterial(db, { name: 'Silk yarn', unit: 'kg', unitCostPaise: rupees(4000), ...over });
const supplier = (name = 'Varanasi Silk Traders') => expenses.createVendor(db, { name, phone: '', gstin: '', address: '', notes: '' });

function saree(bom: Parameters<typeof inventory.createVariant>[2]['bom'] = [], over: Partial<Parameters<typeof inventory.createVariant>[2]> = {}) {
  const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: '', hsnCode: '5007', description: '', defaultPricePaise: rupees(10000) });
  const v = inventory.createVariant(db, d.id, { color: 'Red', size: '6 m', sellPricePaise: rupees(10000), baseCostPaise: rupees(500), reorderLevel: 2, openingStock: 10, bom, ...over });
  return { design: d, variant: v };
}

describe('raw material stock', () => {
  it('starts with what is in hand, tracks every movement, and flags low and out', () => {
    const m = silk({ openingQty: 10, reorderQty: 3, category: 'Yarn' });
    expect(m).toMatchObject({ stockQty: 10, reorderQty: 3, status: 'ok', category: 'Yarn' });
    materials.adjustMaterial(db, { materialId: m.id, delta: -7, reason: 'used', note: 'Weaving batch 4' });
    expect(materials.getMaterial(db, m.id)).toMatchObject({ stockQty: 3, status: 'low' });
    materials.adjustMaterial(db, { materialId: m.id, delta: -3, reason: 'wastage' });
    expect(materials.getMaterial(db, m.id)).toMatchObject({ stockQty: 0, status: 'out' });
    expect(materials.listMaterialMovements(db, m.id).map((x) => [x.reason, x.delta, x.balanceAfter])).toEqual([['wastage', -3, 0], ['used', -7, 3], ['opening', 10, 10]]);
  });

  it('does not watch stock when no reorder quantity is set, and handles decimals cleanly', () => {
    const m = silk({ openingQty: 0.1 });
    expect(m.status).toBe('ok');
    materials.adjustMaterial(db, { materialId: m.id, delta: 0.2, reason: 'adjustment' });
    expect(materials.getMaterial(db, m.id).stockQty).toBe(0.3);
  });

  it('refuses to take out more than there is, a bad quantity, or "bought" by hand', () => {
    const m = silk({ openingQty: 2 });
    expect(() => materials.adjustMaterial(db, { materialId: m.id, delta: -3, reason: 'used' })).toThrow(/Not enough Silk yarn/);
    expect(() => materials.adjustMaterial(db, { materialId: m.id, delta: 0, reason: 'adjustment' })).toThrow(/how much/);
    expect(() => materials.adjustMaterial(db, { materialId: m.id, delta: 5, reason: 'used' })).toThrow(/comes out of stock/);
    expect(() => materials.adjustMaterial(db, { materialId: m.id, delta: 5, reason: 'purchase' })).toThrow(/Use a purchase/);
    expect(materials.getMaterial(db, m.id).stockQty).toBe(2);
  });

  it('remembers the usual supplier and refuses one that does not exist', () => {
    const s = supplier();
    expect(silk({ supplierId: s.id })).toMatchObject({ supplierId: s.id, supplierName: 'Varanasi Silk Traders' });
    expect(() => silk({ name: 'x', supplierId: 'nope' })).toThrow(/no longer exists/);
  });

  it('puts low and empty materials on the needs-attention list', () => {
    silk({ name: 'Zari', openingQty: 1, reorderQty: 5 });
    silk({ name: 'Dye', openingQty: 50, reorderQty: 5 });
    const items = attentionItems(db, today).filter((i) => i.kind === 'low-material');
    expect(items.map((i) => i.title)).toEqual(['Zari is running low']);
    expect(items[0]!.link).toEqual({ to: 'materials' });
  });
});

describe('material prices', () => {
  it('start a history and add a line only when the price changes', () => {
    const m = silk();
    expect(materials.materialPriceHistory(db, m.id)).toHaveLength(1);
    materials.updateMaterial(db, m.id, { name: 'Silk yarn', unit: 'kg', unitCostPaise: rupees(4000), category: 'Yarn' });
    expect(materials.materialPriceHistory(db, m.id)).toHaveLength(1);
    materials.updateMaterial(db, m.id, { name: 'Silk yarn', unit: 'kg', unitCostPaise: rupees(4400) });
    expect(materials.materialPriceHistory(db, m.id).map((p) => [p.unitCostPaise, p.source])).toEqual([[rupees(4400), 'manual'], [rupees(4000), 'opening']]);
  });
});

describe('wastage in the costing', () => {
  it('adds the wasted share to a line, and carries it through a copy of the design', () => {
    const m = silk({ unitCostPaise: rupees(1000) });
    const { design, variant } = saree([{ materialId: m.id, qty: 2, wastagePercent: 10 }]);
    // 2 kg + 10% = 2.2 kg × ₹1,000 = ₹2,200, on top of ₹500 base cost
    expect(variant.bom[0]).toMatchObject({ qty: 2, wastagePercent: 10, lineCostPaise: rupees(2200) });
    expect(variant.unitCostPaise).toBe(rupees(2700));
    const copy = inventory.duplicateDesign(db, design.id);
    expect(copy.variants[0]!.bom[0]!.wastagePercent).toBe(10);
    expect(copy.variants[0]!.unitCostPaise).toBe(rupees(2700));
  });

  it('defaults to none, and rejects a share outside 0 to 100', () => {
    const m = silk({ unitCostPaise: rupees(1000) });
    expect(saree([{ materialId: m.id, qty: 1 }]).variant.bom[0]!.wastagePercent).toBe(0);
    expect(() => inventory.createVariant(db, inventory.listDesigns(db)[0]!.id, { color: 'Blue', size: '6 m', sellPricePaise: 1, baseCostPaise: 0, reorderLevel: 0, bom: [{ materialId: m.id, qty: 1, wastagePercent: 120 }] })).toThrow(/between 0% and 100%/);
  });
});

describe('the what-if price simulator', () => {
  it('shows cost and margin now and then for only the sarees that use the material, and changes nothing', () => {
    const m = silk({ unitCostPaise: rupees(1000) });
    const other = silk({ name: 'Cotton', unitCostPaise: rupees(100) });
    const { variant } = saree([{ materialId: m.id, qty: 5 }], { sellPricePaise: rupees(10000), baseCostPaise: 0 }); // cost 5,000 → margin 50%
    const unrelated = inventory.createDesign(db, { code: 'MG-002', name: 'Plain', fabric: '', hsnCode: '', description: '', defaultPricePaise: 1 });
    inventory.createVariant(db, unrelated.id, { color: 'Red', size: '6 m', sellPricePaise: rupees(500), baseCostPaise: 0, reorderLevel: 0, bom: [{ materialId: other.id, qty: 1 }] });

    const sim = materials.simulateMaterialPrices(db, [{ materialId: m.id, unitCostPaise: rupees(1800) }]);
    expect(sim.rows).toHaveLength(1);
    expect(sim.rows[0]).toMatchObject({ variantId: variant.id, costNowPaise: rupees(5000), costThenPaise: rupees(9000), stock: 10 });
    expect(sim.rows[0]!.marginNowPercent).toBeCloseTo(50);
    expect(sim.rows[0]!.marginThenPercent).toBeCloseTo(10);
    expect(sim.stockCostNowPaise).toBe(rupees(50000));
    expect(sim.stockCostThenPaise).toBe(rupees(90000));
    expect(sim.lowMarginCount).toBe(1); // under the default 15% floor
    expect(sim.belowCostCount).toBe(0);
    expect(materials.getMaterial(db, m.id).unitCostPaise).toBe(rupees(1000)); // untouched

    expect(materials.simulateMaterialPrices(db, [{ materialId: m.id, unitCostPaise: rupees(2500) }]).belowCostCount).toBe(1);
    expect(() => materials.simulateMaterialPrices(db, [])).toThrow(/at least one/);
    expect(() => materials.simulateMaterialPrices(db, [{ materialId: 'nope', unitCostPaise: 1 }])).toThrow(/no longer exists/);
  });

  it('warns about a saree that falls below the margin you want, once, until it is fixed', () => {
    const m = silk({ unitCostPaise: rupees(1000) });
    const { design } = saree([{ materialId: m.id, qty: 5 }], { sellPricePaise: rupees(10000), baseCostPaise: 0 });
    expect(attentionItems(db, today).some((i) => i.kind === 'low-margin')).toBe(false);
    materials.updateMaterial(db, m.id, { name: 'Silk yarn', unit: 'kg', unitCostPaise: rupees(1800) });
    const alert = attentionItems(db, today).find((i) => i.kind === 'low-margin');
    expect(alert).toMatchObject({ link: { to: 'design', id: design.id } });
    expect(alert!.title).toMatch(/earns only 10%/);
    saveSettings(db, { marginAlertPercent: 0 });
    expect(attentionItems(db, today).some((i) => i.kind === 'low-margin')).toBe(false);
  });
});

describe('buying raw material', () => {
  const line = (materialId: string, qty: number, price: number) => ({ materialId, qty, unitCostPaise: rupees(price) });

  it('adds the stock, makes the price paid the new price, and keeps the old one in the history', () => {
    const m = silk({ openingQty: 2 });
    const s = supplier();
    const r = purchases.createPurchase(db, { supplierId: s.id, date: today, billNo: 'B-17', note: '', lines: [line(m.id, 5, 4400)] });
    expect(r).toMatchObject({ totalPaise: rupees(22000), supplierName: 'Varanasi Silk Traders', billNo: 'B-17' });
    expect(r.priceChanges).toEqual([{ materialId: m.id, materialName: 'Silk yarn', fromPaise: rupees(4000), toPaise: rupees(4400) }]);
    expect(materials.getMaterial(db, m.id)).toMatchObject({ stockQty: 7, unitCostPaise: rupees(4400) });
    expect(materials.materialPriceHistory(db, m.id).map((p) => p.source)).toEqual(['purchase', 'opening']);
    expect(materials.listMaterialMovements(db, m.id)[0]).toMatchObject({ reason: 'purchase', delta: 5, note: 'Bill B-17' });
  });

  it('leaves the price alone when it is the same, and reports no change', () => {
    const m = silk();
    const r = purchases.createPurchase(db, { supplierId: null, date: today, billNo: '', note: '', lines: [line(m.id, 1, 4000)] });
    expect(r.priceChanges).toEqual([]);
    expect(materials.materialPriceHistory(db, m.id)).toHaveLength(1);
  });

  it('can also be entered as a paid or unpaid expense, with its GST, in one step', () => {
    const m = silk();
    const s = supplier();
    const paid = purchases.createPurchase(db, { supplierId: s.id, date: today, billNo: 'B-1', note: '', gstPaise: rupees(1000), lines: [line(m.id, 5, 4200)], expense: { method: 'bank', accountId: 'bank', status: 'paid' } });
    const e = expenses.getExpense(db, paid.expenseId!);
    expect(e).toMatchObject({ category: 'Raw materials', vendor: 'Varanasi Silk Traders', amountPaise: rupees(21000), gstPaise: rupees(1000), accountId: 'bank', status: 'paid', reference: 'B-1' });
    const owed = purchases.createPurchase(db, { supplierId: s.id, date: today, billNo: 'B-2', note: '', lines: [line(m.id, 1, 4200)], expense: { method: 'bank', status: 'unpaid', dueDate: addDays(today, 10) } });
    expect(expenses.getExpense(db, owed.expenseId!)).toMatchObject({ status: 'unpaid', dueDate: addDays(today, 10) });
    expect(expenses.payablesSummary(db).unpaidPaise).toBe(rupees(4200));
    expect(purchases.createPurchase(db, { supplierId: null, date: today, billNo: '', note: '', lines: [line(m.id, 1, 4200)] }).expenseId).toBeNull();
  });

  it('checks everything first and changes nothing when something is wrong', () => {
    const m = silk();
    const base = { supplierId: null, date: today, billNo: '', note: '' };
    expect(() => purchases.createPurchase(db, { ...base, lines: [] })).toThrow(/at least one/);
    expect(() => purchases.createPurchase(db, { ...base, lines: [line(m.id, 0, 10)] })).toThrow(/greater than zero/);
    expect(() => purchases.createPurchase(db, { ...base, lines: [line(m.id, 1, 10), line(m.id, 1, 10)] })).toThrow(/twice/);
    expect(() => purchases.createPurchase(db, { ...base, lines: [line('nope', 1, 10)] })).toThrow(/no longer exists/);
    expect(() => purchases.createPurchase(db, { ...base, date: addDays(today, 1), lines: [line(m.id, 1, 10)] })).toThrow(/future/);
    expect(() => purchases.createPurchase(db, { ...base, supplierId: 'nope', lines: [line(m.id, 1, 10)] })).toThrow(/supplier/);
    expect(() => purchases.createPurchase(db, { ...base, gstPaise: rupees(99), lines: [line(m.id, 1, 10)] })).toThrow(/can't be more/);
    expect(materials.getMaterial(db, m.id).stockQty).toBe(0);
    expect(purchases.listPurchases(db)).toEqual([]);
  });

  it('lists purchases by supplier and date, and taking one back removes its stock and expense', () => {
    const m = silk();
    const s = supplier();
    const a = purchases.createPurchase(db, { supplierId: s.id, date: addDays(today, -3), billNo: 'A', note: '', lines: [line(m.id, 4, 4000)], expense: { method: 'cash', status: 'paid' } });
    purchases.createPurchase(db, { supplierId: null, date: today, billNo: 'B', note: '', lines: [line(m.id, 1, 4000)] });
    expect(purchases.listPurchases(db).map((p) => p.billNo)).toEqual(['B', 'A']);
    expect(purchases.listPurchases(db, { supplierId: s.id }).map((p) => p.billNo)).toEqual(['A']);
    expect(purchases.listPurchases(db, { from: addDays(today, -1) }).map((p) => p.billNo)).toEqual(['B']);

    purchases.deletePurchase(db, a.id);
    expect(materials.getMaterial(db, m.id).stockQty).toBe(1);
    expect(expenses.listExpenses(db)).toEqual([]);
    expect(purchases.listPurchases(db).map((p) => p.billNo)).toEqual(['B']);
    expect(() => purchases.getPurchase(db, a.id)).toThrow(/no longer exists/);
  });

  it('cannot be taken back once the stock has been used', () => {
    const m = silk();
    const a = purchases.createPurchase(db, { supplierId: null, date: today, billNo: '', note: '', lines: [line(m.id, 4, 4000)] });
    materials.adjustMaterial(db, { materialId: m.id, delta: -3, reason: 'used' });
    expect(() => purchases.deletePurchase(db, a.id)).toThrow(/Not enough/);
    expect(purchases.getPurchase(db, a.id).lines).toHaveLength(1);
    expect(materials.getMaterial(db, m.id).stockQty).toBe(1);
  });

  it('counts in input GST through the expense it made', () => {
    const m = silk();
    purchases.createPurchase(db, { supplierId: null, date: today, billNo: '', note: '', gstPaise: rupees(500), lines: [line(m.id, 5, 2100)], expense: { method: 'cash', status: 'paid' } });
    expect(expenses.gstNet(db, { from: today, to: today }).inputPaise).toBe(rupees(500));
  });
});

describe('keeping sarees in more than one place', () => {
  it('moves pieces between the shop and another place without changing the total', () => {
    const { variant } = saree();
    const godown = locations.createLocation(db, 'Godown');
    expect(locations.listLocations(db).map((l) => [l.name, l.pieces])).toEqual([['Shop', 10], ['Godown', 0]]);
    const shop = locations.listLocations(db)[0]!;
    const t = locations.transferStock(db, { variantId: variant.id, fromLocationId: shop.id, toLocationId: godown.id, qty: 6, note: 'Festival stock' });
    expect(t).toMatchObject({ fromName: 'Shop', toName: 'Godown', qty: 6, note: 'Festival stock' });
    const v = inventory.getVariant(db, variant.id);
    expect(v.stock).toBe(10);
    expect(v.locations.map((l) => [l.name, l.qty])).toEqual([['Shop', 4], ['Godown', 6]]);
    expect(locations.listLocations(db).map((l) => [l.name, l.pieces])).toEqual([['Shop', 4], ['Godown', 6]]);
    // and back again
    locations.transferStock(db, { variantId: variant.id, fromLocationId: godown.id, toLocationId: shop.id, qty: 6 });
    expect(inventory.getVariant(db, variant.id).locations).toEqual([{ locationId: shop.id, name: 'Shop', qty: 10 }]);
    expect(locations.listTransfers(db, variant.id)).toHaveLength(2);
  });

  it('sells only from the shop: pieces in the godown have to be moved first', () => {
    const { variant } = saree();
    const godown = locations.createLocation(db, 'Godown');
    const shop = locations.listLocations(db)[0]!;
    locations.transferStock(db, { variantId: variant.id, fromLocationId: shop.id, toLocationId: godown.id, qty: 8 });
    const sell = (qty: number) => invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: variant.id, qty, unitPricePaise: rupees(10000) }] });
    expect(() => sell(3)).toThrow(/only 2 in the shop \(8 at Godown\)/);
    sell(2);
    expect(inventory.getVariant(db, variant.id)).toMatchObject({ stock: 8 });
    expect(inventory.getVariant(db, variant.id).locations.map((l) => l.qty)).toEqual([0, 8]);
    locations.transferStock(db, { variantId: variant.id, fromLocationId: godown.id, toLocationId: shop.id, qty: 3 });
    sell(3);
    expect(inventory.getVariant(db, variant.id).stock).toBe(5);
  });

  it('refuses to move more than a place holds, to the same place, or to somewhere that does not exist', () => {
    const { variant } = saree();
    const godown = locations.createLocation(db, 'Godown');
    const shop = locations.listLocations(db)[0]!;
    expect(() => locations.transferStock(db, { variantId: variant.id, fromLocationId: shop.id, toLocationId: godown.id, qty: 11 })).toThrow(/only 10 at Shop/);
    expect(() => locations.transferStock(db, { variantId: variant.id, fromLocationId: godown.id, toLocationId: shop.id, qty: 1 })).toThrow(/only 0 at Godown/);
    expect(() => locations.transferStock(db, { variantId: variant.id, fromLocationId: shop.id, toLocationId: shop.id, qty: 1 })).toThrow(/different places/);
    expect(() => locations.transferStock(db, { variantId: variant.id, fromLocationId: shop.id, toLocationId: 'nope', qty: 1 })).toThrow(/no longer exists/);
    expect(() => locations.transferStock(db, { variantId: variant.id, fromLocationId: shop.id, toLocationId: godown.id, qty: 0 })).toThrow();
  });

  it('lets an empty place be removed or renamed, but not the shop or a place with stock in it', () => {
    const { variant } = saree();
    const godown = locations.createLocation(db, 'Godown');
    const shop = locations.listLocations(db)[0]!;
    expect(() => locations.createLocation(db, 'godown')).toThrow(/already have a place/);
    expect(locations.renameLocation(db, godown.id, 'Main godown').name).toBe('Main godown');
    locations.transferStock(db, { variantId: variant.id, fromLocationId: shop.id, toLocationId: godown.id, qty: 2 });
    expect(() => locations.archiveLocation(db, godown.id)).toThrow(/still holds 2 pieces/);
    expect(() => locations.archiveLocation(db, shop.id)).toThrow(/can't be removed/);
    locations.transferStock(db, { variantId: variant.id, fromLocationId: godown.id, toLocationId: shop.id, qty: 2 });
    locations.archiveLocation(db, godown.id);
    expect(locations.listLocations(db).map((l) => l.name)).toEqual(['Shop']);
  });
});

describe('who to reorder from', () => {
  it('carries the usual supplier onto the reorder list and splits the message by supplier', () => {
    const s = supplier('Kanpur Zari House');
    const a = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: '', hsnCode: '', description: '', defaultPricePaise: 1, supplierId: s.id });
    const b = inventory.createDesign(db, { code: 'MG-002', name: 'Plain', fabric: '', hsnCode: '', description: '', defaultPricePaise: 1 });
    for (const d of [a, b]) inventory.createVariant(db, d.id, { color: 'Red', size: '6 m', sellPricePaise: 1, baseCostPaise: 0, reorderLevel: 5, openingStock: 1, bom: [] });
    expect(inventory.getDesign(db, a.id)).toMatchObject({ supplierId: s.id, supplierName: 'Kanpur Zari House' });
    const rows = reorderList(db);
    expect(rows.map((r) => [r.designName, r.supplierName])).toEqual([['Plain', ''], ['Butidar', 'Kanpur Zari House']].sort((x, y) => (x[1] === '' ? -1 : y[1] === '' ? 1 : 0)));
    const note = reorderNote(rows, 'Mau Gharana', today);
    expect(note).toContain('== Kanpur Zari House ==');
    expect(note).toContain('== No supplier set ==');
    expect(note.indexOf('Kanpur Zari House')).toBeLessThan(note.indexOf('No supplier set'));
    expect(() => inventory.createDesign(db, { code: 'MG-9', name: 'X', fabric: '', hsnCode: '', description: '', defaultPricePaise: 1, supplierId: 'nope' })).toThrow(/supplier/);
  });
});
