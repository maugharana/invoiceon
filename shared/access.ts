// Who may do what. Access control is optional: until the owner turns it on, nobody is asked for anything and every call is allowed,
// exactly as the app has always worked. Once on, each person signs in with a PIN and their role decides what they can do.
//
// Every API call needs one capability, and a call with no entry here needs the strictest (admin), so a call added later is closed
// to everyone but the owner until someone decides otherwise.

export const ROLES = ['owner', 'manager', 'staff'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', manager: 'Manager', staff: 'Counter staff' };
export const ROLE_BLURB: Record<Role, string> = {
  owner: 'Everything, including settings, backups, users and the activity log.',
  manager: 'Selling, cancelling, stock, purchases, weavers, expenses and reports. Not settings, backups or users.',
  staff: 'Selling at the counter: invoices, quotes, customers and payments. No costs or profit, no cancelling, no stock changes.',
};

export type Capability = 'view' | 'sell' | 'cancel' | 'stock' | 'purchases' | 'reports' | 'admin';

export const ROLE_CAPS: Record<Role, readonly Capability[]> = {
  owner: ['view', 'sell', 'cancel', 'stock', 'purchases', 'reports', 'admin'],
  manager: ['view', 'sell', 'cancel', 'stock', 'purchases', 'reports'],
  staff: ['view', 'sell'],
};

export const canDo = (role: Role | null | undefined, capability: Capability): boolean => !!role && ROLE_CAPS[role].includes(capability);

/** Calls that work with nobody signed in: finding out who can sign in, and signing in and out. */
export const ALWAYS_ALLOWED: readonly string[] = ['accessStatus', 'accessLogin', 'accessLogout'];

const view = ['accessChangePin', 'getSettings', 'inventorySummary', 'designsList', 'designGet', 'designNextCode', 'variantsForSale', 'stockMovements', 'materialsList', 'customersList', 'customerGet', 'customerLedger', 'invoicesList', 'invoiceGet', 'invoiceNextNumber', 'invoiceExportPdf', 'invoicePrint', 'paymentsList', 'paymentsSummary', 'duesReport', 'dashboardSummary', 'creditNotesList', 'creditNoteGet', 'creditNoteNextNumber', 'creditNoteExportPdf', 'creditNotePrint', 'proformasList', 'proformaGet', 'proformaNextNumber', 'proformaExportPdf', 'proformaPrint', 'labelsPrint', 'labelsExportPdf', 'offersList', 'loyaltyConfig', 'loyaltyAccount', 'onboardingStatus', 'onboardingDismiss', 'followUps', 'customerFollowUps', 'locationsList', 'transfersList', 'stockHoldings', 'designPhotos', 'designCovers', 'catalogueData', 'cataloguePrint', 'catalogueExportPdf', 'exportSave'];
const sell = ['customersImport', 'contactLog', 'promiseCreate', 'promiseCancel', 'customerCreate', 'customerUpdate', 'invoiceCreate', 'invoiceApplyAdvance', 'paymentRecord', 'creditNoteCreate', 'proformaCreate', 'proformaConvert'];
const cancel = ['offerSave', 'offerArchive', 'loyaltyAdjust', 'invoiceCancel', 'paymentVoid', 'creditNoteCancel', 'proformaCancel', 'customerArchive'];
const stock = ['stockTakeCurrent', 'stockTakeStart', 'stockTakeCount', 'stockTakeApply', 'stockTakeCancel', 'stockTakesList', 'locationSave', 'locationArchive', 'stockTransfer', 'designPhotoAdd', 'designPhotoRemove', 'designPhotoCover', 'designCreate', 'designUpdate', 'designArchive', 'inventoryBulkAdd', 'variantCreate', 'variantUpdate', 'variantArchive', 'stockAdjust', 'materialCreate', 'materialUpdate', 'materialDelete'];
const purchases = ['suppliersList', 'supplierGet', 'supplierCreate', 'supplierUpdate', 'supplierArchive', 'supplierLedger', 'purchaseBillsList', 'purchaseBillGet', 'purchaseBillCreate', 'purchaseBillCancel', 'purchaseBillApplyAdvance', 'supplierPaymentsList', 'supplierPaymentRecord', 'supplierPaymentVoid', 'payablesReport', 'purchasesSummary', 'weaversList', 'weaverGet', 'weaverCreate', 'weaverUpdate', 'weaverArchive', 'weaverLedger', 'jobOrdersList', 'jobOrderGet', 'jobOrderCreate', 'jobOrderIssueMaterial', 'jobOrderReceive', 'jobOrderReverseReceipt', 'jobOrderClose', 'jobOrderCancel', 'weaverPaymentsList', 'weaverPaymentRecord', 'weaverPaymentVoid'];
const reports = ['stockInsights', 'reportSales', 'reportGst', 'gstFilingExport', 'reportStock', 'dashboardOverview', 'expensesList', 'expensesOverview', 'expenseCreate', 'expenseUpdate', 'expenseDelete'];

export const METHOD_CAPABILITY: Record<string, Capability> = Object.fromEntries([
  ...view.map((m) => [m, 'view']),
  ...sell.map((m) => [m, 'sell']),
  ...cancel.map((m) => [m, 'cancel']),
  ...stock.map((m) => [m, 'stock']),
  ...purchases.map((m) => [m, 'purchases']),
  ...reports.map((m) => [m, 'reports']),
]);

/** What a call needs. Anything not listed needs the owner. */
export const capabilityOf = (method: string): Capability => METHOD_CAPABILITY[method] ?? 'admin';

/** The message a locked app answers with. The screens recognise it and show the sign-in page. */
export const LOCKED_MESSAGE = 'The app is locked. Sign in with your PIN.';

/** Field names that reveal what things cost or what they earn. Counter staff never receive them. */
const COST_KEY = /CostPaise$|CostPerPiecePaise$|^stockValuePaise$|^costValuePaise$|^retailValuePaise$|Profit|^marginPercent$/;

/** A copy of the data with every cost and profit figure set to zero, however deeply it sits. */
export function redactCosts<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactCosts) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, COST_KEY.test(k) && typeof v === 'number' ? 0 : redactCosts(v)])) as T;
  }
  return value;
}

export interface AccessUser {
  id: string;
  name: string;
  role: Role;
  active: boolean;
}

/** What the screens need to know before anyone is signed in. */
export interface AccessStatus {
  /** Whether access control is switched on at all. */
  enabled: boolean;
  /** Who is signed in, or null when locked (or when access control is off). */
  user: { id: string; name: string; role: Role } | null;
  businessName: string;
  /** The people who can sign in, for the sign-in page. Names only. */
  people: { id: string; name: string; role: Role }[];
  autoLockMinutes: number;
}

export interface AccessUserInput {
  name: string;
  role: Role;
  /** 4 to 8 digits. Required when adding someone; when editing, leave out to keep the current PIN. */
  pin?: string;
  active?: boolean;
}

export const PIN_PATTERN = /^\d{4,8}$/;
