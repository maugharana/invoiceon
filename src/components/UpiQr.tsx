import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** A QR code as plain SVG, so it prints sharply at any size and needs no image file. Black on white, with a quiet margin, as scanners expect. */
export function QrCode({ text, size = 84, label }: { text: string; size?: number; label: string }) {
  const { count, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { count: n, path: d };
  }, [text]);
  const side = count + 8;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${side} ${side}`} role="img" aria-label={label} shapeRendering="crispEdges" className="shrink-0">
      <rect width={side} height={side} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
