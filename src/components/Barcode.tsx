import JsBarcode from 'jsbarcode';
import { useEffect, useRef } from 'react';

/** A Code 128 barcode of some text, drawn as SVG so it prints sharply at any size. Most handheld scanners read it as typed text. */
export function Barcode({ value, height = 28, className }: { value: string; height?: number; className?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, value, { format: 'CODE128', displayValue: false, margin: 0, height, width: 1.3, background: 'transparent', lineColor: '#1A1D1B' });
      // Let the drawing scale to the box it is put in.
      ref.current.setAttribute('preserveAspectRatio', 'none');
      ref.current.removeAttribute('width');
      ref.current.removeAttribute('height');
    } catch {
      // A value Code 128 can't hold leaves the space empty; the text under it still reads.
    }
  }, [value, height]);
  return <svg ref={ref} role="img" aria-label={`Barcode of ${value}`} className={className} />;
}
