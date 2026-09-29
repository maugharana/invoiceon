import { Printer } from 'lucide-react';
import { useEffect } from 'react';
import { InvoiceDocument } from '../../components/InvoiceDocument';
import { Button } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { proformaAsInvoice } from '../../lib/proforma';

/**
 * The bare invoice, with no app chrome. In the desktop app, PDF export and printing open this route in a hidden window and
 * capture it; it flags itself ready (body[data-ready]) once the data and the fonts are in, so the shell knows when.
 *
 * In a plain browser (the localhost preview) there is no shell to capture it, so the page carries a small toolbar instead:
 * the browser's own print dialog does the job, and its "Save as PDF" destination produces the file.
 */
export function PrintInvoicePage({ id, kind = 'invoice' }: { id: string; kind?: 'invoice' | 'proforma' }) {
  const proforma = kind === 'proforma';
  const query = useQuery(() => (proforma ? api.proformaGet(id).then(proformaAsInvoice) : api.invoiceGet(id)), [id, proforma]);
  const invoice = query.data;
  const inBrowser = !window.invoiceon;

  useEffect(() => {
    if (!invoice) return;
    let cancelled = false;
    // Not requestAnimationFrame: hidden windows don't run animation frames, which would stall the export.
    void document.fonts.ready.then(() => {
      if (!cancelled) document.body.dataset.ready = '1';
    });
    return () => {
      cancelled = true;
      delete document.body.dataset.ready;
    };
  }, [invoice]);

  useEffect(() => {
    if (invoice) document.title = `${proforma ? 'Proforma' : 'Invoice'} ${invoice.number.replaceAll('/', '-')}`; // becomes the suggested file name when saving as PDF
  }, [invoice, proforma]);

  if (query.error) return <p className="p-8 text-status-overdue-fg">{query.error}</p>;
  if (!invoice) return null;
  return (
    <div className={inBrowser ? 'min-h-screen bg-canvas print:bg-white' : 'bg-white'}>
      {inBrowser && (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-6 border-b border-line bg-surface px-6 py-3 print:hidden">
          <p className="text-ink-muted">
            To save this {proforma ? 'proforma' : 'invoice'} as a PDF, click <span className="text-ink">Save as PDF</span>, then choose <span className="text-ink">“Save as PDF”</span> as the printer (destination) and press Save.
          </p>
          <Button variant="primary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
            Save as PDF / Print
          </Button>
        </div>
      )}
      <div className={inBrowser ? 'py-8 print:py-0' : ''}>
        <div className={inBrowser ? 'mx-auto w-max border border-line shadow-overlay print:border-0 print:shadow-none' : ''}>
          <InvoiceDocument invoice={invoice} variant={kind} />
        </div>
      </div>
    </div>
  );
}
