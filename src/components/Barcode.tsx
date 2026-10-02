import { canEncode128, code128Widths } from '../../shared/code128';

/** A Code 128 barcode as a crisp vector drawing that any scanner reads, at any size. */
export function Barcode({ text, height = 28, className }: { text: string; height?: number; className?: string }) {
  if (!canEncode128(text)) return <span className="text-[9px] text-ink-muted">{text}</span>;
  const quiet = 10;
  const widths = code128Widths(text);
  const total = widths.reduce((a, b) => a + b, 0) + quiet * 2;
  let x = quiet;
  const bars: { x: number; w: number }[] = [];
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w });
    x += w;
  });
  return (
    <svg viewBox={`0 0 ${total} 10`} preserveAspectRatio="none" role="img" aria-label={`Barcode ${text}`} className={className} style={{ height, width: '100%' }} shapeRendering="crispEdges">
      <rect width={total} height="10" fill="#fff" />
      {bars.map((b) => (
        <rect key={b.x} x={b.x} y="0" width={b.w} height="10" fill="#000" />
      ))}
    </svg>
  );
}
