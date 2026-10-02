import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import * as inventory from '../electron/services/inventory';
import type { BulkSareeRow } from '../shared/types';

const rupees = (n: number) => n * 100;

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});

const row = (over: Partial<BulkSareeRow> = {}): BulkSareeRow => ({
  name: 'Mau Silk Butidar',
  sku: '',
  color: 'Maroon',
  size: '6.3 m',
  fabric: '',
  hsn: '',
  mrpPaise: rupees(12500),
  sellPricePaise: rupees(9800),
  costPaise: rupees(6000),
  stock: 4,
  reorderLevel: 2,
  ...over,
});

const counts = () => ({
  designs: inventory.listDesigns(db).length,
  variants: inventory.listDesigns(db).reduce((s, d) => s + d.variantCount, 0),
});

describe('bulk add sarees', () => {
  it('turns rows with the same name into one design with several colours', () => {
    const result = inventory.bulkAddSarees(db, [
      row({ color: 'Maroon', fabric: 'Pure silk', hsn: '5007' }),
      row({ color: 'Emerald', stock: 6 }),
      row({ name: '  banarasi   katan ', color: 'Wine', sellPricePaise: rupees(14500), costPaise: rupees(9000), mrpPaise: rupees(18000) }),
    ]);
    expect(result).toEqual({ errors: [], designsCreated: 2, designsExtended: 0, variantsCreated: 3 });

    // Stray spaces in a name are tidied away; otherwise it is kept as typed. Lists are sorted by name.
    expect(inventory.listDesigns(db).map((d) => d.name)).toEqual(['banarasi katan', 'Mau Silk Butidar']);
    const detail = inventory.getDesign(db, inventory.listDesigns(db, { search: 'butidar' })[0]!.id);
    expect(detail).toMatchObject({ name: 'Mau Silk Butidar', fabric: 'Pure silk', hsnCode: '5007', defaultPricePaise: rupees(9800), variantCount: 2, totalStock: 10 });
    expect(detail.variants.map((v) => v.color).sort()).toEqual(['Emerald', 'Maroon']);
    // Codes are handed out in the order first typed.
    expect(detail.code).toBe('MG-001');
  });

  it('keeps MRP, selling price and cost price apart, and puts the opening stock on the ledger', () => {
    inventory.bulkAddSarees(db, [row()]);
    const d = inventory.getDesign(db, inventory.listDesigns(db)[0]!.id);
    const v = d.variants[0]!;
    expect(v).toMatchObject({ mrpPaise: rupees(12500), sellPricePaise: rupees(9800), baseCostPaise: rupees(6000), unitCostPaise: rupees(6000), stock: 4, reorderLevel: 2 });
    expect(inventory.listMovements(db, v.id).map((m) => [m.reason, m.delta])).toEqual([['opening', 4]]);
  });

  it('uses the Saree ID you give, and makes one when you leave it blank', () => {
    inventory.bulkAddSarees(db, [row({ sku: 'BUT-001' }), row({ color: 'Emerald' })]);
    const skus = inventory.getDesign(db, inventory.listDesigns(db)[0]!.id).variants.map((v) => v.sku).sort();
    expect(skus).toEqual(['BUT-001', 'MG-001-EME-6.3M']);
  });

  it('adds new colours to a design you already have, matching the name loosely', () => {
    inventory.bulkAddSarees(db, [row()]);
    const result = inventory.bulkAddSarees(db, [row({ name: ' MAU silk   butidar', color: 'Royal blue' })]);
    expect(result).toMatchObject({ errors: [], designsCreated: 0, designsExtended: 1, variantsCreated: 1 });
    expect(counts()).toEqual({ designs: 1, variants: 2 });
  });

  it('reports every problem row by row and adds nothing at all', () => {
    inventory.bulkAddSarees(db, [row({ sku: 'TAKEN-1' })]);
    const before = counts();
    const result = inventory.bulkAddSarees(db, [
      row({ name: 'Fine one', color: 'Red' }), //             0: fine
      row({ name: '', color: 'Red' }), //                     1: no name
      row({ name: 'Second', color: '' }), //                  2: no colour
      row({ name: 'Third', sellPricePaise: -5 }), //          3: bad price
      row({ name: 'Fourth', sku: 'TAKEN-1' }), //             4: SKU already in the shop
      row({ name: 'Fifth', sku: 'DUP-1' }), //                5: fine
      row({ name: 'Sixth', sku: 'dup-1' }), //                6: same SKU as row 5
      row({ name: 'Fine one', color: 'RED' }), //             7: same saree/colour/size as row 0
      row({ name: 'Mau Silk Butidar', color: 'maroon' }), //  8: design already has that colour and size
    ]);
    expect(result.designsCreated + result.variantsCreated + result.designsExtended).toBe(0);
    expect(result.errors.map((e) => e.row)).toEqual([1, 2, 3, 4, 6, 7, 8]);
    expect(result.errors.find((e) => e.row === 1)!.message).toMatch(/Saree name is required/);
    expect(result.errors.find((e) => e.row === 2)!.message).toMatch(/Colour is required/);
    expect(result.errors.find((e) => e.row === 4)!.message).toMatch(/already in use/);
    expect(result.errors.find((e) => e.row === 6)!.message).toMatch(/more than one row/);
    expect(result.errors.find((e) => e.row === 7)!.message).toMatch(/more than once/);
    expect(result.errors.find((e) => e.row === 8)!.message).toMatch(/already has a maroon \/ 6.3 m/);
    expect(counts()).toEqual(before); // even the good rows stayed out
  });

  it('gives one message per row, even when a row has several problems', () => {
    inventory.bulkAddSarees(db, [row()]);
    const result = inventory.bulkAddSarees(db, [row({ color: 'Red' }), row({ color: 'red' }), row({ color: 'Maroon' /* also exists already */, sku: '' })]);
    expect(result.errors.map((e) => e.row)).toEqual([1, 2]);
  });

  it('is not confused by two designs with the same name', () => {
    for (const code of ['A-1', 'A-2']) inventory.createDesign(db, { code, name: 'Twin', fabric: '', hsnCode: '', description: '', defaultPricePaise: 100 });
    const result = inventory.bulkAddSarees(db, [row({ name: 'Twin' })]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toMatch(/more than one design called "Twin"/);
  });

  it('has sensible limits, and a friendly message through the API', async () => {
    expect(() => inventory.bulkAddSarees(db, [])).toThrow(/at least one saree/);
    expect(() => inventory.bulkAddSarees(db, Array.from({ length: 501 }, (_, i) => row({ name: `S${i}` })))).toThrow(/up to 500/);
    const api = createApi(db);
    expect((await api.inventoryBulkAdd([row()])).variantsCreated).toBe(1);
    expect((await api.inventoryBulkAdd([row({ color: '' })])).errors[0]!.message).toMatch(/Colour/);
  });

  it('MRP is optional when editing a single piece, and can be changed', () => {
    const d = inventory.createDesign(db, { code: 'X-1', name: 'X', fabric: '', hsnCode: '', description: '', defaultPricePaise: 100 });
    const v = inventory.createVariant(db, d.id, { color: 'Red', size: '6 m', sellPricePaise: 100, baseCostPaise: 50, reorderLevel: 0, bom: [] });
    expect(v.mrpPaise).toBe(0);
    expect(inventory.updateVariant(db, v.id, { color: 'Red', size: '6 m', sellPricePaise: 100, mrpPaise: 150, baseCostPaise: 50, reorderLevel: 0, bom: [] }).mrpPaise).toBe(150);
    expect(() => inventory.updateVariant(db, v.id, { color: 'Red', size: '6 m', sellPricePaise: 100, mrpPaise: -1, baseCostPaise: 50, reorderLevel: 0, bom: [] })).toThrow(/MRP/);
  });
});

describe('special names', () => {
  const designNamed = (name: string) => inventory.listDesigns(db).find((d) => d.name === name)!;

  it('are stored on the design, taken from the first row that has one, and searchable', () => {
    inventory.bulkAddSarees(db, [row({ name: 'Banarasi Katan Kadhua', nickname: '' }), row({ name: 'Banarasi Katan Kadhua', color: 'Wine', nickname: 'Kadhua' }), row({ name: 'Banarasi Katan Kadhua', color: 'Ivory', nickname: 'Other' })]);
    expect(designNamed('Banarasi Katan Kadhua').nickname).toBe('Kadhua');
    expect(inventory.listDesigns(db, { search: 'kadhua' })).toHaveLength(1);
    expect(inventory.listDesigns(db, { search: 'nothing' })).toHaveLength(0);
  });

  it('can be a phrase, are tidied, and stop at a sensible length', () => {
    const result = inventory.bulkAddSarees(db, [row({ name: 'Two words', nickname: '  Rang   Bahar ' })]);
    expect(result.errors).toEqual([]);
    expect(designNamed('Two words').nickname).toBe('Rang Bahar');
    expect(inventory.listDesigns(db, { search: 'bahar' })).toHaveLength(1);
    const d = inventory.createDesign(db, { code: 'X-1', name: 'X', nickname: 'Mau Rani Gulabi Rang', fabric: '', hsnCode: '', description: '', defaultPricePaise: 1 });
    expect(d.nickname).toBe('Mau Rani Gulabi Rang');
    expect(() => inventory.createDesign(db, { code: 'X-2', name: 'X', nickname: 'x'.repeat(41), fabric: '', hsnCode: '', description: '', defaultPricePaise: 1 })).toThrow(/too long/);
  });

  it('are optional, and a design that already has one keeps it', () => {
    inventory.bulkAddSarees(db, [row({ name: 'Plain' })]);
    expect(designNamed('Plain').nickname).toBe('');
    // A design with no short name yet takes the first one typed…
    inventory.bulkAddSarees(db, [row({ name: 'Plain', color: 'Red', nickname: 'Simple' })]);
    expect(designNamed('Plain').nickname).toBe('Simple');
    // …but one it already has is never overwritten by a sheet.
    inventory.bulkAddSarees(db, [row({ name: 'Plain', color: 'Blue', nickname: 'Different' })]);
    expect(designNamed('Plain').nickname).toBe('Simple');
  });

  it('can be set and changed on a single design', () => {
    const d = inventory.createDesign(db, { code: 'X-1', name: 'X', nickname: 'Ex', fabric: '', hsnCode: '', description: '', defaultPricePaise: 1 });
    expect(d.nickname).toBe('Ex');
    expect(inventory.updateDesign(db, d.id, { code: 'X-1', name: 'X', nickname: '', fabric: '', hsnCode: '', description: '', defaultPricePaise: 1 }).nickname).toBe('');
  });
});

describe('adding a saree from the invoice screen', () => {
  it('returns the new piece ready to sell, and the invoice takes its stock out through the ledger', async () => {
    const api = createApi(db);
    const made = await api.inventoryQuickAdd(row({ stock: 2, sellPricePaise: rupees(5000) }));
    expect(made).toMatchObject({ designName: 'Mau Silk Butidar', color: 'Maroon', stock: 2, sellPricePaise: rupees(5000) });
    expect((await api.variantsForSale()).map((v) => v.variantId)).toContain(made.variantId);

    const inv = await api.invoiceCreate({ type: 'B2C', customerId: null, issueDate: '2026-05-10', dueDate: '2026-05-10', discountPaise: 0, notes: '', lines: [{ variantId: made.variantId, qty: 2, unitPricePaise: made.sellPricePaise }] });
    expect(inv.lines).toHaveLength(1);
    const moves = await api.stockMovements(made.variantId);
    expect(moves.map((m) => [m.reason, m.delta])).toEqual([
      ['sale', -2],
      ['opening', 2],
    ]);
  });

  it('adds a colour to a design you already have, and refuses a piece that already exists', async () => {
    const api = createApi(db);
    await api.inventoryQuickAdd(row());
    const second = await api.inventoryQuickAdd(row({ color: 'Emerald' }));
    expect(second.designName).toBe('Mau Silk Butidar');
    expect(counts()).toEqual({ designs: 1, variants: 2 });
    await expect(api.inventoryQuickAdd(row({ color: 'emerald' }))).rejects.toThrow(/already has/);
    expect(counts()).toEqual({ designs: 1, variants: 2 });
  });

  it('names the problem when a field is missing', async () => {
    await expect(createApi(db).inventoryQuickAdd(row({ color: ' ' }))).rejects.toThrow(/Colour/);
  });
});
