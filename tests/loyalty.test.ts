import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import * as credits from '../electron/services/creditNotes';
import * as customers from '../electron/services/customers';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as loyalty from '../electron/services/loyalty';
import { notifications } from '../electron/services/notifications';
import { saveSettings } from '../electron/services/settings';
import { todayIso } from '../shared/gst';

const rupees = (n: number) => n * 100;
const today = todayIso();
let db: Db;
let variantId: string;
let designId: string;
let customerId: string;

beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { gstin: '09AABCK1234M1ZI', state: 'Uttar Pradesh', gstRatePercent: 0 });
  const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: '', hsnCode: '', description: '', defaultPricePaise: rupees(1000) });
  designId = d.id;
  variantId = inventory.createVariant(db, d.id, { color: 'Red', size: '6 m', sellPricePaise: rupees(1000), baseCostPaise: 0, reorderLevel: 0, openingStock: 20, bom: [] }).id;
  customerId = customers.createCustomer(db, { name: 'Meena', type: 'B2C', phone: '', email: '', gstin: '', address: '', city: 'Mau', state: 'Uttar Pradesh', pincode: '', notes: '' }).id;
});

const sell = (qty: number, over: Partial<Parameters<typeof invoices.createInvoice>[1]> = {}) =>
  invoices.createInvoice(db, { type: 'B2C', customerId, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId, qty, unitPricePaise: rupees(1000) }], ...over });
const points = () => loyalty.balance(db, customerId);

describe('loyalty points', () => {
  it('are off until the shop says how many rupees earn a point', () => {
    sell(2);
    expect(points()).toBe(0);
    expect(loyalty.history(db, customerId)).toEqual([]);
  });

  it('are earned on what a saved customer is billed, and not on walk-in sales', () => {
    saveSettings(db, { loyaltySpendPaise: rupees(100) });
    sell(2); // ₹2,000 → 20 points
    expect(points()).toBe(20);
    expect(customers.getCustomer(db, customerId).loyaltyPoints).toBe(20);
    sell(1, { customerId: null, buyerName: 'Anita' });
    expect(points()).toBe(20);
    expect(loyalty.history(db, customerId)[0]).toMatchObject({ points: 20, reason: 'earned' });
  });

  it('can be spent as a discount on a later invoice, but only for real and in full', () => {
    saveSettings(db, { loyaltySpendPaise: rupees(100), loyaltyPointValuePaise: 100 });
    sell(2);
    expect(() => sell(1, { redeemPoints: 21, discountPaise: rupees(21) })).toThrow(/only 20 loyalty points/);
    expect(() => sell(1, { redeemPoints: 10, discountPaise: rupees(5) })).toThrow(/must include the value of the points/);
    expect(() => sell(1, { customerId: null, redeemPoints: 1, discountPaise: 100 })).toThrow(/saved customer/);
    expect(points()).toBe(20); // the failed tries took nothing
    const inv = sell(1, { redeemPoints: 10, discountPaise: rupees(10) }); // ₹1,000 less ₹10 = ₹990 → 9 points
    expect(inv.totalPaise).toBe(rupees(990));
    expect(points()).toBe(20 - 10 + 9);
    expect(loyalty.history(db, customerId).map((h) => h.reason)).toEqual(['earned', 'redeemed', 'earned']);
  });

  it('come back and go away again when the invoice is cancelled', () => {
    saveSettings(db, { loyaltySpendPaise: rupees(100) });
    sell(2);
    const inv = sell(1, { redeemPoints: 10, discountPaise: rupees(10) });
    expect(points()).toBe(20 - 10 + 9);
    invoices.cancelInvoice(db, inv.id, 'wrong');
    expect(points()).toBe(20);
  });

  it('are taken back in step with goods returned, as far as the customer still has them', () => {
    saveSettings(db, { loyaltySpendPaise: rupees(100) });
    const inv = sell(3); // 30 points
    const line = invoices.getInvoice(db, inv.id).lines[0]!;
    credits.createCreditNote(db, { invoiceId: inv.id, issueDate: today, reason: 'Returned', lines: [{ invoiceLineId: line.id, qty: 1, restock: true }], settlement: 'credit' });
    expect(points()).toBe(20);
    loyalty.adjust(db, { customerId, points: -18, note: 'spent in the shop' });
    credits.createCreditNote(db, { invoiceId: inv.id, issueDate: today, reason: 'Returned', lines: [{ invoiceLineId: line.id, qty: 1, restock: true }], settlement: 'credit' });
    expect(points()).toBe(0); // 2 left, 10 owed back: only what is there is taken
  });

  it('can be adjusted by hand with a reason, and never below zero', () => {
    expect(() => loyalty.adjust(db, { customerId, points: 5, note: '' })).toThrow(/Say why/);
    expect(() => loyalty.adjust(db, { customerId, points: 0, note: 'x' })).toThrow(/points to add/);
    expect(() => loyalty.adjust(db, { customerId, points: -1, note: 'x' })).toThrow(/below zero/);
    expect(loyalty.adjust(db, { customerId, points: 50, note: 'birthday gift' })).toBe(50);
    expect(loyalty.history(db, customerId)[0]).toMatchObject({ points: 50, reason: 'adjustment', note: 'birthday gift' });
  });

  it('checks the settings', () => {
    expect(() => saveSettings(db, { loyaltyPointValuePaise: 0 })).toThrow();
    expect(() => saveSettings(db, { loyaltySpendPaise: -5 })).toThrow();
  });
});

