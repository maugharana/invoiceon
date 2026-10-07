import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../electron/db/connection';
import * as customers from '../electron/services/customers';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as payments from '../electron/services/payments';
import { getSettings, saveSettings } from '../electron/services/settings';
import { addDays, todayIso } from '../shared/gst';
import type { CustomerInput, InvoiceInput } from '../shared/types';

const rupees = (n: number) => n * 100;
const today = todayIso();
let db: Db;
let variantId: string;

beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { gstin: '09AABCK1234M1ZI', invoicePrefix: 'MG' });
  const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: '', hsnCode: '5007', description: '', defaultPricePaise: rupees(1000) });
  variantId = inventory.createVariant(db, d.id, { color: 'Red', size: '6 m', sellPricePaise: rupees(1000), baseCostPaise: 0, reorderLevel: 0, openingStock: 50, bom: [] }).id;
});

const biz: CustomerInput = { name: 'Kanchan Sarees', type: 'B2B', phone: '', email: '', gstin: '09AABCK1234M1ZI'.replace('AABCK1234M', 'AAACH7409R'), address: 'Chowk', city: 'Varanasi', state: 'Uttar Pradesh', pincode: '221001', notes: '' };
const customer = (over: Partial<CustomerInput> = {}) => customers.createCustomer(db, { ...biz, gstin: '09AAACH7409R1ZZ', ...over });
const invoice = (over: Partial<InvoiceInput> = {}) =>
  invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId, qty: 1, unitPricePaise: rupees(1000) }], ...over });

describe('money handed over with the invoice', () => {
  it('goes into the account chosen for it, and is refused if that account is not one of the shop accounts', () => {
    saveSettings(db, { paymentAccounts: [{ id: 'acc-upi', name: 'Shop UPI', kind: 'upi', details: '' }] });
    const inv = invoice({ payment: { amountPaise: rupees(1000), method: 'upi', reference: 'UTR1', accountId: 'acc-upi' } });
    expect(inv.payments[0]).toMatchObject({ method: 'upi', reference: 'UTR1' });
    expect(payments.getPayment(db, inv.payments[0]!.paymentId).accountId).toBe('acc-upi');
    expect(() => invoice({ payment: { amountPaise: rupees(1000), method: 'upi', reference: '', accountId: 'nope' } })).toThrow(/account/);
  });
});

describe('what a piece costs, for the sale screen', () => {
  it('comes with each piece on sale, counting making cost and materials, so a bill can be checked against cost', () => {
    const d = inventory.createDesign(db, { code: 'MG-050', name: 'Kadhua', fabric: '', hsnCode: '5007', description: '', defaultPricePaise: rupees(5000) });
    const v = inventory.createVariant(db, d.id, { color: 'Wine', size: '6 m', sellPricePaise: rupees(5000), baseCostPaise: rupees(3200), reorderLevel: 0, openingStock: 3, bom: [] });
    expect(invoices.variantsForSale(db).find((x) => x.variantId === v.id)?.unitCostPaise).toBe(rupees(3200));
  });
});

describe('numbering series', () => {
  it('uses one run for everything until a B2B prefix is set', () => {
    const c = customer();
    expect(invoice().number).toMatch(/^MG\/.*\/0001$/);
    expect(invoice({ type: 'B2B', customerId: c.id }).number).toMatch(/^MG\/.*\/0002$/);
  });

  it('gives B2B tax invoices their own run once a prefix is set, and keeps the others counting', () => {
    const c = customer();
    saveSettings(db, { b2bPrefix: 'mgb' });
    expect(getSettings(db).b2bPrefix).toBe('MGB');
    expect(invoice().number).toMatch(/^MG\/.*\/0001$/);
    expect(invoice({ type: 'B2B', customerId: c.id }).number).toMatch(/^MGB\/.*\/0001$/);
    expect(invoice().number).toMatch(/^MG\/.*\/0002$/);
    const b2b = invoice({ type: 'B2B', customerId: c.id });
    expect(b2b.number).toMatch(/^MGB\/.*\/0002$/);
    expect(b2b.series).toBe('B2B');
  });

  it('previews the number each kind of invoice would get', () => {
    saveSettings(db, { b2bPrefix: 'MGB' });
    invoice();
    expect(invoices.nextInvoiceNumber(db, today, 'B2C')).toMatch(/^MG\/.*\/0002$/);
    expect(invoices.nextInvoiceNumber(db, today, 'B2B')).toMatch(/^MGB\/.*\/0001$/);
    expect(invoices.nextInvoiceNumber(db, today)).toMatch(/^MG\/.*\/0002$/); // B2C by default
  });

  it('refuses a B2B prefix that matches the main one, either way round', () => {
    expect(() => saveSettings(db, { b2bPrefix: 'MG' })).toThrow(/different prefix/);
    saveSettings(db, { b2bPrefix: 'MGB' });
    expect(() => saveSettings(db, { invoicePrefix: 'MGB' })).toThrow(/different prefix/);
    expect(() => saveSettings(db, { b2bPrefix: 'a/b' })).toThrow(/letters, numbers/);
    expect(saveSettings(db, { b2bPrefix: '' }).b2bPrefix).toBe('');
  });
});

