import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../electron/db/connection';
import { stockInsights } from '../electron/services/insights';
import { integrityCheck } from '../electron/services/integrity';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as locations from '../electron/services/locations';
import * as reports from '../electron/services/reports';
import { saveSettings } from '../electron/services/settings';
import { addDays, todayIso } from '../shared/gst';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { state: 'Uttar Pradesh', gstin: '09AAACH7409R1ZZ', gstRatePercent: 5 });
});

const rupees = (n: number) => n * 100;
const today = todayIso();

function saree(code = 'MG-1', stock = 10, cost = 400) {
  const d = inventory.createDesign(db, { code, name: `Design ${code}`, fabric: '', hsnCode: '5007', description: '', defaultPricePaise: rupees(1000) });
  return inventory.createVariant(db, d.id, { color: 'Red', size: '5.5 m', sellPricePaise: rupees(1000), baseCostPaise: rupees(cost), reorderLevel: 0, openingStock: stock, bom: [] });
}
const shopStock = (id: string) => inventory.getVariant(db, id).stock;
const place = (name: string) => locations.saveLocation(db, null, name);
const move = (variantId: string, fromId: string | null, toId: string | null, qty: number, note = '') => locations.transferStock(db, { variantId, fromId, toId, qty, note });
const held = (locationId: string) => locations.listLocations(db).find((l) => l.id === locationId)!;

describe('places', () => {
  it('adds, renames and lists them', () => {
    const g = place('Godown');
    expect(g).toMatchObject({ name: 'Godown', pieces: 0, valueAtCostPaise: 0, variants: 0 });
    expect(locations.saveLocation(db, g.id, 'Main godown').name).toBe('Main godown');
    place('Exhibition stall');
    expect(locations.listLocations(db).map((l) => l.name)).toEqual(['Exhibition stall', 'Main godown']);
  });

  it('refuses a duplicate name, the shop\'s own name, and nonsense', () => {
    place('Godown');
    expect(() => place(' godown ')).toThrow(/already a place called/);
    expect(() => place('Shop')).toThrow(/selling location already/);
    expect(() => place('')).toThrow(/Name/);
    expect(() => locations.saveLocation(db, 'nope', 'X')).toThrow(/no longer exists/);
  });

  it('lets a place keep its own name when saved again', () => {
    const g = place('Godown');
    expect(locations.saveLocation(db, g.id, 'Godown').name).toBe('Godown');
  });
});

describe('moving stock', () => {
  it('takes pieces off the shop shelf into a place, and back', () => {
    const v = saree('MG-1', 10, 400);
    const g = place('Godown');
    const t = move(v.id, null, g.id, 4, 'Festival stock');
    expect(t).toMatchObject({ qty: 4, fromName: 'Shop', toName: 'Godown', note: 'Festival stock', sku: v.sku });
    expect(shopStock(v.id)).toBe(6);
    expect(held(g.id)).toMatchObject({ pieces: 4, valueAtCostPaise: 4 * rupees(400), variants: 1 });
    move(v.id, g.id, null, 3);
    expect(shopStock(v.id)).toBe(9);
    expect(held(g.id).pieces).toBe(1);
  });

  it('writes the shop side into the stock ledger, so history explains it', () => {
    const v = saree();
    const g = place('Godown');
    move(v.id, null, g.id, 4);
    move(v.id, g.id, null, 1);
    const history = inventory.listMovements(db, v.id);
    expect(history.map((m) => [m.delta, m.reason, m.note])).toEqual([[1, 'adjustment', 'Brought back from Godown'], [-4, 'adjustment', 'Moved to Godown'], [10, 'opening', '']]);
  });

  it('moves between two places without touching the shop', () => {
    const v = saree();
    const g = place('Godown');
    const s = place('Stall');
    move(v.id, null, g.id, 5);
    const before = inventory.listMovements(db, v.id).length;
    move(v.id, g.id, s.id, 2);
    expect(shopStock(v.id)).toBe(5);
    expect(held(g.id).pieces).toBe(3);
    expect(held(s.id).pieces).toBe(2);
    expect(inventory.listMovements(db, v.id)).toHaveLength(before);
  });

  it('refuses a move the source cannot cover, and records nothing', () => {
    const v = saree('MG-1', 3);
    const g = place('Godown');
    expect(() => move(v.id, null, g.id, 4)).toThrow(/Not enough stock/);
    expect(shopStock(v.id)).toBe(3);
    expect(() => move(v.id, g.id, null, 1)).toThrow(/Godown holds 0 of/);
    move(v.id, null, g.id, 2);
    expect(() => move(v.id, g.id, null, 3)).toThrow(/Godown holds 2 of .*so 3 cannot be moved/);
    expect(locations.listTransfers(db)).toHaveLength(1);
  });

  it('checks the quantity, the places and the saree', () => {
    const v = saree();
    const g = place('Godown');
    expect(() => move(v.id, null, g.id, 0)).toThrow(/Quantity/);
    expect(() => move(v.id, null, g.id, 1.5)).toThrow(/Quantity/);
    expect(() => move(v.id, null, null, 1)).toThrow(/two different places/);
    expect(() => move(v.id, g.id, g.id, 1)).toThrow(/two different places/);
    expect(() => move(v.id, null, 'nope', 1)).toThrow(/no longer exists/);
    expect(() => move('nope', null, g.id, 1)).toThrow(/Choose the saree/);
    expect(() => move(v.id, null, g.id, 1, 'x'.repeat(300))).toThrow(/Note/);
  });

  it('cannot sell what is in the godown', () => {
    const v = saree('MG-1', 5);
    const g = place('Godown');
    move(v.id, null, g.id, 5);
    expect(() => invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: v.id, qty: 1, unitPricePaise: rupees(1000) }] })).toThrow(/Not enough stock/);
    move(v.id, g.id, null, 2);
    expect(invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: v.id, qty: 2, unitPricePaise: rupees(1000) }] }).lines).toHaveLength(1);
  });

  it('lists recent moves newest first', () => {
    const v = saree();
    const g = place('Godown');
    move(v.id, null, g.id, 2, 'first');
    move(v.id, g.id, null, 1, 'second');
    expect(locations.listTransfers(db).map((t) => t.note)).toEqual(['second', 'first']);
    expect(locations.listTransfers(db, 1)).toHaveLength(1);
  });
});

