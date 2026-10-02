import { addDays, financialYear, formatInvoiceNumber, isIsoDate, todayIso } from '../../shared/gst';
import { matchesAll } from '../../shared/search';
import type { ProductionMaterial, ProductionOrder, ProductionOrderInput, ProductionQuery, ProductionReceipt, ProductionStatus } from '../../shared/types';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, newId, nowIso, optionalText, requireInt } from './common';
import { createExpense } from './expenses';
import { getVariant, recordMovement } from './inventory';
import { getMaterial, recordMaterialMovement, roundQty } from './materials';

// Making sarees: an order says how many of one colour and size are to be made, in the house or by a karigar. When the work starts, the
// raw materials come off the shelf (what the costing says, wastage included). Finished pieces go on the shelf as they come back,
// in as many parts as they arrive, and the wage for each batch becomes a bill to the karigar. Anything unused is taken back if the
// order is closed early or cancelled.

const MAX_PAISE = 100_000_000_00;
const PREFIX = 'PRD';

interface Row {
  id: string;
  number: string;
  fy: string;
  seq: number;
  variant_id: string;
  qty: number;
  received_qty: number;
  vendor_id: string | null;
  vendor_name: string | null;
  wage_paise: number;
  status: ProductionStatus;
  ordered_on: string;
  due_on: string | null;
  note: string;
  closed_on: string | null;
  created_at: string;
}

const SELECT = 'SELECT o.*, v.name AS vendor_name FROM production_orders o LEFT JOIN vendors v ON v.id = o.vendor_id';

/** What the whole order needs of each raw material: the costing's quantity, plus its wastage, for every piece. */
function needs(db: Db, variantId: string, qty: number): { materialId: string; name: string; unit: string; needed: number }[] {
  return getVariant(db, variantId).bom.map((b) => ({ materialId: b.materialId, name: b.materialName, unit: b.unit, needed: roundQty(b.qty * (1 + b.wastagePercent / 100) * qty) }));
}

const issuedQty = (db: Db, orderId: string): Map<string, number> => new Map(all<{ material_id: string; qty: number }>(db, 'SELECT material_id, qty FROM production_materials WHERE order_id = ?', orderId).map((r) => [r.material_id, r.qty]));

function toOrder(db: Db, r: Row): ProductionOrder {
  const variant = getVariant(db, r.variant_id);
  const design = get<{ name: string }>(db, 'SELECT name FROM designs WHERE id = ?', variant.designId);
  const issued = issuedQty(db, r.id);
  const handedOver = issued.size > 0;
  const materials: ProductionMaterial[] = needs(db, r.variant_id, r.qty).map((n) => {
    const inStock = (() => {
      try {
        return getMaterial(db, n.materialId).stockQty;
      } catch {
        return 0;
      }
    })();
    return { materialId: n.materialId, name: n.name, unit: n.unit, neededQty: n.needed, issuedQty: issued.get(n.materialId) ?? 0, inStockQty: inStock, shortQty: handedOver ? 0 : roundQty(Math.max(0, n.needed - inStock)) };
  });
  const receipts = all<{ id: string; qty: number; received_on: string; wage_paise: number; expense_id: string | null }>(db, 'SELECT * FROM production_receipts WHERE order_id = ? ORDER BY received_on, created_at', r.id).map(
    (x): ProductionReceipt => ({ id: x.id, qty: x.qty, receivedOn: x.received_on, wagePaise: x.wage_paise, expenseId: x.expense_id }),
  );
  const open = r.status === 'planned' || r.status === 'making';
  return {
    id: r.id,
    number: r.number,
    variantId: r.variant_id,
    designName: design?.name ?? '',
    color: variant.color,
    size: variant.size,
    sku: variant.sku,
    qty: r.qty,
    receivedQty: r.received_qty,
    remainingQty: Math.max(0, r.qty - r.received_qty),
    vendorId: r.vendor_id,
    vendorName: r.vendor_name ?? '',
    wagePaise: r.wage_paise,
    status: r.status,
    orderedOn: r.ordered_on,
    dueOn: r.due_on,
    overdue: open && r.due_on !== null && r.due_on < todayIso(),
    note: r.note,
    materialsIssued: handedOver,
    materials,
    receipts,
    closedOn: r.closed_on,
    createdAt: r.created_at,
  };
}

export function getOrder(db: Db, id: string): ProductionOrder {
  const row = get<Row>(db, `${SELECT} WHERE o.id = ?`, id);
  if (!row) throw new UserError('That production order no longer exists.');
  return toOrder(db, row);
}

