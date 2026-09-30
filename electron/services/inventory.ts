import { mulPaise } from '../../shared/money';
import { matchesAll } from '../../shared/search';
import { designStatus, variantStatus } from '../../shared/stock';
import {
  MANUAL_STOCK_REASONS,
  type BomLine,
  type BulkAddResult,
  type BulkSareeRow,
  type DesignDetail,
  type DesignInput,
  type DesignQuery,
  type DesignSummary,
  type InventorySummary,
  type StockAdjustInput,
  type StockMovement,
  type StockReason,
  type Variant,
  type VariantInput,
} from '../../shared/types';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, isUniqueViolation, newId, nowIso, optionalText, requireInt, requireText } from './common';

const MAX_PAISE = 100_000_000_00; // ₹10 crore — a sanity ceiling that catches a stray extra zero.
const MAX_STOCK = 1_000_000;

// ── Row shapes ──────────────────────────────────────────────────────────────
interface DesignRow {
  id: string;
  code: string;
  name: string;
  fabric: string;
  hsn_code: string;
  description: string;
  default_price_paise: number;
}
interface VariantRow {
  id: string;
  design_id: string;
  sku: string;
  color: string;
  size: string;
  stock: number;
  reorder_level: number;
  base_cost_paise: number;
  sell_price_paise: number;
  mrp_paise: number;
}
interface BomRow {
  variant_id: string;
  material_id: string;
  qty: number;
  name: string;
  unit: string;
  unit_cost_paise: number;
}

// ── Loading ─────────────────────────────────────────────────────────────────
// Variants are loaded together with their bill of materials and costed in TypeScript, so there is a
// single definition of "unit cost" that both the lists and the valuation totals share.

export function loadVariants(db: Db, filter: { designId?: string; variantId?: string } = {}): Variant[] {
  const where = ['v.deleted_at IS NULL'];
  const params: string[] = [];
  if (filter.designId) {
    where.push('v.design_id = ?');
    params.push(filter.designId);
  }
  if (filter.variantId) {
    where.push('v.id = ?');
    params.push(filter.variantId);
  }
  const rows = all<VariantRow>(db, `SELECT v.* FROM variants v WHERE ${where.join(' AND ')} ORDER BY v.color COLLATE NOCASE, v.size COLLATE NOCASE`, ...params);
  const bomRows = all<BomRow>(
    db,
    `SELECT vm.variant_id, vm.material_id, vm.qty, m.name, m.unit, m.unit_cost_paise
     FROM variant_materials vm
     JOIN raw_materials m ON m.id = vm.material_id
     JOIN variants v ON v.id = vm.variant_id
     WHERE ${where.join(' AND ')}
     ORDER BY m.name COLLATE NOCASE`,
    ...params,
  );
  const bomByVariant = new Map<string, BomLine[]>();
  for (const b of bomRows) {
    const line: BomLine = {
      materialId: b.material_id,
      materialName: b.name,
      unit: b.unit,
      qty: b.qty,
      unitCostPaise: b.unit_cost_paise,
      lineCostPaise: mulPaise(b.qty, b.unit_cost_paise),
    };
    const list = bomByVariant.get(b.variant_id);
    if (list) list.push(line);
    else bomByVariant.set(b.variant_id, [line]);
  }
  return rows.map((r) => {
    const bom = bomByVariant.get(r.id) ?? [];
    const materialCostPaise = bom.reduce((sum, l) => sum + l.lineCostPaise, 0);
    return {
      id: r.id,
      designId: r.design_id,
      sku: r.sku,
      color: r.color,
      size: r.size,
      stock: r.stock,
      reorderLevel: r.reorder_level,
      baseCostPaise: r.base_cost_paise,
      bom,
      materialCostPaise,
      unitCostPaise: r.base_cost_paise + materialCostPaise,
      sellPricePaise: r.sell_price_paise,
      mrpPaise: r.mrp_paise,
      status: variantStatus(r.stock, r.reorder_level),
    };
  });
}

function summarise(d: DesignRow, variants: Variant[]): DesignSummary {
  return {
    id: d.id,
    code: d.code,
    name: d.name,
    fabric: d.fabric,
    hsnCode: d.hsn_code,
    description: d.description,
    defaultPricePaise: d.default_price_paise,
    variantCount: variants.length,
    totalStock: variants.reduce((s, v) => s + v.stock, 0),
    stockValuePaise: variants.reduce((s, v) => s + v.stock * v.unitCostPaise, 0),
    status: designStatus(variants),
  };
}

