import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ALWAYS_ALLOWED, LOCKED_MESSAGE, PIN_PATTERN, ROLES, ROLE_LABEL, canDo, capabilityOf, redactCosts, type AccessStatus, type AccessUser, type AccessUserInput, type Role } from '../../shared/access';
import type { Api } from '../../shared/api';
import { appendAudit, type Actor } from '../audit';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, newId, nowIso, requireText } from './common';
import { getSettings } from './settings';

// Access control is optional and off until the owner turns it on. While it is off, nothing here does anything: every call goes through
// untouched and the actor in the activity log is simply "Owner". Once on, calls need someone signed in whose role allows them.
//
// This protects the app on a shared shop computer. It is not encryption: someone with the database file itself can read it.

interface UserRow {
  id: string;
  name: string;
  role: Role;
  pin_salt: string;
  pin_hash: string;
  active: number;
}

const hashPin = (pin: string, salt: string): string => scryptSync(pin, salt, 32).toString('hex');

function checkPin(pin: unknown, label = 'PIN'): string {
  if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) throw new UserError(`The ${label} must be 4 to 8 digits.`);
  return pin;
}

const rowToUser = (r: UserRow): AccessUser => ({ id: r.id, name: r.name, role: r.role, active: r.active === 1 });

export const accessEnabled = (db: Db): boolean => get<{ value: string }>(db, "SELECT value FROM settings WHERE key = 'access_enabled'")?.value === '1';
const setEnabled = (db: Db, on: boolean): void => run(db, "INSERT INTO settings (key, value, updated_at) VALUES ('access_enabled', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", on ? '1' : '0', nowIso());

export function listUsers(db: Db): AccessUser[] {
  return all<UserRow>(db, 'SELECT * FROM users ORDER BY active DESC, CASE role WHEN \'owner\' THEN 0 WHEN \'manager\' THEN 1 ELSE 2 END, name COLLATE NOCASE').map(rowToUser);
}

const activeOwners = (db: Db, except?: string): number => get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1 AND id != ?", except ?? '')?.n ?? 0;

/** Signed in, in memory only: closing the app locks it, and so does anyone signing out. */
export interface Session {
  user: { id: string; name: string; role: Role } | null;
  /** Who to write in the activity log. */
  actor(): Actor;
}

export function createSession(db: Db): Session & { failures: Map<string, { count: number; until: number }> } {
  return {
    user: null,
    failures: new Map(),
    actor() {
      return accessEnabled(db) && this.user ? { id: this.user.id, name: this.user.name } : { id: null, name: 'Owner' };
    },
  };
}

type SessionState = ReturnType<typeof createSession>;

export function status(db: Db, session: SessionState): AccessStatus {
  const enabled = accessEnabled(db);
  return {
    enabled,
    user: enabled ? session.user : null,
    businessName: getSettings(db).businessName,
    people: enabled ? listUsers(db).filter((u) => u.active).map((u) => ({ id: u.id, name: u.name, role: u.role })) : [],
    autoLockMinutes: getSettings(db).autoLockMinutes,
  };
}

const MAX_TRIES = 5;
const LOCKOUT_MS = 30_000;

