import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import * as customers from '../electron/services/customers';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as payments from '../electron/services/payments';
import * as proformas from '../electron/services/proformas';
import { saveSettings } from '../electron/services/settings';
import { CUSTOMER_FILTER_LABEL, filterCustomers, findDuplicateGroups, phoneKey } from '../shared/customerList';
import { customersCsv } from '../shared/csv';
import { addDays, todayIso } from '../shared/gst';
import type { Customer, CustomerInput } from '../shared/types';

const rupees = (n: number) => n * 100;
const today = todayIso();

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { gstin: '09AABCK1234M1ZI' });
});

const blank: CustomerInput = { name: 'Sunita', type: 'B2C', phone: '', email: '', gstin: '', address: '', city: '', state: '', pincode: '', notes: '' };
const customer = (over: Partial<CustomerInput> = {}) => customers.createCustomer(db, { ...blank, ...over });

function stocked(stock = 20) {
  const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: 'Silk', hsnCode: '5007', description: '', defaultPricePaise: rupees(1000) });
  const red = inventory.createVariant(db, d.id, { color: 'Red', size: '6 m', sellPricePaise: rupees(1000), baseCostPaise: 0, reorderLevel: 0, openingStock: stock, bom: [] });
  const blue = inventory.createVariant(db, d.id, { color: 'Blue', size: '6 m', sellPricePaise: rupees(1000), baseCostPaise: 0, reorderLevel: 0, openingStock: stock, bom: [] });
  const d2 = inventory.createDesign(db, { code: 'MG-002', name: 'Chanderi', fabric: 'Cotton silk', hsnCode: '5007', description: '', defaultPricePaise: rupees(500) });
  const green = inventory.createVariant(db, d2.id, { color: 'Green', size: '5.5 m', sellPricePaise: rupees(500), baseCostPaise: 0, reorderLevel: 0, openingStock: stock, bom: [] });
  return { red, blue, green };
}
const sell = (customerId: string | null, variantId: string, qty = 1, price = 1000, daysAgo = 0) =>
  invoices.createInvoice(db, { type: 'B2C', customerId, issueDate: addDays(today, -daysAgo), dueDate: addDays(today, -daysAgo), discountPaise: 0, notes: '', lines: [{ variantId, qty, unitPricePaise: rupees(price) }] });

describe('customer list filters', () => {
  it('picks out who owes, who holds advance, and business versus retail', () => {
    const { red } = stocked();
    const owes = customer({ name: 'Owes' });
    const clear = customer({ name: 'Clear' });
    const advance = customer({ name: 'Advance' });
    customer({ name: 'Biz', type: 'B2B', gstin: '09AABCK1234M1ZI' });
    sell(owes.id, red.id);
    const paid = sell(clear.id, red.id);
    payments.recordPayment(db, { customerId: clear.id, amountPaise: paid.totalPaise, method: 'cash', reference: '', receivedOn: today, note: '', allocations: [{ invoiceId: paid.id, amountPaise: paid.totalPaise }] });
    payments.recordPayment(db, { customerId: advance.id, amountPaise: rupees(500), method: 'upi', reference: '', receivedOn: today, note: '', allocations: [] });
    const all = customers.listCustomers(db);
    const names = (f: Parameters<typeof filterCustomers>[1]) => filterCustomers(all, f).map((c) => c.name).sort();
    expect(names('all')).toEqual(['Advance', 'Biz', 'Clear', 'Owes']);
    expect(names('owes')).toEqual(['Owes']);
    expect(names('advance')).toEqual(['Advance']);
    expect(names('b2b')).toEqual(['Biz']);
    expect(names('b2c')).toEqual(['Advance', 'Clear', 'Owes']);
    expect(Object.keys(CUSTOMER_FILTER_LABEL)).toHaveLength(5);
  });
});

