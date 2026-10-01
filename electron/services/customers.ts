import { isValidGstin } from '../../shared/gst';
import { formatMoney } from '../../shared/money';
import { matchesAll } from '../../shared/search';
import { STATE_NAMES, stateFromGstin } from '../../shared/states';
import type { Customer, CustomerInput, CustomerPurchase } from '../../shared/types';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, newId, nowIso, optionalText, requireText } from './common';

interface CustomerRow {
  id: string;
  name: string;
  type: 'B2B' | 'B2C';
  phone: string;
  email: string;
  gstin: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  notes: string;
  invoice_count: number;
  billed: number;
  paid_on_invoices: number;
  received: number;
}

// Cancelled invoices don't count towards what a customer has been billed. "Live" allocations are ones not released
// by a cancellation, on payments that haven't been voided (see payments.ts).
//   outstanding = billed − paid on those invoices
//   advance     = everything they've paid − the part of it that's sitting on invoices
const SELECT = `
  SELECT c.*,
    (SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'issued') AS invoice_count,
    (SELECT COALESCE(SUM(i.total_paise), 0) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'issued') AS billed,
    (SELECT COALESCE(SUM(a.amount_paise), 0) FROM payment_allocations a JOIN payments p ON p.id = a.payment_id JOIN invoices i ON i.id = a.invoice_id
       WHERE i.customer_id = c.id AND i.status = 'issued' AND a.released_at IS NULL AND p.voided_at IS NULL) AS paid_on_invoices,
    (SELECT COALESCE(SUM(p.amount_paise), 0) FROM payments p WHERE p.customer_id = c.id AND p.voided_at IS NULL) AS received
  FROM customers c WHERE c.deleted_at IS NULL`;

const toCustomer = (r: CustomerRow): Customer => ({
  id: r.id,
  name: r.name,
  type: r.type,
  phone: r.phone,
  email: r.email,
  gstin: r.gstin,
  address: r.address,
  city: r.city,
  state: r.state,
  pincode: r.pincode,
  notes: r.notes,
  invoiceCount: r.invoice_count,
  billedPaise: r.billed,
  outstandingPaise: r.billed - r.paid_on_invoices,
  advancePaise: r.received - r.paid_on_invoices,
});

function validate(input: CustomerInput): CustomerInput {
  const type = input.type === 'B2B' ? 'B2B' : 'B2C';
  const gstin = optionalText(input.gstin, 'GSTIN', 15).toUpperCase();
  if (gstin && !isValidGstin(gstin)) throw new UserError('That GSTIN doesn\'t look right — it should be 15 characters, like 09ABCDE1234F1Z5.');
  if (type === 'B2B' && !gstin) throw new UserError('A B2B customer needs a GSTIN. Use B2C for customers without one.');

  let state = optionalText(input.state, 'State', 60);
  if (state && !STATE_NAMES.includes(state)) throw new UserError('Choose the state from the list.');
  // The GSTIN's first two digits are the state, so fill it in rather than make people type it twice.
  if (!state && gstin) state = stateFromGstin(gstin) ?? '';
  const gstinState = gstin ? stateFromGstin(gstin) : null;
  if (gstinState && state && gstinState !== state) throw new UserError(`This GSTIN is registered in ${gstinState}, but the state is set to ${state}.`);

  const pincode = optionalText(input.pincode, 'Pincode', 6);
  if (pincode && !/^\d{6}$/.test(pincode)) throw new UserError('Pincode should be 6 digits.');

  return {
    name: requireText(input.name, 'Customer name'),
    type,
    phone: optionalText(input.phone, 'Phone', 20),
    email: optionalText(input.email, 'Email', 80),
    gstin,
    address: optionalText(input.address, 'Address', 200),
    city: optionalText(input.city, 'City', 60),
    state,
    pincode,
    notes: optionalText(input.notes, 'Notes', 500),
  };
}

export function listCustomers(db: Db, query: { search?: string } = {}): Customer[] {
  return all<CustomerRow>(db, `${SELECT} ORDER BY c.name COLLATE NOCASE`)
    .map(toCustomer)
    .filter((c) => matchesAll([c.name, c.phone, c.gstin, c.city, c.email].join(' '), query.search));
}

export function getCustomer(db: Db, id: string): Customer {
  const row = get<CustomerRow>(db, `${SELECT} AND c.id = ?`, id);
  if (!row) throw new UserError('That customer no longer exists.');
  return toCustomer(row);
}

