import type { WebsiteListing } from './websiteText';
import type { Paise } from './money';
import type {
  AppUser,
  BulkAddResult,
  SessionState,
  UserInput,
  UserRole,
  BulkDesignAction,
  BulkDesignResult,
  CustomerImportResult,
  StockTakeLine,
  StockTakeResult,
  BulkSareeRow,
  CatalogueEntry,
  CreditNote,
  LabelItem,
  LabelLayout,
  DesignPhoto,
  DesignPhotoInput,
  CreditNoteInput,
  CreditNotePreview,
  CreditNoteQuery,
  CreditNoteRefundInput,
  CreditNoteSummary,
  CatalogueOptions,
  Customer,
  AuditEntry,
  AuditQuery,
  HeldBill,
  Notification,
  MaterialMovement,
  MaterialMovementReason,
  MaterialPricePoint,
  Purchase,
  PurchaseInput,
  PurchaseResult,
  PurchaseSummary,
  Simulation,
  StockLocation,
  StockTransfer,
  StockTransferInput,
  AccountBook,
  AccountTransfer,
  AccountTransferInput,
  BudgetLine,
  ChequeStatus,
  DayClose,
  DueInstalment,
  GstNet,
  Instalment,
  InstalmentInput,
  PayablesSummary,
  PaymentMethod,
  PurchasesReport,
  ReconcilePreview,
  RecurringExpense,
  RecurringExpenseInput,
  Vendor,
  VendorInput,
  ProformaRevision,
  QuoteStage,
  QuoteTemplate,
  QuoteTemplateInput,
  DeliveryUpdate,
  InvoiceType,
  DueNote,
  Note,
  NoteInput,
  NoteKind,
  NoteSubject,
  CustomerInput,
  CustomerPurchase,
  DashboardNow,
  DayBook,
  DayBookMode,
  MarginBy,
  QuotesReport,
  SharedFile,
  Salesperson,
  SalespersonInput,
  SalespeopleReport,
  PricePoint,
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
  BackupResult,
  BackupSettings,
  DriveBackup,
  DriveStatus,
  RestoreSource,
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
  TidyResult,
  TidyRow,
  WeaverOrder,
  WeaverOrderDraft,
  WeaverOrderInput,
  WeaverOrderQuery,
  WeaverOrderSummary,
  WeaverPayInput,
  WeaverReceiveInput,
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
  Gstr1Export,
  LoyaltyEntry,
  WishlistEntry,
  ProductionOrder,
  ProductionOrderInput,
  ProductionQuery,
} from './types';
import type { CompareWith } from './periods';

/**
 * The contract between the UI and the data layer. Implemented in electron/api.ts, exposed to the
 * renderer over IPC (desktop) or HTTP (browser dev mode). Every call resolves or rejects with a
 * plain Error whose message is safe to show the user.
 */
export interface Api {
  sessionState(): Promise<SessionState>;
  sessionLogin(userId: string, pin: string): Promise<SessionState>;
  sessionLogout(): Promise<SessionState>;
  usersList(): Promise<AppUser[]>;
  userCreate(input: UserInput): Promise<AppUser>;
  userUpdate(id: string, patch: { name?: string; role?: UserRole; active?: boolean }): Promise<AppUser>;
  userSetPin(id: string, pin: string): Promise<AppUser>;
  userRemove(id: string): Promise<void>;
  getSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<Settings>;

  inventorySummary(): Promise<InventorySummary>;

  designsList(query?: DesignQuery): Promise<DesignSummary[]>;
  variantPriceHistory(variantId: string): Promise<PricePoint[]>;
  designGet(id: string): Promise<DesignDetail>;
  designNextCode(): Promise<string>;
  designCreate(input: DesignInput): Promise<DesignDetail>;
  designUpdate(id: string, input: DesignInput): Promise<DesignDetail>;
  designArchive(id: string): Promise<void>;
  /** Brings back an archived design and the variants archived with it. */
  designRestore(id: string): Promise<DesignDetail>;
  /** Archives, re-prices or sets the reorder level of many designs at once. */
  designsBulk(action: BulkDesignAction): Promise<BulkDesignResult>;
  /** Applies a physical stock count as adjustments. */
  stockTakeApply(counts: StockTakeLine[], note?: string): Promise<StockTakeResult>;
  /** Adds many expenses from a sheet. All or nothing. */
  expensesBulkAdd(rows: { row: number; value: ExpenseInput }[]): Promise<number>;
  /** Everything in the book as a ZIP of spreadsheets (base64). */
  dataExportAll(): Promise<{ fileName: string; base64: string; files: string[] }>;
  /** Saves a ZIP the data layer just made. Desktop app only. */
  exportSaveZip(fileName: string, base64: string): Promise<{ saved: boolean; path?: string }>;
  /** A new design copied from this one: same details, and a copy of each variant with its price and raw-material costing, but no stock. */
  designDuplicate(id: string): Promise<DesignDetail>;
  /** Every design as web page text and shop-import data: title, search text, description, tags and prices (see shared/websiteText.ts). */
  websiteListings(): Promise<WebsiteListing[]>;

