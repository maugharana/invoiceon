import { canEncode128 } from '../../shared/barcode';
import { formatMoney } from '../../shared/money';
import type { LabelSize } from '../../shared/labels';
import type { SaleVariant } from '../../shared/types';
import { Barcode } from './Barcode';

/** One saree label: what it is, a barcode of its SKU that the invoice screen can scan, and its price. Sized in real millimetres. */
export function LabelCard({ variant: v, size, businessName, showPrice, showBusiness }: { variant: SaleVariant; size: LabelSize; businessName: string; showPrice: boolean; showBusiness: boolean }) {
  const small = size.heightMm < 30;
  const price = v.mrpPaise > 0 ? `MRP ${formatMoney(v.mrpPaise, { fractionDigits: 0 })}` : `${formatMoney(v.sellPricePaise, { fractionDigits: 0 })} + GST`;
  return (
    <div
      className="label-card box-border flex flex-col justify-between overflow-hidden bg-white text-black"
      style={{ width: `${size.widthMm}mm`, height: `${size.heightMm}mm`, padding: small ? '1.2mm 1.6mm' : '2mm 2.5mm', fontSize: small ? '6.5pt' : '8pt', lineHeight: 1.15 }}
    >
      <div>
        {showBusiness && businessName && <div style={{ fontSize: small ? '5.5pt' : '7pt', letterSpacing: '0.04em' }} className="truncate uppercase opacity-70">{businessName}</div>}
        <div className="truncate font-medium" style={{ fontSize: small ? '7.5pt' : '10pt' }}>{v.designName}</div>
        <div className="truncate opacity-80">{v.color} · {v.size}</div>
      </div>
      <div className="min-h-0 flex-1 py-[0.6mm]">
        {canEncode128(v.sku) ? <Barcode value={v.sku} className="h-full w-full" /> : <div className="flex h-full items-center justify-center text-[6pt] opacity-60">No barcode: SKU has special characters</div>}
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="num truncate" style={{ fontSize: small ? '5.5pt' : '7pt' }}>{v.sku}</span>
        {showPrice && <span className="num shrink-0 font-medium" style={{ fontSize: small ? '8pt' : '11pt' }}>{price}</span>}
      </div>
    </div>
  );
}
