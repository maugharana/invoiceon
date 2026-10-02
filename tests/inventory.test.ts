import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, tx, type Db } from '../electron/db/connection';
import { LATEST_SCHEMA_VERSION } from '../electron/db/migrations';
import { createApi, invoke } from '../electron/api';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as materials from '../electron/services/materials';
import { loadSampleData } from '../electron/services/seed';
import { getSettings, saveSettings } from '../electron/services/settings';
import { UserError } from '../electron/services/common';
import { addDays, todayIso } from '../shared/gst';
import { formatMoney, mulPaise, parseMoney } from '../shared/money';
import { NO_FILTERS, applyDesignFilters, fabricsOf, filtersActive, type DesignFilters } from '../shared/designFilters';
import { designStatus, variantStatus } from '../shared/stock';
import type { DesignSummary } from '../shared/types';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});

const design = (over = {}) =>
  inventory.createDesign(db, { code: 'MG-001', name: 'Mau Silk Butidar', fabric: 'Silk', hsnCode: '5007', description: '', defaultPricePaise: 980000, ...over });

const variantInput = (over = {}) => ({
  color: 'Maroon',
  size: '6.3 m',
  sellPricePaise: 980000,
  baseCostPaise: 180000,
  reorderLevel: 2,
  bom: [] as { materialId: string; qty: number }[],
  ...over,
});

describe('schema', () => {
  it('migrates a fresh database to the latest version with default settings', () => {
    const v = db.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(v.user_version).toBe(LATEST_SCHEMA_VERSION);
    expect(getSettings(db)).toMatchObject({ businessName: 'Mau Gharana', gstRatePercent: 5, defaultReorderLevel: 2, invoicePrefix: 'MG', state: 'Uttar Pradesh' });
  });

  it('enforces foreign keys', () => {
    expect(() => db.prepare("INSERT INTO variants (id, design_id, sku, color, size, created_at, updated_at) VALUES ('v','nope','S','c','s','t','t')").run()).toThrow(/FOREIGN KEY/i);
  });
});

describe('money helpers', () => {
  it('formats with Indian grouping', () => {
    expect(formatMoney(12345600)).toBe('₹1,23,456.00');
    expect(formatMoney(-5050)).toBe('−₹50.50');
    expect(formatMoney(12345650, { fractionDigits: 0 })).toBe('₹1,23,457');
  });
  it('parses what people type without float drift', () => {
    expect(parseMoney('₹ 1,250')).toBe(125000);
    expect(parseMoney('99.5')).toBe(9950);
    expect(parseMoney('0.07')).toBe(7);
    expect(parseMoney('1.005')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('-5')).toBeNull();
  });
  it('rounds quantity × rate to the paisa', () => {
    expect(mulPaise(0.62, 460000)).toBe(285200);
    expect(mulPaise(0.07, 900000)).toBe(63000);
  });
});

describe('stock status', () => {
  it('classifies variants', () => {
    expect(variantStatus(0, 2)).toBe('out');
    expect(variantStatus(2, 2)).toBe('low');
    expect(variantStatus(3, 2)).toBe('ok');
    expect(variantStatus(1, 0)).toBe('ok'); // a reorder level of 0 never warns
  });
  it('rolls variants up to a design', () => {
    expect(designStatus([])).toBe('empty');
    expect(designStatus([{ stock: 0, reorderLevel: 2 }, { stock: 0, reorderLevel: 2 }])).toBe('out');
    expect(designStatus([{ stock: 0, reorderLevel: 2 }, { stock: 9, reorderLevel: 2 }])).toBe('low');
    expect(designStatus([{ stock: 9, reorderLevel: 2 }])).toBe('ok');
  });
});

