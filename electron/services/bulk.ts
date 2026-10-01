import { phoneKey } from '../../shared/customerList';
import { formatMoney } from '../../shared/money';
import type { BulkDesignAction, BulkDesignResult, Customer, CustomerImportResult, CustomerInput, ExpenseInput, StockTakeLine, StockTakeResult, Variant, VariantInput } from '../../shared/types';
import { tx, type Db } from '../db/connection';
import { UserError } from './common';
import { createCustomer, listCustomers } from './customers';
import { createExpense } from './expenses';
import { adjustStock, archiveDesign, getDesign, getVariant, loadVariants, updateVariant } from './inventory';

/** Wraps a failure with the row it came from, so the person knows which line of their sheet to fix. */
function rowError(row: number, label: string, err: unknown): UserError {
  const message = err instanceof Error ? err.message : 'Something went wrong.';
  return new UserError(`Row ${row}${label ? ` (${label})` : ''}: ${message} Nothing was added.`);
}

// ── Customers from a sheet ──────────────────────────────────────────────────
/**
 * Adds many customers at once. A customer who is already on file (same phone number or same GSTIN, including earlier in the same
 * sheet) is skipped, not doubled up. If any row is invalid nothing is added.
 */
export function importCustomers(db: Db, rows: { row: number; value: CustomerInput }[]): CustomerImportResult {
  if (rows.length === 0) throw new UserError('There are no customers to add.');
  if (rows.length > 5000) throw new UserError('Add up to 5,000 customers at a time.');
  const phones = new Set<string>();
  const gstins = new Set<string>();
  const remember = (c: Pick<Customer, 'phone' | 'gstin'>) => {
    if (phoneKey(c.phone)) phones.add(phoneKey(c.phone));
    if (c.gstin.trim()) gstins.add(c.gstin.trim().toUpperCase());
  };
  listCustomers(db).forEach(remember);

  const skipped: CustomerImportResult['skipped'] = [];
  let created = 0;
  tx(db, () => {
    for (const { row, value } of rows) {
      const same = (phoneKey(value.phone) && phones.has(phoneKey(value.phone))) || (value.gstin.trim() && gstins.has(value.gstin.trim().toUpperCase()));
      if (same) {
        skipped.push({ row, name: value.name, reason: 'Already a customer (same phone number or GSTIN).' });
        continue;
      }
      try {
        remember(createCustomer(db, value));
        created++;
      } catch (err) {
        throw rowError(row, value.name, err);
      }
    }
  });
  return { created, skipped };
}

// ── Expenses from a sheet ───────────────────────────────────────────────────
/** Adds many expenses at once. All or nothing: one bad row and none are added. */
export function bulkAddExpenses(db: Db, rows: { row: number; value: ExpenseInput }[]): number {
  if (rows.length === 0) throw new UserError('There are no expenses to add.');
  if (rows.length > 5000) throw new UserError('Add up to 5,000 expenses at a time.');
  tx(db, () => {
    for (const { row, value } of rows) {
      try {
        createExpense(db, value);
      } catch (err) {
        throw rowError(row, value.category, err);
      }
    }
  });
  return rows.length;
}

// ── Stock-take ──────────────────────────────────────────────────────────────
/**
 * Applies a physical count. Each counted piece that differs from the system's figure becomes a stock adjustment (so the history
 * shows what happened and when), and variants whose count matches are left alone. All or nothing.
 */
export function applyStockTake(db: Db, counts: StockTakeLine[], note = ''): StockTakeResult {
  if (counts.length === 0) throw new UserError('There is nothing counted yet.');
  const seen = new Set<string>();
  for (const c of counts) {
    if (!Number.isInteger(c.counted) || c.counted < 0 || c.counted > 1_000_000) throw new UserError('Counts must be whole numbers, zero or more.');
    if (seen.has(c.variantId)) throw new UserError('A piece is counted twice in this sheet.');
    seen.add(c.variantId);
  }
  const result: StockTakeResult = { checked: counts.length, adjusted: 0, pieceDifference: 0, changes: [] };
  tx(db, () => {
    for (const c of counts) {
      const v = getVariant(db, c.variantId);
      const delta = c.counted - v.stock;
      if (delta === 0) continue;
      adjustStock(db, { variantId: v.id, delta, reason: 'adjustment', note: note || 'Stock-take' });
      result.adjusted++;
      result.pieceDifference += delta;
      result.changes.push({ variantId: v.id, before: v.stock, after: c.counted });
    }
  });
  return result;
}

// ── Bulk changes to designs ─────────────────────────────────────────────────
const toInput = (v: Variant, over: Partial<VariantInput> = {}): VariantInput => ({
  color: v.color,
  size: v.size,
  sku: v.sku,
  sellPricePaise: v.sellPricePaise,
  mrpPaise: v.mrpPaise,
  baseCostPaise: v.baseCostPaise,
  reorderLevel: v.reorderLevel,
  bom: v.bom.map((b) => ({ materialId: b.materialId, qty: b.qty })),
  ...over,
});

/** Archives many designs, sets a reorder level on all their variants, or changes their selling prices (to a price, or by a percentage). All or nothing. */
export function bulkChangeDesigns(db: Db, action: BulkDesignAction): BulkDesignResult {
  const ids = [...new Set(action.ids)];
  if (ids.length === 0) throw new UserError('Choose at least one design.');
  if (ids.length > 2000) throw new UserError('Change up to 2,000 designs at a time.');
  let variants = 0;
  tx(db, () => {
    for (const id of ids) {
      const design = getDesign(db, id);
      if (action.kind === 'archive') {
        archiveDesign(db, id);
        continue;
      }
      for (const v of loadVariants(db, { designId: design.id })) {
        if (action.kind === 'reorder') {
          if (!Number.isInteger(action.level) || action.level < 0 || action.level > 100000) throw new UserError('The reorder level must be a whole number, zero or more.');
          updateVariant(db, v.id, toInput(v, { reorderLevel: action.level }));
        } else if (action.kind === 'price') {
          let price: number;
          if (action.mode === 'set') price = action.value;
          else {
            if (!Number.isFinite(action.value) || action.value < -90 || action.value > 500) throw new UserError('Change prices by between −90% and +500%.');
            price = Math.round(v.sellPricePaise * (1 + action.value / 100));
          }
          if (!Number.isInteger(price) || price < 0) throw new UserError(`That would make ${design.name} ${v.color} cost ${formatMoney(Math.max(price, 0))}. Check the number.`);
          updateVariant(db, v.id, toInput(v, { sellPricePaise: price }));
        } else throw new UserError('Choose archive, reorder level or price.');
        variants++;
      }
    }
  });
  return { designs: ids.length, variants };
}
