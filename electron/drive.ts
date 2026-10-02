import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import type { DriveBackup, DriveStatus } from '../shared/types';
import { UserError } from './services/common';

/**
 * Google Drive, for backups only. InvoiceOn signs in the way any desktop program does (the browser opens, you approve, the browser
 * hands back a code on this computer). It asks for the narrowest Drive permission there is, "drive.file": the app can see only
 * files it made itself, never the rest of your Drive.
 *
 * The Google Cloud client ID and secret are the owner's own (made in their Google Cloud console), kept with the sign-in in a file
 * beside the book, with the secret and the sign-in token encrypted by Windows when running as the desktop app.
 */

export interface Vault {
  encrypt(plain: string): string;
  decrypt(stored: string): string;
}

/** Used when the operating system's encryption isn't available (the browser preview). Hides the text, does not protect it. */
export const plainVault: Vault = {
  encrypt: (plain) => `plain:${Buffer.from(plain, 'utf8').toString('base64')}`,
  decrypt: (stored) => (stored.startsWith('plain:') ? Buffer.from(stored.slice(6), 'base64').toString('utf8') : ''),
};

export interface DriveContext {
  /** The data folder: the config file lives here. */
  dir: string;
  vault: Vault;
  /** Replaceable in tests. */
  fetch?: typeof fetch;
  /** Replaceable in tests. */
  endpoints?: Partial<Endpoints>;
}

interface Endpoints {
  auth: string;
  token: string;
  revoke: string;
  api: string;
  upload: string;
}

const REAL: Endpoints = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  api: 'https://www.googleapis.com/drive/v3',
  upload: 'https://www.googleapis.com/upload/drive/v3',
};
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_FOLDER = 'InvoiceOn backups';
const CONFIG_FILE = 'google-drive.json';
const SIGN_IN_WAIT_MS = 5 * 60 * 1000;

const ep = (ctx: DriveContext): Endpoints => ({ ...REAL, ...ctx.endpoints });
const doFetch = (ctx: DriveContext) => ctx.fetch ?? fetch;

interface Config {
  clientId: string;
  clientSecret: string; // encrypted
  refreshToken: string; // encrypted, empty when signed out
  account: string;
}

function readConfig(dir: string): Config {
  try {
    const c = JSON.parse(readFileSync(join(dir, CONFIG_FILE), 'utf8')) as Partial<Config>;
    return { clientId: c.clientId ?? '', clientSecret: c.clientSecret ?? '', refreshToken: c.refreshToken ?? '', account: c.account ?? '' };
  } catch {
    return { clientId: '', clientSecret: '', refreshToken: '', account: '' };
  }
}

function writeConfig(dir: string, c: Config): void {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `${CONFIG_FILE}.tmp`);
  writeFileSync(tmp, JSON.stringify(c, null, 2), 'utf8');
  renameSync(tmp, join(dir, CONFIG_FILE));
}

const tokenCache = new Map<string, { token: string; expires: number }>();

/** Forgets any access token held in memory, as happens when the app is closed and opened again. */
export const clearTokenCache = (): void => tokenCache.clear();

export function driveStatus(ctx: DriveContext, last: DriveStatus['last']): DriveStatus {
  const c = readConfig(ctx.dir);
  return { configured: !!(c.clientId && c.clientSecret), connected: !!c.refreshToken, account: c.account, clientId: c.clientId, last };
}

export function saveCredentials(ctx: DriveContext, input: { clientId: string; clientSecret: string }): void {
  const clientId = String(input.clientId ?? '').trim();
  const clientSecret = String(input.clientSecret ?? '').trim();
  if (!clientId) throw new UserError('Paste the client ID from Google Cloud.');
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new UserError('That does not look like a client ID. It ends in .apps.googleusercontent.com.');
  const old = readConfig(ctx.dir);
  // Leaving the secret box empty keeps the one already saved, so the ID can be corrected without retyping it.
  if (!clientSecret && !old.clientSecret) throw new UserError('Paste the client secret from Google Cloud.');
  const sameApp = old.clientId === clientId && (!clientSecret || ctx.vault.decrypt(old.clientSecret) === clientSecret);
  writeConfig(ctx.dir, {
    clientId,
    clientSecret: clientSecret ? ctx.vault.encrypt(clientSecret) : old.clientSecret,
    // A different Google app can't use the old sign-in.
    refreshToken: sameApp ? old.refreshToken : '',
    account: sameApp ? old.account : '',
  });
  tokenCache.delete(ctx.dir);
}