describe('designs', () => {
  it('creates, lists and rejects duplicate codes case-insensitively', () => {
    design();
    expect(() => design({ code: 'mg-001', name: 'Other' })).toThrow(/already in use/);
    expect(inventory.listDesigns(db)).toHaveLength(1);
  });

  it('suggests the next code after the highest in use', () => {
    expect(inventory.nextDesignCode(db)).toBe('MG-001');
    design({ code: 'MG-007' });
    design({ code: 'CUSTOM', name: 'x' });
    expect(inventory.nextDesignCode(db)).toBe('MG-008');
  });

  it('requires a name and code', () => {
    expect(() => design({ name: '  ' })).toThrow(UserError);
    expect(() => design({ code: '' })).toThrow(/Design code is required/);
  });

  it('archives a design with its variants and frees the code for reuse', () => {
    const d = design();
    inventory.createVariant(db, d.id, variantInput({ openingStock: 3 }));
    inventory.archiveDesign(db, d.id);
    expect(inventory.listDesigns(db)).toHaveLength(0);
    expect(inventory.inventorySummary(db).unitsInStock).toBe(0);
    expect(() => inventory.getDesign(db, d.id)).toThrow(/no longer exists/);
    expect(() => design()).not.toThrow();
  });

  it('searches by code, name, fabric, colour and SKU', () => {
    const d = design();
    inventory.createVariant(db, d.id, variantInput({ color: 'Emerald' }));
    design({ code: 'MG-002', name: 'Chanderi', fabric: 'Cotton silk' });
    expect(inventory.listDesigns(db, { search: 'emerald' }).map((x) => x.code)).toEqual(['MG-001']);
    expect(inventory.listDesigns(db, { search: 'cotton' }).map((x) => x.code)).toEqual(['MG-002']);
    expect(inventory.listDesigns(db, { search: 'mg-00' })).toHaveLength(2);
    // Words can be in any order and needn't be adjacent: "design color" is how people actually type.
    expect(inventory.listDesigns(db, { search: 'butidar emerald' }).map((x) => x.code)).toEqual(['MG-001']);
    expect(inventory.listDesigns(db, { search: 'emerald mau' }).map((x) => x.code)).toEqual(['MG-001']);
    expect(inventory.listDesigns(db, { search: 'butidar wine' })).toHaveLength(0);
  });
});

