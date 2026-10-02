import { isValidGstin } from '../../shared/gst';
import { STATE_NAMES } from '../../shared/states';
import { DATE_FORMATS, LANGUAGES, PAPER_SIZES } from '../../shared/prefs';
import { isValidUpiId } from '../../shared/upi';
import { DEFAULT_EXPENSE_CATEGORIES, PAYMENT_ACCOUNT_KINDS, type PaymentAccount, type Settings } from '../../shared/types';
import { all, run, tx, type Db } from '../db/connection';
import { UserError, nowIso, optionalText, requireInt, requireText } from './common';

// Settings are stored as key/value text. This table maps each field to its key and how to read/validate it.
type Field<K extends keyof Settings> = { key: string; read: (raw: string | undefined) => Settings[K]; write: (value: Settings[K]) => string };

const text = (key: string, fallback = ''): Field<any> => ({ key, read: (r) => r ?? fallback, write: (v) => v });
const num = (key: string, fallback: number): Field<any> => ({ key, read: (r) => (r === undefined || r === '' ? fallback : Number(r)), write: (v) => String(v) });

const bool = (key: string, fallback: boolean): Field<any> => ({ key, read: (r) => (r === undefined || r === '' ? fallback : r === '1'), write: (v) => (v ? '1' : '0') });

/** A list edited as a whole in Settings, kept as one JSON value. A damaged value reads as the fallback rather than breaking the app. */
const json = <T>(key: string, fallback: T): Field<any> => ({
  key,
  read: (r) => {
    if (!r) return fallback;
    try {
      return JSON.parse(r) as T;
    } catch {
      return fallback;
    }
  },
  write: (v) => JSON.stringify(v),
});

export const DEFAULT_ACCENT = '#0F6E56';
/** InvoiceOn's tax logic (GST) is India's, so India is the only country for now. */
export const COUNTRIES = ['India'];
/** A logo is embedded in every PDF, so keep it small. The app downsizes uploads well below this. */
const MAX_LOGO_CHARS = 200_000;

const FIELDS: { [K in keyof Settings]: Field<K> } = {
  businessName: text('business_name'),
  ownerName: text('owner_name'),
  country: text('country', 'India'),
  gstin: text('gstin'),
  addressLine: text('address_line'),
  city: text('city'),
  state: text('state'),
  pincode: text('pincode'),
  phone: text('phone'),
  email: text('email'),
  gstRatePercent: num('gst_rate_percent', 5),
  pricesIncludeGst: bool('prices_include_gst', false),
  invoicePrefix: text('invoice_prefix', 'INV'),
  b2bPrefix: text('b2b_prefix', ''),
  defaultDueDays: num('default_due_days', 15),
  defaultReorderLevel: num('default_reorder_level', 2),
  monthlyTargetPaise: num('monthly_target_paise', 0),
  invoiceTerms: text('invoice_terms'),
  invoiceAccent: text('invoice_accent', DEFAULT_ACCENT),
  invoiceLogo: text('invoice_logo'),
  invoiceBank: text('invoice_bank'),
  invoiceFooter: text('invoice_footer'),
  invoiceShowSignature: bool('invoice_show_signature', true),
  upiId: text('upi_id'),
  invoiceShowUpiQr: bool('invoice_show_upi_qr', true),
  proformaPrefix: text('proforma_prefix', 'PF'),
  proformaValidDays: num('proforma_valid_days', 15),
  proformaTerms: text('proforma_terms'),
  expenseCategories: json<string[]>('expense_categories', DEFAULT_EXPENSE_CATEGORIES),
  paymentAccounts: json<PaymentAccount[]>('payment_accounts', []),
  expenseBudgets: json<Record<string, number>>('expense_budgets', {}),
  notifyLowStock: bool('notify_low_stock', true),
  notifyOverdue: bool('notify_overdue', true),
  paperSize: text('paper_size', 'A4'),
  dateFormat: text('date_format', 'short'),
  invoiceLanguage: text('invoice_language', 'en'),
  msgInvoice: text('msg_invoice'),
  msgQuote: text('msg_quote'),
  msgDue: text('msg_due'),
};

export function getSettings(db: Db): Settings {
  const raw = new Map(all<{ key: string; value: string }>(db, 'SELECT key, value FROM settings').map((r) => [r.key, r.value]));
  const out = {} as Record<string, unknown>;
  for (const [name, field] of Object.entries(FIELDS)) out[name] = (field as Field<any>).read(raw.get((field as Field<any>).key));
  return out as unknown as Settings;
}

