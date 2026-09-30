import { DEFAULT_LOYALTY, isOfferLive, loyaltyEarned, loyaltyValue, offerDiscount, type LoyaltyAccount, type LoyaltyConfig, type LoyaltyEntry, type LoyaltyKind, type Offer, type OfferInput, type OfferLine } from '../../shared/offers';
import { isIsoDate } from '../../shared/gst';
import { formatMoney } from '../../shared/money';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, newId, nowIso, requireInt, requireText } from './common';
import { getCustomer } from './customers';

// ── Offers ──────────────────────────────────────────────────────────────────
interface OfferRow {
  id: string;
  name: string;
  kind: 'percent' | 'flat';
  value: number;
  min_bill_paise: number;
  design_id: string | null;
  start_date: string;
  end_date: string | null;
  active: number;
  created_at: string;
}

const toOffer = (r: OfferRow): Offer => ({ id: r.id, name: r.name, kind: r.kind, value: r.value, minBillPaise: r.min_bill_paise, designId: r.design_id, startDate: r.start_date, endDate: r.end_date, active: r.active === 1, createdAt: r.created_at });

export const listOffers = (db: Db): Offer[] => all<OfferRow>(db, 'SELECT * FROM offers WHERE deleted_at IS NULL ORDER BY active DESC, start_date DESC, name COLLATE NOCASE').map(toOffer);

export function getOffer(db: Db, id: string): Offer {
  const row = get<OfferRow>(db, 'SELECT * FROM offers WHERE id = ? AND deleted_at IS NULL', String(id));
  if (!row) throw new UserError('That offer no longer exists.');
  return toOffer(row);
}

function validateOffer(db: Db, input: OfferInput) {
  const name = requireText(input?.name, 'Offer name', 60);
  if (input.kind !== 'percent' && input.kind !== 'flat') throw new UserError('Choose whether the offer is a percentage or a flat amount.');
  const value = Number(input.value);
  if (!Number.isFinite(value) || value <= 0) throw new UserError('Enter how much the offer takes off.');
  if (input.kind === 'percent' && value > 100) throw new UserError("A percentage can't be more than 100.");
  if (input.kind === 'flat' && !Number.isInteger(value)) throw new UserError('A flat amount is a whole number of paise.');
  const min = requireInt(input.minBillPaise ?? 0, 'Minimum bill', { max: 100_000_000_00 });
  if (!isIsoDate(input.startDate)) throw new UserError('Enter the first day of the offer.');
  if (input.endDate !== null && input.endDate !== undefined && input.endDate !== '' && !isIsoDate(input.endDate)) throw new UserError('Enter a valid last day for the offer.');
  const end = input.endDate ? input.endDate : null;
  if (end && end < input.startDate) throw new UserError("The offer can't end before it starts.");
  let designId: string | null = null;
  if (input.designId) {
    if (!get(db, 'SELECT 1 AS x FROM designs WHERE id = ? AND deleted_at IS NULL', String(input.designId))) throw new UserError('That design no longer exists.');
    designId = String(input.designId);
  }
  return { name, kind: input.kind, value, min, start: input.startDate, end, designId, active: input.active === false ? 0 : 1 };
}

export function saveOffer(db: Db, id: string | null, input: OfferInput): Offer {
  const v = validateOffer(db, input);
  const now = nowIso();
  if (id === null) {
    const newOne = newId();
    run(db, 'INSERT INTO offers (id, name, kind, value, min_bill_paise, design_id, start_date, end_date, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', newOne, v.name, v.kind, v.value, v.min, v.designId, v.start, v.end, v.active, now, now);
    return getOffer(db, newOne);
  }
  getOffer(db, id);
  run(db, 'UPDATE offers SET name = ?, kind = ?, value = ?, min_bill_paise = ?, design_id = ?, start_date = ?, end_date = ?, active = ?, updated_at = ? WHERE id = ?', v.name, v.kind, v.value, v.min, v.designId, v.start, v.end, v.active, now, id);
  return getOffer(db, id);
}