export function listOrders(db: Db, query: ProductionQuery = {}): ProductionOrder[] {
  return all<Row>(db, `${SELECT} ORDER BY CASE o.status WHEN 'making' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, COALESCE(o.due_on, '9999-12-31'), o.created_at DESC`)
    .map((r) => toOrder(db, r))
    .filter((o) => {
      if (!query.status || query.status === 'all') return true;
      if (query.status === 'open') return o.status === 'planned' || o.status === 'making';
      return o.status === query.status;
    })
    .filter((o) => matchesAll(`${o.number} ${o.designName} ${o.color} ${o.size} ${o.sku} ${o.vendorName}`, query.search));
}

function check(db: Db, input: ProductionOrderInput) {
  getVariant(db, input.variantId);
  const qty = requireInt(input.qty, 'Quantity', { min: 1, max: 100_000 });
  const wage = input.wagePaise === undefined ? 0 : requireInt(input.wagePaise, 'Wage per piece', { max: MAX_PAISE });
  const vendorId = input.vendorId || null;
  if (vendorId && !get(db, 'SELECT 1 AS x FROM vendors WHERE id = ? AND deleted_at IS NULL', vendorId)) throw new UserError('That karigar or vendor no longer exists.');
  if (wage > 0 && !vendorId) throw new UserError('A wage is paid to someone. Choose who is making it, or leave the wage empty for in-house work.');
  const dueOn = input.dueOn || null;
  if (dueOn !== null && !isIsoDate(dueOn)) throw new UserError('Enter a valid due date.');
  return { qty, wage, vendorId, dueOn, note: optionalText(input.note ?? '', 'Note', 300) };
}

