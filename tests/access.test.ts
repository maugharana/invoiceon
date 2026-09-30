import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ALWAYS_ALLOWED, LOCKED_MESSAGE, METHOD_CAPABILITY, canDo, capabilityOf, redactCosts } from '../shared/access';
import type { Api } from '../shared/api';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import { todayIso } from '../shared/gst';

const today = todayIso();
const rupees = (n: number) => n * 100;
let db: Db;
let api: Api;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'invoiceon-access-'));
  db = openDb(join(dir, 'invoiceon.db'));
  api = createApi(db, undefined, dir);
});

/** Stock, a material with a cost, and one saree, all entered while access control is still off. */
async function shop() {
  await api.saveSettings({ state: 'Uttar Pradesh', gstin: '09AAACH7409R1ZZ' });
  const silk = await api.materialCreate({ name: 'Silk yarn', unit: 'kg', unitCostPaise: rupees(4000) });
  const d = await api.designCreate({ code: 'MG-001', name: 'Butidar', fabric: 'Silk', hsnCode: '5007', description: '', defaultPricePaise: rupees(9800) });
  const v = await api.variantCreate(d.id, { color: 'Maroon', size: '6.3 m', sellPricePaise: rupees(9800), baseCostPaise: rupees(1800), reorderLevel: 1, openingStock: 10, bom: [{ materialId: silk.id, qty: 0.5 }] });
  return { d, v, silk };
}
const sale = (variantId: string) => ({ type: 'B2C' as const, customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId, qty: 1, unitPricePaise: rupees(9800) }] });

/** Turns access control on with an owner, then adds a manager and a counter person. Everyone is left signed out. */
async function people() {
  await api.accessEnable('Ahmad', '4321');
  const manager = await api.accessUserSave(null, { name: 'Meera', role: 'manager', pin: '2468' });
  const staff = await api.accessUserSave(null, { name: 'Rafiq', role: 'staff', pin: '1357' });
  const owner = (await api.accessUsers()).find((u) => u.role === 'owner')!;
  await api.accessLogout();
  return { owner, manager, staff };
}

describe('while access control is off', () => {
  it('is exactly the app as it was: nothing is asked, everything works, the log says Owner', async () => {
    const { v } = await shop();
    expect(await api.accessStatus()).toMatchObject({ enabled: false, user: null, people: [] });
    const inv = await api.invoiceCreate(sale(v.id));
    await api.invoiceCancel(inv.id, '');
    await api.saveSettings({ city: 'Mau' });
    expect((await api.auditList())[0]!.actor).toBe('Owner');
  });
});

describe('turning it on', () => {
  it('makes the first person the owner, signs them in, and never stores the PIN', async () => {
    const status = await api.accessEnable('Ahmad', '4321');
    expect(status).toMatchObject({ enabled: true, user: { name: 'Ahmad', role: 'owner' } });
    const row = db.prepare('SELECT pin_hash, pin_salt FROM users').get() as { pin_hash: string; pin_salt: string };
    expect(row.pin_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.pin_hash).not.toContain('4321');
    await expect(api.accessEnable('Again', '1111')).rejects.toThrow(/already on/);
  });

  it('insists on a real PIN and a name', async () => {
    await expect(api.accessEnable('Ahmad', '12')).rejects.toThrow(/4 to 8 digits/);
    await expect(api.accessEnable('Ahmad', 'abcd')).rejects.toThrow(/4 to 8 digits/);
    await expect(api.accessEnable(' ', '1234')).rejects.toThrow(/required/);
    expect((await api.accessStatus()).enabled).toBe(false);
  });
});

