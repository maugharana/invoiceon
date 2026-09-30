// Places stock is kept besides the shop. The shop is the selling location: what is "in stock" everywhere in the app is what is on its shelves.
// A godown or an exhibition stall holds pieces that have been moved there, and moving them back makes them sellable again.

import type { Paise } from './money';

export const SHOP_LABEL = 'Shop';

export interface Location {
  id: string;
  name: string;
  /** Pieces held here across every saree. */
  pieces: number;
  /** What they cost. */
  valueAtCostPaise: Paise;
  /** How many different sarees are here. */
  variants: number;
}

export interface TransferInput {
  variantId: string;
  /** null means the shop. */
  fromId: string | null;
  toId: string | null;
  qty: number;
  note: string;
}

export interface TransferRecord {
  id: string;
  variantId: string;
  sku: string;
  designName: string;
  color: string;
  size: string;
  fromName: string;
  toName: string;
  qty: number;
  note: string;
  createdAt: string;
}

/** One saree with what the shop holds and what each other place holds. */
export interface HoldingRow {
  variantId: string;
  designId: string;
  designName: string;
  color: string;
  size: string;
  sku: string;
  shop: number;
  /** By location id. */
  elsewhere: Record<string, number>;
  total: number;
}
