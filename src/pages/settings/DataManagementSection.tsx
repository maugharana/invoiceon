import { DatabaseBackup, FileArchive, FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { navigate, paths } from '../../lib/router';

const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function DataManagementSection() {
  const toast = useToast();
  const refresh = useRefresh();
  const info = useQuery(() => api.dataInfo());
  const [busy, setBusy] = useState<'sample' | 'export' | null>(null);

  async function exportAll() {
    setBusy('export');
    try {
      const out = await api.dataExportAll();
      if (window.invoiceon) {
        if ((await api.exportSaveZip(out.fileName, out.base64)).saved) toast.success('Export saved');
      } else {
        const bytes = Uint8Array.from(atob(out.base64), (ch) => ch.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
        Object.assign(document.createElement('a'), { href: url, download: out.fileName }).click();
        URL.revokeObjectURL(url);
      }
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
  const { folder, databaseBytes } = info.data;

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-1.5 text-xs font-medium text-ink-muted">Where your data lives</div>
        <p className="num break-all rounded-lg bg-canvas px-3 py-2">{folder}</p>
        <p className="mt-1.5 text-xs text-ink-muted">Everything is stored on this computer in one file ({formatBytes(databaseBytes)}). No internet is needed to use it.</p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-base">Export everything</h3>
          <p className="text-ink-muted">One ZIP with a spreadsheet for each part of your book: customers, designs, invoices, payments, expenses and more. For your records or to open in Excel. It is not a backup.</p>
        </div>
        <Button icon={<FileArchive className="h-4 w-4" />} loading={busy === 'export'} onClick={() => void exportAll()}>
          Export all data
        </Button>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-base">Backups</h3>
          <p className="text-ink-muted">Automatic daily copies, a second folder, Google Drive, and restoring all live under Backup &amp; Restore.</p>
        </div>
        <Button icon={<DatabaseBackup className="h-4 w-4" />} onClick={() => navigate(paths.settingsSection('backup'))}>
          Open Backup &amp; Restore
        </Button>
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
