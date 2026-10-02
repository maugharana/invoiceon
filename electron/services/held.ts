import type { HeldBill } from '../../shared/types';
import { all, get, run, type Db } from '../db/connection';
import { UserError, newId, nowIso, requireText } from './common';

interface Row {
  id: string;
  name: string;
  kind: 'invoice' | 'proforma';
  payload_json: string;
  created_at: string;
}

const toHeld = (r: Row): HeldBill => {
  let payload: unknown = null;
  try {
    payload = JSON.parse(r.payload_json);
  } catch {
    /* a damaged entry is shown as empty rather than breaking the list */
  }
  return { id: r.id, name: r.name, kind: r.kind, payload, createdAt: r.created_at };
};

/** Bills set aside half-made, newest first. */
export function listHeld(db: Db, kind: HeldBill['kind'] = 'invoice'): HeldBill[] {
  return all<Row>(db, 'SELECT * FROM held_bills WHERE deleted_at IS NULL AND kind = ? ORDER BY created_at DESC', kind).map(toHeld);
}

/** Sets a half-made bill aside under a name. Nothing is issued and no stock moves; it is only remembered. */
export function holdBill(db: Db, input: { name: string; kind?: HeldBill['kind']; payload: unknown }): HeldBill {
  const name = requireText(input.name, 'A name for the held bill', 60);
  const kind = input.kind === 'proforma' ? 'proforma' : 'invoice';
  if (!input.payload || typeof input.payload !== 'object') throw new UserError('There is nothing to hold.');
  const json = JSON.stringify(input.payload);
  if (json.length > 200_000) throw new UserError('That bill is too large to hold.');
  if ((get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM held_bills WHERE deleted_at IS NULL AND kind = ?', kind)?.n ?? 0) >= 50) throw new UserError('You have 50 bills on hold. Finish or discard some first.');
  const id = newId();
  run(db, 'INSERT INTO held_bills (id, name, kind, payload_json, created_at) VALUES (?, ?, ?, ?, ?)', id, name, kind, json, nowIso());
  return toHeld(get<Row>(db, 'SELECT * FROM held_bills WHERE id = ?', id)!);
}

export function discardHeld(db: Db, id: string): void {
  if (!get(db, 'SELECT 1 AS x FROM held_bills WHERE id = ? AND deleted_at IS NULL', id)) throw new UserError('That held bill no longer exists.');
  run(db, 'UPDATE held_bills SET deleted_at = ? WHERE id = ?', nowIso(), id);
}
