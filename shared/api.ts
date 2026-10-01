import type {
  BulkAddResult,
  BulkSareeRow,
  Customer,
  CustomerInput,
  CustomerPurchase,
  DashboardNow,
  DayBook,
  DayBookMode,
  MarginBy,
  MarginLine,
  MarginReport,
  MoversReport,
  ProfitAndLoss,
  StockMovementReport,
  DashboardOverview,
  DashboardSummary,
  FestivalComparison,
  ReorderRow,
  DataInfo,
  Expense,
  ExpenseInput,
  ExpenseQuery,
  ExpensesBreakdown,
  ExpensesOverview,
  Proforma,
  ProformaInput,
  ProformaQuery,
  ProformaSummary,
  DuesReport,
  Invoice,
  Ledger,
  Payment,
  PaymentInput,
  PaymentQuery,
  PaymentsSummary,
  GstReport,
  SalesReport,
  StockReport,
  InvoiceInput,
  InvoiceQuery,
  InvoiceSummary,
  SaleVariant,
  DesignDetail,
  DesignInput,
  DesignQuery,
  DesignSummary,
  InventorySummary,
  Material,
  MaterialInput,
  Settings,
  StockAdjustInput,
  StockMovement,
  Variant,
  VariantInput,
} from './types';
import type { CompareWith } from './periods';

/**
 * The contract between the UI and the data layer. Implemented in electron/api.ts, exposed to the
 * renderer over IPC (desktop) or HTTP (browser dev mode). Every call resolves or rejects with a
 * plain Error whose message is safe to show the user.
 */
export interface Api {
  getSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<Settings>;

  inventorySummary(): Promise<InventorySummary>;

  designsList(query?: DesignQuery): Promise<DesignSummary[]>;
  designGet(id: string): Promise<DesignDetail>;
  designNextCode(): Promise<string>;
  designCreate(input: DesignInput): Promise<DesignDetail>;
  designUpdate(id: string, input: DesignInput): Promise<DesignDetail>;
  designArchive(id: string): Promise<void>;
  /** A new design copied from this one: same details, and a copy of each variant with its price and raw-material costing, but no stock. */
  designDuplicate(id: string): Promise<DesignDetail>;

  /** Adds many sarees at once. All or nothing: if any row has a problem, none are added and the problems come back per row. */
  inventoryBulkAdd(rows: BulkSareeRow[]): Promise<BulkAddResult>;
  variantCreate(designId: string, input: VariantInput): Promise<Variant>;
  variantUpdate(id: string, input: VariantInput): Promise<Variant>;
  variantArchive(id: string): Promise<void>;

  stockAdjust(input: StockAdjustInput): Promise<Variant>;
  stockMovements(variantId: string): Promise<StockMovement[]>;

  materialsList(): Promise<Material[]>;
  materialCreate(input: MaterialInput): Promise<Material>;
  materialUpdate(id: string, input: MaterialInput): Promise<Material>;
  materialDelete(id: string): Promise<void>;

  customersList(query?: { search?: string }): Promise<Customer[]>;
  customerGet(id: string): Promise<Customer>;
  customerCreate(input: CustomerInput): Promise<Customer>;
  customerUpdate(id: string, input: CustomerInput): Promise<Customer>;
  /** Archives; invoices already issued keep their own copy of the customer's details. */
  customerArchive(id: string): Promise<void>;
  /** What this customer has bought, by design, most recent first. */
  customerPurchases(id: string): Promise<CustomerPurchase[]>;
  /** Folds a duplicate into the customer you keep: their invoices, payments and quotes move across, blank details are filled in, and the duplicate is archived. */
  customerMerge(keepId: string, duplicateId: string): Promise<Customer>;

  variantsForSale(): Promise<SaleVariant[]>;

  invoicesList(query?: InvoiceQuery): Promise<InvoiceSummary[]>;
  invoiceGet(id: string): Promise<Invoice>;
  /** The number the next invoice issued on this date will get. */
  invoiceNextNumber(issueDate: string): Promise<string>;
  /** Issues the invoice and takes the stock out, atomically. */
  invoiceCreate(input: InvoiceInput): Promise<Invoice>;
  /** Cancels an issued invoice and puts its stock back. The number is never reused. */
  invoiceCancel(id: string, reason: string): Promise<Invoice>;
  /** Desktop app only: asks where to save, then writes the invoice as a PDF. */
  invoiceExportPdf(id: string): Promise<{ saved: boolean; path?: string }>;
  /** Desktop app only: opens the system print dialog for the invoice. */
  invoicePrint(id: string): Promise<void>;