  /** What each of these pieces needs on a label. */
  labelItems(variantIds: string[]): Promise<LabelItem[]>;
  labelsExportPdf(items: { variantId: string; copies: number }[], layout: LabelLayout): Promise<{ saved: boolean; path?: string }>;
  labelsPrint(items: { variantId: string; copies: number }[], layout: LabelLayout): Promise<void>;

  designPhotos(designId: string): Promise<DesignPhoto[]>;
  /** The cover photo of every design that has one, as a small thumbnail, by design id. */
  designCovers(): Promise<Record<string, string>>;
  designPhotoAdd(designId: string, input: DesignPhotoInput): Promise<DesignPhoto[]>;
  designPhotoRemove(photoId: string): Promise<DesignPhoto[]>;
  /** Makes this photo the one shown in lists. */
  designPhotoCover(photoId: string): Promise<DesignPhoto[]>;

  /** Adds many sarees at once. All or nothing: if any row has a problem, none are added and the problems come back per row. */
  inventoryBulkAdd(rows: BulkSareeRow[]): Promise<BulkAddResult>;
  /** Adds one saree to the inventory from the invoice screen and returns it ready to put on the invoice. Same rules as the Add sarees sheet. */
  inventoryQuickAdd(row: BulkSareeRow): Promise<SaleVariant>;
  /** The choices for weave style, fabric, technique, work and colour. */
  catalogueOptions(): Promise<CatalogueOptions>;
  /** Every choice with how many designs use it, for the screen that manages them. */
  catalogueEntries(): Promise<CatalogueEntry[]>;
  /** Renames a choice everywhere it is used. Renaming to a choice that already exists merges the two. Built in choices can't be renamed. */
  catalogueRename(input: { kind: CatalogueEntry['kind']; from: string; to: string }): Promise<{ changed: number }>;
  /** Removes a choice nobody uses. A choice in use, or a built in one, is refused. */
  catalogueDelete(input: { kind: CatalogueEntry['kind']; label: string }): Promise<void>;
  /** Sets the choices on several designs and, where asked, renames each to the name they build. All or nothing. */
  designsTidy(rows: TidyRow[]): Promise<TidyResult>;
  variantCreate(designId: string, input: VariantInput): Promise<Variant>;
  variantUpdate(id: string, input: VariantInput): Promise<Variant>;
  variantArchive(id: string): Promise<void>;
  variantRestore(id: string): Promise<Variant>;

  stockAdjust(input: StockAdjustInput): Promise<Variant>;
  stockMovements(variantId: string): Promise<StockMovement[]>;

  materialsList(): Promise<Material[]>;
  materialMovements(materialId: string): Promise<MaterialMovement[]>;
  materialPriceHistory(materialId: string): Promise<MaterialPricePoint[]>;
  /** A correction, or material used up or wasted. Buying goes through a purchase. */
  materialAdjust(input: { materialId: string; delta: number; reason: MaterialMovementReason; note?: string }): Promise<Material>;
  /** What the sarees would cost and earn if materials cost something else. Changes nothing. */
  materialsSimulate(changes: { materialId: string; unitCostPaise: Paise }[]): Promise<Simulation>;
  purchasesList(query?: { from?: string; to?: string; supplierId?: string; search?: string }): Promise<PurchaseSummary[]>;
  purchaseGet(id: string): Promise<Purchase>;
  purchaseCreate(input: PurchaseInput): Promise<PurchaseResult>;
  purchaseDelete(id: string): Promise<void>;

