import { isIsoDate, isValidGstin } from '../../shared/gst';
import { formatMoney } from '../../shared/money';
import { matchesAll } from '../../shared/search';
import { normalizeTags } from '../../shared/tags';
import { STATE_NAMES, stateFromGstin } from '../../shared/states';
import type { Customer, CustomerAddress, CustomerContact, CustomerInput, CustomerPurchase } from '../../shared/types';
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
  tags: string;
  credit_limit_paise: number;
  payment_terms_days: number | null;
  birthday: string;
  anniversary: string;
  addresses_json: string;
  contacts_json: string;
  invoice_count: number;
  billed: number;
  paid_on_invoices: number;
  received: number;
  credited: number;
  credit_applied: number;
  refunded: number;
}

// Cancelled invoices don't count towards what a customer has been billed. "Live" allocations are ones not released
// by a cancellation, on payments that haven't been voided (see payments.ts).
//   outstanding = billed − paid on those invoices − credit notes put against them
//   advance     = everything they've paid − the part of it that's sitting on invoices, plus credit kept from credit notes
const SELECT = `
  SELECT c.*,
    (SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'issued') AS invoice_count,
    (SELECT COALESCE(SUM(i.total_paise), 0) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'issued') AS billed,
    (SELECT COALESCE(SUM(a.amount_paise), 0) FROM payment_allocations a JOIN payments p ON p.id = a.payment_id JOIN invoices i ON i.id = a.invoice_id
       WHERE i.customer_id = c.id AND i.status = 'issued' AND a.released_at IS NULL AND p.voided_at IS NULL) AS paid_on_invoices,
    (SELECT COALESCE(SUM(p.amount_paise), 0) FROM payments p WHERE p.customer_id = c.id AND p.voided_at IS NULL) AS received,
    (SELECT COALESCE(SUM(n.total_paise), 0) FROM credit_notes n WHERE n.customer_id = c.id AND n.status = 'issued') AS credited,
    (SELECT COALESCE(SUM(a.amount_paise), 0) FROM credit_note_applications a JOIN credit_notes n ON n.id = a.credit_note_id WHERE n.customer_id = c.id AND n.status = 'issued' AND a.released_at IS NULL) AS credit_applied,
    (SELECT COALESCE(SUM(f.amount_paise), 0) FROM credit_note_refunds f JOIN credit_notes n ON n.id = f.credit_note_id WHERE n.customer_id = c.id AND n.status = 'issued') AS refunded
  FROM customers c WHERE c.deleted_at IS NULL`;

function parseList<T>(json: string): T[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

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
  tags: r.tags,
  creditLimitPaise: r.credit_limit_paise,
  paymentTermsDays: r.payment_terms_days,
  birthday: r.birthday,
  anniversary: r.anniversary,
  addresses: parseList<CustomerAddress>(r.addresses_json),
  contacts: parseList<CustomerContact>(r.contacts_json),
  invoiceCount: r.invoice_count,
  billedPaise: r.billed,
  creditedPaise: r.credited,
  outstandingPaise: r.billed - r.paid_on_invoices - r.credit_applied,
  // Credit that was handed back is not held any more, and credit put on an invoice is already counted there.
  advancePaise: r.received - r.paid_on_invoices + r.credited - r.credit_applied - r.refunded,
});

type CustomerFields = Required<CustomerInput>;

function validateDate(value: string | undefined, label: string): string {
  const v = (value ?? '').trim();
  if (v && !isIsoDate(v)) throw new UserError(`Enter a valid date for ${label}.`);
  return v;
}

