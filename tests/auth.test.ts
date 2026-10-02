import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import { createUser, signIn } from '../electron/services/users';
import { NON_OWNER_METHODS, BEFORE_SIGN_IN, roleCan } from '../shared/roles';
import type { Api } from '../shared/api';

// Every call the API has that no non-owner role is given. Adding a call to the API makes the "nothing slips through" test below fail
// until someone decides who may use it: put it in a role in shared/roles.ts, or here to keep it for the owner.
const OWNER_ONLY = [
  'authDisable', 'authSetup', 'backupNow', 'backupPickFolder', 'backupRestore', 'backupRestoreCancel', 'backupSaveCopy', 'backupSettingsSave', 'customerArchive', 'customerMerge', 'customerRestore', 'customersImport',
  'dataExportAll', 'dataInfo', 'designArchive', 'designCreate', 'designDuplicate', 'designRestore', 'designUpdate', 'designsBulk', 'driveBackups', 'driveConnectStart', 'driveConnectWait', 'driveDeleteBackup',
  'driveDisconnect', 'driveSaveCredentials', 'exportSaveZip', 'inventoryBulkAdd', 'invoiceCancel', 'locationArchive', 'locationCreate', 'locationRename', 'loyaltyAdjust', 'materialAdjust', 'materialCreate',
  'materialDelete', 'materialUpdate', 'photoDelete', 'photoSetCover', 'productionCancel', 'productionCloseShort', 'productionCreate', 'productionIssueMaterials', 'productionReceive', 'productionUpdate',
  'proformaCancel', 'quoteTemplateDelete',
  'catalogueEntries', 'catalogueRename', 'catalogueDelete', 'designsTidy', 'weaverOrderCreate', 'weaverOrderUpdate', 'weaverOrderReceive', 'weaverOrderPay', 'weaverPaymentVoid', 'weaverOrderCancel', 'sampleDataLoad', 'saveSettings', 'stockAdjust', 'stockTakeApply', 'stockTransfer', 'userCreate', 'userList', 'userResetPin', 'userUpdate', 'variantArchive',
  'variantCreate', 'variantRestore', 'variantUpdate',
];

let db: Db;
let api: Api;
beforeEach(() => {
  db = openDb(':memory:');
  api = createApi(db);
});

const turnOn = async () => (await api.authSetup({ name: 'Ahmad', pin: '1234' }));
const customer = { name: 'Meena', type: 'B2C' as const, phone: '', email: '', gstin: '', address: '', city: '', state: '', pincode: '', notes: '' };
const expense = { date: '2026-10-01', category: 'Rent', vendor: '', amountPaise: 100, method: 'cash' as const, reference: '', note: '' };
const range = { from: '2026-10-01', to: '2026-10-31' };

async function staff(role: 'cashier' | 'accountant', name: string = role, pin = '4321') {
  await api.userCreate({ name, role, pin });
  await api.authSignOut();
  const choice = (await api.authUsers()).find((u) => u.name === name)!;
  await api.authSignIn({ userId: choice.id, pin });
}

describe('a shop that has not turned on sign-in', () => {
  it('works exactly as before: nobody is asked for anything', async () => {
    expect(await api.authStatus()).toEqual({ required: false, user: null });
    expect(await api.authUsers()).toEqual([]);
    await api.saveSettings({ businessName: 'Mau Gharana' });
    await expect(api.customerCreate(customer)).resolves.toMatchObject({ name: 'Meena' });
    expect((await api.auditList())[0]!.userName).toBe('');
  });
});

describe('turning sign-in on', () => {
  it('makes the owner, signs them in, and gives a recovery code once', async () => {
    const made = await turnOn();
    expect(made.user).toMatchObject({ name: 'Ahmad', role: 'owner' });
    expect(made.recoveryCode).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(await api.authStatus()).toEqual({ required: true, user: made.user });
    await expect(api.authSetup({ name: 'Other', pin: '1111' })).rejects.toThrow(/already on/);
  });

  it('wants a sensible PIN and a name', async () => {
    await expect(api.authSetup({ name: 'A', pin: '12' })).rejects.toThrow(/4 to 8 digits/);
    await expect(api.authSetup({ name: 'A', pin: 'abcd' })).rejects.toThrow(/4 to 8 digits/);
    await expect(api.authSetup({ name: ' ', pin: '1234' })).rejects.toThrow(/name/i);
    expect((await api.authStatus()).required).toBe(false);
  });

  it('keeps the PIN out of the book: only a salted hash is stored', async () => {
    await turnOn();
    const row = db.prepare('SELECT pin_salt, pin_hash FROM users').get() as { pin_salt: string; pin_hash: string };
    expect(JSON.stringify(row)).not.toContain('1234');
    expect(row.pin_hash).toHaveLength(64);
    expect(JSON.stringify(db.prepare('SELECT value FROM settings').all())).not.toMatch(/[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}/);
  });
});