describe('variants & costing', () => {
  it('auto-generates unique readable SKUs', () => {
    const d = design();
    const a = inventory.createVariant(db, d.id, variantInput({ color: 'Royal Blue', size: '6.3 m' }));
    const b = inventory.createVariant(db, d.id, variantInput({ color: 'Rani Brown', size: '6.3 m' })); // same initials
    expect(a.sku).toBe('MG-001-RB-6.3M');
    expect(b.sku).toBe('MG-001-RB-6.3M-2');
  });

  it('rejects the same colour and size twice on one design, but allows it across designs', () => {
    const d1 = design();
    const d2 = design({ code: 'MG-002', name: 'Other' });
    inventory.createVariant(db, d1.id, variantInput());
    expect(() => inventory.createVariant(db, d1.id, variantInput({ color: 'MAROON', size: '6.3 M' }))).toThrow(/already has a MAROON/);
    expect(() => inventory.createVariant(db, d2.id, variantInput())).not.toThrow();
  });

  it('computes unit cost as base cost plus raw materials, and revalues when a material price changes', () => {
    const silk = materials.createMaterial(db, { name: 'Silk yarn', unit: 'kg', unitCostPaise: 460000 });
    const zari = materials.createMaterial(db, { name: 'Zari', unit: 'kg', unitCostPaise: 900000 });
    const d = design();
    const v = inventory.createVariant(db, d.id, variantInput({ openingStock: 4, bom: [{ materialId: silk.id, qty: 0.62 }, { materialId: zari.id, qty: 0.07 }] }));

    // 0.62 × 4600 = 2852, 0.07 × 9000 = 630, base 1800  → 5282
    expect(v.materialCostPaise).toBe(285200 + 63000);
    expect(v.unitCostPaise).toBe(180000 + 285200 + 63000);
    expect(inventory.getDesign(db, d.id).stockValuePaise).toBe(4 * v.unitCostPaise);

    materials.updateMaterial(db, silk.id, { name: 'Silk yarn', unit: 'kg', unitCostPaise: 500000 });
    const after = inventory.getVariant(db, v.id);
    expect(after.materialCostPaise).toBe(310000 + 63000);
    expect(inventory.getDesign(db, d.id).stockValuePaise).toBe(4 * after.unitCostPaise);
  });

  it('replaces the bill of materials on update and validates lines', () => {
    const silk = materials.createMaterial(db, { name: 'Silk yarn', unit: 'kg', unitCostPaise: 460000 });
    const d = design();
    const v = inventory.createVariant(db, d.id, variantInput({ bom: [{ materialId: silk.id, qty: 1 }] }));
    const updated = inventory.updateVariant(db, v.id, variantInput({ bom: [] }));
    expect(updated.bom).toHaveLength(0);
    expect(() => inventory.updateVariant(db, v.id, variantInput({ bom: [{ materialId: silk.id, qty: 0 }] }))).toThrow(/greater than zero/);
    expect(() => inventory.updateVariant(db, v.id, variantInput({ bom: [{ materialId: silk.id, qty: 1 }, { materialId: silk.id, qty: 2 }] }))).toThrow(/twice/);
    expect(() => inventory.updateVariant(db, v.id, variantInput({ bom: [{ materialId: 'ghost', qty: 1 }] }))).toThrow(/no longer exists/);
    // a failed update must not have half-applied
    expect(inventory.getVariant(db, v.id).bom).toHaveLength(0);
  });

  it('keeps the SKU stable when colour changes, unless a new one is given', () => {
    const d = design();
    const v = inventory.createVariant(db, d.id, variantInput());
    const renamed = inventory.updateVariant(db, v.id, variantInput({ color: 'Wine' }));
    expect(renamed.sku).toBe(v.sku);
    expect(inventory.updateVariant(db, v.id, variantInput({ color: 'Wine', sku: 'CUSTOM-1' })).sku).toBe('CUSTOM-1');
  });

  it('rejects a negative opening stock without creating the variant', () => {
    const d = design();
    expect(() => inventory.createVariant(db, d.id, variantInput({ openingStock: -1 }))).toThrow(/can't be less than 0/);
    expect(inventory.getDesign(db, d.id).variants).toHaveLength(0);
  });
});

describe('transactions', () => {
  const count = () => (db.prepare('SELECT COUNT(*) AS n FROM designs').get() as { n: number }).n;
  const insert = (code: string) => design({ code, name: code });

  it('rolls everything back when the callback throws', () => {
    expect(() => tx(db, () => { insert('A'); insert('B'); throw new Error('boom'); })).toThrow('boom');
    expect(count()).toBe(0);
  });

  it('a failed nested step undoes only itself when the caller handles the error', () => {
    tx(db, () => {
      insert('A');
      try { tx(db, () => { insert('B'); throw new Error('inner'); }); } catch { /* handled */ }
      insert('C');
    });
    expect(inventory.listDesigns(db).map((d) => d.code)).toEqual(['A', 'C']);
  });

  it('a failing nested step aborts the outer one when not handled', () => {
    expect(() => tx(db, () => { insert('A'); tx(db, () => { throw new Error('inner'); }); })).toThrow('inner');
    expect(count()).toBe(0);
  });
});

describe('stock ledger', () => {
  it('records opening stock and adjustments with running balances', () => {
    const d = design();
    const v = inventory.createVariant(db, d.id, variantInput({ openingStock: 5 }));
    inventory.adjustStock(db, { variantId: v.id, delta: 10, reason: 'purchase', note: 'Weaver batch' });
    inventory.adjustStock(db, { variantId: v.id, delta: -2, reason: 'damage' });
    expect(inventory.getVariant(db, v.id).stock).toBe(13);

    const log = inventory.listMovements(db, v.id);
    expect(log.map((m) => [m.reason, m.delta, m.balanceAfter])).toEqual([
      ['damage', -2, 13],
      ['purchase', 10, 15],
      ['opening', 5, 5],
    ]);
    expect(log[1]!.note).toBe('Weaver batch');
  });

  it('refuses to go negative and leaves stock and ledger untouched', () => {
    const d = design();
    const v = inventory.createVariant(db, d.id, variantInput({ openingStock: 2 }));
    expect(() => inventory.adjustStock(db, { variantId: v.id, delta: -3, reason: 'adjustment' })).toThrow(/Not enough stock/);
    expect(inventory.getVariant(db, v.id).stock).toBe(2);
    expect(inventory.listMovements(db, v.id)).toHaveLength(1);
  });

  it('rejects zero, fractional and non-manual reasons', () => {
    const d = design();
    const v = inventory.createVariant(db, d.id, variantInput({ openingStock: 2 }));
    expect(() => inventory.adjustStock(db, { variantId: v.id, delta: 0, reason: 'purchase' })).toThrow(/Enter a quantity/);
    expect(() => inventory.adjustStock(db, { variantId: v.id, delta: 1.5, reason: 'purchase' })).toThrow(/whole number/);
    // @ts-expect-error – 'sale' is reserved for invoicing
    expect(() => inventory.adjustStock(db, { variantId: v.id, delta: 1, reason: 'sale' })).toThrow(/reason/);
  });

  it('snapshots unit cost on each movement', () => {
    const silk = materials.createMaterial(db, { name: 'Silk', unit: 'kg', unitCostPaise: 100000 });
    const d = design();
    const v = inventory.createVariant(db, d.id, variantInput({ openingStock: 1, baseCostPaise: 0, bom: [{ materialId: silk.id, qty: 1 }] }));
    materials.updateMaterial(db, silk.id, { name: 'Silk', unit: 'kg', unitCostPaise: 300000 });
    inventory.adjustStock(db, { variantId: v.id, delta: 1, reason: 'purchase' });
    const [latest, first] = inventory.listMovements(db, v.id);
    expect(first!.unitCostPaise).toBe(100000);
    expect(latest!.unitCostPaise).toBe(300000);
  });
});

describe('raw materials', () => {
  it('blocks deleting a material that costing depends on, then allows it once unused', () => {
    const silk = materials.createMaterial(db, { name: 'Silk', unit: 'kg', unitCostPaise: 1000 });
    const d = design();
    const v = inventory.createVariant(db, d.id, variantInput({ bom: [{ materialId: silk.id, qty: 1 }] }));
    expect(materials.getMaterial(db, silk.id).usedInCount).toBe(1);
    expect(() => materials.deleteMaterial(db, silk.id)).toThrow(/used in the costing of 1 variant/);
    inventory.updateVariant(db, v.id, variantInput({ bom: [] }));
    materials.deleteMaterial(db, silk.id);
    expect(materials.listMaterials(db)).toHaveLength(0);
  });

  it('rejects duplicate names', () => {
    materials.createMaterial(db, { name: 'Silk', unit: 'kg', unitCostPaise: 1 });
    expect(() => materials.createMaterial(db, { name: 'silk', unit: 'kg', unitCostPaise: 1 })).toThrow(/already exists/);
  });
});

describe('summary & sample data', () => {
  it('loads sample data once and produces consistent totals', () => {
    loadSampleData(db);
    const s = inventory.inventorySummary(db);
    expect(s.designCount).toBe(5);
    expect(s.variantCount).toBe(14);
    expect(s.materialCount).toBe(6);
    // 59 pieces opened, less the 14 the sample invoices sold (2+3, 2, 1, 3, 1+2); the cancelled one went back on the shelf.
    expect(s.unitsInStock).toBe(6 + 4 + 1 + 0 + 3 + 2 + 5 + 8 + 7 + 12 + 9 + 2 - 14);
    const listed = inventory.listDesigns(db);
    expect(listed.reduce((n, d) => n + d.stockValuePaise, 0)).toBe(s.stockValuePaise);
    expect(s.outOfStockDesigns).toBe(1); // Organza: both variants at zero
    expect(s.lowStockDesigns).toBe(4); // Mau Silk (low + out), Katan (low), Chanderi (low), Organza (out)
    expect(inventory.listDesigns(db, { status: 'out' }).map((d) => d.name)).toEqual(['Organza Floral Jaal']);
    expect(() => loadSampleData(db)).toThrow(/empty inventory/);
  });
});

describe('settings', () => {
  it('validates and persists', () => {
    expect(saveSettings(db, { gstRatePercent: 12, defaultReorderLevel: 3 })).toMatchObject({ gstRatePercent: 12, defaultReorderLevel: 3 });
    expect(() => saveSettings(db, { gstRatePercent: 120 })).toThrow(/between 0 and 100/);
    expect(() => saveSettings(db, { businessName: ' ' })).toThrow(/required/);
  });
});

describe('api envelope', () => {
  it('turns user errors into messages and unexpected errors into a generic one', async () => {
    const api = createApi(db);
    expect(await invoke(api, 'designGet', ['missing'])).toEqual({ ok: false, error: 'That design no longer exists.' });
    expect(await invoke(api, 'nope', [])).toMatchObject({ ok: false });
    expect(await invoke(api, 'designsList', [])).toEqual({ ok: true, data: [] });
    // force an internal (non-UserError) failure
    api.designsList = async () => { throw new Error('SQLITE_CORRUPT: secret path C:\\x'); };
    const failed = await invoke(api, 'designsList', []);
    expect(failed.ok).toBe(false);
    expect(JSON.stringify(failed)).not.toContain('SQLITE_CORRUPT');
  });
});

describe('design margin, price range, last sold and days of stock', () => {
  const sell = (variantId: string, qty: number, daysAgo = 0) =>
    invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: addDays(todayIso(), -daysAgo), dueDate: null, discountPaise: 0, notes: '', lines: [{ variantId, qty, unitPricePaise: 100000 }] });

  it('works out the price range and margin from the variants that have a price', () => {
    const d = design();
    inventory.createVariant(db, d.id, variantInput({ color: 'Red', sellPricePaise: 100000, baseCostPaise: 60000, openingStock: 5 }));
    inventory.createVariant(db, d.id, variantInput({ color: 'Blue', sellPricePaise: 200000, baseCostPaise: 100000, openingStock: 5 }));
    inventory.createVariant(db, d.id, variantInput({ color: 'Plain', sellPricePaise: 0, baseCostPaise: 50000, openingStock: 5 })); // unpriced: ignored
    const s = inventory.listDesigns(db)[0]!;
    expect(s).toMatchObject({ minPricePaise: 100000, maxPricePaise: 200000 });
    expect(s.marginPercent).toBeCloseTo(((300000 - 160000) / 300000) * 100, 5);
  });

  it('has no margin and no price range for a design nothing is priced on', () => {
    const d = design();
    inventory.createVariant(db, d.id, variantInput({ sellPricePaise: 0 }));
    expect(inventory.listDesigns(db)[0]).toMatchObject({ minPricePaise: 0, maxPricePaise: 0, marginPercent: null });
    expect(inventory.createDesign(db, { code: 'MG-002', name: 'Empty', fabric: '', hsnCode: '', description: '', defaultPricePaise: 0 })).toMatchObject({ marginPercent: null, lastSoldOn: null, daysOfStock: 0 });
  });

  it('knows when a design last sold and how long its stock will last at the recent pace', () => {
    const d = design();
    const v = inventory.createVariant(db, d.id, variantInput({ sellPricePaise: 100000, baseCostPaise: 0, openingStock: 40 }));
    expect(inventory.getDesign(db, d.id)).toMatchObject({ lastSoldOn: null, soldLast30Days: 0, daysOfStock: null }); // never sold: no pace to go by
    sell(v.id, 3, 5);
    sell(v.id, 7, 20);
    sell(v.id, 4, 50); // older than 30 days: the date counts, the pace doesn't
    const s = inventory.listDesigns(db)[0]!;
    expect(s.lastSoldOn).toBe(addDays(todayIso(), -5));
    expect(s.soldLast30Days).toBe(10);
    expect(s.totalStock).toBe(26); // 40 - 3 - 7 - 4
    expect(s.daysOfStock).toBe(Math.round(26 / (10 / 30))); // 78 days
    expect(inventory.getDesign(db, d.id).daysOfStock).toBe(78);
  });

  it('ignores cancelled invoices, and says 0 days when there is nothing left', () => {
    const d = design();
    const v = inventory.createVariant(db, d.id, variantInput({ sellPricePaise: 100000, baseCostPaise: 0, openingStock: 5 }));
    invoices.cancelInvoice(db, sell(v.id, 2).id, '');
    expect(inventory.listDesigns(db)[0]).toMatchObject({ lastSoldOn: null, soldLast30Days: 0, daysOfStock: null });
    sell(v.id, 5);
    expect(inventory.listDesigns(db)[0]).toMatchObject({ totalStock: 0, daysOfStock: 0, soldLast30Days: 5 });
  });
});

