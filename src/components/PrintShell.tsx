import { Printer } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { PAPER_MM } from '../../shared/prefs';
import { useApplyPreferences } from '../lib/prefs';
import { Button } from './ui';

/**
 * The frame around anything printed: invoices, quotes, statements, receipts. It sets the paper (size, margins and scale come from
 * Settings → Preferences), applies the date format, and flags itself ready (body[data-ready]) once the data and fonts are in, which is
 * how the desktop shell knows when to capture it. In a plain browser there is no shell to capture it, so a small bar offers the
 * browser's own print dialog instead, whose "Save as PDF" destination makes the file.
 *
 * Documents are drawn at A4 width; other sizes scale the whole page, and the margin scales with it.
 */
export function PrintShell({ ready, title, noun, children, page }: { ready: boolean; title: string; noun: string; children: ReactNode; /** A fixed page (a receipt roll) instead of the paper size chosen in Settings. Not scaled. */ page?: { w: number; h: number } }) {
  const settings = useApplyPreferences();
  const inBrowser = !window.invoiceon;
  const paper = page ?? PAPER_MM[settings?.paperSize ?? 'A4'];
  const scale = page ? 1 : paper.w / 210;

  useEffect(() => {
    if (!ready || !settings) return;
    let cancelled = false;
    // Not requestAnimationFrame: hidden windows don't run animation frames, which would stall the export.
    void document.fonts.ready.then(() => {
      if (!cancelled) document.body.dataset.ready = '1';
    });
    return () => {
      cancelled = true;
      delete document.body.dataset.ready;
    };
  }, [ready, settings]);

  useEffect(() => {
    if (title) document.title = title; // becomes the suggested file name when saving as PDF
  }, [title]);

  // Wait for the settings: the date format has to be set before the document draws any date.
  if (!settings) return null;

  return (
    <div className={inBrowser ? 'min-h-screen bg-canvas print:bg-white' : 'bg-white'}>
      <style>{`@page { size: ${paper.w}mm ${paper.h}mm; margin: ${(page ? 4 : 12 * scale).toFixed(2)}mm; }`}</style>
      {inBrowser && (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-6 border-b border-line bg-surface px-6 py-3 print:hidden">
          <p className="text-ink-muted">
            To save this {noun} as a PDF, click <span className="text-ink">Save as PDF / Print</span>, then choose <span className="text-ink">“Save as PDF”</span> as the printer (destination) and press Save.
          </p>
          <Button variant="primary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
            Save as PDF / Print
          </Button>
        </div>
      )}
      <div className={inBrowser ? 'py-8 print:py-0' : ''}>
        <div className={inBrowser ? 'mx-auto w-max border border-line shadow-overlay print:border-0 print:shadow-none' : ''} style={{ zoom: scale }}>
          {children}
        </div>
      </div>
    </div>
  );
}
