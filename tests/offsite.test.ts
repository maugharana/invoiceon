import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { backupNow, restoreBackup } from '../electron/backup';
import { openDb, type Db } from '../electron/db/connection';
import { decryptBytes, deriveKey, encryptBytes, offsiteCopy, offsiteDaily, offsiteDisable, offsiteRestore, offsiteSave, offsiteStatus, saltOf } from '../electron/offsite';
import * as customers from '../electron/services/customers';
import { getSettings, saveSettings } from '../electron/services/settings';

let root: string;
let dataDir: string;
let folder: string;
let db: Db;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'invoiceon-offsite-'));
  dataDir = join(root, 'data');
  folder = join(root, 'cloud');
  mkdirSync(dataDir);
  mkdirSync(folder);
  db = openDb(join(dataDir, 'invoiceon.db'));
  saveSettings(db, { businessName: 'Mau Gharana Sarees' });
});

const blank = { type: 'B2C' as const, phone: '', email: '', gstin: '', address: '', city: '', state: 'Uttar Pradesh', pincode: '', notes: '' };
const names = () => customers.listCustomers(db).map((c) => c.name).sort();
const PASS = 'correct horse battery';

describe('encryption', () => {
  const salt = Buffer.alloc(16, 7);
  const key = deriveKey(PASS, salt);

  it('round trips, and the file shows nothing of what is inside', () => {
    const plain = Buffer.from('SQLite format 3\0 secret customer list');
    const sealed = encryptBytes(plain, key, salt);
    expect(sealed.includes(Buffer.from('secret'))).toBe(false);
    expect(saltOf(sealed)?.equals(salt)).toBe(true);
    expect(decryptBytes(sealed, (s) => deriveKey(PASS, s)).equals(plain)).toBe(true);
  });

  it('does not repeat itself: the same data encrypts differently each time', () => {
    const plain = Buffer.from('same same same same');
    expect(encryptBytes(plain, key, salt).equals(encryptBytes(plain, key, salt))).toBe(false);
  });

  it('refuses a wrong passphrase, and any tampering with the data or the header', () => {
    const sealed = encryptBytes(Buffer.from('hello world, this is data'), key, salt);
    expect(() => decryptBytes(sealed, (s) => deriveKey('not the passphrase', s))).toThrow(/does not open this copy/);
    const flipped = Buffer.from(sealed);
    flipped[flipped.length - 1]! ^= 1;
    expect(() => decryptBytes(flipped, (s) => deriveKey(PASS, s))).toThrow(/does not open this copy/);
    const header = Buffer.from(sealed);
    header[20]! ^= 1; // inside the salt: authenticated too
    expect(() => decryptBytes(header, () => key)).toThrow(/does not open this copy/);
  });

  it('says so when a file is not an encrypted copy', () => {
    expect(() => decryptBytes(Buffer.from('plain text file with enough length to pass the size check........'), () => key)).toThrow(/not an encrypted InvoiceOn copy/);
  });
});

describe('setting it up', () => {
  it('starts switched off', () => {
    expect(offsiteStatus(db)).toMatchObject({ folder: null, encrypted: false, reachable: false, lastAt: null, files: [] });
  });

  it('checks the folder and the passphrase', () => {
    expect(() => offsiteSave(db, { folder: '', encrypt: false })).toThrow(/Choose the folder/);
    expect(() => offsiteSave(db, { folder: 'relative/path', encrypt: false })).toThrow(/full path/);
    expect(() => offsiteSave(db, { folder: join(root, 'missing'), encrypt: false })).toThrow(/does not exist/);
    expect(() => offsiteSave(db, { folder: folder, encrypt: true })).toThrow(/Choose a passphrase/);
    expect(() => offsiteSave(db, { folder: folder, encrypt: true, passphrase: 'short' })).toThrow(/at least 8/);
    expect(offsiteStatus(db).folder).toBeNull(); // nothing was half saved
  });

  it('can change folder without typing the passphrase again, and turning encryption off forgets the key', () => {
    offsiteSave(db, { folder, encrypt: true, passphrase: PASS });
    const other = join(root, 'usb');
    mkdirSync(other);
    expect(offsiteSave(db, { folder: other, encrypt: true })).toMatchObject({ folder: other, encrypted: true });
    offsiteSave(db, { folder: other, encrypt: false });
    expect(() => offsiteSave(db, { folder: other, encrypt: true })).toThrow(/Choose a passphrase/);
  });

  it('never keeps the passphrase itself', () => {
    offsiteSave(db, { folder, encrypt: true, passphrase: PASS });
    const all = JSON.stringify(db.prepare('SELECT key, value FROM settings').all());
    expect(all).not.toContain(PASS);
  });
});

