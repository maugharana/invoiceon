import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../electron/db/connection';
import * as creditNotes from '../electron/services/creditNotes';
import * as inventory from '../electron/services/inventory';
import { stockInsights } from '../electron/services/insights';
import * as invoices from '../electron/services/invoices';
import { saveSettings } from '../electron/services/settings';
import * as weavers from '../electron/services/weavers';
import { addDays, todayIso } from '../shared/gst';
import { DEFAULT_INSIGHTS, checkParams, daysOfCover, isUrgent, perDay, suggestedQty } from '../shared/insights';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { state: 'Uttar Pradesh', gstin: '09AAACH7409R1ZZ', gstRatePercent: 5 });
});

const rupees = (n: number) => n * 100;
const today = todayIso();

function piece(code: string, stock: number, reorderLevel = 0, cost = 400) {
  const d = inventory.createDesign(db, { code, name: `Design ${code}`, fabric: '', hsnCode: '5007', description: '', defaultPricePaise: rupees(1000) });
  const v = inventory.createVariant(db, d.id, { color: 'Red', size: '5.5 m', sellPricePaise: rupees(1000), baseCostPaise: rupees(cost), reorderLevel, openingStock: stock, bom: [] });
  return v;
}
const sell = (variantId: string, qty: number, daysAgo: number) =>
  invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: addDays(today, -daysAgo), dueDate: addDays(today, -daysAgo), discountPaise: 0, notes: '', lines: [{ variantId, qty, unitPricePaise: rupees(1000) }] });
/** Makes a piece look as though it was added long ago. */
const addedDaysAgo = (variantId: string, days: number) => db.prepare('UPDATE variants SET created_at = ? WHERE id = ?').run(`${addDays(today, -days)}T10:00:00.000Z`, variantId);

describe('the reorder maths', () => {
  it('covers the lead time plus the cover days, less what is on the shelf and on order', () => {
    // 1 a day, 21 days to arrive, 30 days of cover: 51 needed.
    expect(suggestedQty({ stock: 5, onOrder: 0, perDay: 1, reorderLevel: 0, leadDays: 21, coverDays: 30 })).toBe(46);
    expect(suggestedQty({ stock: 5, onOrder: 20, perDay: 1, reorderLevel: 0, leadDays: 21, coverDays: 30 })).toBe(26);
    expect(suggestedQty({ stock: 60, onOrder: 0, perDay: 1, reorderLevel: 0, leadDays: 21, coverDays: 30 })).toBe(0); // plenty
  });

  it('rounds up, and is never negative', () => {
    expect(suggestedQty({ stock: 0, onOrder: 0, perDay: 0.1, reorderLevel: 0, leadDays: 21, coverDays: 30 })).toBe(6); // 5.1
    expect(suggestedQty({ stock: 500, onOrder: 500, perDay: 1, reorderLevel: 0, leadDays: 21, coverDays: 30 })).toBe(0);
  });

  it('never lets a piece sit below its reorder level, even when it is not selling', () => {
    expect(suggestedQty({ stock: 1, onOrder: 0, perDay: 0, reorderLevel: 5, leadDays: 21, coverDays: 30 })).toBe(4);
    expect(suggestedQty({ stock: 6, onOrder: 0, perDay: 0, reorderLevel: 5, leadDays: 21, coverDays: 30 })).toBe(0);
    expect(suggestedQty({ stock: 0, onOrder: 0, perDay: 0, reorderLevel: 0, leadDays: 21, coverDays: 30 })).toBe(0); // nothing sells, no level: leave it
  });

  it('knows how long stock lasts, and what is urgent', () => {
    expect(perDay(30, 90)).toBeCloseTo(0.333, 3);
    expect(perDay(5, 0)).toBe(0);
    expect(daysOfCover(10, 2)).toBe(5);
    expect(daysOfCover(10, 0)).toBeNull();
    expect(isUrgent(5, 1, 21, 0)).toBe(true); // 5 days left, a batch takes 21
    expect(isUrgent(30, 1, 21, 0)).toBe(false);
    expect(isUrgent(0, 1, 21, 0)).toBe(true);
    expect(isUrgent(5, 1, 21, 10)).toBe(false); // already ordered
    expect(isUrgent(0, 0, 21, 0)).toBe(false); // nothing sells: not urgent
  });

  it('keeps sensible settings and ignores nonsense', () => {
    expect(checkParams(undefined)).toEqual(DEFAULT_INSIGHTS);
    expect(checkParams({ lookbackDays: 30, leadDays: 0 })).toMatchObject({ lookbackDays: 30, leadDays: 0, coverDays: 30, deadDays: 90 });
    expect(checkParams({ lookbackDays: -5, coverDays: 1.5, deadDays: 99999, leadDays: 'soon' as never })).toEqual(DEFAULT_INSIGHTS);
  });
});

