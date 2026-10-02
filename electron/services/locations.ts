import type { StockLocation, StockTransfer, StockTransferInput } from '../../shared/types';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, isUniqueViolation, newId, nowIso, optionalText, requireInt, requireText } from './common';
import { getVariant } from './inventory';

interface LocationRow {
  id: string;
  name: string;
  is_default: number;
}

/**
 * Where finished sarees are kept. The shop is where they are sold from. A variant's total stock is the sum of every place;
 * only the pieces kept elsewhere (a godown, a showroom) are recorded per place, and the shop holds the rest.
 */
export function listLocations(db: Db): StockLocation[] {
  const elsewhere = new Map(all<{ location_id: string; n: number }>(db, 'SELECT location_id, COALESCE(SUM(qty), 0) AS n FROM stock_locations GROUP BY location_id').map((r) => [r.location_id, r.n]));
  const total = get<{ n: number }>(db, 'SELECT COALESCE(SUM(stock), 0) AS n FROM variants WHERE deleted_at IS NULL')?.n ?? 0;
  const away = [...elsewhere.values()].reduce((s, n) => s + n, 0);
  return all<LocationRow>(db, 'SELECT id, name, is_default FROM locations WHERE deleted_at IS NULL ORDER BY is_default DESC, name COLLATE NOCASE').map((l) => ({
    id: l.id,
    name: l.name,
    isDefault: l.is_default === 1,
    pieces: l.is_default === 1 ? total - away : (elsewhere.get(l.id) ?? 0),
  }));
}

function requireLocation(db: Db, id: string): LocationRow {
  const row = get<LocationRow>(db, 'SELECT id, name, is_default FROM locations WHERE id = ? AND deleted_at IS NULL', id);
  if (!row) throw new UserError('That place no longer exists.');
  return row;
}

export function createLocation(db: Db, name: string): StockLocation {
  const n = requireText(name, 'Place name', 40);
  const id = newId();
  try {
    run(db, 'INSERT INTO locations (id, name, is_default, created_at) VALUES (?, ?, 0, ?)', id, n, nowIso());
  } catch (err) {
    if (isUniqueViolation(err)) throw new UserError(`You already have a place called “${n}”.`);
    throw err;
  }
  return listLocations(db).find((l) => l.id === id)!;
}

export function renameLocation(db: Db, id: string, name: string): StockLocation {
  requireLocation(db, id);
  const n = requireText(name, 'Place name', 40);
  try {
    run(db, 'UPDATE locations SET name = ? WHERE id = ?', n, id);
  } catch (err) {
    if (isUniqueViolation(err)) throw new UserError(`You already have a place called “${n}”.`);
    throw err;
  }
  return listLocations(db).find((l) => l.id === id)!;
}

/** A place can be removed once nothing is kept in it. The shop can't be removed. */
export function archiveLocation(db: Db, id: string): void {
  const loc = requireLocation(db, id);
  if (loc.is_default === 1) throw new UserError("The shop can't be removed: it's where your sarees are sold from.");
  const kept = get<{ n: number }>(db, 'SELECT COALESCE(SUM(qty), 0) AS n FROM stock_locations WHERE location_id = ?', id)?.n ?? 0;
  if (kept > 0) throw new UserError(`${loc.name} still holds ${kept} ${kept === 1 ? 'piece' : 'pieces'}. Move them first.`);
  run(db, 'UPDATE locations SET deleted_at = ? WHERE id = ?', nowIso(), id);
}

function quantityAt(db: Db, variantId: string, locationId: string, shopId: string): number {
  if (locationId === shopId) {
    const stock = get<{ stock: number }>(db, 'SELECT stock FROM variants WHERE id = ?', variantId)?.stock ?? 0;
    const away = get<{ n: number }>(db, 'SELECT COALESCE(SUM(qty), 0) AS n FROM stock_locations WHERE variant_id = ?', variantId)?.n ?? 0;
    return stock - away;
  }
  return get<{ qty: number }>(db, 'SELECT qty FROM stock_locations WHERE variant_id = ? AND location_id = ?', variantId, locationId)?.qty ?? 0;
}

/** Moves pieces of one saree from one place to another. The total doesn't change, only where the pieces are. */
export function transferStock(db: Db, input: StockTransferInput): StockTransfer {
  const variant = getVariant(db, input.variantId);
  const qty = requireInt(input.qty, 'Quantity', { min: 1, max: 1_000_000 });
  const from = requireLocation(db, input.fromLocationId);
  const to = requireLocation(db, input.toLocationId);
  if (from.id === to.id) throw new UserError('Choose two different places.');
  const shopId = get<{ id: string }>(db, 'SELECT id FROM locations WHERE is_default = 1 AND deleted_at IS NULL')?.id ?? 'shop';
  const id = newId();
  tx(db, () => {
    const have = quantityAt(db, input.variantId, from.id, shopId);
    if (qty > have) throw new UserError(`${variant.sku} has only ${have} at ${from.name}.`);
    // The shop holds whatever is not recorded elsewhere, so only the other places are written down.
    const move = (locationId: string, by: number) => {
      if (locationId === shopId) return;
      if (by < 0) run(db, 'UPDATE stock_locations SET qty = qty + ? WHERE variant_id = ? AND location_id = ?', by, input.variantId, locationId);
      else run(db, 'INSERT INTO stock_locations (variant_id, location_id, qty) VALUES (?, ?, ?) ON CONFLICT (variant_id, location_id) DO UPDATE SET qty = qty + excluded.qty', input.variantId, locationId, by);
    };
    move(from.id, -qty);
    move(to.id, qty);
    run(db, 'DELETE FROM stock_locations WHERE variant_id = ? AND qty = 0', input.variantId);
    run(db, 'INSERT INTO stock_transfers (id, variant_id, from_location_id, to_location_id, qty, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, input.variantId, from.id, to.id, qty, optionalText(input.note ?? '', 'Note', 150), nowIso());
  });
  return listTransfers(db, input.variantId).find((t) => t.id === id)!;
}

export function listTransfers(db: Db, variantId?: string, limit = 100): StockTransfer[] {
  return all<{ id: string; variant_id: string; qty: number; note: string; created_at: string; from_name: string; to_name: string }>(
    db,
    `SELECT t.id, t.variant_id, t.qty, t.note, t.created_at, f.name AS from_name, d.name AS to_name
     FROM stock_transfers t JOIN locations f ON f.id = t.from_location_id JOIN locations d ON d.id = t.to_location_id
     ${variantId ? 'WHERE t.variant_id = ?' : ''} ORDER BY t.created_at DESC, t.rowid DESC LIMIT ?`,
    ...(variantId ? [variantId, limit] : [limit]),
  ).map((r) => ({ id: r.id, variantId: r.variant_id, fromName: r.from_name, toName: r.to_name, qty: r.qty, note: r.note, createdAt: r.created_at }));
}
