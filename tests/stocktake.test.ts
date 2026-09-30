import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../electron/db/connection';
import { integrityCheck } from '../electron/services/integrity';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import { saveSettings } from '../electron/services/settings';
import * as take from '../electron/services/stocktake';
import { todayIso } from '../shared/gst';
import { adjustmentFor, varianceOf } from '../shared/stocktake';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { state: 'Uttar Pradesh', gstin: '09AAACH7409R1ZZ', gstRatePercent: 5 });
});

const rupees = (n: number) => n * 100;
const today = todayIso();

function design(code: string, colours: { color: string; stock: number }[], cost = 400) {
  const d = inventory.createDesign(db, { code, name: `Design ${code}`, fabric: '', hsnCode: '5007', description: '', defaultPricePaise: rupees(1000) });
  const variants = colours.map((c) => inventory.createVariant(db, d.id, { color: c.color, size: '5.5 m', sellPricePaise: rupees(1000), baseCostPaise: rupees(cost), reorderLevel: 0, openingStock: c.stock, bom: [] }));
  return { d, variants };
}
const sell = (variantId: string, qty: number) =>
  invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId, qty, unitPricePaise: rupees(1000) }] });
const stockOf = (id: string) => inventory.getVariant(db, id).stock;
const start = (name = 'Diwali count', designId: string | null = null) => take.startTake(db, { name, designId });
const lineOf = (t: { lines: { variantId: string }[] }, id: string) => t.lines.find((l) => l.variantId === id) as ReturnType<typeof take.currentTake> extends infer T ? (T extends { lines: (infer L)[] } ? L : never) : never;

describe('the maths', () => {
  it('measures a count against what the books said when it was counted', () => {
    expect(varianceOf(8, 10)).toBe(-2);
    expect(varianceOf(12, 10)).toBe(2);
    expect(varianceOf(10, 10)).toBe(0);
    expect(varianceOf(null, 10)).toBeNull();
    expect(varianceOf(5, null)).toBeNull();
  });

  it('never adjusts below zero', () => {
    expect(adjustmentFor(-2, 9)).toEqual({ delta: -2, clamped: false });
    expect(adjustmentFor(-5, 1)).toEqual({ delta: -1, clamped: true });
    expect(adjustmentFor(3, 0)).toEqual({ delta: 3, clamped: false });
  });
});

describe('starting a count', () => {
  it('lists every saree, uncounted, and there can be only one at a time', () => {
    design('MG-1', [{ color: 'Red', stock: 5 }, { color: 'Blue', stock: 2 }]);
    design('MG-2', [{ color: 'Green', stock: 7 }]);
    const t = start();
    expect(t).toMatchObject({ name: 'Diwali count', status: 'open', totals: { lines: 3, counted: 0, differences: 0 } });
    expect(t.lines.every((l) => l.counted === null && l.variance === null)).toBe(true);
    expect(take.currentTake(db)?.id).toBe(t.id);
    expect(() => start('Second')).toThrow(/already in progress/);
  });

  it('can be limited to one design', () => {
    const a = design('MG-1', [{ color: 'Red', stock: 5 }]);
    design('MG-2', [{ color: 'Green', stock: 7 }]);
    expect(start('Just A', a.d.id).lines.map((l) => l.designName)).toEqual(['Design MG-1']);
  });

  it('checks the name, the design, and that there is something to count', () => {
    expect(() => start('')).toThrow(/Name/);
    expect(() => start('Empty')).toThrow(/no sarees to count/);
    expect(take.currentTake(db)).toBeNull(); // the failed start left nothing behind
    expect(() => start('X', 'nope')).toThrow(/no longer exists/);
  });
});

describe('counting', () => {
  it('records the count and the difference from the books at that moment', () => {
    const { variants } = design('MG-1', [{ color: 'Red', stock: 10 }]);
    const t = start();
    const after = take.countLine(db, t.id, variants[0]!.id, 8);
    expect(lineOf(after, variants[0]!.id)).toMatchObject({ counted: 8, expectedAtCount: 10, variance: -2, systemNow: 10 });
    expect(after.totals).toMatchObject({ counted: 1, differences: 1, shortagePieces: 2, surplusPieces: 0, varianceCostPaise: -2 * rupees(400) });
  });

  it('can be recounted or cleared', () => {
    const { variants } = design('MG-1', [{ color: 'Red', stock: 10 }]);
    const t = start();
    take.countLine(db, t.id, variants[0]!.id, 8);
    expect(lineOf(take.countLine(db, t.id, variants[0]!.id, 10), variants[0]!.id)).toMatchObject({ counted: 10, variance: 0 });
    expect(lineOf(take.countLine(db, t.id, variants[0]!.id, null), variants[0]!.id)).toMatchObject({ counted: null, variance: null });
  });

  it('is not thrown off by sales made while the count goes on', () => {
    const { variants } = design('MG-1', [{ color: 'Red', stock: 10 }]);
    const t = start();
    take.countLine(db, t.id, variants[0]!.id, 8); // the shelf holds 8 against 10 in the books
    sell(variants[0]!.id, 1); // and one is sold afterwards
    const now = take.currentTake(db)!;
    expect(lineOf(now, variants[0]!.id)).toMatchObject({ variance: -2, expectedAtCount: 10, systemNow: 9 });
    take.applyTake(db, t.id);
    expect(stockOf(variants[0]!.id)).toBe(7); // 8 on the shelf then, less the one sold
  });

  it('checks what it is given', () => {
    const { variants } = design('MG-1', [{ color: 'Red', stock: 10 }]);
    const other = design('MG-2', [{ color: 'Blue', stock: 1 }]).variants[0]!;
    const t = start('Only A', undefined as never);
    void other;
    expect(() => take.countLine(db, t.id, variants[0]!.id, -1)).toThrow(/Count/);
    expect(() => take.countLine(db, t.id, variants[0]!.id, 1.5)).toThrow(/Count/);
    expect(() => take.countLine(db, t.id, variants[0]!.id, 10_000_000)).toThrow(/Count/);
    expect(() => take.countLine(db, t.id, 'nope', 1)).toThrow(/not part of this count/);
    expect(() => take.countLine(db, 'nope', variants[0]!.id, 1)).toThrow(/no longer exists/);
  });

  it('leaves out a saree that is not in the count, and one archived since', () => {
    const a = design('MG-1', [{ color: 'Red', stock: 10 }]);
    const b = design('MG-2', [{ color: 'Blue', stock: 4 }]);
    const t = start('Just A', a.d.id);
    expect(() => take.countLine(db, t.id, b.variants[0]!.id, 4)).toThrow(/not part of this count/);
    inventory.archiveVariant(db, a.variants[0]!.id);
    expect(take.currentTake(db)!.lines).toEqual([]);
  });
});

