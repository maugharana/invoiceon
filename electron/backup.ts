import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { BackupFileInfo, BackupSettings, BackupNote } from '../shared/types';
import { todayIso } from '../shared/gst';
import { LATEST_SCHEMA_VERSION } from './db/migrations';
import type { Db } from './db/connection';
import { UserError } from './services/common';

const KEEP = 14;

const MANUAL = /^invoiceon-manual-\d{4}-\d{2}-\d{2}-\d{6}\.db$/;
const DAILY = /^invoiceon-\d{4}-\d{2}-\d{2}\.db$/;
const BEFORE_RESTORE = /^invoiceon-before-restore-\d{4}-\d{2}-\d{2}-\d{6}\.db$/;
export const isBackupName = (f: string): boolean => DAILY.test(f) || MANUAL.test(f) || BEFORE_RESTORE.test(f);

const stampNow = () => {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
};

/** Writes a consistent snapshot of the open book to `file`, which must not exist yet. */
export function snapshotTo(db: Db, file: string): void {
  if (existsSync(file)) throw new UserError('A file with that name already exists there.');
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
}

/** A snapshot the owner asked for. Named apart from the daily ones so the two-week clean-up never deletes it. */
export function backupNow(db: Db, dir: string): { name: string } {
  mkdirSync(dir, { recursive: true });
  const name = `invoiceon-manual-${stampNow()}.db`;
  snapshotTo(db, join(dir, name));
  return { name };
}

/** A copy of the current book made just before a restore replaces it, so a restore can always be undone. */
export function backupBeforeRestore(db: Db, dir: string): { name: string } {
  mkdirSync(dir, { recursive: true });
  const name = `invoiceon-before-restore-${stampNow()}.db`;
  snapshotTo(db, join(dir, name));
  return { name };
}

/** Backups on disk, newest first. */
export function listBackups(dir: string): BackupFileInfo[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(isBackupName)
    .map((name) => {
      const s = statSync(join(dir, name));
      const kind = MANUAL.test(name) ? 'manual' : BEFORE_RESTORE.test(name) ? 'before-restore' : 'daily';
      return { name, bytes: s.size, modifiedAt: s.mtime.toISOString(), manual: kind !== 'daily', kind } satisfies BackupFileInfo;
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

/** One consistent snapshot per day, taken at startup, keeping the most recent two weeks. Returns the day's file name. */
export function backupDaily(db: Db, dir: string): string | null {
  try {
    mkdirSync(dir, { recursive: true });
    const today = todayIso();
    const name = `invoiceon-${today}.db`;
    const target = join(dir, name);
    if (!existsSync(target)) db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    const old = readdirSync(dir).filter((f) => DAILY.test(f)).sort().reverse().slice(KEEP);
    for (const f of old) rmSync(join(dir, f), { force: true });
    return name;
  } catch (err) {
    // A failed backup must never stop the app from opening.
    console.error('[backup] failed', err);
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Where else backups go. Kept in a small file beside the book, not inside it, so restoring an old book never changes
// where this computer sends its backups or which Google account it is signed in to.

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = { extraFolder: '', extraAuto: true, driveAuto: true, keepDrive: 14 };
const SETTINGS_FILE = 'backup-settings.json';

type Stored = Partial<BackupSettings> & { extraLast?: BackupNote | null; driveLast?: BackupNote | null };

function readStored(dataDir: string): Stored {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dataDir, SETTINGS_FILE), 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Stored) : {};
  } catch {
    return {};
  }
}

function writeStored(dataDir: string, value: Stored): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, SETTINGS_FILE), JSON.stringify(value, null, 2), 'utf8');
}

export function loadBackupSettings(dataDir: string): BackupSettings {
  const s = readStored(dataDir);
  return {
    extraFolder: typeof s.extraFolder === 'string' ? s.extraFolder : DEFAULT_BACKUP_SETTINGS.extraFolder,
    extraAuto: typeof s.extraAuto === 'boolean' ? s.extraAuto : DEFAULT_BACKUP_SETTINGS.extraAuto,
    driveAuto: typeof s.driveAuto === 'boolean' ? s.driveAuto : DEFAULT_BACKUP_SETTINGS.driveAuto,
    keepDrive: Number.isInteger(s.keepDrive) && s.keepDrive! >= 1 && s.keepDrive! <= 365 ? s.keepDrive! : DEFAULT_BACKUP_SETTINGS.keepDrive,
  };
}

export function saveBackupSettings(dataDir: string, input: BackupSettings): BackupSettings {
  const folder = String(input.extraFolder ?? '').trim();
  if (folder && !isAbsolute(folder)) throw new UserError('Choose a full folder path, such as D:\\InvoiceOn backups.');
  const keep = Math.round(Number(input.keepDrive));
  if (!Number.isFinite(keep) || keep < 1 || keep > 365) throw new UserError('Keep between 1 and 365 online backups.');
  if (folder) {
    try {
      mkdirSync(folder, { recursive: true });
      const probe = join(folder, '.invoiceon-write-test');
      writeFileSync(probe, 'ok');
      rmSync(probe, { force: true });
    } catch {
      throw new UserError(`InvoiceOn can't write to ${folder}. Check that the drive is connected and the folder is allowed.`);
    }
  }
  const next: BackupSettings = { extraFolder: folder, extraAuto: !!input.extraAuto, driveAuto: !!input.driveAuto, keepDrive: keep };
  writeStored(dataDir, { ...readStored(dataDir), ...next });
  return next;
}

