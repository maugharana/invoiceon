import type { LoyaltyEntry, WishlistEntry } from '../../shared/types';
import { all, get, run, type Db } from '../db/connection';
import { UserError, newId, nowIso, optionalText, requireInt } from './common';
import { getSettings } from './settings';

// Loyalty points are a ledger, like stock: every earning, spending and correction is a row, and the balance is their sum. Points
// are earned on what a saved customer pays, can be spent as a discount on a later invoice, and are taken back (as far as the
// customer still has them) when an invoice is cancelled or goods are returned.

export const pointsFor = (spendPerPointPaise: number, amountPaise: number): number => (spendPerPointPaise > 0 ? Math.floor(Math.max(0, amountPaise) / spendPerPointPaise) : 0);

export function balance(db: Db, customerId: string): number {
  return get<{ s: number }>(db, 'SELECT COALESCE(SUM(points), 0) AS s FROM loyalty_points WHERE customer_id = ?', customerId)?.s ?? 0;
}

function add(db: Db, customerId: string, points: number, reason: LoyaltyEntry['reason'], note: string, invoiceId: string | null): void {
  if (points === 0) return;
  run(db, 'INSERT INTO loyalty_points (id, customer_id, points, reason, note, invoice_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', newId(), customerId, points, reason, note, invoiceId, nowIso());
}

export function history(db: Db, customerId: string): LoyaltyEntry[] {
  return all<{ id: string; points: number; reason: LoyaltyEntry['reason']; note: string; invoice_id: string | null; invoice_number: string | null; created_at: string }>(
    db,
    'SELECT l.id, l.points, l.reason, l.note, l.invoice_id, i.number AS invoice_number, l.created_at FROM loyalty_points l LEFT JOIN invoices i ON i.id = l.invoice_id WHERE l.customer_id = ? ORDER BY l.created_at DESC, l.rowid DESC LIMIT 200',
    customerId,
  ).map((r) => ({ id: r.id, points: r.points, reason: r.reason, note: r.note, invoiceId: r.invoice_id, invoiceNumber: r.invoice_number, createdAt: r.created_at }));
}

/** Called as an invoice is issued: spends the points being used, then earns the new ones on what the customer is billed. */
export function onInvoiceIssued(db: Db, input: { customerId: string | null; invoiceId: string; number: string; totalPaise: number; discountPaise: number; redeemPoints: number }): void {
  const s = getSettings(db);
  const redeem = input.redeemPoints;
  if (redeem > 0) {
    if (!input.customerId) throw new UserError('Loyalty points belong to a saved customer.');
    if (s.loyaltySpendPaise <= 0) throw new UserError('Loyalty points are switched off in Settings.');
    const have = balance(db, input.customerId);
    if (redeem > have) throw new UserError(`This customer has only ${have} loyalty point${have === 1 ? '' : 's'}.`);
    if (redeem * s.loyaltyPointValuePaise > input.discountPaise) throw new UserError('The discount on the invoice must include the value of the points being used.');
    add(db, input.customerId, -redeem, 'redeemed', `Used on ${input.number}`, input.invoiceId);
  }
  if (input.customerId) add(db, input.customerId, pointsFor(s.loyaltySpendPaise, input.totalPaise), 'earned', `Earned on ${input.number}`, input.invoiceId);
}

/** An invoice was cancelled: points spent on it come back, and points it earned go (as far as the customer still has them). */
export function onInvoiceCancelled(db: Db, invoiceId: string, number: string): void {
  const rows = all<{ customer_id: string; points: number; reason: string }>(db, "SELECT customer_id, points, reason FROM loyalty_points WHERE invoice_id = ? AND reason IN ('earned', 'redeemed')", invoiceId);
  for (const r of rows) {
    if (r.reason === 'redeemed') add(db, r.customer_id, -r.points, 'reversed', `${number} cancelled`, invoiceId);
    else add(db, r.customer_id, -Math.min(r.points, Math.max(0, balance(db, r.customer_id))), 'reversed', `${number} cancelled`, invoiceId);
  }
}

/** Goods came back: the points earned on that much of the sale are taken back, as far as the customer still has them. */
export function onReturn(db: Db, customerId: string | null, invoiceId: string, creditNoteNumber: string, creditTotalPaise: number): void {
  if (!customerId) return;
  const take = Math.min(pointsFor(getSettings(db).loyaltySpendPaise, creditTotalPaise), Math.max(0, balance(db, customerId)));
  add(db, customerId, -take, 'reversed', `Goods returned — ${creditNoteNumber}`, invoiceId);
}

