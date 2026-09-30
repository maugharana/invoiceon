import { Printer } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { labelSizeById, parseLabelRequest } from '../../../shared/labels';
import { LabelCard } from '../../components/LabelCard';
import { Button } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/data';

/**
 * The bare labels, with no app around them. The desktop app opens this in a hidden window to print or save as PDF (it flags itself
 * ready once its data and fonts are in), and in a browser it carries a small toolbar so the browser's print dialog can do the job.
 * A roll prints one label per page at the label's own size; a sheet packs a grid of them onto each A4 page.
 */
export function PrintLabelsPage({ query }: { query: string }) {
  const req = useMemo(() => parseLabelRequest(query), [query]);
  const size = labelSizeById(req.size);
  const variants = useQuery(() => api.variantsForSale());
  const settings = useQuery(() => api.getSettings());
  const inBrowser = !window.invoiceon;

  const labels = useMemo(() => {
    const byId = new Map((variants.data ?? []).map((v) => [v.variantId, v]));
    return req.items.flatMap((i) => {
      const v = byId.get(i.variantId);
      return v ? Array.from({ length: i.copies }, () => v) : [];
    });
  }, [req, variants.data]);

  const ready = !!variants.data && !!settings.data;
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    // Not requestAnimationFrame: hidden windows don't run animation frames, which would stall the export.
    void document.fonts.ready.then(() => {
      if (!cancelled) document.body.dataset.ready = '1';
    });
    document.title = 'Saree labels';
    return () => {
      cancelled = true;
      delete document.body.dataset.ready;
    };
  }, [ready]);

  if (variants.error) return <p className="p-8 text-status-overdue-fg">{variants.error}</p>;
  if (!ready) return null;

  const perSheet = size.sheet ? size.sheet.cols * size.sheet.rows : 1;
  const pages: (typeof labels)[] = [];
  for (let i = 0; i < labels.length; i += perSheet) pages.push(labels.slice(i, i + perSheet));
  const card = (v: (typeof labels)[number], key: number) => <LabelCard key={key} variant={v} size={size} businessName={settings.data!.businessName} showPrice={req.showPrice} showBusiness={req.showBusiness} />;

  return (
    <div className={inBrowser ? 'min-h-screen bg-canvas print:bg-white' : 'bg-white'}>
      {/* The paper size: the label itself for a roll, A4 for a sheet. Margins are zero; the labels carry their own padding. */}
      <style>{`@page { size: ${size.sheet ? 'A4' : `${size.widthMm}mm ${size.heightMm}mm`}; margin: 0; } .label-page { break-after: page; } .label-page:last-child { break-after: auto; }`}</style>
      {inBrowser && (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-6 border-b border-line bg-surface px-6 py-3 print:hidden">
          <p className="text-ink-muted">
            {labels.length} {labels.length === 1 ? 'label' : 'labels'} on {size.name}. Click <span className="text-ink">Print</span>, and choose your label printer, or “Save as PDF”. Set margins to “None” and scale to 100%.
          </p>
          <Button variant="primary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
            Print labels
          </Button>
        </div>
      )}
      <div className={inBrowser ? 'flex flex-col items-center gap-6 py-8 print:block print:gap-0 print:py-0' : ''}>
        {pages.map((page, p) => (
          <div
            key={p}
            className={`label-page ${inBrowser ? 'border border-line bg-white shadow-overlay print:border-0 print:shadow-none' : ''}`}
            style={size.sheet ? { width: '210mm', height: '297mm', display: 'grid', gridTemplateColumns: `repeat(${size.sheet.cols}, ${size.widthMm}mm)`, gridAutoRows: `${size.heightMm}mm`, justifyContent: 'center', alignContent: 'start' } : { width: `${size.widthMm}mm`, height: `${size.heightMm}mm` }}
          >
            {page.map((v, i) => card(v, i))}
          </div>
        ))}
        {pages.length === 0 && <p className="p-8 text-ink-muted">Nothing to print.</p>}
      </div>
    </div>
  );
}