/** The shelf count is set directly, so a test can say "sold 30, 5 left" without making the stock first. */
const leave = (variantId: string, stock: number) => db.prepare('UPDATE variants SET stock = ? WHERE id = ?').run(stock, variantId);
const reorderRow = (id: string, p = {}) => stockInsights(db, p).reorder.find((r) => r.variantId === id);
const deadRow = (id: string, p = {}) => stockInsights(db, p).dead.find((r) => r.variantId === id);

describe('what to reorder', () => {
  it('suggests a batch for something that sells well and is running low', () => {
    const v = piece('FAST', 100);
    sell(v.id, 30, 10);
    leave(v.id, 5);
    const r = reorderRow(v.id)!;
    // 30 sold over 90 days is a third of a piece a day; 51 days ahead is 17 pieces; 5 on the shelf leaves 12.
    expect(r).toMatchObject({ stock: 5, soldInPeriod: 30, onOrder: 0, suggestedQty: 12, urgent: true, designName: 'Design FAST' });
    expect(r.perDay).toBeCloseTo(1 / 3, 5);
    expect(r.daysOfCover).toBeCloseTo(15, 5);
    expect(r.costOfBatchPaise).toBe(12 * r.unitCostPaise);
  });

  it('counts only the look-back period, and not cancelled invoices', () => {
    const v = piece('OLD', 100);
    sell(v.id, 40, 200); // long ago
    const cancelled = sell(v.id, 20, 5);
    invoices.cancelInvoice(db, cancelled.id, 'mistake');
    sell(v.id, 3, 5);
    leave(v.id, 0);
    expect(reorderRow(v.id)).toMatchObject({ soldInPeriod: 3 });
    expect(reorderRow(v.id, { lookbackDays: 365 })).toMatchObject({ soldInPeriod: 43 });
  });

  it('takes returned pieces off what counts as sold', () => {
    const v = piece('RET', 100);
    const inv = sell(v.id, 10, 5);
    creditNotes.createCreditNote(db, { invoiceId: inv.id, issueDate: today, kind: 'return', reason: 'x', notes: '', lines: [{ invoiceLineId: inv.lines[0]!.id, qty: 4, restock: true }] });
    leave(v.id, 0);
    expect(reorderRow(v.id)).toMatchObject({ soldInPeriod: 6 });
  });

  it('does not suggest what is already on order from a weaver', () => {
    const v = piece('ORD', 100);
    sell(v.id, 30, 10);
    leave(v.id, 5);
    const w = weavers.createWeaver(db, { name: 'Ramesh', phone: '', place: 'Mau', notes: '' });
    const order = weavers.createJobOrder(db, { weaverId: w.id, variantId: v.id, qty: 10, wagePaise: rupees(300), expectedOn: null, note: '' });
    expect(reorderRow(v.id)).toMatchObject({ onOrder: 10, suggestedQty: 2, urgent: false });
    weavers.receivePieces(db, { orderId: order.id, qty: 4, receivedOn: today, note: '' });
    leave(v.id, 9); // the 4 that came back are on the shelf
    expect(reorderRow(v.id)).toMatchObject({ onOrder: 6, suggestedQty: 2 }); // 17 - 9 - 6
  });

  it('keeps a piece with a reorder level topped up even when nothing sells', () => {
    const v = piece('LVL', 1, 5);
    expect(reorderRow(v.id)).toMatchObject({ suggestedQty: 4, soldInPeriod: 0, perDay: 0, daysOfCover: null, urgent: false });
  });

  it('leaves out pieces that have plenty, or never sell and have no level', () => {
    const plenty = piece('PLENTY', 500);
    const quiet = piece('QUIET', 3);
    sell(plenty.id, 10, 5);
    const ids = stockInsights(db).reorder.map((r) => r.variantId);
    expect(ids).not.toContain(plenty.id);
    expect(ids).not.toContain(quiet.id);
  });

  it('puts the most urgent first, then those that run out soonest', () => {
    const a = piece('A', 100);
    const b = piece('B', 100);
    const c = piece('C', 100);
    sell(a.id, 10, 5);
    sell(b.id, 30, 5);
    sell(c.id, 30, 5);
    leave(a.id, 3); // 0.11/day: 27 days left: not urgent, but needs a batch
    leave(b.id, 4); // 0.33/day: 12 days
    leave(c.id, 0); // gone
    expect(stockInsights(db).reorder.map((r) => r.variantId)).toEqual([c.id, b.id, a.id]);
    expect(stockInsights(db).totals.urgent).toBe(2);
  });

  it('follows the lead and cover days it is given', () => {
    const v = piece('LEAD', 100);
    sell(v.id, 30, 10);
    leave(v.id, 5);
    expect(reorderRow(v.id, { leadDays: 7, coverDays: 14 })).toMatchObject({ suggestedQty: 2, urgent: false }); // 21 days ahead is 7 pieces
    expect(stockInsights(db, { leadDays: 7, coverDays: 14 }).params).toMatchObject({ leadDays: 7, coverDays: 14 });
  });

  it('adds up what the suggestions would cost', () => {
    const a = piece('A', 100, 0, 500);
    const b = piece('B', 100, 0, 300);
    sell(a.id, 30, 5);
    sell(b.id, 30, 5);
    leave(a.id, 5);
    leave(b.id, 5);
    const t = stockInsights(db).totals;
    expect(t.reorderPieces).toBe(24);
    expect(t.reorderCostPaise).toBe(12 * rupees(500) + 12 * rupees(300));
  });
});

