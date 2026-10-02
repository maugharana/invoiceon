// Who may do what, once a shop turns on sign-in. Three roles:
//   owner       everything, including settings, backups, users and the cost and margin reports.
//   cashier     the counter: sell, quote, take payments, look after customers, take goods back. Nothing about expenses, reports or settings.
//   accountant  the money: payments, expenses, bills, reports and GST. Cannot sell or change stock or settings.
// Anything not listed for a role is refused, so a new feature is closed to staff until someone decides otherwise (a test enforces this).
// Roles guard what people can DO and which money screens they can open. They are not a promise that a cashier can never see a cost
// price: the stock lists show what the shop paid.

export const ROLES = ['owner', 'cashier', 'accountant'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', cashier: 'Counter staff', accountant: 'Accountant' };
export const ROLE_HINT: Record<Role, string> = {
  owner: 'Everything, including settings, backups, users and reports.',
  cashier: 'Sells, quotes, takes payments and looks after customers. No expenses, reports or settings.',
  accountant: 'Payments, expenses, bills, reports and GST. Cannot sell or change stock or settings.',
};

/** Open to anyone, signed in or not: how to sign in. */
export const BEFORE_SIGN_IN = ['authStatus', 'authUsers', 'authSignIn', 'authRecover'] as const;

/** Open to every signed-in person. */
const EVERYONE = ['authSignOut', 'authChangePin', 'getSettings', 'notificationsList', 'appNewWindow'];

const SELLING_READS = [
  'inventorySummary', 'designsList', 'designGet', 'designNextCode', 'variantPriceHistory', 'stockMovements', 'locationsList', 'stockTransfers',
  'customersList', 'customerGet', 'customerPurchases', 'notesList', 'notesDue', 'variantsForSale', 'variantByCode', 'labelsPrint',
  'invoicesList', 'invoiceGet', 'invoiceNextNumber', 'invoiceExportPdf', 'invoicePrint', 'invoiceSlipPrint', 'invoicesExportPdf', 'invoicesPrint',
  'paymentGet', 'paymentsList', 'paymentsSummary', 'paymentReceiptExportPdf', 'paymentReceiptPrint', 'customerStatementExportPdf', 'customerStatementPrint',
  'customerLedger', 'duesReport', 'instalmentsList', 'instalmentsDue',
  'proformasList', 'proformaGet', 'proformaNextNumber', 'proformaRevisions', 'quoteTemplatesList', 'proformaExportPdf', 'proformaPrint',
  'creditNotesList', 'creditNoteGet', 'creditNoteNextNumber', 'creditNoteReturnable', 'creditNotePreview', 'creditNoteExportPdf', 'creditNotePrint',
  'heldList', 'photosList', 'photoGet', 'photoCovers', 'wishlistGet', 'loyaltyHistory', 'productionList', 'productionGet',
  'dashboardSummary', 'dashboardNow',
];

const SELLING_WRITES = [
  'invoiceCreate', 'invoiceSetDelivery', 'invoiceApplyAdvance', 'customerCreate', 'customerUpdate', 'paymentRecord',
  'proformaCreate', 'proformaUpdate', 'proformaConvert', 'proformaSetStage', 'heldHold', 'heldDiscard', 'noteAdd', 'noteDone',
  'wishlistAdd', 'wishlistRemove', 'photoAdd', 'quoteTemplateSave', 'creditNoteCreate', 'instalmentsSet',
];

const MONEY_READS = [
  'reportSales', 'reportGst', 'reportGstr1', 'reportStock', 'reportProfitLoss', 'reportMargin', 'reportMarginDrill', 'reportMovement', 'reportMovers', 'reportQuotes', 'reportDayBook', 'reportPurchases', 'exportSave',
  'dashboardOverview', 'dashboardReorderList', 'dashboardFestival', 'gstNet',
  'expensesList', 'expensesOverview', 'expensesBreakdown', 'payables', 'vendorsList', 'vendorGet', 'recurringList', 'recurringDue', 'budgetStatus',
  'accountBook', 'transfersList', 'dayCloseGet', 'dayClosesList', 'reconcilePreview', 'purchasesList', 'purchaseGet', 'materialsList', 'materialMovements', 'materialPriceHistory', 'materialsSimulate', 'auditList',
];

const MONEY_WRITES = [
  'expenseCreate', 'expenseUpdate', 'expenseDelete', 'expenseRestore', 'expenseMarkPaid', 'expensesBulkAdd',
  'vendorCreate', 'vendorUpdate', 'vendorArchive', 'recurringCreate', 'recurringUpdate', 'recurringDelete', 'recurringRun',
  'purchaseCreate', 'purchaseDelete', 'paymentRecord', 'paymentVoid', 'paymentRefund', 'paymentWriteOff', 'paymentChequeStatus', 'paymentsReconcile',
  'transferCreate', 'transferDelete', 'dayCloseSave', 'noteAdd', 'noteDone', 'noteDelete', 'instalmentsSet', 'instalmentsClear',
];

const ALLOWED: Record<Exclude<Role, 'owner'>, ReadonlySet<string>> = {
  cashier: new Set([...EVERYONE, ...SELLING_READS, ...SELLING_WRITES]),
  accountant: new Set([...EVERYONE, ...SELLING_READS, ...MONEY_READS, ...MONEY_WRITES]),
};

/** Every method any non-owner role is given, for the test that makes sure nothing new slips through unclassified. */
export const NON_OWNER_METHODS: ReadonlySet<string> = new Set([...ALLOWED.cashier, ...ALLOWED.accountant]);

export function roleCan(role: Role, method: string): boolean {
  if (role === 'owner') return true;
  return ALLOWED[role].has(method);
}

/** The parts of the app each role gets in its menu. The server is what enforces; this only hides what would only say no. */
export const ROLE_SECTIONS: Record<Role, readonly string[]> = {
  owner: ['dashboard', 'inventory', 'invoices', 'proformas', 'customers', 'payments', 'expenses', 'reports', 'settings'],
  cashier: ['inventory', 'invoices', 'proformas', 'customers', 'payments'],
  accountant: ['dashboard', 'invoices', 'customers', 'payments', 'expenses', 'reports', 'inventory'],
};

/** Where each role lands after signing in. */
export const ROLE_HOME: Record<Role, string> = { owner: '/dashboard', cashier: '/invoices/quick', accountant: '/dashboard' };

export const PIN_PATTERN = /^\d{4,8}$/;