export type NoteKind = 'extra' | 'drive';

/** What happened the last time a copy was sent somewhere, so the screen can say so. */
export function readNote(dataDir: string, kind: NoteKind): BackupNote | null {
  const s = readStored(dataDir);
  return (kind === 'extra' ? s.extraLast : s.driveLast) ?? null;
}

export function writeNote(dataDir: string, kind: NoteKind, ok: boolean, message: string): void {
  const s = readStored(dataDir);
  const note: BackupNote = { at: new Date().toISOString(), ok, message };
  writeStored(dataDir, kind === 'extra' ? { ...s, extraLast: note } : { ...s, driveLast: note });
}

/** Copies a backup file into the extra folder, and tidies the daily ones there to the same two weeks. */
export function copyToFolder(source: string, folder: string): string {
  mkdirSync(folder, { recursive: true });
  const name = source.slice(Math.max(source.lastIndexOf('\\'), source.lastIndexOf('/')) + 1);
  const target = join(folder, name);
  copyFileSync(source, target);
  const old = readdirSync(folder).filter((f) => DAILY.test(f)).sort().reverse().slice(KEEP);
  for (const f of old) rmSync(join(folder, f), { force: true });
  return target;
}

// ---------------------------------------------------------------------------------------------------------------------
// Restoring. The live book is open all the time the app runs, so a restore is done in two steps: check the file and put
// it aside now, then swap it in on the next start, before the book is opened.

const PENDING = 'restore-pending.db';

/** Opens a file read-only and checks that it is a whole, readable InvoiceOn book this version can open. Throws plain words if not. */
export function checkBackupFile(file: string): { version: number; bytes: number } {
  if (!existsSync(file)) throw new UserError('That backup file could not be found.');
  const bytes = statSync(file).size;
  if (bytes < 4096) throw new UserError('That file is too small to be an InvoiceOn backup.');
  let probe: DatabaseSync | null = null;
  try {
    probe = new DatabaseSync(file, { readOnly: true });
    const integrity = probe.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (integrity.integrity_check !== 'ok') throw new UserError('That backup is damaged, so it was not used. Your current book is untouched.');
    const tables = new Set((probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
    for (const t of ['settings', 'customers', 'invoices', 'designs']) {
      if (!tables.has(t)) throw new UserError('That file is not an InvoiceOn backup.');
    }
    const version = (probe.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (version > LATEST_SCHEMA_VERSION) throw new UserError('That backup was made by a newer InvoiceOn. Update InvoiceOn first, then restore it.');
    return { version, bytes };
  } catch (err) {
    if (err instanceof UserError) throw err;
    throw new UserError('That file is not an InvoiceOn backup.');
  } finally {
    probe?.close();
  }
}

/** Checks `file`, makes a safety copy of the current book, and leaves the file ready to be swapped in when the app next starts. */
export function stageRestore(db: Db, dataDir: string, file: string): { safetyCopy: string } {
  checkBackupFile(file);
  const safety = backupBeforeRestore(db, join(dataDir, 'backups'));
  const pending = join(dataDir, PENDING);
  rmSync(pending, { force: true });
  copyFileSync(file, pending);
  return { safetyCopy: safety.name };
}

export const hasPendingRestore = (dataDir: string): boolean => existsSync(join(dataDir, PENDING));

/** Cancels a staged restore. */
export function discardPendingRestore(dataDir: string): void {
  rmSync(join(dataDir, PENDING), { force: true });
}

/**
 * Run at startup before the book is opened. Swaps the staged file in for the book. If anything goes wrong the old book is put
 * back, so a failed restore leaves things exactly as they were.
 */
export function applyPendingRestore(dataDir: string): boolean {
  const pending = join(dataDir, PENDING);
  if (!existsSync(pending)) return false;
  const live = join(dataDir, 'invoiceon.db');
  const aside = join(dataDir, 'invoiceon.db.replaced');
  try {
    checkBackupFile(pending);
    rmSync(aside, { force: true });
    if (existsSync(live)) renameSync(live, aside);
    // A leftover journal from the old book must never be paired with the new one.
    rmSync(`${live}-wal`, { force: true });
    rmSync(`${live}-shm`, { force: true });
    try {
      renameSync(pending, live);
    } catch (err) {
      if (existsSync(aside)) renameSync(aside, live);
      throw err;
    }
    rmSync(aside, { force: true });
    return true;
  } catch (err) {
    console.error('[restore] failed, keeping the current book', err);
    rmSync(pending, { force: true });
    return false;
  }
}
