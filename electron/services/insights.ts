import { addDays, localDateOf, todayIso } from '../../shared/gst';
import { checkParams, daysOfCover, isUrgent, perDay, suggestedQty, type DeadStockRow, type InsightParams, type ReorderRow, type StockInsights } from '../../shared/insights';
import { all, type Db } from '../db/connection';
import { elsewhereByVariant, loadVariants } from './inventory';

/**
 * What is worth making or buying, and what is not moving. Sales are pieces on issued invoices in the look-back period, less pieces that came
 * back on credit notes; "on order" is what open weaver orders still owe. Nothing is changed; this only reads.
 */
export function stockInsights(db: Db, input?: Partial<InsightParams>): StockInsights {
  const params = checkParams(input);
  const today = todayIso();
  const since = addDays(today, -params.lookbackDays);
  const deadBefore = addDays(today, -params.deadDays);

  const sold = new Map(
    all<{ variant_id: string; q: number }>(
      db,
      `SELECT l.variant_id, SUM(l.qty) AS q FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
       WHERE i.status = 'issued' AND i.issue_date > ? AND i.issue_date <= ? GROUP BY l.variant_id`,
      since,
      today,
    ).map((r) => [r.variant_id, r.q]),
  );
  const returned = new Map(
    all<{ variant_id: string; q: number }>(
      db,
      `SELECT l.variant_id, SUM(l.qty) AS q FROM credit_note_lines l JOIN credit_notes c ON c.id = l.credit_note_id
       WHERE c.status = 'issued' AND c.kind = 'return' AND l.variant_id IS NOT NULL AND c.issue_date > ? AND c.issue_date <= ? GROUP BY l.variant_id`,
      since,
      today,
    ).map((r) => [r.variant_id, r.q]),
  );
  const lastSold = new Map(
    all<{ variant_id: string; d: string }>(db, "SELECT l.variant_id, MAX(i.issue_date) AS d FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE i.status = 'issued' GROUP BY l.variant_id").map((r) => [r.variant_id, r.d]),
  );
  const onOrder = new Map(
    all<{ variant_id: string; q: number }>(
      db,
      `SELECT o.variant_id, SUM(o.qty - COALESCE((SELECT SUM(r.qty) FROM job_order_receipts r WHERE r.order_id = o.id AND r.reversed_at IS NULL), 0)) AS q
       FROM job_orders o WHERE o.status = 'open' GROUP BY o.variant_id`,
    ).map((r) => [r.variant_id, Math.max(0, r.q)]),
  );
  const created = new Map(all<{ id: string; created_at: string }>(db, 'SELECT id, created_at FROM variants WHERE deleted_at IS NULL').map((r) => [r.id, localDateOf(r.created_at)]));
  const names = new Map(all<{ id: string; name: string }>(db, 'SELECT id, name FROM designs').map((r) => [r.id, r.name]));

  const elsewhere = elsewhereByVariant(db);
  const reorder: ReorderRow[] = [];
  const dead: DeadStockRow[] = [];
  for (const v of loadVariants(db)) {
    const designName = names.get(v.designId) ?? '';
    const netSold = Math.max(0, (sold.get(v.id) ?? 0) - (returned.get(v.id) ?? 0));
    const rate = perDay(netSold, params.lookbackDays);
    const ordered = onOrder.get(v.id) ?? 0;
    // Pieces in a godown can be brought to the shop, so they count as on hand when deciding what to make or buy.
    const away = elsewhere.get(v.id) ?? 0;
    const qty = suggestedQty({ stock: v.stock + away, onOrder: ordered, perDay: rate, reorderLevel: v.reorderLevel, leadDays: params.leadDays, coverDays: params.coverDays });
    if (qty > 0) {
      reorder.push({
        variantId: v.id,
        designId: v.designId,
        designName,
        color: v.color,
        size: v.size,
        sku: v.sku,
        stock: v.stock,
        elsewhere: away,
        onOrder: ordered,
        soldInPeriod: netSold,
        perDay: rate,
        daysOfCover: daysOfCover(v.stock + away, rate),
        suggestedQty: qty,
        urgent: isUrgent(v.stock + away, rate, params.leadDays, ordered),
        unitCostPaise: v.unitCostPaise,
        costOfBatchPaise: qty * v.unitCostPaise,
      });
    }

    // Dead: pieces on the shelf that have not sold for a long time. A piece added recently has not had the chance to sell yet.
    const last = lastSold.get(v.id) ?? null;
    const since0 = last ?? created.get(v.id) ?? today;
    if (v.stock > 0 && since0 < deadBefore) {
      dead.push({
        variantId: v.id,
        designId: v.designId,
        designName,
        color: v.color,
        size: v.size,
        sku: v.sku,
        stock: v.stock,
        lastSoldOn: last,
        idleDays: Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${since0}T00:00:00Z`)) / 86_400_000),
        unitCostPaise: v.unitCostPaise,
        tiedUpPaise: v.stock * v.unitCostPaise,
        sellPricePaise: v.sellPricePaise,
      });
    }
  }
  reorder.sort((a, b) => Number(b.urgent) - Number(a.urgent) || (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity) || b.suggestedQty - a.suggestedQty);
  dead.sort((a, b) => b.tiedUpPaise - a.tiedUpPaise);

  return {
    params,
    asOf: today,
    reorder,
    dead,
    totals: {
      urgent: reorder.filter((r) => r.urgent).length,
      reorderPieces: reorder.reduce((s, r) => s + r.suggestedQty, 0),
      reorderCostPaise: reorder.reduce((s, r) => s + r.costOfBatchPaise, 0),
      deadPieces: dead.reduce((s, d) => s + d.stock, 0),
      deadTiedUpPaise: dead.reduce((s, d) => s + d.tiedUpPaise, 0),
    },
  };
}