function secrets(ctx: DriveContext): { clientId: string; clientSecret: string } {
  const c = readConfig(ctx.dir);
  if (!c.clientId || !c.clientSecret) throw new UserError('Add your Google client ID and secret first (Settings > Backup & Restore).');
  return { clientId: c.clientId, clientSecret: ctx.vault.decrypt(c.clientSecret) };
}

/** One request to Google with failures turned into sentences a shop owner can act on. */
async function call(ctx: DriveContext, url: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await doFetch(ctx)(url, init);
  } catch {
    throw new UserError("Couldn't reach Google. Check the internet connection and try again.");
  }
  if (res.ok) return res;
  let detail = '';
  let reason = '';
  try {
    const body = (await res.json()) as { error?: string | { message?: string; errors?: { reason?: string }[] }; error_description?: string };
    if (typeof body.error === 'string') {
      reason = body.error;
      detail = body.error_description ?? body.error;
    } else {
      detail = body.error?.message ?? '';
      reason = body.error?.errors?.[0]?.reason ?? '';
    }
  } catch {
    /* no readable body */
  }
  if (reason === 'invalid_grant') {
    const c = readConfig(ctx.dir);
    writeConfig(ctx.dir, { ...c, refreshToken: '', account: '' });
    tokenCache.delete(ctx.dir);
    throw new UserError('Google has signed InvoiceOn out. Connect to Google Drive again. (If it keeps happening, publish the app in Google Cloud so sign-ins stop expiring after 7 days.)');
  }
  if (reason === 'invalid_client' || reason === 'unauthorized_client') throw new UserError('Google did not accept the client ID or secret. Check them in Google Cloud and enter them again.');
  if (reason === 'accessNotConfigured' || /has not been used|is disabled/i.test(detail)) throw new UserError('The Google Drive API is not turned on for your Google Cloud project. Enable "Google Drive API" there, wait a minute, and try again.');
  if (reason === 'storageQuotaExceeded' || reason === 'quotaExceeded') throw new UserError('Your Google Drive is full. Free some space and try again.');
  if (res.status === 401) throw new UserError('Google refused the sign-in. Connect to Google Drive again.');
  if (res.status === 403) throw new UserError(`Google said no${detail ? `: ${detail}` : '.'}`);
  if (res.status === 429 || res.status >= 500) throw new UserError('Google is busy right now. Try again in a few minutes.');
  throw new UserError(`Google Drive reported a problem${detail ? `: ${detail}` : ` (${res.status}).`}`);
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ---------------------------------------------------------------------------------------------------------------------
// Signing in

interface Pending {
  authUrl: string;
  done: Promise<void>;
  cancel: () => void;
}
const pending = new Map<string, Pending>();

/**
 * Starts the sign-in: listens on this computer only, and returns the Google address to open in the browser. `wait()` then
 * resolves when the person has approved (or rejects if they decline or take longer than five minutes).
 */
