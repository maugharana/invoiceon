import { formatMoney } from '../../shared/money';
import { LABEL_LAYOUTS, type LabelItem, type LabelLayout } from '../../shared/types';
import { Barcode } from './Barcode';
import { QrCode } from './UpiQr';

/** One label: who sells it, what it is, its price, and its code as a barcode (and a QR code where there is room). */
function Label({ item, layout }: { item: LabelItem; layout: LabelLayout }) {
  const l = LABEL_LAYOUTS[layout];
  const small = l.heightMm < 32;
  return (
    <div className="box-border flex h-full w-full flex-col justify-between overflow-hidden px-[2.5mm] py-[2.5mm] text-ink" style={{ fontSize: small ? '6.5pt' : '7.5pt', lineHeight: 1.2 }}>
      <div className="min-h-0">
        <div className="truncate text-[0.85em] uppercase tracking-wide text-ink-muted">{item.shop}</div>
        <div className="line-clamp-2 font-medium">{item.designName}</div>
        <div className="truncate text-ink-muted">
          {item.color} · {item.size}
        </div>
      </div>
      <div className="flex items-end justify-between gap-[2mm]">
        <div className="min-w-0 flex-1">
          <Barcode value={item.sku} className="h-[7mm] w-full" />
          <div className="num truncate text-[0.9em]">{item.sku}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-[1mm]">
          {l.qr && <QrCode text={item.sku} size={small ? 38 : 48} label={`QR code of ${item.sku}`} />}
          {item.pricePaise > 0 && <div className="num text-[1.25em] font-medium">{formatMoney(item.pricePaise, { fractionDigits: 0 })}</div>}
        </div>
      </div>
    </div>
  );
}

/** A page of labels: a grid for sheets, one label to a page for a roll. `labels` is already repeated once for each copy. */
export function LabelSheet({ labels, layout }: { labels: LabelItem[]; layout: LabelLayout }) {
  const l = LABEL_LAYOUTS[layout];
  const perPage = l.columns * l.rows;
  const pages = Array.from({ length: Math.max(1, Math.ceil(labels.length / perPage)) }, (_, p) => labels.slice(p * perPage, (p + 1) * perPage));
  // On a roll each label is its own page, cut to the label's size, so the printer feeds one label at a time.
  const rollPage = layout === 'roll' ? `@page { size: ${l.widthMm}mm ${l.heightMm}mm; margin: 0; }` : '@page { size: A4; margin: 0; }';
  return (
    <div>
      <style>{`@media print { ${rollPage} .label-page { box-shadow: none !important; margin: 0 !important; } }`}</style>
      {pages.map((page, p) => (
        <section
          key={p}
          className="label-page mx-auto mb-4 bg-white shadow-card print:mb-0"
          style={{
            width: `${l.columns * l.widthMm}mm`,
            height: `${l.rows * l.heightMm}mm`,
            display: 'grid',
            gridTemplateColumns: `repeat(${l.columns}, ${l.widthMm}mm)`,
            gridAutoRows: `${l.heightMm}mm`,
            breakAfter: p < pages.length - 1 ? 'page' : 'auto',
          }}
        >
          {page.map((item, i) => (
            <div key={i} className="overflow-hidden border border-dashed border-line print:border-transparent">
              <Label item={item} layout={layout} />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
