import { ArrowLeft, Download, FileUp, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toCsv } from '../../../shared/csv';
import { parseTable, toImportRows, type ImportResult } from '../../../shared/import';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorNote, PageHeader, Pill, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useRefresh } from '../../lib/data';
import { plural } from '../../lib/format';
import { navigate, paths } from '../../lib/router';

const FIELD_LABEL: Record<string, string> = { name: 'Name', phone: 'Phone', email: 'Email', gstin: 'GSTIN', address: 'Address', city: 'City', state: 'State', pincode: 'Pincode', type: 'Type', notes: 'Notes' };

/**
 * Bring customers in from a spreadsheet: choose a CSV file, or paste cells copied from Excel or Sheets. The columns are recognised from their headings.
 * Nothing is added until the preview looks right; people already on file, and repeats in the list, are skipped and explained.
 */
export function ImportCustomersPage() {
  const toast = useToast();
  const refresh = useRefresh();
  const file = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => toImportRows(parseTable(text)), [text]);

  async function run(dryRun: boolean) {
    setBusy(dryRun ? 'preview' : 'import');
    setError(null);
    try {
      const result = await api.customersImport(parsed.rows, dryRun);
      if (dryRun) setPreview(result);
      else {
        refresh();
        toast.success(`${plural(result.created, 'customer')} added`);
        navigate(paths.customers);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return setError('That file is too large. Keep it under 5 MB, or split it.');
    setText(await f.text());
    setPreview(null);
    setError(null);
    if (file.current) file.current.value = '';
  }

  function template() {
    const csv = toCsv([
      ['Name', 'Phone', 'Email', 'GSTIN', 'Address', 'City', 'State', 'Pincode', 'Type', 'Notes'],
      ['Meera Textiles', '9876543210', '', '27AAPFU0939F1ZV', '5 Market Road', 'Pune', 'Maharashtra', '411001', 'B2B', ''],
      ['Sunita Devi', '9123456780', '', '', '', 'Mau', 'Uttar Pradesh', '275101', 'B2C', 'Prefers silk'],
    ]);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    Object.assign(document.createElement('a'), { href: url, download: 'Customers sample.csv' }).click();
    URL.revokeObjectURL(url);
  }

  const counts = preview ? { new: preview.results.filter((r) => r.status === 'new').length, duplicate: preview.results.filter((r) => r.status === 'duplicate').length, problem: preview.results.filter((r) => r.status === 'problem').length } : null;

  return (
    <>
      <PageHeader
        back={
          <a href={`#${paths.customers}`} className="inline-flex items-center gap-1.5 rounded-lg text-ink-muted transition-colors hover:text-ink">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Customers
          </a>
        }
        title="Import customers"
        subtitle="From Excel, Google Sheets or any CSV file."
        actions={
          <Button icon={<Download className="h-4 w-4" />} onClick={template}>
            Sample sheet
          </Button>
        }
      />
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid grid-cols-[1fr_20rem] items-start gap-6">
        <div className="space-y-4">
          <Card className="space-y-3 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base">1. Your list</h2>
              <input ref={file} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden aria-label="Choose a CSV file" onChange={(e) => void onFile(e.target.files?.[0])} />
              <Button icon={<FileUp className="h-4 w-4" />} onClick={() => file.current?.click()}>
                Choose a file
              </Button>
            </div>
            <p className="text-xs text-ink-muted">Or copy the cells in your spreadsheet (headings too, if you have them) and paste them here.</p>
            <Textarea rows={8} value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} placeholder={'Name\tPhone\tCity\nMeera Textiles\t9876543210\tPune'} aria-label="Customers to import" className="num" />
            {text.trim() && (
              <p className="text-xs text-ink-muted">
                {plural(parsed.rows.length, 'row')} read.{' '}
                {parsed.usedHeader ? `Columns found: ${parsed.found.map((f) => FIELD_LABEL[f]).join(', ')}.` : 'No headings found, so the columns are taken as name, phone, city, GSTIN.'}
                {parsed.ignored.length > 0 && ` Not used: ${parsed.ignored.join(', ')}.`}
              </p>
            )}
            <Button variant="primary" icon={<Upload className="h-4 w-4" />} loading={busy === 'preview'} disabled={parsed.rows.length === 0 || busy !== null} onClick={() => void run(true)}>
              Check the list
            </Button>
          </Card>

          {preview && counts && (
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
                <div>
                  <h2 className="text-base">2. Check it</h2>
                  <p className="text-sm text-ink-muted">
                    {plural(counts.new, 'customer')} will be added. {counts.duplicate > 0 && `${counts.duplicate} already on file or repeated. `}
                    {counts.problem > 0 && `${plural(counts.problem, 'row')} to fix.`}
                  </p>
                </div>
                <Button variant="primary" loading={busy === 'import'} disabled={counts.new === 0 || busy !== null} onClick={() => void run(false)}>
                  Add {plural(counts.new, 'customer')}
                </Button>
              </div>
              <ul className="max-h-96 divide-y divide-line/70 overflow-y-auto text-sm">
                {preview.results.map((r) => (
                  <li key={r.row} className="flex items-center gap-3 px-5 py-2">
                    <span className="num w-8 text-right text-xs text-ink-muted">{r.row}</span>
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    {r.message && <span className="max-w-[50%] truncate text-xs text-ink-muted" title={r.message}>{r.message}</span>}
                    <Pill tone={r.status === 'new' ? 'paid' : r.status === 'duplicate' ? 'neutral' : 'overdue'}>{r.status === 'new' ? 'Will add' : r.status === 'duplicate' ? 'Skipped' : 'Fix'}</Pill>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <Card className="space-y-3 p-5 text-sm">
          <h2 className="text-base">How it works</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-ink-muted">
            <li>Columns are recognised by their headings: Name, Phone or Mobile, GSTIN or GST No, City or Town, State, Pincode, Email, Notes.</li>
            <li>With a GSTIN, the customer is B2B and the state is filled in from it. Without one, B2C.</li>
            <li>State can be written in full or as UP, MH, GJ and so on.</li>
            <li>Someone already on file (same GSTIN, phone number, or name in the same city) is skipped, never doubled.</li>
            <li>Rows with a problem are listed and left out; the good ones still go in.</li>
            <li>What customers owe is not imported. Enter any old dues as invoices or payments.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
