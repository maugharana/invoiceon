import type { Paise } from './money';
import type { StockStatus } from './stock';

import type { InvoiceStatus, RateGroup, RateSlab, RoundOff } from './gst';

export const DEFAULT_EXPENSE_CATEGORIES = ['Raw materials', 'Rent', 'Salaries & wages', 'Transport & freight', 'Packaging', 'Electricity & utilities', 'Marketing', 'Other'];

/** Where money you receive ends up — a bank account, the cash drawer, a UPI id. */
export const PAYMENT_ACCOUNT_KINDS = ['bank', 'cash', 'upi', 'wallet'] as const;
export type PaymentAccountKind = (typeof PAYMENT_ACCOUNT_KINDS)[number];

export interface PaymentAccount {
  id: string;
  name: string;
  kind: PaymentAccountKind;
  /** Free text: account number and IFSC, the UPI id, and so on. */
  details: string;
  /** What was in it before you started recording here. Can be negative for an overdraft. */
  openingPaise?: Paise;
}

export interface Settings {
  businessName: string;
  /** The owner's own name (the person, not the business). */
  ownerName: string;
  country: string;
  /** The seller's GSTIN. Required to issue B2B tax invoices. */
  gstin: string;
  addressLine: string;
  city: string;
  /** Decides CGST+SGST (same state as the buyer) versus IGST. */
  state: string;
  pincode: string;
  phone: string;
  email: string;
  /** The shop's usual GST rate. A line can have its own (typed on the line, set on its design, or from a price slab). */
  gstRatePercent: number;
  /** Price slabs: pieces priced up to a limit get that rate. Empty = none. See resolveRate. */
  rateSlabs: RateSlab[];
  /** How the invoice total is rounded. */
  roundOff: RoundOff;
  /** True when the prices you enter already include GST, so the tax is carved out of them instead of added on top. */
  pricesIncludeGst: boolean;
  invoicePrefix: string;
  /** Credit notes are numbered CN/2026-27/0001 with this prefix. */
  creditNotePrefix: string;
  /** If set, B2B tax invoices are numbered in their own series with this prefix (MGB/2026-27/0001). Empty: one series for all. */
  b2bPrefix: string;
  /** Days until a B2B invoice falls due. B2C is due on the day. */
  defaultDueDays: number;
  /** Prefilled reorder level for new variants. */
  defaultReorderLevel: number;
  /** What the business hopes to invoice each month, in paise, shown as a progress bar on the dashboard. 0 means no target. */
  monthlyTargetPaise: Paise;
  /** Printed at the foot of every invoice. */
  invoiceTerms: string;
  // ── Invoice design (see InvoiceBranding for which of these apply to old invoices) ──
  /** Colour of the title, header rule and accents on the printed invoice, "#RRGGBB". */
  invoiceAccent: string;
  /** A small logo as a data URL (PNG/JPEG/WebP), or '' for none. Kept small on purpose; it is embedded in every PDF. */
  invoiceLogo: string;
  /** Bank / UPI details for customers to pay into, printed at the foot. Free text, several lines. */
  invoiceBank: string;
  /** A closing line, e.g. "Thank you for shopping with us". */
  invoiceFooter: string;
  invoiceShowSignature: boolean;
  /** Your UPI ID (like name@bank). With it, invoices can print a QR code that opens a payment for the balance. '' for none. */
  upiId: string;
  /** Print that QR code on invoices that still have a balance. Needs a UPI ID. */
  invoiceShowUpiQr: boolean;
  // ── Proforma invoices (a quote to pay against; no stock or tax effect) ──
  proformaPrefix: string;
  /** Days a proforma stays valid. */
  proformaValidDays: number;
  proformaTerms: string;
  // ── Lists you maintain ──
  expenseCategories: string[];
  paymentAccounts: PaymentAccount[];
  /** A monthly limit for each expense category, in paise. A category not listed has no limit. */
  expenseBudgets: Record<string, Paise>;
  /** You are warned about a saree whose profit margin falls below this. 0 turns the warning off. */
  marginAlertPercent: number;
  // ── Notifications: badges in the sidebar ──
  notifyLowStock: boolean;
  notifyOverdue: boolean;
  // ── Look and wording ──
  /** The paper invoices, statements and receipts are printed on. */
  paperSize: 'A4' | 'A5' | 'Letter';
  /** How dates are written everywhere in the app. */
  dateFormat: 'short' | 'slash' | 'iso';
  /** The language of the words printed on invoices (names, numbers and amounts are never translated). */
  invoiceLanguage: 'en' | 'hi' | 'gu';
  // ── Messages you send, in your own words. Blank means the built-in wording. ──
  msgInvoice: string;
  msgQuote: string;
  msgDue: string;
}

/** A backup file on this computer. `manual` is true for anything the automatic clean-up never deletes. */
export interface BackupFileInfo {
  name: string;
  bytes: number;
  modifiedAt: string;
  manual: boolean;
  kind: 'daily' | 'manual' | 'before-restore';
}

/** Where else backups go, and how many online ones to keep. Stored beside the book, not in it. */
export interface BackupSettings {
  /** A second folder (a pen drive, another disk). Empty = none. */
  extraFolder: string;
  /** Copy each automatic daily backup to that folder too. */
  extraAuto: boolean;
  /** Upload each automatic daily backup to Google Drive when signed in. */
  driveAuto: boolean;
  /** How many automatic online backups to keep; older ones are removed from Drive. */
  keepDrive: number;
}

/** What happened the last time a copy was sent somewhere. */
export interface BackupNote {
  at: string;
  ok: boolean;
  message: string;
}

export interface DriveStatus {
  /** A Google Cloud client ID and secret have been entered. */
  configured: boolean;
  /** Signed in and allowed to upload. */
  connected: boolean;
  /** The Google account's email, once signed in. */
  account: string;
  clientId: string;
  last: BackupNote | null;
}

/** A backup file held in Google Drive. */
export interface DriveBackup {
  id: string;
  name: string;
  bytes: number;
  createdAt: string;
  manual: boolean;
}

/** What Data management shows: where the data lives and the backups that exist. */
export interface DataInfo {
  folder: string;
  databaseBytes: number;
  backups: BackupFileInfo[];
  settings: BackupSettings;
  extraLast: BackupNote | null;
  drive: DriveStatus;
  /** A restore has been prepared and will happen when InvoiceOn next starts. */
  restorePending: boolean;
}

/** What "Back up now" did: each place the copy went, and each place it could not. */
export interface BackupResult {
  name: string;
  done: string[];
  problems: string[];
}

export type RestoreSource = { from: 'list'; name: string } | { from: 'file' } | { from: 'drive'; id: string };

/** How an invoice is dressed. Applied when it is shown or printed, so a new logo or colour restyles every invoice, old ones included. */
export interface InvoiceBranding {
  accent: string;
  logo: string;
  showSignature: boolean;
  showUpiQr: boolean;
  /** The language of the words printed on the document. */
  language: 'en' | 'hi' | 'gu';
}

// ── Raw materials ───────────────────────────────────────────────────────────
export interface Material {
  id: string;
  name: string;
  unit: string;
  unitCostPaise: Paise;
  /** Number of active variants whose costing uses this material. */
  usedInCount: number;
  /** A group to sort materials into (yarn, dye, packing…). Empty when none. */
  category: string;
  /** How much is in hand, in the material's unit. */
  stockQty: number;
  /** Order more when the stock falls to this. 0 means don't watch it. */
  reorderQty: number;
  /** ok = fine or not watched, low = at or below the reorder quantity, out = none left (and watched). */
  status: 'ok' | 'low' | 'out';
  /** Who it is usually bought from. */
  supplierId: string | null;
  supplierName: string;
}
export interface MaterialInput {
  name: string;
  unit: string;
  unitCostPaise: Paise;
  category?: string;
  reorderQty?: number;
  supplierId?: string | null;
  /** On create only: what is in hand now. Later changes go through purchases and adjustments so the history stays. */
  openingQty?: number;
}