  /** Everything that wants attention right now, most urgent first. Worked out fresh each time. */
  notificationsList(): Promise<Notification[]>;
  /** What was done and when, newest first. */
  auditList(query?: AuditQuery): Promise<AuditEntry[]>;
  /** Bills set aside half-made to finish later. */
  heldList(kind?: HeldBill['kind']): Promise<HeldBill[]>;
  heldHold(input: { name: string; kind?: HeldBill['kind']; payload: unknown }): Promise<HeldBill>;
  heldDiscard(id: string): Promise<void>;

  locationsList(): Promise<StockLocation[]>;
  locationCreate(name: string): Promise<StockLocation>;
  locationRename(id: string, name: string): Promise<StockLocation>;
  locationArchive(id: string): Promise<void>;
  stockTransfer(input: StockTransferInput): Promise<StockTransfer>;
  stockTransfers(variantId?: string): Promise<StockTransfer[]>;
  materialCreate(input: MaterialInput): Promise<Material>;
  materialUpdate(id: string, input: MaterialInput): Promise<Material>;
  materialDelete(id: string): Promise<void>;

  customersList(query?: { search?: string }): Promise<Customer[]>;
  customerGet(id: string): Promise<Customer>;
  customerCreate(input: CustomerInput): Promise<Customer>;
  customerUpdate(id: string, input: CustomerInput): Promise<Customer>;
  /** Archives; invoices already issued keep their own copy of the customer's details. */
  customerArchive(id: string): Promise<void>;
  /** Brings back an archived customer. */
  customerRestore(id: string): Promise<Customer>;
  /** Adds many customers from a sheet; ones already on file are skipped. All or nothing on bad rows. */
  customersImport(rows: { row: number; value: CustomerInput }[]): Promise<CustomerImportResult>;
  /** What this customer has bought, by design, most recent first. */
  customerPurchases(id: string): Promise<CustomerPurchase[]>;
  /** Folds a duplicate into the customer you keep: their invoices, payments and quotes move across, blank details are filled in, and the duplicate is archived. */
  customerMerge(keepId: string, duplicateId: string): Promise<Customer>;

  notesList(subjectType: NoteSubject, subjectId: string): Promise<Note[]>;
  noteAdd(input: NoteInput): Promise<Note>;
  noteDone(id: string, done: boolean): Promise<Note>;
  noteDelete(id: string): Promise<void>;
  /** Open follow-ups and promises to pay, soonest first (overdue ones included). */
  notesDue(query?: { kind?: NoteKind; onOrBefore?: string }): Promise<DueNote[]>;

  variantsForSale(): Promise<SaleVariant[]>;
  /** The piece a scanned or typed code belongs to (its barcode or SKU), or null. */
  variantByCode(code: string): Promise<SaleVariant | null>;

  creditNotesList(query?: CreditNoteQuery): Promise<CreditNoteSummary[]>;
  creditNoteGet(id: string): Promise<CreditNote>;
  /** What a credit for these items would come to, and how it would settle. With no items, just what is left on the invoice to take back. */
  creditNotePreview(input: Pick<CreditNoteInput, 'invoiceId' | 'lines'>): Promise<CreditNotePreview>;
  /** Takes goods back from an issued invoice: a credit note with its own number and tax, optional restocking, and the money settled. */
  creditNoteCreate(input: CreditNoteInput): Promise<CreditNote>;
  /** Hands back credit that was being kept for the customer. */
  creditNoteRefund(id: string, input: CreditNoteRefundInput): Promise<CreditNote>;
  /** Cancels a credit note made by mistake, if no money was handed back and it was not used on another invoice. */
  creditNoteCancel(id: string, reason: string): Promise<CreditNote>;

  weaverOrdersList(query?: WeaverOrderQuery): Promise<WeaverOrderSummary[]>;
  weaverOrderGet(id: string): Promise<WeaverOrder>;
  weaverOrderCreate(input: WeaverOrderInput): Promise<WeaverOrder>;
  /** Changes an order. A line that has pieces received can't go below what has arrived or be removed. */
  weaverOrderUpdate(id: string, input: WeaverOrderInput): Promise<WeaverOrder>;
  /** Marks pieces as arrived: they go into stock, through the stock ledger, and the order moves to part received or received. */
  weaverOrderReceive(id: string, input: WeaverReceiveInput): Promise<WeaverOrder>;
  /** Records money paid to the weaver. It is also entered as an expense. */
  weaverOrderPay(id: string, input: WeaverPayInput): Promise<WeaverOrder>;
  /** Takes a payment back (entered by mistake). Its expense is removed too. */
  weaverPaymentVoid(id: string): Promise<WeaverOrder>;
  /** Cancels an order nothing has arrived for and nothing is paid on. */
  weaverOrderCancel(id: string, reason: string): Promise<WeaverOrder>;
  /** What is short for a quote's items, as a starting point for an order to a weaver. */
  weaverOrderDraft(proformaId: string): Promise<WeaverOrderDraft>;