function groupByDesign(variants: Variant[]): Map<string, Variant[]> {
  const map = new Map<string, Variant[]>();
  for (const v of variants) {
    const list = map.get(v.designId);
    if (list) list.push(v);
    else map.set(v.designId, [v]);
  }
  return map;
}

// ── Designs ─────────────────────────────────────────────────────────────────
export function listDesigns(db: Db, query: DesignQuery = {}): DesignSummary[] {
  const designs = all<DesignRow>(db, 'SELECT * FROM designs WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE');
  const byDesign = groupByDesign(loadVariants(db));

  return designs
    .filter((d) => {
      const vs = byDesign.get(d.id) ?? [];
      return matchesAll([d.code, d.name, d.fabric, ...vs.flatMap((v) => [v.sku, v.color])].join(' '), query.search);
    })
    .map((d) => summarise(d, byDesign.get(d.id) ?? []))
    .filter((s) => {
      if (query.status === 'low') return s.status === 'low' || s.status === 'out';
      if (query.status === 'out') return s.status === 'out';
      return true;
    });
}

export function getDesign(db: Db, id: string): DesignDetail {
  const row = get<DesignRow>(db, 'SELECT * FROM designs WHERE id = ? AND deleted_at IS NULL', id);
  if (!row) throw new UserError('That design no longer exists.');
  const variants = loadVariants(db, { designId: id });
  return { ...summarise(row, variants), variants };
}

