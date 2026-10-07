import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import * as credits from '../electron/services/creditNotes';
import * as customers from '../electron/services/customers';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as team from '../electron/services/salespeople';
import { saveSettings } from '../electron/services/settings';
import { salespeopleCsv } from '../shared/csv';
import { addDays, todayIso } from '../shared/gst';
import type { InvoiceInput } from '../shared/types';

const rupees = (n: number) => n * 100;
const today = todayIso();
let db: Db;
let variantId: string;

beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { gstin: '09AABCK1234M1ZI', state: 'Uttar Pradesh' });
  const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: '', hsnCode: '5007', description: '', defaultPricePaise: rupees(1000) });
  variantId = inventory.createVariant(db, d.id, { color: 'Red', size: '6 m', sellPricePaise: rupees(1000), baseCostPaise: rupees(400), reorderLevel: 0, openingStock: 50, bom: [] }).id;
});

const sale = (over: Partial<InvoiceInput> = {}, qty = 1) =>
  invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId, qty, unitPricePaise: rupees(1000) }], ...over });

describe('the sales team', () => {
  it('adds people with a commission rate, and refuses a clash of names or a rate that makes no sense', () => {
    const a = team.createSalesperson(db, { name: '  Ravi  ', commissionPercent: 2.5 });
    expect(a).toMatchObject({ name: 'Ravi', commissionPercent: 2.5, archived: false, invoiceCount: 0 });
    expect(() => team.createSalesperson(db, { name: 'ravi', commissionPercent: 1 })).toThrow(/already someone called ravi/);
    for (const bad of [-1, 101, 1.234, Number.NaN]) expect(() => team.createSalesperson(db, { name: 'X', commissionPercent: bad })).toThrow(/percentage from 0 to 100/);
    expect(() => team.createSalesperson(db, { name: '   ', commissionPercent: 1 })).toThrow(/Name is required/);
  });

  it('changes a name or rate, and keeps archived people out of the way without losing them', () => {
    const a = team.createSalesperson(db, { name: 'Ravi', commissionPercent: 2 });
    const b = team.createSalesperson(db, { name: 'Anil', commissionPercent: 3 });
    expect(team.updateSalesperson(db, a.id, { name: 'Ravi Kumar', commissionPercent: 4 })).toMatchObject({ name: 'Ravi Kumar', commissionPercent: 4 });
    expect(() => team.updateSalesperson(db, a.id, { name: 'anil', commissionPercent: 4 })).toThrow(/already someone/);
    team.archiveSalesperson(db, b.id);
    expect(team.listSalespeople(db).map((p) => [p.name, p.archived])).toEqual([['Ravi Kumar', false], ['Anil', true]]);
    expect(() => team.archiveSalesperson(db, b.id)).toThrow(/already archived/);
    // The name is free again, and bringing the old one back then clashes.
    team.createSalesperson(db, { name: 'Anil', commissionPercent: 1 });
    expect(() => team.restoreSalesperson(db, b.id)).toThrow(/someone else on the team has that name/);
  });
});

describe('who made a sale', () => {
  it('is kept on the invoice with the rate at that moment, and a later change of rate does not touch it', () => {
    const ravi = team.createSalesperson(db, { name: 'Ravi', commissionPercent: 2 });
    const inv = sale({ salespersonId: ravi.id });
    expect(inv.soldBy).toEqual({ id: ravi.id, name: 'Ravi', commissionPercent: 2 });
    team.updateSalesperson(db, ravi.id, { name: 'Ravi', commissionPercent: 9 });
    expect(invoices.getInvoice(db, inv.id).soldBy?.commissionPercent).toBe(2);
    expect(team.listSalespeople(db)[0]!.invoiceCount).toBe(1);
    expect(sale().soldBy).toBeNull();
  });

  it('cannot be an unknown or archived person', () => {
    const ravi = team.createSalesperson(db, { name: 'Ravi', commissionPercent: 2 });
    expect(() => sale({ salespersonId: 'nobody' })).toThrow(/not on the sales team/);
    team.archiveSalesperson(db, ravi.id);
    expect(() => sale({ salespersonId: ravi.id })).toThrow(/archived/);
    // Nothing was issued by the failed attempts.
    expect(invoices.listInvoices(db)).toHaveLength(0);
  });

  it('can be put right after the invoice is issued, takes the new person\'s rate, and not on a cancelled invoice', () => {
    const ravi = team.createSalesperson(db, { name: 'Ravi', commissionPercent: 2 });
    const anil = team.createSalesperson(db, { name: 'Anil', commissionPercent: 5 });
    const inv = sale({ salespersonId: ravi.id });
    expect(invoices.setSoldBy(db, inv.id, anil.id).soldBy).toEqual({ id: anil.id, name: 'Anil', commissionPercent: 5 });
    expect(invoices.setSoldBy(db, inv.id, null).soldBy).toBeNull();
    invoices.cancelInvoice(db, inv.id, 'x');
    expect(() => invoices.setSoldBy(db, inv.id, anil.id)).toThrow(/cancelled/);
  });
});