  invoicesList(query?: InvoiceQuery): Promise<InvoiceSummary[]>;
  invoiceGet(id: string): Promise<Invoice>;
  /** The number the next invoice issued on this date will get. */
  /** The number the next invoice of this type would get. B2B can run its own series (Settings). */
  invoiceNextNumber(issueDate: string, type?: InvoiceType): Promise<string>;
  /** Updates carrier, tracking and delivery progress on an issued invoice. */
  invoiceSetDelivery(id: string, update: DeliveryUpdate): Promise<Invoice>;
  /** Credits an invoice to a person on the sales team (or to no one, with null). */
  invoiceSetSoldBy(id: string, salespersonId: string | null): Promise<Invoice>;
  /** Makes the invoice's PDF ready to send: saved in a folder of its own and copied, so it can be pasted into a chat or an email. Desktop app only. */
  invoiceShareFile(id: string): Promise<SharedFile>;
  /** Shows a PDF made by `invoiceShareFile` in its folder. Desktop app only. */
  shareReveal(path: string): Promise<void>;
  salespeopleList(): Promise<Salesperson[]>;
  salespersonCreate(input: SalespersonInput): Promise<Salesperson>;
  salespersonUpdate(id: string, input: SalespersonInput): Promise<Salesperson>;
  salespersonArchive(id: string): Promise<void>;
  salespersonRestore(id: string): Promise<Salesperson>;
  /** What each person sold in the period, and the commission on it. */
  reportSalespeople(range: { from: string; to: string }): Promise<SalespeopleReport>;
  /** Issues the invoice and takes the stock out, atomically. */
  invoiceCreate(input: InvoiceInput): Promise<Invoice>;
  /** Cancels an issued invoice and puts its stock back. The number is never reused. */
  invoiceCancel(id: string, reason: string): Promise<Invoice>;
  /** Desktop app only: asks where to save, then writes the invoice as a PDF. */
  /** One payment, for its receipt. */
  paymentGet(id: string): Promise<Payment>;
  /** Desktop app only: asks where to save, then writes the customer's statement of account as a PDF. */
  customerStatementExportPdf(customerId: string): Promise<{ saved: boolean; path?: string }>;
  customerStatementPrint(customerId: string): Promise<void>;
  /** Desktop app only: the receipt for a payment, as a PDF. */
  paymentReceiptExportPdf(paymentId: string): Promise<{ saved: boolean; path?: string }>;
  paymentReceiptPrint(paymentId: string): Promise<void>;
  /** Desktop app only: several invoices in one PDF, each on its own page. */
  invoicesExportPdf(ids: string[]): Promise<{ saved: boolean; path?: string }>;
  invoicesPrint(ids: string[]): Promise<void>;
  /** Prints the short 80 mm receipt for a thermal printer. */
  invoiceSlipPrint(id: string): Promise<void>;
  /** Opens another InvoiceOn window, for working on two things side by side. */
  appNewWindow(): Promise<void>;
  invoiceExportPdf(id: string): Promise<{ saved: boolean; path?: string }>;
  /** Desktop app only: opens the system print dialog for the invoice. */
  invoicePrint(id: string): Promise<void>;
  creditNoteExportPdf(id: string): Promise<{ saved: boolean; path?: string }>;
  creditNotePrint(id: string): Promise<void>;