function validate(patch: Partial<Settings>): Partial<Settings> {
  const v: Partial<Settings> = {};
  if (patch.businessName !== undefined) v.businessName = requireText(patch.businessName, 'Business name');
  if (patch.gstin !== undefined) {
    const g = optionalText(patch.gstin, 'GSTIN', 15).toUpperCase();
    if (g && !isValidGstin(g)) throw new UserError('That GSTIN doesn\'t look right — it should be 15 characters, like 09ABCDE1234F1Z5.');
    v.gstin = g;
  }
  if (patch.addressLine !== undefined) v.addressLine = optionalText(patch.addressLine, 'Address', 200);
  if (patch.city !== undefined) v.city = optionalText(patch.city, 'City', 60);
  if (patch.state !== undefined) {
    const s = optionalText(patch.state, 'State', 60);
    if (s && !STATE_NAMES.includes(s)) throw new UserError('Choose your state from the list.');
    v.state = s;
  }
  if (patch.pincode !== undefined) {
    const p = optionalText(patch.pincode, 'Pincode', 6);
    if (p && !/^\d{6}$/.test(p)) throw new UserError('Pincode should be 6 digits.');
    v.pincode = p;
  }
  if (patch.phone !== undefined) v.phone = optionalText(patch.phone, 'Phone', 20);
  if (patch.email !== undefined) v.email = optionalText(patch.email, 'Email', 80);
  if (patch.gstRatePercent !== undefined) {
    const rate = patch.gstRatePercent;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 100) throw new UserError('GST rate must be between 0 and 100.');
    v.gstRatePercent = rate;
  }
  if (patch.pricesIncludeGst !== undefined) v.pricesIncludeGst = !!patch.pricesIncludeGst;
  if (patch.invoicePrefix !== undefined) {
    const p = requireText(patch.invoicePrefix, 'Invoice prefix', 10).toUpperCase();
    if (!/^[A-Z0-9-]+$/.test(p)) throw new UserError('Invoice prefix can only use letters, numbers and dashes.');
    v.invoicePrefix = p;
  }
  if (patch.b2bPrefix !== undefined) {
    const p = optionalText(patch.b2bPrefix, 'B2B prefix', 10).toUpperCase();
    if (p && !/^[A-Z0-9-]+$/.test(p)) throw new UserError('B2B prefix can only use letters, numbers and dashes.');
    v.b2bPrefix = p;
  }
  if (patch.defaultDueDays !== undefined) v.defaultDueDays = requireInt(patch.defaultDueDays, 'Due days', { max: 365 });
  if (patch.defaultReorderLevel !== undefined) v.defaultReorderLevel = requireInt(patch.defaultReorderLevel, 'Reorder level', { max: 100000 });
  if (patch.monthlyTargetPaise !== undefined) v.monthlyTargetPaise = requireInt(patch.monthlyTargetPaise, 'Monthly target', { max: 100_000_000_000 });
  if (patch.invoiceTerms !== undefined) v.invoiceTerms = optionalText(patch.invoiceTerms, 'Terms', 400);
  if (patch.invoiceAccent !== undefined) {
    const a = String(patch.invoiceAccent).trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(a)) throw new UserError('Choose the invoice colour from the picker (a six-digit colour like #0F6E56).');
    v.invoiceAccent = a.toUpperCase();
  }
  if (patch.invoiceLogo !== undefined) {
    const logo = String(patch.invoiceLogo);
    if (logo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo)) throw new UserError('The logo must be a PNG, JPEG or WebP image.');
    if (logo.length > MAX_LOGO_CHARS) throw new UserError('That logo is too large. Try a smaller image (under about 150 KB).');
    v.invoiceLogo = logo;
  }
  if (patch.invoiceBank !== undefined) v.invoiceBank = optionalText(patch.invoiceBank, 'Bank details', 300);
  if (patch.invoiceFooter !== undefined) v.invoiceFooter = optionalText(patch.invoiceFooter, 'Footer note', 200);
  if (patch.invoiceShowSignature !== undefined) v.invoiceShowSignature = !!patch.invoiceShowSignature;
  if (patch.upiId !== undefined) {
    const id = optionalText(patch.upiId, 'UPI ID', 60).replace(/\s+/g, '');
    if (id && !isValidUpiId(id)) throw new UserError("That UPI ID doesn't look right. It should look like name@bank.");
    v.upiId = id;
  }
  if (patch.invoiceShowUpiQr !== undefined) v.invoiceShowUpiQr = !!patch.invoiceShowUpiQr;
  if (patch.ownerName !== undefined) v.ownerName = optionalText(patch.ownerName, 'Your name', 80);
  if (patch.country !== undefined) {
    if (!COUNTRIES.includes(patch.country)) throw new UserError('InvoiceOn handles GST, so India is the only country for now.');
    v.country = patch.country;
  }
  if (patch.proformaPrefix !== undefined) {
    const p = requireText(patch.proformaPrefix, 'Proforma prefix', 10).toUpperCase();
    if (!/^[A-Z0-9-]+$/.test(p)) throw new UserError('Proforma prefix can only use letters, numbers and dashes.');
    v.proformaPrefix = p;
  }
  if (patch.proformaValidDays !== undefined) v.proformaValidDays = requireInt(patch.proformaValidDays, 'Proforma validity', { max: 365 });
  if (patch.proformaTerms !== undefined) v.proformaTerms = optionalText(patch.proformaTerms, 'Proforma terms', 400);
  if (patch.expenseCategories !== undefined) {
    if (!Array.isArray(patch.expenseCategories)) throw new UserError('Expense categories must be a list.');
    const seen = new Set<string>();
    const list: string[] = [];
    for (const raw of patch.expenseCategories) {
      const name = requireText(raw, 'Category name', 40);
      if (seen.has(name.toLowerCase())) throw new UserError(`“${name}” is listed twice.`);
      seen.add(name.toLowerCase());
      list.push(name);
    }
    if (list.length > 40) throw new UserError('That is a lot of categories — keep it to 40 or fewer.');
    v.expenseCategories = list;
  }
  if (patch.paymentAccounts !== undefined) {
    if (!Array.isArray(patch.paymentAccounts)) throw new UserError('Payment accounts must be a list.');
    if (patch.paymentAccounts.length > 20) throw new UserError('Keep it to 20 payment accounts or fewer.');
    const names = new Set<string>();
    v.paymentAccounts = patch.paymentAccounts.map((a) => {
      const name = requireText(a?.name, 'Account name', 60);
      if (names.has(name.toLowerCase())) throw new UserError(`You already have an account called “${name}”.`);
      names.add(name.toLowerCase());
      if (!(PAYMENT_ACCOUNT_KINDS as readonly string[]).includes(a.kind)) throw new UserError(`Choose a type for “${name}”.`);
      const opening = a.openingPaise ?? 0;
      if (!Number.isInteger(opening) || Math.abs(opening) > 100_000_000_000) throw new UserError(`The opening balance of “${name}” should be a whole number of paise.`);
      return { id: requireText(a.id, 'Account id', 60), name, kind: a.kind, details: optionalText(a.details ?? '', 'Account details', 200), openingPaise: opening };
    });
  }
  if (patch.expenseBudgets !== undefined) {
    const raw = patch.expenseBudgets;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new UserError('Budgets must be a list of categories with an amount each.');
    const budgets: Record<string, number> = {};
    for (const [name, amount] of Object.entries(raw)) {
      const category = requireText(name, 'Budget category', 40);
      const paise = requireInt(amount, `The budget for ${category}`, { max: 100_000_000_000 });
      if (paise > 0) budgets[category] = paise; // a zero budget means "no limit", so it is simply not kept
    }
    v.expenseBudgets = budgets;
  }
  if (patch.notifyLowStock !== undefined) v.notifyLowStock = !!patch.notifyLowStock;
  if (patch.notifyOverdue !== undefined) v.notifyOverdue = !!patch.notifyOverdue;
  if (patch.paperSize !== undefined) {
    if (!(PAPER_SIZES as readonly string[]).includes(patch.paperSize)) throw new UserError('Choose A4, A5 or Letter.');
    v.paperSize = patch.paperSize;
  }
  if (patch.dateFormat !== undefined) {
    if (!(DATE_FORMATS as readonly string[]).includes(patch.dateFormat)) throw new UserError('Choose a date format from the list.');
    v.dateFormat = patch.dateFormat;
  }
  if (patch.invoiceLanguage !== undefined) {
    if (!(LANGUAGES as readonly string[]).includes(patch.invoiceLanguage)) throw new UserError('Choose English, Hindi or Gujarati.');
    v.invoiceLanguage = patch.invoiceLanguage;
  }
  if (patch.msgInvoice !== undefined) v.msgInvoice = optionalText(patch.msgInvoice, 'Invoice message', 1000);
  if (patch.msgQuote !== undefined) v.msgQuote = optionalText(patch.msgQuote, 'Quote message', 1000);
  if (patch.msgDue !== undefined) v.msgDue = optionalText(patch.msgDue, 'Reminder message', 1000);
  return v;
}

export function saveSettings(db: Db, patch: Partial<Settings>): Settings {
  const valid = validate(patch);
  const merged = { ...getSettings(db), ...valid };
  // Two series sharing a prefix would hand out the same number twice.
  if (merged.b2bPrefix && merged.b2bPrefix === merged.invoicePrefix) throw new UserError('The B2B series needs a different prefix from your main invoices.');
  tx(db, () => {
    for (const [name, value] of Object.entries(valid)) {
      const field = FIELDS[name as keyof Settings] as Field<any>;
      run(db, 'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', field.key, field.write(value), nowIso());
    }
  });
  return getSettings(db);
}
