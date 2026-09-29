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
  invoicePrefix: string;
  /** Days until a B2B invoice falls due. B2C is due on the day. */
  defaultDueDays: number;
  /** Prefilled reorder level for new variants. */
  defaultReorderLevel: number;
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
  seller: Party & { email: string; terms: string; bank: string; footer: string };
  branding: InvoiceBranding;
  buyer: Party;
  placeOfSupply: string;
  gstRatePercent: number;
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
  seller: Party & { email: string; terms: string; bank: string; footer: string };
  branding: InvoiceBranding;
  buyer: Party;
  placeOfSupply: string;
  gstRatePercent: number;
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
}

// ── Dashboard ───────────────────────────────────────────────────────────────
export interface TrendPoint {
  /** 'YYYY-MM-DD' (a day, or the Monday that starts a week) or 'YYYY-MM' (a month). */
  key: string;
  invoicedPaise: Paise;
  receivedPaise: Paise;
  expensesPaise: Paise;
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
  /** Of the period's invoices, what is still owed. */
  outstandingPaise: Paise;
  openInvoices: number;
  overduePaise: Paise;
  overdueCount: number;
  expensesPaise: Paise;
  /** Average days between issuing an invoice and its final payment, over invoices paid in full. Null if none yet. */
  avgPaymentDays: number | null;
  paidInvoiceCount: number;
  /** The same figures for the period just before, for "vs previous" arrows. Null for all time. */
  previous: { invoicedPaise: Paise; receivedPaise: Paise; expensesPaise: Paise } | null;
  granularity: 'day' | 'week' | 'month';
  trend: TrendPoint[];
  /** Everything owed today, by how old the invoice is (days since it was issued). Not limited to the period. */
  aging: { label: string; paise: Paise; count: number }[];
  topClients: { customerId: string | null; name: string; invoicedPaise: Paise }[];
  expensesByCategory: { category: string; paise: Paise }[];
  recent: InvoiceSummary[];
}
