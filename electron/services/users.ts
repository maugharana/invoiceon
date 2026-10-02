import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { PIN_PATTERN, ROLES, type Role } from '../../shared/roles';
import type { AuthUser, ManagedUser } from '../../shared/types';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, newId, nowIso, requireText } from './common';

// Sign-in is optional. A shop that never turns it on works as before. Once it is on, every call is checked against the signed-in
// person's role (see shared/roles.ts). PINs are never stored: only a salted scrypt hash, so a copy of the book does not reveal them.

const KEY_LENGTH = 32;

function hashPin(pin: string, salt: string): string {
  return scryptSync(pin, salt, KEY_LENGTH).toString('hex');
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

function checkPin(pin: unknown): string {
  const p = String(pin ?? '');
  if (!PIN_PATTERN.test(p)) throw new UserError('A PIN is 4 to 8 digits.');
  return p;
}

interface Row {
  id: string;
  name: string;
  role: Role;
  pin_salt: string;
  pin_hash: string;
  active: number;
  created_at: string;
}

const toAuth = (r: Row): AuthUser => ({ id: r.id, name: r.name, role: r.role });
const toManaged = (r: Row): ManagedUser => ({ ...toAuth(r), active: r.active === 1, createdAt: r.created_at });

export const authRequired = (db: Db): boolean => !!get(db, 'SELECT 1 AS x FROM users WHERE active = 1');

/** People who can sign in, for the choose-your-name screen. No PINs, no hashes. */
export function signInChoices(db: Db): AuthUser[] {
  return all<Row>(db, 'SELECT * FROM users WHERE active = 1 ORDER BY CASE role WHEN \'owner\' THEN 0 ELSE 1 END, name COLLATE NOCASE').map(toAuth);
}

/** The person behind a session, as they are now: a change of role or removal takes effect on their very next action. */
export function currentUser(db: Db, id: string): AuthUser | null {
  const r = get<Row>(db, 'SELECT * FROM users WHERE id = ? AND active = 1', id);
  return r ? toAuth(r) : null;
}

export function listUsers(db: Db): ManagedUser[] {
  return all<Row>(db, 'SELECT * FROM users ORDER BY active DESC, CASE role WHEN \'owner\' THEN 0 ELSE 1 END, name COLLATE NOCASE').map(toManaged);
}

function getRow(db: Db, id: string): Row {
  const r = get<Row>(db, 'SELECT * FROM users WHERE id = ?', id);
  if (!r) throw new UserError('That person is no longer on the list.');
  return r;
}

const activeOwners = (db: Db, except = ''): number => get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1 AND id <> ?", except)?.n ?? 0;

// Too many wrong PINs in a row pauses sign-in for that person. Kept in memory: closing the app is not a way round it that matters,
// since anyone with the computer and the file could simply open the file, which no PIN can prevent (see the README).
const attempts = new Map<string, { count: number; until: number }>();
const MAX_TRIES = 5;
const LOCK_MS = 30_000;

export function signIn(db: Db, userId: string, pin: string, now: number = Date.now()): AuthUser {
  const r = get<Row>(db, 'SELECT * FROM users WHERE id = ? AND active = 1', userId);
  if (!r) throw new UserError('That person can not sign in.');
  const a = attempts.get(userId) ?? { count: 0, until: 0 };
  if (a.until > now) throw new UserError(`Too many wrong PINs. Try again in ${Math.ceil((a.until - now) / 1000)} seconds.`);
  if (!PIN_PATTERN.test(String(pin ?? '')) || !same(hashPin(String(pin), r.pin_salt), r.pin_hash)) {
    const count = a.count + 1;
    attempts.set(userId, count >= MAX_TRIES ? { count: 0, until: now + LOCK_MS } : { count, until: 0 });
    throw new UserError(count >= MAX_TRIES ? `Too many wrong PINs. Try again in ${LOCK_MS / 1000} seconds.` : 'That PIN is not right.');
  }
  attempts.delete(userId);
  return toAuth(r);
}

function insert(db: Db, name: string, role: Role, pin: string): string {
  const salt = randomBytes(16).toString('hex');
  const id = newId();
  const now = nowIso();
  run(db, 'INSERT INTO users (id, name, role, pin_salt, pin_hash, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)', id, name, role, salt, hashPin(pin, salt), now, now);
  return id;
}

const nameFree = (db: Db, name: string, except = ''): void => {
  if (get(db, 'SELECT 1 AS x FROM users WHERE name = ? COLLATE NOCASE AND id <> ?', name, except)) throw new UserError(`There is already someone called “${name}”.`);
};

/** A recovery code for a forgotten owner PIN, shown once. Only its hash is kept. */
function newRecoveryCode(db: Db): string {
  const code = randomBytes(6).toString('hex').toUpperCase().replace(/(.{4})/g, '$1-').slice(0, 14);
  const salt = randomBytes(16).toString('hex');
  run(db, "INSERT INTO settings (key, value, updated_at) VALUES ('recovery_salt', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", salt, nowIso());
  run(db, "INSERT INTO settings (key, value, updated_at) VALUES ('recovery_hash', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", hashPin(code, salt), nowIso());
  return code;
}

/** Turns sign-in on by making the first person, the owner. Returns the recovery code, which is shown once. */
export function setup(db: Db, input: { name: string; pin: string }): { user: AuthUser; recoveryCode: string } {
  if (authRequired(db)) throw new UserError('Sign-in is already on.');
  const name = requireText(input.name, 'Your name', 40);
  const pin = checkPin(input.pin);
  return tx(db, () => {
    run(db, 'DELETE FROM users');
    const id = insert(db, name, 'owner', pin);
    return { user: toAuth(getRow(db, id)), recoveryCode: newRecoveryCode(db) };
  });
}

export function createUser(db: Db, input: { name: string; role: Role; pin: string }): ManagedUser {
  const name = requireText(input.name, 'Name', 40);
  if (!(ROLES as readonly string[]).includes(input.role)) throw new UserError('Choose what they can do.');
  const pin = checkPin(input.pin);
  nameFree(db, name);
  return toManaged(getRow(db, insert(db, name, input.role, pin)));
}

export function updateUser(db: Db, id: string, patch: { name?: string; role?: Role; active?: boolean }): ManagedUser {
  const r = getRow(db, id);
  const name = patch.name === undefined ? r.name : requireText(patch.name, 'Name', 40);
  const role = patch.role ?? r.role;
  const active = patch.active === undefined ? r.active === 1 : !!patch.active;
  if (!(ROLES as readonly string[]).includes(role)) throw new UserError('Choose what they can do.');
  nameFree(db, name, id);
  // The shop must always have someone who can turn things back on.
  if (r.role === 'owner' && r.active === 1 && (role !== 'owner' || !active) && activeOwners(db, id) === 0) throw new UserError('There must always be at least one active owner.');
  run(db, 'UPDATE users SET name = ?, role = ?, active = ?, updated_at = ? WHERE id = ?', name, role, active ? 1 : 0, nowIso(), id);
  return toManaged(getRow(db, id));
}

export function resetPin(db: Db, id: string, pin: string): void {
  const r = getRow(db, id);
  const salt = randomBytes(16).toString('hex');
  run(db, 'UPDATE users SET pin_salt = ?, pin_hash = ?, updated_at = ? WHERE id = ?', salt, hashPin(checkPin(pin), salt), nowIso(), r.id);
  attempts.delete(id);
}

export function changeOwnPin(db: Db, id: string, oldPin: string, newPin: string): void {
  const r = getRow(db, id);
  if (!same(hashPin(String(oldPin ?? ''), r.pin_salt), r.pin_hash)) throw new UserError('Your current PIN is not right.');
  resetPin(db, id, newPin);
}

/** A forgotten owner PIN: the recovery code given when sign-in was turned on sets a new one. Returns a fresh code. */
export function recover(db: Db, code: string, newPin: string): { user: AuthUser; recoveryCode: string } {
  const salt = get<{ value: string }>(db, "SELECT value FROM settings WHERE key = 'recovery_salt'")?.value;
  const hash = get<{ value: string }>(db, "SELECT value FROM settings WHERE key = 'recovery_hash'")?.value;
  const pin = checkPin(newPin);
  const guess = String(code ?? '').trim().toUpperCase();
  if (!salt || !hash || !same(hashPin(guess, salt), hash)) throw new UserError('That recovery code is not right.');
  const owner = get<Row>(db, "SELECT * FROM users WHERE role = 'owner' ORDER BY active DESC, created_at LIMIT 1");
  if (!owner) throw new UserError('There is no owner to recover.');
  return tx(db, () => {
    run(db, 'UPDATE users SET active = 1, updated_at = ? WHERE id = ?', nowIso(), owner.id);
    resetPin(db, owner.id, pin);
    return { user: toAuth(getRow(db, owner.id)), recoveryCode: newRecoveryCode(db) };
  });
}

/** Turns sign-in off again: everyone is removed and the app opens straight in as before. Needs the owner's PIN. */
export function disable(db: Db, ownerId: string, pin: string): void {
  const r = getRow(db, ownerId);
  if (r.role !== 'owner' || !same(hashPin(String(pin ?? ''), r.pin_salt), r.pin_hash)) throw new UserError('Enter the owner PIN to turn sign-in off.');
  tx(db, () => {
    run(db, 'DELETE FROM users');
    run(db, "DELETE FROM settings WHERE key IN ('recovery_salt', 'recovery_hash')");
  });
}
