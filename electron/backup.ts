import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db/connection';

const KEEP = 14;

const MANUAL = /^invoiceon-manual-\d{4}-\d{2}-\d{2}-\d{6}\.db$/;
const DAILY = /^invoiceon-\d{4}-\d{2}-\d{2}\.db$/;

/** A snapshot the owner asked for. Named apart from the daily ones so the two-week clean-up never deletes it. */
export function backupNow(db: Db, dir: string): { name: string } {
  mkdirSync(dir, { recursive: true });
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const name = `invoiceon-manual-${stamp}.db`;
  db.exec(`VACUUM INTO '${join(dir, name).replace(/'/g, "''")}'`);
  return { name };
}

/** Backups on disk, newest first. */
export function listBackups(dir: string): { name: string; bytes: number; modifiedAt: string; manual: boolean }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => DAILY.test(f) || MANUAL.test(f))
    .map((name) => {
      const s = statSync(join(dir, name));
      return { name, bytes: s.size, modifiedAt: s.mtime.toISOString(), manual: MANUAL.test(name) };
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