export async function startSignIn(ctx: DriveContext): Promise<{ authUrl: string }> {
  const { clientId, clientSecret } = secrets(ctx);
  pending.get(ctx.dir)?.cancel();

  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));
  let server: Server | undefined;
  let finish!: (err?: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    finish = (err) => (err ? reject(err) : resolve());
  });
  // The rejection is read by wait(); if nobody ever waits, don't let it surface as an unhandled error.
  done.catch(() => undefined);

  const port = await new Promise<number>((resolve, reject) => {
    server = createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/') {
          res.writeHead(404).end();
          return;
        }
        const reply = (title: string, text: string) => {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!doctype html><meta charset="utf-8"><title>InvoiceOn</title><body style="font:16px system-ui;max-width:32rem;margin:4rem auto;color:#1A1D1B"><h2 style="font-weight:500">${title}</h2><p>${text}</p>`);
        };
        if (url.searchParams.get('state') !== state) {
          reply('That did not work', 'This sign-in was not started by InvoiceOn. Close this tab and try again from InvoiceOn.');
          return;
        }
        const code = url.searchParams.get('code');
        if (!code) {
          reply('Not connected', 'Google Drive was not connected. You can close this tab and go back to InvoiceOn.');
          finish(new UserError('Google sign-in was cancelled.'));
          return;
        }
        try {
          const redirect = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
          const res2 = await call(ctx, ep(ctx).token, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, redirect_uri: redirect, grant_type: 'authorization_code' }),
          });
          const tok = (await res2.json()) as { refresh_token?: string; access_token?: string; expires_in?: number };
          if (!tok.refresh_token || !tok.access_token) throw new UserError('Google did not allow InvoiceOn to stay connected. Remove InvoiceOn from your Google account permissions and connect again.');
          tokenCache.set(ctx.dir, { token: tok.access_token, expires: Date.now() + (tok.expires_in ?? 3600) * 1000 - 60_000 });
          const info = await call(ctx, `${ep(ctx).api}/about?fields=user(emailAddress)`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
          const account = ((await info.json()) as { user?: { emailAddress?: string } }).user?.emailAddress ?? '';
          writeConfig(ctx.dir, { ...readConfig(ctx.dir), refreshToken: ctx.vault.encrypt(tok.refresh_token), account });
          reply('Connected', 'InvoiceOn is now connected to your Google Drive. You can close this tab and go back to InvoiceOn.');
          finish();
        } catch (err) {
          reply('Not connected', 'Something went wrong. Go back to InvoiceOn to see what.');
          finish(err instanceof Error ? err : new Error(String(err)));
        }
      })();
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve((server!.address() as { port: number }).port));
  });

  const timer = setTimeout(() => finish(new UserError('Google sign-in took too long. Try again.')), SIGN_IN_WAIT_MS);
  const cleanup = () => {
    clearTimeout(timer);
    server?.close();
    server?.closeAllConnections();
  };
  const doneWrapped = done.finally(cleanup);
  doneWrapped.catch(() => undefined);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `http://127.0.0.1:${port}`,
    response_type: 'code',
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });
  const authUrl = `${ep(ctx).auth}?${params}`;
  pending.set(ctx.dir, { authUrl, done: doneWrapped, cancel: () => finish(new UserError('Google sign-in was replaced by a newer one.')) });
  return { authUrl };
}

/** Resolves once the sign-in started by `startSignIn` finishes. */
export async function waitForSignIn(ctx: DriveContext): Promise<void> {
  const p = pending.get(ctx.dir);
  if (!p) throw new UserError('No Google sign-in is in progress. Press Connect again.');
  try {
    await p.done;
  } finally {
    // The outcome is kept until it has been asked for, so it can't be missed if the browser finishes first.
    if (pending.get(ctx.dir) === p) pending.delete(ctx.dir);
  }
}

export async function signOut(ctx: DriveContext): Promise<void> {
  pending.get(ctx.dir)?.cancel();
  const c = readConfig(ctx.dir);
  tokenCache.delete(ctx.dir);
  writeConfig(ctx.dir, { ...c, refreshToken: '', account: '' });
  if (c.refreshToken) {
    // Best effort: tell Google too, so the permission disappears from the account. Failing to is harmless.
    try {
      await doFetch(ctx)(`${ep(ctx).revoke}?token=${encodeURIComponent(ctx.vault.decrypt(c.refreshToken))}`, { method: 'POST' });
    } catch {
      /* offline: the local sign-out already happened */
    }
  }
}

/** Forgets the client ID and secret as well as the sign-in. */
export async function forgetAll(ctx: DriveContext): Promise<void> {
  await signOut(ctx);
  rmSync(join(ctx.dir, CONFIG_FILE), { force: true });
}