function validate(input: CustomerInput): CustomerFields {
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

  const creditLimitPaise = input.creditLimitPaise ?? 0;
  if (!Number.isInteger(creditLimitPaise) || creditLimitPaise < 0) throw new UserError('The credit limit should be zero or more. Use 0 for no limit.');
  const terms = input.paymentTermsDays ?? null;
  if (terms !== null && (!Number.isInteger(terms) || terms < 0 || terms > 365)) throw new UserError('Payment terms should be between 0 and 365 days.');

  const addresses = (input.addresses ?? [])
    .map((a) => ({
      label: optionalText(a.label, 'Address label', 40),
      address: optionalText(a.address, 'Address', 200),
      city: optionalText(a.city, 'City', 60),
      state: optionalText(a.state, 'State', 60),
      pincode: optionalText(a.pincode, 'Pincode', 6),
    }))
    .filter((a) => a.address || a.city || a.pincode);
  if (addresses.length > 10) throw new UserError('Keep it to 10 extra addresses.');
  for (const a of addresses) {
    if (a.state && !STATE_NAMES.includes(a.state)) throw new UserError('Choose the state from the list.');
    if (a.pincode && !/^\d{6}$/.test(a.pincode)) throw new UserError('Pincode should be 6 digits.');
  }
  const contacts = (input.contacts ?? [])
    .map((c) => ({
      name: optionalText(c.name, 'Contact name', 80),
      role: optionalText(c.role, 'Contact role', 40),
      phone: optionalText(c.phone, 'Contact phone', 20),
      email: optionalText(c.email, 'Contact email', 80),
    }))
    .filter((c) => c.name || c.phone || c.email);
  if (contacts.length > 10) throw new UserError('Keep it to 10 extra contacts.');

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
    tags: normalizeTags(input.tags),
    creditLimitPaise,
    paymentTermsDays: terms,
    birthday: validateDate(input.birthday, 'the birthday'),
    anniversary: validateDate(input.anniversary, 'the anniversary'),
    addresses,
    contacts,
  };
}

export function listCustomers(db: Db, query: { search?: string } = {}): Customer[] {
  return all<CustomerRow>(db, `${SELECT} ORDER BY c.name COLLATE NOCASE`)
    .map(toCustomer)
    .filter((c) => matchesAll([c.name, c.phone, c.gstin, c.city, c.email, c.tags].join(' '), query.search));
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
  run(
    db,
    `INSERT INTO customers (id, name, type, phone, email, gstin, address, city, state, pincode, notes, tags, credit_limit_paise, payment_terms_days, birthday, anniversary, addresses_json, contacts_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, v.name, v.type, v.phone, v.email, v.gstin, v.address, v.city, v.state, v.pincode, v.notes, v.tags, v.creditLimitPaise, v.paymentTermsDays, v.birthday, v.anniversary, JSON.stringify(v.addresses), JSON.stringify(v.contacts), now, now,
  );
  return getCustomer(db, id);
}

export function updateCustomer(db: Db, id: string, input: CustomerInput): Customer {
  const v = validate(input);
  getCustomer(db, id);
  run(
    db,
    `UPDATE customers SET name = ?, type = ?, phone = ?, email = ?, gstin = ?, address = ?, city = ?, state = ?, pincode = ?, notes = ?, tags = ?, credit_limit_paise = ?, payment_terms_days = ?,
       birthday = ?, anniversary = ?, addresses_json = ?, contacts_json = ?, updated_at = ? WHERE id = ?`,
    v.name, v.type, v.phone, v.email, v.gstin, v.address, v.city, v.state, v.pincode, v.notes, v.tags, v.creditLimitPaise, v.paymentTermsDays, v.birthday, v.anniversary, JSON.stringify(v.addresses), JSON.stringify(v.contacts), nowIso(), id,
  );
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
    const tags = normalizeTags([keep.tags, dupe.tags].filter(Boolean).join(', '));
    const notes = [keep.notes, dupe.notes && dupe.notes !== keep.notes ? `From ${dupe.name}: ${dupe.notes}` : ''].filter(Boolean).join(' · ').slice(0, 500);
    run(db, 'UPDATE customers SET phone = ?, email = ?, gstin = ?, address = ?, city = ?, state = ?, pincode = ?, notes = ?, tags = ?, updated_at = ? WHERE id = ?', fill('phone'), fill('email'), fill('gstin'), fill('address'), fill('city'), fill('state'), fill('pincode'), notes, tags, now, keepId);
    // Their notes and follow-ups go with them too.
    run(db, "UPDATE notes SET subject_id = ? WHERE subject_type = 'customer' AND subject_id = ?", keepId, duplicateId);
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
