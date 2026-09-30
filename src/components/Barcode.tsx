import { canEncode128, code128Bars } from '../../shared/barcode';

/** A Code 128 barcode as an SVG that stretches to fill its box (scanners want the bars crisp, so no anti-aliasing). */
export function Barcode({ value, className }: { value: string; className?: string }) {
  if (!canEncode128(value)) return null;
  const { bars, modules } = code128Bars(value);
  const quiet = 10; // the blank margin scanners need either side
  return (
    <svg viewBox={`0 0 ${modules + quiet * 2} 1`} preserveAspectRatio="none" className={className} role="img" aria-label={`Barcode ${value}`} shapeRendering="crispEdges">
      {bars.map((b) => (
        <rect key={b.x} x={b.x + quiet} y={0} width={b.w} height={1} fill="#000" />
      ))}
    </svg>
  );
}