async function accessToken(ctx: DriveContext): Promise<string> {
  const cached = tokenCache.get(ctx.dir);
  if (cached && cached.expires > Date.now()) return cached.token;
  const c = readConfig(ctx.dir);
  if (!c.refreshToken) throw new UserError('Not connected to Google Drive. Connect it in Settings > Backup & Restore first.');
  const { clientId, clientSecret } = secrets(ctx);
  const res = await call(ctx, ep(ctx).token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: ctx.vault.decrypt(c.refreshToken), grant_type: 'refresh_token' }),
  });
  const tok = (await res.json()) as { access_token: string; expires_in?: number };
  tokenCache.set(ctx.dir, { token: tok.access_token, expires: Date.now() + (tok.expires_in ?? 3600) * 1000 - 60_000 });
  return tok.access_token;
}

async function authed(ctx: DriveContext, url: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken(ctx);
  return call(ctx, url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` } });
}

// ---------------------------------------------------------------------------------------------------------------------
// Backups in Drive

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** The "InvoiceOn backups" folder, made on first use. Under drive.file only folders this app made are visible, so there is no mix-up. */
async function backupFolder(ctx: DriveContext, create: boolean): Promise<string | null> {
  const found = await authed(ctx, `${ep(ctx).api}/files?${new URLSearchParams({ q: `name='${q(DRIVE_FOLDER)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`, fields: 'files(id)', pageSize: '1' })}`);
  const id = ((await found.json()) as { files?: { id: string }[] }).files?.[0]?.id;
  if (id) return id;
  if (!create) return null;
  const made = await authed(ctx, `${ep(ctx).api}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return ((await made.json()) as { id: string }).id;
}

export async function listDriveBackups(ctx: DriveContext): Promise<DriveBackup[]> {
  const folder = await backupFolder(ctx, false);
  if (!folder) return [];
  const out: DriveBackup[] = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({ q: `'${folder}' in parents and trashed=false`, fields: 'nextPageToken,files(id,name,size,createdTime)', orderBy: 'createdTime desc', pageSize: '200' });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await authed(ctx, `${ep(ctx).api}/files?${params}`);
    const body = (await res.json()) as { nextPageToken?: string; files?: { id: string; name: string; size?: string; createdTime?: string }[] };
    for (const f of body.files ?? []) out.push({ id: f.id, name: f.name, bytes: Number(f.size ?? 0), createdAt: f.createdTime ?? '', manual: !/^invoiceon-\d{4}-\d{2}-\d{2}\.db$/.test(f.name) });
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

/** Uploads one backup file. Returns Drive's id for it. */
export async function uploadBackup(ctx: DriveContext, file: string, name: string): Promise<string> {
  if (!existsSync(file)) throw new UserError('The backup file to upload could not be found.');
  const folder = (await backupFolder(ctx, true))!;
  const start = await authed(ctx, `${ep(ctx).upload}/files?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream' },
    body: JSON.stringify({ name, parents: [folder], appProperties: { app: 'invoiceon' } }),
  });
  const session = start.headers.get('location');
  if (!session) throw new UserError('Google Drive did not accept the upload. Try again.');
  const sent = await call(ctx, session, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: readFileSync(file) });
  return ((await sent.json()) as { id: string }).id;
}

/** Downloads a Drive backup to `dest`, writing it whole or not at all. */
export async function downloadBackup(ctx: DriveContext, id: string, dest: string): Promise<void> {
  const res = await authed(ctx, `${ep(ctx).api}/files/${encodeURIComponent(id)}?alt=media`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const tmp = `${dest}.part`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, dest);
}

export async function deleteDriveBackup(ctx: DriveContext, id: string): Promise<void> {
  await authed(ctx, `${ep(ctx).api}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Removes the oldest automatic (daily-named) backups beyond `keep`. Backups made by hand are never removed. */
export async function pruneDriveBackups(ctx: DriveContext, keep: number): Promise<number> {
  const autos = (await listDriveBackups(ctx)).filter((b) => !b.manual).sort((a, b) => b.name.localeCompare(a.name));
  const extra = autos.slice(keep);
  for (const b of extra) await deleteDriveBackup(ctx, b.id);
  return extra.length;
}
