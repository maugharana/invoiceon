import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi, type Host } from '../electron/api';
import {
  applyPendingRestore,
  backupBeforeRestore,
  backupNow,
  checkBackupFile,
  copyToFolder,
  hasPendingRestore,
  listBackups,
  loadBackupSettings,
  saveBackupSettings,
  stageRestore,
} from '../electron/backup';
import { runAutoBackup, driveContext } from '../electron/backupService';
import { openDb, type Db } from '../electron/db/connection';
import { LATEST_SCHEMA_VERSION } from '../electron/db/migrations';
import * as drive from '../electron/drive';
import * as customers from '../electron/services/customers';

const person = (name: string) => ({ name, type: 'B2C' as const, phone: '', email: '', gstin: '', address: '', city: '', state: '', pincode: '', notes: '' });
const names = (db: Db) => customers.listCustomers(db).map((c) => c.name).sort();

let dir: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'invoiceon-bk-'));
  db = openDb(join(dir, 'invoiceon.db'));
});
afterEach(() => {
  try {
    db.close();
  } catch {
    /* already closed by the test */
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('backup files', () => {
  it('tells the three kinds apart, and only the daily ones are not "manual"', () => {
    const backups = join(dir, 'backups');
    backupNow(db, backups);
    backupBeforeRestore(db, backups);
    writeFileSync(join(backups, 'invoiceon-2026-01-01.db'), 'x');
    writeFileSync(join(backups, 'notes.txt'), 'ignore me');
    const list = listBackups(backups);
    expect(list.map((b) => b.kind).sort()).toEqual(['before-restore', 'daily', 'manual']);
    expect(list.filter((b) => b.manual)).toHaveLength(2);
  });

  it('copies to an extra folder and keeps only the last two weeks of daily ones there', () => {
    const extra = join(dir, 'pen drive');
    mkdirSync(extra);
    for (let d = 1; d <= 16; d++) writeFileSync(join(extra, `invoiceon-2026-02-${String(d).padStart(2, '0')}.db`), 'old');
    const { name } = backupNow(db, join(dir, 'backups'));
    copyToFolder(join(dir, 'backups', name), extra);
    const left = readdirSync(extra);
    expect(left).toContain(name);
    expect(left.filter((f) => /^invoiceon-\d{4}/.test(f))).toHaveLength(14);
  });
});

describe('where else backups go', () => {
  it('starts with sensible defaults and remembers what was saved, outside the book', () => {
    expect(loadBackupSettings(dir)).toEqual({ extraFolder: '', extraAuto: true, driveAuto: true, keepDrive: 14 });
    const extra = join(dir, 'second');
    saveBackupSettings(dir, { extraFolder: extra, extraAuto: false, driveAuto: false, keepDrive: 30 });
    expect(loadBackupSettings(dir)).toEqual({ extraFolder: extra, extraAuto: false, driveAuto: false, keepDrive: 30 });
    expect(existsSync(extra)).toBe(true);
  });

  it('refuses a relative path, a silly count, and a folder it cannot write to', () => {
    const ok = { extraAuto: true, driveAuto: true, keepDrive: 14 };
    expect(() => saveBackupSettings(dir, { ...ok, extraFolder: 'backups' })).toThrow(/full folder path/);
    expect(() => saveBackupSettings(dir, { ...ok, extraFolder: '', keepDrive: 0 })).toThrow(/between 1 and 365/);
    // A file where a folder should be can't be written into.
    const file = join(dir, 'a-file');
    writeFileSync(file, 'x');
    expect(() => saveBackupSettings(dir, { ...ok, extraFolder: join(file, 'inside') })).toThrow(/can't write/);
  });

  it('"Back up now" keeps the local copy and says so when the extra folder fails', async () => {
    const api = createApi(db, undefined, dir);
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'x');
    saveBackupSettings(dir, { extraFolder: join(dir, 'ok'), extraAuto: true, driveAuto: true, keepDrive: 14 });
    // Break the folder after it was saved, as when a pen drive is pulled out.
    rmSync(join(dir, 'ok'), { recursive: true, force: true });
    writeFileSync(join(dir, 'ok'), 'now a file');
    const result = await api.backupNow();
    expect(result.done).toEqual(['Saved on this computer']);
    expect(result.problems[0]).toMatch(/Couldn't copy/);
    expect(existsSync(join(dir, 'backups', result.name))).toBe(true);
    expect((await api.dataInfo()).extraLast).toMatchObject({ ok: false });
  });
});

describe('checking a backup before using it', () => {
  it('accepts a real backup', () => {
    const { name } = backupNow(db, join(dir, 'backups'));
    expect(checkBackupFile(join(dir, 'backups', name)).version).toBe(LATEST_SCHEMA_VERSION);
  });

  it('refuses things that are not backups, with plain words', () => {
    const f = (n: string, body: string | Buffer) => {
      writeFileSync(join(dir, n), body);
      return join(dir, n);
    };
    expect(() => checkBackupFile(join(dir, 'missing.db'))).toThrow(/could not be found/);
    expect(() => checkBackupFile(f('tiny.db', 'hi'))).toThrow(/too small/);
    expect(() => checkBackupFile(f('text.db', 'x'.repeat(10_000)))).toThrow(/not an InvoiceOn backup/);
    // A real SQLite file that is somebody else's.
    const other = new DatabaseSync(join(dir, 'other.db'));
    other.exec('CREATE TABLE t (a); INSERT INTO t VALUES (1)');
    other.close();
    expect(() => checkBackupFile(join(dir, 'other.db'))).toThrow(/not an InvoiceOn backup/);
  });

  it('refuses a backup from a newer version of the app', () => {
    const { name } = backupNow(db, join(dir, 'backups'));
    const file = join(dir, 'backups', name);
    const edit = new DatabaseSync(file);
    edit.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 1}`);
    edit.close();
    expect(() => checkBackupFile(file)).toThrow(/newer InvoiceOn/);
  });

  it('refuses a damaged backup', () => {
    customers.createCustomer(db, person('Meena'));
    const { name } = backupNow(db, join(dir, 'backups'));
    const file = join(dir, 'backups', name);
    const bytes = readFileSync(file);
    for (let i = 4096; i < bytes.length; i += 97) bytes[i] = 0xff;
    writeFileSync(file, bytes);
    expect(() => checkBackupFile(file)).toThrow(/damaged|not an InvoiceOn/);
  });
});

describe('restoring', () => {
  it('puts the old book back on the next start, and keeps a copy of the book it replaced', () => {
    customers.createCustomer(db, person('Meena'));
    const { name } = backupNow(db, join(dir, 'backups'));
    customers.createCustomer(db, person('Sunita'));

    const { safetyCopy } = stageRestore(db, dir, join(dir, 'backups', name));
    expect(hasPendingRestore(dir)).toBe(true);
    // Nothing changes while the app is still running.
    expect(names(db)).toEqual(['Meena', 'Sunita']);
    db.close();

    expect(applyPendingRestore(dir)).toBe(true);
    expect(hasPendingRestore(dir)).toBe(false);
    const reopened = openDb(join(dir, 'invoiceon.db'));
    expect(names(reopened)).toEqual(['Meena']);
    reopened.close();

    // The book that was replaced is still there, in the backups folder, with Sunita in it.
    const kept = listBackups(join(dir, 'backups')).find((b) => b.name === safetyCopy)!;
    expect(kept.kind).toBe('before-restore');
    const safety = openDb(join(dir, 'backups', safetyCopy));
    expect(names(safety)).toEqual(['Meena', 'Sunita']);
    safety.close();
    db = openDb(join(dir, 'invoiceon.db'));
  });

  it('does nothing when no restore was prepared, and keeps the book when the prepared file turns out bad', () => {
    customers.createCustomer(db, person('Meena'));
    expect(applyPendingRestore(dir)).toBe(false);
    writeFileSync(join(dir, 'restore-pending.db'), 'x'.repeat(10_000));
    db.close();
    expect(applyPendingRestore(dir)).toBe(false);
    expect(hasPendingRestore(dir)).toBe(false);
    const reopened = openDb(join(dir, 'invoiceon.db'));
    expect(names(reopened)).toEqual(['Meena']);
    reopened.close();
    db = openDb(join(dir, 'invoiceon.db'));
  });

  it('stages nothing and changes nothing if the chosen file is not a backup', () => {
    writeFileSync(join(dir, 'junk.db'), 'x'.repeat(10_000));
    expect(() => stageRestore(db, dir, join(dir, 'junk.db'))).toThrow(/not an InvoiceOn backup/);
    expect(hasPendingRestore(dir)).toBe(false);
    expect(listBackups(join(dir, 'backups'))).toEqual([]);
  });

  it('through the API: restarts the app; refuses a name that is not a backup; is desktop-only without a host', async () => {
    customers.createCustomer(db, person('Meena'));
    let restarted = 0;
    const host = { restartApp: async () => void restarted++ } as unknown as Host;
    const api = createApi(db, host, dir);
    const { name } = await api.backupNow();
    await expect(api.backupRestore({ from: 'list', name: '../../secret.db' })).rejects.toThrow(/Choose a backup/);
    expect(await api.backupRestore({ from: 'list', name })).toMatchObject({ started: true });
    expect(restarted).toBe(1);
    expect((await api.dataInfo()).restorePending).toBe(true);
    await api.backupRestoreCancel();
    expect((await api.dataInfo()).restorePending).toBe(false);
    await expect(createApi(db, undefined, dir).backupRestore({ from: 'list', name })).rejects.toThrow(/desktop app/);
  });

  it('"from a file" does nothing if the person cancels the file picker', async () => {
    const api = createApi(db, { restartApp: async () => undefined, pickFile: async () => null } as unknown as Host, dir);
    expect(await api.backupRestore({ from: 'file' })).toEqual({ started: false });
  });
});

// -----------------------------------------------------------------------------------------------------------------------
// A stand-in for Google, good enough to exercise sign-in, upload, listing, download, delete and the error cases.

const G = 'https://fake.google';
const endpoints = { auth: `${G}/auth`, token: `${G}/token`, revoke: `${G}/revoke`, api: `${G}/drive/v3`, upload: `${G}/upload/drive/v3` };

function fakeGoogle() {
  const files = new Map<string, { id: string; name: string; parent: string; bytes: Buffer; created: string }>();
  const folders = new Map<string, string>();
  const state = { challenge: '', calls: [] as string[], refreshToken: 'rt-1', failWith: null as null | { status: number; body: unknown }, revoked: false, offline: false, n: 0, quota: false };
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    if (state.offline) throw new TypeError('fetch failed');
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    state.calls.push(`${method} ${url.pathname}`);
    if (state.failWith) return json(state.failWith.body, state.failWith.status);

    if (url.href.startsWith(endpoints.revoke)) {
      state.revoked = true;
      return json({});
    }
    if (url.href === endpoints.token) {
      const body = new URLSearchParams(String(init.body));
      if (body.get('grant_type') === 'authorization_code') {
        const ok = body.get('code') === 'good-code' && createHash('sha256').update(body.get('code_verifier')!).digest('base64url') === state.challenge;
        return ok ? json({ access_token: 'at-1', refresh_token: state.refreshToken, expires_in: 3600 }) : json({ error: 'invalid_grant' }, 400);
      }
      return body.get('refresh_token') === state.refreshToken ? json({ access_token: 'at-2', expires_in: 3600 }) : json({ error: 'invalid_grant' }, 400);
    }
    const auth = new Headers(init.headers).get('Authorization');
    if (!auth?.startsWith('Bearer at-') && !url.pathname.startsWith('/session/')) return json({ error: { message: 'no token' } }, 401);

    if (url.pathname === '/drive/v3/about') return json({ user: { emailAddress: 'owner@example.com' } });
    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      if (q.includes('vnd.google-apps.folder')) {
        const id = [...folders.keys()][0];
        return json({ files: id ? [{ id }] : [] });
      }
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const list = [...files.values()].filter((f) => f.parent === parent).sort((a, b) => b.created.localeCompare(a.created));
      return json({ files: list.map((f) => ({ id: f.id, name: f.name, size: String(f.bytes.length), createdTime: f.created })) });
    }
    if (url.pathname === '/drive/v3/files' && method === 'POST') {
      const id = `folder-${++state.n}`;
      folders.set(id, JSON.parse(String(init.body)).name);
      return json({ id });
    }
    if (url.pathname === '/upload/drive/v3/files') {
      if (state.quota) return json({ error: { message: 'full', errors: [{ reason: 'storageQuotaExceeded' }] } }, 403);
      const meta = JSON.parse(String(init.body)) as { name: string; parents: string[] };
      const id = `file-${++state.n}`;
      files.set(id, { id, name: meta.name, parent: meta.parents[0]!, bytes: Buffer.alloc(0), created: new Date(Date.UTC(2026, 0, 1, 0, 0, state.n)).toISOString() });
      return new Response('{}', { status: 200, headers: { Location: `${G}/session/${id}` } });
    }
    if (url.pathname.startsWith('/session/')) {
      const f = files.get(url.pathname.slice(9))!;
      f.bytes = Buffer.from(init.body as Buffer);
      return json({ id: f.id });
    }
    const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (one) {
      const f = files.get(one[1]!);
      if (!f) return json({ error: { message: 'not found' } }, 404);
      if (method === 'DELETE') {
        files.delete(f.id);
        return new Response(null, { status: 204 });
      }
      return new Response(new Uint8Array(f.bytes));
    }
    return json({ error: { message: `unexpected ${method} ${url.pathname}` } }, 500);
  }) as typeof fetch;

  return { fetch: fetchImpl, files, folders, state };
}

/** Plays the part of the person's browser: opens the address InvoiceOn asked for and approves (or not). */
async function approve(authUrl: string, google: ReturnType<typeof fakeGoogle>, outcome: 'allow' | 'deny' | 'forged' = 'allow') {
  const u = new URL(authUrl);
  google.state.challenge = u.searchParams.get('code_challenge')!;
  const back = new URL(u.searchParams.get('redirect_uri')!);
  if (outcome === 'allow') back.searchParams.set('code', 'good-code');
  else if (outcome === 'deny') back.searchParams.set('error', 'access_denied');
  back.searchParams.set('state', outcome === 'forged' ? 'not-the-state' : u.searchParams.get('state')!);
  return (await fetch(back)).text();
}

describe('Google Drive', () => {
  let google: ReturnType<typeof fakeGoogle>;
  let ctx: drive.DriveContext;
  beforeEach(() => {
    google = fakeGoogle();
    ctx = driveContext(dir, undefined, { fetch: google.fetch, endpoints });
    drive.saveCredentials(ctx, { clientId: '12345-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-secret' });
  });
  const signIn = async () => {
    const { authUrl } = await drive.startSignIn(ctx);
    await approve(authUrl, google);
    await drive.waitForSignIn(ctx);
  };

  it('needs a client ID and secret before anything else, and checks their shape', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'invoiceon-bk-'));
    const c = driveContext(bare, undefined, { fetch: google.fetch, endpoints });
    expect(drive.driveStatus(c, null)).toMatchObject({ configured: false, connected: false });
    await expect(drive.startSignIn(c)).rejects.toThrow(/client ID and secret first/);
    expect(() => drive.saveCredentials(c, { clientId: '', clientSecret: 'x' })).toThrow(/Paste the client ID/);
    expect(() => drive.saveCredentials(c, { clientId: 'nonsense', clientSecret: 'x' })).toThrow(/does not look like a client ID/);
    expect(() => drive.saveCredentials(c, { clientId: 'a.apps.googleusercontent.com', clientSecret: '' })).toThrow(/client secret/);
    rmSync(bare, { recursive: true, force: true });
  });

  it('keeps the secret and the sign-in token out of the file in plain text when the vault encrypts', () => {
    const lock: drive.Vault = { encrypt: (s) => `enc:${Buffer.from(s).reverse().toString('base64')}`, decrypt: (s) => Buffer.from(s.slice(4), 'base64').reverse().toString() };
    const c = driveContext(dir, lock, { fetch: google.fetch, endpoints });
    drive.saveCredentials(c, { clientId: 'x.apps.googleusercontent.com', clientSecret: 'GOCSPX-very-secret' });
    expect(readFileSync(join(dir, 'google-drive.json'), 'utf8')).not.toContain('very-secret');
  });

  it('signs in with a one-time code checked against the PKCE challenge, and remembers who', async () => {
    const { authUrl } = await drive.startSignIn(ctx);
    const u = new URL(authUrl);
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(new URL(u.searchParams.get('redirect_uri')!).hostname).toBe('127.0.0.1');
    expect(await approve(authUrl, google)).toContain('Connected');
    await drive.waitForSignIn(ctx);
    expect(drive.driveStatus(ctx, null)).toMatchObject({ configured: true, connected: true, account: 'owner@example.com' });
    // Neither file on disk shows the token or secret in plain words.
    expect(readFileSync(join(dir, 'google-drive.json'), 'utf8')).not.toContain('rt-1');
  });

  it('is not fooled by a sign-in it did not start, and reports a refusal', async () => {
    const first = await drive.startSignIn(ctx);
    expect(await approve(first.authUrl, google, 'forged')).toContain('did not work');
    expect(drive.driveStatus(ctx, null).connected).toBe(false);
    await approve(first.authUrl, google, 'deny');
    await expect(drive.waitForSignIn(ctx)).rejects.toThrow(/cancelled/);
    expect(drive.driveStatus(ctx, null).connected).toBe(false);
    await expect(drive.waitForSignIn(ctx)).rejects.toThrow(/No Google sign-in is in progress/);
  });

  it('a second Connect press replaces the first rather than leaving two waiting', async () => {
    const first = await drive.startSignIn(ctx);
    const waiting = drive.waitForSignIn(ctx);
    waiting.catch(() => undefined);
    await drive.startSignIn(ctx);
    await expect(waiting).rejects.toThrow(/replaced/);
    expect(first.authUrl).toContain('code_challenge');
  });

  it('creates its folder once, uploads, lists newest first and downloads the same bytes', async () => {
    await signIn();
    expect(await drive.listDriveBackups(ctx)).toEqual([]); // no folder yet, and listing doesn't make one
    expect(google.folders.size).toBe(0);
    const { name } = backupNow(db, join(dir, 'backups'));
    const file = join(dir, 'backups', name);
    await drive.uploadBackup(ctx, file, 'invoiceon-2026-03-01.db');
    await drive.uploadBackup(ctx, file, 'invoiceon-2026-03-02.db');
    expect([...google.folders.values()]).toEqual([drive.DRIVE_FOLDER]);
    const list = await drive.listDriveBackups(ctx);
    expect(list.map((b) => b.name)).toEqual(['invoiceon-2026-03-02.db', 'invoiceon-2026-03-01.db']);
    expect(list[0]).toMatchObject({ manual: false, bytes: readFileSync(file).length });
    const dest = join(dir, 'down.db');
    await drive.downloadBackup(ctx, list[0]!.id, dest);
    expect(readFileSync(dest).equals(readFileSync(file))).toBe(true);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it('removes only the oldest automatic backups, never the ones made by hand', async () => {
    await signIn();
    const { name } = backupNow(db, join(dir, 'backups'));
    const file = join(dir, 'backups', name);
    for (const n of ['invoiceon-2026-03-01.db', 'invoiceon-manual-2026-03-01-101010.db', 'invoiceon-2026-03-02.db', 'invoiceon-2026-03-03.db']) await drive.uploadBackup(ctx, file, n);
    expect(await drive.pruneDriveBackups(ctx, 2)).toBe(1);
    expect((await drive.listDriveBackups(ctx)).map((b) => b.name).sort()).toEqual(['invoiceon-2026-03-02.db', 'invoiceon-2026-03-03.db', 'invoiceon-manual-2026-03-01-101010.db']);
  });

  it('refreshes quietly, and when Google revokes the sign-in it says so and signs out', async () => {
    await signIn();
    drive.clearTokenCache(); // the app was closed and opened again
    expect(await drive.listDriveBackups(ctx)).toEqual([]);
    expect(google.state.calls.filter((c) => c === 'POST /token')).toHaveLength(2); // sign-in, then one refresh

    google.state.refreshToken = 'rt-changed'; // the owner removed InvoiceOn in their Google account
    drive.clearTokenCache();
    await expect(drive.listDriveBackups(ctx)).rejects.toThrow(/signed InvoiceOn out/);
    expect(drive.driveStatus(ctx, null)).toMatchObject({ configured: true, connected: false });
  });

  it('explains common Google problems in plain words', async () => {
    await signIn();
    const { name } = backupNow(db, join(dir, 'backups'));
    const file = join(dir, 'backups', name);
    google.state.quota = true;
    await expect(drive.uploadBackup(ctx, file, 'a.db')).rejects.toThrow(/Drive is full/);
    google.state.quota = false;
    google.state.failWith = { status: 403, body: { error: { message: 'Google Drive API has not been used in project 1 before or it is disabled', errors: [{ reason: 'accessNotConfigured' }] } } };
    await expect(drive.listDriveBackups(ctx)).rejects.toThrow(/Drive API is not turned on/);
    google.state.failWith = { status: 503, body: {} };
    await expect(drive.listDriveBackups(ctx)).rejects.toThrow(/busy/);
    google.state.failWith = null;
    google.state.offline = true;
    await expect(drive.listDriveBackups(ctx)).rejects.toThrow(/Couldn't reach Google/);
  });

  it('signs out here and at Google; forgetting also deletes the saved client ID', async () => {
    await signIn();
    await drive.signOut(ctx);
    expect(google.state.revoked).toBe(true);
    expect(drive.driveStatus(ctx, null)).toMatchObject({ configured: true, connected: false, account: '' });
    await expect(drive.listDriveBackups(ctx)).rejects.toThrow(/Not connected/);
    await drive.forgetAll(ctx);
    expect(drive.driveStatus(ctx, null).configured).toBe(false);
  });

  it('changing the client ID drops the old sign-in, but re-saving the same one does not', async () => {
    await signIn();
    drive.saveCredentials(ctx, { clientId: '12345-abc.apps.googleusercontent.com', clientSecret: '' });
    expect(drive.driveStatus(ctx, null).connected).toBe(true);
    drive.saveCredentials(ctx, { clientId: '99999-zzz.apps.googleusercontent.com', clientSecret: 'other' });
    expect(drive.driveStatus(ctx, null).connected).toBe(false);
  });
});

describe('automatic daily backups', () => {
  it('copies each day to the extra folder and to Drive, once a day, and notes the outcome', async () => {
    const google = fakeGoogle();
    const ctx = driveContext(dir, undefined, { fetch: google.fetch, endpoints });
    drive.saveCredentials(ctx, { clientId: '1-a.apps.googleusercontent.com', clientSecret: 's' });
    const { authUrl } = await drive.startSignIn(ctx);
    await approve(authUrl, google);
    await drive.waitForSignIn(ctx);
    const extra = join(dir, 'pen drive');
    saveBackupSettings(dir, { extraFolder: extra, extraAuto: true, driveAuto: true, keepDrive: 14 });

    const first = await runAutoBackup(db, ctx);
    expect(first!.problems).toEqual([]);
    expect(first!.done).toEqual(['Copied to ' + extra, 'Uploaded to Google Drive']);
    expect(readdirSync(extra)).toEqual([first!.name]);
    expect(google.files.size).toBe(1);

    // Opening the app again the same day must not upload again.
    const second = await runAutoBackup(db, ctx);
    expect(second!.done).toContain('Already in Google Drive today');
    expect(google.files.size).toBe(1);

    const api = createApi(db, undefined, dir, { fetch: google.fetch, endpoints });
    const info = await api.dataInfo();
    expect(info.drive).toMatchObject({ connected: true, account: 'owner@example.com', last: { ok: true } });
    expect(info.extraLast).toMatchObject({ ok: true });
  });

  it('turned off means off, and a Drive failure never stops the local backup', async () => {
    const google = fakeGoogle();
    const ctx = driveContext(dir, undefined, { fetch: google.fetch, endpoints });
    drive.saveCredentials(ctx, { clientId: '1-a.apps.googleusercontent.com', clientSecret: 's' });
    const { authUrl } = await drive.startSignIn(ctx);
    await approve(authUrl, google);
    await drive.waitForSignIn(ctx);
    saveBackupSettings(dir, { extraFolder: '', extraAuto: true, driveAuto: false, keepDrive: 14 });
    const off = await runAutoBackup(db, ctx);
    expect(off!.done).toEqual([]);
    expect(google.files.size).toBe(0);

    rmSync(join(dir, 'backups'), { recursive: true });
    saveBackupSettings(dir, { extraFolder: '', extraAuto: true, driveAuto: true, keepDrive: 14 });
    google.state.offline = true;
    const failed = await runAutoBackup(db, ctx);
    expect(failed!.problems[0]).toMatch(/Couldn't reach Google/);
    expect(existsSync(join(dir, 'backups', failed!.name))).toBe(true);
    expect(drive.driveStatus(ctx, null).connected).toBe(true); // being offline is not being signed out
  });
});
