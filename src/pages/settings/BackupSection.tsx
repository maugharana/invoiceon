import { Cloud, CloudOff, DatabaseBackup, FolderOpen, HardDriveDownload, Trash2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { formatDateTime, plural } from '../../lib/format';
import type { BackupFileInfo, BackupNote, BackupSettings, DriveBackup, DriveStatus, RestoreSource } from '../../../shared/types';

const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const KIND_LABEL: Record<BackupFileInfo['kind'], string> = { daily: 'Automatic', manual: 'Made by you', 'before-restore': 'Before a restore' };
const isDesktop = () => !!window.invoiceon;

function Note({ note, empty }: { note: BackupNote | null; empty: string }) {
  if (!note) return <span className="text-ink-muted">{empty}</span>;
  return (
    <span className={note.ok ? 'text-ink-muted' : 'text-status-overdue-fg'}>
      {note.ok ? 'Last copy' : 'Last copy failed'} · {formatDateTime(note.at)}
      {!note.ok && <span className="block">{note.message}</span>}
    </span>
  );
}

export function BackupSection() {
  const toast = useToast();
  const refresh = useRefresh();
  const info = useQuery(() => api.dataInfo());
  const [busy, setBusy] = useState<'backup' | 'copy' | null>(null);
  const [restoring, setRestoring] = useState<RestoreSource | null>(null);
  const [restarting, setRestarting] = useState(false);

  async function backupNow() {
    setBusy('backup');
    try {
      const r = await api.backupNow();
      refresh();
      if (r.problems.length) toast.error(`${r.problems.join(' ')} The copy on this computer was saved.`);
      else toast.success(r.done.length > 1 ? `Backed up: ${r.done.join(', ').toLowerCase()}` : `Backed up as ${r.name}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveCopy() {
    setBusy('copy');
    try {
      const r = await api.backupSaveCopy();
      if (r.saved) toast.success('Copy saved');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function restore(source: RestoreSource) {
    const r = await api.backupRestore(source);
    if (r.started) setRestarting(true);
  }

  if (info.error) return <ErrorNote>{info.error}</ErrorNote>;
  if (!info.data) return <Spinner />;
  const { backups, settings, drive, extraLast, restorePending } = info.data;

  if (restarting)
    return (
      <div className="rounded-lg border border-line px-4 py-6 text-center">
        <p className="text-base">Restoring your backup…</p>
        <p className="mt-1 text-ink-muted">InvoiceOn is closing and will open again on its own with the restored data.</p>
      </div>
    );

  return (
    <div className="space-y-10">
      {restorePending && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-gold bg-canvas px-4 py-3">
          <p>A restore is ready and will happen the next time InvoiceOn starts.</p>
          <Button
            icon={<Undo2 className="h-4 w-4" />}
            onClick={async () => {
              await api.backupRestoreCancel();
              refresh();
            }}
          >
            Cancel it
          </Button>
        </div>
      )}

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base">Back up your book</h3>
            <p className="text-ink-muted">A copy is made on its own once a day. “Back up now” also sends one to the extra folder and Google Drive below, when they are set up.</p>
          </div>
          <div className="flex gap-2">
            {isDesktop() && (
              <Button icon={<HardDriveDownload className="h-4 w-4" />} loading={busy === 'copy'} onClick={saveCopy}>
                Save a copy to…
              </Button>
            )}
            <Button variant="primary" icon={<DatabaseBackup className="h-4 w-4" />} loading={busy === 'backup'} onClick={backupNow}>
              Back up now
            </Button>
          </div>
        </div>
        <LocalList backups={backups} onRestore={(name) => setRestoring({ from: 'list', name })} />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-muted">The last 14 automatic backups are kept. Ones you make, and the copy kept before a restore, are never deleted.</p>
          {isDesktop() && (
            <Button icon={<FolderOpen className="h-4 w-4" />} onClick={() => setRestoring({ from: 'file' })}>
              Restore from a file…
            </Button>
          )}
        </div>
      </div>

      <ExtraFolder settings={settings} note={extraLast} />
      <GoogleDrive status={drive} settings={settings} onRestore={(id) => setRestoring({ from: 'drive', id })} />

      {restoring && (
        <ConfirmDialog
          title="Restore this backup?"
          confirmLabel="Restore and restart"
          danger
          body={
            <div className="space-y-2">
              <p>InvoiceOn will close and open again with the data as it was in this backup. Anything entered since then will no longer be there.</p>
              <p className="text-ink-muted">Your current book is copied into the backups list first (marked “Before a restore”), so you can come back to it.</p>
            </div>
          }
          onConfirm={() => restore(restoring)}
          onClose={() => setRestoring(null)}
        />
      )}
    </div>
  );
}

function LocalList({ backups, onRestore }: { backups: BackupFileInfo[]; onRestore: (name: string) => void }) {
  if (backups.length === 0) return <p className="rounded-lg border border-line px-4 py-3 text-ink-muted">No backups yet. The first automatic one is made the next time the app opens.</p>;
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <ul className="max-h-64 divide-y divide-line/70 overflow-y-auto">
        {backups.map((b) => (
          <li key={b.name} className="flex items-center gap-4 px-4 py-2.5">
            <span className="num min-w-0 flex-1 truncate">{b.name}</span>
            <span className="text-xs text-ink-muted">{KIND_LABEL[b.kind]}</span>
            <span className="text-xs text-ink-muted">{formatDateTime(b.modifiedAt)}</span>
            <span className="num w-16 text-right text-xs text-ink-muted">{formatBytes(b.bytes)}</span>
            {isDesktop() && (
              <Button onClick={() => onRestore(b.name)} className="!px-2.5 !py-1 text-xs">
                Restore
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="border-t border-line bg-canvas px-4 py-2 text-xs text-ink-muted">{plural(backups.length, 'backup')} on this computer</div>
    </div>
  );
}

function ExtraFolder({ settings, note }: { settings: BackupSettings; note: BackupNote | null }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [folder, setFolder] = useState(settings.extraFolder);
  const [auto, setAuto] = useState(settings.extraAuto);
  const [saving, setSaving] = useState(false);
  const dirty = folder.trim() !== settings.extraFolder || auto !== settings.extraAuto;

  async function browse() {
    try {
      const picked = await api.backupPickFolder();
      if (picked) setFolder(picked);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  async function save() {
    setSaving(true);
    try {
      const saved = await api.backupSettingsSave({ ...settings, extraFolder: folder, extraAuto: auto });
      setFolder(saved.extraFolder);
      refresh();
      toast.success(saved.extraFolder ? 'Extra backup folder saved' : 'Extra backup folder turned off');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h3 className="text-base">A second place on this computer</h3>
      <p className="mb-3 text-ink-muted">A pen drive or another disk. If this computer’s disk fails, the copy there survives. Leave it empty to switch it off.</p>
      <div className="flex items-end gap-2">
        <Field label="Folder" className="flex-1">
          <Input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="E:\InvoiceOn backups" className="num" />
        </Field>
        {isDesktop() && (
          <Button icon={<FolderOpen className="h-4 w-4" />} onClick={browse}>
            Choose…
          </Button>
        )}
        <Button variant="primary" disabled={!dirty} loading={saving} onClick={save}>
          Save
        </Button>
      </div>
      <label className="mt-3 flex cursor-pointer items-center gap-3">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="h-4 w-4 accent-[#0F6E56]" />
        <span>Copy each automatic daily backup there too</span>
      </label>
      {settings.extraFolder && (
        <p className="mt-2 text-xs">
          <Note note={note} empty="Nothing copied there yet." />
        </p>
      )}
    </div>
  );
}

const STEPS = [
  <>Open <span className="num">console.cloud.google.com</span>, sign in with the Google account whose Drive should hold the backups, and create a project (any name, such as “InvoiceOn”).</>,
  <>Open <b className="font-medium">APIs &amp; Services › Library</b>, search for <b className="font-medium">Google Drive API</b> and press <b className="font-medium">Enable</b>.</>,
  <>Open <b className="font-medium">APIs &amp; Services › OAuth consent screen</b> (also called Google Auth Platform). Choose <b className="font-medium">External</b>, give it the name InvoiceOn and your email, and add your own email as a <b className="font-medium">Test user</b>. Then press <b className="font-medium">Publish app</b> so the sign-in does not run out after 7 days. Google will call the app “unverified”; that is expected, because it is only for you.</>,
  <>Open <b className="font-medium">Credentials › Create credentials › OAuth client ID</b>, choose <b className="font-medium">Desktop app</b> as the type and press Create. Copy the <b className="font-medium">Client ID</b> and <b className="font-medium">Client secret</b> into the boxes below.</>,
];

function GoogleDrive({ status, settings, onRestore }: { status: DriveStatus; settings: BackupSettings; onRestore: (id: string) => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [clientId, setClientId] = useState(status.clientId);
  const [secret, setSecret] = useState('');
  const [editing, setEditing] = useState(!status.configured);
  const [waiting, setWaiting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [auto, setAuto] = useState(settings.driveAuto);
  const [keep, setKeep] = useState(String(settings.keepDrive));
  const [confirmOut, setConfirmOut] = useState(false);

  async function saveKeys() {
    setSaving(true);
    try {
      await api.driveSaveCredentials({ clientId, clientSecret: secret });
      setSecret('');
      setEditing(false);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function connect() {
    setWaiting(true);
    try {
      const { authUrl } = await api.driveConnectStart();
      window.open(authUrl, '_blank');
      await api.driveConnectWait();
      refresh();
      toast.success('Connected to Google Drive');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setWaiting(false);
    }
  }

  async function saveOnline() {
    try {
      await api.backupSettingsSave({ ...settings, driveAuto: auto, keepDrive: Number(keep) });
      refresh();
      toast.success('Saved');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-base">
            {status.connected ? <Cloud className="h-4 w-4 text-brand" /> : <CloudOff className="h-4 w-4 text-ink-muted" />}
            Google Drive (online backup)
          </h3>
          <p className="text-ink-muted">
            Keeps a copy in your own Google Drive, in a folder called “InvoiceOn backups”, so your data survives even if this computer is lost. InvoiceOn can only see the files it made itself, never the rest of your Drive.
          </p>
        </div>
      </div>

      {status.connected ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-4 py-3">
            <div>
              <div>
                Connected as <span className="num">{status.account || 'your Google account'}</span>
              </div>
              <div className="text-xs">
                <Note note={status.last} empty="Nothing uploaded yet. Press “Back up now” above." />
              </div>
            </div>
            <Button icon={<CloudOff className="h-4 w-4" />} onClick={() => setConfirmOut(true)}>
              Disconnect
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-6">
            <label className="flex cursor-pointer items-center gap-3">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="h-4 w-4 accent-[#0F6E56]" />
              <span>Upload each automatic daily backup</span>
            </label>
            <Field label="Keep the last" className="w-28">
              <div className="relative">
                <Input value={keep} onChange={(e) => setKeep(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" className="num pr-14 text-right" />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted">days</span>
              </div>
            </Field>
            <Button variant="primary" disabled={auto === settings.driveAuto && Number(keep) === settings.keepDrive} onClick={saveOnline}>
              Save
            </Button>
          </div>
          <DriveList onRestore={onRestore} />
        </div>
      ) : (
        <div className="space-y-4">
          {status.configured && !editing ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-4 py-3">
              <div>
                <div>Ready to connect</div>
                <div className="num text-xs text-ink-muted">{status.clientId}</div>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => setEditing(true)}>Change keys</Button>
                <Button variant="primary" icon={<Cloud className="h-4 w-4" />} loading={waiting} onClick={connect}>
                  {waiting ? 'Waiting for Google…' : 'Connect Google Drive'}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <details className="rounded-lg border border-line px-4 py-3" open={!status.configured}>
                <summary className="cursor-pointer">How to get the Client ID and secret (once, about 10 minutes)</summary>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-ink-muted">
                  {STEPS.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </details>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Client ID">
                  <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234-abc.apps.googleusercontent.com" className="num" />
                </Field>
                <Field label="Client secret" hint={status.configured ? 'Leave empty to keep the saved one.' : undefined}>
                  <Input value={secret} onChange={(e) => setSecret(e.target.value)} type="password" autoComplete="off" placeholder="GOCSPX-…" className="num" />
                </Field>
              </div>
              <div className="flex gap-2">
                <Button variant="primary" loading={saving} disabled={!clientId.trim()} onClick={saveKeys}>
                  Save keys
                </Button>
                {status.configured && <Button onClick={() => setEditing(false)}>Cancel</Button>}
              </div>
              <p className="text-xs text-ink-muted">The secret is kept on this computer only, encrypted with your Windows account. It is not part of your backups.</p>
            </>
          )}
          {status.last && !status.last.ok && <p className="text-xs text-status-overdue-fg">{status.last.message}</p>}
        </div>
      )}

      {confirmOut && (
        <ConfirmDialog
          title="Disconnect Google Drive?"
          confirmLabel="Disconnect"
          body="Backups already in your Drive stay there. InvoiceOn simply stops sending new ones until you connect again."
          onConfirm={async () => {
            await api.driveDisconnect(false);
            refresh();
          }}
          onClose={() => setConfirmOut(false)}
        />
      )}
    </div>
  );
}

function DriveList({ onRestore }: { onRestore: (id: string) => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const list = useQuery(() => api.driveBackups());
  const [removing, setRemoving] = useState<DriveBackup | null>(null);

  if (list.error) return <ErrorNote>{list.error}</ErrorNote>;
  if (!list.data) return <Spinner />;
  if (list.data.length === 0) return <p className="rounded-lg border border-line px-4 py-3 text-ink-muted">Nothing in Google Drive yet.</p>;
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <ul className="max-h-64 divide-y divide-line/70 overflow-y-auto">
        {list.data.map((b) => (
          <li key={b.id} className="flex items-center gap-4 px-4 py-2.5">
            <span className="num min-w-0 flex-1 truncate">{b.name}</span>
            <span className="text-xs text-ink-muted">{b.manual ? 'Made by you' : 'Automatic'}</span>
            <span className="text-xs text-ink-muted">{b.createdAt ? formatDateTime(b.createdAt) : ''}</span>
            <span className="num w-16 text-right text-xs text-ink-muted">{formatBytes(b.bytes)}</span>
            {isDesktop() && (
              <Button onClick={() => onRestore(b.id)} className="!px-2.5 !py-1 text-xs">
                Restore
              </Button>
            )}
            <button type="button" aria-label={`Delete ${b.name} from Google Drive`} className="text-ink-muted hover:text-status-overdue-fg" onClick={() => setRemoving(b)}>
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-line bg-canvas px-4 py-2 text-xs text-ink-muted">{plural(list.data.length, 'backup')} in Google Drive</div>
      {removing && (
        <ConfirmDialog
          title="Delete this backup from Google Drive?"
          confirmLabel="Delete"
          danger
          body={`${removing.name} will be removed from your Drive. Copies on this computer are not affected.`}
          onConfirm={async () => {
            await api.driveDeleteBackup(removing.id);
            refresh();
            toast.success('Removed from Google Drive');
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
