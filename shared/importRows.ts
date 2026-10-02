import { headingKey, mapHeadings, parseTable } from './csvParse';
import { isIsoDate } from './gst';
import { parseMoney } from './money';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type CustomerInput, type ExpenseInput, type PaymentMethod } from './types';

export interface ImportProblem {
  /** The row as the person sees it in their sheet (the heading row is row 1). */
  row: number;
  message: string;
}

export interface Parsed<T> {
  rows: { row: number; value: T }[];
  problems: ImportProblem[];
}

const cellAt = (cells: string[], i: number | undefined): string => (i === undefined ? '' : (cells[i] ?? '').trim());

// ── Customers ───────────────────────────────────────────────────────────────
const CUSTOMER_HEADINGS = {
  name: ['name', 'customer', 'customername', 'party', 'partyname'],
  type: ['type', 'customertype'],
  phone: ['phone', 'mobile', 'mobileno', 'phoneno', 'contact', 'contactno'],
  email: ['email', 'emailid', 'mail'],
  gstin: ['gstin', 'gst', 'gstno', 'gstnumber'],
  address: ['address', 'street', 'addressline'],
  city: ['city', 'town'],
  state: ['state'],
  pincode: ['pincode', 'pin', 'zip', 'postalcode'],
  notes: ['notes', 'note', 'remarks'],
} as const;

/** Customers from a sheet. The first row should be headings (name, phone, GSTIN…); without them the columns are read in that order. */
export function parseCustomerRows(text: string): Parsed<CustomerInput> {
  const table = parseTable(text);
  const mapped = table.length ? mapHeadings(table[0]!, CUSTOMER_HEADINGS as unknown as Record<keyof typeof CUSTOMER_HEADINGS, string[]>) : null;
  const order = Object.keys(CUSTOMER_HEADINGS) as (keyof typeof CUSTOMER_HEADINGS)[];
  const col = (field: keyof typeof CUSTOMER_HEADINGS): number | undefined => (mapped ? mapped[field] : order.indexOf(field));
  const body = mapped ? table.slice(1) : table;
  const out: Parsed<CustomerInput> = { rows: [], problems: [] };

  body.forEach((cells, i) => {
    const row = i + (mapped ? 2 : 1);
    const get = (f: keyof typeof CUSTOMER_HEADINGS) => cellAt(cells, col(f));
    const name = get('name');
    if (!name) return void out.problems.push({ row, message: 'There is no name.' });
    const gstin = get('gstin').toUpperCase();
    const typed = get('type').toUpperCase();
    // A GSTIN means a business; otherwise retail, unless the sheet says B2B.
    const type = typed === 'B2B' || typed === 'BUSINESS' || (gstin !== '' && typed !== 'B2C') ? 'B2B' : 'B2C';
    out.rows.push({ row, value: { name, type, phone: get('phone'), email: get('email'), gstin, address: get('address'), city: get('city'), state: get('state'), pincode: get('pincode'), notes: get('notes') } });
  });
  return out;
}

// ── Expenses ────────────────────────────────────────────────────────────────
const EXPENSE_HEADINGS = {
  date: ['date', 'expensedate', 'paidon'],
  category: ['category', 'head', 'expensehead', 'type'],
  vendor: ['paidto', 'vendor', 'payee', 'supplier', 'party'],
  method: ['paidby', 'method', 'paymentmethod', 'mode', 'paymentmode'],
  amount: ['amount', 'rs', 'rupees', 'value', 'total'],
  reference: ['reference', 'ref', 'refno', 'utr', 'chequeno'],
  note: ['note', 'notes', 'remarks', 'description', 'narration'],
} as const;

/** Accepts 2026-09-30, 30/09/2026, 30-09-2026 and 30.09.2026. Returns '' for anything else. */
export function readDate(text: string): string {
  const t = text.trim();
  if (isIsoDate(t)) return t;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (!m) return '';
  const iso = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : '';
}

/** Words people use for how something was paid → one of the six methods. */
export function readMethod(text: string): PaymentMethod | '' {
  const t = headingKey(text);
  if (!t) return 'cash';
  for (const m of PAYMENT_METHODS) if (t === m || t === headingKey(PAYMENT_METHOD_LABEL[m])) return m;
  if (['neft', 'rtgs', 'imps', 'transfer', 'banktransfer', 'online', 'netbanking'].includes(t)) return 'bank';
  if (['gpay', 'phonepe', 'paytm', 'bhim'].includes(t)) return 'upi';
  if (['check', 'dd'].includes(t)) return 'cheque';
  return '';
}

/** Expenses from a sheet: date, category, paid to, paid by, amount, reference, note (headings are matched by name). */
export function parseExpenseRows(text: string): Parsed<ExpenseInput> {
  const table = parseTable(text);
  const mapped = table.length ? mapHeadings(table[0]!, EXPENSE_HEADINGS as unknown as Record<keyof typeof EXPENSE_HEADINGS, string[]>) : null;
  const order: (keyof typeof EXPENSE_HEADINGS)[] = ['date', 'category', 'vendor', 'method', 'amount', 'reference', 'note'];
  const col = (field: keyof typeof EXPENSE_HEADINGS): number | undefined => (mapped ? mapped[field] : order.indexOf(field));
  const body = mapped ? table.slice(1) : table;
  const out: Parsed<ExpenseInput> = { rows: [], problems: [] };

  body.forEach((cells, i) => {
    const row = i + (mapped ? 2 : 1);
    const get = (f: keyof typeof EXPENSE_HEADINGS) => cellAt(cells, col(f));
    const date = readDate(get('date'));
    const method = readMethod(get('method'));
    const amountPaise = parseMoney(get('amount').replace(/[₹\s]/g, ''));
    const category = get('category');
    if (!date) return void out.problems.push({ row, message: `“${get('date')}” isn't a date I can read (use 30/09/2026 or 2026-09-30).` });
    if (!category) return void out.problems.push({ row, message: 'There is no category.' });
    if (method === '') return void out.problems.push({ row, message: `“${get('method')}” isn't a way of paying I know (cash, UPI, bank transfer, cheque, card).` });
    if (amountPaise === null || amountPaise <= 0) return void out.problems.push({ row, message: `“${get('amount')}” isn't an amount.` });
    out.rows.push({ row, value: { date, category, vendor: get('vendor'), amountPaise, method, reference: get('reference'), note: get('note') } });
  });
  return out;
}