describe('signing in and out', () => {
  it('closes everything but the sign-in screen once signed out', async () => {
    await turnOn();
    await api.authSignOut();
    expect(await api.authStatus()).toEqual({ required: true, user: null });
    expect((await api.authUsers()).map((u) => u.name)).toEqual(['Ahmad']);
    await expect(api.customersList()).rejects.toThrow(/Sign in to continue/);
    await expect(api.getSettings()).rejects.toThrow(/Sign in/);
    const id = (await api.authUsers())[0]!.id;
    await expect(api.authSignIn({ userId: id, pin: '9999' })).rejects.toThrow(/PIN is not right/);
    await api.authSignIn({ userId: id, pin: '1234' });
    await expect(api.customersList()).resolves.toEqual([]);
  });

  it('pauses sign-in after too many wrong PINs, and lets the right one in afterwards', () => {
    const owner = createUser(db, { name: 'Pat', role: 'cashier', pin: '2468' });
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) expect(() => signIn(db, owner.id, '0000', t0)).toThrow(/not right/);
    expect(() => signIn(db, owner.id, '0000', t0)).toThrow(/Try again in 30 seconds/);
    expect(() => signIn(db, owner.id, '2468', t0 + 5_000)).toThrow(/Try again in 25 seconds/); // even the right PIN waits
    expect(signIn(db, owner.id, '2468', t0 + 31_000).name).toBe('Pat');
  });

  it('writes who did what in the activity log, and the signing in and out', async () => {
    await turnOn();
    await api.customerCreate(customer);
    await api.authSignOut();
    const log = (await api.authUsers()).length; // reading names needs no sign-in
    expect(log).toBe(1);
    const id = (await api.authUsers())[0]!.id;
    await api.authSignIn({ userId: id, pin: '1234' });
    const entries = await api.auditList();
    expect(entries.map((e) => [e.label, e.userName])).toEqual([
      ['Signed in', 'Ahmad'],
      ['Signed out', 'Ahmad'],
      ['Added a customer', 'Ahmad'],
      ['Turned on sign-in', 'Ahmad'],
    ]);
    expect(JSON.stringify(entries)).not.toContain('1234');
  });
});