describe('signing in', () => {
  it('locks the app when you sign out, and opens it again with the right PIN', async () => {
    const { owner } = await people();
    await expect(api.invoicesList()).rejects.toThrow(LOCKED_MESSAGE);
    await expect(api.getSettings()).rejects.toThrow(LOCKED_MESSAGE);
    const status = await api.accessStatus(); // always works, so the sign-in page can show who can sign in
    expect(status).toMatchObject({ enabled: true, user: null });
    expect(status.people.map((p) => p.name)).toEqual(['Ahmad', 'Meera', 'Rafiq']);
    await expect(api.accessLogin(owner.id, '9999')).rejects.toThrow(/not right/);
    expect((await api.accessLogin(owner.id, '4321')).user).toMatchObject({ name: 'Ahmad', role: 'owner' });
    expect(await api.invoicesList()).toEqual([]);
  });

  it('slows down guessing: five wrong PINs lock that person out for a little while, and it is logged', async () => {
    const { owner } = await people();
    for (let i = 0; i < 4; i++) await expect(api.accessLogin(owner.id, '0000')).rejects.toThrow(/not right/);
    await expect(api.accessLogin(owner.id, '0000')).rejects.toThrow(/Too many wrong PINs/);
    await expect(api.accessLogin(owner.id, '4321')).rejects.toThrow(/Too many wrong PINs/); // even the right one, for now
    await api.accessLogin((await api.accessStatus()).people.find((p) => p.name === 'Meera')!.id, '2468'); // other people are unaffected
    const failed = (db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'Failed sign in'").get() as { n: number }).n;
    expect(failed).toBe(5);
  });

  it('records who signed in and out, and uses their name in the log', async () => {
    const { owner } = await people();
    await api.accessLogin(owner.id, '4321');
    const { v } = await shop();
    const inv = await api.invoiceCreate(sale(v.id));
    await api.accessLogout();
    const summaries = db.prepare('SELECT actor, summary FROM audit_log ORDER BY rowid').all() as { actor: string; summary: string }[];
    expect(summaries.some((s) => s.summary === 'Ahmad signed in')).toBe(true);
    expect(summaries.some((s) => s.actor === 'Ahmad' && s.summary.includes(inv.number))).toBe(true);
    expect(summaries.at(-1)!.summary).toBe('Ahmad signed out');
  });
});

describe('what each role may do', () => {
  it('lets counter staff sell but not cancel, change stock, see reports, or touch settings', async () => {
    const { v } = await shop();
    const { staff } = await people();
    await api.accessLogin(staff.id, '1357');
    const inv = await api.invoiceCreate(sale(v.id)); // selling is what they are here for
    await api.paymentRecord({ customerId: null, amountPaise: rupees(1), method: 'cash', reference: '', receivedOn: today, note: '', allocations: [{ invoiceId: inv.id, amountPaise: rupees(1) }] });
    await api.customerCreate({ name: 'Sunita', type: 'B2C', phone: '', email: '', gstin: '', address: '', city: '', state: '', pincode: '', notes: '' });
    const denied = [
      () => api.invoiceCancel(inv.id, ''),
      () => api.stockAdjust({ variantId: v.id, delta: 1, reason: 'purchase' }),
      () => api.variantUpdate(v.id, { color: 'Maroon', size: '6.3 m', sellPricePaise: 1, baseCostPaise: 0, reorderLevel: 0, bom: [] }),
      () => api.reportSales({ from: today, to: today }),
      () => api.dashboardOverview(null),
      () => api.expensesList(),
      () => api.suppliersList(),
      () => api.weaversList(),
      () => api.saveSettings({ city: 'Somewhere' }),
      () => api.backupNow(),
      () => api.auditList(),
      () => api.accessUsers(),
    ];
    for (const call of denied) await expect(call()).rejects.toThrow(/Rafiq \(Counter staff\) doesn't have permission/);
  });

  it('gives a manager everything except settings, backups, the log and people', async () => {
    const { v } = await shop();
    const { manager } = await people();
    await api.accessLogin(manager.id, '2468');
    const inv = await api.invoiceCreate(sale(v.id));
    await api.invoiceCancel(inv.id, 'test');
    await api.stockAdjust({ variantId: v.id, delta: 1, reason: 'purchase' });
    await api.reportSales({ from: today, to: today });
    await api.supplierCreate({ name: 'S', gstin: '', phone: '', email: '', address: '', city: '', state: '', pincode: '', notes: '' });
    for (const call of [() => api.saveSettings({ city: 'x' }), () => api.backupNow(), () => api.auditList(), () => api.integrityCheck(), () => api.accessUsers(), () => api.accessUserSave(null, { name: 'Z', role: 'staff', pin: '1111' })]) {
      await expect(call()).rejects.toThrow(/doesn't have permission/);
    }
  });

  it('gives the owner everything', async () => {
    const { owner } = await people();
    await api.accessLogin(owner.id, '4321');
    await api.saveSettings({ city: 'Mau' });
    await api.backupNow();
    await api.auditList();
    await api.integrityCheck();
    expect((await api.accessUsers()).length).toBe(3);
  });

  it('never shows counter staff what things cost or earn, but shows managers and the owner', async () => {
    const { d, silk } = await shop();
    const { staff, manager } = await people();
    await api.accessLogin(staff.id, '1357');
    const asStaff = await api.designGet(d.id);
    expect(asStaff.stockValuePaise).toBe(0);
    expect(asStaff.variants[0]).toMatchObject({ baseCostPaise: 0, unitCostPaise: 0, materialCostPaise: 0, sellPricePaise: rupees(9800) }); // the price they sell at stays
    expect(asStaff.variants[0]!.bom[0]).toMatchObject({ unitCostPaise: 0, lineCostPaise: 0, qty: 0.5 });
    expect((await api.materialsList()).every((m) => m.unitCostPaise === 0)).toBe(true);
    await api.accessLogout();
    await api.accessLogin(manager.id, '2468');
    const asManager = await api.designGet(d.id);
    expect(asManager.variants[0]!.unitCostPaise).toBe(rupees(1800 + 2000));
    expect((await api.materialsList())[0]).toMatchObject({ id: silk.id, unitCostPaise: rupees(4000) });
  });

  it('redacts cost and profit fields wherever they sit, and leaves everything else alone', () => {
    const data = { name: 'x', lines: [{ unitCostPaise: 5, sellPricePaise: 7, nested: { grossProfitPaise: 9, marginPercent: 12, qty: 3 } }], stockValuePaise: 100, realCostPerPiecePaise: 50, text: 'cost' };
    expect(redactCosts(data)).toEqual({ name: 'x', lines: [{ unitCostPaise: 0, sellPricePaise: 7, nested: { grossProfitPaise: 0, marginPercent: 0, qty: 3 } }], stockValuePaise: 0, realCostPerPiecePaise: 0, text: 'cost' });
  });
});

describe('every call has a decided place', () => {
  it('closes anything nobody has decided about to everyone but the owner', async () => {
    const methods = Object.keys(api).filter((m) => !ALWAYS_ALLOWED.includes(m));
    const ownerOnly = methods.filter((m) => !(m in METHOD_CAPABILITY) && capabilityOf(m) === 'admin').sort();
    // If this list changes, a call was added without saying who may use it: decide, and add it to shared/access.ts.
    expect(ownerOnly).toEqual(['accessDisable', 'accessEnable', 'accessUserSave', 'accessUsers', 'auditList', 'backupNow', 'backupRestore', 'dataInfo', 'integrityCheck', 'sampleDataLoad', 'saveSettings']);
    expect(Object.keys(METHOD_CAPABILITY).filter((m) => !(m in api))).toEqual([]); // and nothing is listed that no longer exists
    expect(canDo('staff', 'admin')).toBe(false);
    expect(canDo(null, 'view')).toBe(false);
  });
});

describe('looking after people', () => {
  it('adds, edits and deactivates people, and keeps an owner', async () => {
    const { owner, staff } = await people();
    await api.accessLogin(owner.id, '4321');
    await expect(api.accessUserSave(null, { name: 'rafiq', role: 'staff', pin: '5555' })).rejects.toThrow(/already someone called/);
    await expect(api.accessUserSave(null, { name: 'New', role: 'staff', pin: '12' })).rejects.toThrow(/4 to 8 digits/);
    const edited = await api.accessUserSave(staff.id, { name: 'Rafiq A.', role: 'manager', pin: '7777' });
    expect(edited).toMatchObject({ name: 'Rafiq A.', role: 'manager', active: true });
    await expect(api.accessUserSave(owner.id, { name: 'Ahmad', role: 'staff' })).rejects.toThrow(/always be an owner/);
    await expect(api.accessUserSave(owner.id, { name: 'Ahmad', role: 'owner', active: false })).rejects.toThrow(/always be an owner/);
    await api.accessUserSave(staff.id, { name: 'Rafiq A.', role: 'manager', active: false });
    await api.accessLogout();
    await expect(api.accessLogin(staff.id, '7777')).rejects.toThrow(/not on the list/);
    expect((await api.accessStatus()).people.map((p) => p.name)).toEqual(['Ahmad', 'Meera']);
    const log = (db.prepare("SELECT summary FROM audit_log WHERE action = 'Edited a person'").all() as { summary: string }[]).map((r) => r.summary);
    expect(log[0]).toContain('role Counter staff to Manager');
    expect(log[0]).toContain('PIN changed');
    expect(log[0]).not.toContain('7777'); // a PIN never reaches the log
  });

  it('lets anyone change their own PIN, given the old one', async () => {
    const { staff } = await people();
    await api.accessLogin(staff.id, '1357');
    await expect(api.accessChangePin('0000', '8888')).rejects.toThrow(/current PIN is not right/);
    await expect(api.accessChangePin('1357', '88')).rejects.toThrow(/4 to 8 digits/);
    await api.accessChangePin('1357', '8888');
    await api.accessLogout();
    await expect(api.accessLogin(staff.id, '1357')).rejects.toThrow(/not right/);
    expect((await api.accessLogin(staff.id, '8888')).user!.name).toBe('Rafiq');
  });
});

describe('turning it off, and restoring a backup', () => {
  it('needs the owner signed in, with their PIN, and then the app is open again', async () => {
    const { owner, manager } = await people();
    await expect(api.accessDisable('4321')).rejects.toThrow(LOCKED_MESSAGE); // nobody is signed in
    await api.accessLogin(manager.id, '2468');
    await expect(api.accessDisable('2468')).rejects.toThrow(/doesn't have permission/);
    await api.accessLogout();
    await api.accessLogin(owner.id, '4321');
    await expect(api.accessDisable('0000')).rejects.toThrow(/not right/);
    expect((await api.accessDisable('4321')).enabled).toBe(false);
    expect(await api.invoicesList()).toEqual([]); // nobody signed in, and nobody is asked
  });

  it('leaves the people and the switch as they are, however old the backup', async () => {
    await shop();
    await api.saveSettings({ city: 'Old city' });
    const { name } = await api.backupNow(); // taken before access control existed
    const { owner } = await people();
    await api.accessLogin(owner.id, '4321');
    await api.saveSettings({ city: 'New city' });
    await api.backupRestore(name);
    // Restoring put the shop's data back, but did not switch the lock off or forget anybody.
    expect((await api.getSettings()).city).toBe('Old city');
    expect((await api.accessStatus()).enabled).toBe(true);
    expect((await api.accessUsers()).length).toBe(3);
    await api.accessLogout();
    await expect(api.invoicesList()).rejects.toThrow(LOCKED_MESSAGE);
    await api.accessLogin(owner.id, '4321'); // and the owner's PIN still works
  });
});
