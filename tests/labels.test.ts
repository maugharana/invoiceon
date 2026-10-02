import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import { checkLabels, labelItems, labelsRoute } from '../electron/services/labels';
import { saveSettings } from '../electron/services/settings';
import { LABEL_LAYOUTS } from '../shared/types';

const rupees = (n: number) => n * 100;
let db: Db;
let api: ReturnType<typeof createApi>;
let withMrp: string;
let withoutMrp: string;

beforeEach(async () => {
  db = openDb(':memory:');
  saveSettings(db, { businessName: 'Mau Gharana', gstRatePercent: 5 });
  api = createApi(db);
  const d = await api.designCreate({ code: 'MG-1', name: 'Banarasi Katan Kadhua', fabric: '', hsnCode: '', description: '', defaultPricePaise: 0 });
  withMrp = (await api.variantCreate(d.id, { color: 'Maroon', size: '6.3 m', sellPricePaise: rupees(10000), mrpPaise: rupees(13000), baseCostPaise: 0, reorderLevel: 0, openingStock: 3, bom: [] })).id;
  withoutMrp = (await api.variantCreate(d.id, { color: 'Wine', size: '6.3 m', sellPricePaise: rupees(10000), baseCostPaise: 0, reorderLevel: 0, openingStock: 1, bom: [] })).id;
});

describe('labels', () => {
  it('carries what a label shows, pricing it as the shopper pays: the MRP, or the selling price plus GST', () => {
    const [a, b] = labelItems(db, [withMrp, withoutMrp]);
    expect(a).toMatchObject({ designName: 'Banarasi Katan Kadhua', color: 'Maroon', size: '6.3 m', shop: 'Mau Gharana', pricePaise: rupees(13000) });
    expect(a!.sku).toMatch(/^MG-1-/);
    expect(b!.pricePaise).toBe(rupees(10500));
  });

  it('keeps the order asked for and leaves out pieces that no longer exist', async () => {
    expect(labelItems(db, [withoutMrp, 'gone', withMrp]).map((l) => l.color)).toEqual(['Wine', 'Maroon']);
    await api.variantArchive(withMrp);
    expect(labelItems(db, [withMrp, withoutMrp]).map((l) => l.color)).toEqual(['Wine']);
  });

  it('refuses an empty request, no copies, too many, an unknown layout, and pieces that are all gone', () => {
    const ok = [{ variantId: withMrp, copies: 2 }];
    expect(() => checkLabels(db, ok, 'a4-24')).not.toThrow();
    expect(() => checkLabels(db, [], 'a4-24')).toThrow(/at least one piece/);
    expect(() => checkLabels(db, [{ variantId: withMrp, copies: 0 }], 'a4-24')).toThrow(/how many labels/);
    expect(() => checkLabels(db, [{ variantId: withMrp, copies: 5000 }], 'a4-24')).toThrow(/up to 2000/);
    expect(() => checkLabels(db, ok, 'poster' as never)).toThrow(/layout/);
    expect(() => checkLabels(db, [{ variantId: 'gone', copies: 1 }], 'roll')).toThrow(/no longer exist|any more/);
  });

  it('builds the print window address from the items, leaving out any with no copies', () => {
    expect(labelsRoute([{ variantId: 'a b', copies: 2 }, { variantId: 'c', copies: 0 }, { variantId: 'd', copies: 1 }], 'roll')).toBe('/print/labels?items=a%20b:2,d:1&layout=roll');
  });

  it('has sheets whose labels fill an A4 page', () => {
    for (const key of ['a4-24', 'a4-40'] as const) {
      const l = LABEL_LAYOUTS[key];
      expect(l.columns * l.widthMm).toBeLessThanOrEqual(210);
      expect(l.rows * l.heightMm).toBeLessThanOrEqual(297);
    }
    expect(LABEL_LAYOUTS['a4-24'].columns * LABEL_LAYOUTS['a4-24'].rows).toBe(24);
    expect(LABEL_LAYOUTS['a4-40'].columns * LABEL_LAYOUTS['a4-40'].rows).toBe(40);
  });
});
