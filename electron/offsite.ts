import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { MIN_PASSPHRASE, type OffsiteFile, type OffsiteSetup, type OffsiteStatus } from '../shared/offsite';
import { importBackup, restoreBackup, stamp } from './backup';
import { all, run, type Db } from './db/connection';
import { UserError } from './services/common';

// Off-site copies: the database, copied into a folder the owner chooses (a cloud-synced folder, a USB drive, a network share). The
// optional encryption means that whoever can read that folder, the cloud account included, still cannot read the books.

const MAGIC = Buffer.from('INVOICEON-ENC1\n');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + SALT_BYTES;
const SQLITE_HEADER = 'SQLite format 3\0';
const KEEP = 30;

const PLAIN = /^invoiceon-offsite-\d{4}-\d{2}-\d{2}-\d{6}(-\d+)?\.db$/;
const ENCRYPTED = /^invoiceon-offsite-\d{4}-\d{2}-\d{2}-\d{6}(-\d+)?\.db\.enc$/;
const isOurs = (name: string) => PLAIN.test(name) || ENCRYPTED.test(name);

// ── Encryption ──────────────────────────────────────────────────────────────
/** A key from the passphrase. Deliberately slow to work out, so a guessed passphrase costs real time. */
export const deriveKey = (passphrase: string, salt: Buffer): Buffer => scryptSync(passphrase.normalize('NFKC'), salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 });

/** `INVOICEON-ENC1`, the salt, then AES-256-GCM: a nonce, the authentication tag and the data. The header is authenticated too. */
export function encryptBytes(plain: Buffer, key: Buffer, salt: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const header = Buffer.concat([MAGIC, salt]);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([header, iv, cipher.getAuthTag(), data]);
}

export const saltOf = (file: Buffer): Buffer | null => (file.length > HEADER_BYTES + IV_BYTES + TAG_BYTES && file.subarray(0, MAGIC.length).equals(MAGIC) ? file.subarray(MAGIC.length, HEADER_BYTES) : null);

export function decryptBytes(file: Buffer, keyFor: (salt: Buffer) => Buffer): Buffer {
  const salt = saltOf(file);
  if (!salt) throw new UserError('That is not an encrypted InvoiceOn copy.');
  const header = file.subarray(0, HEADER_BYTES);
  const iv = file.subarray(HEADER_BYTES, HEADER_BYTES + IV_BYTES);
  const tag = file.subarray(HEADER_BYTES + IV_BYTES, HEADER_BYTES + IV_BYTES + TAG_BYTES);
  const data = file.subarray(HEADER_BYTES + IV_BYTES + TAG_BYTES);
  const key = keyFor(salt); // outside the try: "enter the passphrase" is a different message from "wrong passphrase"
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  } catch {
    throw new UserError('That passphrase does not open this copy, or the file has been changed or damaged.');
  }
}

// ── Settings kept for it ────────────────────────────────────────────────────
// They live in the settings table under their own keys (not part of the settings the screens edit). The derived key is kept so the
// automatic daily copy can encrypt without asking; the passphrase itself is never stored, and it alone is what opens a copy on a new computer.
const setting = (db: Db, key: string): string | undefined => all<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', key)[0]?.value;
const put = (db: Db, key: string, value: string) =>
  run(db, 'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', key, value, new Date().toISOString());
const drop = (db: Db, keys: string[]) => keys.forEach((k) => run(db, 'DELETE FROM settings WHERE key = ?', k));

const isFolder = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

