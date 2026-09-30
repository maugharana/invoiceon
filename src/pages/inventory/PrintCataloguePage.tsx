import { Printer } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { encodeCatalogueRequest, parseCatalogueRequest } from '../../../shared/catalogue';
import { CatalogueSheet } from '../../components/CatalogueSheet';
import { Button } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/data';

/**
 * The bare catalogue, with no app around it. The desktop app opens this in a hidden window to print or save as PDF (it flags itself ready
 * once the data, the pictures and the fonts are in), and in a browser it carries a small toolbar so the browser's print dialog can do it.
 */
export function PrintCataloguePage({ query }: { query: string }) {
  const req = useMemo(() => parseCatalogueRequest(query), [query]);
  const data = useQuery(() => api.catalogueData(encodeCatalogueRequest(req)), [query]);
  const inBrowser = !window.invoiceon;
  const ready = !!data.data;

  useEffect(() => {
    if (!data.data) return;
    let cancelled = false;
    document.title = data.data.title;
    // Not requestAnimationFrame (hidden windows do not run it). Wait for every picture to be decoded, so none is missing from the PDF.
    void Promise.all([document.fonts.ready, ...Array.from(document.images).map((img) => img.decode().catch(() => undefined))]).then(() => {
      if (!cancelled) document.body.dataset.ready = '1';
    });
    return () => {
      cancelled = true;
      delete document.body.dataset.ready;
    };
  }, [data.data]);

  if (data.error) return <p className="p-8 text-status-overdue-fg">{data.error}</p>;
  if (!ready) return null;

  return (
    <div className={inBrowser ? 'min-h-screen bg-canvas print:bg-white' : 'bg-white'}>
      <style>{`@page { size: A4; margin: 0; } .catalogue-card { break-inside: avoid; }`}</style>
      {inBrowser && (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-6 border-b border-line bg-surface px-6 py-3 print:hidden">
          <p className="text-ink-muted">
            {data.data!.items.length} designs. Click <span className="text-ink">Print</span>, then choose “Save as PDF” to share it on WhatsApp, or a printer. Set margins to “None” and turn on background graphics.
          </p>
          <Button variant="primary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
            Print catalogue
          </Button>
        </div>
      )}
      <div className={inBrowser ? 'flex justify-center py-8 print:block print:py-0' : ''}>
        <div className={inBrowser ? 'shadow-overlay print:shadow-none' : ''}>
          <CatalogueSheet data={data.data!} columns={req.columns} showPrices={req.showPrices} inStockOnly={req.inStockOnly} />
        </div>
      </div>
    </div>
  );
}
