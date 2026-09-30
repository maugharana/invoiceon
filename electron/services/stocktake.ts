import { adjustmentFor, varianceOf, type StockTake, type StockTakeLine, type StockTakeResult, type StockTakeStart, type StockTakeSummary, type StockTakeTotals } from '../../shared/stocktake';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, newId, nowIso, requireInt, requireText } from './common';
import { loadVariants, recordMovement } from './inventory';

interface TakeRow {
  id: string;
  name: string;
  status: 'open' | 'applied' | 'cancelled';
  created_at: string;
  finished_at: string | null;
}

interface LineRow {
  variant_id: string;
  counted: number | null;
  expected: number | null;
  applied: number | null;
}

const MAX_COUNT = 100_000;

function totalsOf(lines: { counted: number | null; variance: number | null; unitCostPaise: number }[]): StockTakeTotals {
  const counted = lines.filter((l) => l.counted !== null);
  const diff = counted.filter((l) => (l.variance ?? 0) !== 0);
  return {
    lines: lines.length,
    counted: counted.length,
    differences: diff.length,
    surplusPieces: diff.reduce((s, l) => s + Math.max(0, l.variance ?? 0), 0),
    shortagePieces: diff.reduce((s, l) => s + Math.max(0, -(l.variance ?? 0)), 0),
    varianceCostPaise: diff.reduce((s, l) => s + (l.variance ?? 0) * l.unitCostPaise, 0),
  };
}

function load(db: Db, row: TakeRow): StockTake {
  const names = new Map(all<{ id: string; name: string }>(db, 'SELECT id, name FROM designs').map((d) => [d.id, d.name]));
  const variants = new Map(loadVariants(db).map((v) => [v.id, v]));
  const lines = all<LineRow>(db, 'SELECT variant_id, counted, expected, applied FROM stock_take_lines WHERE take_id = ?', row.id)
    .map((l): StockTakeLine | null => {
      const v = variants.get(l.variant_id);
      if (!v) return null; // archived since: nothing to count or adjust
      return {
        variantId: v.id,
        designId: v.designId,
        designName: names.get(v.designId) ?? '',
        color: v.color,
        size: v.size,
        sku: v.sku,
        systemNow: v.stock,
        counted: l.counted,
        expectedAtCount: l.expected,
        variance: varianceOf(l.counted, l.expected),
        unitCostPaise: v.unitCostPaise,
      };
    })
    .filter((l): l is StockTakeLine => l !== null)
    .sort((a, b) => a.designName.localeCompare(b.designName) || a.color.localeCompare(b.color) || a.size.localeCompare(b.size));
  return { id: row.id, name: row.name, status: row.status, createdAt: row.created_at, finishedAt: row.finished_at, lines, totals: totalsOf(lines) };
}

const rowOf = (db: Db, id: string): TakeRow => {
  const row = get<TakeRow>(db, 'SELECT * FROM stock_takes WHERE id = ?', String(id));
  if (!row) throw new UserError('That stock take no longer exists.');
  return row;
};

const openRow = (db: Db, id: string): TakeRow => {
  const row = rowOf(db, id);
  if (row.status !== 'open') throw new UserError(`That stock take is ${row.status}.`);
  return row;
};

/** The count in progress, if there is one. Only one at a time, so two people do not count against each other. */
export function currentTake(db: Db): StockTake | null {
  const row = get<TakeRow>(db, "SELECT * FROM stock_takes WHERE status = 'open' ORDER BY created_at DESC LIMIT 1");
  return row ? load(db, row) : null;
}

export function startTake(db: Db, input: StockTakeStart): StockTake {
  const name = requireText(input?.name, 'Name', 60);
  if (get(db, "SELECT 1 AS x FROM stock_takes WHERE status = 'open'")) throw new UserError('A count is already in progress. Finish or cancel it first.');
  const designId = input.designId ? String(input.designId) : null;
  if (designId && !get(db, 'SELECT 1 AS x FROM designs WHERE id = ? AND deleted_at IS NULL', designId)) throw new UserError('That design no longer exists.');
  const id = newId();
  tx(db, () => {
    run(db, 'INSERT INTO stock_takes (id, name, status, created_at) VALUES (?, ?, ?, ?)', id, name, 'open', nowIso());
    const wanted = loadVariants(db, designId ? { designId } : {});
    if (wanted.length === 0) throw new UserError('There are no sarees to count.');
    for (const v of wanted) run(db, 'INSERT INTO stock_take_lines (id, take_id, variant_id) VALUES (?, ?, ?)', newId(), id, v.id);
  });
  return load(db, rowOf(db, id));
}

/** Records how many of a saree were counted (or clears the count with null), along with what the books said at that moment. */
export function countLine(db: Db, takeId: string, variantId: string, counted: number | null): StockTake {
  const take = openRow(db, takeId);
  const line = get<{ id: string }>(db, 'SELECT id FROM stock_take_lines WHERE take_id = ? AND variant_id = ?', takeId, String(variantId));
  if (!line) throw new UserError('That saree is not part of this count.');
  if (counted === null) {
    run(db, 'UPDATE stock_take_lines SET counted = NULL, expected = NULL, counted_at = NULL WHERE id = ?', line.id);
  } else {
    const n = requireInt(counted, 'Count', { min: 0, max: MAX_COUNT });
    const [v] = loadVariants(db, { variantId });
    if (!v) throw new UserError('That saree has been archived since the count began.');
    run(db, 'UPDATE stock_take_lines SET counted = ?, expected = ?, counted_at = ? WHERE id = ?', n, v.stock, nowIso(), line.id);
  }
  return load(db, take);
}

/** Puts the differences into the books as stock adjustments. Sarees not counted are left exactly as they are. */
export function applyTake(db: Db, takeId: string): StockTakeResult {
  const take = openRow(db, takeId);
  const clamped: string[] = [];
  let adjusted = 0;
  tx(db, () => {
    const current = load(db, take);
    for (const l of current.lines) {
      if (l.variance === null || l.variance === 0) continue;
      const { delta, clamped: cut } = adjustmentFor(l.variance, l.systemNow);
      if (cut) clamped.push(`${l.sku}: counted ${l.counted}, but ${l.systemNow} is all the books hold now`);
      if (delta === 0) continue;
      recordMovement(db, l.variantId, delta, 'adjustment', `Stock take: ${take.name}`, { type: 'stock_take', id: take.id });
      run(db, 'UPDATE stock_take_lines SET applied = ? WHERE take_id = ? AND variant_id = ?', delta, take.id, l.variantId);
      adjusted += 1;
    }
    run(db, "UPDATE stock_takes SET status = 'applied', finished_at = ? WHERE id = ?", nowIso(), take.id);
  });
  return { take: load(db, rowOf(db, take.id)), adjusted, clamped };
}

export function cancelTake(db: Db, takeId: string): void {
  openRow(db, takeId);
  run(db, "UPDATE stock_takes SET status = 'cancelled', finished_at = ? WHERE id = ?", nowIso(), takeId);
}

export function listTakes(db: Db): StockTakeSummary[] {
  return all<TakeRow>(db, "SELECT * FROM stock_takes WHERE status != 'open' ORDER BY created_at DESC LIMIT 50").map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status as 'applied' | 'cancelled',
    createdAt: r.created_at,
    finishedAt: r.finished_at,
    totals: load(db, r).totals,
  }));
}