/** A credit note was cancelled, so the goods did not come back after all: the points its return took are given back. */
export function onReturnCancelled(db: Db, customerId: string | null, invoiceId: string, creditNoteNumber: string): void {
  if (!customerId) return;
  const taken = get<{ s: number }>(db, 'SELECT COALESCE(SUM(points), 0) AS s FROM loyalty_points WHERE customer_id = ? AND invoice_id = ? AND note = ?', customerId, invoiceId, `Goods returned — ${creditNoteNumber}`)?.s ?? 0;
  if (taken < 0) add(db, customerId, -taken, 'reversed', `Return cancelled — ${creditNoteNumber}`, invoiceId);
}

export function adjust(db: Db, input: { customerId: string; points: number; note: string }): number {
  if (!get(db, 'SELECT 1 AS x FROM customers WHERE id = ? AND deleted_at IS NULL', input.customerId)) throw new UserError('That customer no longer exists.');
  const points = requireInt(input.points, 'Points', { min: -1_000_000, max: 1_000_000 });
  if (points === 0) throw new UserError('Enter the points to add or take off.');
  const note = optionalText(input.note, 'Note', 120);
  if (!note) throw new UserError('Say why, so the history makes sense (for example “birthday gift”).');
  if (balance(db, input.customerId) + points < 0) throw new UserError('That would take the balance below zero.');
  add(db, input.customerId, points, 'adjustment', note, null);
  return balance(db, input.customerId);
}

// ── Wishlist ────────────────────────────────────────────────────────────────
/** Designs a customer has asked for, so they can be told when one is in stock. */
export function wishlist(db: Db, customerId: string): WishlistEntry[] {
  return all<{ id: string; design_id: string; name: string; note: string; created_at: string; stock: number }>(
    db,
    `SELECT w.id, w.design_id, d.name, w.note, w.created_at,
       COALESCE((SELECT SUM(v.stock) FROM variants v WHERE v.design_id = d.id AND v.deleted_at IS NULL), 0) AS stock
     FROM wishlist w JOIN designs d ON d.id = w.design_id WHERE w.customer_id = ? AND w.deleted_at IS NULL AND d.deleted_at IS NULL ORDER BY w.created_at`,
    customerId,
  ).map((r) => ({ id: r.id, designId: r.design_id, designName: r.name, note: r.note, addedOn: r.created_at.slice(0, 10), inStock: r.stock > 0 }));
}

export function addWish(db: Db, input: { customerId: string; designId: string; note?: string }): WishlistEntry[] {
  if (!get(db, 'SELECT 1 AS x FROM customers WHERE id = ? AND deleted_at IS NULL', input.customerId)) throw new UserError('That customer no longer exists.');
  if (!get(db, 'SELECT 1 AS x FROM designs WHERE id = ? AND deleted_at IS NULL', input.designId)) throw new UserError('That design no longer exists.');
  if (get(db, 'SELECT 1 AS x FROM wishlist WHERE customer_id = ? AND design_id = ? AND deleted_at IS NULL', input.customerId, input.designId)) throw new UserError('That design is already on their wishlist.');
  run(db, 'INSERT INTO wishlist (id, customer_id, design_id, note, created_at) VALUES (?, ?, ?, ?, ?)', newId(), input.customerId, input.designId, optionalText(input.note ?? '', 'Note', 120), nowIso());
  return wishlist(db, input.customerId);
}

export function removeWish(db: Db, id: string): void {
  if (!get(db, 'SELECT 1 AS x FROM wishlist WHERE id = ? AND deleted_at IS NULL', id)) throw new UserError('That wish is no longer on the list.');
  run(db, 'UPDATE wishlist SET deleted_at = ? WHERE id = ?', nowIso(), id);
}

/** A customer bought a design they were waiting for: it comes off their wishlist. */
export function fulfilWishes(db: Db, customerId: string | null, designIds: string[]): void {
  if (!customerId) return;
  for (const d of new Set(designIds)) run(db, 'UPDATE wishlist SET deleted_at = ? WHERE customer_id = ? AND design_id = ? AND deleted_at IS NULL', nowIso(), customerId, d);
}

/** Wishes whose design is now in stock, with the customer, for the notifications. */
export function readyWishes(db: Db): { id: string; customerId: string; customerName: string; designName: string }[] {
  return all<{ id: string; customer_id: string; customer: string; design: string }>(
    db,
    `SELECT w.id, w.customer_id, c.name AS customer, d.name AS design
     FROM wishlist w JOIN customers c ON c.id = w.customer_id JOIN designs d ON d.id = w.design_id
     WHERE w.deleted_at IS NULL AND c.deleted_at IS NULL AND d.deleted_at IS NULL
       AND COALESCE((SELECT SUM(v.stock) FROM variants v WHERE v.design_id = d.id AND v.deleted_at IS NULL), 0) > 0
     ORDER BY w.created_at`,
  ).map((r) => ({ id: r.id, customerId: r.customer_id, customerName: r.customer, designName: r.design }));
}
