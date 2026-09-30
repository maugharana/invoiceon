import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { activeBusiness, addBusiness, businessDir, listBusinesses, renameBusiness, setActiveBusiness, unlistBusiness } from '../electron/businesses';
import { openDb } from '../electron/db/connection';
import { getSettings, saveSettings } from '../electron/services/settings';
import * as customers from '../electron/services/customers';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'invoiceon-biz-'));
});

const blank = { type: 'B2C' as const, phone: '', email: '', gstin: '', address: '', city: '', state: 'Uttar Pradesh', pincode: '', notes: '' };

describe('the list', () => {
  it('starts with the original business, living in the data folder itself', () => {
    const list = listBusinesses(dir);
    expect(list.businesses).toHaveLength(1);
    expect(list.businesses[0]).toMatchObject({ id: 'main', active: true, dir });
    expect(list.activeId).toBe('main');
    expect(activeBusiness(dir).dir).toBe(dir);
  });

  it('follows the name the open business gives itself', () => {
    expect(listBusinesses(dir, 'Mau Gharana').businesses[0]!.name).toBe('Mau Gharana');
    expect(listBusinesses(dir).businesses[0]!.name).toBe('Mau Gharana'); // remembered
    expect(listBusinesses(dir, '   Mau   Gharana Sarees ').businesses[0]!.name).toBe('Mau Gharana Sarees');
  });

  it('keeps its own name rather than show two the same', () => {
    listBusinesses(dir, 'Mau Gharana');
    const other = addBusiness(dir, 'Second shop');
    setActiveBusiness(dir, other.id);
    expect(listBusinesses(dir, 'MAU GHARANA').businesses.find((b) => b.id === other.id)!.name).toBe('Second shop');
  });
});

describe('adding a business', () => {
  it('gives it its own folder and database, named from the start', () => {
    const b = addBusiness(dir, 'Bunkar Sarees');
    expect(b).toMatchObject({ name: 'Bunkar Sarees', active: false });
    expect(b.dir.startsWith(join(dir, 'businesses'))).toBe(true);
    expect(existsSync(join(b.dir, 'invoiceon.db'))).toBe(true);
    const db = openDb(join(b.dir, 'invoiceon.db'));
    expect(getSettings(db).businessName).toBe('Bunkar Sarees');
    db.close();
    expect(listBusinesses(dir).businesses.map((x) => x.name)).toEqual(['My business', 'Bunkar Sarees']);
  });

  it('keeps each business completely apart', () => {
    const main = openDb(join(dir, 'invoiceon.db'));
    customers.createCustomer(main, { ...blank, name: 'Only in main' });
    const b = addBusiness(dir, 'Second');
    const second = openDb(join(b.dir, 'invoiceon.db'));
    customers.createCustomer(second, { ...blank, name: 'Only in second' });
    expect(customers.listCustomers(main).map((c) => c.name)).toEqual(['Only in main']);
    expect(customers.listCustomers(second).map((c) => c.name)).toEqual(['Only in second']);
    const before = getSettings(main).invoicePrefix;
    saveSettings(second, { invoicePrefix: 'SEC' });
    expect(getSettings(main).invoicePrefix).toBe(before);
    expect(getSettings(second).invoicePrefix).toBe('SEC');
    main.close();
    second.close();
  });

  it('checks the name, and the number of businesses', () => {
    addBusiness(dir, 'First');
    expect(() => addBusiness(dir, '')).toThrow(/Enter a name/);
    expect(() => addBusiness(dir, 'x'.repeat(61))).toThrow(/60 characters/);
    expect(() => addBusiness(dir, ' first ')).toThrow(/already have a business called/);
    for (let i = 0; i < 10; i++) addBusiness(dir, `Shop ${i}`);
    expect(() => addBusiness(dir, 'One too many')).toThrow(/Twelve businesses/);
  });
});

describe('switching, renaming and unlisting', () => {
  it('makes another business the open one, and remembers it', () => {
    const b = addBusiness(dir, 'Second');
    const list = setActiveBusiness(dir, b.id);
    expect(list.activeId).toBe(b.id);
    expect(activeBusiness(dir)).toMatchObject({ id: b.id, dir: b.dir });
    expect(listBusinesses(dir).businesses.find((x) => x.id === 'main')!.active).toBe(false);
    expect(() => setActiveBusiness(dir, 'nope')).toThrow(/not on the list/);
  });

  it('renames in the list, keeping names distinct', () => {
    const b = addBusiness(dir, 'Second');
    expect(renameBusiness(dir, b.id, 'Second Shop').businesses.find((x) => x.id === b.id)!.name).toBe('Second Shop');
    expect(() => renameBusiness(dir, b.id, 'my business')).toThrow(/already have a business called/);
    expect(renameBusiness(dir, b.id, 'second shop').businesses.find((x) => x.id === b.id)!.name).toBe('second shop'); // its own name in another case
    expect(() => renameBusiness(dir, 'nope', 'X')).toThrow(/not on the list/);
  });

  it('takes one off the list without deleting a single file', () => {
    const b = addBusiness(dir, 'Second');
    expect(() => unlistBusiness(dir, 'main')).toThrow(/original business/);
    setActiveBusiness(dir, b.id);
    expect(() => unlistBusiness(dir, b.id)).toThrow(/Switch to another business first/);
    setActiveBusiness(dir, 'main');
    expect(unlistBusiness(dir, b.id).businesses.map((x) => x.id)).toEqual(['main']);
    expect(existsSync(join(b.dir, 'invoiceon.db'))).toBe(true);
    expect(() => unlistBusiness(dir, b.id)).toThrow(/not on the list/);
  });
});

describe('a damaged or hostile list file', () => {
  it('is set aside, and the app carries on with the original business', () => {
    writeFileSync(join(dir, 'businesses.json'), '{ this is not json');
    expect(listBusinesses(dir).businesses.map((b) => b.id)).toEqual(['main']);
    expect(readdirSync(dir).some((f) => f.startsWith('businesses.damaged-'))).toBe(true);
  });

  it('refuses a folder that points outside the data folder', () => {
    writeFileSync(join(dir, 'businesses.json'), JSON.stringify({ active: 'x', businesses: [{ id: 'main', name: 'A', folder: null }, { id: 'x', name: 'Evil', folder: '../../etc' }] }));
    // The bad entry fails validation, so the whole file is set aside rather than trusted in part.
    expect(listBusinesses(dir).businesses.map((b) => b.id)).toEqual(['main']);
    expect(() => businessDir(dir, { folder: '../../etc' })).toThrow(/outside the data folder/);
    expect(() => businessDir(dir, { folder: 'businesses/../../x' })).toThrow(/outside the data folder/);
  });

  it('only ever writes a whole file', () => {
    addBusiness(dir, 'Second');
    const raw = JSON.parse(readFileSync(join(dir, 'businesses.json'), 'utf8'));
    expect(raw.businesses).toHaveLength(2);
    expect(existsSync(join(dir, 'businesses.json.tmp'))).toBe(false);
  });
});