describe('copying', () => {
  it('writes a whole, openable copy of the database', () => {
    customers.createCustomer(db, { ...blank, name: 'Sunita' });
    offsiteSave(db, { folder, encrypt: false });
    const status = offsiteCopy(db, dataDir);
    expect(status.lastError).toBeNull();
    expect(status.files).toHaveLength(1);
    expect(status.files[0]).toMatchObject({ encrypted: false });
    expect(status.lastFile).toBe(status.files[0]!.name);
    const copy = openDb(join(folder, status.files[0]!.name));
    expect((copy.prepare('SELECT COUNT(*) AS n FROM customers WHERE name = ?').get('Sunita') as { n: number }).n).toBe(1);
    copy.close();
    // No scratch file is left behind, in either folder.
    expect(readdirSync(dataDir).filter((f) => f.startsWith('.offsite'))).toEqual([]);
    expect(readdirSync(folder).filter((f) => f.endsWith('.partial'))).toEqual([]);
  });

  it('makes a second copy in the same second without overwriting the first', () => {
    offsiteSave(db, { folder, encrypt: false });
    offsiteCopy(db, dataDir);
    expect(offsiteCopy(db, dataDir).files).toHaveLength(2);
  });

  it('encrypts when asked: the file shows nothing of the business', () => {
    offsiteSave(db, { folder, encrypt: true, passphrase: PASS });
    const status = offsiteCopy(db, dataDir);
    const file = status.files[0]!;
    expect(file).toMatchObject({ encrypted: true });
    expect(file.name.endsWith('.db.enc')).toBe(true);
    const bytes = readFileSync(join(folder, file.name));
    expect(bytes.includes(Buffer.from('Mau Gharana Sarees'))).toBe(false);
    expect(bytes.includes(Buffer.from('SQLite format 3'))).toBe(false);
  });

  it('keeps the newest 30 and never touches files that are not its own', () => {
    offsiteSave(db, { folder, encrypt: false });
    writeFileSync(join(folder, 'holiday photos.zip'), 'keep me');
    writeFileSync(join(folder, 'invoiceon-offsite-notes.txt'), 'keep me too');
    for (let i = 1; i <= 33; i++) writeFileSync(join(folder, `invoiceon-offsite-2020-01-${String(i).padStart(2, '0')}-000000.db`), 'old');
    // Fake dates only go to 31, so 31 real looking copies exist plus two with day 32 and 33 (still matching the pattern).
    const status = offsiteCopy(db, dataDir);
    expect(status.files).toHaveLength(30);
    expect(existsSync(join(folder, 'holiday photos.zip'))).toBe(true);
    expect(existsSync(join(folder, 'invoiceon-offsite-notes.txt'))).toBe(true);
    // The copy just made is the newest, so it survived.
    expect(status.files.some((f) => f.name === status.lastFile)).toBe(true);
  });

  it('remembers a failure instead of throwing in the automatic copy, and clears it once it works', () => {
    offsiteSave(db, { folder, encrypt: false });
    rmSync(folder, { recursive: true });
    expect(() => offsiteCopy(db, dataDir)).toThrow(/cannot be reached/);
    const failed = offsiteStatus(db);
    expect(failed.reachable).toBe(false);
    expect(failed.lastError).toMatch(/cannot be reached/);
    expect(() => offsiteDaily(db, dataDir)).not.toThrow();
    mkdirSync(folder);
    const fixed = offsiteCopy(db, dataDir);
    expect(fixed.lastError).toBeNull();
    expect(fixed.files).toHaveLength(1);
  });

  it('does one copy a day at startup', () => {
    expect(() => offsiteDaily(db, dataDir)).not.toThrow(); // not set up: nothing happens
    offsiteSave(db, { folder, encrypt: false });
    offsiteDaily(db, dataDir);
    offsiteDaily(db, dataDir);
    expect(offsiteStatus(db).files).toHaveLength(1);
  });

  it('stops when turned off, and leaves the copies where they are', () => {
    offsiteSave(db, { folder, encrypt: false });
    offsiteCopy(db, dataDir);
    offsiteDisable(db);
    expect(offsiteStatus(db)).toMatchObject({ folder: null, files: [] });
    expect(readdirSync(folder)).toHaveLength(1);
    expect(() => offsiteCopy(db, dataDir)).toThrow(/not set up/);
  });
});

