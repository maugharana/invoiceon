import type { AccessStatus, AccessUser, AccessUserInput } from './access';
import type { CatalogueData, DesignPhoto, DesignPhotoInput } from './catalogue';
import type { FilingFile, FilingRequest } from './filing';
import type { MobileStatus } from './mobile';
import type { HoldingRow, Location, TransferInput, TransferRecord } from './locations';
import type { StockTake, StockTakeResult, StockTakeStart, StockTakeSummary } from './stocktake';
import type { InsightParams, StockInsights } from './insights';
import type { ContactChannel, Contact, CustomerFollowUps, FollowUp, PaymentPromise, PromiseInput } from './followup';
import type { LoyaltyAccount, LoyaltyConfig, Offer, OfferInput } from './offers';
import type { OffsiteSetup, OffsiteStatus } from './offsite';
import type {
  AuditEntry,
  AuditQuery,
  IntegrityReport,
  BulkAddResult,
  JobMaterialInput,
  JobOrder,
  JobOrderInput,
  JobOrderQuery,
  JobOrderSummary,
  JobReceiptInput,
  Weaver,
  WeaverInput,
  WeaverLedger,
  WeaverPayment,
  WeaverPaymentInput,
  PayablesReport,
  PurchaseBill,
  PurchaseBillInput,
  PurchaseBillQuery,
  PurchaseBillSummary,
  PurchasesSummary,
  Supplier,
  SupplierInput,
  SupplierLedger,
  SupplierPayment,
  SupplierPaymentInput,
  CreditNote,
  CreditNoteInput,
  CreditNoteQuery,
  CreditNoteSummary,
  BulkSareeRow,
  Customer,
  CustomerInput,
  DashboardOverview,
  DashboardSummary,
  DataInfo,
  Expense,
  ExpenseInput,
  ExpenseQuery,
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

  creditNotesList(query?: CreditNoteQuery): Promise<CreditNoteSummary[]>;
  creditNoteGet(id: string): Promise<CreditNote>;
  /** The number the next credit note issued on this date will get. */
  creditNoteNextNumber(issueDate: string): Promise<string>;
  /** Issues a credit note against an invoice: returned pieces go back on the shelf and the money is set against what the customer owes. */
  creditNoteCreate(input: CreditNoteInput): Promise<CreditNote>;
  /** Undoes a credit note that was a mistake. It stays on record. */
  creditNoteCancel(id: string, reason: string): Promise<CreditNote>;
  creditNoteExportPdf(id: string): Promise<{ saved: boolean; path?: string }>;
  creditNotePrint(id: string): Promise<void>;

  /** Desktop app only: prints saree labels. `query` is what encodeLabelRequest makes. */
  labelsPrint(query: string): Promise<void>;
  /** Desktop app only: asks where to save, then writes the labels as a PDF. */
  labelsExportPdf(query: string): Promise<{ saved: boolean; path?: string }>;

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
  /** A JSON file for the GST portals (GSTR-1, e-invoice or e-way bill). Nothing is sent anywhere. */
  gstFilingExport(req: FilingRequest): Promise<FilingFile>;
  /** Stock on hand, valued at cost and at selling price, as of a date (default today). */
  reportStock(asOf?: string): Promise<StockReport>;
  /** Saves text (a CSV) to a file the user chooses. Desktop app only. */
  exportSave(fileName: string, content: string): Promise<{ saved: boolean; path?: string }>;
  /** Off-site copies: the database kept in a folder of your choice (a synced cloud folder, a USB drive), optionally encrypted. */
  offsiteStatus(): Promise<OffsiteStatus>;
  offsiteSave(setup: OffsiteSetup): Promise<OffsiteStatus>;
  offsiteDisable(): Promise<OffsiteStatus>;
  offsiteCopyNow(): Promise<OffsiteStatus>;
  offsiteRestore(name: string, passphrase?: string): Promise<{ restoredFrom: string; restorePoint: string }>;
  /** The desktop app's folder chooser. */
  offsiteChooseFolder(): Promise<{ folder: string | null }>;
  /** Other places stock is kept (a godown, a stall), and moving pieces between them and the shop. */
  locationsList(): Promise<Location[]>;
  locationSave(id: string | null, name: string): Promise<Location>;
  locationArchive(id: string): Promise<void>;
  stockTransfer(input: TransferInput): Promise<TransferRecord>;
  transfersList(limit?: number): Promise<TransferRecord[]>;
  stockHoldings(): Promise<HoldingRow[]>;
  /** A physical stock take: count the shelves, compare with the books, apply the differences. */
  stockTakeCurrent(): Promise<StockTake | null>;
  stockTakeStart(input: StockTakeStart): Promise<StockTake>;
  stockTakeCount(takeId: string, variantId: string, counted: number | null): Promise<StockTake>;
  stockTakeApply(takeId: string): Promise<StockTakeResult>;
  stockTakeCancel(takeId: string): Promise<void>;
  stockTakesList(): Promise<StockTakeSummary[]>;
  /** What to make or buy next, and what has stopped selling. Read only; shows costs, so it is a reports call. */
  stockInsights(params?: Partial<InsightParams>): Promise<StockInsights>;
  /** Chasing money: who was reminded or called, and promises to pay. */
  followUps(): Promise<FollowUp[]>;
  customerFollowUps(customerId: string): Promise<CustomerFollowUps>;
  contactLog(customerId: string, channel: ContactChannel, note: string): Promise<Contact>;
  promiseCreate(customerId: string, input: PromiseInput): Promise<PaymentPromise>;
  promiseCancel(id: string): Promise<void>;
  /** Offers (named discounts with rules) and loyalty points. */
  offersList(): Promise<Offer[]>;
  offerSave(id: string | null, input: OfferInput): Promise<Offer>;
  offerArchive(id: string): Promise<void>;
  loyaltyConfig(): Promise<LoyaltyConfig>;
  loyaltySave(config: LoyaltyConfig): Promise<LoyaltyConfig>;
  loyaltyAccount(customerId: string): Promise<LoyaltyAccount>;
  loyaltyAdjust(customerId: string, points: number, note: string): Promise<LoyaltyAccount>;
  /** Photos of a design (the first is the cover), and the small covers of every design for the lists. */
  designPhotos(designId: string): Promise<DesignPhoto[]>;
  designPhotoAdd(designId: string, input: DesignPhotoInput): Promise<DesignPhoto[]>;
  designPhotoRemove(photoId: string): Promise<void>;
  designPhotoCover(photoId: string): Promise<void>;
  designCovers(): Promise<Record<string, string>>;
  /** What the catalogue page prints. `query` is what encodeCatalogueRequest makes. */
  catalogueData(query: string): Promise<CatalogueData>;
  /** Desktop app only: prints the catalogue, or asks where to save it as a PDF. */
  cataloguePrint(query: string): Promise<void>;
  catalogueExportPdf(query: string): Promise<{ saved: boolean; path?: string }>;
  /** The read only phone view served on the shop's Wi-Fi. Off until switched on. */
  mobileStatus(): Promise<MobileStatus>;
  mobileEnable(): Promise<MobileStatus>;
  mobileDisable(): Promise<MobileStatus>;
  /** A new secret link; phones with the old one stop working. */
  mobileResetLink(): Promise<MobileStatus>;

  dashboardSummary(): Promise<DashboardSummary>;
  /** Everything the dashboard shows for a period. Null means all time. */
  dashboardOverview(range: { from: string; to: string } | null): Promise<DashboardOverview>;

  expensesList(query?: ExpenseQuery): Promise<Expense[]>;
  expensesOverview(query?: ExpenseQuery): Promise<ExpensesOverview>;
  expenseCreate(input: ExpenseInput): Promise<Expense>;
  expenseUpdate(id: string, input: ExpenseInput): Promise<Expense>;
  expenseDelete(id: string): Promise<void>;

  proformasList(query?: ProformaQuery): Promise<ProformaSummary[]>;
  proformaGet(id: string): Promise<Proforma>;
  proformaNextNumber(issueDate: string): Promise<string>;
  proformaCreate(input: ProformaInput): Promise<Proforma>;
  proformaCancel(id: string, reason: string): Promise<Proforma>;
  /** Turns the quote into an invoice dated today, taking the stock off the shelves. */
  proformaConvert(id: string): Promise<Invoice>;
  proformaExportPdf(id: string): Promise<{ saved: boolean; path?: string }>;
  proformaPrint(id: string): Promise<void>;

  suppliersList(query?: { search?: string }): Promise<Supplier[]>;
  supplierGet(id: string): Promise<Supplier>;
  supplierCreate(input: SupplierInput): Promise<Supplier>;
  supplierUpdate(id: string, input: SupplierInput): Promise<Supplier>;
  /** Archives; bills already entered keep their own copy of the supplier's details. */
  supplierArchive(id: string): Promise<void>;
  /** A running statement with the supplier: bills add to what you owe, payments reduce it. */
  supplierLedger(id: string): Promise<SupplierLedger>;

  purchaseBillsList(query?: PurchaseBillQuery): Promise<PurchaseBillSummary[]>;
  purchaseBillGet(id: string): Promise<PurchaseBill>;
  /** Enters a supplier's bill: sarees on it come into stock, and you can say what you paid or set an advance against it. */
  purchaseBillCreate(input: PurchaseBillInput): Promise<PurchaseBill>;
  /** Cancels a mistaken bill. Stock it brought in goes out again; money paid against it becomes an advance with the supplier. */
  purchaseBillCancel(id: string, reason: string): Promise<PurchaseBill>;
  /** Puts the advance you hold with the supplier toward one of their open bills. */
  purchaseBillApplyAdvance(billId: string): Promise<PurchaseBill>;
  supplierPaymentsList(query?: { supplierId?: string }): Promise<SupplierPayment[]>;
  supplierPaymentRecord(input: SupplierPaymentInput): Promise<SupplierPayment>;
  supplierPaymentVoid(id: string, reason: string): Promise<SupplierPayment>;
  /** What you owe, to whom, aged by how far past due. */
  payablesReport(): Promise<PayablesReport>;
  purchasesSummary(): Promise<PurchasesSummary>;

  weaversList(query?: { search?: string }): Promise<Weaver[]>;
  weaverGet(id: string): Promise<Weaver>;
  weaverCreate(input: WeaverInput): Promise<Weaver>;
  weaverUpdate(id: string, input: WeaverInput): Promise<Weaver>;
  weaverArchive(id: string): Promise<void>;
  /** Wages earned on pieces received, less what you paid, as a running statement. */
  weaverLedger(id: string): Promise<WeaverLedger>;
  jobOrdersList(query?: JobOrderQuery): Promise<JobOrderSummary[]>;
  jobOrderGet(id: string): Promise<JobOrder>;
  /** Asks a weaver for some pieces of a design at a wage per piece. */
  jobOrderCreate(input: JobOrderInput): Promise<JobOrder>;
  /** Records raw material handed to the weaver for an order (a minus quantity is material handed back). */
  jobOrderIssueMaterial(input: JobMaterialInput): Promise<JobOrder>;
  /** Pieces come back: they go into stock and their wage becomes owed. */
  jobOrderReceive(input: JobReceiptInput): Promise<JobOrder>;
  jobOrderReverseReceipt(receiptId: string, reason: string): Promise<JobOrder>;
  /** Stops waiting for the rest of an order. What was received stays. */
  jobOrderClose(id: string, reason: string): Promise<JobOrder>;
  jobOrderCancel(id: string, reason: string): Promise<JobOrder>;
  weaverPaymentsList(query?: { weaverId?: string }): Promise<WeaverPayment[]>;
  weaverPaymentRecord(input: WeaverPaymentInput): Promise<WeaverPayment>;
  weaverPaymentVoid(id: string, reason: string): Promise<WeaverPayment>;

  /** Whether sign-in is on and who is signed in. Works even when the app is locked. */
  accessStatus(): Promise<AccessStatus>;
  accessLogin(userId: string, pin: string): Promise<AccessStatus>;
  accessLogout(): Promise<AccessStatus>;
  /** Turns on sign-in with PINs. The first person is the owner and is signed in straight away. */
  accessEnable(ownerName: string, pin: string): Promise<AccessStatus>;
  /** Turns sign-in off again. Needs the signed in owner's PIN. */
  accessDisable(pin: string): Promise<AccessStatus>;
  accessUsers(): Promise<AccessUser[]>;
  /** Adds someone (id null) or edits them. A PIN is required for a new person; leave it out when editing to keep theirs. */
  accessUserSave(id: string | null, input: AccessUserInput): Promise<AccessUser>;
  accessChangePin(oldPin: string, newPin: string): Promise<void>;

  /** The activity log: who did what and when, newest first. */
  auditList(query?: AuditQuery): Promise<AuditEntry[]>;
  /** Checks the books add up: stock against its ledger, invoice arithmetic, payments, balances, numbering, credit notes, and the log's own chain. */
  integrityCheck(): Promise<IntegrityReport>;

  /** Fills an empty database with realistic saree designs so the app can be explored. */
  sampleDataLoad(): Promise<void>;

  /** Where the data lives and which backups exist. */
  dataInfo(): Promise<DataInfo>;
  /** Writes a snapshot of the whole database next to the automatic daily ones. */
  backupNow(): Promise<{ name: string }>;
  /** Replaces all your data with a backup's. A safety copy of the current data is taken first, so a restore can be undone. */
  backupRestore(name: string): Promise<{ restoredFrom: string; restorePoint: string }>;
}

export type ApiMethod = keyof Api;

export type Envelope<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