export type MaterialMovementReason = 'opening' | 'purchase' | 'used' | 'wastage' | 'adjustment';
export const MATERIAL_REASON_LABEL: Record<MaterialMovementReason, string> = { opening: 'Opening stock', purchase: 'Bought', used: 'Used', wastage: 'Wasted', adjustment: 'Count correction' };
export interface MaterialMovement {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: MaterialMovementReason;
  note: string;
  createdAt: string;
}
export interface MaterialPricePoint {
  changedAt: string;
  unitCostPaise: Paise;
  source: 'opening' | 'manual' | 'purchase';
}

export interface PurchaseLineInput {
  materialId: string;
  qty: number;
  unitCostPaise: Paise;
}
export interface PurchaseInput {
  supplierId: string | null;
  date: string;
  billNo: string;
  note: string;
  lines: PurchaseLineInput[];
  /** GST on the bill (included in the line prices), claimable as input tax. */
  gstPaise?: Paise;
  /** Also enter it as an expense (category Raw materials) so it counts in profit and in the account it was paid from. */
  expense?: { method: PaymentMethod; accountId?: string; status: ExpenseStatus; dueDate?: string | null } | null;
}
export interface PurchaseSummary {
  id: string;
  date: string;
  supplierId: string | null;
  supplierName: string;
  billNo: string;
  totalPaise: Paise;
  gstPaise: Paise;
  lineCount: number;
  expenseId: string | null;
}
export interface Purchase extends PurchaseSummary {
  note: string;
  lines: { materialId: string; materialName: string; unit: string; qty: number; unitCostPaise: Paise; amountPaise: Paise }[];
}

/** One variant whose cost would change if the materials cost what is asked in a what-if. */
export interface SimulationRow {
  variantId: string;
  designId: string;
  designName: string;
  color: string;
  size: string;
  stock: number;
  sellPricePaise: Paise;
  costNowPaise: Paise;
  costThenPaise: Paise;
  /** Profit as a share of the selling price. Null when it has no selling price. */
  marginNowPercent: number | null;
  marginThenPercent: number | null;
}
export interface Simulation {
  rows: SimulationRow[];
  /** What the stock in hand would be worth at cost, now and then. */
  stockCostNowPaise: Paise;
  stockCostThenPaise: Paise;
  /** How many of the affected variants would end up selling below what they cost. */
  belowCostCount: number;
  /** How many would fall below the margin you want to keep (Settings). */
  lowMarginCount: number;
}

// ── Designs & variants ──────────────────────────────────────────────────────
export interface BomLine {
  materialId: string;
  materialName: string;
  unit: string;
  /** The quantity for one piece, before wastage. */
  qty: number;
  unitCostPaise: Paise;
  /** Extra material lost in making it, as a share of qty. The cost counts qty plus this. */
  wastagePercent: number;
  lineCostPaise: Paise;
}

export interface Variant {
  id: string;
  designId: string;
  sku: string;
  color: string;
  size: string;
  stock: number;
  reorderLevel: number;
  /** Making / purchase cost per piece, before raw materials. */
  baseCostPaise: Paise;
  bom: BomLine[];
  materialCostPaise: Paise;
  /** baseCost + materials. This is the figure used for stock valuation and margins. */
  unitCostPaise: Paise;
  /** Selling price per piece, before GST. */
  sellPricePaise: Paise;
  /** The printed maximum retail price, GST included. 0 when not set. */
  mrpPaise: Paise;
  status: Exclude<StockStatus, 'empty'>;
  /** Where the pieces are kept: the shop (where they are sold from) and any other place. Quantities add up to `stock`. */
  locations: { locationId: string; name: string; qty: number }[];
}

export interface DesignSummary {
  id: string;
  code: string;
  name: string;
  /** A special one-word name for the saree, e.g. "Kadhua". Empty when it has none. */
  nickname: string;
  fabric: string;
  hsnCode: string;
  description: string;
  defaultPricePaise: Paise;
  /** This design's own GST rate, when it differs from the shop's usual one. Null = use the usual rate (or a price slab). */
  gstRatePercent: number | null;
  tags: string;
  /** Who it is usually bought or made by, for the reorder list. */
  supplierId: string | null;
  supplierName: string;
  variantCount: number;
  totalStock: number;
  stockValuePaise: Paise;
  status: StockStatus;
  /** The lowest and highest selling price among the variants that have one, before GST. Both 0 when none is priced. */
  minPricePaise: Paise;
  maxPricePaise: Paise;
  /** Profit as a share of the selling price, across the variants that have a price. Null when none is priced. */
  marginPercent: number | null;
  /** The day the design last sold, or null if it never has. */
  lastSoldOn: string | null;
  /** Pieces sold in the last 30 days. */
  soldLast30Days: number;
  /** At the last 30 days' pace, how many days the stock on hand will last. Null when nothing sold recently, 0 when out of stock. */
  daysOfStock: number | null;
}
export interface DesignDetail extends DesignSummary {
  variants: Variant[];
}

export interface DesignInput {
  code: string;
  name: string;
  /** Optional. One word. */
  nickname?: string;
  fabric: string;
  hsnCode: string;
  description: string;
  defaultPricePaise: Paise;
  /** Set only if this design is taxed at a different rate from the shop's usual one. Null/absent = the usual rate. */
  gstRatePercent?: number | null;
  /** Comma separated labels (collection, occasion, season…) for grouping and filtering. */
  tags?: string;
  supplierId?: string | null;
}

export interface StockLocation {
  id: string;
  name: string;
  isDefault: boolean;
  /** Pieces kept there, across all designs. */
  pieces: number;
}
export interface StockTransferInput {
  variantId: string;
  fromLocationId: string;
  toLocationId: string;
  qty: number;
  note?: string;
}
export interface StockTransfer {
  id: string;
  variantId: string;
  fromName: string;
  toName: string;
  qty: number;
  note: string;
  createdAt: string;
}

/** One entry in a variant's price history: the prices it had from that moment. */
export interface PricePoint {
  changedAt: string;
  sellPricePaise: Paise;
  mrpPaise: Paise;
  baseCostPaise: Paise;
}

export interface VariantInput {
  color: string;
  size: string;
  /** Left blank on create to auto-generate from design code + color + size. */
  sku?: string;
  sellPricePaise: Paise;
  /** Optional. Left out or 0 means "not set". */
  mrpPaise?: Paise;
  baseCostPaise: Paise;
  reorderLevel: number;
  /** Create only. Later changes go through stock adjustments so history stays intact. */
  openingStock?: number;
  bom: { materialId: string; qty: number; wastagePercent?: number }[];
}

/**
 * One line of the Add sarees sheet: one piece (a saree in one colour and size). Lines that share a saree name become one design
 * with several colours; a name that matches a design you already have adds the piece to it.
 */
export interface BulkSareeRow {
  name: string;
  /** The special one-word name. Optional; taken from the first row that has one in each design. */
  nickname?: string;
  /** The Saree ID. Left blank to generate one from the design code, colour and size. */
  sku: string;
  color: string;
  size: string;
  fabric: string;
  hsn: string;
  mrpPaise: Paise;
  sellPricePaise: Paise;
  /** Cost price: what the piece costs to make or buy. */
  costPaise: Paise;
  stock: number;
  reorderLevel: number;
}

export interface BulkAddResult {
  /** `row` counts from 0 in the rows that were sent. When there are errors nothing was added. */
  errors: { row: number; message: string }[];
  designsCreated: number;
  /** Existing designs that gained new colours or sizes. */
  designsExtended: number;
  variantsCreated: number;
}

// ── Stock ───────────────────────────────────────────────────────────────────
export const MANUAL_STOCK_REASONS = ['purchase', 'production', 'return', 'adjustment', 'damage'] as const;
export type ManualStockReason = (typeof MANUAL_STOCK_REASONS)[number];
export type StockReason = ManualStockReason | 'opening' | 'sale';

export interface StockAdjustInput {
  variantId: string;
  /** Positive to add stock, negative to remove. */
  delta: number;
  reason: ManualStockReason;
  note?: string;
}

export interface StockMovement {
  id: string;
  variantId: string;
  delta: number;
  balanceAfter: number;
  reason: StockReason;
  note: string;
  unitCostPaise: Paise;
  createdAt: string;
}