describe('restoring from an off-site copy', () => {
  it('brings the data back as it was, with a safety copy first', () => {
    customers.createCustomer(db, { ...blank, name: 'Sunita' });
    offsiteSave(db, { folder, encrypt: false });
    const { lastFile } = offsiteCopy(db, dataDir);
    customers.createCustomer(db, { ...blank, name: 'Added later' });
    expect(names()).toEqual(['Added later', 'Sunita']);
    const r = offsiteRestore(db, dataDir, lastFile!);
    expect(names()).toEqual(['Sunita']);
    expect(existsSync(join(dataDir, 'backups', r.restorePoint))).toBe(true);
    // The restore point itself brings the later work back.
    restoreBackup(db, join(dataDir, 'backups'), r.restorePoint);
    expect(names()).toEqual(['Added later', 'Sunita']);
  });

  it('opens an encrypted copy with the stored key, or with the passphrase on a new computer', () => {
    customers.createCustomer(db, { ...blank, name: 'Sunita' });
    offsiteSave(db, { folder, encrypt: true, passphrase: PASS });
    const { lastFile } = offsiteCopy(db, dataDir);

    // Same computer: no passphrase needed.
    customers.createCustomer(db, { ...blank, name: 'Added later' });
    offsiteRestore(db, dataDir, lastFile!);
    expect(names()).toEqual(['Sunita']);

    // A new computer: a blank database that has only been pointed at the same folder.
    const freshDir = join(root, 'fresh');
    mkdirSync(freshDir);
    const fresh = openDb(join(freshDir, 'invoiceon.db'));
    offsiteSave(fresh, { folder, encrypt: false });
    expect(() => offsiteRestore(fresh, freshDir, lastFile!)).toThrow(/Enter the passphrase/);
    expect(() => offsiteRestore(fresh, freshDir, lastFile!, 'a different passphrase')).toThrow(/does not open this copy/);
    offsiteRestore(fresh, freshDir, lastFile!, PASS);
    expect(customers.listCustomers(fresh).map((c) => c.name)).toEqual(['Sunita']);
    expect(getSettings(fresh).businessName).toBe('Mau Gharana Sarees');
    fresh.close();
  });

  it('refuses names that are not its own, and files that are not databases', () => {
    offsiteSave(db, { folder, encrypt: false });
    expect(() => offsiteRestore(db, dataDir, '../../etc/passwd')).toThrow(/not one of your off-site copies/);
    expect(() => offsiteRestore(db, dataDir, 'invoiceon-offsite-2020-01-01-000000.db')).toThrow(/no longer in the off-site folder/);
    writeFileSync(join(folder, 'invoiceon-offsite-2020-01-01-000000.db'), 'this is not a database');
    expect(() => offsiteRestore(db, dataDir, 'invoiceon-offsite-2020-01-01-000000.db')).toThrow(/not an InvoiceOn database/);
    expect(names()).toEqual([]); // nothing changed
  });

  it('keeps the off-site setup when any backup is restored, even one from before it existed', () => {
    const before = backupNow(db, join(dataDir, 'backups')).name; // made before off-site copies were set up
    offsiteSave(db, { folder, encrypt: true, passphrase: PASS });
    offsiteCopy(db, dataDir);
    const was = offsiteStatus(db);
    restoreBackup(db, join(dataDir, 'backups'), before);
    const now = offsiteStatus(db);
    expect(now).toMatchObject({ folder, encrypted: true, lastFile: was.lastFile });
    expect(offsiteCopy(db, dataDir).files).toHaveLength(2); // and it still encrypts with the same key
  });
});
