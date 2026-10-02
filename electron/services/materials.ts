import { mulPaise } from '../../shared/money';
import type { Material, MaterialInput, MaterialMovement, MaterialMovementReason, MaterialPricePoint, Simulation, SimulationRow } from '../../shared/types';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, isUniqueViolation, newId, nowIso, optionalText, requireInt, requireText } from './common';
import { listDesigns, loadVariants } from './inventory';
import { getSettings } from './settings';

interface MaterialRow {
  id: string;
  name: string;
  unit: string;
  unit_cost_paise: number;
  used_in: number;
  category: string;
  stock_qty: number;
  reorder_qty: number;
  supplier_id: string | null;
  supplier_name: string | null;
}

const SELECT = `
  SELECT m.id, m.name, m.unit, m.unit_cost_paise, m.category, m.stock_qty, m.reorder_qty, m.supplier_id, s.name AS supplier_name,
    (SELECT COUNT(*) FROM variant_materials vm JOIN variants v ON v.id = vm.variant_id AND v.deleted_at IS NULL WHERE vm.material_id = m.id) AS used_in
  FROM raw_materials m LEFT JOIN vendors s ON s.id = m.supplier_id WHERE m.deleted_at IS NULL`;

/** Quantities are decimals (metres, kilograms); rounding to a thousandth keeps sums like 0.1 + 0.2 from leaving dust. */
export const roundQty = (n: number): number => Math.round(n * 1000) / 1000;

const statusOf = (stock: number, reorder: number): Material['status'] => (reorder <= 0 ? 'ok' : stock <= 0 ? 'out' : stock <= reorder ? 'low' : 'ok');

const toMaterial = (r: MaterialRow): Material => ({
  id: r.id,
  name: r.name,
  unit: r.unit,
  unitCostPaise: r.unit_cost_paise,
  usedInCount: r.used_in,
  category: r.category,
  stockQty: roundQty(r.stock_qty),
  reorderQty: r.reorder_qty,
  status: statusOf(r.stock_qty, r.reorder_qty),
  supplierId: r.supplier_id,
  supplierName: r.supplier_name ?? '',
});

function validate(db: Db, input: MaterialInput) {
  const reorder = input.reorderQty === undefined ? 0 : input.reorderQty;
  if (typeof reorder !== 'number' || !Number.isFinite(reorder) || reorder < 0 || reorder > 1_000_000) throw new UserError('The reorder quantity should be zero or more.');
  const opening = input.openingQty === undefined ? 0 : input.openingQty;
  if (typeof opening !== 'number' || !Number.isFinite(opening) || opening < 0 || opening > 1_000_000) throw new UserError('The quantity in hand should be zero or more.');
  const supplierId = input.supplierId || null;
  if (supplierId && !get(db, 'SELECT 1 AS x FROM vendors WHERE id = ? AND deleted_at IS NULL', supplierId)) throw new UserError('That supplier no longer exists.');
  return {
    name: requireText(input.name, 'Material name'),
    unit: requireText(input.unit, 'Unit', 20),
    unitCostPaise: requireInt(input.unitCostPaise, 'Cost per unit', { max: 100_000_000_00 }),
    category: optionalText(input.category ?? '', 'Category', 40),
    reorderQty: roundQty(reorder),
    openingQty: roundQty(opening),
    supplierId,
  };
}

export function listMaterials(db: Db): Material[] {
  return all<MaterialRow>(db, `${SELECT} ORDER BY m.name COLLATE NOCASE`).map(toMaterial);
}

export function getMaterial(db: Db, id: string): Material {
  const row = get<MaterialRow>(db, `${SELECT} AND m.id = ?`, id);
  if (!row) throw new UserError('That material no longer exists.');
  return toMaterial(row);
}

function recordPrice(db: Db, materialId: string, unitCostPaise: number, source: MaterialPricePoint['source'], at = nowIso()): void {
  run(db, 'INSERT INTO material_prices (id, material_id, unit_cost_paise, source, changed_at) VALUES (?, ?, ?, ?, ?)', newId(), materialId, unitCostPaise, source, at);
}

