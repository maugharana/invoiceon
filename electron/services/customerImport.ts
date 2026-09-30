import { isValidGstin } from '../../shared/gst';
import { phoneKey, type ImportResult, type ImportRow, type ImportRowResult } from '../../shared/import';
import { STATE_NAMES, stateFromGstin } from '../../shared/states';
import type { CustomerInput } from '../../shared/types';
import { tx, type Db } from '../db/connection';
import { UserError } from './common';
import { createCustomer, listCustomers } from './customers';

const MAX_ROWS = 2000;

/** What people write in a "state" column, to the name the app uses. */
const STATE_ALIASES: Record<string, string> = {
  up: 'Uttar Pradesh', mp: 'Madhya Pradesh', mh: 'Maharashtra', gj: 'Gujarat', rj: 'Rajasthan', wb: 'West Bengal', dl: 'Delhi', newdelhi: 'Delhi', hr: 'Haryana', pb: 'Punjab', br: 'Bihar',
  jh: 'Jharkhand', od: 'Odisha', or: 'Odisha', orissa: 'Odisha', tn: 'Tamil Nadu', ka: 'Karnataka', kl: 'Kerala', ap: 'Andhra Pradesh', ts: 'Telangana', tg: 'Telangana', as: 'Assam',
  uk: 'Uttarakhand', ut: 'Uttarakhand', uttaranchal: 'Uttarakhand', hp: 'Himachal Pradesh', cg: 'Chhattisgarh', ch: 'Chandigarh', jk: 'Jammu & Kashmir', jammuandkashmir: 'Jammu & Kashmir', ga: 'Goa',
};
const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

function normaliseState(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  const key = squash(value);
  return STATE_NAMES.find((s) => squash(s) === key) ?? STATE_ALIASES[key] ?? value;
}

/** A number pasted from a spreadsheet often arrives as 9876543210.0 or 9.87654E+9; put back what was meant when it can be. */
function tidyPhone(raw: string): string {
  const t = raw.trim().replace(/\.0+$/, '');
  if (/^\d\.\d+e\+\d+$/i.test(t)) return String(Math.round(Number(t)));
  return t;
}

function toInput(row: ImportRow): CustomerInput {
  const gstin = row.gstin.replace(/\s+/g, '').toUpperCase();
  const typeText = row.type.trim().toLowerCase();
  const wantsB2B = /b2b|business|wholesale|registered|trader|dealer/.test(typeText) && !/un\s*registered/.test(typeText);
  const wantsB2C = /b2c|retail|consumer|walk|unregistered/.test(typeText);
  const type = wantsB2B ? 'B2B' : wantsB2C ? 'B2C' : isValidGstin(gstin) ? 'B2B' : 'B2C';
  let state = normaliseState(row.state);
  if (state && !STATE_NAMES.includes(state) && isValidGstin(gstin)) state = stateFromGstin(gstin) ?? state;
  return { name: row.name, type, phone: tidyPhone(row.phone), email: row.email, gstin, address: row.address, city: row.city, state, pincode: row.pincode.replace(/\D/g, '').slice(0, 6) || row.pincode, notes: row.notes };
}

class Rollback extends Error {}

/**
 * Adds customers from a list. Each row is checked by the same rules as adding a customer by hand; a row that fails, or repeats someone already
 * on file (same GSTIN, same phone number, or same name in the same city) or earlier in the list, is skipped and explained, and the rest go in.
 * A dry run does all the work and then undoes it, so the preview is exactly what the import would do.
 */
export function importCustomers(db: Db, rows: ImportRow[], dryRun: boolean): ImportResult {
  if (!Array.isArray(rows) || rows.length === 0) throw new UserError('There is nothing to import. Paste your customers, or choose a file.');
  if (rows.length > MAX_ROWS) throw new UserError(`Import up to ${MAX_ROWS} customers at a time. Split the list and do it in parts.`);

  const existing = listCustomers(db);
  const gstins = new Set(existing.map((c) => c.gstin).filter(Boolean));
  const phones = new Set(existing.map((c) => phoneKey(c.phone)).filter(Boolean));
  const nameCity = new Set(existing.map((c) => `${c.name.toLowerCase()}|${c.city.toLowerCase()}`));

  const results: ImportRowResult[] = [];
  let created = 0;
  try {
    tx(db, () => {
      rows.forEach((raw, index) => {
        const input = toInput(raw);
        const base = { row: index + 1, name: input.name || '(no name)' };
        const gstin = input.gstin;
        const key = `${input.name.toLowerCase()}|${input.city.toLowerCase()}`;
        const pk = phoneKey(input.phone);
        if (gstin && gstins.has(gstin)) return void results.push({ ...base, status: 'duplicate', message: 'This GSTIN is already on file.' });
        if (pk && phones.has(pk)) return void results.push({ ...base, status: 'duplicate', message: 'This phone number is already on file.' });
        if (input.name && nameCity.has(key)) return void results.push({ ...base, status: 'duplicate', message: `${input.name}${input.city ? ` in ${input.city}` : ''} is already on file.` });
        try {
          createCustomer(db, input);
        } catch (err) {
          if (err instanceof UserError) return void results.push({ ...base, status: 'problem', message: err.message });
          throw err;
        }
        if (gstin) gstins.add(gstin);
        if (pk) phones.add(pk);
        nameCity.add(key);
        created += 1;
        results.push({ ...base, status: 'new', message: '' });
      });
      if (dryRun) throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  return { dryRun, created, results };
}
