import { addDays } from '../../shared/gst';
import type { DeadStock, ReorderRow } from '../../shared/types';
import { all, type Db } from '../db/connection';
import { listDesigns, loadVariants } from './inventory';

/** Every variant that is low or out, by saree then colour: the list to reorder from. */
export function reorderList(db: Db): ReorderRow[] {
  const designs = new Map(listDesigns(db).map((d) => [d.id, d]));
  return loadVariants(db)
    .filter((v) => designs.has(v.designId) && (v.status === 'low' || v.status === 'out'))
    .map((v) => ({ designId: v.designId, designName: designs.get(v.designId)!.name, nickname: designs.get(v.designId)!.nickname, color: v.color, size: v.size, stock: v.stock, reorderLevel: v.reorderLevel }))
    .sort((a, b) => a.designName.localeCompare(b.designName) || a.color.localeCompare(b.color) || a.size.localeCompare(b.size));
}

/** Stock that has sat this long without a sale counts as not selling. */
export const DEAD_STOCK_DAYS = 90;
const SHOWN = 5;

/**
 * Pieces on the shelf that haven't sold in the last 90 days. A piece only counts once it has been on the shelf that long
 * itself, so a saree that arrived last week isn't "dead" just because it hasn't had time to sell. Grouped by design, biggest
 * money tied up (at cost) first.
 */
export function deadStock(db: Db, today: string): DeadStock {
  const cutoff = addDays(today, -DEAD_STOCK_DAYS);
  const lastSold = new Map(
    all<{ variant_id: string; d: string }>(db, "SELECT l.variant_id, MAX(i.issue_date) AS d FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE i.status = 'issued' GROUP BY l.variant_id").map((r) => [r.variant_id, r.d]),
  );
  // The ledger stores UTC timestamps; the first 10 characters are the date, which is plenty for a 90-day rule.
  const arrived = new Map(all<{ variant_id: string; d: string }>(db, 'SELECT variant_id, MIN(created_at) AS d FROM stock_movements GROUP BY variant_id').map((r) => [r.variant_id, r.d.slice(0, 10)]));

  const designs = new Map(listDesigns(db).map((d) => [d.id, d]));
  const byDesign = new Map<string, { pieces: number; costValuePaise: number; variants: number; lastSoldOn: string | null }>();
  for (const v of loadVariants(db)) {
    if (v.stock <= 0 || !designs.has(v.designId)) continue;
    const sold = lastSold.get(v.id) ?? null;
    if (sold !== null && sold >= cutoff) continue; // sold recently
    if ((arrived.get(v.id) ?? today) >= cutoff) continue; // too new to judge
    const d = byDesign.get(v.designId) ?? { pieces: 0, costValuePaise: 0, variants: 0, lastSoldOn: null };
    d.pieces += v.stock;
    d.costValuePaise += v.stock * v.unitCostPaise;
    d.variants += 1;
    if (sold !== null && (d.lastSoldOn === null || sold > d.lastSoldOn)) d.lastSoldOn = sold;
    byDesign.set(v.designId, d);
  }

  const rows = [...byDesign.entries()]
    .map(([designId, d]) => ({ designId, name: designs.get(designId)!.name, ...d }))
    .sort((a, b) => b.costValuePaise - a.costValuePaise || a.name.localeCompare(b.name));
  return {
    days: DEAD_STOCK_DAYS,
    designCount: rows.length,
    pieces: rows.reduce((s, r) => s + r.pieces, 0),
    costValuePaise: rows.reduce((s, r) => s + r.costValuePaise, 0),
    designs: rows.slice(0, SHOWN),
  };
}