// ── Customers ───────────────────────────────────────────────────────────────
/** B2B = a GST-registered business (tax invoice); B2C = an individual buyer (retail invoice). */
export type InvoiceType = 'B2B' | 'B2C';

export interface CustomerInput {
  name: string;
  /** How this customer is normally billed; prefilled on new invoices. */
  type: InvoiceType;
  phone: string;
  email: string;
  gstin: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  notes: string;
  /** Comma separated labels ("bridal, regular") used to group and filter customers. */
  tags?: string;
  /** The most they should owe at once. 0 = no limit. */
  creditLimitPaise?: Paise;
  /** Days after the invoice date that payment is due. null = no agreed terms. */
  paymentTermsDays?: number | null;
  /** YYYY-MM-DD; the year may be a placeholder. Only the month and day matter. */
  birthday?: string;
  anniversary?: string;
  /** Other places they take delivery, beyond the main address. */
  addresses?: CustomerAddress[];
  /** Other people to call about this customer. */
  contacts?: CustomerContact[];
}
export interface CustomerAddress {
  label: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
}
export interface CustomerContact {
  name: string;
  role: string;
  phone: string;
  email: string;
}
export interface Customer extends CustomerInput {
  id: string;
  tags: string;
  creditLimitPaise: Paise;
  paymentTermsDays: number | null;
  birthday: string;
  anniversary: string;
  addresses: CustomerAddress[];
  contacts: CustomerContact[];
  invoiceCount: number;
  billedPaise: Paise;
  /** What they still owe on issued invoices. */
  outstandingPaise: Paise;
  /** Money they've paid that isn't on any invoice yet. Applied to their next invoice. */
  advancePaise: Paise;
}

/** What one customer has bought of one design, from their issued invoices. */
export interface CustomerPurchase {
  designName: string;
  /** Pieces bought, and what they came to before GST. */
  pieces: number;
  amountPaise: Paise;
  invoiceCount: number;
  lastBoughtOn: string;
  /** The colours and sizes they have had, most recent first. */
  variants: string[];
}

// ── Payments ────────────────────────────────────────────────────────────────
export const PAYMENT_METHODS = ['cash', 'upi', 'bank', 'cheque', 'card', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  bank: 'Bank transfer',
  cheque: 'Cheque',
  card: 'Card',
  other: 'Other',
};

export interface PaymentAllocation {
  invoiceId: string;
  invoiceNumber: string;
  amountPaise: Paise;
}

export interface PaymentInput {
  /** Required to keep any part of the payment as advance. May be null only when the whole amount goes to walk-in invoices. */
  customerId: string | null;
  amountPaise: Paise;
  method: PaymentMethod;
  reference: string;
  receivedOn: string;
  note: string;
  /** How much of the payment goes to which invoice. Whatever is left over is held as the customer's advance. */
  allocations: { invoiceId: string; amountPaise: Paise }[];
  /** The account it went into. Optional. */
  accountId?: string;
  /** For a cheque, the date on it. A date after today makes it a post-dated cheque to track. */
  chequeDate?: string | null;
  /** A deposit against this quote: held as the customer's advance and put toward the invoice when the quote is invoiced. */
  proformaId?: string | null;
}

export interface Payment {
  id: string;
  customerId: string | null;
  customerName: string;
  amountPaise: Paise;
  method: PaymentMethod;
  reference: string;
  receivedOn: string;
  note: string;
  allocations: PaymentAllocation[];
  /** The part of this payment sitting against invoices. */
  appliedPaise: Paise;
  /** The part not yet on any invoice (the customer's advance). */
  advancePaise: Paise;
  voided: boolean;
  voidReason: string;
  createdAt: string;
  /** A write-off clears a small balance without any money arriving. It never counts as received. */
  kind: PaymentKind;
  /** The payment account it went into (Settings → Payment accounts). Empty for entries made before accounts were linked. */
  accountId: string;
  /** For a cheque: the date written on it (it may be post-dated), and where it has got to. */
  chequeDate: string | null;
  chequeStatus: ChequeStatus | null;
  /** The day it was matched against a bank statement. */
  reconciledOn: string | null;
  /** The quote it is a deposit for. */
  proformaId: string | null;
  /** For a credit: the credit note that made it. */
  creditNoteId: string | null;
  /** For a refund: the payment (or credit) whose held money it returned. Null when it returned a credit note's overpayment directly. */
  refundOf: string | null;
  /** Money from this payment already handed back. */
  refundedPaise: Paise;
}
/**
 * receipt: money in. writeoff: a balance given up, no money. credit: a credit note put toward an invoice, or held for the customer,
 * no money moves. refund: money handed back. Only receipts count as received; a refund is money out.
 */
export type PaymentKind = 'receipt' | 'writeoff' | 'credit' | 'refund';
export type ChequeStatus = 'pending' | 'deposited' | 'cleared' | 'bounced';
export const CHEQUE_STATUS_LABEL: Record<ChequeStatus, string> = { pending: 'To deposit', deposited: 'Deposited', cleared: 'Cleared', bounced: 'Bounced' };

export interface PaymentQuery {
  search?: string;
  status?: 'all' | 'advance' | 'voided' | 'writeoff' | 'cheque' | 'unreconciled';
  /** Only payments into this account. */
  accountId?: string;
  customerId?: string;
  /** Only payments received with this method. */
  method?: PaymentMethod;
  /** Only payments received on or after / on or before these days ("YYYY-MM-DD"). */
  from?: string;
  to?: string;
}

/** A payment as it appears on one invoice. */
export interface InvoicePayment {
  paymentId: string;
  receivedOn: string;
  method: PaymentMethod;
  reference: string;
  amountPaise: Paise;
}

// ── Ledger & dues ───────────────────────────────────────────────────────────
export interface LedgerEntry {
  date: string;
  kind: 'invoice' | 'invoice-cancelled' | 'payment' | 'payment-voided' | 'writeoff' | 'credit-note' | 'refund' | 'refund-voided';
  description: string;
  invoiceId?: string;
  debitPaise: Paise;
  creditPaise: Paise;
  /** Running balance after this line. Positive = the customer owes you; negative = you hold their advance. */
  balancePaise: Paise;
}

export interface Ledger {
  customer: Customer;
  entries: LedgerEntry[];
  billedPaise: Paise;
  /** Money that actually arrived. Write-offs are not in it. */
  receivedPaise: Paise;
  /** Balances you chose not to chase. */
  writtenOffPaise: Paise;
  /** Credit notes issued to this customer, and money handed back to them. */
  creditedPaise: Paise;
  refundedPaise: Paise;
  /** billed − received − written off. Positive = owes, negative = advance credit. */
  balancePaise: Paise;
}

export interface DuesBuckets {
  /** Not yet due. */
  currentPaise: Paise;
  days1to30Paise: Paise;
  days31to60Paise: Paise;
  days61plusPaise: Paise;
}

export interface DuesRow extends DuesBuckets {
  /** Null for walk-in invoices with no saved customer. */
  customerId: string | null;
  customerName: string;
  phone: string;
  openInvoices: number;
  outstandingPaise: Paise;
  overduePaise: Paise;
  oldestDueDate: string | null;
  advancePaise: Paise;
  /** An open promise to pay: the earliest day they said and how much. */
  promisedOn: string | null;
  promisedPaise: Paise;
}

export interface DuesReport extends DuesBuckets {
  rows: DuesRow[];
  outstandingPaise: Paise;
  overduePaise: Paise;
  advanceHeldPaise: Paise;
}

export interface PaymentsSummary {
  receivedThisMonthPaise: Paise;
  paymentsThisMonth: number;
  advanceHeldPaise: Paise;
  customersWithAdvance: number;
  outstandingPaise: Paise;
  overduePaise: Paise;
}

// ── Invoices ────────────────────────────────────────────────────────────────
/** A party's details frozen onto the invoice, so later edits to a customer never rewrite history. */
export interface Party {
  name: string;
  gstin: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
}

