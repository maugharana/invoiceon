import { financialYear, formatInvoiceNumber, isIsoDate, localDateOf, todayIso } from '../../shared/gst';
import { formatMoney } from '../../shared/money';
import { matchesAll } from '../../shared/search';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  type JobMaterial,
  type JobMaterialInput,
  type JobOrder,
  type JobOrderInput,
  type JobOrderQuery,
  type JobOrderStatus,
  type JobOrderSummary,
  type JobReceipt,
  type JobReceiptInput,
  type PaymentMethod,
  type Weaver,
  type WeaverInput,
  type WeaverLedger,
  type WeaverLedgerEntry,
  type WeaverPayment,
  type WeaverPaymentInput,
} from '../../shared/types';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, isUniqueViolation, newId, nowIso, optionalText, requireInt, requireText } from './common';
import { getVariant, isVariantLive, recordMovement } from './inventory';

const MAX_PAISE = 100_000_000_00;
const PREFIX = 'WO';

// ── Weavers ─────────────────────────────────────────────────────────────────
interface WeaverRow {
  id: string;
  name: string;
  phone: string;
  place: string;
  notes: string;
}

/** Wages earned per weaver: pieces on receipts that have not been reversed, times the order's wage. */
function earnedByWeaver(db: Db): Map<string, number> {
  return new Map(
    all<{ weaver_id: string; s: number }>(
      db,
      `SELECT o.weaver_id, SUM(r.qty * o.wage_paise) AS s FROM job_order_receipts r JOIN job_orders o ON o.id = r.order_id WHERE r.reversed_at IS NULL GROUP BY o.weaver_id`,
    ).map((r) => [r.weaver_id, r.s]),
  );
}
const paidByWeaver = (db: Db): Map<string, number> => new Map(all<{ weaver_id: string; s: number }>(db, 'SELECT weaver_id, SUM(amount_paise) AS s FROM weaver_payments WHERE voided_at IS NULL GROUP BY weaver_id').map((r) => [r.weaver_id, r.s]));

function toWeaver(r: WeaverRow, earned: number, paid: number, open: { orders: number; pieces: number }): Weaver {
  return { id: r.id, name: r.name, phone: r.phone, place: r.place, notes: r.notes, openOrders: open.orders, piecesPending: open.pieces, earnedPaise: earned, paidPaise: paid, balancePaise: earned - paid };
}

function openWork(db: Db): Map<string, { orders: number; pieces: number }> {
  const out = new Map<string, { orders: number; pieces: number }>();
  for (const o of listJobOrders(db)) {
    if (o.status !== 'open') continue;
    const w = out.get(o.weaverId) ?? { orders: 0, pieces: 0 };
    w.orders += 1;
    w.pieces += Math.max(0, o.qty - o.receivedQty);
    out.set(o.weaverId, w);
  }
  return out;
}

export function listWeavers(db: Db, query: { search?: string } = {}): Weaver[] {
  const earned = earnedByWeaver(db);
  const paid = paidByWeaver(db);
  const work = openWork(db);
  return all<WeaverRow>(db, 'SELECT id, name, phone, place, notes FROM weavers WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE')
    .map((r) => toWeaver(r, earned.get(r.id) ?? 0, paid.get(r.id) ?? 0, work.get(r.id) ?? { orders: 0, pieces: 0 }))
    .filter((w) => matchesAll([w.name, w.phone, w.place].join(' '), query.search));
}

export function getWeaver(db: Db, id: string): Weaver {
  const w = listWeavers(db).find((x) => x.id === id);
  if (!w) throw new UserError('That weaver no longer exists.');
  return w;
}

function validateWeaver(input: WeaverInput): WeaverInput {
  return {
    name: requireText(input.name, "The weaver's name"),
    phone: optionalText(input.phone, 'Phone', 20),
    place: optionalText(input.place, 'Place', 80),
    notes: optionalText(input.notes, 'Notes', 500),
  };
}

