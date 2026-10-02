import { existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { BackupResult, DataInfo, DriveBackup, DriveStatus, RestoreSource } from '../shared/types';
import {
  backupDaily,
  backupNow,
  copyToFolder,
  hasPendingRestore,
  isBackupName,
  listBackups,
  loadBackupSettings,
  readNote,
  stageRestore,
  writeNote,
} from './backup';
import type { Db } from './db/connection';
import * as drive from './drive';
import { UserError } from './services/common';

/** What the desktop shell lends to backups: asking where a file is, and restarting. Absent in the browser preview. */
export interface BackupHost {
  pickFile?(title: string): Promise<string | null>;
  restartApp?(): Promise<void>;
}

/** Test hooks: a stand-in for the internet. */
export type DriveOverrides = Pick<drive.DriveContext, 'fetch' | 'endpoints'>;

export function driveContext(dataDir: string, vault: drive.Vault | undefined, overrides?: DriveOverrides): drive.DriveContext {
  return { dir: dataDir, vault: vault ?? drive.plainVault, ...overrides };
}

const backupsDir = (dataDir: string) => join(dataDir, 'backups');
const sizeOf = (dataDir: string): number =>
  ['invoiceon.db', 'invoiceon.db-wal'].reduce((sum, f) => sum + (existsSync(join(dataDir, f)) ? statSync(join(dataDir, f)).size : 0), 0);

export const driveState = (ctx: drive.DriveContext): DriveStatus => drive.driveStatus(ctx, readNote(ctx.dir, 'drive'));

export function dataInfo(ctx: drive.DriveContext): DataInfo {
  const dataDir = ctx.dir;
  return {
    folder: dataDir,
    databaseBytes: sizeOf(dataDir),
    backups: listBackups(backupsDir(dataDir)),
    settings: loadBackupSettings(dataDir),
    extraLast: readNote(dataDir, 'extra'),
    drive: driveState(ctx),
    restorePending: hasPendingRestore(dataDir),
  };
}

const sayError = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Puts a finished backup file into the extra folder and into Drive, as asked. Never throws: each failure becomes a line to report. */
async function sendCopies(ctx: drive.DriveContext, file: string, name: string, opts: { extra: boolean; drive: boolean; prune: boolean }, result: BackupResult): Promise<void> {
  const dataDir = ctx.dir;
  const settings = loadBackupSettings(dataDir);
  if (opts.extra && settings.extraFolder) {
    try {
      copyToFolder(file, settings.extraFolder);
      writeNote(dataDir, 'extra', true, `Copied ${name} to ${settings.extraFolder}`);
      result.done.push(`Copied to ${settings.extraFolder}`);
    } catch (err) {
      const msg = `Couldn't copy to ${settings.extraFolder}. Is the drive connected?`;
      writeNote(dataDir, 'extra', false, msg);
      result.problems.push(msg);
      console.error('[backup] extra folder', err);
    }
  }
  if (opts.drive && driveState(ctx).connected) {
    try {
      if (opts.prune) {
        // The daily upload happens once a day however often the app is opened.
        const existing = await drive.listDriveBackups(ctx);
        if (existing.some((b) => b.name === name)) {
          result.done.push('Already in Google Drive today');
          return;
        }
      }
      await drive.uploadBackup(ctx, file, name);
      if (opts.prune) await drive.pruneDriveBackups(ctx, settings.keepDrive);
      writeNote(dataDir, 'drive', true, `Uploaded ${name}`);
      result.done.push('Uploaded to Google Drive');
    } catch (err) {
      const msg = sayError(err);
      writeNote(dataDir, 'drive', false, msg);
      result.problems.push(`Google Drive: ${msg}`);
    }
  }
}

/** "Back up now": a copy on this computer, and a copy to every other place that is set up. */
export async function backupEverywhere(db: Db, ctx: drive.DriveContext): Promise<BackupResult> {
  const dir = backupsDir(ctx.dir);
  const { name } = backupNow(db, dir);
  const result: BackupResult = { name, done: ['Saved on this computer'], problems: [] };
  await sendCopies(ctx, join(dir, name), name, { extra: true, drive: true, prune: false }, result);
  return result;
}

/** Once a day (it is safe to call as often as you like): the daily copy here, and then, as set up, in the extra folder and in Drive. */
export async function runAutoBackup(db: Db, ctx: drive.DriveContext): Promise<BackupResult | null> {
  const dir = backupsDir(ctx.dir);
  const name = backupDaily(db, dir);
  if (!name) return null;
  const settings = loadBackupSettings(ctx.dir);
  const result: BackupResult = { name, done: [], problems: [] };
  await sendCopies(ctx, join(dir, name), name, { extra: settings.extraAuto, drive: settings.driveAuto, prune: true }, result);
  return result;
}

/** Prepares a restore from any source, then restarts so it can be applied before the book opens. */
export async function restore(db: Db, ctx: drive.DriveContext, host: BackupHost | undefined, source: RestoreSource): Promise<{ started: boolean; safetyCopy?: string }> {
  if (!host?.restartApp) throw new UserError('Restoring works in the InvoiceOn desktop app only.');
  const dataDir = ctx.dir;
  let file: string;
  let temp: string | null = null;
  if (source.from === 'list') {
    if (!isBackupName(String(source.name))) throw new UserError('Choose a backup from the list.');
    file = join(backupsDir(dataDir), source.name);
  } else if (source.from === 'file') {
    if (!host.pickFile) throw new UserError('Restoring works in the InvoiceOn desktop app only.');
    const picked = await host.pickFile('Choose a backup to restore');
    if (!picked) return { started: false };
    file = picked;
  } else {
    temp = join(dataDir, 'restore-download.db');
    await drive.downloadBackup(ctx, String(source.id), temp);
    file = temp;
  }
  try {
    const { safetyCopy } = stageRestore(db, dataDir, file);
    await host.restartApp();
    return { started: true, safetyCopy };
  } finally {
    if (temp) rmSync(temp, { force: true });
  }
}

export const driveBackups = (ctx: drive.DriveContext): Promise<DriveBackup[]> => drive.listDriveBackups(ctx);
