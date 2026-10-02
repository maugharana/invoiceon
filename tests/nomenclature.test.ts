import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import { buildDesignName, buildPieceTitle, DEFAULT_OPTIONS, splitWorks } from '../shared/nomenclature';
import type { BulkSareeRow } from '../shared/types';

describe('saree names', () => {
  it('leads with what shoppers search and puts the special name last', () => {
    const p = { weaveStyle: 'Banarasi', fabric: 'Katan Silk', technique: 'Kadhua', work: 'Zardozi Work', specialName: 'Lalima' };
    expect(buildDesignName(p)).toBe('Banarasi Katan Silk Kadhua Saree with Zardozi Work, Lalima');
    expect(buildPieceTitle(p, 'Maroon')).toBe('Maroon Banarasi Katan Silk Kadhua Saree with Zardozi Work, Lalima');
  });

  it('puts the pattern after the technique, and keeps a phrase as the special name', () => {
    const p = { weaveStyle: 'Banarasi', fabric: 'Katan Silk', technique: 'Kadhua', pattern: 'Jaal', specialName: 'Rang Bahar' };
    expect(buildDesignName(p)).toBe('Banarasi Katan Silk Kadhua Jaal Saree, Rang Bahar');
    expect(buildPieceTitle({ ...p, pattern: 'Butidar' }, 'Wine')).toBe('Wine Banarasi Katan Silk Kadhua Butidar Saree, Rang Bahar');
  });

  it('skips what is not set, and joins several works in plain English', () => {
    expect(buildDesignName({ weaveStyle: 'Chanderi', fabric: 'Pure Silk' })).toBe('Chanderi Pure Silk Saree');
    expect(buildDesignName({ weaveStyle: 'Banarasi', work: 'Zardozi Work, Aari Work' })).toBe('Banarasi Saree with Zardozi Work and Aari Work');
    expect(buildDesignName({ weaveStyle: 'Banarasi', work: 'Zardozi Work, Aari Work, Gota Patti Work' })).toBe('Banarasi Saree with Zardozi Work, Aari Work and Gota Patti Work');
    expect(buildDesignName({ work: 'Chikankari Work' })).toBe('Saree with Chikankari Work');
  });

  it('builds nothing from a special name alone, so a typed name is never replaced by a bare "Saree"', () => {
    expect(buildDesignName({ specialName: 'Lalima' })).toBe('');
    expect(buildPieceTitle({ weaveStyle: 'Banarasi' }, '  ')).toBe('Banarasi Saree');
  });

  it('splits works on commas, ignoring spacing, blanks and repeats', () => {
    expect(splitWorks(' Zardozi Work ,, aari work, Zardozi Work ')).toEqual(['Zardozi Work', 'aari work']);
    expect(splitWorks(undefined)).toEqual([]);
  });
});

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});

const row = (over: Partial<BulkSareeRow> = {}): BulkSareeRow => ({
  name: '',
  weaveStyle: 'Banarasi',
  fabric: 'Katan Silk',
  technique: 'Kadhua',
  pattern: '',
  work: 'Zardozi Work',
  nickname: 'Lalima',
  sku: '',
  color: 'Maroon',
  size: '6.3 m',
  hsn: '',
  mrpPaise: 0,
  sellPricePaise: 1850000,
  costPaise: 1200000,
  stock: 1,
  reorderLevel: 0,
  ...over,
});