describe('finding duplicates', () => {
  const fake = (over: Partial<Customer>): Customer => ({ ...blank, id: Math.random().toString(36), loyaltyPoints: 0, tags: '', creditLimitPaise: 0, paymentTermsDays: null, birthday: '', anniversary: '', addresses: [], contacts: [], invoiceCount: 0, billedPaise: 0, creditedPaise: 0, outstandingPaise: 0, advancePaise: 0, ...over });

  it('treats differently written phone numbers as the same number', () => {
    expect(phoneKey('+91 98765-43210')).toBe('9876543210');
    expect(phoneKey('098765 43210')).toBe('9876543210');
    expect(phoneKey('9876543210')).toBe('9876543210');
    expect(phoneKey('12345')).toBe(''); // too short to mean anything
    expect(phoneKey('')).toBe('');
  });

  it('groups customers sharing a phone number or a GSTIN, and ignores names alone', () => {
    const a = fake({ name: 'Sunita Devi', phone: '98765 43210' });
    const b = fake({ name: 'Sunita D.', phone: '+91 9876543210' });
    const c = fake({ name: 'Sunita Devi', phone: '9000000000' }); // same name, different person
    const d = fake({ name: 'Kanchan', type: 'B2B', gstin: '09aabck1234m1zi' });
    const e = fake({ name: 'Kanchan Sarees', type: 'B2B', gstin: '09AABCK1234M1ZI' });
    const groups = findDuplicateGroups([a, b, c, d, e]);
    expect(groups.map((g) => [g.reason, g.customers.map((x) => x.id).sort()])).toEqual([
      ['gstin', [d.id, e.id].sort()],
      ['phone', [a.id, b.id].sort()],
    ]);
    expect(findDuplicateGroups([a, c])).toEqual([]);
    expect(findDuplicateGroups([fake({ phone: '' }), fake({ phone: '' })])).toEqual([]); // blanks never match
  });
});

describe('what a customer usually buys', () => {
  it('ranks their colours and sizes by pieces, and works out what a piece usually costs them', () => {
    const { red, blue, green } = stocked();
    const c = customer();
    sell(c.id, red.id, 3, 1000, 40);
    sell(c.id, blue.id, 1, 1200, 10);
    sell(c.id, green.id, 2, 500, 25);
    sell(customer({ name: 'Someone else' }).id, blue.id, 9);
    const t = customers.customerTaste(db, c.id);
    expect(t.colors).toEqual([{ name: 'Red', pieces: 3 }, { name: 'Green', pieces: 2 }, { name: 'Blue', pieces: 1 }]);
    expect(t.sizes).toEqual([{ name: '6 m', pieces: 4 }, { name: '5.5 m', pieces: 2 }]);
    expect(t).toMatchObject({ pieces: 6, invoiceCount: 3, lastBoughtOn: addDays(today, -10), averagePiecePaise: Math.round(rupees(5200) / 6) });
  });

  it('counts only invoices that stand, and is empty for a customer who has bought nothing', () => {
    const { red } = stocked();
    const c = customer();
    expect(customers.customerTaste(db, c.id)).toEqual({ pieces: 0, invoiceCount: 0, averagePiecePaise: 0, lastBoughtOn: null, colors: [], sizes: [] });
    invoices.cancelInvoice(db, sell(c.id, red.id, 2).id, '');
    expect(customers.customerTaste(db, c.id).pieces).toBe(0);
    expect(() => customers.customerTaste(db, 'nope')).toThrow(/no longer exists/);
  });
});

describe('what a customer has bought', () => {
  it('adds up each design, with its colours and when it was last bought, newest first', () => {
    const { red, blue, green } = stocked();
    const c = customer();
    sell(c.id, red.id, 2, 1000, 40);
    sell(c.id, blue.id, 1, 1100, 10);
    sell(c.id, green.id, 3, 500, 25);
    sell(customer({ name: 'Someone else' }).id, red.id, 9); // another customer: not counted
    const p = customers.customerPurchases(db, c.id);
    expect(p.map((x) => x.designName)).toEqual(['Butidar', 'Chanderi']);
    expect(p[0]).toMatchObject({ pieces: 3, amountPaise: rupees(3100), invoiceCount: 2, lastBoughtOn: addDays(today, -10) });
    expect(p[0]!.variants).toEqual(['Blue 6 m', 'Red 6 m']); // most recent first
    expect(p[1]).toMatchObject({ pieces: 3, amountPaise: rupees(1500), invoiceCount: 1 });
  });

  it('leaves out cancelled invoices, and is empty for a new customer', () => {
    const { red } = stocked();
    const c = customer();
    expect(customers.customerPurchases(db, c.id)).toEqual([]);
    invoices.cancelInvoice(db, sell(c.id, red.id, 2).id, '');
    expect(customers.customerPurchases(db, c.id)).toEqual([]);
    expect(() => customers.customerPurchases(db, 'nope')).toThrow(/no longer exists/);
  });
});

