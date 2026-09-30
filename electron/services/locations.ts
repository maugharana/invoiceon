import { SHOP_LABEL, type HoldingRow, type Location, type TransferInput, type TransferRecord } from '../../shared/locations';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, newId, nowIso, optionalText, requireInt, requireText } from './common';
import { loadVariants, recordMovement } from './inventory';

export { elsewhereByVariant } from './inventory';

// See migration 15: the shop is the implicit selling location (variants.stock), other places hold what has been transferred to them.

const MAX_QTY = 100_000;

interface LocationRow {
  id: string;
  name: string;
}

const liveLocation = (db: Db, id: string): LocationRow => {
  const row = get<LocationRow>(db, 'SELECT id, name FROM locations WHERE id = ? AND deleted_at IS NULL', String(id));
  if (!row) throw new UserError('That place no longer exists.');
  return row;
};

/** Pieces of a saree held in one place: transfers in less transfers out. */
export const heldAt = (db: Db, locationId: string, variantId: string): number =>
  get<{ n: number | null }>(
    db,
    'SELECT SUM(CASE WHEN to_location_id = ? THEN qty ELSE 0 END) - SUM(CASE WHEN from_location_id = ? THEN qty ELSE 0 END) AS n FROM stock_transfers WHERE variant_id = ?',
    locationId,
    locationId,
    variantId,
  )?.n ?? 0;

export function listLocations(db: Db): Location[] {
  const rows = all<LocationRow>(db, 'SELECT id, name FROM locations WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE');
  const cost = new Map(loadVariants(db).map((v) => [v.id, v.unitCostPaise]));
  return rows.map((l) => {
    const held = all<{ variant_id: string; n: number }>(
      db,
      'SELECT variant_id, SUM(CASE WHEN to_location_id = ? THEN qty ELSE 0 END) - SUM(CASE WHEN from_location_id = ? THEN qty ELSE 0 END) AS n FROM stock_transfers GROUP BY variant_id',
      l.id,
      l.id,
    ).filter((h) => h.n > 0 && cost.has(h.variant_id)); // pieces of an archived saree cannot be moved, so they do not keep a place open
    return { id: l.id, name: l.name, pieces: held.reduce((s, h) => s + h.n, 0), valueAtCostPaise: held.reduce((s, h) => s + h.n * (cost.get(h.variant_id) ?? 0), 0), variants: held.length };
  });
}

export function saveLocation(db: Db, id: string | null, name: string): Location {
  const clean = requireText(name, 'Name', 40);
  if (clean.toLowerCase() === SHOP_LABEL.toLowerCase()) throw new UserError(`"${SHOP_LABEL}" is your selling location already. Choose another name.`);
  const taken = get<{ id: string }>(db, 'SELECT id FROM locations WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL AND id != ?', clean, id ?? '');
  if (taken) throw new UserError(`There is already a place called "${clean}".`);
  const now = nowIso();
  let locationId = id;
  if (id === null) {
    locationId = newId();
    run(db, 'INSERT INTO locations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', locationId, clean, now, now);
  } else {
    liveLocation(db, id);
    run(db, 'UPDATE locations SET name = ?, updated_at = ? WHERE id = ?', clean, now, id);
  }
  return listLocations(db).find((l) => l.id === locationId)!;
}

