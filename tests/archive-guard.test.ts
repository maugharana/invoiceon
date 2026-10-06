import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import * as customers from '../electron/services/customers';
import * as expenses from '../electron/services/expenses';
import * as inventory from '../electron/services/inventory';
import * as production from '../electron/services/production';
import * as proformas from '../electron/services/proformas';
import { saveSettings } from '../electron/services/settings';
import * as weaver from '../electron/services/weaverOrders';
import { addDays, todayIso } from '../shared/gst';

const rupees = (n: number) => n * 100;
const today = todayIso();
let db: Db;
let design: string;
let red: string;
let customerId: string;

beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { gstin: '09AABCK1234M1ZI' });
  design = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: '', hsnCode: '5007', description: '', defaultPricePaise: rupees(1000) }).id;
  red = inventory.createVariant(db, design, { color: 'Red', size: '6 m', sellPricePaise: rupees(1000), baseCostPaise: 0, reorderLevel: 0, openingStock: 5, bom: [] }).id;
  customerId = customers.createCustomer(db, { name: 'Meena', type: 'B2C', phone: '', email: '', gstin: '', address: '', city: '', state: '', pincode: '', notes: '' }).id;
});

describe('archiving a piece that has unfinished work on it', () => {
  it('is refused while a quote could still be invoiced, and allowed once it is cancelled', () => {
    const q = proformas.createProforma(db, { type: 'B2C', customerId, issueDate: today, validUntil: addDays(today, 15), discountPaise: 0, notes: '', lines: [{ variantId: red, qty: 2, unitPricePaise: rupees(1000) }] });
    expect(() => inventory.archiveVariant(db, red)).toThrow(new RegExp(`${q.number}`));
    expect(() => inventory.archiveDesign(db, design)).toThrow(new RegExp(`${q.number}`));
    expect(inventory.getVariant(db, red).stock).toBe(5);
    proformas.cancelProforma(db, q.id, 'no longer needed');
    inventory.archiveVariant(db, red);
    expect(() => inventory.getVariant(db, red)).toThrow(/no longer exists/);
  });

  it('is refused while a weaver order is waiting for it, and while a production order is being made', () => {
    const vendorId = expenses.createVendor(db, { name: 'Ramesh Weaver', phone: '', gstin: '', address: '', notes: '' }).id;
    const w = weaver.createWeaverOrder(db, { vendorId, orderedOn: today, expectedOn: addDays(today, 20), note: '', lines: [{ variantId: red, qty: 1, unitCostPaise: rupees(500) }] });
    expect(() => inventory.archiveVariant(db, red)).toThrow(new RegExp(w.number));
    weaver.cancelWeaverOrder(db, w.id, 'changed mind');
    const p = production.createOrder(db, { variantId: red, qty: 2 });
    expect(() => inventory.archiveVariant(db, red)).toThrow(new RegExp(p.number));
    production.cancelOrder(db, p.id);
    inventory.archiveVariant(db, red);
  });
});

describe('the bulk add sheet', () => {
  const sheetRow = (over: object) => ({ name: 'Mau Silk', sku: '', color: 'Maroon', size: '6.3 m', fabric: '', hsn: '', mrpPaise: 0, sellPricePaise: rupees(900), costPaise: 0, stock: 1, reorderLevel: 0, ...over });

  it('names the row whose Saree ID is already another piece\'s barcode, and adds nothing', () => {
    inventory.updateVariant(db, red, { color: 'Red', size: '6 m', barcode: 'SCAN-1', sellPricePaise: rupees(1000), baseCostPaise: 0, reorderLevel: 0, bom: [] });
    const before = inventory.listDesigns(db).length;
    const result = inventory.bulkAddSarees(db, [sheetRow({ color: 'Blue' }), sheetRow({ sku: 'scan-1' })]);
    expect(result.errors).toEqual([{ row: 1, message: expect.stringMatching(/used as a barcode/) }]);
    expect(inventory.listDesigns(db)).toHaveLength(before);
  });

  it('still names the row when a rule only fails while writing', () => {
    // The generated ID for this row ("MG-002-MAR-6.3M") is already some other piece's barcode, which only the write can discover.
    inventory.updateVariant(db, red, { color: 'Red', size: '6 m', barcode: 'MG-002-MAR-6.3M', sellPricePaise: rupees(1000), baseCostPaise: 0, reorderLevel: 0, bom: [] });
    const before = inventory.listDesigns(db).length;
    const result = inventory.bulkAddSarees(db, [sheetRow({ color: 'Blue' }), sheetRow({})]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toMatch(/barcode/);
    expect(inventory.listDesigns(db)).toHaveLength(before);
  });
});

describe('calling the API by name', () => {
  it('only runs real calls, not names every object has', async () => {
    const api = createApi(db);
    const { invoke } = await import('../electron/api');
    for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) expect(await invoke(api, name, [])).toEqual({ ok: false, error: `Unknown request: ${name}` });
    expect((await invoke(api, 'inventorySummary', [])).ok).toBe(true);
  });
});