export interface InvoiceLine {
  id: string;
  variantId: string;
  designName: string;
  color: string;
  size: string;
  sku: string;
  hsn: string;
  qty: number;
  unitPricePaise: Paise;
  /** Quantity × price, before this line's own discount. */
  amountPaise: Paise;
  /** Taken off this line alone. */
  discountPaise: Paise;
  /** The GST rate this line was charged. */
  ratePercent: number;
  /** A word for the customer about this line, printed under it. */
  note: string;
  /** This line's share of the taxable value and of the tax, once the invoice discount is spread over it. Null on invoices made before these were kept. */
  taxablePaise: Paise | null;
  taxPaise: Paise | null;
}

/** One line as typed in: only the item, quantity and price are required. */
export interface LineInput {
  variantId: string;
  qty: number;
  unitPricePaise: Paise;
  /** Taken off this line alone, in paise. */
  discountPaise?: Paise;
  /** A rate for this line alone. Absent/null = work it out (design rate, price slab, the shop's usual). */
  ratePercent?: number | null;
  note?: string;
}

export type DeliveryStatus = 'none' | 'pending' | 'dispatched' | 'delivered';
export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = { none: 'No delivery', pending: 'To dispatch', dispatched: 'Dispatched', delivered: 'Delivered' };

/** Where the goods are sent, when that is not the billing address. */
export interface ShipTo {
  name: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
}

/** The logistics of an invoice: unlike the tax document itself, these can be updated after it is issued. */
export interface DeliveryUpdate {
  status: DeliveryStatus;
  transport: string;
  trackingNo: string;
  /** The day it arrived. Defaults to today when the status becomes "delivered". */
  deliveredOn?: string | null;
}

export interface InvoiceSummary {
  id: string;
  number: string;
  deliveryStatus: DeliveryStatus;
  type: InvoiceType;
  customerId: string | null;
  buyerName: string;
  issueDate: string;
  dueDate: string | null;
  totalPaise: Paise;
  /** Sum of payments received against this invoice. Always 0 until payments are built. */
  paidPaise: Paise;
  status: InvoiceStatus;
}

/** A credit note against an invoice, as listed on it. */
export interface InvoiceCredit {
  id: string;
  number: string;
  issueDate: string;
  totalPaise: Paise;
}

export interface Invoice extends InvoiceSummary {
  /** Credit notes issued against this invoice. */
  credits: InvoiceCredit[];
  /** Their total. The invoice's balance already allows for it. */
  creditedPaise: Paise;
  /**
   * The seller's details as they were when the invoice was issued. Content that matters legally or to the customer (address,
   * GSTIN, terms, where to pay) is frozen here; how it's dressed is `branding`, below.
   */
  seller: Party & { email: string; terms: string; bank: string; footer: string; upiId: string };
  branding: InvoiceBranding;
  buyer: Party;
  placeOfSupply: string;
  gstRatePercent: number;
  /** Prices (and the subtotal and discount) include GST; the tax is carved out of them. */
  pricesIncludeGst: boolean;
  intraState: boolean;
  subtotalPaise: Paise;
  /** Taken off individual lines. */
  lineDiscountPaise: Paise;
  /** Taken off the whole invoice. */
  discountPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  roundOffPaise: Paise;
  /** The tax by rate, lowest first. One entry on a one-rate invoice. */
  taxByRate: RateGroup[];
  notes: string;
  lines: InvoiceLine[];
  /** Where it is delivered if not to the buyer's address. Fixed when the invoice is issued, since it is printed on it. */
  shipTo: ShipTo | null;
  transport: string;
  trackingNo: string;
  deliveredOn: string | null;
  /** The numbering series it belongs to: '' for the main one, 'B2B' for the separate B2B run. */
  series: string;
  /** Payments currently applied to this invoice. */
  payments: InvoicePayment[];
  cancelledAt: string | null;
  cancelReason: string;
  createdAt: string;
}

export interface InvoiceInput {
  type: InvoiceType;
  /** Required for B2B; optional for B2C (walk-in sales). */
  customerId: string | null;
  /** Used for a walk-in B2C sale with no saved customer. */
  buyerName?: string;
  issueDate: string;
  dueDate: string | null;
  discountPaise: Paise;
  notes: string;
  lines: LineInput[];
  /** Money the customer hands over as the invoice is made — recorded in the same step as issuing it. */
  payment?: { amountPaise: Paise; method: PaymentMethod; reference: string };
  /** How much of the customer's held advance to put toward this invoice. */
  applyAdvancePaise?: Paise;
  shipTo?: ShipTo | null;
  transport?: string;
  trackingNo?: string;
  /** Defaults to 'pending' when there is a ship-to or a transporter, otherwise 'none'. */
  deliveryStatus?: DeliveryStatus;
}

export interface InvoiceQuery {
  search?: string;
  type?: 'all' | InvoiceType;
  status?: 'all' | 'open' | 'overdue' | 'cancelled';
  /** Only invoices at this delivery stage. */
  delivery?: DeliveryStatus;
  customerId?: string;
  /** Only invoices dated on or after / on or before these days ("YYYY-MM-DD"). */
  from?: string;
  to?: string;
}

/** One sellable variant, flattened for the invoice item picker. */
export interface SaleVariant {
  variantId: string;
  designId: string;
  designCode: string;
  designName: string;
  designNickname: string;
  hsn: string;
  /** The design's own GST rate, when it has one. */
  gstRatePercent: number | null;
  color: string;
  size: string;
  sku: string;
  stock: number;
  sellPricePaise: Paise;
}

// ── Credit notes ────────────────────────────────────────────────────────────
export interface CreditNoteSummary {
  id: string;
  number: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string | null;
  buyerName: string;
  type: InvoiceType;
  issueDate: string;
  reason: string;
  totalPaise: Paise;
}

export interface CreditNoteLine {
  id: string;
  invoiceLineId: string;
  variantId: string | null;
  designName: string;
  color: string;
  size: string;
  sku: string;
  hsn: string;
  qty: number;
  unitPricePaise: Paise;
  amountPaise: Paise;
  discountPaise: Paise;
  ratePercent: number;
  taxablePaise: Paise;
  taxPaise: Paise;
  /** The pieces went back on the shelf. Not done for damaged goods. */
  restocked: boolean;
}

export interface CreditNote extends CreditNoteSummary {
  seller: Party & { email: string; terms: string; bank: string; footer: string; upiId: string };
  branding: InvoiceBranding;
  buyer: Party;
  placeOfSupply: string;
  gstRatePercent: number;
  pricesIncludeGst: boolean;
  intraState: boolean;
  subtotalPaise: Paise;
  lineDiscountPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  roundOffPaise: Paise;
  taxByRate: RateGroup[];
  lines: CreditNoteLine[];
  /** How the money was dealt with. */
  appliedPaise: Paise;
  heldPaise: Paise;
  refundedPaise: Paise;
  createdAt: string;
}

/** What one invoice line can still take back. */
export interface ReturnableLine {
  invoiceLineId: string;
  variantId: string;
  designName: string;
  color: string;
  size: string;
  sku: string;
  qty: number;
  creditedQty: number;
  remainingQty: number;
  unitPricePaise: Paise;
  ratePercent: number;
}

export interface CreditNoteInput {
  invoiceId: string;
  issueDate: string;
  reason: string;
  lines: { invoiceLineId: string; qty: number; restock: boolean }[];
  /**
   * Only needed when the customer has already paid more than the invoice now comes to, so money is left over:
   * give it back ('refund') or keep it for their next purchase ('credit').
   */
  leftover?: 'refund' | 'credit';
  /** How the refund was paid, when there is one. */
  refund?: { method: PaymentMethod; accountId?: string; reference?: string };
}

/** What a credit note would come to, before it is made. */
export interface CreditNotePreview {
  subtotalPaise: Paise;
  lineDiscountPaise: Paise;
  taxablePaise: Paise;
  taxPaise: Paise;
  roundOffPaise: Paise;
  totalPaise: Paise;
  taxByRate: RateGroup[];
  /** The part that reduces what the customer owes on the invoice. */
  appliedPaise: Paise;
  /** The part that is left because they had already paid: to be refunded or kept as credit. */
  leftoverPaise: Paise;
}

