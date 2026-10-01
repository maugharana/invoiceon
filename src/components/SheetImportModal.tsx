import { Upload } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { Parsed } from '../../shared/importRows';
import { plural } from '../lib/format';
import { Modal } from './Modal';
import { Button, ErrorNote, Textarea } from './ui';

interface Props<T> {
  title: string;
  /** What the sheet should contain, in plain words. */
  hint: ReactNode;
  /** An example the person can copy. */
  example: string;
  noun: string;
  parse: (text: string) => Parsed<T>;
  /** The cells shown for each row in the preview. */
  columns: { heading: string; cell: (v: T) => ReactNode; right?: boolean }[];
  /** Does the adding; resolves to a sentence about what happened. Throwing keeps the dialog open with the message. */
  onImport: (rows: { row: number; value: T }[]) => Promise<string>;
  onClose: () => void;
}

/**
 * Paste cells from Excel or Google Sheets, or choose a CSV file. It shows what it understood, and what it couldn't, before anything is
 * added; a problem in any row stops the whole thing, so a half-finished import never happens.
 */
export function SheetImportModal<T>({ title, hint, example, noun, parse, columns, onImport, onClose }: Props<T>) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => (text.trim() ? parse(text) : null), [text, parse]);

  async function choose(f: File | undefined) {
    if (!f) return;
    if (f.size > 5_000_000) return setError('That file is too big. Split it into smaller sheets.');
    setError(null);
    setText(await f.text());
  }

  async function submit() {
    if (!parsed || parsed.rows.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await onImport(parsed.rows);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setSaving(false);
    }
  }

  const blocked = !!parsed && parsed.problems.length > 0;
  return (
    <Modal
      title={title}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!parsed || parsed.rows.length === 0 || blocked} onClick={() => void submit()}>
            {parsed && parsed.rows.length > 0 ? `Add ${plural(parsed.rows.length, noun)}` : 'Add'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-muted">{hint}</p>
        <div className="flex items-center gap-3">
          <input ref={file} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => void choose(e.target.files?.[0])} />
          <Button icon={<Upload className="h-4 w-4" />} onClick={() => file.current?.click()}>
            Choose a CSV file
          </Button>
          <span className="text-xs text-ink-muted">or paste the cells below</span>
        </div>
        <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={example} aria-label="Pasted sheet" className="num text-xs" data-autofocus />

        {parsed && parsed.problems.length > 0 && (
          <div className="rounded-lg bg-status-overdue-bg px-4 py-3 text-status-overdue-fg">
            <div className="mb-1">Fix these first. Nothing is added until every row is right.</div>
            <ul className="list-disc space-y-0.5 pl-5 text-xs">
              {parsed.problems.slice(0, 8).map((p) => (
                <li key={p.row}>
                  Row {p.row}: {p.message}
                </li>
              ))}
              {parsed.problems.length > 8 && <li>…and {parsed.problems.length - 8} more.</li>}
            </ul>
          </div>
        )}

        {parsed && parsed.rows.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs text-ink-muted">
              {plural(parsed.rows.length, noun)} found{parsed.rows.length > 6 ? ', first 6 shown' : ''}:
            </div>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-line bg-canvas">
                    <th className="px-3 py-1.5 text-left font-normal text-ink-muted">Row</th>
                    {columns.map((c) => (
                      <th key={c.heading} className={`px-3 py-1.5 font-normal text-ink-muted ${c.right ? 'text-right' : 'text-left'}`}>
                        {c.heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 6).map((r) => (
                    <tr key={r.row} className="border-b border-line/70 last:border-0">
                      <td className="num px-3 py-1.5 text-ink-muted">{r.row}</td>
                      {columns.map((c) => (
                        <td key={c.heading} className={`px-3 py-1.5 ${c.right ? 'num text-right' : ''}`}>
                          {c.cell(r.value) || <span className="text-ink-muted/50">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}
