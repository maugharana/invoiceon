import { addDays, todayIso } from '../shared/gst';
import type { Api, Envelope } from '../shared/api';
import { discardPendingRestore, saveBackupSettings, snapshotTo } from './backup';
import * as backupService from './backupService';
import * as drive from './drive';
import type { Db } from './db/connection';
import { UserError } from './services/common';
import * as accounts from './services/accounts';
import { auditBefore, isAudited, listAudit, recordAudit } from './services/audit';
import * as held from './services/held';
import { notifications } from './services/notifications';
import * as credits from './services/credits';
import * as customers from './services/customers';
import * as instalments from './services/instalments';
import { dashboardNow, dashboardOverview } from './services/dashboard';
import { festivalComparison } from './services/festival';
import * as bulk from './services/bulk';
import { exportEverything } from './services/exportAll';
import * as moreReports from './services/moreReports';
import { reorderList } from './services/deadstock';
import * as expenses from './services/expenses';
import * as inventory from './services/inventory';
import * as invoices from './services/invoices';
import * as locations from './services/locations';
import * as materials from './services/materials';
import * as notes from './services/notes';
import * as payments from './services/payments';
import * as photos from './services/photos';
import * as production from './services/production';
import * as proformas from './services/proformas';
import * as purchases from './services/purchases';
import * as receivables from './services/receivables';
import * as reports from './services/reports';
import { loadSampleData } from './services/seed';
import * as settings from './services/settings';

/** Things only the desktop shell can do. Absent in browser dev mode, where those calls explain themselves. */
export interface Host {
  /** `route` is the print page for the document, e.g. "/print/invoice/<id>". */
  exportDocumentPdf(route: string, fileName: string): Promise<{ saved: boolean; path?: string }>;
  printDocument(route: string): Promise<void>;
  saveTextFile(fileName: string, content: string): Promise<{ saved: boolean; path?: string }>;
  /** Saves a ZIP (given as base64) to a place the person chooses. */
  saveZipFile(fileName: string, base64: string): Promise<{ saved: boolean; path?: string }>;
  /** Asks where to save a backup file; null if cancelled. */
  pickSavePath?(title: string, fileName: string): Promise<string | null>;
  /** Asks for a backup file to open; null if cancelled. */
  pickFile?(title: string): Promise<string | null>;
  pickFolder?(title: string): Promise<string | null>;
  /** Closes the app and opens it again, so a prepared restore can be applied. */
  restartApp?(): Promise<void>;
  /** Encrypts secrets with the operating system, when it can. */
  vault?: drive.Vault;
}

const DESKTOP_ONLY = 'This works in the InvoiceOn desktop app only.';

/** The invoices to print together: they must all exist, and there is a sensible limit so a window isn't asked for a thousand pages. */
function checkInvoiceIds(db: Db, ids: string[]): string[] {
  const list = [...new Set(Array.isArray(ids) ? ids.map(String) : [])];
  if (list.length === 0) throw new UserError('Choose at least one invoice.');
  if (list.length > 200) throw new UserError('Print up to 200 invoices at a time.');
  for (const id of list) invoices.getInvoice(db, id);
  return list;
}

/**
 * Binds the data layer to one open database. This is the only place that knows which service backs which call. Every call that
 * changes something also leaves a line in the activity log, written here so no screen has to remember to.
 */
export function createApi(db: Db, host?: Host, dataDir?: string, driveOverrides?: backupService.DriveOverrides): Api {
  const api = buildApi(db, host, dataDir, driveOverrides);
  const logged = {} as Record<string, unknown>;
  for (const [name, fn] of Object.entries(api)) {
    if (!isAudited(name) || typeof fn !== 'function') {
      logged[name] = fn;
      continue;
    }
    logged[name] = async (...args: unknown[]) => {
      const before = auditBefore(db, name);
      const result = await (fn as (...a: unknown[]) => Promise<unknown>)(...args);
      recordAudit(db, name, args, result, before);
      return result;
    };
  }
  return logged as unknown as Api;
}