export interface CreditNoteQuery {
  search?: string;
  invoiceId?: string;
  customerId?: string;
  from?: string;
  to?: string;
}

/** A refund of money a customer is holding with you (advance or credit), with the money going out by the chosen method. */
export interface RefundInput {
  customerId: string;
  amountPaise: Paise;
  method: PaymentMethod;
  date: string;
  accountId?: string;
  reference?: string;
  note?: string;
}

export interface DashboardSummary {
  outstandingPaise: Paise;
  openInvoices: number;
  monthPaise: Paise;
  monthInvoices: number;
  overdueCount: number;
  overduePaise: Paise;
  recent: InvoiceSummary[];
}

// ── Reports ─────────────────────────────────────────────────────────────────
export interface SalesSeriesPoint {
  /** 'YYYY-MM-DD' (daily) or 'YYYY-MM' (monthly). */
  key: string;
  /** Invoices dated in this bucket. */
  invoicedPaise: Paise;
  /** Payments received in this bucket — a separate measure, by payment date, not tied to which invoice they paid. */
  collectedPaise: Paise;
  invoices: number;
}

export interface SalesReport {
  range: { from: string; to: string };
  /** Invoice totals (incl. GST) dated in the period, cancelled invoices excluded, less credit notes dated in the period. Everything below that is about sales is net of returns too. */
  invoicedPaise: Paise;
  /** Credit notes dated in the period, already taken off the figures above. */
  creditNoteCount: number;
  creditNotePaise: Paise;
  taxablePaise: Paise;
  gstPaise: Paise;
  invoiceCount: number;
  piecesSold: number;
  cancelledCount: number;
  cancelledPaise: Paise;
  /** Payments received in the period (reversed ones excluded). */
  collectedPaise: Paise;
  paymentCount: number;
  /** Of the invoices raised in this period, what is still owed today. */
  stillUnpaidPaise: Paise;
  /** Taxable value less what the pieces cost. */
  grossProfitPaise: Paise;
  /** Gross profit as a share of taxable value; null when there were no sales. */
  marginPercent: number | null;
  granularity: 'day' | 'month';
  series: SalesSeriesPoint[];
  byType: { type: InvoiceType; invoices: number; invoicedPaise: Paise }[];
  byMethod: { method: PaymentMethod; count: number; paise: Paise }[];
  topDesigns: { designId: string; name: string; pieces: number; revenuePaise: Paise; profitPaise: Paise }[];
  topCustomers: { customerId: string | null; name: string; invoices: number; invoicedPaise: Paise }[];
}

export interface GstTotals {
  invoices: number;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  taxPaise: Paise;
  invoiceValuePaise: Paise;
}

export interface GstReport {
  range: { from: string; to: string };
  totals: GstTotals;
  b2b: GstTotals;
  b2c: GstTotals;
  hsn: { hsn: string; qty: number; taxablePaise: Paise; cgstPaise: Paise; sgstPaise: Paise; igstPaise: Paise; taxPaise: Paise }[];
  b2bRegister: {
    invoiceId: string;
    number: string;
    date: string;
    customer: string;
    gstin: string;
    placeOfSupply: string;
    ratePercent: number;
    taxablePaise: Paise;
    cgstPaise: Paise;
    sgstPaise: Paise;
    igstPaise: Paise;
    totalPaise: Paise;
  }[];
  b2cByState: { placeOfSupply: string; ratePercent: number; invoices: number; taxablePaise: Paise; cgstPaise: Paise; sgstPaise: Paise; igstPaise: Paise }[];
  /** The totals above are net: credit notes dated in the period have been taken off. This is what was taken off. */
  credits: { count: number; taxablePaise: Paise; cgstPaise: Paise; sgstPaise: Paise; igstPaise: Paise; taxPaise: Paise; valuePaise: Paise };
  /** One row for each rate on each credit note. The note's value sits on its first row only. */
  creditNoteRegister: {
    creditNoteId: string;
    number: string;
    date: string;
    invoiceNumber: string;
    customer: string;
    gstin: string;
    placeOfSupply: string;
    ratePercent: number;
    taxablePaise: Paise;
    cgstPaise: Paise;
    sgstPaise: Paise;
    igstPaise: Paise;
    totalPaise: Paise;
  }[];
  /** Cancelled invoices dated in the period; they are left out of everything above. */
  cancelledCount: number;
}

export interface StockVariantRow {
  variantId: string;
  sku: string;
  color: string;
  size: string;
  pieces: number;
  unitCostPaise: Paise;
  sellPricePaise: Paise;
  costValuePaise: Paise;
  retailValuePaise: Paise;
  /** Date of the most recent sale, or null if it has never sold. */
  lastSoldOn: string | null;
}

export interface StockDesignRow {
  designId: string;
  code: string;
  name: string;
  fabric: string;
  pieces: number;
  costValuePaise: Paise;
  retailValuePaise: Paise;
  variants: StockVariantRow[];
}

export interface StockReport {
  asOf: string;
  pieces: number;
  /** What the stock cost to make or buy. This is the figure for accounts. */
  costValuePaise: Paise;
  /** What it would fetch at today's selling prices, before GST. */
  retailValuePaise: Paise;
  designCount: number;
  variantCount: number;
  /** Variants with nothing on the shelf on that date. */
  outOfStockVariants: number;
  rows: StockDesignRow[];
}

// ── Queries & summaries ─────────────────────────────────────────────────────
export interface DesignQuery {
  search?: string;
  /** 'low' includes out-of-stock, matching the dashboard's "Low stock SKUs" figure. */
  status?: 'all' | 'low' | 'out';
}

export interface InventorySummary {
  designCount: number;
  variantCount: number;
  unitsInStock: number;
  stockValuePaise: Paise;
  lowStockDesigns: number;
  outOfStockDesigns: number;
  materialCount: number;
}

// ── Expenses ────────────────────────────────────────────────────────────────
export interface Expense {
  id: string;
  /** "YYYY-MM-DD" */
  date: string;
  category: string;
  /** Who was paid. Optional. */
  vendor: string;
  amountPaise: Paise;
  method: PaymentMethod;
  reference: string;
  note: string;
  createdAt: string;
  vendorId: string | null;
  /** The input GST included in the amount, which can be set off against the GST you owe. */
  gstPaise: Paise;
  /** The account it was paid from. */
  accountId: string;
  /** 'unpaid' is a bill you owe and haven't paid yet. */
  status: ExpenseStatus;
  dueDate: string | null;
  /** The day the money actually left. For an unpaid bill, null. */
  paidOn: string | null;
  /** The standing expense that made this entry. */
  recurringId: string | null;
}
export type ExpenseStatus = 'paid' | 'unpaid';

export interface ExpenseInput {
  date: string;
  category: string;
  vendor: string;
  amountPaise: Paise;
  method: PaymentMethod;
  reference: string;
  note: string;
  gstPaise?: Paise;
  accountId?: string;
  /** Defaults to paid. */
  status?: ExpenseStatus;
  dueDate?: string | null;
  /** When it was paid, if different from the expense date. */
  paidOn?: string | null;
}

export interface ExpenseQuery {
  search?: string;
  category?: string;
  from?: string;
  to?: string;
  status?: ExpenseStatus;
  vendorId?: string;
}

/** A person or business money is paid to; raw-material suppliers are vendors too. */
export interface VendorInput {
  name: string;
  phone: string;
  gstin: string;
  address: string;
  notes: string;
}
export interface Vendor extends VendorInput {
  id: string;
  /** Everything spent with them, and how many entries that was. */
  spendPaise: Paise;
  expenseCount: number;
  /** Bills not yet paid. */
  unpaidPaise: Paise;
  lastSpentOn: string | null;
}

export const RECURRING_FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'yearly'] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];
export const RECURRING_LABEL: Record<RecurringFrequency, string> = { weekly: 'Every week', monthly: 'Every month', quarterly: 'Every 3 months', yearly: 'Every year' };

export interface RecurringExpenseInput {
  category: string;
  vendor: string;
  amountPaise: Paise;
  gstPaise?: Paise;
  method: PaymentMethod;
  accountId?: string;
  note: string;
  frequency: RecurringFrequency;
  /** The next day an entry is due. */
  nextDate: string;
  /** Stops after this day. Optional. */
  endDate?: string | null;
}
export interface RecurringExpense extends Required<Omit<RecurringExpenseInput, 'endDate'>> {
  id: string;
  endDate: string | null;
}

