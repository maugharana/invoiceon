import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import { notifications } from '../electron/services/notifications';
import * as customers from '../electron/services/customers';
import * as expenses from '../electron/services/expenses';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as materials from '../electron/services/materials';
import * as notes from '../electron/services/notes';
import * as payments from '../electron/services/payments';
import * as instalments from '../electron/services/instalments';
import * as proformas from '../electron/services/proformas';
import { saveSettings } from '../electron/services/settings';
import { addDays, todayIso } from '../shared/gst';

const rupees = (n: number) => n * 100;
const today = todayIso();
let db: Db;
let api: ReturnType<typeof createApi>;

beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { gstin: '09AABCK1234M1ZI' });
  api = createApi(db);
});

const person = { name: 'Meena', type: 'B2C' as const, phone: '', email: '', gstin: '', address: '', city: '', state: '', pincode: '', notes: '' };

describe('the activity log', () => {
  it('records each change in plain words, newest first, with what it touched', async () => {
    const c = await api.customerCreate(person);
    const d = await api.designCreate({ code: 'MG-001', name: 'Butidar', fabric: '', hsnCode: '', description: '', defaultPricePaise: rupees(1000) });
    const v = await api.variantCreate(d.id, { color: 'Red', size: '6 m', sellPricePaise: rupees(1000), baseCostPaise: 0, reorderLevel: 0, openingStock: 5, bom: [] });
    const inv = await api.invoiceCreate({ type: 'B2C', customerId: c.id, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: v.id, qty: 1, unitPricePaise: rupees(1000) }] });

    const log = await api.auditList();
    expect(log.map((e) => e.label)).toEqual(['Issued an invoice', 'Added a colour and size', 'Added a design', 'Added a customer']);
    expect(log[0]).toMatchObject({ entityType: 'invoice', entityId: inv.id, action: 'invoiceCreate' });
    expect(log[0]!.summary).toContain(inv.number);
    expect(log[0]!.summary).toContain('₹1,050');
    expect(log[3]).toMatchObject({ entityType: 'customer', entityId: c.id, summary: 'Meena' });
    // A colour and size is filed under the design it belongs to, so the design's history shows it.
    expect(log[1]).toMatchObject({ entityType: 'design', entityId: d.id });
  });

  it('takes the id from the first argument for changes that return nothing, and says what changed', async () => {
    const c = await api.customerCreate(person);
    await api.customerArchive(c.id);
    await api.saveSettings({ businessName: 'Mau Gharana Sarees', city: 'Mau' });
    await api.saveSettings({ businessName: 'Mau Gharana Sarees', city: 'Mau' });
    const log = await api.auditList();
    expect(log.map((e) => e.label)).toEqual(['Changed settings', 'Changed settings', 'Archived a customer', 'Added a customer']);
    expect(log[2]).toMatchObject({ entityType: 'customer', entityId: c.id });
    // The settings screen sends everything; only what is actually different is named.
    expect(log[1]!.summary).toBe('businessName');
    expect(log[0]!.summary).toBe('nothing different');
  });

  it('does not log reading, searching or anything that failed', async () => {
    await api.customersList();
    await api.invoicesList();
    await expect(api.customerGet('nope')).rejects.toThrow();
    await expect(api.customerCreate({ ...person, name: '' })).rejects.toThrow();
    expect(await api.auditList()).toEqual([]);
  });

  it('can be searched and filtered by kind of thing and by day', async () => {
    await api.customerCreate(person);
    await api.customerCreate({ ...person, name: 'Sunita' });
    await api.expenseCreate({ date: today, category: 'Rent', vendor: '', amountPaise: rupees(100), method: 'cash', reference: '', note: '' });
    expect((await api.auditList({ entityType: 'expense' })).map((e) => e.label)).toEqual(['Recorded an expense']);
    expect((await api.auditList({ search: 'sunita' })).map((e) => e.summary)).toEqual(['Sunita']);
    expect(await api.auditList({ from: today, to: today })).toHaveLength(3);
    expect(await api.auditList({ from: addDays(today, 1) })).toEqual([]);
    expect(await api.auditList({ to: addDays(today, -1) })).toEqual([]);
    expect(await api.auditList({ limit: 2 })).toHaveLength(2);
  });

  it('never gets in the way: a log that cannot be written does not fail the change', async () => {
    db.exec('DROP TABLE audit_log');
    const c = await api.customerCreate(person);
    expect(c.name).toBe('Meena');
    expect(customers.getCustomer(db, c.id).name).toBe('Meena');
  });
});

