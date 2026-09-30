import { isValidGstin } from '../../shared/gst';
import { formatMoney } from '../../shared/money';
import { matchesAll } from '../../shared/search';
import { STATE_NAMES, stateFromGstin } from '../../shared/states';
import type { Supplier, SupplierInput } from '../../shared/types';
import { all, get, run, type Db } from '../db/connection';
import { UserError, newId, nowIso, optionalText, requireText } from './common';

interface SupplierRow {
  id: string;
  name: string;
  gstin: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  notes: string;
  bill_count: number;
  billed: number;
  paid_on_bills: number;
  paid: number;
}

// Mirrors customers: cancelled bills don't count, and "live" allocations are ones not released by a cancellation, on payments
// that haven't been voided.
//   outstanding = billed - paid on those bills
//   advance     = everything paid to them - the part of it that sits on bills
const SELECT = `
  SELECT s.*,
    (SELECT COUNT(*) FROM purchase_bills b WHERE b.supplier_id = s.id AND b.status = 'open') AS bill_count,
    (SELECT COALESCE(SUM(b.total_paise), 0) FROM purchase_bills b WHERE b.supplier_id = s.id AND b.status = 'open') AS billed,
    (SELECT COALESCE(SUM(a.amount_paise), 0) FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id = a.payment_id JOIN purchase_bills b ON b.id = a.bill_id
       WHERE b.supplier_id = s.id AND b.status = 'open' AND a.released_at IS NULL AND p.voided_at IS NULL) AS paid_on_bills,
    (SELECT COALESCE(SUM(p.amount_paise), 0) FROM supplier_payments p WHERE p.supplier_id = s.id AND p.voided_at IS NULL) AS paid
  FROM suppliers s WHERE s.deleted_at IS NULL`;

const toSupplier = (r: SupplierRow): Supplier => ({
  id: r.id,
  name: r.name,
  gstin: r.gstin,
  phone: r.phone,
  email: r.email,
  address: r.address,
  city: r.city,
  state: r.state,
  pincode: r.pincode,
  notes: r.notes,
  billCount: r.bill_count,
  billedPaise: r.billed,
  outstandingPaise: r.billed - r.paid_on_bills,
  advancePaise: r.paid - r.paid_on_bills,
});

function validate(input: SupplierInput): SupplierInput {
  const gstin = optionalText(input.gstin, 'GSTIN', 15).toUpperCase();
  if (gstin && !isValidGstin(gstin)) throw new UserError("That GSTIN doesn't look right. It should be 15 characters, like 09ABCDE1234F1Z5.");
  let state = optionalText(input.state, 'State', 60);
  if (state && !STATE_NAMES.includes(state)) throw new UserError('Choose the state from the list.');
  if (!state && gstin) state = stateFromGstin(gstin) ?? '';
  const gstinState = gstin ? stateFromGstin(gstin) : null;
  if (gstinState && state && gstinState !== state) throw new UserError(`This GSTIN is registered in ${gstinState}, but the state is set to ${state}.`);
  const pincode = optionalText(input.pincode, 'Pincode', 6);
  if (pincode && !/^\d{6}$/.test(pincode)) throw new UserError('Pincode should be 6 digits.');
  return {
    name: requireText(input.name, 'Supplier name'),
    gstin,
    phone: optionalText(input.phone, 'Phone', 20),
    email: optionalText(input.email, 'Email', 80),
    address: optionalText(input.address, 'Address', 200),
    city: optionalText(input.city, 'City', 60),
    state,
    pincode,
    notes: optionalText(input.notes, 'Notes', 500),
  };
}

export function listSuppliers(db: Db, query: { search?: string } = {}): Supplier[] {
  return all<SupplierRow>(db, `${SELECT} ORDER BY s.name COLLATE NOCASE`)
    .map(toSupplier)
    .filter((s) => matchesAll([s.name, s.phone, s.gstin, s.city, s.email].join(' '), query.search));
}

export function getSupplier(db: Db, id: string): Supplier {
  const row = get<SupplierRow>(db, `${SELECT} AND s.id = ?`, id);
  if (!row) throw new UserError('That supplier no longer exists.');
  return toSupplier(row);
}

export function createSupplier(db: Db, input: SupplierInput): Supplier {
  const v = validate(input);
  const id = newId();
  const now = nowIso();
  run(db, 'INSERT INTO suppliers (id, name, gstin, phone, email, address, city, state, pincode, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, v.name, v.gstin, v.phone, v.email, v.address, v.city, v.state, v.pincode, v.notes, now, now);
  return getSupplier(db, id);
}

export function updateSupplier(db: Db, id: string, input: SupplierInput): Supplier {
  const v = validate(input);
  getSupplier(db, id);
  run(db, 'UPDATE suppliers SET name = ?, gstin = ?, phone = ?, email = ?, address = ?, city = ?, state = ?, pincode = ?, notes = ?, updated_at = ? WHERE id = ?', v.name, v.gstin, v.phone, v.email, v.address, v.city, v.state, v.pincode, v.notes, nowIso(), id);
  return getSupplier(db, id);
}

export function archiveSupplier(db: Db, id: string): void {
  const s = getSupplier(db, id);
  if (s.outstandingPaise > 0) throw new UserError(`You still owe ${s.name} ${formatMoney(s.outstandingPaise)}. Pay their bills before archiving.`);
  if (s.advancePaise > 0) throw new UserError(`${s.name} is holding ${formatMoney(s.advancePaise)} of your money as an advance. Set it against a bill, or reverse the payment if you got it back, before archiving.`);
  run(db, 'UPDATE suppliers SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
}
