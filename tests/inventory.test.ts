import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, tx, type Db } from '../electron/db/connection';
import { LATEST_SCHEMA_VERSION } from '../electron/db/migrations';
import { createApi, invoke } from '../electron/api';
import * as inventory from '../electron/services/inventory';
import * as materials from '../electron/services/materials';
import { loadSampleData } from '../electron/services/seed';
import { getSettings, saveSettings } from '../electron/services/settings';
import { UserError } from '../electron/services/common';
import { formatMoney, mulPaise, parseMoney } from '../shared/money';
import { designStatus, variantStatus } from '../shared/stock';

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
