import { financialYear, formatInvoiceNumber, isIsoDate, todayIso } from '../../shared/gst';
import { formatMoney } from '../../shared/money';
import { matchesAll } from '../../shared/search';
import {
  PAYMENT_METHODS,
  type PaymentMethod,
  type WeaverOrder,
  type WeaverOrderDraft,
  type WeaverOrderInput,
  type WeaverOrderQuery,
  type WeaverOrderStatus,
  type WeaverOrderSummary,
  type WeaverPayInput,
  type WeaverReceiveInput,
} from '../../shared/types';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, newId, nowIso, optionalText, requireInt } from './common';
import { createExpense, deleteExpense } from './expenses';
import { recordMovement } from './inventory';
import { getSettings } from './settings';

const MAX_PAISE = 100_000_000_00;
const MAX_QTY = 10_000;
/** The expense category a payment to a weaver goes under. */
export const WEAVER_CATEGORY = 'Weaver payments';

interface OrderRow {
  id: string;
  number: string;
  vendor_id: string;
  vendor_name: string;
  ordered_on: string;
  expected_on: string | null;
  note: string;
  proforma_id: string | null;
  proforma_number: string | null;
  cancelled_at: string | null;
  cancel_reason: string;
  pieces: number;
  received: number;
  total: number;
  paid: number;
}

const SELECT = `
  SELECT o.id, o.number, o.vendor_id, v.name AS vendor_name, o.ordered_on, o.expected_on, o.note, o.proforma_id, p.number AS proforma_number, o.cancelled_at, o.cancel_reason,
    (SELECT COALESCE(SUM(qty), 0) FROM weaver_order_lines WHERE order_id = o.id) AS pieces,
    (SELECT COALESCE(SUM(received_qty), 0) FROM weaver_order_lines WHERE order_id = o.id) AS received,
    (SELECT COALESCE(SUM(qty * unit_cost_paise), 0) FROM weaver_order_lines WHERE order_id = o.id) AS total,
    (SELECT COALESCE(SUM(amount_paise), 0) FROM weaver_payments WHERE order_id = o.id AND voided_at IS NULL) AS paid
  FROM weaver_orders o JOIN vendors v ON v.id = o.vendor_id LEFT JOIN proformas p ON p.id = o.proforma_id`;

function statusOf(r: Pick<OrderRow, 'cancelled_at' | 'pieces' | 'received'>): WeaverOrderStatus {
  if (r.cancelled_at) return 'cancelled';
  if (r.pieces > 0 && r.received >= r.pieces) return 'received';
  return r.received > 0 ? 'partial' : 'open';
}

function toSummary(r: OrderRow, today: string): WeaverOrderSummary {
  const status = statusOf(r);
  return {
    id: r.id,
    number: r.number,
    vendorId: r.vendor_id,
    vendorName: r.vendor_name,
    orderedOn: r.ordered_on,
    expectedOn: r.expected_on,
    status,
    late: !!r.expected_on && r.expected_on < today && (status === 'open' || status === 'partial'),
    pieces: r.pieces,
    receivedPieces: r.received,
    totalPaise: r.total,
    paidPaise: r.paid,
    proformaId: r.proforma_id,
    proformaNumber: r.proforma_number,
  };
}

export function listWeaverOrders(db: Db, query: WeaverOrderQuery = {}, today: string = todayIso()): WeaverOrderSummary[] {
  const where: string[] = [];
  const params: string[] = [];
  if (query.vendorId) {
    where.push('o.vendor_id = ?');
    params.push(query.vendorId);
  }
  if (query.proformaId) {
    where.push('o.proforma_id = ?');
    params.push(query.proformaId);
  }
  return all<OrderRow>(db, `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.ordered_on DESC, o.seq DESC, o.created_at DESC`, ...params)
    .map((r) => toSummary(r, today))
    .filter((o) => (query.status === 'open' ? o.status === 'open' || o.status === 'partial' : query.status ? o.status === query.status : true))
    .filter((o) => matchesAll(`${o.number} ${o.vendorName} ${o.proformaNumber ?? ''}`, query.search));
}

