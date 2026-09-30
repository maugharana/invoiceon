import { CloudUpload, FolderOpen, History, Lock } from 'lucide-react';
import { useState } from 'react';
import { MIN_PASSPHRASE, type OffsiteFile } from '../../../shared/offsite';
import { ConfirmDialog } from '../../components/Modal';
import { flashAfterReload, useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, Pill, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { formatDateTime, plural } from '../../lib/format';

const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Off-site copies: the database copied into a folder of your choice. Point it at a folder that Google Drive, OneDrive or Dropbox keeps in sync
 * (or a USB drive) and the books survive a stolen or broken computer. InvoiceOn does not talk to any cloud service itself.
 */
export function OffsiteCard() {
  const toast = useToast();
  const refresh = useRefresh();
  const status = useQuery(() => api.offsiteStatus());
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState<OffsiteFile | null>(null);
  const [restorePass, setRestorePass] = useState('');
  const [turnOff, setTurnOff] = useState(false);

  const s = status.data;
  if (status.error && !s) return <ErrorNote>{status.error}</ErrorNote>;
  if (!s) return <Spinner />;

  async function copyNow() {
    setBusy(true);
    try {
      await api.offsiteCopyNow();
      refresh();
      toast.success('Copied off-site');
    } catch (err) {
      toast.error(errorMessage(err));
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <h3 className="text-base">Off-site copy</h3>
          <p className="text-ink-muted">A second copy of your books in a folder outside this computer, so a broken or stolen computer does not take the books with it. Choose a folder your cloud drive keeps in sync, or a USB drive.</p>
        </div>
        {s.folder && !editing && (
          <Button icon={<CloudUpload className="h-4 w-4" />} loading={busy} onClick={() => void copyNow()}>
            Copy now
          </Button>
        )}
      </div>

      {!s.folder || editing ? (
        <Setup
          initialFolder={s.folder ?? ''}
          alreadyEncrypted={s.encrypted}
          onCancel={s.folder ? () => setEditing(false) : undefined}
          onSaved={() => {
            setEditing(false);
            refresh();
            toast.success('Off-site copies are on. The first copy is made at once, then once a day when the app opens.');
            void api.offsiteCopyNow().then(refresh, (err) => toast.error(errorMessage(err)));
          }}
        />
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
              <span className="num min-w-0 flex-1 break-all">{s.folder}</span>
              {s.encrypted && (
                <Pill tone="neutral">
                  <span className="inline-flex items-center gap-1">
                    <Lock className="h-3 w-3" aria-hidden /> Encrypted
                  </span>
                </Pill>
              )}
            </div>
            <p className="mt-1.5 text-xs text-ink-muted">
              {s.lastAt ? `Last copy ${formatDateTime(s.lastAt)}.` : 'No copy made yet.'} A new one is made once a day when the app opens; the newest 30 are kept.
            </p>
          </div>
          {s.lastError && <ErrorNote>{s.lastError}</ErrorNote>}
          {!s.reachable && !s.lastError && <ErrorNote>The folder cannot be reached right now. Is the drive plugged in?</ErrorNote>}

          {s.files.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-line">
              <ul className="max-h-56 divide-y divide-line/70 overflow-y-auto">
                {s.files.map((f) => (
                  <li key={f.name} className="flex items-center gap-4 px-4 py-2.5">
                    <span className="num min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="text-xs text-ink-muted">{formatDateTime(f.modifiedAt)}</span>
                    <span className="num w-16 text-right text-xs text-ink-muted">{formatBytes(f.bytes)}</span>
                    <Button className="h-8 px-3 text-xs" icon={<History className="h-3.5 w-3.5" />} onClick={() => { setRestorePass(''); setRestoring(f); }} aria-label={`Restore ${f.name}`}>
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="border-t border-line bg-canvas px-4 py-2 text-xs text-ink-muted">{plural(s.files.length, 'copy', 'copies')} in the off-site folder</div>
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={() => setEditing(true)}>Change folder or encryption</Button>
            <Button onClick={() => setTurnOff(true)}>Turn off</Button>
          </div>
        </div>
      )}

      {restoring && (
        <ConfirmDialog
          title="Restore this off-site copy?"
          confirmLabel="Restore copy"
          danger
          onClose={() => setRestoring(null)}
          body={
            <div className="space-y-3">
              <p>
                Everything in InvoiceOn will go back to how it was in <span className="num text-ink">{restoring.name}</span>. Anything entered since then is replaced. Your current data is saved as a safety copy first, and the app reloads when it is done.
              </p>
              {restoring.encrypted && (
                <Field label="Passphrase" hint="Leave empty on the computer that made the copy. A new computer needs it.">
                  <Input type="password" autoComplete="off" value={restorePass} onChange={(e) => setRestorePass(e.target.value)} />
                </Field>
              )}
            </div>
          }
          onConfirm={async () => {
            await api.offsiteRestore(restoring.name, restorePass || undefined);
            flashAfterReload('Off-site copy restored. Your previous data was kept as a safety copy.');
            window.location.hash = '/dashboard';
            window.location.reload();
          }}
        />
      )}
      {turnOff && (
        <ConfirmDialog
          title="Turn off off-site copies?"
          confirmLabel="Turn off"
          onClose={() => setTurnOff(false)}
          body={<p>No more copies will be made. The ones already in the folder stay there, and you can turn this on again later.</p>}
          onConfirm={async () => {
            await api.offsiteDisable();
            refresh();
            setTurnOff(false);
          }}
        />
      )}
    </div>
  );
}

function Setup({ initialFolder, alreadyEncrypted, onCancel, onSaved }: { initialFolder: string; alreadyEncrypted: boolean; onCancel?: () => void; onSaved: () => void }) {
  const [folder, setFolder] = useState(initialFolder);
  const [encrypt, setEncrypt] = useState(alreadyEncrypted);
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function browse() {
    try {
      const { folder: chosen } = await api.offsiteChooseFolder();
      if (chosen) setFolder(chosen);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function save() {
    setError(null);
    if (encrypt && pass && pass !== again) return setError('The two passphrases do not match.');
    setBusy(true);
    try {
      await api.offsiteSave({ folder, encrypt, passphrase: encrypt && pass ? pass : undefined });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="max-w-xl space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Field label="Folder" hint="Where the copies go, for example a folder inside Google Drive, OneDrive or Dropbox, or on a USB drive.">
        <div className="flex gap-2">
          <Input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="D:\Backups\InvoiceOn" />
          {window.invoiceon && <Button type="button" onClick={() => void browse()}>Browse</Button>}
        </div>
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={encrypt} onChange={(e) => setEncrypt(e.target.checked)} />
        <span>
          Encrypt the copies with a passphrase. <span className="text-ink-muted">Recommended for a cloud folder: whoever can open the folder still cannot read your customers or sales.</span>
        </span>
      </label>
      {encrypt && (
        <div className="grid grid-cols-2 gap-4">
          <Field label={alreadyEncrypted ? 'New passphrase' : 'Passphrase'} hint={alreadyEncrypted ? 'Leave empty to keep the current one.' : `At least ${MIN_PASSPHRASE} characters.`}>
            <Input type="password" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} />
          </Field>
          <Field label="Passphrase again">
            <Input type="password" autoComplete="off" value={again} onChange={(e) => setAgain(e.target.value)} />
          </Field>
          <p className="col-span-2 rounded-lg bg-status-partial-bg px-3 py-2 text-xs text-status-partial-fg">
            Write the passphrase down and keep it somewhere safe. It is the only way to open an encrypted copy on a new computer, and InvoiceOn cannot recover it for you.
          </p>
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="primary" type="submit" loading={busy}>
          {initialFolder ? 'Save' : 'Turn on off-site copies'}
        </Button>
        {onCancel && <Button type="button" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}
