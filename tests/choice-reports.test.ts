import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import { saveSettings } from '../electron/services/settings';
import { applyDesignFilters, choicesOf, filtersActive, NO_FILTERS } from '../shared/designFilters';
import { marginCsv } from '../shared/csv';
import { addDays, todayIso } from '../shared/gst';
import type { BulkSareeRow } from '../shared/types';

const rupees = (n: number) => n * 100;
const today = todayIso();
const range = { from: addDays(today, -30), to: today };
let db: Db;
let api: ReturnType<typeof createApi>;

beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { gstin: '09AABCK1234M1ZI' });
  api = createApi(db);
});

const row = (over: Partial<BulkSareeRow>): BulkSareeRow => ({ name: '', weaveStyle: 'Banarasi', fabric: 'Katan Silk', technique: 'Kadhua', pattern: 'Butidar', work: '', nickname: '', sku: '', color: 'Maroon', size: '6.3 m', hsn: '', mrpPaise: 0, sellPricePaise: rupees(10000), costPaise: rupees(6000), stock: 5, reorderLevel: 0, ...over });

async function sell(over: Partial<BulkSareeRow>, qty = 1) {
  const v = await api.inventoryQuickAdd(row(over));
  await api.invoiceCreate({ type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: v.variantId, qty, unitPricePaise: v.sellPricePaise }] });
  return v;
}

describe('margin by the choices a saree is made of', () => {
  beforeEach(async () => {
    await sell({ weaveStyle: 'Banarasi', fabric: 'Katan Silk', work: 'Zardozi Work, Aari Work' }, 2);
    await sell({ weaveStyle: 'Banarasi', fabric: 'Georgette', technique: 'Phekua', pattern: 'Jaal', work: 'Zardozi Work', color: 'Wine' });
    await sell({ weaveStyle: 'Chanderi', fabric: 'Cotton Silk', technique: '', pattern: '', work: '', color: 'Sky Blue', sellPricePaise: rupees(4000), costPaise: rupees(2500) });
  });

  it('groups sales, cost and profit by weave style, best profit first', async () => {
    const r = await api.reportMargin(range, 'weaveStyle');
    expect(r.rows.map((x) => [x.name, x.pieces, x.revenuePaise, x.profitPaise])).toEqual([['Banarasi', 3, rupees(30000), rupees(12000)], ['Chanderi', 1, rupees(4000), rupees(1500)]]);
    expect(r.totals).toMatchObject({ pieces: 4, revenuePaise: rupees(34000), profitPaise: rupees(13500) });
  });

  it('groups by fabric, technique and pattern, and puts a saree without one under Not set', async () => {
    const byTechnique = await api.reportMargin(range, 'technique');
    expect(Object.fromEntries(byTechnique.rows.map((x) => [x.name, x.pieces]))).toEqual({ Kadhua: 2, Phekua: 1, 'Not set': 1 });
    const byPattern = await api.reportMargin(range, 'pattern');
    expect(byPattern.rows.map((x) => x.name).sort()).toEqual(['Butidar', 'Jaal', 'Not set']);
    expect((await api.reportMargin(range, 'fabric')).rows).toHaveLength(3);
  });

  it('counts a saree under each of its works, but never counts a sale twice in the totals', async () => {
    const r = await api.reportMargin(range, 'work');
    const zardozi = r.rows.find((x) => x.name === 'Zardozi Work')!;
    const aari = r.rows.find((x) => x.name === 'Aari Work')!;
    expect(zardozi.pieces).toBe(3); // the two Katan Silk sarees and the Georgette one
    expect(aari.pieces).toBe(2);
    expect(r.rows.reduce((s, x) => s + x.pieces, 0)).toBeGreaterThan(r.totals.pieces); // overlapping groups
    expect(r.totals).toMatchObject({ pieces: 4, revenuePaise: rupees(34000) });
  });

  it('shows the invoice lines behind a row, and exports under its own heading', async () => {
    const lines = await api.reportMarginDrill(range, 'work', 'zardozi work');
    expect(lines).toHaveLength(2);
    expect(lines.reduce((s, l) => s + l.qty, 0)).toBe(3);
    expect(marginCsv(await api.reportMargin(range, 'weaveStyle'))).toContain('Margin by weave style');
  });

  it('refuses something it can not group by', async () => {
    await expect(api.reportMargin(range, 'zodiac' as never)).rejects.toThrow(/what to group the margin by/);
  });
});

describe('filtering the design list by the choices', () => {
  it('finds designs by weave style, technique, pattern or one of their works, ignoring capitals', async () => {
    await api.inventoryQuickAdd(row({ work: 'Zardozi Work, Aari Work' }));
    await api.inventoryQuickAdd(row({ weaveStyle: 'Chanderi', fabric: 'Cotton Silk', technique: '', pattern: 'Jaal', work: 'Aari Work', color: 'Wine' }));
    const designs = await api.designsList();
    const names = (f: Partial<typeof NO_FILTERS>) => applyDesignFilters(designs, { ...NO_FILTERS, ...f }, today).map((d) => d.weaveStyle);
    expect(names({ weaveStyle: 'banarasi' })).toEqual(['Banarasi']);
    expect(names({ pattern: 'Jaal' })).toEqual(['Chanderi']);
    expect(names({ technique: 'Kadhua' })).toEqual(['Banarasi']);
    expect(names({ work: 'aari work' }).sort()).toEqual(['Banarasi', 'Chanderi']);
    expect(names({ work: 'Zardozi Work' })).toEqual(['Banarasi']);
    expect(names({ work: 'Gota Patti Work' })).toEqual([]);
    expect(filtersActive({ ...NO_FILTERS, work: 'Aari Work' })).toBe(true);
  });

  it('lists the choices in use once each, with works one by one', async () => {
    await api.inventoryQuickAdd(row({ work: 'Zardozi Work, Aari Work' }));
    await api.inventoryQuickAdd(row({ work: 'Aari Work', color: 'Wine' }));
    const designs = await api.designsList();
    expect(choicesOf(designs, 'work')).toEqual(['Aari Work', 'Zardozi Work']);
    expect(choicesOf(designs, 'weaveStyle')).toEqual(['Banarasi']);
  });
});
