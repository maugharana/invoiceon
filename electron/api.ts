import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Api, Envelope } from '../shared/api';
import { encodeLabelRequest, labelSizeById, parseLabelRequest } from '../shared/labels';
import { listAudit, withAudit, type Actor } from './audit';
import { backupNow, listBackups, restoreBackup } from './backup';
import { mobileController } from './mobile';
import { offsiteCopy, offsiteDisable, offsiteRestore, offsiteSave, offsiteStatus } from './offsite';
import type { Db } from './db/connection';
import { UserError } from './services/common';
import * as access from './services/access';
import { createSession } from './services/access';
import * as creditNotes from './services/creditNotes';
import * as customers from './services/customers';
import { dashboardOverview } from './services/dashboard';
import * as expenses from './services/expenses';
import { gstFilingExport } from './services/filing';
import * as inventory from './services/inventory';
import { integrityCheck } from './services/integrity';
import * as invoices from './services/invoices';
import * as materials from './services/materials';
import * as payments from './services/payments';
import * as proformas from './services/proformas';
import * as purchases from './services/purchases';
import * as receivables from './services/receivables';
import * as reports from './services/reports';
import { loadSampleData } from './services/seed';
import * as suppliers from './services/suppliers';
import * as weavers from './services/weavers';
import * as settings from './services/settings';

/** Things only the desktop shell can do. Absent in browser dev mode, where those calls explain themselves. */
export interface Host {
  /** `route` is the print page for the document, e.g. "/print/invoice/<id>". */
  exportDocumentPdf(route: string, fileName: string): Promise<{ saved: boolean; path?: string }>;
  /** `pageMm` sets the paper size for things that are not A4 (a roll of labels). */
  printDocument(route: string, pageMm?: { widthMm: number; heightMm: number }): Promise<void>;
  saveTextFile(fileName: string, content: string): Promise<{ saved: boolean; path?: string }>;
  /** Lets the owner pick a folder (for off-site copies). */
  chooseFolder?(): Promise<string | null>;
}

const DESKTOP_ONLY = 'This works in the InvoiceOn desktop app only.';
/** The request re-encoded from what was parsed, so only understood values ever reach the print window. */
const labelQuery = (req: ReturnType<typeof parseLabelRequest>): string => encodeLabelRequest(req);