describe('design list filters', () => {
  const row = (over: Partial<DesignSummary>): DesignSummary => ({
    id: 'd', code: 'MG-1', name: 'D', nickname: '', tags: '', fabric: 'Silk', hsnCode: '', description: '', defaultPricePaise: 0, variantCount: 1, totalStock: 1, stockValuePaise: 0, status: 'ok',
    minPricePaise: 100000, maxPricePaise: 200000, marginPercent: 30, lastSoldOn: null, soldLast30Days: 0, daysOfStock: null, ...over,
  });
  const today = '2026-10-02';
  const names = (rows: DesignSummary[], f: Partial<DesignFilters>) => applyDesignFilters(rows, { ...NO_FILTERS, ...f }, today).map((r) => r.id);

  it('lets everything through when no filter is set', () => {
    expect(filtersActive(NO_FILTERS)).toBe(false);
    expect(names([row({ id: 'a' }), row({ id: 'b' })], {})).toEqual(['a', 'b']);
  });

  it('filters by fabric, ignoring case and stray spaces', () => {
    const rows = [row({ id: 'a', fabric: 'Silk' }), row({ id: 'b', fabric: ' cotton ' }), row({ id: 'c', fabric: '' })];
    expect(names(rows, { fabric: 'COTTON' })).toEqual(['b']);
    expect(fabricsOf([...rows, row({ fabric: 'silk' })])).toEqual(['cotton', 'Silk']);
  });

  it('filters by price range: a design matches if any of its prices falls in the range', () => {
    const rows = [row({ id: 'cheap', minPricePaise: 50000, maxPricePaise: 80000 }), row({ id: 'wide', minPricePaise: 90000, maxPricePaise: 300000 }), row({ id: 'dear', minPricePaise: 400000, maxPricePaise: 500000 }), row({ id: 'unpriced', minPricePaise: 0, maxPricePaise: 0 })];
    expect(names(rows, { minPricePaise: 100000 })).toEqual(['wide', 'dear']);
    expect(names(rows, { maxPricePaise: 95000 })).toEqual(['cheap', 'wide']);
    expect(names(rows, { minPricePaise: 100000, maxPricePaise: 350000 })).toEqual(['wide']);
  });

  it('filters by margin band, with the edges falling in the middle band', () => {
    const rows = [row({ id: 'n', marginPercent: null }), row({ id: 'low', marginPercent: 19.9 }), row({ id: 'e20', marginPercent: 20 }), row({ id: 'e40', marginPercent: 40 }), row({ id: 'high', marginPercent: 40.1 }), row({ id: 'loss', marginPercent: -5 })];
    expect(names(rows, { margin: 'none' })).toEqual(['n']);
    expect(names(rows, { margin: 'low' })).toEqual(['low', 'loss']);
    expect(names(rows, { margin: 'mid' })).toEqual(['e20', 'e40']);
    expect(names(rows, { margin: 'high' })).toEqual(['high']);
  });

  it('filters by when it last sold', () => {
    const rows = [row({ id: 'today', lastSoldOn: '2026-10-02' }), row({ id: 'day30', lastSoldOn: '2026-09-03' }), row({ id: 'day31', lastSoldOn: '2026-09-02' }), row({ id: 'old', lastSoldOn: '2026-05-01' }), row({ id: 'never', lastSoldOn: null })];
    expect(names(rows, { sold: 'recent' })).toEqual(['today', 'day30']);
    expect(names(rows, { sold: 'stale' })).toEqual(['old', 'never']);
    expect(names(rows, { sold: 'never' })).toEqual(['never']);
  });

  it('combines filters, and reports when any is active', () => {
    const rows = [row({ id: 'a', fabric: 'Silk', marginPercent: 50 }), row({ id: 'b', fabric: 'Silk', marginPercent: 10 }), row({ id: 'c', fabric: 'Cotton', marginPercent: 50 })];
    expect(names(rows, { fabric: 'Silk', margin: 'high' })).toEqual(['a']);
    expect(filtersActive({ ...NO_FILTERS, sold: 'never' })).toBe(true);
  });
});