  paymentsList(query?: PaymentQuery): Promise<Payment[]>;
  /** Records money received. Each part goes to the invoices named in `allocations`; any remainder is held as the customer's advance. */
  paymentRecord(input: PaymentInput): Promise<Payment>;
  /** Reverses a payment (a mistake, or a refund). Invoices it paid become due again. */
  paymentVoid(id: string, reason: string): Promise<Payment>;
  /** Puts a customer's held advance toward one of their open invoices. Returns the invoice as it stands afterwards. */
  invoiceApplyAdvance(invoiceId: string): Promise<Invoice>;
  paymentsSummary(): Promise<PaymentsSummary>;

  customerLedger(customerId: string): Promise<Ledger>;
  /** Who owes what, aged by how long past due. */
  duesReport(): Promise<DuesReport>;

  /** Sales for a date range: invoiced (by invoice date) alongside collected (by payment date). */
  reportSales(range: { from: string; to: string }): Promise<SalesReport>;
  /** GST collected on invoices dated in the range, split B2B/B2C, by HSN, and as a GSTR-1-style register. */
  reportGst(range: { from: string; to: string }): Promise<GstReport>;
  /** Stock on hand, valued at cost and at selling price, as of a date (default today). */
  reportStock(asOf?: string): Promise<StockReport>;
  /** Sales less cost of goods less expenses for a date range, with the same dates last year beside it. */
  reportProfitLoss(range: { from: string; to: string }): Promise<ProfitAndLoss>;
  /** Sales, cost and profit grouped by design, colour or customer. */
  reportMargin(range: { from: string; to: string }, by: MarginBy): Promise<MarginReport>;
  /** The invoice lines behind one row of the margin report. */
  reportMarginDrill(range: { from: string; to: string }, by: MarginBy, key: string): Promise<MarginLine[]>;
  /** Stock in and out by design between two dates. */
  reportMovement(range: { from: string; to: string }): Promise<StockMovementReport>;
  /** Fast sellers and stock that isn't moving, over the last `days` days (default 90). */
  reportMovers(days?: number): Promise<MoversReport>;
  /** The day book, cash book or bank book for a date range. */
  reportDayBook(range: { from: string; to: string }, mode: DayBookMode): Promise<DayBook>;
  /** Saves text (a CSV) to a file the user chooses. Desktop app only. */
  exportSave(fileName: string, content: string): Promise<{ saved: boolean; path?: string }>;

  dashboardSummary(): Promise<DashboardSummary>;
  /** Everything the dashboard shows for a period. Null means all time. */
  dashboardOverview(range: { from: string; to: string } | null, compare?: CompareWith): Promise<DashboardOverview>;
  /** Today's figures and other "right now" items, which don't depend on the dashboard's period. */
  dashboardNow(): Promise<DashboardNow>;
  /** Every variant that is low on stock or out of it, by saree: what to reorder. */
  dashboardReorderList(): Promise<ReorderRow[]>;
  /** This year's festival shopping season against last year's ('diwali', 'navratri' or 'rakhi'). */
  dashboardFestival(festivalId: string): Promise<FestivalComparison>;

  expensesList(query?: ExpenseQuery): Promise<Expense[]>;
  expensesOverview(query?: ExpenseQuery): Promise<ExpensesOverview>;
  /** Spending by category and month, and against the stretch just before. */
  expensesBreakdown(query?: ExpenseQuery): Promise<ExpensesBreakdown>;
  expenseCreate(input: ExpenseInput): Promise<Expense>;
  expenseUpdate(id: string, input: ExpenseInput): Promise<Expense>;
  expenseDelete(id: string): Promise<void>;

  proformasList(query?: ProformaQuery): Promise<ProformaSummary[]>;
  proformaGet(id: string): Promise<Proforma>;
  proformaNextNumber(issueDate: string): Promise<string>;
  proformaCreate(input: ProformaInput): Promise<Proforma>;
  /** Changes a quote that hasn't been invoiced or cancelled. It keeps its number. */
  proformaUpdate(id: string, input: ProformaInput): Promise<Proforma>;
  proformaCancel(id: string, reason: string): Promise<Proforma>;
  /** Turns the quote into an invoice dated today, taking the stock off the shelves. */
  proformaConvert(id: string): Promise<Invoice>;
  proformaExportPdf(id: string): Promise<{ saved: boolean; path?: string }>;
  proformaPrint(id: string): Promise<void>;

  /** Fills an empty database with realistic saree designs so the app can be explored. */
  sampleDataLoad(): Promise<void>;

  /** Where the data lives and which backups exist. */
  dataInfo(): Promise<DataInfo>;
  /** Writes a snapshot of the whole database next to the automatic daily ones. */
  backupNow(): Promise<{ name: string }>;
}

export type ApiMethod = keyof Api;

export type Envelope<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
