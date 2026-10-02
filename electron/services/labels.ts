import { shopperPricePaise } from '../../shared/websiteText';
import { LABEL_LAYOUTS, type LabelItem, type LabelLayout } from '../../shared/types';
import { all, type Db } from '../db/connection';
import { UserError } from './common';
import { getSettings } from './settings';

const MAX_LABELS = 2000;

/** What each piece needs on a label, in the order asked for. Pieces that no longer exist are left out. */
export function labelItems(db: Db, ids: string[]): LabelItem[] {
  if (!Array.isArray(ids)) throw new UserError('Choose the pieces to label.');
  if (ids.length > 500) throw new UserError('Label up to 500 pieces at a time.');
  const settings = getSettings(db);
  const found = new Map(
    all<{ id: string; sku: string; design_name: string; nickname: string; color: string; size: string; sell: number; mrp: number; rate: number | null }>(
      db,
      `SELECT v.id, v.sku, d.name AS design_name, d.nickname, v.color, v.size, v.sell_price_paise AS sell, v.mrp_paise AS mrp, d.gst_rate_percent AS rate
       FROM variants v JOIN designs d ON d.id = v.design_id WHERE v.deleted_at IS NULL AND d.deleted_at IS NULL`,
    ).map((r) => [r.id, r]),
  );
  return ids.flatMap((id) => {
    const r = found.get(id);
    return r ? [{ variantId: r.id, sku: r.sku, designName: r.design_name, nickname: r.nickname, color: r.color, size: r.size, pricePaise: shopperPricePaise({ mrpPaise: r.mrp, sellPricePaise: r.sell }, r.rate ?? settings.gstRatePercent), shop: settings.businessName }] : [];
  });
}

/** Refuses a request that is empty, too big, or in a layout that doesn't exist, before a window is opened for it. */
export function checkLabels(db: Db, items: { variantId: string; copies: number }[], layout: LabelLayout): void {
  if (!(layout in LABEL_LAYOUTS)) throw new UserError('Choose a label layout.');
  if (!Array.isArray(items) || items.length === 0) throw new UserError('Choose at least one piece to label.');
  const total = items.reduce((s, i) => s + (Number.isInteger(i.copies) && i.copies > 0 ? i.copies : 0), 0);
  if (total <= 0) throw new UserError('Choose how many labels of at least one piece.');
  if (total > MAX_LABELS) throw new UserError(`Print up to ${MAX_LABELS} labels at a time.`);
  if (labelItems(db, items.map((i) => i.variantId)).length === 0) throw new UserError('None of those pieces exist any more.');
}

/** The print window's address for a set of labels. Nothing in it is trusted: the page checks what it reads. */
export const labelsRoute = (items: { variantId: string; copies: number }[], layout: LabelLayout): string =>
  `/print/labels?items=${items.filter((i) => i.copies > 0).map((i) => `${encodeURIComponent(i.variantId)}:${i.copies}`).join(',')}&layout=${encodeURIComponent(layout)}`;