describe('the sales team report', () => {
  it('adds up what each person sold before GST, less what came back, with commission at each bill\'s own rate', () => {
    const ravi = team.createSalesperson(db, { name: 'Ravi', commissionPercent: 10 });
    const anil = team.createSalesperson(db, { name: 'Anil', commissionPercent: 5 });
    team.createSalesperson(db, { name: 'Quiet', commissionPercent: 1 });
    const c = customers.createCustomer(db, { name: 'Meena', type: 'B2C', phone: '', email: '', gstin: '', address: '', city: 'Mau', state: 'Uttar Pradesh', pincode: '', notes: '' });
    const a = sale({ customerId: c.id, salespersonId: ravi.id }, 3); // ₹3,000 before GST
    sale({ salespersonId: anil.id });
    sale({}); // no one recorded
    credits.createCreditNote(db, { invoiceId: a.id, issueDate: today, reason: 'Returned', lines: [{ invoiceLineId: a.lines[0]!.id, qty: 1, restock: true }], settlement: 'credit' });
    // The rate changes afterwards: what was earned stays.
    team.updateSalesperson(db, ravi.id, { name: 'Ravi', commissionPercent: 50 });

    const r = team.salespeopleReport(db, { from: today, to: today });
    expect(r.rows.map((x) => x.name)).toEqual(['Ravi', 'Anil', 'Quiet', 'No one recorded']);
    expect(r.rows[0]).toMatchObject({ invoices: 1, salesPaise: rupees(3000), returnsPaise: rupees(1000), netPaise: rupees(2000), commissionPaise: rupees(200), commissionPercent: 50 });
    expect(r.rows[1]).toMatchObject({ invoices: 1, salesPaise: rupees(1000), commissionPaise: rupees(50) });
    expect(r.rows[2]).toMatchObject({ invoices: 0, netPaise: 0, commissionPaise: 0 });
    expect(r.rows[3]).toMatchObject({ salespersonId: null, invoices: 1, salesPaise: rupees(1000), commissionPaise: 0, commissionPercent: null });
    expect(r.totals).toEqual({ invoices: 3, salesPaise: rupees(5000), returnsPaise: rupees(1000), netPaise: rupees(4000), commissionPaise: rupees(250) });
  });

  it('counts only the period asked for, leaves cancelled invoices out, and still shows someone who has been archived', () => {
    const ravi = team.createSalesperson(db, { name: 'Ravi', commissionPercent: 10 });
    const inv = sale({ salespersonId: ravi.id });
    sale({ salespersonId: ravi.id, issueDate: addDays(today, -40), dueDate: addDays(today, -40) });
    const gone = sale({ salespersonId: ravi.id });
    invoices.cancelInvoice(db, gone.id, 'x');
    team.archiveSalesperson(db, ravi.id);
    const r = team.salespeopleReport(db, { from: addDays(today, -5), to: today });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ name: 'Ravi (archived)', invoices: 1, salesPaise: inv.taxablePaise });
    expect(() => team.salespeopleReport(db, { from: today, to: addDays(today, -1) })).toThrow(/after the end date/);
  });
});

describe('the sales team report as a spreadsheet', () => {
  it('lists each person with their rate, sales, returns, net and commission, and a total', () => {
    const ravi = team.createSalesperson(db, { name: 'Ravi, the senior', commissionPercent: 2 });
    sale({ salespersonId: ravi.id }, 2);
    const csv = salespeopleCsv(team.salespeopleReport(db, { from: today, to: today }));
    expect(csv).toContain('Salesperson,Commission rate %,Invoices,Sold before GST,Goods taken back,Net sales,Commission');
    expect(csv).toContain('"Ravi, the senior",2,1,2000.00,0.00,2000.00,40.00');
    expect(csv).toContain('Total,,1,2000.00,0.00,2000.00,40.00');
  });
});

describe('who may manage the sales team', () => {
  it('is an owner; staff can still record who made a sale on their own bills', async () => {
    const api = createApi(db);
    const owner = await api.userCreate({ name: 'Mau', role: 'owner', pin: '1234' });
    await api.sessionLogin(owner.id, '1234');
    const staff = await api.userCreate({ name: 'Ravi', role: 'staff', pin: '5678' });
    const person = await api.salespersonCreate({ name: 'Anil', commissionPercent: 3 });
    await api.sessionLogout();
    await api.sessionLogin(staff.id, '5678');
    for (const call of [() => api.salespersonCreate({ name: 'X', commissionPercent: 1 }), () => api.salespersonUpdate(person.id, { name: 'Y', commissionPercent: 1 }), () => api.salespersonArchive(person.id), () => api.reportSalespeople({ from: today, to: today }), () => api.invoiceSetSoldBy('x', null)]) {
      await expect(call()).rejects.toThrow(/Only an owner/);
    }
    await expect(api.salespeopleList()).resolves.toHaveLength(1);
    const inv = await api.invoiceCreate({ type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', salespersonId: person.id, lines: [{ variantId, qty: 1, unitPricePaise: rupees(1000) }] });
    expect(inv.soldBy?.name).toBe('Anil');
  });
});
