import type { Paise } from './money';
import type { StockStatus } from './stock';

import type { InvoiceStatus } from './gst';

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
  /** Single GST rate applied to every invoice (not multi-slab). */
  gstRatePercent: number;
  /** True when the prices you enter already include GST, so the tax is carved out of them instead of added on top. */
  pricesIncludeGst: boolean;
  invoicePrefix: string;
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

/** What Data management shows: where the data lives and the backups that exist. */
export interface DataInfo {
  folder: string;
  databaseBytes: number;
  backups: { name: string; bytes: number; modifiedAt: string; manual: boolean }[];
}

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
}
export interface MaterialInput {
  name: string;
  unit: string;
  unitCostPaise: Paise;
}

// ── Designs & variants ──────────────────────────────────────────────────────
export interface BomLine {
  materialId: string;
  materialName: string;
  unit: string;
  qty: number;
  unitCostPaise: Paise;
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
  bom: { materialId: string; qty: number }[];
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
}
export interface Customer extends CustomerInput {
  id: string;
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
}

export interface PaymentQuery {
  search?: string;
  status?: 'all' | 'advance' | 'voided';
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
  kind: 'invoice' | 'invoice-cancelled' | 'payment' | 'payment-voided';
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
  receivedPaise: Paise;
  /** billed − received. Positive = owes, negative = advance credit. */
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
  amountPaise: Paise;
}

export interface InvoiceSummary {
  id: string;
  number: string;
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

export interface Invoice extends InvoiceSummary {
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
  discountPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  roundOffPaise: Paise;
  notes: string;
  lines: InvoiceLine[];
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
  lines: { variantId: string; qty: number; unitPricePaise: Paise }[];
  /** Money the customer hands over as the invoice is made — recorded in the same step as issuing it. */
  payment?: { amountPaise: Paise; method: PaymentMethod; reference: string };
  /** How much of the customer's held advance to put toward this invoice. */
  applyAdvancePaise?: Paise;
}

export interface InvoiceQuery {
  search?: string;
  type?: 'all' | InvoiceType;
  status?: 'all' | 'open' | 'overdue' | 'cancelled';
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
  color: string;
  size: string;
  sku: string;
  stock: number;
  sellPricePaise: Paise;
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
  /** Invoice totals (incl. GST) dated in the period, cancelled invoices excluded. */
  invoicedPaise: Paise;
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
}

export interface ExpenseInput {
  date: string;
  category: string;
  vendor: string;
  amountPaise: Paise;
  method: PaymentMethod;
  reference: string;
  note: string;
}

export interface ExpenseQuery {
  search?: string;
  category?: string;
  from?: string;
  to?: string;
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
export type ProformaStatus = 'open' | 'expired' | 'converted' | 'cancelled';

export const PROFORMA_STATUS_LABEL: Record<ProformaStatus, string> = { open: 'Open', expired: 'Expired', converted: 'Invoiced', cancelled: 'Cancelled' };

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
  /** The invoice this quote became, once converted. */
  invoiceId: string | null;
  invoiceNumber: string | null;
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
  discountPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  roundOffPaise: Paise;
  notes: string;
  lines: InvoiceLine[];
  cancelledAt: string | null;
  cancelReason: string;
  createdAt: string;
}

export interface ProformaInput {
  type: InvoiceType;
  customerId: string | null;
  buyerName?: string;
  issueDate: string;
  validUntil: string;
  discountPaise: Paise;
  notes: string;
  lines: { variantId: string; qty: number; unitPricePaise: Paise }[];
}

export interface ProformaQuery {
  search?: string;
  status?: 'all' | ProformaStatus;
  /** Only quotes dated on or after / on or before these days ("YYYY-MM-DD"). */
  from?: string;
  to?: string;
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
  /** GST charged on this month's invoices, by invoice date (when the tax falls due). Input credit isn't tracked yet. */
  gstPaise: Paise;
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

export type AttentionKind = 'payment-reversed' | 'quote-expiring' | 'below-cost';

/** Something on the dashboard's "needs attention" list. `link` says where to go to deal with it. */
export interface AttentionItem {
  kind: AttentionKind;
  /** Stable, so the list can be keyed. */
  id: string;
  title: string;
  detail: string;
  link: { to: 'customer' | 'proforma' | 'design'; id: string } | { to: 'payments' };
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
  kind: 'sale' | 'receipt' | 'expense';
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