export function login(db: Db, session: SessionState, userId: string, pin: string): AccessStatus {
  if (!accessEnabled(db)) throw new UserError('Access control is not turned on.');
  const row = get<UserRow>(db, 'SELECT * FROM users WHERE id = ? AND active = 1', String(userId));
  if (!row) throw new UserError('That person is not on the list.');
  const f = session.failures.get(row.id);
  if (f && f.until > Date.now()) throw new UserError(`Too many wrong PINs. Wait ${Math.ceil((f.until - Date.now()) / 1000)} seconds and try again.`);

  const expected = Buffer.from(row.pin_hash, 'hex');
  const given = Buffer.from(hashPin(String(pin), row.pin_salt), 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    const count = (f && f.until <= Date.now() && f.count >= MAX_TRIES ? 0 : f?.count ?? 0) + 1;
    session.failures.set(row.id, { count, until: count >= MAX_TRIES ? Date.now() + LOCKOUT_MS : 0 });
    appendAudit(db, { id: row.id, name: row.name }, { action: 'Failed sign in', entity: 'access', entityId: row.id, summary: `Wrong PIN for ${row.name}${count >= MAX_TRIES ? ', locked for 30 seconds' : ''}` });
    throw new UserError(count >= MAX_TRIES ? `Too many wrong PINs. Wait ${LOCKOUT_MS / 1000} seconds and try again.` : 'That PIN is not right.');
  }
  session.failures.delete(row.id);
  session.user = { id: row.id, name: row.name, role: row.role };
  appendAudit(db, { id: row.id, name: row.name }, { action: 'Signed in', entity: 'access', entityId: row.id, summary: `${row.name} signed in` });
  return status(db, session);
}

export function logout(db: Db, session: SessionState): AccessStatus {
  const was = session.user;
  session.user = null;
  if (was && accessEnabled(db)) appendAudit(db, { id: was.id, name: was.name }, { action: 'Signed out', entity: 'access', entityId: was.id, summary: `${was.name} signed out` });
  return status(db, session);
}

// ── Users ───────────────────────────────────────────────────────────────────
function pinFields(pin: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: hashPin(pin, salt) };
}