describe('entering a saree by its choices', () => {
  it('names the design from the choices and keeps each choice as its own field', async () => {
    const api = createApi(db);
    const made = await api.inventoryQuickAdd(row());
    expect(made.designName).toBe('Banarasi Katan Silk Kadhua Saree with Zardozi Work, Lalima');
    const [design] = await api.designsList();
    expect(design).toMatchObject({ weaveStyle: 'Banarasi', fabric: 'Katan Silk', technique: 'Kadhua', work: 'Zardozi Work', nickname: 'Lalima' });
  });

  it('puts a second colour of the same choices under the same design', async () => {
    const api = createApi(db);
    await api.inventoryQuickAdd(row());
    const second = await api.inventoryQuickAdd(row({ color: 'Emerald Green' }));
    expect(second.designName).toBe('Banarasi Katan Silk Kadhua Saree with Zardozi Work, Lalima');
    expect(await api.designsList()).toHaveLength(1);
    expect((await api.variantsForSale()).map((v) => v.color).sort()).toEqual(['Emerald Green', 'Maroon']);
  });

  it('keeps the cost price, so the first sale already has a profit', async () => {
    const api = createApi(db);
    const made = await api.inventoryQuickAdd(row());
    const inv = await api.invoiceCreate({ type: 'B2C', customerId: null, issueDate: '2026-05-10', dueDate: '2026-05-10', discountPaise: 0, notes: '', lines: [{ variantId: made.variantId, qty: 1, unitPricePaise: made.sellPricePaise }] });
    expect(inv.lines).toHaveLength(1);
    const [design] = await api.designGet((await api.designsList())[0]!.id).then((d) => [d]);
    expect(design!.variants[0]).toMatchObject({ baseCostPaise: 1200000, sellPricePaise: 1850000 });
  });

  it('keeps one pattern per design, and offers it as a choice next time', async () => {
    const api = createApi(db);
    const made = await api.inventoryQuickAdd(row({ pattern: 'Jaal', work: '' }));
    expect(made.designName).toBe('Banarasi Katan Silk Kadhua Jaal Saree, Lalima');
    expect((await api.designsList())[0]).toMatchObject({ pattern: 'Jaal' });
    // A Butidar piece is a different design from a Jaal one, never a colour of it.
    await api.inventoryQuickAdd(row({ pattern: 'Butidar', work: '' }));
    expect(await api.designsList()).toHaveLength(2);
    await api.inventoryQuickAdd(row({ pattern: 'Kamal Buti', work: '', color: 'Wine' }));
    expect((await api.catalogueOptions()).pattern).toContain('Kamal Buti');
  });

  it('lets a design be named by hand, and builds the name when none is given', async () => {
    const api = createApi(db);
    const handmade = await api.designCreate({ code: 'MG-900', name: 'Our Special Piece', fabric: '', hsnCode: '', description: '', defaultPricePaise: 0, weaveStyle: 'Paithani' });
    expect(handmade.name).toBe('Our Special Piece');
    const built = await api.designCreate({ code: 'MG-901', name: '', fabric: 'Pure Silk', hsnCode: '', description: '', defaultPricePaise: 0, weaveStyle: 'Paithani', work: 'Aari Work, Aari Work' });
    expect(built.name).toBe('Paithani Pure Silk Saree with Aari Work');
    expect(built.work).toBe('Aari Work');
  });

  it('refuses a row with no name and nothing to build one from', async () => {
    await expect(createApi(db).inventoryQuickAdd(row({ weaveStyle: '', fabric: '', technique: '', work: '' }))).rejects.toThrow(/Saree name is required/);
  });
});

describe('pick lists', () => {
  it('start with the common choices, and gain what the shop adds or already uses', async () => {
    const api = createApi(db);
    const start = await api.catalogueOptions();
    expect(start.weaveStyle.slice(0, 3)).toEqual(['Banarasi', 'Kanjivaram', 'Chanderi']);
    expect(start.technique).toContain('Kadhua');
    expect(start.work).toContain('Zardozi Work');
    expect(start.pattern).toEqual(expect.arrayContaining(['Butidar', 'Jaal']));

    await api.inventoryQuickAdd(row({ technique: 'Dhaga Buti', work: 'Aari Work, Sona Chandi Work', color: 'Peacock Teal', weaveStyle: 'banarasi' }));
    const after = await api.catalogueOptions();
    expect(after.technique).toContain('Dhaga Buti');
    expect(after.work).toContain('Sona Chandi Work');
    expect(after.colour).toContain('Peacock Teal');
    // "banarasi" is the same choice as "Banarasi": not listed twice.
    expect(after.weaveStyle.filter((w) => w.toLowerCase() === 'banarasi')).toHaveLength(1);
    expect(after.weaveStyle.length).toBe(DEFAULT_OPTIONS.weaveStyle.length);
  });

  it('include fabrics and colours already in stock from before these fields existed', async () => {
    const api = createApi(db);
    const d = await api.designCreate({ code: 'MG-1', name: 'Old Saree', fabric: 'Moonga Blend', hsnCode: '', description: '', defaultPricePaise: 0 });
    await api.variantCreate(d.id, { color: 'Sandstone', size: '6.3 m', sellPricePaise: 100, baseCostPaise: 0, reorderLevel: 0, bom: [] });
    const o = await api.catalogueOptions();
    expect(o.fabric).toContain('Moonga Blend');
    expect(o.colour).toContain('Sandstone');
  });
});