/** Suggests the next free code in the MG-001 style, continuing from the highest number in use. */
export function nextDesignCode(db: Db, prefix = 'MG'): string {
  const codes = all<{ code: string }>(db, 'SELECT code FROM designs WHERE deleted_at IS NULL').map((r) => r.code);
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  const highest = codes.reduce((max, c) => {
    const m = pattern.exec(c);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  return `${prefix}-${String(highest + 1).padStart(3, '0')}`;
}

function validateDesign(input: DesignInput) {
  return {
    code: requireText(input.code, 'Design code', 30),
    name: requireText(input.name, 'Design name'),
    fabric: optionalText(input.fabric, 'Fabric', 60),
    hsn: optionalText(input.hsnCode, 'HSN code', 12),
    description: optionalText(input.description, 'Description', 500),
    price: requireInt(input.defaultPricePaise, 'Default price', { max: MAX_PAISE }),
  };
}

export function createDesign(db: Db, input: DesignInput): DesignDetail {
  const v = validateDesign(input);
  const id = newId();
  const now = nowIso();
  try {
    run(db, 'INSERT INTO designs (id, code, name, fabric, hsn_code, description, default_price_paise, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, v.code, v.name, v.fabric, v.hsn, v.description, v.price, now, now);
  } catch (err) {
    if (isUniqueViolation(err)) throw new UserError(`Design code "${v.code}" is already in use.`);
    throw err;
  }
  return getDesign(db, id);
}

export function updateDesign(db: Db, id: string, input: DesignInput): DesignDetail {
  const v = validateDesign(input);
  getDesign(db, id);
  try {
    run(db, 'UPDATE designs SET code = ?, name = ?, fabric = ?, hsn_code = ?, description = ?, default_price_paise = ?, updated_at = ? WHERE id = ?', v.code, v.name, v.fabric, v.hsn, v.description, v.price, nowIso(), id);
  } catch (err) {
    if (isUniqueViolation(err)) throw new UserError(`Design code "${v.code}" is already in use.`);
    throw err;
  }
  return getDesign(db, id);
}

/** Archives rather than deletes, so past invoices that reference the design keep working. */
export function archiveDesign(db: Db, id: string): void {
  getDesign(db, id);
  tx(db, () => {
    const now = nowIso();
    run(db, 'UPDATE variants SET deleted_at = ?, updated_at = ? WHERE design_id = ? AND deleted_at IS NULL', now, now, id);
    run(db, 'UPDATE designs SET deleted_at = ?, updated_at = ? WHERE id = ?', now, now, id);
  });
}

// ── Variants ────────────────────────────────────────────────────────────────
function abbreviate(text: string, letters: number): string {
  const words = text.normalize('NFKD').replace(/[^A-Za-z0-9 ]/g, '').trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.slice(0, 3).map((w) => w[0]).join('').toUpperCase();
  return (words[0] ?? 'X').slice(0, letters).toUpperCase();
}

function generateSku(db: Db, designCode: string, color: string, size: string): string {
  const sizePart = size.toUpperCase().replace(/[^A-Z0-9.]/g, '').slice(0, 8) || 'STD';
  const base = `${designCode.toUpperCase().replace(/\s+/g, '')}-${abbreviate(color, 3)}-${sizePart}`;
  let sku = base;
  for (let n = 2; get(db, 'SELECT 1 AS x FROM variants WHERE sku = ? COLLATE NOCASE AND deleted_at IS NULL', sku); n++) {
    sku = `${base}-${n}`;
  }
  return sku;
}

function validateVariant(db: Db, input: VariantInput) {
  const bom = input.bom ?? [];
  const seen = new Set<string>();
  for (const line of bom) {
    if (typeof line.qty !== 'number' || !Number.isFinite(line.qty) || line.qty <= 0) throw new UserError('Each raw material needs a quantity greater than zero.');
    if (line.qty > 1_000_000) throw new UserError('A raw material quantity is unrealistically large.');
    if (seen.has(line.materialId)) throw new UserError('The same raw material is listed twice — combine them into one line.');
    seen.add(line.materialId);
    if (!get(db, 'SELECT 1 AS x FROM raw_materials WHERE id = ? AND deleted_at IS NULL', line.materialId)) {
      throw new UserError('A raw material in this costing no longer exists.');
    }
  }
  return {
    color: requireText(input.color, 'Color', 40),
    size: requireText(input.size, 'Size', 30),
    sku: optionalText(input.sku, 'SKU', 40),
    sell: requireInt(input.sellPricePaise, 'Selling price', { max: MAX_PAISE }),
    base: requireInt(input.baseCostPaise, 'Making / purchase cost', { max: MAX_PAISE }),
    mrp: input.mrpPaise === undefined || input.mrpPaise === null ? 0 : requireInt(input.mrpPaise, 'MRP', { max: MAX_PAISE }),
    reorder: requireInt(input.reorderLevel, 'Reorder level', { max: MAX_STOCK }),
    bom,
  };
}

function writeBom(db: Db, variantId: string, bom: { materialId: string; qty: number }[]): void {
  run(db, 'DELETE FROM variant_materials WHERE variant_id = ?', variantId);
  for (const line of bom) {
    run(db, 'INSERT INTO variant_materials (variant_id, material_id, qty) VALUES (?, ?, ?)', variantId, line.materialId, line.qty);
  }
}

function comboError(color: string, size: string): UserError {
  return new UserError(`This design already has a ${color} / ${size} variant.`);
}

export function getVariant(db: Db, id: string): Variant {
  const [variant] = loadVariants(db, { variantId: id });
  if (!variant) throw new UserError('That variant no longer exists.');
  return variant;
}

export function createVariant(db: Db, designId: string, input: VariantInput): Variant {
  const design = getDesign(db, designId);
  const v = validateVariant(db, input);
  const opening = input.openingStock === undefined ? 0 : requireInt(input.openingStock, 'Opening stock', { max: MAX_STOCK });
  const id = newId();

  tx(db, () => {
    const now = nowIso();
    const sku = v.sku || generateSku(db, design.code, v.color, v.size);
    try {
      run(db, 'INSERT INTO variants (id, design_id, sku, color, size, stock, reorder_level, base_cost_paise, sell_price_paise, mrp_paise, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)', id, designId, sku, v.color, v.size, v.reorder, v.base, v.sell, v.mrp, now, now);
    } catch (err) {
      if (isUniqueViolation(err)) {
        if (/sku/i.test((err as Error).message)) throw new UserError(`SKU "${sku}" is already in use.`);
        throw comboError(v.color, v.size);
      }
      throw err;
    }
    writeBom(db, id, v.bom);
    if (opening > 0) recordMovement(db, id, opening, 'opening');
  });
  return getVariant(db, id);
}

export function updateVariant(db: Db, id: string, input: VariantInput): Variant {
  const existing = getVariant(db, id);
  const v = validateVariant(db, input);
  tx(db, () => {
    try {
      run(db, 'UPDATE variants SET sku = ?, color = ?, size = ?, reorder_level = ?, base_cost_paise = ?, sell_price_paise = ?, mrp_paise = ?, updated_at = ? WHERE id = ?', v.sku || existing.sku, v.color, v.size, v.reorder, v.base, v.sell, v.mrp, nowIso(), id);
    } catch (err) {
      if (isUniqueViolation(err)) {
        if (/sku/i.test((err as Error).message)) throw new UserError(`SKU "${v.sku}" is already in use.`);
        throw comboError(v.color, v.size);
      }
      throw err;
    }
    writeBom(db, id, v.bom);
  });
  return getVariant(db, id);
}

// ── Bulk entry ──────────────────────────────────────────────────────────────
const norm = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Adds a whole sheet of sarees in one go. Every row is checked first — on its own, against the other rows, and against what
 * is already in the shop — and if anything is wrong nothing is written and the problems come back row by row. Otherwise it all
 * goes in as one transaction, so a sheet is never half added.
 */
export function bulkAddSarees(db: Db, rows: BulkSareeRow[]): BulkAddResult {
  if (!Array.isArray(rows) || rows.length === 0) throw new UserError('Add at least one saree.');
  if (rows.length > 500) throw new UserError('Add up to 500 rows at a time.');

  const errors: BulkAddResult['errors'] = [];
  // One message per row is enough to act on; fixing it reveals the next, if any.
  const fail = (row: number, message: string) => {
    if (!errors.some((e) => e.row === row)) errors.push({ row, message });
  };

  // 1. Each row on its own.
  const clean = rows.map((r, i) => {
    try {
      return {
        i,
        name: requireText(r.name, 'Saree name', 120).replace(/\s+/g, ' '),
        sku: optionalText(r.sku, 'Saree ID', 40),
        color: requireText(r.color, 'Colour', 40),
        size: requireText(r.size, 'Size', 30),
        fabric: optionalText(r.fabric, 'Fabric', 60),
        hsn: optionalText(r.hsn, 'HSN code', 12),
        mrp: requireInt(r.mrpPaise ?? 0, 'MRP', { max: MAX_PAISE }),
        sell: requireInt(r.sellPricePaise, 'Selling price', { max: MAX_PAISE }),
        cost: requireInt(r.costPaise ?? 0, 'Cost price', { max: MAX_PAISE }),
        stock: requireInt(r.stock ?? 0, 'Stock', { max: MAX_STOCK }),
        reorder: requireInt(r.reorderLevel ?? 0, 'Reorder level', { max: MAX_STOCK }),
      };
    } catch (err) {
      if (err instanceof UserError) {
        fail(i, err.message);
        return null;
      }
      throw err;
    }
  });

  // 2. Against each other and against the shop as it is now.
  const designsByName = new Map<string, DesignRow[]>();
  for (const d of all<DesignRow>(db, 'SELECT * FROM designs WHERE deleted_at IS NULL')) {
    const list = designsByName.get(norm(d.name));
    if (list) list.push(d);
    else designsByName.set(norm(d.name), [d]);
  }
  const seenCombos = new Set<string>();
  const seenSkus = new Set<string>();
  for (const r of clean) {
    if (!r) continue;
    const combo = `${norm(r.name)}|${norm(r.color)}|${norm(r.size)}`;
    if (seenCombos.has(combo)) fail(r.i, `${r.color} / ${r.size} of "${r.name}" appears more than once in this sheet.`);
    seenCombos.add(combo);

    if (r.sku) {
      if (seenSkus.has(norm(r.sku))) fail(r.i, `Saree ID "${r.sku}" is used by more than one row.`);
      else if (get(db, 'SELECT 1 AS x FROM variants WHERE sku = ? COLLATE NOCASE AND deleted_at IS NULL', r.sku)) fail(r.i, `Saree ID "${r.sku}" is already in use.`);
      seenSkus.add(norm(r.sku));
    }

    const existing = designsByName.get(norm(r.name));
    if (existing && existing.length > 1) fail(r.i, `You have more than one design called "${r.name}". Add this piece from the design's own page.`);
    else if (existing?.[0] && get(db, 'SELECT 1 AS x FROM variants WHERE design_id = ? AND color = ? COLLATE NOCASE AND size = ? COLLATE NOCASE AND deleted_at IS NULL', existing[0].id, r.color, r.size)) {
      fail(r.i, `"${existing[0].name}" already has a ${r.color} / ${r.size} piece.`);
    }
  }

  if (errors.length > 0) {
    errors.sort((a, b) => a.row - b.row);
    return { errors, designsCreated: 0, designsExtended: 0, variantsCreated: 0 };
  }

  // 3. Everything is fine: write it, design by design, in the order first typed.
  const groups = new Map<string, NonNullable<(typeof clean)[number]>[]>();
  for (const r of clean) {
    if (!r) continue;
    const list = groups.get(norm(r.name));
    if (list) list.push(r);
    else groups.set(norm(r.name), [r]);
  }
  let designsCreated = 0;
  let designsExtended = 0;
  let variantsCreated = 0;
  tx(db, () => {
    for (const [key, group] of groups) {
      const first = group[0]!;
      const existing = designsByName.get(key)?.[0];
      let designId: string;
      if (existing) {
        designId = existing.id;
        designsExtended += 1;
      } else {
        designId = createDesign(db, {
          code: nextDesignCode(db),
          name: first.name,
          fabric: group.find((r) => r.fabric)?.fabric ?? '',
          hsnCode: group.find((r) => r.hsn)?.hsn ?? '',
          description: '',
          defaultPricePaise: first.sell,
        }).id;
        designsCreated += 1;
      }
      for (const r of group) {
        createVariant(db, designId, { color: r.color, size: r.size, sku: r.sku || undefined, sellPricePaise: r.sell, mrpPaise: r.mrp, baseCostPaise: r.cost, reorderLevel: r.reorder, openingStock: r.stock, bom: [] });
        variantsCreated += 1;
      }
    }
  });
  return { errors: [], designsCreated, designsExtended, variantsCreated };
}

export function archiveVariant(db: Db, id: string): void {
  getVariant(db, id);
  run(db, 'UPDATE variants SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
}

// ── Stock ledger ────────────────────────────────────────────────────────────
/**
 * The single way stock changes. Updates the cached balance and appends the ledger row together, and
 * refuses to go below zero. Stage 2 invoicing will call this with reason 'sale'.
 */
export function recordMovement(
  db: Db,
  variantId: string,
  delta: number,
  reason: StockReason,
  note = '',
  ref?: { type: string; id: string },
): void {
  tx(db, () => {
    const row = get<{ stock: number; base_cost_paise: number; sku: string }>(db, 'SELECT stock, base_cost_paise, sku FROM variants WHERE id = ? AND deleted_at IS NULL', variantId);
    if (!row) throw new UserError('That variant no longer exists.');
    const balance = row.stock + delta;
    if (balance < 0) {
      throw new UserError(`Not enough stock: ${row.sku} has ${row.stock} in stock, so ${Math.abs(delta)} can't be removed.`);
    }
    const [current] = loadVariants(db, { variantId });
    const now = nowIso();
    run(db, 'UPDATE variants SET stock = ?, updated_at = ? WHERE id = ?', balance, now, variantId);
    run(db, 'INSERT INTO stock_movements (id, variant_id, delta, balance_after, reason, note, unit_cost_paise, ref_type, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', newId(), variantId, delta, balance, reason, note, current?.unitCostPaise ?? row.base_cost_paise, ref?.type ?? null, ref?.id ?? null, now);
  });
}

/** True while the variant is on the shelf (not archived). Documents keep pointing at archived variants, but nothing can be moved in or out of them. */
export const isVariantLive = (db: Db, variantId: string): boolean => !!get(db, 'SELECT 1 AS x FROM variants WHERE id = ? AND deleted_at IS NULL', variantId);

export function adjustStock(db: Db, input: StockAdjustInput): Variant {
  const delta = requireInt(input.delta, 'Quantity', { min: -MAX_STOCK, max: MAX_STOCK });
  if (delta === 0) throw new UserError('Enter a quantity to add or remove.');
  if (!(MANUAL_STOCK_REASONS as readonly string[]).includes(input.reason)) throw new UserError('Choose a reason for this stock change.');
  const note = optionalText(input.note, 'Note', 200);
  recordMovement(db, input.variantId, delta, input.reason, note);
  return getVariant(db, input.variantId);
}

export function listMovements(db: Db, variantId: string, limit = 200): StockMovement[] {
  return all<{
    id: string;
    variant_id: string;
    delta: number;
    balance_after: number;
    reason: StockReason;
    note: string;
    unit_cost_paise: number;
    created_at: string;
  }>(db, 'SELECT * FROM stock_movements WHERE variant_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?', variantId, limit).map((r) => ({
    id: r.id,
    variantId: r.variant_id,
    delta: r.delta,
    balanceAfter: r.balance_after,
    reason: r.reason,
    note: r.note,
    unitCostPaise: r.unit_cost_paise,
    createdAt: r.created_at,
  }));
}

// ── Summary ─────────────────────────────────────────────────────────────────
export function inventorySummary(db: Db): InventorySummary {
  const designs = listDesigns(db);
  return {
    designCount: designs.length,
    variantCount: designs.reduce((s, d) => s + d.variantCount, 0),
    unitsInStock: designs.reduce((s, d) => s + d.totalStock, 0),
    stockValuePaise: designs.reduce((s, d) => s + d.stockValuePaise, 0),
    lowStockDesigns: designs.filter((d) => d.status === 'low' || d.status === 'out').length,
    outOfStockDesigns: designs.filter((d) => d.status === 'out').length,
    materialCount: get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM raw_materials WHERE deleted_at IS NULL')?.n ?? 0,
  };
}
