import { mkdirSync, mkdtempSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { backupNow, listBackups, restoreBackup } from '../electron/backup';
import { openDb, type Db } from '../electron/db/connection';
import { LATEST_SCHEMA_VERSION } from '../electron/db/migrations';
import * as customers from '../electron/services/customers';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as payments from '../electron/services/payments';
import { getSettings, saveSettings } from '../electron/services/settings';
import { todayIso } from '../shared/gst';
import { REWIND_TO_STAGE_2 } from './helpers/oldSchema';

const today = todayIso();
let dir: string;
let backups: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'invoiceon-restore-'));
  backups = join(dir, 'backups');
  db = openDb(join(dir, 'invoiceon.db'));
  saveSettings(db, { businessName: 'Mau Gharana', gstin: '09AAACH7409R1ZZ', state: 'Uttar Pradesh' });
});

const blank = { type: 'B2C' as const, phone: '', email: '', gstin: '', address: '', city: '', state: 'Uttar Pradesh', pincode: '', notes: '' };

function stockedInvoice() {
  const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: 'Silk', hsnCode: '5007', description: '', defaultPricePaise: 100000 });
  const v = inventory.createVariant(db, d.id, { color: 'Maroon', size: '6.3 m', sellPricePaise: 100000, baseCostPaise: 40000, reorderLevel: 2, openingStock: 10, bom: [] });
  const c = customers.createCustomer(db, { ...blank, name: 'Sunita' });
  const inv = invoices.createInvoice(db, { type: 'B2C', customerId: c.id, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: v.id, qty: 2, unitPricePaise: 100000 }] });
  return { d, v, c, inv };
}

describe('restoring a backup', () => {
  it('brings back the data as it was, and can itself be undone through the safety copy', () => {
    const { v, c, inv } = stockedInvoice();
    const { name } = backupNow(db, backups);

    // Carry on working after the backup: a second customer, a payment, a cancelled invoice, a changed setting.
    customers.createCustomer(db, { ...blank, name: 'Anjali' });
    payments.recordPayment(db, { customerId: c.id, amountPaise: 50000, method: 'cash', reference: '', receivedOn: today, note: '', allocations: [{ invoiceId: inv.id, amountPaise: 50000 }] });
    invoices.cancelInvoice(db, inv.id, 'changed mind');
    saveSettings(db, { businessName: 'Somebody Else' });
    expect(inventory.getVariant(db, v.id).stock).toBe(10);

    const result = restoreBackup(db, backups, name);
    expect(result.restoredFrom).toBe(name);
    expect(customers.listCustomers(db).map((x) => x.name)).toEqual(['Sunita']);
    expect(inventory.getVariant(db, v.id).stock).toBe(8); // the invoice is live again, so its 2 pieces are out
    expect(invoices.getInvoice(db, inv.id)).toMatchObject({ status: 'unpaid', paidPaise: 0 });
    expect(payments.listPayments(db)).toHaveLength(0);
    expect(getSettings(db).businessName).toBe('Mau Gharana');

    // The app keeps working on the same connection, with integrity rules still enforced.
    expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
    customers.createCustomer(db, { ...blank, name: 'New after restore' });

    // The state just before the restore was kept, and restoring it undoes the restore.
    expect(existsSync(join(backups, result.restorePoint))).toBe(true);
    restoreBackup(db, backups, result.restorePoint);
    expect(customers.listCustomers(db).map((x) => x.name).sort()).toEqual(['Anjali', 'Sunita']);
    expect(invoices.getInvoice(db, inv.id).status).toBe('cancelled');
    expect(getSettings(db).businessName).toBe('Somebody Else');
  });

  it('lists the safety copy and never lets the daily clean-up treat it as disposable', () => {
    stockedInvoice();
    const { name } = backupNow(db, backups);
    const { restorePoint } = restoreBackup(db, backups, name);
    const listed = listBackups(backups);
    expect(listed.find((b) => b.name === restorePoint)).toMatchObject({ kind: 'restore-point', manual: true });
    expect(listed.find((b) => b.name === name)).toMatchObject({ kind: 'manual', manual: true });
  });

  it('restores a backup taken by an older version, upgrading it on the way in', () => {
    // An old-shape file: a stage 2 database, before payments, proformas and everything after.
    const old = openDb(join(dir, 'old.db'));
    saveSettings(old, { gstin: '09AABCK1234M1ZI' });
    const d = inventory.createDesign(old, { code: 'MG-9', name: 'Old design', fabric: '', hsnCode: '5007', description: '', defaultPricePaise: 100000 });
    const v = inventory.createVariant(old, d.id, { color: 'Red', size: '6 m', sellPricePaise: 100000, baseCostPaise: 0, reorderLevel: 0, openingStock: 5, bom: [] });
    const legacy = invoices.createInvoice(old, { type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: v.id, qty: 2, unitPricePaise: 100000 }] });
    old.exec(REWIND_TO_STAGE_2);
    old.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    old.close();
    mkdirSync(backups, { recursive: true });
    copyFileSync(join(dir, 'old.db'), join(backups, 'invoiceon-manual-2024-01-01-101010.db'));

    restoreBackup(db, backups, 'invoiceon-manual-2024-01-01-101010.db');
    expect(invoices.getInvoice(db, legacy.id)).toMatchObject({ number: legacy.number, totalPaise: 210000, status: 'unpaid' });
    expect(inventory.getVariant(db, v.id).stock).toBe(3);
    // The tables that did not exist in the old file are there, empty and working.
    payments.recordPayment(db, { customerId: null, amountPaise: 210000, method: 'cash', reference: '', receivedOn: today, note: '', allocations: [{ invoiceId: legacy.id, amountPaise: 210000 }] });
    expect(invoices.getInvoice(db, legacy.id).status).toBe('paid');
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(LATEST_SCHEMA_VERSION);
  });

  it('refuses names that are not backups, missing files, damaged files and backups from a newer version, and changes nothing', () => {
    stockedInvoice();
    mkdirSync(backups, { recursive: true });
    expect(() => restoreBackup(db, backups, '../invoiceon.db')).toThrow(/not one of your backups/);
    expect(() => restoreBackup(db, backups, 'invoiceon-manual-2020-01-01-000000.db\\..\\x')).toThrow(/not one of your backups/);
    expect(() => restoreBackup(db, backups, 'invoiceon-manual-2020-01-01-000000.db')).toThrow(/no longer in the backups folder/);

    writeFileSync(join(backups, 'invoiceon-manual-2020-02-02-000000.db'), 'this is not a database file at all, just text');
    expect(() => restoreBackup(db, backups, 'invoiceon-manual-2020-02-02-000000.db')).toThrow(/can't be opened|damaged/);

    const future = openDb(join(dir, 'future.db'));
    future.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 5}`);
    future.close();
    copyFileSync(join(dir, 'future.db'), join(backups, 'invoiceon-manual-2020-03-03-000000.db'));
    expect(() => restoreBackup(db, backups, 'invoiceon-manual-2020-03-03-000000.db')).toThrow(/newer version/);

    expect(customers.listCustomers(db).map((c) => c.name)).toEqual(['Sunita']); // nothing was touched
    expect(listBackups(backups).some((b) => b.kind === 'restore-point')).toBe(false); // and no safety copy was needed
  });
});