/** Turns access control on. The first person is the owner, whose PIN protects everything from now on. The owner is signed in straight away. */
export function enable(db: Db, session: SessionState, ownerName: string, pin: string): AccessStatus {
  if (accessEnabled(db)) throw new UserError('Access control is already on.');
  const name = requireText(ownerName, 'Your name', 60);
  checkPin(pin);
  const id = newId();
  tx(db, () => {
    const { salt, hash } = pinFields(pin);
    run(db, 'INSERT INTO users (id, name, role, pin_salt, pin_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, name, 'owner', salt, hash, nowIso(), nowIso());
    setEnabled(db, true);
  });
  session.user = { id, name, role: 'owner' };
  appendAudit(db, { id, name }, { action: 'Turned on access control', entity: 'access', entityId: id, summary: `Turned on sign-in with PINs; ${name} is the owner` });
  return status(db, session);
}

/** Turns it off again. It needs the signed in owner's PIN, so someone who walks up to an open app cannot simply switch the lock off. */
export function disable(db: Db, session: SessionState, pin: string): AccessStatus {
  const me = session.user;
  if (!me || me.role !== 'owner') throw new UserError('Only the owner can turn access control off.');
  const row = get<UserRow>(db, 'SELECT * FROM users WHERE id = ?', me.id)!;
  if (hashPin(String(pin), row.pin_salt) !== row.pin_hash) throw new UserError('That PIN is not right.');
  setEnabled(db, false);
  session.user = null;
  appendAudit(db, { id: me.id, name: me.name }, { action: 'Turned off access control', entity: 'access', summary: `${me.name} turned off sign-in with PINs` });
  return status(db, session);
}

export function saveUser(db: Db, actor: Actor, id: string | null, input: AccessUserInput): AccessUser {
  if (!accessEnabled(db)) throw new UserError('Turn on access control first.');
  const name = requireText(input.name, 'Name', 60);
  if (!(ROLES as readonly string[]).includes(input.role)) throw new UserError('Choose a role.');
  const active = input.active !== false;
  if (id === null) {
    checkPin(input.pin);
    if (get(db, 'SELECT 1 AS x FROM users WHERE name = ? COLLATE NOCASE AND active = 1', name)) throw new UserError(`There is already someone called ${name}.`);
    const newUserId = newId();
    const { salt, hash } = pinFields(input.pin!);
    run(db, 'INSERT INTO users (id, name, role, pin_salt, pin_hash, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)', newUserId, name, input.role, salt, hash, nowIso(), nowIso());
    appendAudit(db, actor, { action: 'Added a person', entity: 'access', entityId: newUserId, summary: `Added ${name} as ${ROLE_LABEL[input.role]}` });
    return rowToUser(get<UserRow>(db, 'SELECT * FROM users WHERE id = ?', newUserId)!);
  }
  const current = get<UserRow>(db, 'SELECT * FROM users WHERE id = ?', id);
  if (!current) throw new UserError('That person no longer exists.');
  // Somebody has to be able to run the place: never demote or deactivate the last owner.
  if (current.role === 'owner' && (input.role !== 'owner' || !active) && activeOwners(db, id) === 0) throw new UserError('There must always be an owner. Make someone else an owner first.');
  if (active && get(db, 'SELECT 1 AS x FROM users WHERE name = ? COLLATE NOCASE AND active = 1 AND id != ?', name, id)) throw new UserError(`There is already someone called ${name}.`);
  let salt = current.pin_salt;
  let hash = current.pin_hash;
  if (input.pin) {
    checkPin(input.pin);
    ({ salt, hash } = pinFields(input.pin));
  }
  run(db, 'UPDATE users SET name = ?, role = ?, active = ?, pin_salt = ?, pin_hash = ?, updated_at = ? WHERE id = ?', name, input.role, active ? 1 : 0, salt, hash, nowIso(), id);
  const parts = [current.name !== name && `name ${current.name} to ${name}`, current.role !== input.role && `role ${ROLE_LABEL[current.role]} to ${ROLE_LABEL[input.role]}`, current.active === 1 !== active && (active ? 'reactivated' : 'deactivated'), input.pin && 'PIN changed'].filter(Boolean);
  appendAudit(db, actor, { action: 'Edited a person', entity: 'access', entityId: id, summary: `Edited ${current.name}${parts.length ? `: ${parts.join(', ')}` : ''}` });
  return rowToUser(get<UserRow>(db, 'SELECT * FROM users WHERE id = ?', id)!);
}

/** Anyone can change their own PIN, given the old one. */
export function changeOwnPin(db: Db, session: SessionState, oldPin: string, newPin: string): void {
  const me = session.user;
  if (!accessEnabled(db) || !me) throw new UserError('Sign in first.');
  const row = get<UserRow>(db, 'SELECT * FROM users WHERE id = ?', me.id)!;
  if (hashPin(String(oldPin), row.pin_salt) !== row.pin_hash) throw new UserError('Your current PIN is not right.');
  checkPin(newPin, 'new PIN');
  const { salt, hash } = pinFields(newPin);
  run(db, 'UPDATE users SET pin_salt = ?, pin_hash = ?, updated_at = ? WHERE id = ?', salt, hash, nowIso(), me.id);
  appendAudit(db, { id: me.id, name: me.name }, { action: 'Changed PIN', entity: 'access', entityId: me.id, summary: `${me.name} changed their PIN` });
}

// ── The gate ────────────────────────────────────────────────────────────────
/**
 * The API with roles enforced. With access control off it does nothing at all. With it on, a locked app refuses everything but signing
 * in, and each call needs a capability the signed in person's role has; counter staff also never receive cost or profit figures.
 */
export function withAccess(db: Db, api: Api, session: SessionState): Api {
  const wrapped: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const [method, fn] of Object.entries(api) as [string, (...args: unknown[]) => Promise<unknown>][]) {
    wrapped[method] = async (...args: unknown[]) => {
      if (!accessEnabled(db) || ALWAYS_ALLOWED.includes(method)) return fn(...args);
      const user = session.user;
      if (!user) throw new UserError(LOCKED_MESSAGE);
      if (!canDo(user.role, capabilityOf(method))) throw new UserError(`${user.name} (${ROLE_LABEL[user.role]}) doesn't have permission to do that. Ask the owner.`);
      const result = await fn(...args);
      return user.role === 'staff' ? redactCosts(result) : result;
    };
  }
  return wrapped as unknown as Api;
}
