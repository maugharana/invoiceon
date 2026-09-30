import { useEffect, useRef } from 'react';

/**
 * Barcode scanners that act like a keyboard "type" the code and press Enter, far faster than a person can. This listens for that
 * burst anywhere on the page (except inside a text field, where the typing is already going somewhere) and hands over the code.
 * A person typing slowly, or pressing Enter on its own, is never mistaken for a scan.
 */
export function useBarcodeScanner(onScan: (code: string) => void, enabled = true): void {
  const latest = useRef(onScan);
  latest.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    let buffer = '';
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const now = performance.now();
      if (now - last > 80) buffer = ''; // a gap this long means a person, not a scanner
      last = now;
      if (e.key === 'Enter') {
        const code = buffer;
        buffer = '';
        if (code.length >= 3) {
          e.preventDefault();
          latest.current(code);
        }
        return;
      }
      if (e.key.length === 1) buffer += e.key;
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled]);
}
