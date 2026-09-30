import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../electron/db/connection';
import { importCustomers } from '../electron/services/customerImport';
import * as customers from '../electron/services/customers';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import { dismissOnboarding, onboardingStatus } from '../electron/services/onboarding';
import { saveSettings } from '../electron/services/settings';
import { mapColumns, parseTable, phoneKey, toImportRows, type ImportRow } from '../shared/import';
import { todayIso } from '../shared/gst';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});

const row = (over: Partial<ImportRow>): ImportRow => ({ name: '', phone: '', email: '', gstin: '', address: '', city: '', state: '', pincode: '', type: '', notes: '', ...over });
const names = () => customers.listCustomers(db).map((c) => c.name);

describe('reading a table', () => {
  it('reads comma separated text with quotes, doubled quotes and line breaks inside cells', () => {
    const t = parseTable('Name,Address\r\n"Sharma, Ravi","12 ""Main"" Road\nMau"\r\nRani,Lane 4\r\n');
    expect(t).toEqual([['Name', 'Address'], ['Sharma, Ravi', '12 "Main" Road\nMau'], ['Rani', 'Lane 4']]);
  });

  it('reads cells pasted from a spreadsheet (tabs) and semicolon files', () => {
    expect(parseTable('Name\tPhone\nMeera\t98765 43210')).toEqual([['Name', 'Phone'], ['Meera', '98765 43210']]);
    expect(parseTable('Name;Phone\nMeera;9876543210')).toEqual([['Name', 'Phone'], ['Meera', '9876543210']]);
  });

  it('ignores a byte order mark and blank lines, and trims cells', () => {
    expect(parseTable('﻿Name, Phone \n\n  Meera , 123 \n,,\n')).toEqual([['Name', 'Phone'], ['Meera', '123']]);
  });

  it('knows a heading whatever the old sheet called it', () => {
    expect(mapColumns(['Party Name', 'Mobile No.', 'GST No', 'Town', 'PIN', 'Remarks', 'Whatever'])).toEqual({ name: 0, phone: 1, gstin: 2, city: 3, pincode: 4, notes: 5 });
    expect(mapColumns(['Customer', 'E-mail', 'State'])).toEqual({ name: 0, email: 1, state: 2 });
    expect(mapColumns(['a', 'b'])).toEqual({});
  });

  it('turns a table with headings into customers, and says which columns it did not use', () => {
    const p = toImportRows(parseTable('Customer,Mobile,Favourite colour,City\nMeera,9876543210,Red,Mau'));
    expect(p).toMatchObject({ usedHeader: true, ignored: ['Favourite colour'], found: ['name', 'phone', 'city'] });
    expect(p.rows[0]).toMatchObject({ name: 'Meera', phone: '9876543210', city: 'Mau' });
  });

  it('takes a plain list as name, phone, city, GSTIN when there are no headings', () => {
    const p = toImportRows(parseTable('Meera\t9876543210\tMau\nRani\t9123456780'));
    expect(p.usedHeader).toBe(false);
    expect(p.rows.map((r) => [r.name, r.phone, r.city])).toEqual([['Meera', '9876543210', 'Mau'], ['Rani', '9123456780', '']]);
  });

  it('compares phone numbers by their last ten digits', () => {
    expect(phoneKey('+91 98765-43210')).toBe('9876543210');
    expect(phoneKey('098765 43210')).toBe('9876543210');
    expect(phoneKey('12345')).toBe('');
  });
});