describe('what each role may do', () => {
  it('the owner may do everything, and manage the others', async () => {
    await turnOn();
    await api.saveSettings({ businessName: 'Mau Gharana' });
    await api.expenseCreate(expense);
    expect((await api.userList()).map((u) => u.name)).toEqual(['Ahmad']);
  });

  it('counter staff sell, but cannot touch settings, money reports, expenses, backups or users', async () => {
    await turnOn();
    await staff('cashier');
    await expect(api.customerCreate(customer)).resolves.toBeTruthy();
    await expect(api.customersList()).resolves.toBeTruthy();
    for (const attempt of [
      () => api.saveSettings({ businessName: 'x' }),
      () => api.expenseCreate(expense),
      () => api.reportProfitLoss(range as never),
      () => api.backupNow(),
      () => api.userList(),
      () => api.userCreate({ name: 'Z', role: 'owner', pin: '1234' }),
      () => api.auditList(),
      () => api.dataInfo(),
      () => api.invoiceCancel('x', ''),
      () => api.stockAdjust({ variantId: 'x', delta: 1, reason: 'purchase' }),
    ]) {
      await expect(attempt()).rejects.toThrow(/doesn't allow this|Only the owner/);
    }
  });

  it('an accountant handles the money, but cannot sell, change stock or settings', async () => {
    await turnOn();
    await staff('accountant');
    await expect(api.expenseCreate(expense)).resolves.toBeTruthy();
    await expect(api.reportSales(range as never)).resolves.toBeTruthy();
    for (const attempt of [
      () => api.invoiceCreate({ type: 'B2C', customerId: null, issueDate: '2026-10-01', dueDate: null, discountPaise: 0, notes: '', lines: [] }),
      () => api.designCreate({ code: 'X', name: 'X', fabric: '', hsnCode: '', description: '', defaultPricePaise: 1 }),
      () => api.saveSettings({ businessName: 'x' }),
      () => api.backupNow(),
    ]) {
      await expect(attempt()).rejects.toThrow(/doesn't allow this/);
    }
  });

  it('a change of role or a removal takes effect on the very next action', async () => {
    await turnOn();
    await staff('cashier', 'Pat');
    await expect(api.customersList()).resolves.toBeTruthy();
    // the owner, in another window, changes Pat's role and then removes them
    const raw = createApi(db);
    void raw;
    const id = (db.prepare("SELECT id FROM users WHERE name = 'Pat'").get() as { id: string }).id;
    db.prepare("UPDATE users SET role = 'accountant' WHERE id = ?").run(id);
    await expect(api.invoiceCreate({} as never)).rejects.toThrow(/doesn't allow this/);
    await expect(api.expensesList()).resolves.toBeTruthy();
    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id);
    await expect(api.customersList()).rejects.toThrow(/Sign in to continue/);
  });

  it('every call in the API is deliberately classified, so nothing new is open to staff by accident', () => {
    const names = Object.keys(api);
    const unclassified = names.filter((n) => !NON_OWNER_METHODS.has(n) && !OWNER_ONLY.includes(n) && !(BEFORE_SIGN_IN as readonly string[]).includes(n));
    expect(unclassified).toEqual([]);
    // and nothing is listed for a role that does not exist in the API any more
    const known = new Set(names);
    expect([...NON_OWNER_METHODS].filter((n) => !known.has(n))).toEqual([]);
    expect(OWNER_ONLY.filter((n) => !known.has(n))).toEqual([]);
    expect(roleCan('owner', 'anything')).toBe(true);
    expect(roleCan('cashier', 'saveSettings')).toBe(false);
  });
});

describe('looking after the people', () => {
  it('adds, renames, changes the role of, and removes people, but never the last owner', async () => {
    const { user } = await turnOn();
    const pat = await api.userCreate({ name: 'Pat', role: 'cashier', pin: '2222' });
    await expect(api.userCreate({ name: 'pat', role: 'cashier', pin: '3333' })).rejects.toThrow(/already someone called/);
    expect(await api.userUpdate(pat.id, { name: 'Patricia', role: 'accountant' })).toMatchObject({ name: 'Patricia', role: 'accountant' });
    await expect(api.userUpdate(user.id, { active: false })).rejects.toThrow(/at least one active owner/);
    await expect(api.userUpdate(user.id, { role: 'cashier' })).rejects.toThrow(/at least one active owner/);
    const second = await api.userCreate({ name: 'Second', role: 'owner', pin: '5555' });
    await expect(api.userUpdate(user.id, { active: false })).resolves.toMatchObject({ active: false });
    expect(second.role).toBe('owner');
  });

  it('lets people change their own PIN, and the owner reset anyone\'s', async () => {
    await turnOn();
    await expect(api.authChangePin({ oldPin: '0000', newPin: '5678' })).rejects.toThrow(/current PIN is not right/);
    await api.authChangePin({ oldPin: '1234', newPin: '5678' });
    const pat = await api.userCreate({ name: 'Pat', role: 'cashier', pin: '2222' });
    await api.userResetPin(pat.id, '9999');
    await api.authSignOut();
    const [ahmad] = await api.authUsers();
    await expect(api.authSignIn({ userId: ahmad!.id, pin: '1234' })).rejects.toThrow();
    await api.authSignIn({ userId: ahmad!.id, pin: '5678' });
  });

  it('a forgotten owner PIN is reset with the recovery code, which then changes', async () => {
    const { recoveryCode } = await turnOn();
    await api.authSignOut();
    await expect(api.authRecover({ code: 'AAAA-BBBB-CCCC', newPin: '7777' })).rejects.toThrow(/recovery code is not right/);
    await expect(api.authRecover({ code: recoveryCode, newPin: '12' })).rejects.toThrow(/4 to 8 digits/);
    const again = await api.authRecover({ code: recoveryCode.toLowerCase(), newPin: '7777' });
    expect(again.user.role).toBe('owner');
    expect(again.recoveryCode).not.toBe(recoveryCode);
    await api.authSignOut();
    await expect(api.authRecover({ code: recoveryCode, newPin: '8888' })).rejects.toThrow(/not right/); // the old code is spent
    const [owner] = await api.authUsers();
    await api.authSignIn({ userId: owner!.id, pin: '7777' });
  });

  it('turns off again with the owner PIN, and the app is open as before', async () => {
    await turnOn();
    await expect(api.authDisable({ pin: '0000' })).rejects.toThrow(/owner PIN/);
    await api.authDisable({ pin: '1234' });
    expect(await api.authStatus()).toEqual({ required: false, user: null });
    await expect(api.saveSettings({ businessName: 'Open again' })).resolves.toMatchObject({ businessName: 'Open again' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });
  });
});
