import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { all, openDb, type Db } from './db/connection';
import { LATEST_SCHEMA_VERSION } from './db/migrations';
import { UserError } from './services/common';

const KEEP = 14;

const MANUAL = /^invoiceon-manual-\d{4}-\d{2}-\d{2}-\d{6}(-\d+)?\.db$/;
const DAILY = /^invoiceon-\d{4}-\d{2}-\d{2}\.db$/;
/** The safety copy taken just before a restore, so a restore can itself be undone. Kept like the ones you make yourself. */
const RESTORE_POINT = /^invoiceon-before-restore-\d{4}-\d{2}-\d{2}-\d{6}(-\d+)?\.db$/;

const stamp = (): string => {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
};
const quote = (path: string): string => path.replace(/'/g, "''");

/** `<prefix>-<timestamp>.db`, or with a counter on the end if that second is already taken (two clicks in one second must not collide). */
function uniqueName(dir: string, prefix: string): string {
  const base = `${prefix}-${stamp()}`;
  let name = `${base}.db`;
  for (let n = 2; existsSync(join(dir, name)); n++) name = `${base}-${n}.db`;
  return name;
}

/** A snapshot the owner asked for. Named apart from the daily ones so the two-week clean-up never deletes it. */
export function backupNow(db: Db, dir: string): { name: string } {
  mkdirSync(dir, { recursive: true });
  const name = uniqueName(dir, 'invoiceon-manual');
  db.exec(`VACUUM INTO '${quote(join(dir, name))}'`);
  return { name };
}

/** Backups on disk, newest first. */
export function listBackups(dir: string): { name: string; bytes: number; modifiedAt: string; manual: boolean; kind: 'daily' | 'manual' | 'restore-point' }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => DAILY.test(f) || MANUAL.test(f) || RESTORE_POINT.test(f))
    .map((name) => {
      const s = statSync(join(dir, name));
      const kind = DAILY.test(name) ? ('daily' as const) : RESTORE_POINT.test(name) ? ('restore-point' as const) : ('manual' as const);
      return { name, bytes: s.size, modifiedAt: s.mtime.toISOString(), manual: kind !== 'daily', kind };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

/** One consistent snapshot per day, taken at startup, keeping the most recent two weeks. */
export function backupDaily(db: Db, dir: string): void {
  try {
    mkdirSync(dir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const target = join(dir, `invoiceon-${today}.db`);
    if (!existsSync(target)) db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    const old = readdirSync(dir).filter((f) => DAILY.test(f)).sort().reverse().slice(KEEP);
    for (const f of old) rmSync(join(dir, f), { force: true });
  } catch (err) {
    // A failed backup must never stop the app from opening.
    console.error('[backup] failed', err);
  }
}

/**
 * Replaces everything in the open database with the contents of a backup, in one transaction, so a failure leaves the data exactly
 * as it was. The backup is copied aside and brought up to the current schema first (an older backup restores fine), checked for
 * damage, and a safety copy of the current data is taken before anything changes. The connection stays open, so the app carries
 * on without a restart.
 */
export function restoreBackup(db: Db, dir: string, name: string): { restoredFrom: string; restorePoint: string } {
  if (typeof name !== 'string' || !(DAILY.test(name) || MANUAL.test(name) || RESTORE_POINT.test(name))) throw new UserError('That is not one of your backups.');
  const source = join(dir, name);
  if (!existsSync(source)) throw new UserError('That backup file is no longer in the backups folder.');

  // Work on a copy so the backup itself is never modified by upgrading its schema.
  const scratch = join(dir, `.restore-${process.pid}-${Date.now()}.db`);
  copyFileSync(source, scratch);
  try {
    const backup = (() => {
      try {
        return openDb(scratch);
      } catch (err) {
        throw new UserError(`That backup can't be opened: ${(err as Error).message}`);
      }
    })();
    try {
      const version = (backup.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
      const check = (backup.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
      if (check !== 'ok') throw new UserError('That backup is damaged and cannot be restored.');
      if (version > LATEST_SCHEMA_VERSION) throw new UserError('That backup was made by a newer version of InvoiceOn. Update the app first.');
      backup.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      backup.close();
    }

    const restorePoint = uniqueName(dir, 'invoiceon-before-restore');
    db.exec(`VACUUM INTO '${quote(join(dir, restorePoint))}'`);

    // Foreign keys are switched off for the copy (the tables are refilled in no particular order) and checked before committing.
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`ATTACH DATABASE '${quote(scratch)}' AS bk`);
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        const tables = all<{ name: string }>(db, "SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
        const inBackup = new Set(all<{ name: string }>(db, "SELECT name FROM bk.sqlite_master WHERE type = 'table'").map((t) => t.name));
        // Who can sign in is not something a backup should change either: restoring an older copy must not bring back old PINs, or switch
        // access control off. The switch is kept as it is now, and the people are left alone.
        const accessFlag = all<{ value: string }>(db, "SELECT value FROM main.settings WHERE key = 'access_enabled'")[0]?.value;
        for (const { name: table } of tables) {
          // The activity log is not part of what a backup restores: it keeps recording what happened, the restore included.
          if (table === 'audit_log' || table === 'users') continue;
          db.exec(`DELETE FROM main."${table}"`);
          if (!inBackup.has(table)) continue;
          const columns = all<{ name: string }>(db, `PRAGMA main.table_info("${table}")`).map((c) => `"${c.name}"`).join(', ');
          db.exec(`INSERT INTO main."${table}" (${columns}) SELECT ${columns} FROM bk."${table}"`);
        }
        if (accessFlag !== undefined) db.exec(`INSERT INTO main.settings (key, value, updated_at) VALUES ('access_enabled', '${accessFlag === '1' ? '1' : '0'}', '${new Date().toISOString()}') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
        const broken = all(db, 'PRAGMA foreign_key_check');
        if (broken.length > 0) throw new UserError('That backup is inconsistent (records point at things that are missing), so it was not restored. Your data is unchanged.');
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    } finally {
      db.exec('DETACH DATABASE bk');
      db.exec('PRAGMA foreign_keys = ON');
    }
    return { restoredFrom: name, restorePoint };
  } finally {
    rmSync(scratch, { force: true });
    rmSync(`${scratch}-wal`, { force: true });
    rmSync(`${scratch}-shm`, { force: true });
  }
}
