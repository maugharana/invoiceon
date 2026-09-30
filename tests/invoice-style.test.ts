import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../electron/db/connection';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as proformas from '../electron/services/proformas';
import { getSettings, saveSettings } from '../electron/services/settings';
import { todayIso } from '../shared/gst';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { state: 'Uttar Pradesh', gstin: '09AAACH7409R1ZZ', gstRatePercent: 5 });
});

const today = todayIso();
function sale() {
  const d = inventory.createDesign(db, { code: 'MG-1', name: 'Butidar', fabric: '', hsnCode: '5007', description: '', defaultPricePaise: 100000 });
  const v = inventory.createVariant(db, d.id, { color: 'Red', size: '5.5 m', sellPricePaise: 100000, baseCostPaise: 40000, reorderLevel: 0, openingStock: 5, bom: [] });
  return invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: v.id, qty: 1, unitPricePaise: 100000 }] });
}

describe('invoice layout settings', () => {
  it('start as the invoice has always looked', () => {
    expect(getSettings(db)).toMatchObject({ invoiceTemplate: 'classic', invoiceShowItemDetail: true, invoiceShowWords: true, invoiceRetailTitle: '' });
    expect(sale().style).toEqual({ template: 'classic', showItemDetail: true, showWords: true, retailTitle: '' });
  });

  it('are saved, and the heading is tidied to capitals', () => {
    saveSettings(db, { invoiceTemplate: 'modern', invoiceShowItemDetail: false, invoiceShowWords: false, invoiceRetailTitle: 'cash memo' });
    expect(getSettings(db)).toMatchObject({ invoiceTemplate: 'modern', invoiceShowItemDetail: false, invoiceShowWords: false, invoiceRetailTitle: 'CASH MEMO' });
  });

  it('refuse a layout that does not exist, and a heading that is too long', () => {
    expect(() => saveSettings(db, { invoiceTemplate: 'fancy' as never })).toThrow(/Choose one of the invoice layouts/);
    expect(() => saveSettings(db, { invoiceRetailTitle: 'A VERY LONG HEADING THAT WILL NOT FIT' })).toThrow(/Retail invoice heading/);
    expect(getSettings(db).invoiceTemplate).toBe('classic');
  });

  it('restyle invoices already issued, like the logo and colour do, without touching their content', () => {
    const inv = sale();
    saveSettings(db, { invoiceTemplate: 'minimal', invoiceRetailTitle: 'CASH MEMO' });
    const again = invoices.getInvoice(db, inv.id);
    expect(again.style).toEqual({ template: 'minimal', showItemDetail: true, showWords: true, retailTitle: 'CASH MEMO' });
    expect(again.totalPaise).toBe(inv.totalPaise);
    expect(again.number).toBe(inv.number);
    expect(again.branding).toEqual(inv.branding); // the existing branding object is unchanged
  });

  it('reach proformas too', () => {
    const d = inventory.createDesign(db, { code: 'MG-2', name: 'Paithani', fabric: '', hsnCode: '5007', description: '', defaultPricePaise: 100000 });
    const v = inventory.createVariant(db, d.id, { color: 'Blue', size: '5.5 m', sellPricePaise: 100000, baseCostPaise: 40000, reorderLevel: 0, openingStock: 5, bom: [] });
    saveSettings(db, { invoiceTemplate: 'modern' });
    const p = proformas.createProforma(db, { type: 'B2C', customerId: null, issueDate: today, validUntil: today, discountPaise: 0, notes: '', lines: [{ variantId: v.id, qty: 1, unitPricePaise: 100000 }] });
    expect(p.style?.template).toBe('modern');
  });
});
