import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../electron/db/connection';
import { bulkChangeDesigns } from '../electron/services/bulk';
import * as inventory from '../electron/services/inventory';
import { applyDesignFilters, filtersActive, NO_FILTERS } from '../shared/designFilters';
import { todayIso } from '../shared/gst';

const rupees = (n: number) => n * 100;
let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});

const design = (over: Partial<Parameters<typeof inventory.createDesign>[1]> = {}) =>
  inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: 'Silk', hsnCode: '5007', description: '', defaultPricePaise: rupees(1000), ...over });
const variant = (designId: string, over: Partial<Parameters<typeof inventory.createVariant>[2]> = {}) =>
  inventory.createVariant(db, designId, { color: 'Red', size: '6 m', sellPricePaise: rupees(1000), baseCostPaise: rupees(400), reorderLevel: 0, openingStock: 0, bom: [], ...over });

describe('design tags', () => {
  it('saves them tidied, finds a design by tag, and carries them to a duplicate', () => {
    const d = design({ tags: 'Bridal, bridal,  festive ' });
    expect(d.tags).toBe('Bridal, festive');
    design({ code: 'MG-002', name: 'Plain' });
    expect(inventory.listDesigns(db, { search: 'festive' }).map((x) => x.code)).toEqual(['MG-001']);
    expect(inventory.duplicateDesign(db, d.id).tags).toBe('Bridal, festive');
    expect(inventory.updateDesign(db, d.id, { ...d, tags: 'summer' }).tags).toBe('summer');
  });

  it('filters the list by tag, ignoring case', () => {
    design({ tags: 'bridal' });
    design({ code: 'MG-002', name: 'Plain', tags: 'daily' });
    const rows = inventory.listDesigns(db);
    const only = applyDesignFilters(rows, { ...NO_FILTERS, tag: 'BRIDAL' }, todayIso());
    expect(only.map((r) => r.code)).toEqual(['MG-001']);
    expect(filtersActive({ ...NO_FILTERS, tag: 'x' })).toBe(true);
  });
});

describe('price history', () => {
  it('starts with the first price and adds a line only when a price actually changes', () => {
    const d = design();
    const v = variant(d.id);
    expect(inventory.variantPriceHistory(db, v.id)).toHaveLength(1);
    expect(inventory.variantPriceHistory(db, v.id)[0]).toMatchObject({ sellPricePaise: rupees(1000), baseCostPaise: rupees(400), mrpPaise: 0 });

    // Changing something that is not a price adds nothing.
    inventory.updateVariant(db, v.id, { color: 'Red', size: '6 m', sellPricePaise: rupees(1000), baseCostPaise: rupees(400), reorderLevel: 5, bom: [] });
    expect(inventory.variantPriceHistory(db, v.id)).toHaveLength(1);

    inventory.updateVariant(db, v.id, { color: 'Red', size: '6 m', sellPricePaise: rupees(1200), mrpPaise: rupees(1500), baseCostPaise: rupees(400), reorderLevel: 5, bom: [] });
    const h = inventory.variantPriceHistory(db, v.id);
    expect(h.map((p) => p.sellPricePaise)).toEqual([rupees(1200), rupees(1000)]); // newest first
    expect(h[0].mrpPaise).toBe(rupees(1500));
  });

  it('records a bulk price change for every variant touched', () => {
    const d = design();
    const a = variant(d.id);
    const b = variant(d.id, { color: 'Blue' });
    bulkChangeDesigns(db, { ids: [d.id], kind: 'price', mode: 'percent', value: 10 });
    expect(inventory.variantPriceHistory(db, a.id).map((p) => p.sellPricePaise)).toEqual([rupees(1100), rupees(1000)]);
    expect(inventory.variantPriceHistory(db, b.id)).toHaveLength(2);
  });

  it('is refused for a variant that does not exist', () => {
    expect(() => inventory.variantPriceHistory(db, 'nope')).toThrow(/no longer exists/);
  });
});