export function createCustomer(db: Db, input: CustomerInput): Customer {
  const v = validate(input);
  const id = newId();
  const now = nowIso();
  run(db, 'INSERT INTO customers (id, name, type, phone, email, gstin, address, city, state, pincode, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, v.name, v.type, v.phone, v.email, v.gstin, v.address, v.city, v.state, v.pincode, v.notes, now, now);
  return getCustomer(db, id);
}

export function updateCustomer(db: Db, id: string, input: CustomerInput): Customer {
  const v = validate(input);
  getCustomer(db, id);
  run(db, 'UPDATE customers SET name = ?, type = ?, phone = ?, email = ?, gstin = ?, address = ?, city = ?, state = ?, pincode = ?, notes = ?, updated_at = ? WHERE id = ?', v.name, v.type, v.phone, v.email, v.gstin, v.address, v.city, v.state, v.pincode, v.notes, nowIso(), id);
  return getCustomer(db, id);
}

export function archiveCustomer(db: Db, id: string): void {
  const c = getCustomer(db, id);
  // Money still in play would be stranded: it would stay in the dues report with nobody to record a payment against.
  if (c.outstandingPaise > 0) throw new UserError(`${c.name} still owes ${formatMoney(c.outstandingPaise)}. Settle their invoices before archiving.`);
  if (c.advancePaise > 0) throw new UserError(`You're holding ${formatMoney(c.advancePaise)} in advance for ${c.name}. Apply it to an invoice, or reverse the payment if you've refunded it, before archiving.`);
  run(db, 'UPDATE customers SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
}

/** What a customer has bought, by design, from their issued invoices (cancelled ones don't count). Amounts are before GST. */
export function customerPurchases(db: Db, customerId: string): CustomerPurchase[] {
  getCustomer(db, customerId);
  const lines = all<{ design_name: string; color: string; size: string; qty: number; amount_paise: number; invoice_id: string; issue_date: string }>(
    db,
    `SELECT l.design_name, l.color, l.size, l.qty, l.amount_paise, i.id AS invoice_id, i.issue_date
     FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
     WHERE i.customer_id = ? AND i.status = 'issued' ORDER BY i.issue_date DESC, i.seq DESC, l.position`,
    customerId,
  );
  const byDesign = new Map<string, { row: CustomerPurchase; invoices: Set<string> }>();
  for (const l of lines) {
    const key = l.design_name.trim().toLowerCase();
    const entry = byDesign.get(key) ?? { row: { designName: l.design_name, pieces: 0, amountPaise: 0, invoiceCount: 0, lastBoughtOn: l.issue_date, variants: [] }, invoices: new Set<string>() };
    entry.row.pieces += l.qty;
    entry.row.amountPaise += l.amount_paise;
    entry.invoices.add(l.invoice_id);
    const variant = `${l.color} ${l.size}`.trim();
    if (variant && !entry.row.variants.includes(variant)) entry.row.variants.push(variant);
    byDesign.set(key, entry);
  }
  return [...byDesign.values()]
    .map(({ row, invoices }) => ({ ...row, invoiceCount: invoices.size }))
    .sort((a, b) => b.lastBoughtOn.localeCompare(a.lastBoughtOn) || a.designName.localeCompare(b.designName));
}

/**
 * Folds a duplicate customer into the one you keep. Their invoices, payments and quotes now belong to the kept customer, so
 * balances, ledger and history add up in one place; the duplicate's name stays printed on the invoices already issued to them,
 * because an issued invoice is never rewritten. Details the kept customer is missing (phone, email, address, GSTIN) are filled
 * in from the duplicate, and the duplicate is archived. All or nothing.
 */
export function mergeCustomers(db: Db, keepId: string, duplicateId: string): Customer {
  if (keepId === duplicateId) throw new UserError("Choose two different customers to merge.");
  const keep = getCustomer(db, keepId);
  const dupe = getCustomer(db, duplicateId);
  tx(db, () => {
    const now = nowIso();
    for (const table of ['invoices', 'payments', 'proformas']) run(db, `UPDATE ${table} SET customer_id = ? WHERE customer_id = ?`, keepId, duplicateId);
    const fill = <K extends 'phone' | 'email' | 'gstin' | 'address' | 'city' | 'state' | 'pincode'>(k: K) => (keep[k] ? keep[k] : dupe[k]);
    const notes = [keep.notes, dupe.notes && dupe.notes !== keep.notes ? `From ${dupe.name}: ${dupe.notes}` : ''].filter(Boolean).join(' · ').slice(0, 500);
    run(db, 'UPDATE customers SET phone = ?, email = ?, gstin = ?, address = ?, city = ?, state = ?, pincode = ?, notes = ?, updated_at = ? WHERE id = ?', fill('phone'), fill('email'), fill('gstin'), fill('address'), fill('city'), fill('state'), fill('pincode'), notes, now, keepId);
    run(db, 'UPDATE customers SET deleted_at = ?, updated_at = ? WHERE id = ?', now, now, duplicateId);
  });
  return getCustomer(db, keepId);
}

/** Brings back an archived customer (the "Undo" after archiving one). */
export function restoreCustomer(db: Db, id: string): Customer {
  const row = get<{ id: string }>(db, 'SELECT id FROM customers WHERE id = ? AND deleted_at IS NOT NULL', id);
  if (!row) throw new UserError("That customer can't be brought back.");
  run(db, 'UPDATE customers SET deleted_at = NULL, updated_at = ? WHERE id = ?', nowIso(), id);
  return getCustomer(db, id);
}