describe('duplicate design', () => {
  it('copies the details, variants, prices and costing, but not the stock', () => {
    const silk = materials.createMaterial(db, { name: 'Silk yarn', unit: 'kg', unitCostPaise: 300000 });
    const d = design({ description: 'Hand woven', defaultPricePaise: 980000 });
    inventory.createVariant(db, d.id, variantInput({ color: 'Maroon', sellPricePaise: 1000000, mrpPaise: 1200000, baseCostPaise: 200000, reorderLevel: 3, openingStock: 7, bom: [{ materialId: silk.id, qty: 0.5 }] }));
    inventory.createVariant(db, d.id, variantInput({ color: 'Teal', size: '5.5 m', openingStock: 2 }));

    const copy = inventory.duplicateDesign(db, d.id);
    expect(copy.id).not.toBe(d.id);
    expect(copy).toMatchObject({ code: 'MG-002', name: 'Mau Silk Butidar (copy)', fabric: 'Silk', hsnCode: '5007', description: 'Hand woven', defaultPricePaise: 980000, variantCount: 2, totalStock: 0 });
    const maroon = copy.variants.find((v) => v.color === 'Maroon')!;
    expect(maroon).toMatchObject({ sellPricePaise: 1000000, mrpPaise: 1200000, baseCostPaise: 200000, reorderLevel: 3, stock: 0, materialCostPaise: 150000 });
    expect(maroon.bom).toHaveLength(1);
    expect(copy.variants.map((v) => v.sku)).not.toContain(d.variants?.[0]?.sku); // new SKUs from the new code
    expect(new Set([...copy.variants, ...inventory.getDesign(db, d.id).variants].map((v) => v.sku)).size).toBe(4);
    // The original is untouched.
    expect(inventory.getDesign(db, d.id)).toMatchObject({ name: 'Mau Silk Butidar', totalStock: 9 });
  });

  it('can be repeated, and refuses a design that is gone', () => {
    const d = design();
    inventory.createVariant(db, d.id, variantInput());
    expect(inventory.duplicateDesign(db, d.id).code).toBe('MG-002');
    expect(inventory.duplicateDesign(db, d.id).code).toBe('MG-003');
    inventory.archiveDesign(db, d.id);
    expect(() => inventory.duplicateDesign(db, d.id)).toThrow(/no longer exists/);
  });

  it('works through the API', async () => {
    const d = design();
    inventory.createVariant(db, d.id, variantInput());
    expect((await createApi(db).designDuplicate(d.id)).variantCount).toBe(1);
  });
});

describe('duplicate design keeps the code style', () => {
  it('continues a prefix other than MG', () => {
    const d = inventory.createDesign(db, { code: 'BN-007', name: 'Banarasi', fabric: '', hsnCode: '', description: '', defaultPricePaise: 0 });
    expect(inventory.duplicateDesign(db, d.id).code).toBe('BN-008');
  });
});