describe('bills on hold', () => {
  it('sets a half-made bill aside under a name, lists it, and lets it go', async () => {
    const payload = { type: 'B2C', customerId: null, buyerName: 'Anita', lines: [{ variantId: 'v1', qty: '2', price: 100000 }] };
    const held = await api.heldHold({ name: 'Anita - waiting for her sister', payload });
    expect(held).toMatchObject({ name: 'Anita - waiting for her sister', kind: 'invoice', payload });
    await api.heldHold({ name: 'Quote draft', kind: 'proforma', payload });
    expect((await api.heldList()).map((h) => h.name)).toEqual(['Anita - waiting for her sister']);
    expect((await api.heldList('proforma')).map((h) => h.name)).toEqual(['Quote draft']);
    await api.heldDiscard(held.id);
    expect(await api.heldList()).toEqual([]);
    await expect(api.heldDiscard(held.id)).rejects.toThrow(/no longer exists/);
  });

  it('needs a name and something to hold, and stops at 50', async () => {
    await expect(api.heldHold({ name: ' ', payload: { a: 1 } })).rejects.toThrow(/name/);
    await expect(api.heldHold({ name: 'x', payload: null })).rejects.toThrow(/nothing to hold/);
    for (let i = 0; i < 50; i++) await api.heldHold({ name: `Bill ${i}`, payload: { i } });
    await expect(api.heldHold({ name: 'One more', payload: { i: 51 } })).rejects.toThrow(/50 bills/);
  });

  it('holding a bill touches no stock and no money', async () => {
    const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: '', hsnCode: '', description: '', defaultPricePaise: 1 });
    const v = inventory.createVariant(db, d.id, { color: 'Red', size: '6 m', sellPricePaise: 1, baseCostPaise: 0, reorderLevel: 0, openingStock: 5, bom: [] });
    await api.heldHold({ name: 'Wait', payload: { lines: [{ variantId: v.id, qty: '3', price: 1 }] } });
    expect(inventory.getVariant(db, v.id).stock).toBe(5);
    expect(invoices.listInvoices(db)).toEqual([]);
  });
});