describe('importing customers', () => {
  it('adds them, putting spreadsheet quirks right', () => {
    const r = importCustomers(
      db,
      [
        row({ name: 'Meera Textiles', phone: '9876543210.0', city: 'Pune', state: 'mh', gstin: '27AAPFU0939F1ZV' }),
        row({ name: 'Rani', phone: '9.87654E+9', state: 'UP' }),
        row({ name: 'Sunita', type: 'Retail', gstin: '27AAPFU0939F1ZV ' }), // same GSTIN as above
      ],
      false,
    );
    expect(r.created).toBe(2);
    const list = customers.listCustomers(db);
    const meera = list.find((c) => c.name === 'Meera Textiles')!;
    expect(meera).toMatchObject({ type: 'B2B', state: 'Maharashtra', phone: '9876543210', gstin: '27AAPFU0939F1ZV' });
    expect(list.find((c) => c.name === 'Rani')).toMatchObject({ type: 'B2C', state: 'Uttar Pradesh', phone: '9876540000' });
    expect(r.results.map((x) => x.status)).toEqual(['new', 'new', 'duplicate']);
  });

  it('shows exactly what would happen in a dry run, and changes nothing', () => {
    const rows = [row({ name: 'Meera', phone: '9876543210' }), row({ name: 'Meera again', phone: '098765 43210' }), row({ name: '' }), row({ name: 'Rani', gstin: '27BROKEN' })];
    const dry = importCustomers(db, rows, true);
    expect(names()).toEqual([]);
    const real = importCustomers(db, rows, false);
    expect(names()).toEqual(['Meera']);
    expect(dry.results).toEqual(real.results);
    expect(dry).toMatchObject({ dryRun: true, created: 1 });
    expect(real).toMatchObject({ dryRun: false, created: 1 });
  });

  it('skips people already on file, by GSTIN, by phone, or by name and city', () => {
    customers.createCustomer(db, { name: 'Old Friend', type: 'B2B', phone: '9000000001', email: '', gstin: '27AAPFU0939F1ZV', address: '', city: 'Pune', state: 'Maharashtra', pincode: '', notes: '' });
    customers.createCustomer(db, { name: 'Sunita', type: 'B2C', phone: '9000000002', email: '', gstin: '', address: '', city: 'Mau', state: 'Uttar Pradesh', pincode: '', notes: '' });
    const r = importCustomers(
      db,
      [row({ name: 'Different name', gstin: '27AAPFU0939F1ZV' }), row({ name: 'Another', phone: '+91 90000 00002' }), row({ name: 'SUNITA', city: 'mau' }), row({ name: 'Sunita', city: 'Delhi' })],
      false,
    );
    expect(r.results.map((x) => [x.status, x.message])).toEqual([
      ['duplicate', 'This GSTIN is already on file.'],
      ['duplicate', 'This phone number is already on file.'],
      ['duplicate', 'SUNITA in mau is already on file.'],
      ['new', ''],
    ]);
  });

  it('skips repeats within the list itself', () => {
    const r = importCustomers(db, [row({ name: 'Meera', phone: '9876543210' }), row({ name: 'Meera B', phone: '9876543210' }), row({ name: 'Meera', phone: '' })], false);
    expect(r.results.map((x) => x.status)).toEqual(['new', 'duplicate', 'duplicate']);
    expect(names()).toEqual(['Meera']);
  });

  it('explains a row it cannot take, and still takes the good ones', () => {
    const r = importCustomers(
      db,
      [
        row({ name: 'Good' }),
        row({ name: '' , phone: '9111111111' }),
        row({ name: 'Bad GSTIN', gstin: '27BROKEN' }),
        row({ name: 'Wants B2B', type: 'B2B' }),
        row({ name: 'Bad pin', pincode: '12' }),
        row({ name: 'Nowhere', state: 'Atlantis' }),
      ],
      false,
    );
    expect(r.created).toBe(1);
    const byName = Object.fromEntries(r.results.map((x) => [x.name, x]));
    expect(byName['(no name)']!.message).toMatch(/Customer name/);
    expect(byName['Bad GSTIN']!.message).toMatch(/GSTIN/);
    expect(byName['Wants B2B']!.message).toMatch(/needs a GSTIN/);
    expect(byName['Bad pin']!.message).toMatch(/6 digits/);
    expect(byName['Nowhere']!.message).toMatch(/state/i);
    expect(names()).toEqual(['Good']);
  });

  it('takes the state from the GSTIN when none is given', () => {
    importCustomers(db, [row({ name: 'Meera', gstin: '27AAPFU0939F1ZV' })], false);
    expect(customers.listCustomers(db)[0]).toMatchObject({ state: 'Maharashtra', type: 'B2B' });
  });

  it('refuses an empty list and one that is too long', () => {
    expect(() => importCustomers(db, [], false)).toThrow(/nothing to import/);
    expect(() => importCustomers(db, Array.from({ length: 2001 }, (_, i) => row({ name: `C${i}` })), true)).toThrow(/up to 2000/);
  });
});

describe('the getting started checklist', () => {
  const done = () => Object.fromEntries(onboardingStatus(db).steps.map((s) => [s.id, s.done]));

  it('ticks itself as the shop is set up', () => {
    expect(done()).toEqual({ profile: false, sarees: false, customers: false, invoice: false, backup: false });
    saveSettings(db, { businessName: 'Mau Gharana', addressLine: '12 Lane', city: 'Mau', state: 'Uttar Pradesh', phone: '9876543210' });
    expect(done().profile).toBe(true);
    const d = inventory.createDesign(db, { code: 'MG-1', name: 'Butidar', fabric: '', hsnCode: '5007', description: '', defaultPricePaise: 100000 });
    const v = inventory.createVariant(db, d.id, { color: 'Red', size: '5.5 m', sellPricePaise: 100000, baseCostPaise: 40000, reorderLevel: 0, openingStock: 5, bom: [] });
    expect(done().sarees).toBe(true);
    importCustomers(db, [row({ name: 'Meera' })], false);
    expect(done().customers).toBe(true);
    saveSettings(db, { state: 'Uttar Pradesh', gstin: '' });
    invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: todayIso(), dueDate: todayIso(), discountPaise: 0, notes: '', lines: [{ variantId: v.id, qty: 1, unitPricePaise: 100000 }] });
    expect(done().invoice).toBe(true);
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('offsite_folder', '/x', 'now')").run();
    expect(done().backup).toBe(true);
  });

  it('can be dismissed, and stays dismissed', () => {
    expect(onboardingStatus(db).dismissed).toBe(false);
    expect(dismissOnboarding(db).dismissed).toBe(true);
    expect(onboardingStatus(db).dismissed).toBe(true);
  });

  it('needs every part of the profile', () => {
    saveSettings(db, { businessName: 'Mau Gharana', addressLine: '', city: 'Mau', state: 'Uttar Pradesh', phone: '9876543210' });
    expect(done().profile).toBe(false);
  });
});