  paymentsList(query?: PaymentQuery): Promise<Payment[]>;
  /** Records money received. Each part goes to the invoices named in `allocations`; any remainder is held as the customer's advance. */
  paymentRecord(input: PaymentInput): Promise<Payment>;
  /** Reverses a payment (a mistake, or a refund). Invoices it paid become due again. */
  paymentVoid(id: string, reason: string): Promise<Payment>;
  /** Puts a customer's held advance toward one of their open invoices. Returns the invoice as it stands afterwards. */
  invoiceApplyAdvance(invoiceId: string): Promise<Invoice>;
  paymentsSummary(): Promise<PaymentsSummary>;
  /** Moves a tracked cheque along. A bounced cheque reverses the payment. */
  paymentChequeStatus(id: string, status: ChequeStatus, reason?: string): Promise<Payment>;
  /** Ticks payments off as matched against a bank statement on that day, or clears the tick (null). */
  paymentsReconcile(ids: string[], on: string | null): Promise<number>;
  /** Reads a pasted bank statement and proposes which payment each money-in line is. Changes nothing. */
  reconcilePreview(statementText: string, accountId?: string): Promise<ReconcilePreview>;
  /** Clears a small balance on an invoice without any money arriving. Never counts as received. */
  paymentWriteOff(input: { invoiceId: string; amountPaise: Paise; reason?: string }): Promise<Payment>;

  accountBook(range: { from: string; to: string }): Promise<AccountBook>;
  transfersList(): Promise<AccountTransfer[]>;
  transferCreate(input: AccountTransferInput): Promise<AccountTransfer>;
  transferDelete(id: string): Promise<void>;
  dayCloseGet(day: string): Promise<DayClose>;
  dayCloseSave(day: string, countedPaise: Paise, note: string): Promise<DayClose>;
  dayClosesList(): Promise<DayClose[]>;

  instalmentsList(invoiceId: string): Promise<Instalment[]>;
  instalmentsSet(invoiceId: string, plan: InstalmentInput[]): Promise<Instalment[]>;
  instalmentsClear(invoiceId: string): Promise<void>;
  /** Instalments not fully paid that fall due by this day (default: in the next week), overdue ones included. */
  instalmentsDue(onOrBefore?: string): Promise<DueInstalment[]>;

  customerLedger(customerId: string): Promise<Ledger>;
  /** Who owes what, aged by how long past due. */
  duesReport(): Promise<DuesReport>;

  /** Sales for a date range: invoiced (by invoice date) alongside collected (by payment date). */
  reportSales(range: { from: string; to: string }): Promise<SalesReport>;
  /** GST collected on invoices dated in the range, split B2B/B2C, by HSN, and as a GSTR-1-style register. */
  reportGst(range: { from: string; to: string }): Promise<GstReport>;
  /** The month's GSTR-1 as a JSON file for the GST portal. For one calendar month. */
  reportGstr1(range: { from: string; to: string }): Promise<Gstr1Export>;
  // Loyalty and wishlist
  loyaltyHistory(customerId: string): Promise<LoyaltyEntry[]>;
  /** Adds or takes off points by hand, with a reason. Returns the new balance. */
  loyaltyAdjust(input: { customerId: string; points: number; note: string }): Promise<number>;
  wishlistGet(customerId: string): Promise<WishlistEntry[]>;
  wishlistAdd(input: { customerId: string; designId: string; note?: string }): Promise<WishlistEntry[]>;
  wishlistRemove(id: string): Promise<void>;
  // Production orders and job work
  productionList(query?: ProductionQuery): Promise<ProductionOrder[]>;
  productionGet(id: string): Promise<ProductionOrder>;
  productionCreate(input: ProductionOrderInput): Promise<ProductionOrder>;
  productionUpdate(id: string, input: ProductionOrderInput): Promise<ProductionOrder>;
  /** Hands the raw materials over for the whole order. */
  productionIssueMaterials(id: string): Promise<ProductionOrder>;
  /** Pieces came back: they go on the shelf, and the wage becomes a bill to whoever made them. */
  productionReceive(id: string, input: { qty: number; receivedOn?: string }): Promise<ProductionOrder>;
  /** Finish with fewer pieces than planned; unused materials go back to the shelf. */
  productionCloseShort(id: string): Promise<ProductionOrder>;
  productionCancel(id: string): Promise<ProductionOrder>;
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
  reportQuotes(range: { from: string; to: string }): Promise<QuotesReport>;
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
  /** Brings back an expense that was just deleted. */
  expenseRestore(id: string): Promise<Expense>;
  expensesBreakdown(query?: ExpenseQuery): Promise<ExpensesBreakdown>;
  expenseCreate(input: ExpenseInput): Promise<Expense>;
  expenseUpdate(id: string, input: ExpenseInput): Promise<Expense>;
  expenseDelete(id: string): Promise<void>;
  /** Settles a bill that was owed. */
  expenseMarkPaid(id: string, input: { paidOn: string; method: PaymentMethod; accountId?: string; reference?: string }): Promise<Expense>;
  payables(): Promise<PayablesSummary>;
  vendorsList(query?: { search?: string }): Promise<Vendor[]>;
  vendorGet(id: string): Promise<Vendor>;
  vendorCreate(input: VendorInput): Promise<Vendor>;
  vendorUpdate(id: string, input: VendorInput): Promise<Vendor>;
  vendorArchive(id: string): Promise<void>;
  recurringList(): Promise<RecurringExpense[]>;
  recurringCreate(input: RecurringExpenseInput): Promise<RecurringExpense>;
  recurringUpdate(id: string, input: RecurringExpenseInput): Promise<RecurringExpense>;
  recurringDelete(id: string): Promise<void>;
  /** Standing expenses that have come due and not yet been entered. */
  recurringDue(): Promise<{ recurring: RecurringExpense; dates: string[] }[]>;
  /** Enters everything that is due and moves each standing expense on. Returns how many entries were made. */
  recurringRun(): Promise<number>;
  /** This month's spending against each category's budget. */
  budgetStatus(): Promise<BudgetLine[]>;
  gstNet(range: { from: string; to: string }): Promise<GstNet>;
  reportPurchases(range: { from: string; to: string }): Promise<PurchasesReport>;

