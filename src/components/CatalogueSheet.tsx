import { Shirt } from 'lucide-react';
import { cataloguePrice, coloursOf, type CatalogueData } from '../../shared/catalogue';
import { formatMoney } from '../../shared/money';

/**
 * The catalogue as paper: a title block, then a grid of designs, each with its photo, colours and price. Sized for A4, flowing onto as many
 * pages as it needs, and never splitting a design across two pages. Shared by the print page and the preview.
 */
export function CatalogueSheet({ data, columns, showPrices, inStockOnly }: { data: CatalogueData; columns: 2 | 3; showPrices: boolean; inStockOnly: boolean }) {
  return (
    <div className="catalogue bg-white text-black" style={{ width: '210mm', padding: '12mm 10mm', boxSizing: 'border-box' }}>
      <header className="mb-5 border-b border-black/20 pb-3">
        <div className="text-[9pt] uppercase tracking-[0.12em] opacity-60">{data.businessName}</div>
        <h1 className="text-[22pt] leading-tight">{data.title}</h1>
        <div className="text-[9pt] opacity-70">{[data.city, data.phone].filter(Boolean).join(' · ')}</div>
      </header>
      <div className="grid gap-x-4 gap-y-5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {data.items.map((item) => {
          const price = showPrices ? cataloguePrice(item.variants) : null;
          const colours = coloursOf(item.variants);
          return (
            <article key={item.designId} className="catalogue-card" style={{ breakInside: 'avoid' }}>
              <div className="flex w-full items-center justify-center overflow-hidden rounded-md border border-black/15 bg-neutral-100" style={{ aspectRatio: '4 / 5' }}>
                {item.photo ? <img src={item.photo} alt={item.name} className="h-full w-full object-cover" /> : <Shirt className="h-10 w-10 opacity-25" aria-hidden />}
              </div>
              <div className="mt-1.5 text-[10.5pt] font-medium leading-tight">{item.name}</div>
              <div className="text-[8pt] opacity-65">
                {item.code}
                {item.fabric ? ` · ${item.fabric}` : ''}
              </div>
              {colours.length > 0 && (
                <div className="mt-0.5 text-[8.5pt] leading-snug opacity-85">
                  {colours.map((c) => (inStockOnly ? c.color : `${c.color}${c.pieces === 0 ? ' (out)' : ''}`)).join(', ')}
                </div>
              )}
              {price && (
                <div className="mt-0.5 text-[10.5pt] font-medium">
                  {price.fromPaise === price.toPaise ? formatMoney(price.fromPaise, { fractionDigits: 0 }) : `${formatMoney(price.fromPaise, { fractionDigits: 0 })} to ${formatMoney(price.toPaise, { fractionDigits: 0 })}`}
                  <span className="ml-1 text-[8pt] font-normal opacity-65">{price.plusGst ? '+ GST' : 'MRP'}</span>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {data.items.length === 0 && <p className="py-10 text-center opacity-60">Nothing to show. Add designs with some pieces in stock, or include the ones that are out of stock.</p>}
    </div>
  );
}