/** A category's spending this month against its budget. */
export interface BudgetLine {
  category: string;
  budgetPaise: Paise;
  spentPaise: Paise;
  /** Spent as a share of the budget. */
  percent: number;
  /** near = 80% or more; over = past the budget. */
  status: 'ok' | 'near' | 'over';
}

/** Output GST on sales less input GST on purchases, for a stretch of dates. */
export interface GstNet {
  range: { from: string; to: string };
  outputPaise: Paise;
  inputPaise: Paise;
  /** Output less input. Negative means a credit to carry forward. */
  netPaise: Paise;
}

/** Spending with GST shown separately, for claiming input tax. */
export interface PurchasesReport {
  range: { from: string; to: string };
  totalPaise: Paise;
  gstPaise: Paise;
  taxablePaise: Paise;
  /** Entries with GST on them, oldest first. */
  entries: { id: string; date: string; vendor: string; vendorGstin: string; category: string; totalPaise: Paise; gstPaise: Paise; taxablePaise: Paise }[];
  byVendor: { vendor: string; gstin: string; totalPaise: Paise; gstPaise: Paise }[];
  byMonth: { month: string; totalPaise: Paise; gstPaise: Paise }[];
  /** Spending in the range with no GST recorded. */
  withoutGstPaise: Paise;
}

/** Bills owed and when. */
export interface PayablesSummary {
  unpaidPaise: Paise;
  unpaidCount: number;
  overduePaise: Paise;
  overdueCount: number;
}

export interface ExpensesOverview {
  totalPaise: Paise;
  count: number;
  byCategory: { category: string; paise: Paise; count: number }[];
}

/** Spending laid out month by month for each category, with the same thing for the stretch just before, to compare. */
export interface ExpensesBreakdown {
  /** "YYYY-MM", oldest first. */
  months: string[];
  /** One per category, biggest first. `byMonth` lines up with `months`. `previousPaise` is null when there is no earlier stretch to compare with. */
  rows: { category: string; byMonth: Paise[]; totalPaise: Paise; previousPaise: Paise | null }[];
  monthTotals: Paise[];
  totalPaise: Paise;
  /** The stretch of the same length just before the one shown. Null when the view has no fixed start and end (All time). */
  previous: { from: string; to: string; totalPaise: Paise } | null;
}

// ── Proforma invoices ───────────────────────────────────────────────────────
/** 'expired' is worked out from the valid-until date; it is never stored. */
/** open = waiting; expired = past its date; partial = some of it invoiced; converted = all invoiced; lost = the customer said no; cancelled = withdrawn. */
export type ProformaStatus = 'open' | 'expired' | 'partial' | 'converted' | 'lost' | 'cancelled';

export const PROFORMA_STATUS_LABEL: Record<ProformaStatus, string> = { open: 'Open', expired: 'Expired', partial: 'Part-invoiced', converted: 'Invoiced', lost: 'Lost', cancelled: 'Cancelled' };

/** Where a quote stands with the customer, apart from what has been invoiced. */
export type QuoteStage = 'open' | 'accepted' | 'lost';
export const QUOTE_STAGE_LABEL: Record<QuoteStage, string> = { open: 'Waiting', accepted: 'Accepted', lost: 'Lost' };

export interface ProformaSummary {
  id: string;
  number: string;
  type: InvoiceType;
  customerId: string | null;
  buyerName: string;
  issueDate: string;
  validUntil: string;
  totalPaise: Paise;
  status: ProformaStatus;
  /** The latest invoice made from this quote. */
  invoiceId: string | null;
  /** The numbers of the invoices made from it, joined with commas. */
  invoiceNumber: string | null;
  stage: QuoteStage;
  /** Why it was lost, when it was. */
  lostReason: string;
  /** Deposit money taken against this quote and not reversed. */
  depositPaise: Paise;
  /** How much of the quoted total has been invoiced so far (the value of the invoiced quantities). */
  invoicedPaise: Paise;
}

export interface ProformaLine extends InvoiceLine {
  /** How many of this line's pieces have been invoiced so far. */
  invoicedQty: number;
}

export interface Proforma extends ProformaSummary {
  seller: Party & { email: string; terms: string; bank: string; footer: string; upiId: string };
  branding: InvoiceBranding;
  buyer: Party;
  placeOfSupply: string;
  gstRatePercent: number;
  /** Prices (and the subtotal and discount) include GST; the tax is carved out of them. */
  pricesIncludeGst: boolean;
  intraState: boolean;
  subtotalPaise: Paise;
  lineDiscountPaise: Paise;
  discountPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  roundOffPaise: Paise;
  taxByRate: RateGroup[];
  notes: string;
  lines: ProformaLine[];
  /** The invoices made from it that still stand (cancelled ones drop off). */
  invoices: { id: string; number: string }[];
  cancelledAt: string | null;
  cancelReason: string;
  createdAt: string;
}

/** An earlier version of a quote, kept when it was changed. */
export interface ProformaRevision {
  version: number;
  /** When this version was replaced. */
  replacedAt: string;
  issueDate: string;
  validUntil: string;
  totalPaise: Paise;
  discountPaise: Paise;
  notes: string;
  lines: { designName: string; color: string; size: string; sku: string; qty: number; unitPricePaise: Paise; amountPaise: Paise }[];
}

/** A saved set of items to start new quotes from. */
export interface QuoteTemplate {
  id: string;
  name: string;
  notes: string;
  lines: { variantId: string; qty: number; unitPricePaise: Paise }[];
}
export interface QuoteTemplateInput {
  name: string;
  notes: string;
  lines: { variantId: string; qty: number; unitPricePaise: Paise }[];
}

export interface ProformaInput {
  type: InvoiceType;
  customerId: string | null;
  buyerName?: string;
  issueDate: string;
  validUntil: string;
  discountPaise: Paise;
  notes: string;
  lines: LineInput[];
}

export interface ProformaQuery {
  search?: string;
  status?: 'all' | ProformaStatus;
  /** Only quotes dated on or after / on or before these days ("YYYY-MM-DD"). */
  from?: string;
  to?: string;
}

/** How the quotes of a stretch of dates turned out: what was quoted, won, lost, and why. */
export interface QuotesReport {
  range: { from: string; to: string };
  /** Quotes dated in the range, not counting ones withdrawn (cancelled). */
  quoteCount: number;
  quotedPaise: Paise;
  /** Any of it invoiced. */
  won: { count: number; quotedPaise: Paise; invoicedPaise: Paise };
  lost: { count: number; quotedPaise: Paise };
  /** Lapsed with no decision. */
  expired: { count: number; quotedPaise: Paise };
  /** Still waiting for an answer. */
  open: { count: number; quotedPaise: Paise };
  withdrawn: number;
  /** Won as a share of the quotes that got an answer or lapsed (won + lost + expired), by count and by quoted value. Null with nothing to measure. */
  winRatePercent: number | null;
  winRateByValuePercent: number | null;
  /** From the quote date to its first invoice, on average. */
  averageDaysToWin: number | null;
  lostReasons: { reason: string; count: number; quotedPaise: Paise }[];
  byMonth: { month: string; count: number; quotedPaise: Paise; wonCount: number }[];
}

// ── Dashboard ───────────────────────────────────────────────────────────────
export interface TrendPoint {
  /** 'YYYY-MM-DD' (a day, or the Monday that starts a week) or 'YYYY-MM' (a month). */
  key: string;
  invoicedPaise: Paise;
  receivedPaise: Paise;
  expensesPaise: Paise;
}

/** What happened today, whatever period the dashboard is showing. */
export interface DashboardToday {
  date: string;
  /** Invoices issued today (cancelled ones left out). */
  invoiceCount: number;
  invoicedPaise: Paise;
  /** Payments that arrived today. */
  collectedPaise: Paise;
  paymentCount: number;
  expensesPaise: Paise;
  /** Unpaid invoices whose due date is today. */
  dueCount: number;
  duePaise: Paise;
}