  proformasList(query?: ProformaQuery): Promise<ProformaSummary[]>;
  proformaGet(id: string): Promise<Proforma>;
  proformaNextNumber(issueDate: string): Promise<string>;
  proformaCreate(input: ProformaInput): Promise<Proforma>;
  /** Changes a quote that hasn't been invoiced or cancelled. It keeps its number. */
  proformaUpdate(id: string, input: ProformaInput): Promise<Proforma>;
  proformaCancel(id: string, reason: string): Promise<Proforma>;
  /** Turns the quote into an invoice dated today, taking the stock off the shelves. */
  /** Invoices the quote, or just the chosen items and quantities when `pick` is given. */
  proformaConvert(id: string, pick?: { variantId: string; qty: number }[]): Promise<Invoice>;
  proformaSetStage(id: string, stage: QuoteStage, lostReason?: string): Promise<Proforma>;
  proformaRevisions(id: string): Promise<ProformaRevision[]>;
  quoteTemplatesList(): Promise<QuoteTemplate[]>;
  quoteTemplateSave(input: QuoteTemplateInput): Promise<QuoteTemplate>;
  quoteTemplateDelete(id: string): Promise<void>;
  proformaExportPdf(id: string): Promise<{ saved: boolean; path?: string }>;
  proformaPrint(id: string): Promise<void>;

  /** Fills an empty database with realistic saree designs so the app can be explored. */
  sampleDataLoad(): Promise<void>;

  /** Where the data lives and which backups exist. */
  dataInfo(): Promise<DataInfo>;
  /** Writes a snapshot of the whole database next to the automatic daily ones, and sends it to the extra folder and Google Drive when those are set up. */
  backupNow(): Promise<BackupResult>;
  backupSettingsSave(input: BackupSettings): Promise<BackupSettings>;
  /** Asks where to save, and writes a copy of the book there. */
  backupSaveCopy(): Promise<{ saved: boolean; path?: string }>;
  /** Asks the person to pick a folder (desktop only). Null if they cancel. */
  backupPickFolder(): Promise<string | null>;
  /** Prepares a restore and restarts the app to apply it. A copy of the current book is kept first. */
  backupRestore(source: RestoreSource): Promise<{ started: boolean; safetyCopy?: string }>;
  /** Cancels a restore that was prepared but not yet applied. */
  backupRestoreCancel(): Promise<void>;
  driveSaveCredentials(input: { clientId: string; clientSecret: string }): Promise<DriveStatus>;
  /** Starts signing in to Google and returns the address to open in the browser. */
  driveConnectStart(): Promise<{ authUrl: string }>;
  /** Waits until that sign-in finishes. */
  driveConnectWait(): Promise<DriveStatus>;
  /** Signs out. With forget, the saved client ID and secret go too. */
  driveDisconnect(forget?: boolean): Promise<DriveStatus>;
  driveBackups(): Promise<DriveBackup[]>;
  driveDeleteBackup(id: string): Promise<void>;
}

export type ApiMethod = keyof Api;

export type Envelope<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
