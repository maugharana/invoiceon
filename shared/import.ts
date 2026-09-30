// Bringing customers in from a spreadsheet: reading pasted text or a CSV file into a table, and working out which column is which from its
// heading, however the old sheet happened to name them. Pure, so it is easy to test.

export const CUSTOMER_FIELDS = ['name', 'phone', 'email', 'gstin', 'address', 'city', 'state', 'pincode', 'type', 'notes'] as const;
export type CustomerField = (typeof CUSTOMER_FIELDS)[number];

export type ImportRow = Record<CustomerField, string>;

/** What a spreadsheet heading may say for each field. Matched after lower-casing and dropping everything but letters and digits. */
const SYNONYMS: Record<CustomerField, string[]> = {
  name: ['name', 'customer', 'customername', 'party', 'partyname', 'client', 'clientname', 'shopname', 'firm', 'firmname', 'businessname', 'accountname'],
  phone: ['phone', 'phoneno', 'phonenumber', 'mobile', 'mobileno', 'mobilenumber', 'contact', 'contactno', 'contactnumber', 'cell', 'whatsapp', 'tel', 'telephone'],
  email: ['email', 'emailid', 'emailaddress', 'mail'],
  gstin: ['gstin', 'gst', 'gstno', 'gstnumber', 'gstinno', 'gstinnumber', 'gstregistration'],
  address: ['address', 'addr', 'address1', 'addressline', 'street', 'location'],
  city: ['city', 'town', 'place', 'district'],
  state: ['state', 'province'],
  pincode: ['pincode', 'pin', 'pinno', 'zip', 'zipcode', 'postalcode', 'postcode'],
  type: ['type', 'customertype', 'category', 'kind'],
  notes: ['notes', 'note', 'remarks', 'remark', 'comments', 'comment', 'description'],
};

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Reads pasted spreadsheet cells (tab separated) or CSV text into a table. The separator is found from the first line; quoted cells may
 * hold separators, line breaks and doubled quotes; a byte-order mark and blank lines are ignored.
 */
export function parseTable(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = firstLine.includes('\t') ? '\t' : firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      cell = '';
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell.trim());
  rows.push(row);
  return rows.filter((r) => r.some((c) => c !== ''));
}

/** Which column holds which field, from the heading row. Unrecognised headings are simply not used. */
export function mapColumns(header: string[]): Partial<Record<CustomerField, number>> {
  const out: Partial<Record<CustomerField, number>> = {};
  header.forEach((h, index) => {
    const key = squash(h);
    if (!key) return;
    for (const field of CUSTOMER_FIELDS) {
      if (out[field] === undefined && SYNONYMS[field].includes(key)) {
        out[field] = index;
        return;
      }
    }
  });
  return out;
}

export interface ParsedImport {
  rows: ImportRow[];
  /** The first row was taken as headings. */
  usedHeader: boolean;
  /** Headings that matched nothing and were left out. */
  ignored: string[];
  /** Which fields were found. */
  found: CustomerField[];
}

const blank = (): ImportRow => ({ name: '', phone: '', email: '', gstin: '', address: '', city: '', state: '', pincode: '', type: '', notes: '' });

/**
 * A table into customers. With a heading row that names a "name" column, columns are matched by heading. Without one, the columns are taken
 * in a sensible order: name, phone, city, then GSTIN, so a plain list of names (or names and numbers) pasted from anywhere still works.
 */
export function toImportRows(table: string[][]): ParsedImport {
  if (table.length === 0) return { rows: [], usedHeader: false, ignored: [], found: [] };
  const map = mapColumns(table[0]!);
  if (map.name !== undefined) {
    const used = new Set(Object.values(map));
    const ignored = table[0]!.filter((h, i) => h && !used.has(i));
    const rows = table.slice(1).map((r) => {
      const row = blank();
      for (const field of CUSTOMER_FIELDS) {
        const index = map[field];
        if (index !== undefined) row[field] = r[index] ?? '';
      }
      return row;
    });
    return { rows, usedHeader: true, ignored, found: CUSTOMER_FIELDS.filter((f) => map[f] !== undefined) };
  }
  const order: CustomerField[] = ['name', 'phone', 'city', 'gstin'];
  const rows = table.map((r) => {
    const row = blank();
    order.forEach((field, i) => (row[field] = r[i] ?? ''));
    return row;
  });
  return { rows, usedHeader: false, ignored: [], found: order.filter((f) => rows.some((r) => r[f])) };
}

/** Indian mobile numbers in a spreadsheet lose their leading zero, gain +91 or spaces; what matters for telling customers apart is the last ten digits. */
export const phoneKey = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
};

export interface ImportRowResult {
  /** The row as numbered in the file, counting the heading row as 1 when there is one. */
  row: number;
  name: string;
  status: 'new' | 'duplicate' | 'problem';
  message: string;
}

export interface ImportResult {
  dryRun: boolean;
  /** Customers added (or, in a dry run, that would be). */
  created: number;
  results: ImportRowResult[];
}