export function getWeaverOrder(db: Db, id: string): WeaverOrder {
  const row = get<OrderRow>(db, `${SELECT} WHERE o.id = ?`, id);
  if (!row) throw new UserError('That weaver order no longer exists.');
  const lines = all<{ id: string; variant_id: string; design_name: string; color: string; size: string; sku: string; qty: number; received_qty: number; unit_cost_paise: number }>(
    db,
    'SELECT id, variant_id, design_name, color, size, sku, qty, received_qty, unit_cost_paise FROM weaver_order_lines WHERE order_id = ? ORDER BY position',
    id,
  ).map((l) => ({ id: l.id, variantId: l.variant_id, designName: l.design_name, color: l.color, size: l.size, sku: l.sku, qty: l.qty, receivedQty: l.received_qty, unitCostPaise: l.unit_cost_paise, amountPaise: l.qty * l.unit_cost_paise }));
  const payments = all<{ id: string; paid_on: string; amount_paise: number; method: PaymentMethod; account_id: string; reference: string; voided_at: string | null }>(
    db,
    'SELECT id, paid_on, amount_paise, method, account_id, reference, voided_at FROM weaver_payments WHERE order_id = ? ORDER BY paid_on, created_at',
    id,
  ).map((p) => ({ id: p.id, paidOn: p.paid_on, amountPaise: p.amount_paise, method: p.method, accountId: p.account_id, reference: p.reference, voidedAt: p.voided_at }));
  const receipts = all<{ id: string; line_id: string; qty: number; received_on: string }>(db, 'SELECT id, line_id, qty, received_on FROM weaver_receipts WHERE order_id = ? ORDER BY received_on, created_at', id).map((r) => ({ id: r.id, lineId: r.line_id, qty: r.qty, receivedOn: r.received_on }));
  return { ...toSummary(row, todayIso()), note: row.note, cancelledAt: row.cancelled_at, cancelReason: row.cancel_reason, lines, payments, receipts };
}

// ── Checking what was sent ──────────────────────────────────────────────────
interface VariantInfo {
  id: string;
  sku: string;
  color: string;
  size: string;
  stock: number;
  base_cost_paise: number;
  design_name: string;
  supplier_id: string | null;
}

function variantInfo(db: Db, id: unknown): VariantInfo {
  const v = get<VariantInfo>(
    db,
    `SELECT v.id, v.sku, v.color, v.size, v.stock, v.base_cost_paise, d.name AS design_name, d.supplier_id
     FROM variants v JOIN designs d ON d.id = v.design_id WHERE v.id = ? AND v.deleted_at IS NULL AND d.deleted_at IS NULL`,
    typeof id === 'string' ? id : '',
  );
  if (!v) throw new UserError('One of the sarees on this order no longer exists. Remove it and add it again.');
  return v;
}

function checkHeader(db: Db, input: WeaverOrderInput) {
  const vendor = get<{ id: string }>(db, 'SELECT id FROM vendors WHERE id = ? AND deleted_at IS NULL', typeof input.vendorId === 'string' ? input.vendorId : '');
  if (!vendor) throw new UserError('Choose the weaver this order is for.');
  if (!isIsoDate(input.orderedOn) || input.orderedOn > todayIso()) throw new UserError('Enter the day you ordered it, not in the future.');
  const expectedOn = input.expectedOn ? input.expectedOn : null;
  if (expectedOn !== null && (!isIsoDate(expectedOn) || expectedOn < input.orderedOn)) throw new UserError('The expected day should be on or after the day you ordered.');
  const proformaId = input.proformaId ? input.proformaId : null;
  if (proformaId && !get(db, 'SELECT 1 AS x FROM proformas WHERE id = ?', proformaId)) throw new UserError('That quote no longer exists.');
  return { vendorId: vendor.id, orderedOn: input.orderedOn, expectedOn, proformaId, note: optionalText(input.note, 'Note', 300) };
}

