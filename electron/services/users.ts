import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { AppUser, UserInput, UserRole } from '../../shared/types';
import { USER_ROLES } from '../../shared/types';
import { all, get, run, type Db } from '../db/connection';
import { newId, nowIso, requireText, UserError } from './common';

interface Row {
  id: string;
  name: string;
  role: UserRole;
  pin_salt: string;
  pin_hash: string;
  active: number;
}

const toUser = (r: Row): AppUser => ({ id: r.id, name: r.name, role: r.role, active: r.active === 1 });
const hash = (pin: string, salt: string): string => scryptSync(pin, salt, 32).toString('hex');

function checkPin(pin: unknown): string {
  const p = typeof pin === 'string' ? pin.trim() : '';
  if (!/^\d{4,8}$/.test(p)) throw new UserError('The PIN should be 4 to 8 digits.');
  return p;
}

function row(db: Db, id: string): Row {
  const r = get<Row>(db, 'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', String(id));
  if (!r) throw new UserError('That person was not found.');
  return r;
}

export const listUsers = (db: Db): AppUser[] => all<Row>(db, 'SELECT * FROM users WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE').map(toUser);

/** Signing in is switched on once there is an owner who can. Before that the book opens as it always did. */
export function authEnabled(db: Db): boolean {
  return (get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1 AND deleted_at IS NULL")?.n ?? 0) > 0;
}

export function getUser(db: Db, id: string): AppUser | null {
  const r = get<Row>(db, 'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', id);
  return r ? toUser(r) : null;
}

function otherActiveOwners(db: Db, exceptId: string): number {
  return get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1 AND deleted_at IS NULL AND id <> ?", exceptId)?.n ?? 0;
}

function checkName(db: Db, name: unknown, exceptId = ''): string {
  const n = requireText(name, 'Name', 60);
  const clash = get<{ id: string }>(db, 'SELECT id FROM users WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL AND id <> ?', n, exceptId);
  if (clash) throw new UserError(`There is already someone called ${n}.`);
  return n;
}

export function createUser(db: Db, input: UserInput): AppUser {
  const name = checkName(db, input?.name);
  if (!USER_ROLES.includes(input?.role)) throw new UserError('Choose Owner or Staff.');
  const pin = checkPin(input.pin);
  const salt = randomBytes(16).toString('hex');
  const id = newId();
  const now = nowIso();
  run(db, 'INSERT INTO users (id, name, role, pin_salt, pin_hash, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)', id, name, input.role, salt, hash(pin, salt), now, now);
  return toUser(row(db, id));
}

export function updateUser(db: Db, id: string, patch: { name?: string; role?: UserRole; active?: boolean }): AppUser {
  const r = row(db, id);
  const name = patch.name === undefined ? r.name : checkName(db, patch.name, id);
  const role = patch.role === undefined ? r.role : patch.role;
  if (!USER_ROLES.includes(role)) throw new UserError('Choose Owner or Staff.');
  const active = patch.active === undefined ? r.active === 1 : patch.active === true;
  const stillOwner = role === 'owner' && active;
  if (r.role === 'owner' && r.active === 1 && !stillOwner && otherActiveOwners(db, id) === 0) throw new UserError('There must be at least one active owner. Add another owner first.');
  run(db, 'UPDATE users SET name = ?, role = ?, active = ?, updated_at = ? WHERE id = ?', name, role, active ? 1 : 0, nowIso(), id);
  return toUser(row(db, id));
}

export function setPin(db: Db, id: string, pin: string): AppUser {
  const r = row(db, id);
  const salt = randomBytes(16).toString('hex');
  run(db, 'UPDATE users SET pin_salt = ?, pin_hash = ?, updated_at = ? WHERE id = ?', salt, hash(checkPin(pin), salt), nowIso(), r.id);
  failures.delete(id);
  return toUser(row(db, id));
}

export function removeUser(db: Db, id: string): void {
  const r = row(db, id);
  if (r.role === 'owner' && r.active === 1 && otherActiveOwners(db, id) === 0) throw new UserError('There must be at least one active owner. Add another owner first.');
  run(db, 'UPDATE users SET deleted_at = ?, active = 0 WHERE id = ?', nowIso(), id);
}

// A PIN is short, so guessing is slowed down: five wrong tries in a row and that person is locked out for a minute.
const failures = new Map<string, { count: number; until: number }>();
export const MAX_TRIES = 5;
export const LOCK_MS = 60_000;

/** Checks a PIN. `now` is only passed by the tests. */
export function checkLogin(db: Db, id: string, pin: string, now = Date.now()): AppUser {
  const f = failures.get(id);
  if (f && f.until > now) throw new UserError(`Too many wrong PINs. Try again in ${Math.ceil((f.until - now) / 1000)} seconds.`);
  const r = get<Row>(db, 'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', String(id));
  const ok = r && r.active === 1 && typeof pin === 'string' && timingSafeEqual(Buffer.from(hash(pin.trim(), r.pin_salt), 'hex'), Buffer.from(r.pin_hash, 'hex'));
  if (!ok) {
    const count = (f && f.until <= now && f.count >= MAX_TRIES ? 0 : f?.count ?? 0) + 1;
    failures.set(id, { count, until: count >= MAX_TRIES ? now + LOCK_MS : 0 });
    throw new UserError(count >= MAX_TRIES ? 'Too many wrong PINs. Try again in a minute.' : 'That PIN is not right.');
  }
  failures.delete(id);
  return toUser(r);
}

/** Calls only an owner may make. Everything else is open to staff once they have signed in. */
export const OWNER_ONLY = new Set([
  'saveSettings', 'auditList', 'dataExportAll', 'exportSaveZip', 'sampleDataLoad',
  'backupNow', 'backupSettingsSave', 'backupSaveCopy', 'backupPickFolder', 'backupRestore', 'backupRestoreCancel',
  'driveSaveCredentials', 'driveConnectStart', 'driveConnectWait', 'driveDisconnect', 'driveBackups', 'driveDeleteBackup',
  'usersList', 'userCreate', 'userUpdate', 'userSetPin', 'userRemove',
  'catalogueRename', 'catalogueDelete', 'designsTidy', 'designsBulk', 'designArchive', 'customerMerge', 'customersImport', 'customerArchive',
  'invoiceCancel', 'creditNoteCancel', 'paymentVoid', 'paymentWriteOff', 'weaverOrderCancel', 'weaverPaymentVoid', 'purchaseDelete', 'expenseDelete', 'transferDelete',
  'reportProfitLoss', 'reportMargin', 'reportMarginDrill', 'reportGst', 'reportGstr1', 'reportPurchases', 'gstNet', 'accountBook',
  // Money handed out, points given, stock written off or recounted, and money moved between accounts.
  'creditNoteRefund', 'weaverOrderPay', 'transferCreate', 'loyaltyAdjust', 'stockAdjust', 'stockTakeApply',
]);

/** Always open, so a person can sign in. */
export const OPEN_CALLS = new Set(['sessionState', 'sessionLogin', 'sessionLogout']);