export function createWeaver(db: Db, input: WeaverInput): Weaver {
  const v = validateWeaver(input);
  const id = newId();
  const now = nowIso();
  run(db, 'INSERT INTO weavers (id, name, phone, place, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, v.name, v.phone, v.place, v.notes, now, now);
  return getWeaver(db, id);
}

export function updateWeaver(db: Db, id: string, input: WeaverInput): Weaver {
  const v = validateWeaver(input);
  getWeaver(db, id);
  run(db, 'UPDATE weavers SET name = ?, phone = ?, place = ?, notes = ?, updated_at = ? WHERE id = ?', v.name, v.phone, v.place, v.notes, nowIso(), id);
  return getWeaver(db, id);
}

export function archiveWeaver(db: Db, id: string): void {
  const w = getWeaver(db, id);
  if (w.openOrders > 0) throw new UserError(`${w.name} still has ${w.openOrders} open ${w.openOrders === 1 ? 'order' : 'orders'}. Receive or close them before archiving.`);
  if (w.balancePaise > 0) throw new UserError(`You still owe ${w.name} ${formatMoney(w.balancePaise)}. Pay them before archiving.`);
  if (w.balancePaise < 0) throw new UserError(`${w.name} holds ${formatMoney(-w.balancePaise)} of your money as an advance. Settle it before archiving.`);
  run(db, 'UPDATE weavers SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
}

// ── Job orders ──────────────────────────────────────────────────────────────
interface OrderRow {
  id: string;
  number: string;
  fy: string;
  seq: number;
  weaver_id: string;
  weaver_name: string;
  variant_id: string;
  design_name: string;
  color: string;
  size: string;
  sku: string;
  qty: number;
  wage_paise: number;
  ordered_on: string;
  expected_on: string | null;
  note: string;
  status: 'open' | 'closed' | 'cancelled';
  closed_at: string | null;
  close_reason: string;
  received: number;
}

const ORDER_SELECT = `
  SELECT o.*, w.name AS weaver_name, d.name AS design_name, v.color, v.size, v.sku,
    COALESCE((SELECT SUM(r.qty) FROM job_order_receipts r WHERE r.order_id = o.id AND r.reversed_at IS NULL), 0) AS received
  FROM job_orders o JOIN weavers w ON w.id = o.weaver_id JOIN variants v ON v.id = o.variant_id JOIN designs d ON d.id = v.design_id`;

function statusOf(r: OrderRow): JobOrderStatus {
  if (r.status === 'cancelled') return 'cancelled';
  if (r.status === 'closed') return 'closed';
  return r.received >= r.qty ? 'complete' : 'open';
}

function toSummary(r: OrderRow): JobOrderSummary {
  const status = statusOf(r);
  return {
    id: r.id,
    number: r.number,
    weaverId: r.weaver_id,
    weaverName: r.weaver_name,
    variantId: r.variant_id,
    designName: r.design_name,
    color: r.color,
    size: r.size,
    sku: r.sku,
    qty: r.qty,
    receivedQty: r.received,
    wagePaise: r.wage_paise,
    orderedOn: r.ordered_on,
    expectedOn: r.expected_on,
    status,
    overdue: status === 'open' && !!r.expected_on && r.expected_on < todayIso(),
  };
}

export function listJobOrders(db: Db, query: JobOrderQuery = {}): JobOrderSummary[] {
  const where = query.weaverId ? 'WHERE o.weaver_id = ?' : '';
  return all<OrderRow>(db, `${ORDER_SELECT} ${where} ORDER BY o.ordered_on DESC, o.seq DESC`, ...(query.weaverId ? [query.weaverId] : []))
    .map(toSummary)
    .filter((o) => {
      if (query.status === 'open') return o.status === 'open';
      if (query.status === 'overdue') return o.overdue;
      if (query.status === 'done') return o.status === 'complete' || o.status === 'closed' || o.status === 'cancelled';
      return true;
    });
}

export function getJobOrder(db: Db, id: string): JobOrder {
  const row = get<OrderRow>(db, `${ORDER_SELECT} WHERE o.id = ?`, id);
  if (!row) throw new UserError('That order no longer exists.');
  const materials = all<{ id: string; material_id: string; name: string; unit: string; qty: number; unit_cost_paise: number; issued_on: string; note: string }>(
    db,
    'SELECT m.id, m.material_id, r.name, r.unit, m.qty, m.unit_cost_paise, m.issued_on, m.note FROM job_order_materials m JOIN raw_materials r ON r.id = m.material_id WHERE m.order_id = ? ORDER BY m.issued_on, m.created_at',
    id,
  ).map((m): JobMaterial => ({ id: m.id, materialId: m.material_id, materialName: m.name, unit: m.unit, qty: m.qty, unitCostPaise: m.unit_cost_paise, issuedOn: m.issued_on, note: m.note }));
  const receipts = all<{ id: string; qty: number; received_on: string; note: string; reversed_at: string | null; reverse_reason: string }>(
    db,
    'SELECT id, qty, received_on, note, reversed_at, reverse_reason FROM job_order_receipts WHERE order_id = ? ORDER BY received_on, created_at',
    id,
  ).map((r): JobReceipt => ({ id: r.id, qty: r.qty, receivedOn: r.received_on, note: r.note, reversed: r.reversed_at !== null, reverseReason: r.reverse_reason }));
  const materialsValue = Math.round(materials.reduce((s, m) => s + m.qty * m.unitCostPaise, 0));
  return {
    ...toSummary(row),
    note: row.note,
    materials,
    receipts,
    materialsValuePaise: materialsValue,
    earnedPaise: row.received * row.wage_paise,
    realCostPerPiecePaise: row.wage_paise + Math.round(materialsValue / row.qty),
    closedAt: row.closed_at,
    closeReason: row.close_reason,
  };
}

const nextSequence = (db: Db, fy: string): number => get<{ next: number }>(db, 'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM job_orders WHERE fy = ?', fy)?.next ?? 1;

export function createJobOrder(db: Db, input: JobOrderInput): JobOrder {
  getWeaver(db, input.weaverId);
  if (!isVariantLive(db, input.variantId)) throw new UserError('Choose the saree this order is for.');
  const qty = requireInt(input.qty, 'Number of pieces', { min: 1, max: 100_000 });
  const wage = requireInt(input.wagePaise, 'Wage per piece', { max: MAX_PAISE });
  if (input.expectedOn !== null && !isIsoDate(input.expectedOn)) throw new UserError('Enter a valid date you expect the pieces by.');
  const today = todayIso();
  if (input.expectedOn !== null && input.expectedOn < today) throw new UserError("The expected date can't be in the past.");
  const note = optionalText(input.note, 'Note', 300);
  const id = newId();
  const fy = financialYear(today);
  tx(db, () => {
    const seq = nextSequence(db, fy);
    const now = nowIso();
    try {
      run(db, 'INSERT INTO job_orders (id, number, fy, seq, weaver_id, variant_id, qty, wage_paise, ordered_on, expected_on, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, formatInvoiceNumber(PREFIX, fy, seq), fy, seq, input.weaverId, input.variantId, qty, wage, today, input.expectedOn, note, now, now);
    } catch (err) {
      if (isUniqueViolation(err)) throw new UserError('Another order took that number a moment ago. Please try again.');
      throw err;
    }
  });
  return getJobOrder(db, id);
}

/** Orders that can still change: not closed, not cancelled. */
function openOrder(db: Db, id: string): JobOrder {
  const o = getJobOrder(db, id);
  if (o.status === 'cancelled') throw new UserError(`${o.number} is cancelled.`);
  if (o.status === 'closed') throw new UserError(`${o.number} is closed.`);
  return o;
}

export function issueMaterial(db: Db, input: JobMaterialInput): JobOrder {
  const order = openOrder(db, input.orderId);
  const material = get<{ id: string; name: string; unit: string; unit_cost_paise: number }>(db, 'SELECT id, name, unit, unit_cost_paise FROM raw_materials WHERE id = ? AND deleted_at IS NULL', input.materialId);
  if (!material) throw new UserError('Choose the raw material.');
  if (typeof input.qty !== 'number' || !Number.isFinite(input.qty) || input.qty === 0 || Math.abs(input.qty) > 1_000_000) throw new UserError('Enter how much was handed over (or a minus number for material handed back).');
  if (!isIsoDate(input.issuedOn) || input.issuedOn > todayIso()) throw new UserError('Enter a valid date, not in the future.');
  if (input.qty < 0) {
    const held = order.materials.filter((m) => m.materialId === material.id).reduce((s, m) => s + m.qty, 0);
    // Small tolerance so 0.1 + 0.2 style arithmetic does not refuse an exact hand back.
    if (held + input.qty < -1e-9) throw new UserError(`Only ${+held.toFixed(3)} ${material.unit} of ${material.name} is out with the weaver on this order.`);
  }
  run(db, 'INSERT INTO job_order_materials (id, order_id, material_id, qty, unit_cost_paise, issued_on, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', newId(), order.id, material.id, input.qty, material.unit_cost_paise, input.issuedOn, optionalText(input.note, 'Note', 200), nowIso());
  return getJobOrder(db, order.id);
}

/** Pieces come back: they go into stock through the ledger, and the wage for them becomes owed to the weaver. */
export function receivePieces(db: Db, input: JobReceiptInput): JobOrder {
  const order = openOrder(db, input.orderId);
  const qty = requireInt(input.qty, 'Pieces received', { min: 1, max: 100_000 });
  if (!isIsoDate(input.receivedOn) || input.receivedOn > todayIso()) throw new UserError('Enter a valid date, not in the future.');
  if (input.receivedOn < order.orderedOn) throw new UserError("The pieces can't have come back before the order was placed.");
  // Weavers sometimes send a few extra, but a number far above the order is almost always a typo.
  const limit = Math.ceil(order.qty * 1.5);
  if (order.receivedQty + qty > limit) throw new UserError(`That would make ${order.receivedQty + qty} received against ${order.qty} ordered. Check the number.`);
  if (!isVariantLive(db, order.variantId)) throw new UserError('This saree has been archived, so its pieces cannot be added to stock.');

  tx(db, () => {
    const id = newId();
    run(db, 'INSERT INTO job_order_receipts (id, order_id, qty, received_on, note, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, order.id, qty, input.receivedOn, optionalText(input.note, 'Note', 200), nowIso());
    if (input.updateCost) {
      // What a piece really costs: the wage plus its share of the material handed over. The saree's cost is its own making cost plus
      // its raw materials, so its making cost is set to the difference.
      const materialCost = getVariant(db, order.variantId).materialCostPaise;
      run(db, 'UPDATE variants SET base_cost_paise = ?, updated_at = ? WHERE id = ?', Math.max(0, order.realCostPerPiecePaise - materialCost), nowIso(), order.variantId);
    }
    recordMovement(db, order.variantId, qty, 'production', `Received from ${order.weaverName} (${order.number})`, { type: 'job_receipt', id });
  });
  return getJobOrder(db, order.id);
}

/** Undoes a receipt entered by mistake: the pieces come back out of stock and the wage is no longer owed. */
export function reverseReceipt(db: Db, receiptId: string, reason: string): JobOrder {
  const r = get<{ id: string; order_id: string; qty: number; reversed_at: string | null }>(db, 'SELECT id, order_id, qty, reversed_at FROM job_order_receipts WHERE id = ?', receiptId);
  if (!r) throw new UserError('That receipt no longer exists.');
  if (r.reversed_at) throw new UserError('This receipt is already reversed.');
  const order = getJobOrder(db, r.order_id);
  tx(db, () => {
    if (isVariantLive(db, order.variantId)) {
      try {
        recordMovement(db, order.variantId, -r.qty, 'production', `Receipt from ${order.weaverName} reversed (${order.number})`, { type: 'job_receipt', id: r.id });
      } catch (err) {
        if (err instanceof UserError) throw new UserError(`Some of these pieces are already gone from stock (sold or adjusted), so the receipt can't be reversed. ${err.message}`);
        throw err;
      }
    }
    run(db, 'UPDATE job_order_receipts SET reversed_at = ?, reverse_reason = ? WHERE id = ?', nowIso(), optionalText(reason, 'Reason', 200), r.id);
  });
  return getJobOrder(db, order.id);
}

/** Stops waiting for the rest of an order (the weaver delivered fewer than asked). What was received stays, and stays owed. */
export function closeJobOrder(db: Db, id: string, reason: string): JobOrder {
  const o = openOrder(db, id);
  if (o.status === 'complete') throw new UserError(`${o.number} is already fully received.`);
  run(db, "UPDATE job_orders SET status = 'closed', closed_at = ?, close_reason = ?, updated_at = ? WHERE id = ?", nowIso(), optionalText(reason, 'Reason', 200), nowIso(), id);
  return getJobOrder(db, id);
}

export function cancelJobOrder(db: Db, id: string, reason: string): JobOrder {
  const o = openOrder(db, id);
  if (o.receipts.some((r) => !r.reversed)) throw new UserError(`${o.number} already has pieces received against it. Close it instead, or reverse the receipts first.`);
  run(db, "UPDATE job_orders SET status = 'cancelled', closed_at = ?, close_reason = ?, updated_at = ? WHERE id = ?", nowIso(), optionalText(reason, 'Reason', 200), nowIso(), id);
  return getJobOrder(db, id);
}

// ── Paying weavers ──────────────────────────────────────────────────────────
interface PaymentRow {
  id: string;
  weaver_id: string;
  weaver_name: string;
  order_id: string | null;
  order_number: string | null;
  amount_paise: number;
  method: PaymentMethod;
  reference: string;
  paid_on: string;
  note: string;
  voided_at: string | null;
  void_reason: string;
}

const PAYMENT_SELECT = 'SELECT p.*, w.name AS weaver_name, o.number AS order_number FROM weaver_payments p JOIN weavers w ON w.id = p.weaver_id LEFT JOIN job_orders o ON o.id = p.order_id';

const toPayment = (r: PaymentRow): WeaverPayment => ({
  id: r.id,
  weaverId: r.weaver_id,
  weaverName: r.weaver_name,
  orderId: r.order_id,
  orderNumber: r.order_number,
  amountPaise: r.amount_paise,
  method: r.method,
  reference: r.reference,
  paidOn: r.paid_on,
  note: r.note,
  voided: r.voided_at !== null,
  voidReason: r.void_reason,
});

export function listWeaverPayments(db: Db, query: { weaverId?: string } = {}): WeaverPayment[] {
  const where = query.weaverId ? 'WHERE p.weaver_id = ?' : '';
  return all<PaymentRow>(db, `${PAYMENT_SELECT} ${where} ORDER BY p.paid_on DESC, p.created_at DESC, p.rowid DESC`, ...(query.weaverId ? [query.weaverId] : [])).map(toPayment);
}

export function recordWeaverPayment(db: Db, input: WeaverPaymentInput): WeaverPayment {
  getWeaver(db, input.weaverId);
  const amount = requireInt(input.amountPaise, 'Amount', { min: 1, max: MAX_PAISE });
  if (!(PAYMENT_METHODS as readonly string[]).includes(input.method)) throw new UserError('Choose how the payment was made.');
  if (!isIsoDate(input.paidOn) || input.paidOn > todayIso()) throw new UserError('Enter a valid payment date, not in the future.');
  if (input.orderId) {
    const o = get<{ weaver_id: string }>(db, 'SELECT weaver_id FROM job_orders WHERE id = ?', input.orderId);
    if (!o || o.weaver_id !== input.weaverId) throw new UserError("That order isn't this weaver's.");
  }
  const id = newId();
  const now = nowIso();
  run(db, 'INSERT INTO weaver_payments (id, weaver_id, order_id, amount_paise, method, reference, paid_on, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, input.weaverId, input.orderId ?? null, amount, input.method, optionalText(input.reference, 'Reference', 60), input.paidOn, optionalText(input.note, 'Note', 200), now, now);
  return toPayment(get<PaymentRow>(db, `${PAYMENT_SELECT} WHERE p.id = ?`, id)!);
}

export function voidWeaverPayment(db: Db, id: string, reason: string): WeaverPayment {
  const row = get<PaymentRow>(db, `${PAYMENT_SELECT} WHERE p.id = ?`, id);
  if (!row) throw new UserError('That payment no longer exists.');
  if (row.voided_at) throw new UserError('This payment is already reversed.');
  const at = nowIso();
  run(db, 'UPDATE weaver_payments SET voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ?', at, optionalText(reason, 'Reason', 200), at, id);
  return toPayment(get<PaymentRow>(db, `${PAYMENT_SELECT} WHERE p.id = ?`, id)!);
}

// ── Ledger ──────────────────────────────────────────────────────────────────
/** A running statement with a weaver: wages earned on pieces received, less what you paid. Reversals stay visible. */
export function weaverLedger(db: Db, weaverId: string): WeaverLedger {
  const weaver = getWeaver(db, weaverId);
  const events: { date: string; at: string; kind: WeaverLedgerEntry['kind']; description: string; orderId?: string; earned: number; paid: number }[] = [];
  const receipts = all<{ id: string; order_id: string; number: string; qty: number; wage_paise: number; received_on: string; created_at: string; reversed_at: string | null; reverse_reason: string; design_name: string; color: string }>(
    db,
    `SELECT r.id, r.order_id, o.number, r.qty, o.wage_paise, r.received_on, r.created_at, r.reversed_at, r.reverse_reason, d.name AS design_name, v.color
     FROM job_order_receipts r JOIN job_orders o ON o.id = r.order_id JOIN variants v ON v.id = o.variant_id JOIN designs d ON d.id = v.design_id WHERE o.weaver_id = ?`,
    weaverId,
  );
  for (const r of receipts) {
    const what = `${r.qty} × ${r.design_name} (${r.color}) at ${formatMoney(r.wage_paise)} · ${r.number}`;
    events.push({ date: r.received_on, at: r.created_at, kind: 'received', description: `Received ${what}`, orderId: r.order_id, earned: r.qty * r.wage_paise, paid: 0 });
    if (r.reversed_at) events.push({ date: localDateOf(r.reversed_at), at: r.reversed_at, kind: 'received-reversed', description: `Receipt reversed: ${what}${r.reverse_reason ? ` (${r.reverse_reason})` : ''}`, orderId: r.order_id, earned: -(r.qty * r.wage_paise), paid: 0 });
  }
  for (const p of listWeaverPayments(db, { weaverId })) {
    const via = [PAYMENT_METHOD_LABEL[p.method], p.reference].filter(Boolean).join(' · ');
    const row = get<{ created_at: string; voided_at: string | null }>(db, 'SELECT created_at, voided_at FROM weaver_payments WHERE id = ?', p.id)!;
    events.push({ date: p.paidOn, at: row.created_at, kind: 'payment', description: `Paid (${via})${p.orderNumber ? ` · ${p.orderNumber}` : ''}${p.note ? `: ${p.note}` : ''}`, orderId: p.orderId ?? undefined, earned: 0, paid: p.amountPaise });
    if (row.voided_at) events.push({ date: localDateOf(row.voided_at), at: row.voided_at, kind: 'payment-voided', description: `Payment reversed (${via})${p.voidReason ? `: ${p.voidReason}` : ''}`, earned: 0, paid: -p.amountPaise });
  }
  events.sort((a, b) => (a.date === b.date ? a.at.localeCompare(b.at) : a.date.localeCompare(b.date)));
  let balance = 0;
  const entries = events.map((e): WeaverLedgerEntry => {
    balance += e.earned - e.paid;
    return { date: e.date, kind: e.kind, description: e.description, orderId: e.orderId, earnedPaise: e.earned, paidPaise: e.paid, balancePaise: balance };
  });
  return { weaver, entries };
}