describe('dead stock', () => {
  it('finds pieces on the shelf that have not sold for a long time, costliest first', () => {
    const cheap = piece('CHEAP', 10, 0, 100);
    const dear = piece('DEAR', 4, 0, 2000);
    for (const v of [cheap, dear]) addedDaysAgo(v.id, 300);
    sell(cheap.id, 1, 150);
    leave(cheap.id, 9);
    const dead = stockInsights(db).dead;
    expect(dead.map((d) => d.variantId)).toEqual([dear.id, cheap.id]);
    expect(dead[0]).toMatchObject({ stock: 4, lastSoldOn: null, tiedUpPaise: 4 * rupees(2000), idleDays: 300 });
    expect(dead[1]).toMatchObject({ lastSoldOn: addDays(today, -150), idleDays: 150, tiedUpPaise: 9 * rupees(100) });
    expect(stockInsights(db).totals).toMatchObject({ deadPieces: 13, deadTiedUpPaise: 4 * rupees(2000) + 9 * rupees(100) });
  });

  it('gives a new arrival time to sell, and leaves out what sold lately or is gone', () => {
    const fresh = piece('FRESH', 5);
    const recent = piece('RECENT', 5);
    const gone = piece('GONE', 5);
    addedDaysAgo(recent.id, 300);
    addedDaysAgo(gone.id, 300);
    sell(recent.id, 1, 20);
    leave(gone.id, 0);
    const ids = stockInsights(db).dead.map((d) => d.variantId);
    expect(ids).not.toContain(fresh.id);
    expect(ids).not.toContain(recent.id);
    expect(ids).not.toContain(gone.id);
  });

  it('follows the number of days it is given', () => {
    const v = piece('SLOWISH', 5);
    addedDaysAgo(v.id, 60);
    expect(deadRow(v.id)).toBeUndefined();
    expect(deadRow(v.id, { deadDays: 30 })).toMatchObject({ idleDays: 60 });
  });

  it('counts a cancelled sale as no sale', () => {
    const v = piece('CANC', 10);
    addedDaysAgo(v.id, 300);
    const inv = sell(v.id, 1, 5);
    invoices.cancelInvoice(db, inv.id, 'mistake');
    expect(deadRow(v.id)).toMatchObject({ lastSoldOn: null });
  });
});