/** Moves a material's stock and writes the ledger line. Callers wrap it in their own transaction when it is part of a bigger step. */
export function recordMaterialMovement(db: Db, materialId: string, delta: number, reason: MaterialMovementReason, note = '', ref?: { type: string; id: string }): void {
  const row = get<{ stock_qty: number; name: string; unit: string }>(db, 'SELECT stock_qty, name, unit FROM raw_materials WHERE id = ? AND deleted_at IS NULL', materialId);
  if (!row) throw new UserError('That material no longer exists.');
  const d = roundQty(delta);
  if (d === 0) return;
  const balance = roundQty(row.stock_qty + d);
  if (balance < 0) throw new UserError(`Not enough ${row.name}: ${roundQty(row.stock_qty)} ${row.unit} in hand, so ${roundQty(Math.abs(d))} ${row.unit} can't be taken out.`);
  const now = nowIso();
  run(db, 'UPDATE raw_materials SET stock_qty = ?, updated_at = ? WHERE id = ?', balance, now, materialId);
  run(db, 'INSERT INTO material_movements (id, material_id, delta, balance_after, reason, note, ref_type, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', newId(), materialId, d, balance, reason, note, ref?.type ?? null, ref?.id ?? null, now);
}

export function createMaterial(db: Db, input: MaterialInput): Material {
  const v = validate(db, input);
  const id = newId();
  const now = nowIso();
  tx(db, () => {
    try {
      run(db, 'INSERT INTO raw_materials (id, name, unit, unit_cost_paise, category, reorder_qty, supplier_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, v.name, v.unit, v.unitCostPaise, v.category, v.reorderQty, v.supplierId, now, now);
    } catch (err) {
      if (isUniqueViolation(err)) throw new UserError(`A material named "${v.name}" already exists.`);
      throw err;
    }
    recordPrice(db, id, v.unitCostPaise, 'opening', now);
    if (v.openingQty > 0) recordMaterialMovement(db, id, v.openingQty, 'opening');
  });
  return getMaterial(db, id);
}

/** Changing the price writes it into the history. Stock is not edited here: it moves through purchases and adjustments. */
export function updateMaterial(db: Db, id: string, input: MaterialInput): Material {
  const v = validate(db, input);
  const before = getMaterial(db, id);
  tx(db, () => {
    try {
      run(db, 'UPDATE raw_materials SET name = ?, unit = ?, unit_cost_paise = ?, category = ?, reorder_qty = ?, supplier_id = ?, updated_at = ? WHERE id = ?', v.name, v.unit, v.unitCostPaise, v.category, v.reorderQty, v.supplierId, nowIso(), id);
    } catch (err) {
      if (isUniqueViolation(err)) throw new UserError(`A material named "${v.name}" already exists.`);
      throw err;
    }
    if (v.unitCostPaise !== before.unitCostPaise) recordPrice(db, id, v.unitCostPaise, 'manual');
  });
  return getMaterial(db, id);
}

/** Sets a material's price from a purchase: the latest price paid becomes its cost. Does nothing if it is unchanged. */
export function setPriceFromPurchase(db: Db, id: string, unitCostPaise: number): boolean {
  const m = getMaterial(db, id);
  if (m.unitCostPaise === unitCostPaise) return false;
  run(db, 'UPDATE raw_materials SET unit_cost_paise = ?, updated_at = ? WHERE id = ?', unitCostPaise, nowIso(), id);
  recordPrice(db, id, unitCostPaise, 'purchase');
  return true;
}

export function deleteMaterial(db: Db, id: string): void {
  const material = getMaterial(db, id);
  if (material.usedInCount > 0) {
    const n = material.usedInCount;
    throw new UserError(`"${material.name}" is used in the costing of ${n} variant${n === 1 ? '' : 's'}. Remove it from those first.`);
  }
  run(db, 'UPDATE raw_materials SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
}

// ── Stock by hand ───────────────────────────────────────────────────────────
const MANUAL_REASONS: MaterialMovementReason[] = ['used', 'wastage', 'adjustment'];

/** A correction, or material used up or wasted, entered by hand. Buying goes through a purchase so the price and the bill are kept. */
export function adjustMaterial(db: Db, input: { materialId: string; delta: number; reason: MaterialMovementReason; note?: string }): Material {
  if (!MANUAL_REASONS.includes(input.reason)) throw new UserError('Choose used, wasted, or a count correction. Use a purchase for material you bought.');
  if (typeof input.delta !== 'number' || !Number.isFinite(input.delta) || input.delta === 0) throw new UserError('Enter how much to add or take out.');
  if (input.reason !== 'adjustment' && input.delta > 0) throw new UserError(`${input.reason === 'used' ? 'Used' : 'Wasted'} material comes out of stock: enter a quantity to take out.`);
  if (Math.abs(input.delta) > 1_000_000) throw new UserError('That quantity is unrealistically large.');
  tx(db, () => recordMaterialMovement(db, input.materialId, input.delta, input.reason, optionalText(input.note ?? '', 'Note', 150)));
  return getMaterial(db, input.materialId);
}

export function listMaterialMovements(db: Db, materialId: string, limit = 200): MaterialMovement[] {
  getMaterial(db, materialId);
  return all<{ id: string; delta: number; balance_after: number; reason: MaterialMovementReason; note: string; created_at: string }>(
    db,
    'SELECT id, delta, balance_after, reason, note, created_at FROM material_movements WHERE material_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
    materialId,
    limit,
  ).map((r) => ({ id: r.id, delta: r.delta, balanceAfter: r.balance_after, reason: r.reason, note: r.note, createdAt: r.created_at }));
}

export function materialPriceHistory(db: Db, materialId: string): MaterialPricePoint[] {
  getMaterial(db, materialId);
  return all<{ changed_at: string; unit_cost_paise: number; source: MaterialPricePoint['source'] }>(
    db,
    'SELECT changed_at, unit_cost_paise, source FROM material_prices WHERE material_id = ? ORDER BY changed_at DESC, rowid DESC',
    materialId,
  ).map((r) => ({ changedAt: r.changed_at, unitCostPaise: r.unit_cost_paise, source: r.source }));
}

// ── What if a material cost more? ───────────────────────────────────────────
const marginOf = (sell: number, cost: number): number | null => (sell > 0 ? ((sell - cost) / sell) * 100 : null);

/**
 * Works out what the sarees would cost, and earn, if some materials cost something else: nothing is changed. Only variants that use
 * one of the materials are listed, biggest drop in margin first. The cost is worked the same way as everywhere else, including
 * the wastage allowed in each costing.
 */
export function simulateMaterialPrices(db: Db, changes: { materialId: string; unitCostPaise: number }[]): Simulation {
  if (!Array.isArray(changes) || changes.length === 0) throw new UserError('Choose at least one material to change.');
  const then = new Map<string, number>();
  for (const c of changes) {
    getMaterial(db, c.materialId);
    then.set(c.materialId, requireInt(c.unitCostPaise, 'The new price', { max: 100_000_000_00 }));
  }
  const designs = new Map(listDesigns(db).map((d) => [d.id, d.name]));
  const floor = getSettings(db).marginAlertPercent;
  const rows: SimulationRow[] = [];
  for (const v of loadVariants(db)) {
    if (!designs.has(v.designId) || !v.bom.some((b) => then.has(b.materialId))) continue;
    const materialThen = v.bom.reduce((s, b) => s + mulPaise(b.qty * (1 + b.wastagePercent / 100), then.get(b.materialId) ?? b.unitCostPaise), 0);
    const costThen = v.baseCostPaise + materialThen;
    rows.push({
      variantId: v.id,
      designId: v.designId,
      designName: designs.get(v.designId)!,
      color: v.color,
      size: v.size,
      stock: v.stock,
      sellPricePaise: v.sellPricePaise,
      costNowPaise: v.unitCostPaise,
      costThenPaise: costThen,
      marginNowPercent: marginOf(v.sellPricePaise, v.unitCostPaise),
      marginThenPercent: marginOf(v.sellPricePaise, costThen),
    });
  }
  rows.sort((a, b) => (a.marginThenPercent ?? 100) - (a.marginNowPercent ?? 100) - ((b.marginThenPercent ?? 100) - (b.marginNowPercent ?? 100)) || a.designName.localeCompare(b.designName));
  const priced = rows.filter((r) => r.sellPricePaise > 0);
  return {
    rows,
    stockCostNowPaise: rows.reduce((s, r) => s + r.stock * r.costNowPaise, 0),
    stockCostThenPaise: rows.reduce((s, r) => s + r.stock * r.costThenPaise, 0),
    belowCostCount: priced.filter((r) => r.costThenPaise > r.sellPricePaise).length,
    lowMarginCount: floor > 0 ? priced.filter((r) => r.costThenPaise <= r.sellPricePaise && (r.marginThenPercent ?? 100) < floor && (r.marginNowPercent ?? 100) >= floor).length : 0,
  };
}