describe('closing a place', () => {
  it('only when it is empty', () => {
    const v = saree();
    const g = place('Godown');
    move(v.id, null, g.id, 2);
    expect(() => locations.archiveLocation(db, g.id)).toThrow(/still holds 2 pieces/);
    move(v.id, g.id, null, 2);
    locations.archiveLocation(db, g.id);
    expect(locations.listLocations(db)).toEqual([]);
    expect(() => move(v.id, null, g.id, 1)).toThrow(/no longer exists/);
    place('Godown'); // the name is free again
  });

  it('is not kept open by pieces of a saree that has since been archived', () => {
    const v = saree();
    const g = place('Godown');
    move(v.id, null, g.id, 2);
    inventory.archiveVariant(db, v.id);
    expect(held(g.id).pieces).toBe(0);
    locations.archiveLocation(db, g.id);
  });
});

describe('the holdings table', () => {
  it('shows the shop and each place side by side', () => {
    const a = saree('MG-A', 10);
    const b = saree('MG-B', 0);
    const g = place('Godown');
    const s = place('Stall');
    move(a.id, null, g.id, 4);
    move(a.id, null, s.id, 1);
    const rows = locations.holdings(db);
    expect(rows.map((r) => r.variantId)).toEqual([a.id]); // nothing anywhere for b
    expect(rows[0]).toMatchObject({ shop: 5, total: 10, elsewhere: { [g.id]: 4, [s.id]: 1 } });
    expect(b.id).toBeTruthy();
  });
});

describe('everything that counts stock', () => {
  it('counts pieces in other places in the units and value on the inventory page', () => {
    const v = saree('MG-1', 10, 400);
    const g = place('Godown');
    const before = inventory.inventorySummary(db);
    move(v.id, null, g.id, 4);
    const after = inventory.inventorySummary(db);
    expect(after.unitsInStock).toBe(before.unitsInStock);
    expect(after.stockValuePaise).toBe(before.stockValuePaise);
    expect(after.elsewherePieces).toBe(4);
  });

  it('values them in the stock valuation report, now and as of a past day', () => {
    const v = saree('MG-1', 10, 400);
    const g = place('Godown');
    move(v.id, null, g.id, 4);
    const now = reports.stockReport(db);
    expect(now).toMatchObject({ pieces: 10, costValuePaise: 10 * rupees(400) });
    expect(now.rows[0]!.variants[0]).toMatchObject({ pieces: 10 });
    // Yesterday nothing had been set up: the ledger has no pieces yet, and no transfer existed.
    const past = reports.stockReport(db, addDays(today, -1));
    expect(past.pieces).toBe(0);
  });

  it('counts them as on hand when deciding what to reorder', () => {
    const v = saree('MG-1', 100, 400);
    const d = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: d, dueDate: d, discountPaise: 0, notes: '', lines: [{ variantId: v.id, qty: 30, unitPricePaise: rupees(1000) }] });
    db.prepare('UPDATE variants SET stock = 5 WHERE id = ?').run(v.id);
    expect(stockInsights(db).reorder.find((r) => r.variantId === v.id)).toMatchObject({ suggestedQty: 12, elsewhere: 0 });
    // Twelve pieces are sitting in the godown: nothing needs to be made.
    const g = place('Godown');
    db.prepare('INSERT INTO stock_transfers (id, variant_id, from_location_id, to_location_id, qty, created_at) VALUES (?, ?, NULL, ?, 12, ?)').run('t1', v.id, g.id, new Date().toISOString());
    expect(stockInsights(db).reorder.find((r) => r.variantId === v.id)).toBeUndefined();
  });
});

describe('the books check', () => {
  const report = () => integrityCheck(db).checks.find((c) => c.id === 'locations')!;

  it('is happy with honest moves', () => {
    const v = saree();
    const g = place('Godown');
    move(v.id, null, g.id, 3);
    move(v.id, g.id, null, 1);
    expect(report()).toMatchObject({ problemCount: 0, checked: 3 }); // one place-variant, two shop-side moves
  });

  it('notices a place that has given away more than it received', () => {
    const v = saree();
    const g = place('Godown');
    db.prepare('INSERT INTO stock_transfers (id, variant_id, from_location_id, to_location_id, qty, created_at) VALUES (?, ?, ?, ?, 2, ?)').run('bad', v.id, g.id, null, new Date().toISOString());
    expect(report().problems.join(' ')).toMatch(/shows -2/);
  });

  it('notices a shop side move that has no matching ledger entry', () => {
    const v = saree();
    const g = place('Godown');
    move(v.id, null, g.id, 3);
    db.prepare("UPDATE stock_movements SET ref_id = 'other' WHERE ref_type = 'transfer'").run();
    expect(report().problems.join(' ')).toMatch(/stock ledger/);
  });
});