/** This calendar month so far, whatever period the dashboard is showing. */
export interface DashboardMonth {
  /** The first and last day of the month. */
  range: { from: string; to: string };
  invoiceCount: number;
  invoicedPaise: Paise;
  /** GST charged on this month's invoices, by invoice date (when the tax falls due). */
  gstPaise: Paise;
  /** GST paid on this month's purchases, which can be set off against it. */
  inputGstPaise: Paise;
  /** gstPaise less inputGstPaise. Negative means a credit to carry forward. */
  netGstPaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  /** The monthly sales target from Settings, or 0 when none is set. Measured against `invoicedPaise`. */
  targetPaise: Paise;
  /** How many days of the month have passed, today included, and how many it has. */
  daysElapsed: number;
  daysInMonth: number;
}

/** Stock on the shelf that hasn't sold for a long while. */
export interface DeadStock {
  /** How many days without a sale counts as not selling. */
  days: number;
  /** Across all such designs, not just the ones listed. */
  designCount: number;
  pieces: number;
  /** What those pieces cost, i.e. the money sitting on the shelf. */
  costValuePaise: Paise;
  /** The biggest few by money tied up. A design's `lastSoldOn` is null when none of its pieces has ever sold. */
  designs: { designId: string; name: string; pieces: number; variants: number; costValuePaise: Paise; lastSoldOn: string | null }[];
}

/** One variant that is low on stock or out of it, for building a reorder note. */
export interface ReorderRow {
  designId: string;
  designName: string;
  /** The saree's one-word name, or ''. */
  nickname: string;
  color: string;
  size: string;
  stock: number;
  reorderLevel: number;
  /** Who it is usually bought from; '' when no supplier is set. */
  supplierId: string | null;
  supplierName: string;
}

/** What a festival's shopping season brought in. */
export interface FestivalFigures {
  range: { from: string; to: string };
  invoicedPaise: Paise;
  piecesSold: number;
  invoiceCount: number;
}

/**
 * This year's festival season set beside last year's. While the season is running, both sides are cut to the same number of
 * days so the comparison is fair; before it starts, only last year's is shown; afterwards, the two whole seasons.
 */
export interface FestivalComparison {
  festivalId: string;
  name: string;
  /** 'unknown' when this year's date isn't in the festival list. */
  state: 'upcoming' | 'running' | 'done' | 'unknown';
  /** The festival's date this year and last year, when listed. */
  date: string | null;
  lastDate: string | null;
  /** The full season this year, for showing when it begins and ends. */
  season: { from: string; to: string } | null;
  /** Days until the season begins. Null once it has. */
  startsInDays: number | null;
  /** Null until the season starts. */
  thisSeason: FestivalFigures | null;
  /** Null if last year's date isn't listed. */
  lastSeason: FestivalFigures | null;
}

export type AttentionKind = 'payment-reversed' | 'quote-expiring' | 'below-cost' | 'follow-up' | 'promise' | 'occasion' | 'low-margin' | 'low-material';

/** Something on the dashboard's "needs attention" list. `link` says where to go to deal with it. */
export interface AttentionItem {
  kind: AttentionKind;
  /** Stable, so the list can be keyed. */
  id: string;
  title: string;
  detail: string;
  link: { to: 'customer' | 'proforma' | 'design'; id: string } | { to: 'payments' } | { to: 'materials' };
}

/** The dashboard's "right now" figures: they ignore the period menu because they are about today, not a stretch of time. */
export interface DashboardNow {
  today: DashboardToday;
  month: DashboardMonth;
  /** Most urgent first. */
  attention: AttentionItem[];
  deadStock: DeadStock;
}

export interface DashboardOverview {
  /** The dates actually used. For "All time" this runs from the first record to today. */
  range: { from: string; to: string };
  allTime: boolean;
  invoicedPaise: Paise;
  invoiceCount: number;
  /** Payments that arrived in the period. */
  receivedPaise: Paise;
  paymentCount: number;
  /** Everything still owed on issued invoices as of today (not limited to the period). */
  outstandingPaise: Paise;
  openInvoices: number;
  overduePaise: Paise;
  overdueCount: number;
  expensesPaise: Paise;
  /** Sales before GST, less what the pieces sold had cost (the cost recorded at the time of sale). */
  grossProfitPaise: Paise;
  /** Gross profit as a share of sales before GST. Null when there were no sales. */
  marginPercent: number | null;
  /** Gross profit less the period's expenses. Can be negative. */
  netProfitPaise: Paise;
  /** Average days between issuing an invoice and its final payment, over invoices paid in full. Null if none yet. */
  avgPaymentDays: number | null;
  paidInvoiceCount: number;
  /** What `previous` was measured against: the stretch just before, or the same dates a year earlier. */
  compare: 'previous' | 'last-year';
  /** The dates `previous` covers. Null for all time. */
  compareRange: { from: string; to: string } | null;
  /** The same figures for the comparison stretch, for the up/down arrows. Null for all time. */
  previous: { invoicedPaise: Paise; receivedPaise: Paise; expensesPaise: Paise; netProfitPaise: Paise } | null;
  granularity: 'day' | 'week' | 'month';
  trend: TrendPoint[];
  /** Everything owed today, by how old the invoice is (days since it was issued). Not limited to the period. */
  aging: { label: string; paise: Paise; count: number }[];
  topClients: { customerId: string | null; name: string; invoicedPaise: Paise }[];
  /** Payments that arrived in the period, by how they were paid (cash, UPI, bank…), biggest first. */
  receivedByMethod: { method: PaymentMethod; count: number; paise: Paise }[];
  /** The designs that brought in the most (before GST) in the period, as in the Sales report. `designId` is '' if the design is no longer on file. */
  bestSellers: { designId: string; name: string; pieces: number; revenuePaise: Paise }[];
  expensesByCategory: { category: string; paise: Paise }[];
  recent: InvoiceSummary[];
}

// ── More reports ────────────────────────────────────────────────────────────
/** Profit for a stretch of dates: what was sold (before GST), what it cost, and what was spent. */
export interface ProfitLossFigures {
  invoiceCount: number;
  /** Sales before GST, from issued invoices dated in the stretch. */
  salesPaise: Paise;
  /** What the pieces sold had cost, as recorded when they were sold. */
  costOfGoodsPaise: Paise;
  grossProfitPaise: Paise;
  expensesByCategory: { category: string; paise: Paise }[];
  expensesPaise: Paise;
  /** Gross profit less expenses. Can be negative. */
  netProfitPaise: Paise;
}

export interface ProfitAndLoss extends ProfitLossFigures {
  range: { from: string; to: string };
  /** The same dates a year earlier, for year-on-year. Null when nothing was recorded then. */
  lastYear: (ProfitLossFigures & { range: { from: string; to: string } }) | null;
}

export type MarginBy = 'design' | 'colour' | 'customer';

export interface MarginRow {
  /** Stable key, used to ask for the invoice lines behind the row. */
  key: string;
  name: string;
  pieces: number;
  invoiceCount: number;
  /** Sales before GST, after the invoice's discount. */
  revenuePaise: Paise;
  costPaise: Paise;
  profitPaise: Paise;
  /** Profit as a share of sales. Null when there were no sales. */
  marginPercent: number | null;
}

/** One line of an invoice behind a row of the margin report. */
export interface MarginLine {
  invoiceId: string;
  number: string;
  date: string;
  customer: string;
  design: string;
  color: string;
  size: string;
  qty: number;
  revenuePaise: Paise;
  costPaise: Paise;
}

export interface MarginReport {
  range: { from: string; to: string };
  by: MarginBy;
  rows: MarginRow[];
  totals: { pieces: number; revenuePaise: Paise; costPaise: Paise; profitPaise: Paise; marginPercent: number | null };
}

/** Stock in and out by design over a stretch. Opening + added + returned − sold − damaged + adjusted = closing. */
export interface StockMovementRow {
  designId: string;
  name: string;
  opening: number;
  /** Bought, made, or entered as opening stock. */
  added: number;
  returned: number;
  sold: number;
  damaged: number;
  /** Net of corrections in either direction. */
  adjusted: number;
  closing: number;
}

