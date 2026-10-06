import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { backupDaily, listBackups } from '../electron/backup';
import { openDb, type Db } from '../electron/db/connection';
import { getSettings, saveSettings } from '../electron/services/settings';
import { todayIso } from '../shared/gst';
import { DEFAULT_EXPENSE_CATEGORIES } from '../shared/types';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});

describe('settings sections', () => {
  it('starts with sensible defaults for the newer sections', () => {
    expect(getSettings(db)).toMatchObject({
      country: 'India',
      ownerName: '',
      proformaPrefix: 'PF',
      proformaValidDays: 15,
      expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
      paymentAccounts: [],
      notifyLowStock: true,
      notifyOverdue: true,
    });
  });

  it('saves business profile, proforma and notification choices', () => {
    const saved = saveSettings(db, { ownerName: '  Ahmad Jamal ', proformaPrefix: 'quo', proformaValidDays: 30, proformaTerms: '50% advance', notifyLowStock: false });
    expect(saved).toMatchObject({ ownerName: 'Ahmad Jamal', proformaPrefix: 'QUO', proformaValidDays: 30, proformaTerms: '50% advance', notifyLowStock: false, notifyOverdue: true });
    expect(() => saveSettings(db, { proformaPrefix: 'bad pf!' })).toThrow(/letters, numbers/);
    expect(() => saveSettings(db, { proformaValidDays: 400 })).toThrow(/too large/);
    expect(() => saveSettings(db, { country: 'Narnia' })).toThrow(/India/);
  });

  it('keeps expense categories tidy: trimmed, no blanks, no duplicates ignoring case', () => {
    expect(saveSettings(db, { expenseCategories: [' Rent ', 'Repairs'] }).expenseCategories).toEqual(['Rent', 'Repairs']);
    expect(() => saveSettings(db, { expenseCategories: ['Rent', 'rent'] })).toThrow(/twice/);
    expect(() => saveSettings(db, { expenseCategories: ['Rent', '  '] })).toThrow(/required/);
    expect(getSettings(db).expenseCategories).toEqual(['Rent', 'Repairs']); // a rejected save changed nothing
    expect(saveSettings(db, { expenseCategories: [] }).expenseCategories).toEqual([]); // an empty list is allowed, and isn't mistaken for "unset"
  });

  it('validates payment accounts', () => {
    const acc = { id: 'a1', name: 'SBI current', kind: 'bank' as const, details: 'A/c 123 · IFSC SBIN0001234' };
    expect(saveSettings(db, { paymentAccounts: [acc, { id: 'a2', name: 'Cash drawer', kind: 'cash', details: '' }] }).paymentAccounts).toHaveLength(2);
    expect(() => saveSettings(db, { paymentAccounts: [{ ...acc, name: '' }] })).toThrow(/Account name is required/);
    expect(() => saveSettings(db, { paymentAccounts: [acc, { ...acc, id: 'a3', name: 'sbi CURRENT' }] })).toThrow(/already have/);
    expect(() => saveSettings(db, { paymentAccounts: [{ ...acc, kind: 'crypto' as never }] })).toThrow(/Choose a type/);
    expect(getSettings(db).paymentAccounts).toHaveLength(2);
  });

  it('survives a damaged stored list by falling back to the default', () => {
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('expense_categories', '{oops', '2026-01-01')").run();
    expect(getSettings(db).expenseCategories).toEqual(DEFAULT_EXPENSE_CATEGORIES);
  });
});

describe('data management', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'invoiceon-data-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reports the data folder and backups, and manual backups survive the daily clean-up', async () => {
    const file = openDb(join(dir, 'invoiceon.db'));
    const api = createApi(file, undefined, dir);
    expect((await api.dataInfo()).backups).toEqual([]);

    const { name } = await api.backupNow();
    expect(name).toMatch(/^invoiceon-manual-\d{4}-\d{2}-\d{2}-\d{6}\.db$/);
    backupDaily(file, join(dir, 'backups'));

    const info = await api.dataInfo();
    expect(info.folder).toBe(dir);
    expect(info.databaseBytes).toBeGreaterThan(0);
    expect(info.backups).toHaveLength(2);
    expect(info.backups.filter((b) => b.manual).map((b) => b.name)).toEqual([name]);
    expect(listBackups(join(dir, 'backups')).every((b) => b.bytes > 0)).toBe(true);
    file.close();
  });

  it('names the daily backup by the local date, not the UTC one', () => {
    const file = openDb(join(dir, 'invoiceon.db'));
    expect(backupDaily(file, join(dir, 'backups'))).toBe(`invoiceon-${todayIso()}.db`);
    file.close();
  });

  it('says so plainly when there is no data folder (in-memory API)', async () => {
    await expect(createApi(db).backupNow()).rejects.toThrow(/desktop app/);
  });
});