describe('delivery details', () => {
  it('defaults to no delivery, and to pending once there is a ship-to or a transporter', () => {
    expect(invoice().deliveryStatus).toBe('none');
    const shipped = invoice({ shipTo: { name: 'Meena', address: '5 Lake Rd', city: 'Mau', state: 'Uttar Pradesh', pincode: '275101', phone: '' }, transport: 'Sharma Transport' });
    expect(shipped).toMatchObject({ deliveryStatus: 'pending', transport: 'Sharma Transport' });
    expect(shipped.shipTo?.city).toBe('Mau');
    expect(invoice({ transport: 'Delhivery' }).deliveryStatus).toBe('pending');
  });

  it('treats an empty ship-to as none, and rejects a bad pincode', () => {
    expect(invoice({ shipTo: { name: 'x', address: '', city: '', state: '', pincode: '', phone: '' } }).shipTo).toBeNull();
    expect(() => invoice({ shipTo: { name: '', address: 'a', city: '', state: '', pincode: '12', phone: '' } })).toThrow(/6 digits/);
  });

  it('moves through dispatched to delivered, and stamps the day it arrived', () => {
    const inv = invoice({ transport: 'Delhivery' });
    const sent = invoices.setDelivery(db, inv.id, { status: 'dispatched', transport: 'Delhivery', trackingNo: 'DL123' });
    expect(sent).toMatchObject({ deliveryStatus: 'dispatched', trackingNo: 'DL123', deliveredOn: null });
    const done = invoices.setDelivery(db, inv.id, { status: 'delivered', transport: 'Delhivery', trackingNo: 'DL123' });
    expect(done.deliveredOn).toBe(today);
    // Going back clears the date.
    expect(invoices.setDelivery(db, inv.id, { status: 'dispatched', transport: '', trackingNo: '' }).deliveredOn).toBeNull();
  });

  it('will not accept a delivery date before the invoice, a made-up status, or a cancelled invoice', () => {
    const inv = invoice({ issueDate: today });
    expect(() => invoices.setDelivery(db, inv.id, { status: 'delivered', transport: '', trackingNo: '', deliveredOn: addDays(today, -3) })).toThrow(/before the invoice date/);
    expect(() => invoices.setDelivery(db, inv.id, { status: 'lost' as never, transport: '', trackingNo: '' })).toThrow(/delivery status/);
    invoices.cancelInvoice(db, inv.id, '');
    expect(() => invoices.setDelivery(db, inv.id, { status: 'dispatched', transport: '', trackingNo: '' })).toThrow(/cancelled/);
  });

  it('filters the invoice list by delivery stage, and never changes what was billed', () => {
    const a = invoice({ transport: 'X' });
    invoice();
    invoices.setDelivery(db, a.id, { status: 'dispatched', transport: 'X', trackingNo: '' });
    expect(invoices.listInvoices(db, { delivery: 'dispatched' }).map((i) => i.id)).toEqual([a.id]);
    expect(invoices.listInvoices(db, { delivery: 'pending' })).toEqual([]);
    expect(invoices.getInvoice(db, a.id).totalPaise).toBe(a.totalPaise);
  });
});