describe('applying a count', () => {
  it('adjusts only what was counted and differs, and leaves the rest alone', () => {
    const { variants } = design('MG-1', [{ color: 'Red', stock: 10 }, { color: 'Blue', stock: 5 }, { color: 'Green', stock: 3 }, { color: 'Pink', stock: 6 }]);
    const [red, blue, green, pink] = variants as [typeof variants[0], typeof variants[0], typeof variants[0], typeof variants[0]];
    const t = start();
    take.countLine(db, t.id, red.id, 8); // short 2
    take.countLine(db, t.id, blue.id, 7); // surplus 2
    take.countLine(db, t.id, green.id, 3); // right
    // pink is never counted
    const result = take.applyTake(db, t.id);
    expect(result).toMatchObject({ adjusted: 2, clamped: [] });
    expect(result.take).toMatchObject({ status: 'applied', totals: { counted: 3, differences: 2, surplusPieces: 2, shortagePieces: 2 } });
    expect([red.id, blue.id, green.id, pink.id].map(stockOf)).toEqual([8, 7, 3, 6]);
    expect(take.currentTake(db)).toBeNull();
  });

  it('writes each adjustment into the stock history, naming the count', () => {
    const { variants } = design('MG-1', [{ color: 'Red', stock: 10 }]);
    const t = start('Diwali count');
    take.countLine(db, t.id, variants[0]!.id, 6);
    take.applyTake(db, t.id);
    expect(inventory.listMovements(db, variants[0]!.id)[0]).toMatchObject({ delta: -4, reason: 'adjustment', note: 'Stock take: Diwali count' });
    expect(integrityCheck(db).checks.find((c) => c.id === 'stock')!.problemCount).toBe(0);
  });

  it('sets stock to zero, not below, when sales since the count were more than the shortage allows', () => {
    const { variants } = design('MG-1', [{ color: 'Red', stock: 5 }]);
    const v = variants[0]!;
    const t = start();
    take.countLine(db, t.id, v.id, 0); // the shelf was empty: 5 short
    sell(v.id, 4); // yet four are sold afterwards: the books now hold 1
    const result = take.applyTake(db, t.id);
    expect(stockOf(v.id)).toBe(0);
    expect(result.adjusted).toBe(1);
    expect(result.clamped).toHaveLength(1);
    expect(result.clamped[0]).toMatch(/counted 0, but 1 is all the books hold now/);
  });

  it('can be applied, cancelled or counted only while open', () => {
    const { variants } = design('MG-1', [{ color: 'Red', stock: 5 }]);
    const t = start();
    take.applyTake(db, t.id);
    expect(() => take.applyTake(db, t.id)).toThrow(/is applied/);
    expect(() => take.cancelTake(db, t.id)).toThrow(/is applied/);
    expect(() => take.countLine(db, t.id, variants[0]!.id, 1)).toThrow(/is applied/);
    expect(() => take.applyTake(db, 'nope')).toThrow(/no longer exists/);
  });

  it('can be cancelled, changing nothing, and then a new one can begin', () => {
    const { variants } = design('MG-1', [{ color: 'Red', stock: 5 }]);
    const t = start();
    take.countLine(db, t.id, variants[0]!.id, 1);
    take.cancelTake(db, t.id);
    expect(stockOf(variants[0]!.id)).toBe(5);
    expect(take.currentTake(db)).toBeNull();
    expect(start('Again').status).toBe('open');
  });
});

describe('the history', () => {
  it('lists finished counts newest first with what they found', () => {
    const { variants } = design('MG-1', [{ color: 'Red', stock: 10 }]);
    const first = start('First');
    take.countLine(db, first.id, variants[0]!.id, 9);
    take.applyTake(db, first.id);
    const second = start('Second');
    take.cancelTake(db, second.id);
    const list = take.listTakes(db);
    expect(list.map((t) => [t.name, t.status])).toEqual([['Second', 'cancelled'], ['First', 'applied']]);
    expect(list[1]!.totals).toMatchObject({ counted: 1, differences: 1, shortagePieces: 1 });
  });
});