describe('wishlist', () => {
  it('keeps the designs a customer is waiting for, once each', () => {
    const list = loyalty.addWish(db, { customerId, designId, note: 'in green' });
    expect(list).toMatchObject([{ designId, designName: 'Butidar', note: 'in green', inStock: true }]);
    expect(() => loyalty.addWish(db, { customerId, designId })).toThrow(/already on their wishlist/);
    expect(() => loyalty.addWish(db, { customerId, designId: 'nope' })).toThrow(/no longer exists/);
    loyalty.removeWish(db, list[0]!.id);
    expect(loyalty.wishlist(db, customerId)).toEqual([]);
    expect(() => loyalty.removeWish(db, list[0]!.id)).toThrow(/no longer on the list/);
  });

  it('prompts a notification once the design is in stock, and clears itself when she buys it', () => {
    const empty = inventory.createDesign(db, { code: 'MG-009', name: 'Kadhua', fabric: '', hsnCode: '', description: '', defaultPricePaise: 1 });
    const v = inventory.createVariant(db, empty.id, { color: 'Wine', size: '6 m', sellPricePaise: rupees(500), baseCostPaise: 0, reorderLevel: 0, bom: [] });
    loyalty.addWish(db, { customerId, designId: empty.id });
    expect(notifications(db, today).some((n) => n.kind === 'wishlist-ready')).toBe(false);
    inventory.adjustStock(db, { variantId: v.id, delta: 3, reason: 'purchase' });
    const n = notifications(db, today).find((x) => x.kind === 'wishlist-ready')!;
    expect(n).toMatchObject({ severity: 'info', title: 'Meena was waiting for Kadhua' });
    invoices.createInvoice(db, { type: 'B2C', customerId, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: v.id, qty: 1, unitPricePaise: rupees(500) }] });
    expect(loyalty.wishlist(db, customerId)).toEqual([]);
    expect(notifications(db, today).some((x) => x.kind === 'wishlist-ready')).toBe(false);
  });

  it('goes through the typed API and the activity log', async () => {
    const api = createApi(db);
    await api.wishlistAdd({ customerId, designId });
    expect((await api.wishlistGet(customerId)).length).toBe(1);
    expect(await api.loyaltyAdjust({ customerId, points: 5, note: 'welcome' })).toBe(5);
    expect((await api.loyaltyHistory(customerId))[0]).toMatchObject({ points: 5 });
    const labels = (await api.auditList()).map((e) => e.label);
    expect(labels.slice(0, 2)).toEqual(['Changed loyalty points', 'Added to a wishlist']);
  });
});