function listFiles(folder: string): OffsiteFile[] {
  if (!isFolder(folder)) return [];
  try {
    return readdirSync(folder)
      .filter(isOurs)
      .map((name) => {
        const s = statSync(join(folder, name));
        return { name, bytes: s.size, modifiedAt: s.mtime.toISOString(), encrypted: ENCRYPTED.test(name) };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch {
    return [];
  }
}

export function offsiteStatus(db: Db): OffsiteStatus {
  const folder = setting(db, 'offsite_folder') ?? null;
  return {
    folder,
    encrypted: setting(db, 'offsite_encrypted') === '1',
    reachable: !!folder && isFolder(folder),
    lastAt: setting(db, 'offsite_last_at') ?? null,
    lastFile: setting(db, 'offsite_last_file') ?? null,
    lastError: setting(db, 'offsite_last_error') ?? null,
    files: folder ? listFiles(folder) : [],
  };
}

export function offsiteSave(db: Db, setup: OffsiteSetup): OffsiteStatus {
  const folder = typeof setup?.folder === 'string' ? setup.folder.trim() : '';
  if (!folder) throw new UserError('Choose the folder the copies should go to.');
  if (!isAbsolute(folder)) throw new UserError('Give the full path of the folder, such as D:\\Backups\\InvoiceOn.');
  if (!isFolder(folder)) throw new UserError('That folder does not exist. Create it first, or choose one that does.');
  const probe = join(folder, `.invoiceon-check-${process.pid}`);
  try {
    writeFileSync(probe, 'ok');
    rmSync(probe, { force: true });
  } catch {
    throw new UserError('InvoiceOn cannot write into that folder. Choose another one.');
  }

  if (setup.encrypt) {
    const passphrase = typeof setup.passphrase === 'string' ? setup.passphrase : '';
    if (passphrase) {
      if (passphrase.length < MIN_PASSPHRASE) throw new UserError(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
      const salt = randomBytes(SALT_BYTES);
      put(db, 'offsite_salt', salt.toString('hex'));
      put(db, 'offsite_key', deriveKey(passphrase, salt).toString('hex'));
    } else if (!setting(db, 'offsite_key')) {
      throw new UserError('Choose a passphrase to encrypt the copies with.');
    }
    put(db, 'offsite_encrypted', '1');
  } else {
    put(db, 'offsite_encrypted', '0');
    drop(db, ['offsite_salt', 'offsite_key']);
  }
  put(db, 'offsite_folder', folder);
  drop(db, ['offsite_last_error']);
  return offsiteStatus(db);
}

export function offsiteDisable(db: Db): OffsiteStatus {
  drop(db, ['offsite_folder', 'offsite_encrypted', 'offsite_salt', 'offsite_key', 'offsite_last_at', 'offsite_last_file', 'offsite_last_error']);
  return offsiteStatus(db);
}

// ── Copying ─────────────────────────────────────────────────────────────────
/**
 * Takes a consistent snapshot of the database and writes it into the off-site folder. A failure (an unplugged drive, a full disk) is
 * remembered and shown on the screen; `quiet` (the automatic copy) never throws, so it can never get in the way of opening the app.
 */
export function offsiteCopy(db: Db, dataDir: string, quiet = false): OffsiteStatus {
  const folder = setting(db, 'offsite_folder');
  if (!folder) {
    if (quiet) return offsiteStatus(db);
    throw new UserError('Off-site copies are not set up yet.');
  }
  const tmp = join(dataDir, `.offsite-${process.pid}-${Date.now()}.db`);
  try {
    if (!isFolder(folder)) throw new UserError('The off-site folder cannot be reached. Is the drive plugged in, or the folder still there?');
    mkdirSync(dataDir, { recursive: true });
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    let bytes: Buffer = readFileSync(tmp);
    let ext = '.db';
    if (setting(db, 'offsite_encrypted') === '1') {
      const key = setting(db, 'offsite_key');
      const salt = setting(db, 'offsite_salt');
      if (!key || !salt) throw new UserError('The encryption key is missing. Set up off-site copies again.');
      bytes = encryptBytes(bytes, Buffer.from(key, 'hex'), Buffer.from(salt, 'hex'));
      ext = '.db.enc';
    }
    const base = `invoiceon-offsite-${stamp()}`;
    let name = `${base}${ext}`;
    for (let n = 2; existsSync(join(folder, name)); n++) name = `${base}-${n}${ext}`;
    const partial = join(folder, `.${name}.partial`);
    writeFileSync(partial, bytes);
    renameSync(partial, join(folder, name)); // a copy either exists whole or not at all
    for (const old of listFiles(folder).slice(KEEP)) rmSync(join(folder, old.name), { force: true });
    put(db, 'offsite_last_at', new Date().toISOString());
    put(db, 'offsite_last_file', name);
    drop(db, ['offsite_last_error']);
  } catch (err) {
    const message = err instanceof UserError ? err.message : `The copy could not be made: ${(err as Error).message}`;
    put(db, 'offsite_last_error', message);
    if (!quiet) throw new UserError(message);
    console.error('[offsite] failed', err);
  } finally {
    rmSync(tmp, { force: true });
    rmSync(`${tmp}-wal`, { force: true });
    rmSync(`${tmp}-shm`, { force: true });
  }
  return offsiteStatus(db);
}

/** At startup: one off-site copy a day, once the folder is reachable. */
export function offsiteDaily(db: Db, dataDir: string): void {
  try {
    if (!setting(db, 'offsite_folder')) return;
    const last = setting(db, 'offsite_last_at');
    if (last && new Date(last).toDateString() === new Date().toDateString() && !setting(db, 'offsite_last_error')) return;
    offsiteCopy(db, dataDir, true);
  } catch (err) {
    console.error('[offsite] failed', err);
  }
}

/** Restores from a copy in the off-site folder, through the same careful restore as any other backup (with a safety copy first). */
export function offsiteRestore(db: Db, dataDir: string, name: string, passphrase?: string): { restoredFrom: string; restorePoint: string } {
  const folder = setting(db, 'offsite_folder');
  if (!folder) throw new UserError('Off-site copies are not set up yet.');
  if (typeof name !== 'string' || !isOurs(name)) throw new UserError('That is not one of your off-site copies.');
  const file = join(folder, name);
  if (!existsSync(file)) throw new UserError('That copy is no longer in the off-site folder.');
  let bytes: Buffer = readFileSync(file);
  if (ENCRYPTED.test(name)) {
    const storedSalt = setting(db, 'offsite_salt');
    const storedKey = setting(db, 'offsite_key');
    bytes = decryptBytes(bytes, (salt) => {
      if (passphrase) return deriveKey(passphrase, salt);
      if (storedKey && storedSalt && salt.toString('hex') === storedSalt) return Buffer.from(storedKey, 'hex');
      throw new UserError('This copy is encrypted. Enter the passphrase it was made with.');
    });
  }
  if (bytes.subarray(0, SQLITE_HEADER.length).toString('latin1') !== SQLITE_HEADER) throw new UserError('That file is not an InvoiceOn database.');
  const backups = join(dataDir, 'backups');
  const imported = importBackup(backups, bytes);
  return restoreBackup(db, backups, imported);
}
