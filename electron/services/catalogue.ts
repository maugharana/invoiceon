import type { CatalogueData, CatalogueItem, CatalogueRequest } from '../../shared/catalogue';
import { all, type Db } from '../db/connection';
import { getSettings } from './settings';
import { coverImages } from './photos';

/** What the catalogue page prints: each wanted design with its cover photo and its pieces. Costs are never part of it. */
export function catalogueData(db: Db, req: CatalogueRequest): CatalogueData {
  const settings = getSettings(db);
  const rows = all<{ design_id: string; code: string; name: string; fabric: string; description: string; color: string; size: string; stock: number; sell_price_paise: number; mrp_paise: number }>(
    db,
    `SELECT d.id AS design_id, d.code, d.name, d.fabric, d.description, v.color, v.size, v.stock, v.sell_price_paise, v.mrp_paise
     FROM designs d JOIN variants v ON v.design_id = d.id
     WHERE d.deleted_at IS NULL AND v.deleted_at IS NULL
     ORDER BY d.name COLLATE NOCASE, v.color COLLATE NOCASE, v.size COLLATE NOCASE`,
  );
  const wanted = new Set(req.designIds);
  const byDesign = new Map<string, CatalogueItem>();
  for (const r of rows) {
    if (wanted.size > 0 && !wanted.has(r.design_id)) continue;
    if (req.inStockOnly && r.stock <= 0) continue;
    const item = byDesign.get(r.design_id) ?? { designId: r.design_id, code: r.code, name: r.name, fabric: r.fabric, description: r.description, photo: null, variants: [] };
    item.variants.push({ color: r.color, size: r.size, stock: r.stock, sellPricePaise: r.sell_price_paise, mrpPaise: r.mrp_paise });
    byDesign.set(r.design_id, item);
  }
  const items = [...byDesign.values()];
  const photos = coverImages(db, items.map((i) => i.designId));
  for (const i of items) i.photo = photos.get(i.designId) ?? null;
  return { title: req.title, businessName: settings.businessName, phone: settings.phone, city: settings.city, items };
}