/** Offers are archived, not deleted: invoices that used one keep its name. */
export function archiveOffer(db: Db, id: string): void {
  getOffer(db, id);
  run(db, 'UPDATE offers SET deleted_at = ?, active = 0, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
}

/** What an offer takes off a bill, having checked it can be used today on these lines. Throws in plain words when it cannot. */
export function discountFromOffer(db: Db, offerId: string, date: string, lines: OfferLine[]): { offer: Offer; discountPaise: number } {
  const offer = getOffer(db, offerId);
  if (!isOfferLive(offer, date)) throw new UserError(`The offer "${offer.name}" is not running on ${date}.`);
  const discountPaise = offerDiscount(offer, lines);
  if (discountPaise <= 0) throw new UserError(`The offer "${offer.name}" does not apply to this bill${offer.minBillPaise > 0 ? ` (it needs ${formatMoney(offer.minBillPaise)} or more${offer.designId ? ', with that design on it' : ''})` : offer.designId ? ' (that design is not on it)' : ''}.`);
  return { offer, discountPaise };
}

// ── Loyalty ─────────────────────────────────────────────────────────────────
const setting = (db: Db, key: string): string | undefined => all<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', key)[0]?.value;
const put = (db: Db, key: string, value: string) =>
  run(db, 'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', key, value, nowIso());

export function loyaltyConfig(db: Db): LoyaltyConfig {
  const n = (key: string, fallback: number) => {
    const v = Number(setting(db, key));
    return Number.isFinite(v) && setting(db, key) !== undefined ? v : fallback;
  };
  return {
    enabled: setting(db, 'loyalty_enabled') === '1',
    pointsPer100: n('loyalty_points_per_100', DEFAULT_LOYALTY.pointsPer100),
    paisePerPoint: n('loyalty_paise_per_point', DEFAULT_LOYALTY.paisePerPoint),
    minRedeem: n('loyalty_min_redeem', DEFAULT_LOYALTY.minRedeem),
  };
}

export function saveLoyaltyConfig(db: Db, input: LoyaltyConfig): LoyaltyConfig {
  const per = requireInt(input?.pointsPer100, 'Points for every ₹100', { min: 1, max: 100 });
  const worth = requireInt(input?.paisePerPoint, 'What a point is worth', { min: 1, max: 10_000 });
  const min = requireInt(input?.minRedeem, 'Fewest points to spend', { min: 0, max: 100_000 });
  tx(db, () => {
    put(db, 'loyalty_enabled', input.enabled ? '1' : '0');
    put(db, 'loyalty_points_per_100', String(per));
    put(db, 'loyalty_paise_per_point', String(worth));
    put(db, 'loyalty_min_redeem', String(min));
  });
  return loyaltyConfig(db);
}

export const pointsOf = (db: Db, customerId: string): number => get<{ p: number | null }>(db, 'SELECT SUM(points) AS p FROM loyalty_entries WHERE customer_id = ?', customerId)?.p ?? 0;

export function loyaltyAccount(db: Db, customerId: string): LoyaltyAccount {
  getCustomer(db, customerId);
  const cfg = loyaltyConfig(db);
  const entries = all<{ id: string; kind: LoyaltyKind; points: number; note: string; created_at: string; invoice_number: string | null }>(
    db,
    `SELECT e.id, e.kind, e.points, e.note, e.created_at, i.number AS invoice_number FROM loyalty_entries e LEFT JOIN invoices i ON i.id = e.invoice_id
     WHERE e.customer_id = ? ORDER BY e.created_at DESC, e.rowid DESC LIMIT 200`,
    customerId,
  ).map((e): LoyaltyEntry => ({ id: e.id, kind: e.kind, points: e.points, note: e.note, invoiceNumber: e.invoice_number, createdAt: e.created_at }));
  const points = pointsOf(db, customerId);
  return { points, valuePaise: loyaltyValue(Math.max(0, points), cfg.paisePerPoint), entries };
}

const addEntry = (db: Db, customerId: string, kind: LoyaltyKind, points: number, note: string, refs: { invoiceId?: string; creditNoteId?: string } = {}) => {
  if (points === 0) return;
  run(db, 'INSERT INTO loyalty_entries (id, customer_id, invoice_id, credit_note_id, kind, points, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', newId(), customerId, refs.invoiceId ?? null, refs.creditNoteId ?? null, kind, points, note, nowIso());
};

/** A manual correction, in either direction, with a reason that is kept. */
export function adjustPoints(db: Db, customerId: string, points: number, note: string): LoyaltyAccount {
  getCustomer(db, customerId);
  const p = requireInt(points, 'Points', { min: -1_000_000, max: 1_000_000 });
  if (p === 0) throw new UserError('Enter how many points to add or take away.');
  addEntry(db, customerId, 'adjust', p, requireText(note, 'Reason', 120));
  return loyaltyAccount(db, customerId);
}

/** Checks a points redemption before the invoice is made, and says what it is worth. */
export function checkRedemption(db: Db, customerId: string | null, points: number): { points: number; valuePaise: number } {
  const p = requireInt(points ?? 0, 'Points to spend', { min: 0, max: 10_000_000 });
  if (p === 0) return { points: 0, valuePaise: 0 };
  const cfg = loyaltyConfig(db);
  if (!cfg.enabled) throw new UserError('Loyalty points are not switched on.');
  if (!customerId) throw new UserError('Points belong to a saved customer. Choose the customer first.');
  if (p < cfg.minRedeem) throw new UserError(`Points can be spent ${cfg.minRedeem} at a time or more.`);
  const have = pointsOf(db, customerId);
  if (p > have) throw new UserError(`This customer has ${have} points, not ${p}.`);
  return { points: p, valuePaise: loyaltyValue(p, cfg.paisePerPoint) };
}

/** Called inside the transaction that issues an invoice: spends the points, then credits what this sale earns. */
export function recordSale(db: Db, invoice: { id: string; number: string; customerId: string | null; taxablePaise: number }, redeemed: number): number {
  if (!invoice.customerId) return 0;
  const cfg = loyaltyConfig(db);
  if (redeemed > 0) addEntry(db, invoice.customerId, 'redeem', -redeemed, `Spent on ${invoice.number}`, { invoiceId: invoice.id });
  if (!cfg.enabled) return 0;
  const earned = loyaltyEarned(invoice.taxablePaise, cfg.pointsPer100);
  addEntry(db, invoice.customerId, 'earn', earned, `Earned on ${invoice.number}`, { invoiceId: invoice.id });
  return earned;
}

/** Cancelling an invoice takes back what it earned and gives back what it spent. */
export function reverseSale(db: Db, invoiceId: string, number: string): void {
  const rows = all<{ customer_id: string; kind: string; points: number }>(db, "SELECT customer_id, kind, points FROM loyalty_entries WHERE invoice_id = ? AND kind IN ('earn','redeem')", invoiceId);
  for (const r of rows) addEntry(db, r.customer_id, r.kind === 'earn' ? 'reverse-earn' : 'reverse-redeem', -r.points, `${number} cancelled`, { invoiceId });
}

/** A credit note takes back the share of the points that the returned goods earned. Points that were spent are not refunded. */
export function clawBack(db: Db, creditNote: { id: string; number: string; taxablePaise: number }, invoice: { id: string; customerId: string | null; taxablePaise: number }): void {
  if (!invoice.customerId || invoice.taxablePaise <= 0) return;
  const earned = get<{ p: number | null }>(db, "SELECT SUM(points) AS p FROM loyalty_entries WHERE invoice_id = ? AND kind = 'earn'", invoice.id)?.p ?? 0;
  const soFar = get<{ p: number | null }>(db, "SELECT SUM(points) AS p FROM loyalty_entries WHERE invoice_id = ? AND kind IN ('return','reverse-return')", invoice.id)?.p ?? 0;
  const take = Math.min(earned + soFar, Math.floor((earned * creditNote.taxablePaise) / invoice.taxablePaise));
  if (take > 0) addEntry(db, invoice.customerId, 'return', -take, `Goods returned on ${creditNote.number}`, { invoiceId: invoice.id, creditNoteId: creditNote.id });
}

export function giveBack(db: Db, creditNoteId: string, number: string): void {
  const rows = all<{ customer_id: string; invoice_id: string | null; points: number }>(db, "SELECT customer_id, invoice_id, points FROM loyalty_entries WHERE credit_note_id = ? AND kind = 'return'", creditNoteId);
  for (const r of rows) addEntry(db, r.customer_id, 'reverse-return', -r.points, `${number} cancelled`, { invoiceId: r.invoice_id ?? undefined, creditNoteId });
}