function checkLines(db: Db, input: WeaverOrderInput) {
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new UserError('Add at least one saree to the order.');
  if (input.lines.length > 50) throw new UserError('An order can have at most 50 sarees.');
  const seen = new Set<string>();
  return input.lines.map((l) => {
    const v = variantInfo(db, l.variantId);
    if (seen.has(v.id)) throw new UserError(`${v.design_name} (${v.color}, ${v.size}) is on the order twice. Combine them into one line.`);
    seen.add(v.id);
    return { id: typeof l.id === 'string' && l.id ? l.id : null, v, qty: requireInt(l.qty, 'Quantity', { min: 1, max: MAX_QTY }), cost: requireInt(l.unitCostPaise ?? 0, 'The price per piece', { max: MAX_PAISE }) };
  });
}

function nextNumber(db: Db, orderedOn: string): { fy: string; seq: number; number: string } {
  const fy = financialYear(orderedOn);
  const seq = get<{ n: number }>(db, 'SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM weaver_orders WHERE fy = ?', fy)?.n ?? 1;
  return { fy, seq, number: formatInvoiceNumber('WO', fy, seq) };
}

// ── Writing ─────────────────────────────────────────────────────────────────
export function createWeaverOrder(db: Db, input: WeaverOrderInput): WeaverOrder {
  const h = checkHeader(db, input);
  const lines = checkLines(db, input);
  const id = newId();
  tx(db, () => {
    const n = nextNumber(db, h.orderedOn);
    const now = nowIso();
    run(db, 'INSERT INTO weaver_orders (id, number, fy, seq, vendor_id, ordered_on, expected_on, note, proforma_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, n.number, n.fy, n.seq, h.vendorId, h.orderedOn, h.expectedOn, h.note, h.proformaId, now, now);
    lines.forEach((l, i) => {
      run(db, 'INSERT INTO weaver_order_lines (id, order_id, variant_id, position, qty, unit_cost_paise, design_name, color, size, sku) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', newId(), id, l.v.id, i, l.qty, l.cost, l.v.design_name, l.v.color, l.v.size, l.v.sku);
    });
  });
  return getWeaverOrder(db, id);
}

function requireOpen(db: Db, id: string): WeaverOrder {
  const order = getWeaverOrder(db, id);
  if (order.status === 'cancelled') throw new UserError(`${order.number} is cancelled.`);
  return order;
}

export function updateWeaverOrder(db: Db, id: string, input: WeaverOrderInput): WeaverOrder {
  const order = requireOpen(db, id);
  const h = checkHeader(db, input);
  if (h.vendorId !== order.vendorId && order.payments.some((p) => !p.voidedAt)) throw new UserError(`Money has been paid to ${order.vendorName} on this order, so the weaver can't be changed. Take the payments back first.`);
  const lines = checkLines(db, input);
  const existing = new Map(order.lines.map((l) => [l.id, l]));
  for (const l of lines) {
    if (l.id && !existing.has(l.id)) throw new UserError('A line on this order has changed since you opened it. Reopen the order and try again.');
    const was = l.id ? existing.get(l.id)! : null;
    if (was && was.variantId !== l.v.id) throw new UserError('A line can\'t be changed to a different saree. Remove it and add the other one.');
    if (was && l.qty < was.receivedQty) throw new UserError(`${was.designName} (${was.color}) has ${was.receivedQty} received already, so the order can't be for fewer than that.`);
  }
  const kept = new Set(lines.map((l) => l.id).filter(Boolean));
  for (const was of order.lines) if (!kept.has(was.id) && was.receivedQty > 0) throw new UserError(`${was.designName} (${was.color}) has ${was.receivedQty} received already, so it can't be removed.`);

  tx(db, () => {
    run(db, 'UPDATE weaver_orders SET vendor_id = ?, ordered_on = ?, expected_on = ?, note = ?, proforma_id = ?, updated_at = ? WHERE id = ?', h.vendorId, h.orderedOn, h.expectedOn, h.note, h.proformaId, nowIso(), id);
    for (const was of order.lines) if (!kept.has(was.id)) run(db, 'DELETE FROM weaver_order_lines WHERE id = ?', was.id);
    lines.forEach((l, i) => {
      if (l.id) run(db, 'UPDATE weaver_order_lines SET position = ?, qty = ?, unit_cost_paise = ? WHERE id = ?', i, l.qty, l.cost, l.id);
      else run(db, 'INSERT INTO weaver_order_lines (id, order_id, variant_id, position, qty, unit_cost_paise, design_name, color, size, sku) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', newId(), id, l.v.id, i, l.qty, l.cost, l.v.design_name, l.v.color, l.v.size, l.v.sku);
    });
  });
  return getWeaverOrder(db, id);
}

export function receiveWeaverOrder(db: Db, id: string, input: WeaverReceiveInput): WeaverOrder {
  const order = requireOpen(db, id);
  if (!isIsoDate(input.receivedOn) || input.receivedOn > todayIso()) throw new UserError('Enter the day it arrived, not in the future.');
  const arriving = (Array.isArray(input.lines) ? input.lines : []).filter((l) => l && Number(l.qty) > 0);
  if (arriving.length === 0) throw new UserError('Enter how many of at least one saree arrived.');
  const byId = new Map(order.lines.map((l) => [l.id, l]));
  const seen = new Set<string>();
  const checked = arriving.map((l) => {
    const line = byId.get(l.lineId);
    if (!line) throw new UserError('A line on this order has changed since you opened it. Reopen the order and try again.');
    if (seen.has(line.id)) throw new UserError(`${line.designName} (${line.color}) is listed twice.`);
    seen.add(line.id);
    const qty = requireInt(l.qty, 'Quantity', { min: 1, max: MAX_QTY });
    const left = line.qty - line.receivedQty;
    if (qty > left) throw new UserError(`${line.designName} (${line.color}): only ${left} more ${left === 1 ? 'is' : 'are'} still to come on this order, not ${qty}.`);
    return { line, qty };
  });
  tx(db, () => {
    for (const { line, qty } of checked) {
      // Stock only ever changes through the ledger, so a delivery is a 'purchase' movement that points back at this order.
      recordMovement(db, line.variantId, qty, 'purchase', `Weaver order ${order.number}`, { type: 'weaver_order', id });
      run(db, 'UPDATE weaver_order_lines SET received_qty = received_qty + ? WHERE id = ?', qty, line.id);
      run(db, 'INSERT INTO weaver_receipts (id, order_id, line_id, qty, received_on, created_at) VALUES (?, ?, ?, ?, ?, ?)', newId(), id, line.id, qty, input.receivedOn, nowIso());
    }
    run(db, 'UPDATE weaver_orders SET updated_at = ? WHERE id = ?', nowIso(), id);
  });
  return getWeaverOrder(db, id);
}

export function payWeaverOrder(db: Db, id: string, input: WeaverPayInput): WeaverOrder {
  const order = requireOpen(db, id);
  if (!isIsoDate(input.paidOn) || input.paidOn > todayIso()) throw new UserError('Enter the day you paid, not in the future.');
  const amount = requireInt(input.amountPaise, 'Amount', { min: 1, max: MAX_PAISE });
  if (!(PAYMENT_METHODS as readonly string[]).includes(input.method)) throw new UserError('Choose how it was paid.');
  if (order.totalPaise <= 0) throw new UserError("Enter the price per piece on this order first, so there is an amount to pay against.");
  const balance = order.totalPaise - order.paidPaise;
  if (amount > balance) throw new UserError(`That is more than the ${formatMoney(balance)} still to pay on ${order.number}.`);
  const accountId = typeof input.accountId === 'string' ? input.accountId : '';
  if (accountId && !getSettings(db).paymentAccounts.some((a) => a.id === accountId)) throw new UserError('Choose the account from the list.');
  const reference = optionalText(input.reference, 'Reference', 60);
  tx(db, () => {
    const expense = createExpense(db, { date: input.paidOn, category: WEAVER_CATEGORY, vendor: order.vendorName, amountPaise: amount, method: input.method, accountId, reference: reference || order.number, note: `Weaver order ${order.number}`, status: 'paid' });
    run(db, 'INSERT INTO weaver_payments (id, order_id, paid_on, amount_paise, method, account_id, reference, expense_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', newId(), id, input.paidOn, amount, input.method, accountId, reference, expense.id, nowIso());
    run(db, 'UPDATE weaver_orders SET updated_at = ? WHERE id = ?', nowIso(), id);
  });
  return getWeaverOrder(db, id);
}

export function voidWeaverPayment(db: Db, paymentId: string): WeaverOrder {
  const p = get<{ id: string; order_id: string; expense_id: string | null; voided_at: string | null }>(db, 'SELECT id, order_id, expense_id, voided_at FROM weaver_payments WHERE id = ?', paymentId);
  if (!p) throw new UserError('That payment no longer exists.');
  if (p.voided_at) throw new UserError('This payment is already taken back.');
  tx(db, () => {
    if (p.expense_id) deleteExpense(db, p.expense_id);
    run(db, 'UPDATE weaver_payments SET voided_at = ? WHERE id = ?', nowIso(), paymentId);
    run(db, 'UPDATE weaver_orders SET updated_at = ? WHERE id = ?', nowIso(), p.order_id);
  });
  return getWeaverOrder(db, p.order_id);
}

export function cancelWeaverOrder(db: Db, id: string, reason: string): WeaverOrder {
  const order = requireOpen(db, id);
  if (order.receivedPieces > 0) throw new UserError(`${order.receivedPieces} ${order.receivedPieces === 1 ? 'piece has' : 'pieces have'} arrived on ${order.number}, so it can't be cancelled.`);
  if (order.payments.some((p) => !p.voidedAt)) throw new UserError(`Money has been paid on ${order.number}. Take those payments back before cancelling it.`);
  run(db, 'UPDATE weaver_orders SET cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?', nowIso(), optionalText(reason, 'Reason', 200), nowIso(), id);
  return getWeaverOrder(db, id);
}

/**
 * What is short for a quote, as a starting point: for each item still to be invoiced, how many more pieces are needed than are in stock
 * or already on order to a weaver for this quote. Prices start at what the piece costs today. The weaver is filled in when every
 * short saree has the same usual supplier.
 */
export function draftFromQuote(db: Db, proformaId: string): WeaverOrderDraft {
  const quote = get<{ id: string; number: string; status: string }>(db, 'SELECT id, number, status FROM proformas WHERE id = ?', proformaId);
  if (!quote) throw new UserError('That quote no longer exists.');
  if (quote.status === 'cancelled' || quote.status === 'lost') throw new UserError(`${quote.number} is closed, so there is nothing to order for it.`);
  const rows = all<{ variant_id: string; qty: number; invoiced_qty: number }>(db, 'SELECT variant_id, qty, invoiced_qty FROM proforma_lines WHERE proforma_id = ? ORDER BY position', proformaId);
  const lines: WeaverOrderDraft['lines'] = [];
  const suppliers = new Set<string | null>();
  for (const r of rows) {
    const need = r.qty - r.invoiced_qty;
    if (need <= 0) continue;
    let v: VariantInfo;
    try {
      v = variantInfo(db, r.variant_id);
    } catch {
      continue; // an archived saree can't be ordered
    }
    const onOrder = get<{ n: number }>(
      db,
      `SELECT COALESCE(SUM(l.qty - l.received_qty), 0) AS n FROM weaver_order_lines l JOIN weaver_orders o ON o.id = l.order_id
       WHERE o.proforma_id = ? AND o.cancelled_at IS NULL AND l.variant_id = ?`,
      proformaId,
      v.id,
    )?.n ?? 0;
    const short = need - v.stock - onOrder;
    if (short > 0) {
      lines.push({ variantId: v.id, qty: short, unitCostPaise: v.base_cost_paise });
      suppliers.add(v.supplier_id);
    }
  }
  if (lines.length === 0) throw new UserError(`Everything on ${quote.number} is in stock or already on order.`);
  const only = suppliers.size === 1 ? [...suppliers][0] ?? null : null;
  const vendorId = only && get(db, 'SELECT 1 AS x FROM vendors WHERE id = ? AND deleted_at IS NULL', only) ? only : null;
  return { proformaId, proformaNumber: quote.number, vendorId, note: `For quote ${quote.number}`, lines };
}
