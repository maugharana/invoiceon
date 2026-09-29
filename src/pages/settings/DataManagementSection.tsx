import { DatabaseBackup, FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { formatDateTime, plural } from '../../lib/format';

const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function DataManagementSection() {
  const toast = useToast();
  const refresh = useRefresh();
  const info = useQuery(() => api.dataInfo());
  const [busy, setBusy] = useState<'backup' | 'sample' | null>(null);

  async function backup() {
    setBusy('backup');
    try {
      const { name } = await api.backupNow();
      refresh();
      toast.success(`Backed up as ${name}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function loadSample() {
    setBusy('sample');
    try {
      await api.sampleDataLoad();
      refresh();
      toast.success('Sample data added');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (info.error) return <ErrorNote>{info.error}</ErrorNote>;
  if (!info.data) return <Spinner />;
  const { folder, databaseBytes, backups } = info.data;

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-1.5 text-xs font-medium text-ink-muted">Where your data lives</div>
        <p className="num break-all rounded-lg bg-canvas px-3 py-2">{folder}</p>
        <p className="mt-1.5 text-xs text-ink-muted">Everything is stored on this computer in one file ({formatBytes(databaseBytes)}). No internet is needed to use it.</p>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-base">Backups</h3>
            <p className="text-ink-muted">A copy is made automatically once a day; the last 14 are kept. Copies you make yourself are never deleted.</p>
          </div>
          <Button icon={<DatabaseBackup className="h-4 w-4" />} loading={busy === 'backup'} onClick={backup}>
            Back up now
          </Button>
        </div>
        {backups.length === 0 ? (
          <p className="rounded-lg border border-line px-4 py-3 text-ink-muted">No backups yet. The first automatic one is made the next time the app opens.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line">
            <ul className="max-h-64 divide-y divide-line/70 overflow-y-auto">
              {backups.map((b) => (
                <li key={b.name} className="flex items-center gap-4 px-4 py-2.5">
                  <span className="num min-w-0 flex-1 truncate">{b.name}</span>
                  <span className="text-xs text-ink-muted">{b.manual ? 'Made by you' : 'Automatic'}</span>
                  <span className="text-xs text-ink-muted">{formatDateTime(b.modifiedAt)}</span>
                  <span className="num w-16 text-right text-xs text-ink-muted">{formatBytes(b.bytes)}</span>
                </li>
              ))}
            </ul>
            <div className="border-t border-line bg-canvas px-4 py-2 text-xs text-ink-muted">{plural(backups.length, 'backup')} in the backups folder inside the data folder above</div>
          </div>
        )}
        <p className="mt-2 text-xs text-ink-muted">To restore, close InvoiceOn and replace <span className="num">invoiceon.db</span> in the data folder with a backup, renamed to <span className="num">invoiceon.db</span>.</p>
      </div>

      <div>
        <h3 className="text-base">Sample data</h3>
        <p className="mb-3 text-ink-muted">Adds made-up sarees, customers, invoices and payments so you can try every screen. Only works while you have no designs of your own.</p>
        <Button icon={<FlaskConical className="h-4 w-4" />} loading={busy === 'sample'} onClick={loadSample}>
          Load sample data
        </Button>
      </div>
    </div>
  );
}
