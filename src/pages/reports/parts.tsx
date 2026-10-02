import { Download, Printer } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui';
import { useCsvExport } from '../../lib/exportCsv';

/** Saves a report as a spreadsheet: a save dialog in the desktop app, a download in the browser. */
export function useReportExport() {
  const save = useCsvExport();
  return (fileName: string, content: string) => save(fileName, content, 'Report saved');
}

export const ExportButton = ({ label = 'Export CSV', onClick }: { label?: string; onClick: () => void }) => (
  <Button icon={<Download className="h-4 w-4" />} onClick={onClick}>
    {label}
  </Button>
);

/** Opens the print dialog, where "Save as PDF" turns the report into a PDF. The menus and buttons are hidden from the page it prints. */
export const PrintButton = () => (
  <Button icon={<Printer className="h-4 w-4" />} onClick={() => window.print()} title="Print this report, or choose “Save as PDF” in the print window">
    Print / PDF
  </Button>
);

export const Section = ({ title, note, actions, children }: { title: string; note?: ReactNode; actions?: ReactNode; children: ReactNode }) => (
  <section className="mb-8">
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-base">{title}</h2>
        {note && <p className="mt-0.5 text-xs text-ink-muted">{note}</p>}
      </div>
      {actions && <div className="print:hidden">{actions}</div>}
    </div>
    {children}
  </section>
);