/** A place can be closed only once it is empty, so no stock is ever left somewhere that no longer exists. */
export function archiveLocation(db: Db, id: string): void {
  const loc = liveLocation(db, id);
  const here = listLocations(db).find((l) => l.id === id)!;
  if (here.pieces > 0) throw new UserError(`${loc.name} still holds ${here.pieces} ${here.pieces === 1 ? 'piece' : 'pieces'}. Move them back to the shop or to another place first.`);
  run(db, 'UPDATE locations SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
}

/** Moves pieces between the shop and a place, or between two places. The shop's side goes through the stock ledger like any other change. */
export function transferStock(db: Db, input: TransferInput): TransferRecord {
  const qty = requireInt(input?.qty, 'Quantity', { min: 1, max: MAX_QTY });
  const from = input.fromId ? liveLocation(db, input.fromId) : null;
  const to = input.toId ? liveLocation(db, input.toId) : null;
  if ((from?.id ?? null) === (to?.id ?? null)) throw new UserError('Choose two different places.');
  const note = optionalText(input.note, 'Note', 200);
  const [variant] = loadVariants(db, { variantId: String(input.variantId) });
  if (!variant) throw new UserError('Choose the saree to move.');
  const id = newId();

  tx(db, () => {
    if (from) {
      const have = heldAt(db, from.id, variant.id);
      if (have < qty) throw new UserError(`${from.name} holds ${have} of ${variant.sku}, so ${qty} cannot be moved from there.`);
    }
    // Stock leaving or joining the shop changes what can be sold, so it is a stock movement; "Not enough stock" stops a move the shop cannot cover.
    if (!from) recordMovement(db, variant.id, -qty, 'adjustment', `Moved to ${to!.name}`, { type: 'transfer', id });
    if (!to) recordMovement(db, variant.id, qty, 'adjustment', `Brought back from ${from!.name}`, { type: 'transfer', id });
    run(db, 'INSERT INTO stock_transfers (id, variant_id, from_location_id, to_location_id, qty, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, variant.id, from?.id ?? null, to?.id ?? null, qty, note, nowIso());
  });
  return listTransfers(db, 1, id)[0]!;
}

export function listTransfers(db: Db, limit = 50, onlyId?: string): TransferRecord[] {
  return all<{ id: string; variant_id: string; sku: string; design_name: string; color: string; size: string; from_name: string | null; to_name: string | null; qty: number; note: string; created_at: string }>(
    db,
    `SELECT t.id, t.variant_id, v.sku, d.name AS design_name, v.color, v.size, lf.name AS from_name, lt.name AS to_name, t.qty, t.note, t.created_at
     FROM stock_transfers t JOIN variants v ON v.id = t.variant_id JOIN designs d ON d.id = v.design_id
     LEFT JOIN locations lf ON lf.id = t.from_location_id LEFT JOIN locations lt ON lt.id = t.to_location_id
     ${onlyId ? 'WHERE t.id = ?' : ''} ORDER BY t.created_at DESC, t.rowid DESC LIMIT ?`,
    ...(onlyId ? [onlyId] : []),
    Math.min(Math.max(1, Math.trunc(limit)), 500),
  ).map((r) => ({ id: r.id, variantId: r.variant_id, sku: r.sku, designName: r.design_name, color: r.color, size: r.size, fromName: r.from_name ?? SHOP_LABEL, toName: r.to_name ?? SHOP_LABEL, qty: r.qty, note: r.note, createdAt: r.created_at }));
}

/** Every saree that has stock anywhere, with how much is in the shop and in each other place. */
export function holdings(db: Db): HoldingRow[] {
  const names = new Map(all<{ id: string; name: string }>(db, 'SELECT id, name FROM designs').map((d) => [d.id, d.name]));
  const perPlace = all<{ variant_id: string; location_id: string; n: number }>(
    db,
    `SELECT variant_id, location_id, SUM(n) AS n FROM (
       SELECT variant_id, to_location_id AS location_id, qty AS n FROM stock_transfers WHERE to_location_id IS NOT NULL
       UNION ALL SELECT variant_id, from_location_id, -qty FROM stock_transfers WHERE from_location_id IS NOT NULL
     ) GROUP BY variant_id, location_id HAVING SUM(n) > 0`,
  );
  const live = new Set(all<{ id: string }>(db, 'SELECT id FROM locations WHERE deleted_at IS NULL').map((l) => l.id));
  const by = new Map<string, Record<string, number>>();
  for (const p of perPlace) {
    if (!live.has(p.location_id)) continue;
    by.set(p.variant_id, { ...(by.get(p.variant_id) ?? {}), [p.location_id]: p.n });
  }
  return loadVariants(db)
    .map((v): HoldingRow => {
      const elsewhere = by.get(v.id) ?? {};
      return { variantId: v.id, designId: v.designId, designName: names.get(v.designId) ?? '', color: v.color, size: v.size, sku: v.sku, shop: v.stock, elsewhere, total: v.stock + Object.values(elsewhere).reduce((s, n) => s + n, 0) };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => a.designName.localeCompare(b.designName) || a.color.localeCompare(b.color) || a.size.localeCompare(b.size));
}
