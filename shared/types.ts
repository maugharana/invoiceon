import type { Paise } from './money';
import type { StockStatus } from './stock';

import type { GstSlab, InvoiceStatus, RateGroup } from './gst';

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
  /** The shop's usual GST rate. A design can have its own, and price slabs can override this too (see resolveGstRate). */
  gstRatePercent: number;
  /** When on, a piece with no rate of its own is taxed by its price: e.g. 5% up to ₹2,500 and 18% above. */
  gstSlabsEnabled: boolean;
  gstSlabs: GstSlab[];
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
  // ── Sharing and paying ──
  /** Your UPI id (name@bank). When set, invoices show a QR code that opens a UPI app ready to pay the amount due. */
  upiId: string;
  /** Print the UPI QR code on invoices (only if a UPI id is set). */
  invoiceShowUpiQr: boolean;
  /** The message sent with an invoice, by WhatsApp or email. {placeholders} are filled in (see Settings, Sharing). */
  shareInvoiceMessage: string;
  /** The message for a payment reminder. */
  shareReminderMessage: string;
  shareEmailSubject: string;
  // ── Proforma invoices (a quote to pay against; no stock or tax effect) ──
  proformaPrefix: string;
  /** Prefix for credit note numbers, e.g. "CN" gives CN/2026-27/0001. */
  creditNotePrefix: string;
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
  /** `manual` is true for copies that are never cleaned up automatically (ones you made, and the safety copy taken before a restore). */
  backups: { name: string; bytes: number; modifiedAt: string; manual: boolean; kind: 'daily' | 'manual' | 'restore-point' }[];
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
  fabric: string;
  hsnCode: string;
  description: string;
  defaultPricePaise: Paise;
  /** This design's own GST rate, or null to use the shop's rate / price slabs. */
  gstRatePercent: number | null;
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
  fabric: string;
  hsnCode: string;
  description: string;
  defaultPricePaise: Paise;
  /** This design's own GST rate. Leave out (or null) to use the shop's rate / price slabs. */
  gstRatePercent?: number | null;
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
  /** 'credit_note' when the amount is a credit note set against this invoice rather than money received. */
  source?: 'receipt' | 'credit_note';
  creditNoteNumber?: string;
}

