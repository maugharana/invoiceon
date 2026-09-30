// Design photos and the printable catalogue. A catalogue is a request (which designs, with or without prices) carried in the print
// page's address, exactly like the label request, so the desktop app can render it in a hidden window and save it as a PDF.

import type { Paise } from './money';

export const MAX_PHOTOS_PER_DESIGN = 6;
export const MAX_PHOTO_BYTES = 1_500_000;
export const MAX_THUMB_BYTES = 150_000;
export const MAX_CATALOGUE_DESIGNS = 200;

export interface DesignPhoto {
  id: string;
  designId: string;
  /** 0 is the cover: the photo the lists and the catalogue show. */
  position: number;
  /** Data URLs, ready to use as an image source. */
  image: string;
  thumb: string;
}

export interface DesignPhotoInput {
  image: string;
  thumb: string;
}

export interface CatalogueRequest {
  title: string;
  /** Empty means every design. */
  designIds: string[];
  /** Leave out designs (and colours) with nothing in stock. */
  inStockOnly: boolean;
  showPrices: boolean;
  columns: 2 | 3;
}

export const DEFAULT_CATALOGUE: CatalogueRequest = { title: 'Catalogue', designIds: [], inStockOnly: true, showPrices: true, columns: 3 };

export function encodeCatalogueRequest(r: CatalogueRequest): string {
  const q = new URLSearchParams({ title: r.title.slice(0, 80), stock: r.inStockOnly ? '1' : '0', price: r.showPrices ? '1' : '0', cols: String(r.columns) });
  if (r.designIds.length) q.set('designs', r.designIds.join(','));
  return q.toString();
}

/** Reads a request back, ignoring anything malformed rather than trusting it. */
export function parseCatalogueRequest(query: string): CatalogueRequest {
  const params = new URLSearchParams(query.replace(/^\?/, ''));
  const ids = (params.get('designs') ?? '')
    .split(',')
    .filter((id) => /^[A-Za-z0-9-]{8,64}$/.test(id))
    .slice(0, MAX_CATALOGUE_DESIGNS);
  return {
    title: (params.get('title') ?? '').trim().slice(0, 80) || DEFAULT_CATALOGUE.title,
    designIds: ids,
    inStockOnly: params.get('stock') !== '0',
    showPrices: params.get('price') !== '0',
    columns: params.get('cols') === '2' ? 2 : 3,
  };
}

export interface CatalogueVariant {
  color: string;
  size: string;
  stock: number;
  sellPricePaise: Paise;
  mrpPaise: Paise;
}

export interface CatalogueItem {
  designId: string;
  code: string;
  name: string;
  fabric: string;
  description: string;
  /** The cover photo, or null. */
  photo: string | null;
  variants: CatalogueVariant[];
}

export interface CatalogueData {
  title: string;
  businessName: string;
  phone: string;
  city: string;
  items: CatalogueItem[];
}

/** The price to print under a design: the printed MRP range when every piece has one, else the selling price range plus GST. */
export function cataloguePrice(variants: CatalogueVariant[]): { fromPaise: Paise; toPaise: Paise; plusGst: boolean } | null {
  if (variants.length === 0) return null;
  const allMrp = variants.every((v) => v.mrpPaise > 0);
  const prices = variants.map((v) => (allMrp ? v.mrpPaise : v.sellPricePaise));
  return { fromPaise: Math.min(...prices), toPaise: Math.max(...prices), plusGst: !allMrp };
}

/** The colours of a design with how many pieces each has, most in stock first. */
export function coloursOf(variants: CatalogueVariant[]): { color: string; pieces: number }[] {
  const by = new Map<string, number>();
  for (const v of variants) by.set(v.color, (by.get(v.color) ?? 0) + v.stock);
  return [...by].map(([color, pieces]) => ({ color, pieces })).sort((a, b) => b.pieces - a.pieces || a.color.localeCompare(b.color));
}
