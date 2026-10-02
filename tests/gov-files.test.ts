import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../electron/db/connection';
import * as customers from '../electron/services/customers';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import { saveSettings } from '../electron/services/settings';
import { eInvoiceFile, ewayBillFile, type EwayInput } from '../shared/govFiles';
import { addDays, todayIso } from '../shared/gst';

const rupees = (n: number) => n * 100;
const today = todayIso();
let db: Db;
let variant: string;

const transport: EwayInput = { mode: 'road', distanceKm: 120, transporterName: 'Shree Transport', transporterId: '', transDocNo: 'LR-77', transDocDate: today, vehicleNo: 'UP32AB1234', vehicleType: 'regular' };

beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { businessName: 'Mau Gharana', gstin: '09AABCK1234M1ZI', addressLine1: 'Katra', city: 'Mau', state: 'Uttar Pradesh', pincode: '275101' } as never);
  const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: '', hsnCode: '5007', description: '', defaultPricePaise: rupees(10000) });
  variant = inventory.createVariant(db, d.id, { color: 'Red', size: '6.3 m', sellPricePaise: rupees(10000), baseCostPaise: rupees(4000), reorderLevel: 0, openingStock: 20, bom: [] }).id;
});

function b2b(over: { gstin?: string; state?: string; pincode?: string; qty?: number } = {}) {
  const c = customers.createCustomer(db, { name: 'Lakshmi Textiles', type: 'B2B', phone: '', email: '', gstin: over.gstin ?? '27AAPFU0939F1ZV', address: 'Dadar', city: 'Mumbai', state: over.state ?? 'Maharashtra', pincode: over.pincode ?? '400014', notes: '' });
  return invoices.createInvoice(db, { type: 'B2B', customerId: c.id, issueDate: today, dueDate: addDays(today, 10), discountPaise: 0, notes: '', lines: [{ variantId: variant, qty: over.qty ?? 6, unitPricePaise: rupees(10000) }] });
}

describe('e-way bill file', () => {
  it('carries the invoice, the two places and the items, with amounts in rupees', () => {
    const inv = b2b();
    const f = ewayBillFile(inv, transport);
    expect(f.problems).toEqual([]);
    const bill = JSON.parse(f.json).billLists[0];
    expect(bill).toMatchObject({ userGstin: '09AABCK1234M1ZI', docType: 'INV', docNo: inv.number, toGstin: '27AAPFU0939F1ZV', toStateCode: 27, toPincode: 400014, fromStateCode: 9, transMode: '1', transDistance: '120', vehicleNo: 'UP32AB1234' });
    expect(bill.totInvValue).toBe(inv.totalPaise / 100);
    expect(bill.itemList).toHaveLength(1);
    expect(bill.itemList[0]).toMatchObject({ hsnCode: 5007, quantity: 6, taxableAmount: 60000 });
    expect(JSON.parse(f.json).version).toBeTruthy();
  });

  it('says what the portal would reject', () => {
    const inv = b2b({ pincode: '' });
    const f = ewayBillFile(inv, { ...transport, vehicleNo: 'X', distanceKm: 9000 });
    expect(f.problems.join(' ')).toMatch(/6 digit pincode/);
    expect(f.problems.join(' ')).toMatch(/Distance/);
    expect(f.problems.join(' ')).toMatch(/vehicle number/);
  });

  it('notes when the goods are under the 50,000 mark', () => {
    const f = ewayBillFile(b2b({ qty: 1 }), transport);
    expect(f.notes.join(' ')).toMatch(/50,000/);
  });
});

describe('e-invoice file', () => {
  it('has the seller, buyer, items and totals that add up', () => {
    const inv = b2b();
    const f = eInvoiceFile(inv);
    expect(f.problems).toEqual([]);
    const doc = JSON.parse(f.json)[0];
    expect(doc.Version).toBe('1.1');
    expect(doc.DocDtls.No).toBe(inv.number);
    expect(doc.SellerDtls.Gstin).toBe('09AABCK1234M1ZI');
    expect(doc.BuyerDtls.Gstin).toBe('27AAPFU0939F1ZV');
    expect(doc.ValDtls.TotInvVal).toBe(inv.totalPaise / 100);
    const sum = doc.ItemList.reduce((s: number, i: { TotItemVal: number }) => s + i.TotItemVal, 0);
    expect(Math.round(sum * 100)).toBeGreaterThanOrEqual(inv.totalPaise - 100);
  });

  it('refuses when your own GSTIN is missing, and for a retail invoice', () => {
    const inv = b2b();
    const f = eInvoiceFile({ ...inv, seller: { ...inv.seller, gstin: '' } });
    expect(f.problems.join(' ')).toMatch(/Your own GSTIN/);
    const retail = invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: today, dueDate: addDays(today, 10), discountPaise: 0, notes: '', lines: [{ variantId: variant, qty: 1, unitPricePaise: rupees(10000) }] });
    expect(eInvoiceFile(retail).problems.join(' ')).toMatch(/B2B/);
  });
});