describe('merging customers', () => {
  it('moves invoices, payments and quotes to the kept customer and archives the duplicate', () => {
    const { red } = stocked();
    const keep = customer({ name: 'Sunita Devi' });
    const dupe = customer({ name: 'Sunita D.', phone: '9876543210', email: 's@example.com', city: 'Mau', notes: 'Likes silk' });
    const inv = sell(dupe.id, red.id, 2);
    payments.recordPayment(db, { customerId: dupe.id, amountPaise: rupees(300), method: 'cash', reference: '', receivedOn: today, note: '', allocations: [{ invoiceId: inv.id, amountPaise: rupees(300) }] });
    payments.recordPayment(db, { customerId: dupe.id, amountPaise: rupees(200), method: 'cash', reference: '', receivedOn: today, note: '', allocations: [] }); // advance
    const quote = proformas.createProforma(db, { type: 'B2C', customerId: dupe.id, issueDate: today, validUntil: addDays(today, 10), discountPaise: 0, notes: '', lines: [{ variantId: red.id, qty: 1, unitPricePaise: rupees(1000) }] });

    const merged = customers.mergeCustomers(db, keep.id, dupe.id);
    expect(merged).toMatchObject({ id: keep.id, name: 'Sunita Devi', phone: '9876543210', email: 's@example.com', city: 'Mau', invoiceCount: 1, outstandingPaise: inv.totalPaise - rupees(300), advancePaise: rupees(200) });
    expect(merged.notes).toBe('From Sunita D.: Likes silk');
    expect(invoices.getInvoice(db, inv.id).customerId).toBe(keep.id);
    expect(invoices.getInvoice(db, inv.id).buyerName).toBe('Sunita D.'); // what was printed on the invoice stays
    expect(proformas.getProforma(db, quote.id).customerId).toBe(keep.id);
    expect(payments.listPayments(db, { customerId: keep.id })).toHaveLength(2);
    expect(customers.listCustomers(db).map((c) => c.id)).toEqual([keep.id]);
    expect(() => customers.getCustomer(db, dupe.id)).toThrow(/no longer exists/);
  });

  it('keeps the kept customer\'s own details when both have them', () => {
    const keep = customer({ name: 'A', phone: '1111111111', city: 'Varanasi' });
    const dupe = customer({ name: 'B', phone: '2222222222', city: 'Mau' });
    expect(customers.mergeCustomers(db, keep.id, dupe.id)).toMatchObject({ phone: '1111111111', city: 'Varanasi' });
  });

  it('refuses to merge a customer into themselves or into one that is gone', () => {
    const a = customer();
    const b = customer({ name: 'B' });
    expect(() => customers.mergeCustomers(db, a.id, a.id)).toThrow(/two different/);
    customers.archiveCustomer(db, b.id);
    expect(() => customers.mergeCustomers(db, a.id, b.id)).toThrow(/no longer exists/);
    expect(customers.getCustomer(db, a.id).invoiceCount).toBe(0);
  });

  it('works through the API', async () => {
    const api = createApi(db);
    const a = customer({ phone: '9876543210' });
    const b = customer({ name: 'B', phone: '9876543210' });
    expect((await api.customerMerge(a.id, b.id)).id).toBe(a.id);
    expect(await api.customerPurchases(a.id)).toEqual([]);
  });
});

describe('customer export', () => {
  it('writes one row per customer with what they owe or hold', () => {
    const { red } = stocked();
    const c = customer({ name: 'Sunita, Devi', phone: '9876543210', city: 'Mau', state: 'Uttar Pradesh' });
    sell(c.id, red.id);
    const csv = customersCsv(customers.listCustomers(db));
    const lines = csv.replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toBe('Customer,Type,Phone,Email,GSTIN,City,State,Invoices,Billed,Owes,Advance held,Tags');
    expect(lines[1]).toBe('"Sunita, Devi",B2C,9876543210,,,Mau,Uttar Pradesh,1,1050.00,1050.00,0.00,');
  });
});
