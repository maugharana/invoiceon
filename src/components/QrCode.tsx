import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** A QR code as a crisp SVG. Error correction is medium ("M"): enough to survive a folded invoice, small enough to stay easy to scan. */
export function QrCode({ value, className }: { value: string; className?: string }) {
  const cells = useMemo(() => {
    const qr = qrcode(0, 'M'); // type 0: pick the smallest version that fits
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let path = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
    return { n, path };
  }, [value]);
  const quiet = 2;
  const size = cells.n + quiet * 2;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={className} role="img" aria-label="QR code to pay by UPI" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={cells.path} transform={`translate(${quiet} ${quiet})`} fill="#000" />
    </svg>
  );
}