export interface StockMovementReport {
  range: { from: string; to: string };
  rows: StockMovementRow[];
  totals: Omit<StockMovementRow, 'designId' | 'name'>;
}

export type MoverClass = 'fast' | 'steady' | 'dead' | 'none';

export interface MoverRow {
  designId: string;
  name: string;
  stock: number;
  /** Pieces sold in the window. */
  sold: number;
  lastSoldOn: string | null;
  /** At this pace, days the stock will last. Null if nothing sold. */
  daysOfStock: number | null;
  stockValuePaise: Paise;
  /** fast = among the best sellers; steady = selling; dead = stock on hand but nothing sold in the window; none = no stock and no sales. */
  class: MoverClass;
}

export interface MoversReport {
  days: number;
  rows: MoverRow[];
}

export type DayBookMode = 'all' | 'cash' | 'bank';

export interface DayBookEntry {
  date: string;
  kind: 'sale' | 'credit-note' | 'receipt' | 'refund' | 'expense';
  party: string;
  detail: string;
  method: PaymentMethod | null;
  /** Money in (receipts) and out (expenses). A sale is recorded in `invoicedPaise` and moves no money by itself. */
  inPaise: Paise;
  outPaise: Paise;
  invoicedPaise: Paise;
  /** Running balance after this entry; only for the cash and bank books. */
  balancePaise: Paise | null;
}

export interface DayBook {
  range: { from: string; to: string };
  mode: DayBookMode;
  /** What the book held on the day before the range starts (cash and bank books only). */
  openingPaise: Paise | null;
  closingPaise: Paise | null;
  inPaise: Paise;
  outPaise: Paise;
  invoicedPaise: Paise;
  entries: DayBookEntry[];
}

// ── Bulk tools ──────────────────────────────────────────────────────────────
export interface CustomerImportResult {
  created: number;
  skipped: { row: number; name: string; reason: string }[];
}

export interface StockTakeLine {
  variantId: string;
  counted: number;
}

export interface StockTakeResult {
  checked: number;
  /** How many variants had a different count and were adjusted. */
  adjusted: number;
  /** Net change in pieces across everything adjusted. */
  pieceDifference: number;
  changes: { variantId: string; before: number; after: number }[];
}

export type BulkDesignAction =
  | { ids: string[]; kind: 'archive' }
  | { ids: string[]; kind: 'reorder'; level: number }
  /** `set`: every variant's selling price becomes `value` (paise). `percent`: prices change by `value` percent (negative to lower them). */
  | { ids: string[]; kind: 'price'; mode: 'set' | 'percent'; value: number };

export interface BulkDesignResult {
  designs: number;
  /** Variants whose reorder level or price was changed (0 for archive). */
  variants: number;
}

// ── Notes: calls, visits, follow-ups and promises to pay ────────────────────
export const NOTE_KINDS = ['note', 'call', 'visit', 'followup', 'promise'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const NOTE_KIND_LABEL: Record<NoteKind, string> = { note: 'Note', call: 'Call', visit: 'Visit', followup: 'Follow-up', promise: 'Promise to pay' };
export type NoteSubject = 'customer' | 'proforma' | 'invoice';

export interface NoteInput {
  subjectType: NoteSubject;
  subjectId: string;
  kind: NoteKind;
  body: string;
  /** A follow-up's day, or the day a customer promised to pay. */
  dueDate?: string | null;
  /** For a promise: how much they said they'd pay. */
  amountPaise?: Paise;
}
export interface Note {
  id: string;
  subjectType: NoteSubject;
  subjectId: string;
  kind: NoteKind;
  body: string;
  dueDate: string | null;
  amountPaise: Paise;
  /** When it was ticked off. Null while still open. */
  doneAt: string | null;
  createdAt: string;
}
/** An open follow-up or promise, with who it is about. */
export interface DueNote extends Note {
  customerId: string | null;
  customerName: string;
  /** The invoice or quote number; empty for a note on the customer. */
  subjectLabel: string;
}

// ── Accounts: where the money is ────────────────────────────────────────────
export interface AccountEntry {
  date: string;
  kind: 'receipt' | 'refund' | 'expense' | 'transfer-in' | 'transfer-out';
  party: string;
  detail: string;
  inPaise: Paise;
  outPaise: Paise;
  /** The account's balance after this line. */
  balancePaise: Paise;
}
export interface AccountBookAccount {
  /** Empty for the entries that were made before accounts were linked. */
  accountId: string;
  name: string;
  kind: PaymentAccountKind | null;
  openingPaise: Paise;
  inPaise: Paise;
  outPaise: Paise;
  closingPaise: Paise;
  entries: AccountEntry[];
}
export interface AccountBook {
  range: { from: string; to: string };
  accounts: AccountBookAccount[];
  totalClosingPaise: Paise;
}

export interface AccountTransferInput {
  fromAccountId: string;
  toAccountId: string;
  amountPaise: Paise;
  date: string;
  note: string;
}
export interface AccountTransfer extends AccountTransferInput {
  id: string;
}

/** Counting the cash drawer at the end of a day against what the books say should be in it. */
export interface DayClose {
  day: string;
  expectedPaise: Paise;
  /** Null until the day has been closed. */
  countedPaise: Paise | null;
  /** counted − expected. Negative means the drawer is short. */
  differencePaise: Paise | null;
  note: string;
  closedAt: string | null;
}

// ── Instalments ─────────────────────────────────────────────────────────────
export interface InstalmentInput {
  dueDate: string;
  amountPaise: Paise;
}
export interface Instalment extends InstalmentInput {
  id: string;
  position: number;
  /** How much of it the payments on the invoice cover, filling the instalments in date order. */
  paidPaise: Paise;
  status: 'paid' | 'upcoming' | 'overdue';
}
export interface DueInstalment extends Instalment {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string | null;
  customerName: string;
}

// ── Bank statement matching ─────────────────────────────────────────────────
export interface ReconcileProposal {
  row: number;
  date: string;
  description: string;
  creditPaise: Paise;
  paymentId: string | null;
  customerName: string;
  reason: 'reference' | 'date' | null;
}
export interface ReconcilePreview {
  proposals: ReconcileProposal[];
  problems: { row: number; message: string }[];
  skippedDebits: number;
  /** Payments still without a statement line. */
  unmatchedPayments: Payment[];
}

/** A purchase, plus any material whose price changed because of what was paid. */
export interface PurchaseResult extends Purchase {
  priceChanges: { materialId: string; materialName: string; fromPaise: Paise; toPaise: Paise }[];
}

// ── Activity log ────────────────────────────────────────────────────────────
export interface AuditEntry {
  id: string;
  /** When it was done (UTC timestamp). */
  at: string;
  /** The request that made the change, e.g. "invoiceCreate". */
  action: string;
  /** What it means in plain words, e.g. "Issued an invoice". */
  label: string;
  /** What kind of thing it touched (invoice, customer…), and which one. */
  entityType: string;
  entityId: string;
  summary: string;
}
export interface AuditQuery {
  search?: string;
  entityType?: string;
  from?: string;
  to?: string;
  limit?: number;
}

// ── Bills set aside to finish later ─────────────────────────────────────────
export interface HeldBill {
  id: string;
  name: string;
  kind: 'invoice' | 'proforma';
  /** The half-made bill as the New invoice screen saved it. */
  payload: unknown;
  createdAt: string;
}

// ── Notifications ───────────────────────────────────────────────────────────
export type NotificationKind =
  | AttentionKind
  | 'overdue-invoices'
  | 'low-stock'
  | 'cheque-due'
  | 'recurring-due'
  | 'bill-due'
  | 'budget'
  | 'instalment-due';
export type NotificationLink = AttentionItem['link'] | { to: 'path'; path: string };
export interface Notification {
  kind: NotificationKind;
  /** Stable, so a notification can be marked read and stay read. */
  id: string;
  /** urgent = money or stock is at risk now; soon = worth doing this week; info = nice to know. */
  severity: 'urgent' | 'soon' | 'info';
  title: string;
  detail: string;
  link: NotificationLink;
}