/** Binds the data layer to one open database. This is the only place that knows which service backs which call. */
export function createApi(db: Db, host?: Host, dataDir?: string, actor?: () => Actor): Api {
  // Who is signed in lives here, in memory. With access control off (the default) it never matters and every call goes straight through.
  const session = createSession(db);
  const mobile = mobileController(db);
  const who = actor ?? (() => session.actor());
  const api: Api = {
    getSettings: async () => settings.getSettings(db),
    saveSettings: async (patch) => settings.saveSettings(db, patch),

    inventorySummary: async () => inventory.inventorySummary(db),

    designsList: async (query) => inventory.listDesigns(db, query ?? {}), // ?? because JSON turns undefined into null
    designGet: async (id) => inventory.getDesign(db, id),
    designNextCode: async () => inventory.nextDesignCode(db),
    designCreate: async (input) => inventory.createDesign(db, input),
    designUpdate: async (id, input) => inventory.updateDesign(db, id, input),
    designArchive: async (id) => inventory.archiveDesign(db, id),

    inventoryBulkAdd: async (rows) => inventory.bulkAddSarees(db, rows),
    variantCreate: async (designId, input) => inventory.createVariant(db, designId, input),
    variantUpdate: async (id, input) => inventory.updateVariant(db, id, input),
    variantArchive: async (id) => inventory.archiveVariant(db, id),

    stockAdjust: async (input) => inventory.adjustStock(db, input),
    stockMovements: async (variantId) => inventory.listMovements(db, variantId),

    materialsList: async () => materials.listMaterials(db),
    materialCreate: async (input) => materials.createMaterial(db, input),
    materialUpdate: async (id, input) => materials.updateMaterial(db, id, input),
    materialDelete: async (id) => materials.deleteMaterial(db, id),

    customersList: async (query) => customers.listCustomers(db, query ?? {}),
    customerGet: async (id) => customers.getCustomer(db, id),
    customerCreate: async (input) => customers.createCustomer(db, input),
    customerUpdate: async (id, input) => customers.updateCustomer(db, id, input),
    customerArchive: async (id) => customers.archiveCustomer(db, id),

    variantsForSale: async () => invoices.variantsForSale(db),

    invoicesList: async (query) => invoices.listInvoices(db, query ?? {}),
    invoiceGet: async (id) => invoices.getInvoice(db, id),
    invoiceNextNumber: async (date) => invoices.nextInvoiceNumber(db, date),
    invoiceCreate: async (input) => invoices.createInvoice(db, input),
    invoiceCancel: async (id, reason) => invoices.cancelInvoice(db, id, reason),
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

    creditNotesList: async (query) => creditNotes.listCreditNotes(db, query ?? {}),
    creditNoteGet: async (id) => creditNotes.getCreditNote(db, id),
    creditNoteNextNumber: async (date) => creditNotes.nextCreditNoteNumber(db, date),
    creditNoteCreate: async (input) => creditNotes.createCreditNote(db, input),
    creditNoteCancel: async (id, reason) => creditNotes.cancelCreditNote(db, id, reason),
    creditNoteExportPdf: async (id) => {
      if (!host) throw new UserError(DESKTOP_ONLY);
      const cn = creditNotes.getCreditNote(db, id);
      return host.exportDocumentPdf(`/print/credit-note/${encodeURIComponent(id)}`, `Credit note ${cn.number.replace(/[\\/:*?"<>|]/g, '-')}.pdf`);
    },
    creditNotePrint: async (id) => {
      if (!host) throw new UserError(DESKTOP_ONLY);
      creditNotes.getCreditNote(db, id);
      return host.printDocument(`/print/credit-note/${encodeURIComponent(id)}`);
    },

    labelsPrint: async (query) => {
      if (!host) throw new UserError(DESKTOP_ONLY);
      const req = parseLabelRequest(String(query));
      if (req.items.length === 0) throw new UserError('Choose at least one saree to print a label for.');
      const size = labelSizeById(req.size);
      return host.printDocument(`/print/labels?${labelQuery(req)}`, size.sheet ? undefined : { widthMm: size.widthMm, heightMm: size.heightMm });
    },
    labelsExportPdf: async (query) => {
      if (!host) throw new UserError(DESKTOP_ONLY);
      const req = parseLabelRequest(String(query));
      if (req.items.length === 0) throw new UserError('Choose at least one saree to print a label for.');
      return host.exportDocumentPdf(`/print/labels?${labelQuery(req)}`, 'Saree labels.pdf');
    },

    paymentsList: async (query) => payments.listPayments(db, query ?? {}),
    paymentRecord: async (input) => payments.recordPayment(db, input),
    paymentVoid: async (id, reason) => payments.voidPayment(db, id, reason),
    invoiceApplyAdvance: async (invoiceId) => invoices.applyAdvanceToInvoice(db, invoiceId),
    paymentsSummary: async () => receivables.paymentsSummary(db),

    customerLedger: async (customerId) => receivables.customerLedger(db, customerId),
    duesReport: async () => receivables.duesReport(db),

    reportSales: async (range) => reports.salesReport(db, range),
    reportGst: async (range) => reports.gstReport(db, range),
    gstFilingExport: async (req) => gstFilingExport(db, req),
    reportStock: async (asOf) => reports.stockReport(db, asOf ?? undefined), // ?? because JSON turns undefined into null
    exportSave: async (fileName, content) => {
      if (!host) throw new UserError(DESKTOP_ONLY);
      const safe = String(fileName).replace(/[\\/:*?"<>|]/g, '-').slice(0, 120) || 'report.csv';
      return host.saveTextFile(safe, String(content));
    },

    offsiteStatus: async () => offsiteStatus(db),
    offsiteSave: async (setup) => offsiteSave(db, setup),
    offsiteDisable: async () => offsiteDisable(db),
    offsiteCopyNow: async () => {
      if (!dataDir) throw new UserError(DESKTOP_ONLY);
      return offsiteCopy(db, dataDir);
    },
    offsiteRestore: async (name, passphrase) => {
      if (!dataDir) throw new UserError(DESKTOP_ONLY);
      return offsiteRestore(db, dataDir, name, typeof passphrase === 'string' ? passphrase : undefined);
    },
    offsiteChooseFolder: async () => {
      if (!host?.chooseFolder) throw new UserError(DESKTOP_ONLY);
      return { folder: await host.chooseFolder() };
    },

    mobileStatus: async () => mobile.status(),
    mobileEnable: async () => mobile.enable(),
    mobileDisable: async () => mobile.disable(),
    mobileResetLink: async () => mobile.resetLink(),

    dashboardSummary: async () => invoices.dashboardSummary(db),
    dashboardOverview: async (range) => dashboardOverview(db, range ?? null),

    expensesList: async (query) => expenses.listExpenses(db, query ?? {}),
    expensesOverview: async (query) => expenses.expensesOverview(db, query ?? {}),
    expenseCreate: async (input) => expenses.createExpense(db, input),
    expenseUpdate: async (id, input) => expenses.updateExpense(db, id, input),
    expenseDelete: async (id) => expenses.deleteExpense(db, id),

    proformasList: async (query) => proformas.listProformas(db, query ?? {}),
    proformaGet: async (id) => proformas.getProforma(db, id),
    proformaNextNumber: async (date) => proformas.nextProformaNumber(db, date),
    proformaCreate: async (input) => proformas.createProforma(db, input),
    proformaCancel: async (id, reason) => proformas.cancelProforma(db, id, reason),
    proformaConvert: async (id) => proformas.convertProforma(db, id),
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

    suppliersList: async (query) => suppliers.listSuppliers(db, query ?? {}),
    supplierGet: async (id) => suppliers.getSupplier(db, id),
    supplierCreate: async (input) => suppliers.createSupplier(db, input),
    supplierUpdate: async (id, input) => suppliers.updateSupplier(db, id, input),
    supplierArchive: async (id) => suppliers.archiveSupplier(db, id),
    supplierLedger: async (id) => purchases.supplierLedger(db, id),

    purchaseBillsList: async (query) => purchases.listBills(db, query ?? {}),
    purchaseBillGet: async (id) => purchases.getBill(db, id),
    purchaseBillCreate: async (input) => purchases.createBill(db, input),
    purchaseBillCancel: async (id, reason) => purchases.cancelBill(db, id, reason),
    purchaseBillApplyAdvance: async (billId) => purchases.applyAdvanceToBill(db, billId),
    supplierPaymentsList: async (query) => purchases.listSupplierPayments(db, query ?? {}),
    supplierPaymentRecord: async (input) => purchases.recordSupplierPayment(db, input),
    supplierPaymentVoid: async (id, reason) => purchases.voidSupplierPayment(db, id, reason),
    payablesReport: async () => purchases.payablesReport(db),
    purchasesSummary: async () => purchases.purchasesSummary(db),

    weaversList: async (query) => weavers.listWeavers(db, query ?? {}),
    weaverGet: async (id) => weavers.getWeaver(db, id),
    weaverCreate: async (input) => weavers.createWeaver(db, input),
    weaverUpdate: async (id, input) => weavers.updateWeaver(db, id, input),
    weaverArchive: async (id) => weavers.archiveWeaver(db, id),
    weaverLedger: async (id) => weavers.weaverLedger(db, id),
    jobOrdersList: async (query) => weavers.listJobOrders(db, query ?? {}),
    jobOrderGet: async (id) => weavers.getJobOrder(db, id),
    jobOrderCreate: async (input) => weavers.createJobOrder(db, input),
    jobOrderIssueMaterial: async (input) => weavers.issueMaterial(db, input),
    jobOrderReceive: async (input) => weavers.receivePieces(db, input),
    jobOrderReverseReceipt: async (receiptId, reason) => weavers.reverseReceipt(db, receiptId, reason),
    jobOrderClose: async (id, reason) => weavers.closeJobOrder(db, id, reason),
    jobOrderCancel: async (id, reason) => weavers.cancelJobOrder(db, id, reason),
    weaverPaymentsList: async (query) => weavers.listWeaverPayments(db, query ?? {}),
    weaverPaymentRecord: async (input) => weavers.recordWeaverPayment(db, input),
    weaverPaymentVoid: async (id, reason) => weavers.voidWeaverPayment(db, id, reason),

    sampleDataLoad: async () => loadSampleData(db),

    dataInfo: async () => {
      if (!dataDir) throw new UserError(DESKTOP_ONLY);
      // Recent writes sit in the -wal file until SQLite folds them in, so the data's real size is both files.
      const size = ['invoiceon.db', 'invoiceon.db-wal'].reduce((sum, f) => sum + (existsSync(join(dataDir, f)) ? statSync(join(dataDir, f)).size : 0), 0);
      return { folder: dataDir, databaseBytes: size, backups: listBackups(join(dataDir, 'backups')) };
    },
    backupNow: async () => {
      if (!dataDir) throw new UserError(DESKTOP_ONLY);
      return backupNow(db, join(dataDir, 'backups'));
    },
    backupRestore: async (name) => {
      if (!dataDir) throw new UserError(DESKTOP_ONLY);
      return restoreBackup(db, join(dataDir, 'backups'), name);
    },

    accessStatus: async () => access.status(db, session),
    accessLogin: async (userId, pin) => access.login(db, session, userId, pin),
    accessLogout: async () => access.logout(db, session),
    accessEnable: async (ownerName, pin) => access.enable(db, session, ownerName, pin),
    accessDisable: async (pin) => access.disable(db, session, pin),
    accessUsers: async () => access.listUsers(db),
    accessUserSave: async (id, input) => access.saveUser(db, who(), id, input),
    accessChangePin: async (oldPin, newPin) => access.changeOwnPin(db, session, oldPin, newPin),

    auditList: async (query) => listAudit(db, query ?? {}),
    integrityCheck: async () => integrityCheck(db),
  };
  // Every change made through the API is recorded in the activity log once it has succeeded; reads pass straight through. Roles are
  // enforced outside that, so a call that is refused is never logged as having happened.
  return access.withAccess(db, withAudit(db, api, who), session);
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
