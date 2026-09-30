// What a printed label looks like and how a print request travels. The labels page and the bare print page (which the desktop app
// renders in a hidden window to print or save as PDF) both read the same request, carried in the page's address.

export interface LabelSize {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  /** A sheet places several labels on an A4 page; a roll prints one label per page. */
  sheet?: { cols: number; rows: number };
}

export const LABEL_SIZES: LabelSize[] = [
  { id: 'roll-50x25', name: '50 × 25 mm roll', widthMm: 50, heightMm: 25 },
  { id: 'roll-38x25', name: '38 × 25 mm roll', widthMm: 38, heightMm: 25 },
  { id: 'roll-75x50', name: '75 × 50 mm roll', widthMm: 75, heightMm: 50 },
  { id: 'a4-3x8', name: 'A4 sheet, 24 labels (70 × 37 mm)', widthMm: 70, heightMm: 37, sheet: { cols: 3, rows: 8 } },
  { id: 'a4-2x5', name: 'A4 sheet, 10 labels (99 × 57 mm)', widthMm: 99, heightMm: 57, sheet: { cols: 2, rows: 5 } },
];

export const DEFAULT_LABEL_SIZE = 'roll-50x25';
export const labelSizeById = (id: string): LabelSize => LABEL_SIZES.find((s) => s.id === id) ?? LABEL_SIZES[0]!;

export interface LabelRequest {
  size: string;
  showPrice: boolean;
  showBusiness: boolean;
  /** How many labels of each saree. */
  items: { variantId: string; copies: number }[];
}

export const MAX_LABELS = 2000;

/** The request as a query string. Ids are UUIDs, so nothing needs escaping and nothing unexpected can ride along. */
export function encodeLabelRequest(r: LabelRequest): string {
  const items = r.items.filter((i) => i.copies > 0).map((i) => `${i.variantId}:${Math.floor(i.copies)}`).join(',');
  return `size=${r.size}&price=${r.showPrice ? 1 : 0}&biz=${r.showBusiness ? 1 : 0}&items=${items}`;
}

/** Reads a request back, ignoring anything malformed rather than trusting it. */
export function parseLabelRequest(query: string): LabelRequest {
  const params = new URLSearchParams(query.replace(/^\?/, ''));
  const items: LabelRequest['items'] = [];
  let total = 0;
  for (const part of (params.get('items') ?? '').split(',')) {
    const [variantId, n] = part.split(':');
    const copies = Number(n);
    if (!variantId || !/^[A-Za-z0-9-]{8,64}$/.test(variantId) || !Number.isInteger(copies) || copies < 1) continue;
    const take = Math.min(copies, MAX_LABELS - total);
    if (take <= 0) break;
    items.push({ variantId, copies: take });
    total += take;
  }
  return { size: labelSizeById(params.get('size') ?? '').id, showPrice: params.get('price') !== '0', showBusiness: params.get('biz') !== '0', items };
}