export function createOrder(db: Db, input: ProductionOrderInput): ProductionOrder {
  const v = check(db, input);
  const id = newId();
  const today = todayIso();
  tx(db, () => {
    const fy = financialYear(today);
    const seq = (get<{ n: number }>(db, 'SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM production_orders WHERE fy = ?', fy)?.n ?? 1);
    const now = nowIso();
    run(db, 'INSERT INTO production_orders (id, number, fy, seq, variant_id, qty, vendor_id, wage_paise, ordered_on, due_on, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, formatInvoiceNumber(PREFIX, fy, seq), fy, seq, input.variantId, v.qty, v.vendorId, v.wage, today, v.dueOn, v.note, now, now);
  });
  return getOrder(db, id);
}

/** An order can be changed until work starts. After that its quantity is what the materials were handed over for. */
export function updateOrder(db: Db, id: string, input: ProductionOrderInput): ProductionOrder {
  const existing = getOrder(db, id);
  if (existing.status !== 'planned') throw new UserError('Work has started on this order, so it can no longer be changed. You can still receive pieces, close it early, or (before any arrive) cancel it.');
  const v = check(db, input);
  run(db, 'UPDATE production_orders SET variant_id = ?, qty = ?, vendor_id = ?, wage_paise = ?, due_on = ?, note = ?, updated_at = ? WHERE id = ?', input.variantId, v.qty, v.vendorId, v.wage, v.dueOn, v.note, nowIso(), id);
  return getOrder(db, id);
}

/** Hands the raw materials over for the whole order. Fails, taking nothing, if the shop is short of any of them. */
function issueTx(db: Db, order: ProductionOrder): void {
  if (order.materialsIssued) return;
  const wanted = needs(db, order.variantId, order.qty);
  const short = wanted.filter((n) => getMaterial(db, n.materialId).stockQty < n.needed);
  if (short.length > 0) {
    throw new UserError(`Not enough raw material: ${short.map((n) => `${n.name} (need ${n.needed} ${n.unit}, have ${getMaterial(db, n.materialId).stockQty})`).join('; ')}. Buy some first (Raw materials > Buy).`);
  }
  for (const n of wanted) {
    recordMaterialMovement(db, n.materialId, -n.needed, 'used', `Order ${order.number}`, { type: 'production', id: order.id });
    run(db, 'INSERT INTO production_materials (order_id, material_id, qty) VALUES (?, ?, ?)', order.id, n.materialId, n.needed);
  }
  run(db, "UPDATE production_orders SET status = 'making', updated_at = ? WHERE id = ?", nowIso(), order.id);
}

export function issueMaterials(db: Db, id: string): ProductionOrder {
  const order = getOrder(db, id);
  if (order.status !== 'planned' && order.status !== 'making') throw new UserError(`This order is ${order.status === 'done' ? 'finished' : 'cancelled'}.`);
  if (order.materialsIssued) throw new UserError('The materials for this order have already been handed over.');
  tx(db, () => {
    issueTx(db, order);
    // An order with no raw materials in its costing still starts.
    run(db, "UPDATE production_orders SET status = 'making', updated_at = ? WHERE id = ? AND status = 'planned'", nowIso(), id);
  });
  return getOrder(db, id);
}

/**
 * Pieces have come back. They go on the shelf at once, and the wage for them (pieces × the wage per piece) is recorded as a bill to
 * whoever made them. If the materials had not been handed over yet, they are taken now. When the last piece arrives the order is finished.
 */
export function receivePieces(db: Db, id: string, input: { qty: number; receivedOn?: string }): ProductionOrder {
  const order = getOrder(db, id);
  if (order.status !== 'planned' && order.status !== 'making') throw new UserError(`This order is ${order.status === 'done' ? 'already finished' : 'cancelled'}.`);
  const qty = requireInt(input.qty, 'Pieces received', { min: 1, max: 100_000 });
  if (qty > order.remainingQty) throw new UserError(`Only ${order.remainingQty} more ${order.remainingQty === 1 ? 'piece is' : 'pieces are'} expected on this order.`);
  const on = input.receivedOn || todayIso();
  if (!isIsoDate(on) || on > todayIso()) throw new UserError('Enter the day they arrived, not in the future.');
  if (on < order.orderedOn) throw new UserError("They can't have arrived before the order was made.");

  tx(db, () => {
    issueTx(db, order);
    recordMovement(db, order.variantId, qty, 'production', `Order ${order.number}`, { type: 'production', id });
    const wage = qty * order.wagePaise;
    let expenseId: string | null = null;
    if (wage > 0) {
      expenseId = createExpense(db, {
        date: on,
        category: 'Job work',
        vendor: order.vendorName,
        amountPaise: wage,
        method: 'cash',
        reference: order.number,
        note: `${qty} × ${order.designName} ${order.color} ${order.size}`.slice(0, 300),
        status: 'unpaid',
        dueDate: addDays(on, 15),
      }).id;
    }
    run(db, 'INSERT INTO production_receipts (id, order_id, qty, received_on, wage_paise, expense_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', newId(), id, qty, on, wage, expenseId, nowIso());
    const received = order.receivedQty + qty;
    run(db, `UPDATE production_orders SET received_qty = ?, status = ?, closed_on = ?, updated_at = ? WHERE id = ?`, received, received >= order.qty ? 'done' : 'making', received >= order.qty ? on : null, nowIso(), id);
  });
  return getOrder(db, id);
}

/** Gives back the share of the handed-over materials that no piece was made from. */
function returnUnused(db: Db, order: ProductionOrder, why: string): void {
  const issued = issuedQty(db, order.id);
  const unusedShare = (order.qty - order.receivedQty) / order.qty;
  for (const [materialId, qty] of issued) {
    const back = roundQty(qty * unusedShare);
    if (back > 0) recordMaterialMovement(db, materialId, back, 'adjustment', `${why} — ${order.number}`, { type: 'production', id: order.id });
  }
}

/** Finishes an order with fewer pieces than planned. The materials meant for the missing ones go back to the shelf. */
export function closeShort(db: Db, id: string): ProductionOrder {
  const order = getOrder(db, id);
  if (order.status !== 'making') throw new UserError(order.status === 'planned' ? 'Nothing has been received yet. Cancel the order instead.' : `This order is ${order.status === 'done' ? 'already finished' : 'cancelled'}.`);
  if (order.receivedQty === 0) throw new UserError('Nothing has been received yet. Cancel the order instead.');
  tx(db, () => {
    returnUnused(db, order, 'Order closed with fewer pieces');
    run(db, "UPDATE production_orders SET status = 'done', closed_on = ?, updated_at = ? WHERE id = ?", todayIso(), nowIso(), id);
  });
  return getOrder(db, id);
}

export function cancelOrder(db: Db, id: string): ProductionOrder {
  const order = getOrder(db, id);
  if (order.status === 'done' || order.status === 'cancelled') throw new UserError(`This order is ${order.status === 'done' ? 'already finished' : 'already cancelled'}.`);
  if (order.receivedQty > 0) throw new UserError('Some pieces have already been received. Close the order early instead.');
  tx(db, () => {
    if (order.materialsIssued) returnUnused(db, order, 'Order cancelled');
    run(db, "UPDATE production_orders SET status = 'cancelled', closed_on = ?, updated_at = ? WHERE id = ?", todayIso(), nowIso(), id);
  });
  return getOrder(db, id);
}

/** Orders that are past their due date and still open, for the notifications. */
export function overdueOrders(db: Db): ProductionOrder[] {
  return listOrders(db, { status: 'open' }).filter((o) => o.overdue);
}