describe('the notifications centre', () => {
  const sell = (customerId: string | null, dueDate: string, over: Partial<Parameters<typeof invoices.createInvoice>[1]> = {}) => {
    const existing = inventory.listDesigns(db)[0];
    const d = existing ?? inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: '', hsnCode: '', description: '', defaultPricePaise: rupees(1000) });
    const variant = inventory.loadVariants(db, { designId: d.id })[0] ?? inventory.createVariant(db, d.id, { color: 'Red', size: '6 m', sellPricePaise: rupees(1000), baseCostPaise: rupees(100), reorderLevel: 1, openingStock: 50, bom: [] });
    return invoices.createInvoice(db, { type: 'B2C', customerId, issueDate: addDays(today, -30), dueDate, discountPaise: 0, notes: '', lines: [{ variantId: variant.id, qty: 1, unitPricePaise: rupees(1000) }], ...over });
  };

  it('is empty when nothing needs doing', () => {
    expect(notifications(db, today)).toEqual([]);
  });

  it('gathers overdue invoices, due follow-ups, cheques, bills, instalments, budgets, materials and stock — urgent first', () => {
    saveSettings(db, { expenseBudgets: { Rent: rupees(1000) }, paymentAccounts: [{ id: 'bank', name: 'SBI', kind: 'bank', details: '', openingPaise: 0 }] });
    const c = customers.createCustomer(db, person);
    const late = sell(c.id, addDays(today, -5));
    notes.addNote(db, { subjectType: 'customer', subjectId: c.id, kind: 'followup', body: 'Ring about the balance', dueDate: today });
    payments.recordPayment(db, { customerId: c.id, amountPaise: rupees(500), method: 'cheque', reference: 'CHQ 1', receivedOn: today, note: '', allocations: [], chequeDate: addDays(today, 1) });
    expenses.createExpense(db, { date: today, category: 'Rent', vendor: 'Landlord', amountPaise: rupees(1500), method: 'bank', reference: '', note: '', status: 'unpaid', dueDate: addDays(today, -1) });
    instalments.setInstalments(db, late.id, [{ dueDate: addDays(today, -2), amountPaise: late.totalPaise }]);
    materials.createMaterial(db, { name: 'Zari', unit: 'kg', unitCostPaise: 1, openingQty: 0, reorderQty: 2 });
    expenses.createRecurring(db, { category: 'Internet', vendor: '', amountPaise: rupees(1000), method: 'bank', note: '', frequency: 'monthly', nextDate: addDays(today, -1) });

    const list = notifications(db, today);
    const kinds = list.map((n) => n.kind);
    for (const k of ['overdue-invoices', 'follow-up', 'cheque-due', 'bill-due', 'instalment-due', 'budget', 'low-material', 'recurring-due'] as const) expect(kinds).toContain(k);
    // Nothing "soon" is ahead of anything "urgent".
    const order = list.map((n) => n.severity);
    expect(order).toEqual([...order].sort((a, b) => ['urgent', 'soon', 'info'].indexOf(a) - ['urgent', 'soon', 'info'].indexOf(b)));
    expect(list.find((n) => n.kind === 'overdue-invoices')).toMatchObject({ severity: 'urgent', link: { to: 'path', path: '/invoices?status=overdue' } });
    expect(list.find((n) => n.kind === 'budget')).toMatchObject({ severity: 'urgent', title: 'Rent is over budget' });
    expect(new Set(list.map((n) => n.id)).size).toBe(list.length); // every id is unique, so each can be marked read on its own
  });

  it('goes away by itself once the problem is dealt with', () => {
    const c = customers.createCustomer(db, person);
    const late = sell(c.id, addDays(today, -5));
    expect(notifications(db, today).some((n) => n.kind === 'overdue-invoices')).toBe(true);
    payments.recordPayment(db, { customerId: c.id, amountPaise: late.totalPaise, method: 'cash', reference: '', receivedOn: today, note: '', allocations: [{ invoiceId: late.id, amountPaise: late.totalPaise }] });
    expect(notifications(db, today).some((n) => n.kind === 'overdue-invoices')).toBe(false);
  });

  it('reminds about a quote about to lapse and a birthday coming up', () => {
    const c = customers.createCustomer(db, { ...person, birthday: `1990-${addDays(today, 5).slice(5)}` });
    const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: '', hsnCode: '', description: '', defaultPricePaise: 1 });
    const v = inventory.createVariant(db, d.id, { color: 'Red', size: '6 m', sellPricePaise: 100, baseCostPaise: 0, reorderLevel: 0, openingStock: 5, bom: [] });
    proformas.createProforma(db, { type: 'B2C', customerId: c.id, issueDate: today, validUntil: addDays(today, 2), discountPaise: 0, notes: '', lines: [{ variantId: v.id, qty: 1, unitPricePaise: 100 }] });
    const list = notifications(db, today);
    expect(list.find((n) => n.kind === 'quote-expiring')).toMatchObject({ severity: 'soon' });
    // A week's notice for a birthday, longer than the dashboard's three days.
    expect(list.find((n) => n.kind === 'occasion')).toMatchObject({ severity: 'info' });
  });
});