// ── Ledger & dues ───────────────────────────────────────────────────────────
export interface LedgerEntry {
  date: string;
  kind: 'invoice' | 'invoice-cancelled' | 'payment' | 'payment-voided' | 'credit-note' | 'credit-note-cancelled' | 'refund';
  description: string;
  invoiceId?: string;
  creditNoteId?: string;
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
  /** Pieces already sent back on credit notes. Absent on proformas. */
  creditedQty?: number;
  /** The GST rate this line was taxed at. Absent on invoices from before rates could differ by line: they use the invoice's own rate. */
  gstRatePercent?: number;
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
  /** The rate with the most value on the document. When rates differ, `taxSummary` has the whole picture. */
  gstRatePercent: number;
  /** Tax by rate. One row for most documents; one per rate when pieces are taxed differently. */
  taxSummary: RateGroup[];
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
  /** Payments currently applied to this invoice (credit notes set against it show here too, marked by `source`). */
  payments: InvoicePayment[];
  /** Of `paidPaise`, the part that is credit notes rather than money. */
  creditedPaise?: Paise;
  /** Your UPI id when the invoice should show a pay-by-UPI QR code (set in Settings, Sharing). Live, like branding: not frozen at issue. */
  payByUpi?: string | null;
  creditNotes?: { id: string; number: string; issueDate: string; totalPaise: Paise; status: CreditNoteStatus }[];
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
  hsn: string;
  color: string;
  size: string;
  sku: string;
  stock: number;
  sellPricePaise: Paise;
  /** The design's own GST rate, or null to use the shop's rate / slabs. */
  designGstRatePercent: number | null;
  /** The printed maximum retail price, GST included. 0 when not set. */
  mrpPaise: Paise;
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
  /** Credit notes dated in the period. The figures above are gross; these are what came back. */
  returns: ReturnsSummary;
  /** Invoiced less credit notes. */
  netInvoicedPaise: Paise;
  netGrossProfitPaise: Paise;
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
  hsn: { hsn: string; ratePercent: number; qty: number; taxablePaise: Paise; cgstPaise: Paise; sgstPaise: Paise; igstPaise: Paise; taxPaise: Paise }[];
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
  /** Credit notes dated in the period (cancelled ones left out). Everything above is gross of them. */
  creditNotes: GstTotals;
  /** The GSTR-1 credit and debit note register: one row per credit note and tax rate. */
  creditNoteRegister: {
    creditNoteId: string;
    number: string;
    date: string;
    invoiceNumber: string;
    invoiceDate: string;
    customer: string;
    gstin: string;
    type: InvoiceType;
    placeOfSupply: string;
    ratePercent: number;
    taxablePaise: Paise;
    cgstPaise: Paise;
    sgstPaise: Paise;
    igstPaise: Paise;
    totalPaise: Paise;
  }[];
  /** Invoices less credit notes: what is actually due to the government. */
  netTotals: GstTotals;
  /** GST paid to suppliers on purchase bills dated in the period that can be claimed back (bills marked as eligible, not cancelled). */
  inputCredit: { bills: number; taxablePaise: Paise; cgstPaise: Paise; sgstPaise: Paise; igstPaise: Paise; taxPaise: Paise };
  /** Output tax (net of credit notes) with input credit set off in the order the GST rules require. */
  liability: {
    outputTaxPaise: Paise;
    /** What is left to pay in cash, by head. */
    payable: { cgstPaise: Paise; sgstPaise: Paise; igstPaise: Paise; totalPaise: Paise };
    /** Credit left over after setting off, to carry into the next period. */
    carryForward: { cgstPaise: Paise; sgstPaise: Paise; igstPaise: Paise; totalPaise: Paise };
  };
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
  /** Your UPI id when the quote should show a pay-by-UPI QR code. Live, not frozen. */
  payByUpi?: string | null;
  seller: Party & { email: string; terms: string; bank: string; footer: string };
  branding: InvoiceBranding;
  buyer: Party;
  placeOfSupply: string;
  gstRatePercent: number;
  taxSummary: RateGroup[];
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

// ── Credit notes ────────────────────────────────────────────────────────────
export type CreditNoteKind = 'return' | 'adjustment';
export type CreditNoteStatus = 'issued' | 'cancelled';

export const CREDIT_NOTE_KIND_LABEL: Record<CreditNoteKind, string> = { return: 'Sales return', adjustment: 'Price adjustment' };

export interface CreditNoteLine {
  id: string;
  invoiceLineId: string | null;
  variantId: string | null;
  designName: string;
  color: string;
  size: string;
  sku: string;
  hsn: string;
  qty: number;
  unitPricePaise: Paise;
  /** qty times price, before any discount on the invoice. */
  amountPaise: Paise;
  /** What is credited before tax: the amount less this line's share of the invoice's discount. */
  taxablePaise: Paise;
  gstRatePercent: number;
  /** Whether the pieces went back on the shelf. */
  restock: boolean;
}

export interface CreditNoteSummary {
  id: string;
  number: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string | null;
  buyerName: string;
  issueDate: string;
  kind: CreditNoteKind;
  totalPaise: Paise;
  /** Of the total, what was handed back as a refund. */
  refundPaise: Paise;
  status: CreditNoteStatus;
  reason: string;
}

export interface CreditNote extends CreditNoteSummary {
  invoiceDate: string;
  invoiceType: InvoiceType;
  seller: Party & { email: string; terms: string; bank: string; footer: string };
  branding: InvoiceBranding;
  buyer: Party;
  placeOfSupply: string;
  intraState: boolean;
  gstRatePercent: number;
  taxSummary: RateGroup[];
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  roundOffPaise: Paise;
  notes: string;
  refundMethod: PaymentMethod | null;
  refundReference: string;
  /** How much of the credit went against what the customer still owed on the invoice. */
  appliedToInvoicePaise: Paise;
  /** What is left over: held as the customer's credit, ready for their next invoice. */
  heldAsCreditPaise: Paise;
  lines: CreditNoteLine[];
  cancelledAt: string | null;
  cancelReason: string;
  createdAt: string;
}

export interface CreditNoteInput {
  invoiceId: string;
  issueDate: string;
  kind: CreditNoteKind;
  reason: string;
  notes: string;
  /** For a sales return: which invoice lines come back, how many, and whether they go back on the shelf. */
  lines?: { invoiceLineId: string; qty: number; restock: boolean }[];
  /** For a price adjustment: the amount to credit before tax, and the tax rate when the invoice has more than one. */
  adjustment?: { taxablePaise: Paise; ratePercent?: number };
  /** Money paid back to the customer now. The rest of the credit goes against the invoice, then stays with the customer. */
  refund?: { amountPaise: Paise; method: PaymentMethod; reference: string };
}

export interface CreditNoteQuery {
  search?: string;
  customerId?: string;
  invoiceId?: string;
}

/** Returns and credit notes in a period, shown beside the sales figures. */
export interface ReturnsSummary {
  count: number;
  taxablePaise: Paise;
  gstPaise: Paise;
  totalPaise: Paise;
  refundedPaise: Paise;
  piecesReturned: number;
  /** Taxable value credited less the cost of the pieces that went back on the shelf. */
  profitLostPaise: Paise;
}

// ── Suppliers and purchase bills ────────────────────────────────────────────
export interface SupplierInput {
  name: string;
  gstin: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  notes: string;
}
export interface Supplier extends SupplierInput {
  id: string;
  billCount: number;
  billedPaise: Paise;
  /** What you still owe them on bills. */
  outstandingPaise: Paise;
  /** Money you have paid them that is not on any bill yet. */
  advancePaise: Paise;
}

export type BillLineKind = 'material' | 'variant' | 'other';
export const BILL_LINE_KIND_LABEL: Record<BillLineKind, string> = { material: 'Raw material', variant: 'Finished saree', other: 'Other' };

export interface BillLineInput {
  kind: BillLineKind;
  /** For a raw material line. */
  materialId?: string;
  /** For a finished saree line: the pieces come into stock. */
  variantId?: string;
  /** For an "other" line (freight, packing...); also a note on the others. */
  description?: string;
  hsn?: string;
  /** Whole pieces for a saree; metres, kilos and so on for a material. */
  qty: number;
  /** Before GST. */
  unitPricePaise: Paise;
  gstRatePercent: number;
}

export interface PurchaseBillInput {
  supplierId: string;
  /** The supplier's own bill or invoice number. */
  billNumber: string;
  billDate: string;
  dueDate: string | null;
  /** Whether the GST on this bill can be claimed as input credit. Defaults to yes when the supplier has a GSTIN. */
  itcEligible?: boolean;
  /** The total printed on the supplier's bill, if it differs from the lines by a few rupees of rounding. */
  billTotalPaise?: Paise;
  /** Set each material's cost, and each saree's cost, to this bill's price. */
  updateCosts?: boolean;
  notes: string;
  lines: BillLineInput[];
  /** Money you hand over as the bill is entered. */
  paidNow?: { amountPaise: Paise; method: PaymentMethod; reference: string };
  /** How much of the advance you hold with this supplier to put toward the bill. */
  applyAdvancePaise?: Paise;
}

export interface BillLine {
  id: string;
  kind: BillLineKind;
  materialId: string | null;
  variantId: string | null;
  description: string;
  hsn: string;
  qty: number;
  unit: string;
  unitPricePaise: Paise;
  amountPaise: Paise;
  gstRatePercent: number;
}

export interface BillPayment {
  paymentId: string;
  paidOn: string;
  method: PaymentMethod;
  reference: string;
  amountPaise: Paise;
}

export interface PurchaseBillSummary {
  id: string;
  supplierId: string;
  supplierName: string;
  billNumber: string;
  billDate: string;
  dueDate: string | null;
  totalPaise: Paise;
  paidPaise: Paise;
  /** Same words as an invoice: unpaid, partly paid, paid, overdue, cancelled. */
  status: InvoiceStatus;
  itcEligible: boolean;
}

export interface PurchaseBill extends PurchaseBillSummary {
  supplier: Party;
  placeOfSupply: string;
  intraState: boolean;
  taxSummary: RateGroup[];
  subtotalPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  roundOffPaise: Paise;
  notes: string;
  lines: BillLine[];
  payments: BillPayment[];
  cancelledAt: string | null;
  cancelReason: string;
  createdAt: string;
}

export interface PurchaseBillQuery {
  search?: string;
  status?: 'all' | 'open' | 'overdue' | 'cancelled';
  supplierId?: string;
}

export interface SupplierPaymentInput {
  supplierId: string;
  amountPaise: Paise;
  method: PaymentMethod;
  reference: string;
  paidOn: string;
  note: string;
  /** How much of the payment settles which bill. What is left over is held as an advance with the supplier. */
  allocations: { billId: string; amountPaise: Paise }[];
}

export interface SupplierPayment {
  id: string;
  supplierId: string;
  supplierName: string;
  amountPaise: Paise;
  method: PaymentMethod;
  reference: string;
  paidOn: string;
  note: string;
  allocations: { billId: string; billNumber: string; amountPaise: Paise }[];
  appliedPaise: Paise;
  advancePaise: Paise;
  voided: boolean;
  voidReason: string;
}

export interface SupplierLedgerEntry {
  date: string;
  kind: 'bill' | 'bill-cancelled' | 'payment' | 'payment-voided';
  description: string;
  billId?: string;
  /** Adds to what you owe. */
  billedPaise: Paise;
  /** Reduces what you owe. */
  paidPaise: Paise;
  /** Running balance. Positive = you owe them; negative = they hold your advance. */
  balancePaise: Paise;
}

export interface SupplierLedger {
  supplier: Supplier;
  entries: SupplierLedgerEntry[];
  billedPaise: Paise;
  paidPaise: Paise;
  balancePaise: Paise;
}

export interface PayablesRow extends DuesBuckets {
  supplierId: string;
  supplierName: string;
  phone: string;
  openBills: number;
  outstandingPaise: Paise;
  overduePaise: Paise;
  oldestDueDate: string | null;
  advancePaise: Paise;
}

export interface PayablesReport extends DuesBuckets {
  rows: PayablesRow[];
  outstandingPaise: Paise;
  overduePaise: Paise;
  advancePaidPaise: Paise;
}

export interface PurchasesSummary {
  outstandingPaise: Paise;
  overduePaise: Paise;
  openBills: number;
  monthBilledPaise: Paise;
  monthBills: number;
  supplierCount: number;
}

// ── Weavers and job work ────────────────────────────────────────────────────
export interface WeaverInput {
  name: string;
  phone: string;
  /** Village, town or workshop. */
  place: string;
  notes: string;
}
export interface Weaver extends WeaverInput {
  id: string;
  openOrders: number;
  /** Pieces still to come back across their open orders. */
  piecesPending: number;
  /** Wages earned on pieces received. */
  earnedPaise: Paise;
  paidPaise: Paise;
  /** Positive: you owe them. Negative: you have paid ahead (an advance). */
  balancePaise: Paise;
}

/** 'complete' and 'overdue' are worked out from the pieces received and the expected date; they are never stored. */
export type JobOrderStatus = 'open' | 'complete' | 'closed' | 'cancelled';
export const JOB_ORDER_STATUS_LABEL: Record<JobOrderStatus, string> = { open: 'In progress', complete: 'Received', closed: 'Closed short', cancelled: 'Cancelled' };

export interface JobOrderInput {
  weaverId: string;
  variantId: string;
  qty: number;
  /** What you pay the weaver for each piece. */
  wagePaise: Paise;
  expectedOn: string | null;
  note: string;
}

export interface JobOrderSummary {
  id: string;
  number: string;
  weaverId: string;
  weaverName: string;
  variantId: string;
  designName: string;
  color: string;
  size: string;
  sku: string;
  qty: number;
  receivedQty: number;
  wagePaise: Paise;
  orderedOn: string;
  expectedOn: string | null;
  status: JobOrderStatus;
  /** Still open, not all received, and past the expected date. */
  overdue: boolean;
}

export interface JobMaterial {
  id: string;
  materialId: string;
  materialName: string;
  unit: string;
  /** Positive: handed to the weaver. Negative: handed back. */
  qty: number;
  unitCostPaise: Paise;
  issuedOn: string;
  note: string;
}

export interface JobReceipt {
  id: string;
  qty: number;
  receivedOn: string;
  note: string;
  reversed: boolean;
  reverseReason: string;
}

export interface JobOrder extends JobOrderSummary {
  note: string;
  materials: JobMaterial[];
  receipts: JobReceipt[];
  /** What the raw material handed over is worth, at the cost when it was issued. */
  materialsValuePaise: Paise;
  /** Wages earned so far: pieces received times the wage. */
  earnedPaise: Paise;
  /** Wage plus the raw material per piece ordered: what each piece really costs you. */
  realCostPerPiecePaise: Paise;
  closedAt: string | null;
  closeReason: string;
}

export interface JobMaterialInput {
  orderId: string;
  materialId: string;
  /** Positive to hand over, negative to record material handed back. */
  qty: number;
  issuedOn: string;
  note: string;
}

export interface JobReceiptInput {
  orderId: string;
  qty: number;
  receivedOn: string;
  note: string;
  /** Set the design's cost to what these pieces really cost (wage plus material). */
  updateCost?: boolean;
}

export interface JobOrderQuery {
  weaverId?: string;
  status?: 'all' | 'open' | 'overdue' | 'done';
}

export interface WeaverPaymentInput {
  weaverId: string;
  /** Optional: which order this is for, just as a note on the payment. */
  orderId?: string | null;
  amountPaise: Paise;
  method: PaymentMethod;
  reference: string;
  paidOn: string;
  note: string;
}

export interface WeaverPayment {
  id: string;
  weaverId: string;
  weaverName: string;
  orderId: string | null;
  orderNumber: string | null;
  amountPaise: Paise;
  method: PaymentMethod;
  reference: string;
  paidOn: string;
  note: string;
  voided: boolean;
  voidReason: string;
}

export interface WeaverLedgerEntry {
  date: string;
  kind: 'received' | 'received-reversed' | 'payment' | 'payment-voided';
  description: string;
  orderId?: string;
  /** Wages earned. */
  earnedPaise: Paise;
  paidPaise: Paise;
  /** Positive: you owe them. Negative: you have paid ahead. */
  balancePaise: Paise;
}

export interface WeaverLedger {
  weaver: Weaver;
  entries: WeaverLedgerEntry[];
}
