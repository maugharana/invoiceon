import { DatabaseSync } from 'node:sqlite';
import { migrate } from './migrations';

// Node's built-in SQLite: synchronous, zero native modules to compile or ship. Everything above this
// file only uses prepare/run/get/all/exec, so swapping in better-sqlite3 later is a change in this file.
export type Db = DatabaseSync;

export function openDb(file: string): Db {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 3000;
  `);
  migrate(db);
  return db;
}

const depth = new WeakMap<Db, number>();

/** Runs fn atomically. Nested calls become savepoints, so services can compose freely. */
export function tx<T>(db: Db, fn: () => T): T {
  const level = depth.get(db) ?? 0;
  const savepoint = `sp_${level}`;
  db.exec(level === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
  depth.set(db, level + 1);
  try {
    const result = fn();
    depth.set(db, level);
    db.exec(level === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
    return result;
  } catch (err) {
    depth.set(db, level);
    db.exec(level === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
    throw err;
  }
}

export type Row = Record<string, string | number | null>;

export function all<T = Row>(db: Db, sql: string, ...params: (string | number | null)[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}

export function get<T = Row>(db: Db, sql: string, ...params: (string | number | null)[]): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined;
}

export function run(db: Db, sql: string, ...params: (string | number | null)[]): void {
  db.prepare(sql).run(...params);
}