function buildApi(db: Db, host?: Host, dataDir?: string, driveOverrides?: backupService.DriveOverrides): Api {
  /** Backups and Google Drive need to know where the data folder is; the browser-only bridge passes one too. */
  const need = (): drive.DriveContext => {
    if (!dataDir) throw new UserError(DESKTOP_ONLY);
    return backupService.driveContext(dataDir, host?.vault, driveOverrides);
  };
  return {
    notificationsList: async () => notifications(db),
    auditList: async (query) => listAudit(db, query ?? {}),
    heldList: async (kind) => held.listHeld(db, kind ?? 'invoice'),
    heldHold: async (input) => held.holdBill(db, input),
    heldDiscard: async (id) => held.discardHeld(db, id),

    getSettings: async () => settings.getSettings(db),
    saveSettings: async (patch) => settings.saveSettings(db, patch),

    inventorySummary: async () => inventory.inventorySummary(db),

    designsList: async (query) => inventory.listDesigns(db, query ?? {}), // ?? because JSON turns undefined into null
    designGet: async (id) => inventory.getDesign(db, id),
    designNextCode: async () => inventory.nextDesignCode(db),
    designCreate: async (input) => inventory.createDesign(db, input),
    designUpdate: async (id, input) => inventory.updateDesign(db, id, input),
    variantPriceHistory: async (variantId) => inventory.variantPriceHistory(db, variantId),
    designDuplicate: async (id) => inventory.duplicateDesign(db, id),
    designRestore: async (id) => inventory.restoreDesign(db, id),
    designsBulk: async (action) => bulk.bulkChangeDesigns(db, action),
    stockTakeApply: async (counts, note) => bulk.applyStockTake(db, counts, note ?? ''),
    dataExportAll: async () => exportEverything(db),
    exportSaveZip: async (fileName, base64) => {
      if (!host) throw new UserError(DESKTOP_ONLY);
      const safe = String(fileName).replace(/[\\/:*?"<>|]/g, '-').slice(0, 120) || 'export.zip';
      return host.saveZipFile(safe, String(base64));
    },
    designArchive: async (id) => inventory.archiveDesign(db, id),

    inventoryBulkAdd: async (rows) => inventory.bulkAddSarees(db, rows),
    variantCreate: async (designId, input) => inventory.createVariant(db, designId, input),
    variantUpdate: async (id, input) => inventory.updateVariant(db, id, input),
    variantRestore: async (id) => inventory.restoreVariant(db, id),
    variantArchive: async (id) => inventory.archiveVariant(db, id),

    stockAdjust: async (input) => inventory.adjustStock(db, input),
    stockMovements: async (variantId) => inventory.listMovements(db, variantId),

    materialsList: async () => materials.listMaterials(db),
    materialCreate: async (input) => materials.createMaterial(db, input),
    materialUpdate: async (id, input) => materials.updateMaterial(db, id, input),
    materialDelete: async (id) => materials.deleteMaterial(db, id),
    materialMovements: async (id) => materials.listMaterialMovements(db, id),
    materialPriceHistory: async (id) => materials.materialPriceHistory(db, id),
    materialAdjust: async (input) => materials.adjustMaterial(db, input),
    materialsSimulate: async (changes) => materials.simulateMaterialPrices(db, changes),
    purchasesList: async (query) => purchases.listPurchases(db, query ?? {}),
    purchaseGet: async (id) => purchases.getPurchase(db, id),
    purchaseCreate: async (input) => purchases.createPurchase(db, input),
    purchaseDelete: async (id) => purchases.deletePurchase(db, id),
    locationsList: async () => locations.listLocations(db),
    locationCreate: async (name) => locations.createLocation(db, name),
    locationRename: async (id, name) => locations.renameLocation(db, id, name),
    locationArchive: async (id) => locations.archiveLocation(db, id),
    stockTransfer: async (input) => locations.transferStock(db, input),
    stockTransfers: async (variantId) => locations.listTransfers(db, variantId ?? undefined),

    customersList: async (query) => customers.listCustomers(db, query ?? {}),
    customerGet: async (id) => customers.getCustomer(db, id),
    customerCreate: async (input) => customers.createCustomer(db, input),
    customerUpdate: async (id, input) => customers.updateCustomer(db, id, input),
    customerPurchases: async (id) => customers.customerPurchases(db, id),
    customerMerge: async (keepId, duplicateId) => customers.mergeCustomers(db, keepId, duplicateId),

    notesList: async (subjectType, subjectId) => notes.listNotes(db, subjectType, subjectId),
    noteAdd: async (input) => notes.addNote(db, input),
    noteDone: async (id, done) => notes.setNoteDone(db, id, done),
    noteDelete: async (id) => notes.deleteNote(db, id),
    notesDue: async (query) => notes.openDueNotes(db, query ?? {}),
    customerRestore: async (id) => customers.restoreCustomer(db, id),
    customersImport: async (rows) => bulk.importCustomers(db, rows),
    customerArchive: async (id) => customers.archiveCustomer(db, id),

    variantsForSale: async () => invoices.variantsForSale(db),
    variantByCode: async (code) => invoices.variantByCode(db, code),
    labelsPrint: async (items) => {
      if (!host) throw new UserError(DESKTOP_ONLY);
      const list = (Array.isArray(items) ? items : []).filter((i) => i && Number.isInteger(i.copies) && i.copies > 0).slice(0, 300);
      if (list.length === 0) throw new UserError('Choose at least one label to print.');
      for (const i of list) inventory.getVariant(db, i.variantId);
      return host.printDocument(`/print/labels?items=${list.map((i) => encodeURIComponent(`${i.variantId}:${Math.min(200, i.copies)}`)).join(',')}`);
    },

    invoicesList: async (query) => invoices.listInvoices(db, query ?? {}),
    invoiceGet: async (id) => invoices.getInvoice(db, id),
    invoiceNextNumber: async (date, type) => invoices.nextInvoiceNumber(db, date, type),
    invoiceSetDelivery: async (id, update) => invoices.setDelivery(db, id, update),
    invoiceCreate: async (input) => invoices.createInvoice(db, input),
    invoiceCancel: async (id, reason) => invoices.cancelInvoice(db, id, reason),
    paymentGet: async (id) => payments.getPayment(db, id),
    customerStatementExportPdf: async (customerId) => {
      if (!host) throw new UserError(DESKTOP_ONLY);
      const c = customers.getCustomer(db, customerId);
      return host.exportDocumentPdf(`/print/statement/${encodeURIComponent(customerId)}`, `Statement - ${c.name.replace(/[\\/:*?"<>|]/g, '-')}.pdf`);
    },
    customerStatementPrint: async (customerId) => {
      if (!host) throw new UserError(DESKTOP_ONLY);
      customers.getCustomer(db, customerId);
      return host.printDocument(`/print/statement/${encodeURIComponent(customerId)}`);
    },
    paymentReceiptExportPdf: async (paymentId) => {
      if (!host) throw new UserError(DESKTOP_ONLY);
      const p = payments.getPayment(db, paymentId);
      return host.exportDocumentPdf(`/print/receipt/${encodeURIComponent(paymentId)}`, `Receipt - ${p.customerName.replace(/[\\/:*?"<>|]/g, '-')} ${p.receivedOn}.pdf`);
    },
    paymentReceiptPrint: async (paymentId) => {
      if (!host) throw new UserError(DESKTOP_ONLY);
      payments.getPayment(db, paymentId);
      return host.printDocument(`/print/receipt/${encodeURIComponent(paymentId)}`);
    },
    invoicesExportPdf: async (ids) => {
      if (!host) throw new UserError(DESKTOP_ONLY);
      const list = checkInvoiceIds(db, ids);
      return host.exportDocumentPdf(`/print/invoices?ids=${list.map(encodeURIComponent).join(',')}`, `${list.length} invoices.pdf`);
    },
    invoicesPrint: async (ids) => {
      if (!host) throw new UserError(DESKTOP_ONLY);
      const list = checkInvoiceIds(db, ids);
      return host.printDocument(`/print/invoices?ids=${list.map(encodeURIComponent).join(',')}`);
    },
    invoiceExportPdf: async (id) => {
      if (!host) throw new UserError(DESKTOP_ONLY);
      const inv = invoices.getInvoice(db, id);
      return host.exportDocumentPdf(`/print/invoice/${encodeURIComponent(id)}`, `Invoice ${inv.number.replace(/[\\/:*?"<>|]/g, '-')}.pdf`);
    },
    invoicePrint: async (id) => {
      if (!host) throw new UserError(DESKTOP_ONLY);
      invoices.getInvoice(db, id); // fail early with a friendly message if it's gone
      return host.printDocument(`/print/invoice/${encodeURIComponent(id)}`);
    },

    paymentsList: async (query) => payments.listPayments(db, query ?? {}),
    paymentRecord: async (input) => payments.recordPayment(db, input),
    paymentVoid: async (id, reason) => payments.voidPayment(db, id, reason),
    paymentRefund: async (input) => payments.refundAdvance(db, input),

    productionList: async (query) => production.listOrders(db, query ?? {}),
    productionGet: async (id) => production.getOrder(db, id),
    productionCreate: async (input) => production.createOrder(db, input),
    productionUpdate: async (id, input) => production.updateOrder(db, id, input),
    productionIssueMaterials: async (id) => production.issueMaterials(db, id),
    productionReceive: async (id, input) => production.receivePieces(db, id, input),
    productionCloseShort: async (id) => production.closeShort(db, id),
    productionCancel: async (id) => production.cancelOrder(db, id),

    photosList: async (type, id) => photos.listPhotos(db, type, id),
    photoGet: async (id) => photos.getPhotoImage(db, id),
    photoAdd: async (input) => photos.addPhoto(db, input),
    photoDelete: async (id) => photos.deletePhoto(db, id),
    photoSetCover: async (id) => photos.setCover(db, id),
    photoCovers: async (type, ids) => photos.coverThumbs(db, type, Array.isArray(ids) ? ids.map(String) : []),

    creditNotesList: async (query) => credits.listCreditNotes(db, query ?? {}),
    creditNoteGet: async (id) => credits.getCreditNote(db, id),
    creditNoteNextNumber: async (issueDate) => credits.nextCreditNoteNumber(db, issueDate),
    creditNoteReturnable: async (invoiceId) => credits.returnableLines(db, invoiceId),
    creditNotePreview: async (input) => credits.previewCreditNote(db, input),
    creditNoteCreate: async (input) => credits.createCreditNote(db, input),
    creditNoteExportPdf: async (id) => {
      if (!host) throw new UserError(DESKTOP_ONLY);
      const note = credits.getCreditNote(db, id);
      return host.exportDocumentPdf(`/print/credit-note/${encodeURIComponent(id)}`, `Credit note ${note.number.replace(/[\\/:*?"<>|]/g, '-')}.pdf`);
    },
    creditNotePrint: async (id) => {
      if (!host) throw new UserError(DESKTOP_ONLY);
      credits.getCreditNote(db, id);
      return host.printDocument(`/print/credit-note/${encodeURIComponent(id)}`);
    },
    invoiceApplyAdvance: async (invoiceId) => invoices.applyAdvanceToInvoice(db, invoiceId),
    paymentChequeStatus: async (id, status, reason) => payments.setChequeStatus(db, id, status, reason ?? ''),
    paymentsReconcile: async (ids, on) => payments.setReconciled(db, ids, on ?? null),
    reconcilePreview: async (text, accountId) => accounts.reconcilePreview(db, text, accountId ?? ''),
    paymentWriteOff: async (input) => payments.writeOffBalance(db, input),
    accountBook: async (range) => accounts.accountBook(db, range),
    transfersList: async () => accounts.listTransfers(db),
    transferCreate: async (input) => accounts.createTransfer(db, input),
    transferDelete: async (id) => accounts.deleteTransfer(db, id),
    dayCloseGet: async (day) => accounts.dayClose(db, day),
    dayCloseSave: async (day, counted, note) => accounts.closeDay(db, day, counted, note),
    dayClosesList: async () => accounts.listCloses(db),
    instalmentsList: async (invoiceId) => instalments.listInstalments(db, invoiceId),
    instalmentsSet: async (invoiceId, plan) => instalments.setInstalments(db, invoiceId, plan),
    instalmentsClear: async (invoiceId) => instalments.clearInstalments(db, invoiceId),
    instalmentsDue: async (onOrBefore) => instalments.dueInstalments(db, onOrBefore ?? addDays(todayIso(), 7)),
    paymentsSummary: async () => receivables.paymentsSummary(db),

    customerLedger: async (customerId) => receivables.customerLedger(db, customerId),
    duesReport: async () => receivables.duesReport(db),

    reportSales: async (range) => reports.salesReport(db, range),
    reportGst: async (range) => reports.gstReport(db, range),
    reportProfitLoss: async (range) => moreReports.profitAndLoss(db, range),
    reportQuotes: async (range) => moreReports.quotesReport(db, range),
    reportMargin: async (range, by) => moreReports.marginReport(db, range, by),
    reportMarginDrill: async (range, by, key) => moreReports.marginDrill(db, range, by, String(key)),
    reportMovement: async (range) => moreReports.stockMovementReport(db, range),
    reportMovers: async (days) => moreReports.moversReport(db, days ?? 90),
    reportDayBook: async (range, mode) => moreReports.dayBook(db, range, mode),
    reportStock: async (asOf) => reports.stockReport(db, asOf ?? undefined), // ?? because JSON turns undefined into null
    exportSave: async (fileName, content) => {
      if (!host) throw new UserError(DESKTOP_ONLY);
      const safe = String(fileName).replace(/[\\/:*?"<>|]/g, '-').slice(0, 120) || 'report.csv';
      return host.saveTextFile(safe, String(content));
    },

    dashboardSummary: async () => invoices.dashboardSummary(db),
    dashboardOverview: async (range, compare) => dashboardOverview(db, range ?? null, compare ?? 'previous'),
    dashboardNow: async () => dashboardNow(db),
    dashboardFestival: async (festivalId) => festivalComparison(db, festivalId),
    dashboardReorderList: async () => reorderList(db),

    expensesList: async (query) => expenses.listExpenses(db, query ?? {}),
    expenseRestore: async (id) => expenses.restoreExpense(db, id),
    expensesBulkAdd: async (rows) => bulk.bulkAddExpenses(db, rows),
    expensesBreakdown: async (query) => expenses.expensesBreakdown(db, query ?? {}),
    expensesOverview: async (query) => expenses.expensesOverview(db, query ?? {}),
    expenseCreate: async (input) => expenses.createExpense(db, input),
    expenseUpdate: async (id, input) => expenses.updateExpense(db, id, input),
    expenseMarkPaid: async (id, input) => expenses.markExpensePaid(db, id, input),
    payables: async () => expenses.payablesSummary(db),
    vendorsList: async (query) => expenses.listVendors(db, query ?? {}),
    vendorGet: async (id) => expenses.getVendor(db, id),
    vendorCreate: async (input) => expenses.createVendor(db, input),
    vendorUpdate: async (id, input) => expenses.updateVendor(db, id, input),
    vendorArchive: async (id) => expenses.archiveVendor(db, id),
    recurringList: async () => expenses.listRecurring(db),
    recurringCreate: async (input) => expenses.createRecurring(db, input),
    recurringUpdate: async (id, input) => expenses.updateRecurring(db, id, input),
    recurringDelete: async (id) => expenses.deleteRecurring(db, id),
    recurringDue: async () => expenses.dueRecurring(db),
    recurringRun: async () => expenses.runRecurring(db),
    budgetStatus: async () => expenses.budgetStatus(db),
    gstNet: async (range) => expenses.gstNet(db, range),
    reportPurchases: async (range) => expenses.purchasesReport(db, range),
    expenseDelete: async (id) => expenses.deleteExpense(db, id),

    proformasList: async (query) => proformas.listProformas(db, query ?? {}),
    proformaGet: async (id) => proformas.getProforma(db, id),
    proformaNextNumber: async (date) => proformas.nextProformaNumber(db, date),
    proformaCreate: async (input) => proformas.createProforma(db, input),
    proformaUpdate: async (id, input) => proformas.updateProforma(db, id, input),
    proformaCancel: async (id, reason) => proformas.cancelProforma(db, id, reason),
    proformaConvert: async (id, pick) => proformas.convertProforma(db, id, pick),
    proformaSetStage: async (id, stage, lostReason) => proformas.setQuoteStage(db, id, stage, lostReason),
    proformaRevisions: async (id) => proformas.listRevisions(db, id),
    quoteTemplatesList: async () => proformas.listTemplates(db),
    quoteTemplateSave: async (input) => proformas.saveTemplate(db, input),
    quoteTemplateDelete: async (id) => proformas.deleteTemplate(db, id),
    proformaExportPdf: async (id) => {
      if (!host) throw new UserError(DESKTOP_ONLY);
      const p = proformas.getProforma(db, id);
      return host.exportDocumentPdf(`/print/proforma/${encodeURIComponent(id)}`, `Proforma ${p.number.replace(/[\/:*?"<>|]/g, '-')}.pdf`);
    },
    proformaPrint: async (id) => {
      if (!host) throw new UserError(DESKTOP_ONLY);
      proformas.getProforma(db, id);
      return host.printDocument(`/print/proforma/${encodeURIComponent(id)}`);
    },

    sampleDataLoad: async () => loadSampleData(db),

    // Recent writes sit in the -wal file until SQLite folds them in, so the data's real size is both files.
    dataInfo: async () => backupService.dataInfo(need()),
    backupNow: async () => backupService.backupEverywhere(db, need()),
    backupSettingsSave: async (input) => {
      need();
      return saveBackupSettings(dataDir!, input);
    },
    backupSaveCopy: async () => {
      need();
      if (!host?.pickSavePath) throw new UserError(DESKTOP_ONLY);
      const stamp = new Date().toISOString().slice(0, 10);
      const file = await host.pickSavePath('Save a copy of your book', `InvoiceOn backup ${stamp}.db`);
      if (!file) return { saved: false };
      try {
        snapshotTo(db, file);
      } catch (err) {
        if (err instanceof UserError) throw err;
        throw new UserError(`Couldn't save the copy: ${(err as Error).message}`);
      }
      return { saved: true, path: file };
    },
    backupPickFolder: async () => {
      if (!host?.pickFolder) throw new UserError(DESKTOP_ONLY);
      return host.pickFolder('Choose a folder for extra backups');
    },
    backupRestore: async (source) => backupService.restore(db, need(), host, source),
    backupRestoreCancel: async () => {
      need();
      discardPendingRestore(dataDir!);
    },
    driveSaveCredentials: async (input) => {
      const ctx = need();
      drive.saveCredentials(ctx, input);
      return backupService.driveState(ctx);
    },
    driveConnectStart: async () => drive.startSignIn(need()),
    driveConnectWait: async () => {
      const ctx = need();
      await drive.waitForSignIn(ctx);
      return backupService.driveState(ctx);
    },
    driveDisconnect: async (forget) => {
      const ctx = need();
      if (forget) await drive.forgetAll(ctx);
      else await drive.signOut(ctx);
      return backupService.driveState(ctx);
    },
    driveBackups: async () => backupService.driveBackups(need()),
    driveDeleteBackup: async (id) => drive.deleteDriveBackup(need(), String(id)),
  };
}

/**
 * Runs one API call and folds the outcome into a serialisable envelope. Expected failures carry their
 * own message; anything else is logged and replaced with a generic one so internals never leak to the UI.
 */
export async function invoke(api: Api, method: string, args: unknown[]): Promise<Envelope> {
  const fn = (api as unknown as Record<string, ((...a: unknown[]) => Promise<unknown>) | undefined>)[method];
  if (typeof fn !== 'function') return { ok: false, error: `Unknown request: ${method}` };
  try {
    return { ok: true, data: (await fn(...args)) ?? null };
  } catch (err) {
    if (err instanceof UserError) return { ok: false, error: err.message };
    console.error(`[api] ${method} failed`, err);
    return { ok: false, error: 'Something went wrong while saving. Your data has not been changed.' };
  }
}
