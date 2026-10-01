import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Api, Envelope } from '../shared/api';
import { backupNow, listBackups } from './backup';
import type { Db } from './db/connection';
import { UserError } from './services/common';
import * as customers from './services/customers';
import { dashboardNow, dashboardOverview } from './services/dashboard';
import { festivalComparison } from './services/festival';
import * as moreReports from './services/moreReports';
import { reorderList } from './services/deadstock';
import * as expenses from './services/expenses';
import * as inventory from './services/inventory';
import * as invoices from './services/invoices';
import * as materials from './services/materials';
import * as payments from './services/payments';
import * as proformas from './services/proformas';
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
}

const DESKTOP_ONLY = 'This works in the InvoiceOn desktop app only.';

/** Binds the data layer to one open database. This is the only place that knows which service backs which call. */
export function createApi(db: Db, host?: Host, dataDir?: string): Api {
  return {
    getSettings: async () => settings.getSettings(db),
    saveSettings: async (patch) => settings.saveSettings(db, patch),

    inventorySummary: async () => inventory.inventorySummary(db),

    designsList: async (query) => inventory.listDesigns(db, query ?? {}), // ?? because JSON turns undefined into null
    designGet: async (id) => inventory.getDesign(db, id),
    designNextCode: async () => inventory.nextDesignCode(db),
    designCreate: async (input) => inventory.createDesign(db, input),
    designUpdate: async (id, input) => inventory.updateDesign(db, id, input),
    designDuplicate: async (id) => inventory.duplicateDesign(db, id),
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
    customerPurchases: async (id) => customers.customerPurchases(db, id),
    customerMerge: async (keepId, duplicateId) => customers.mergeCustomers(db, keepId, duplicateId),
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

    paymentsList: async (query) => payments.listPayments(db, query ?? {}),
    paymentRecord: async (input) => payments.recordPayment(db, input),
    paymentVoid: async (id, reason) => payments.voidPayment(db, id, reason),
    invoiceApplyAdvance: async (invoiceId) => invoices.applyAdvanceToInvoice(db, invoiceId),
    paymentsSummary: async () => receivables.paymentsSummary(db),

    customerLedger: async (customerId) => receivables.customerLedger(db, customerId),
    duesReport: async () => receivables.duesReport(db),

    reportSales: async (range) => reports.salesReport(db, range),
    reportGst: async (range) => reports.gstReport(db, range),
    reportProfitLoss: async (range) => moreReports.profitAndLoss(db, range),
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
    expensesBreakdown: async (query) => expenses.expensesBreakdown(db, query ?? {}),
    expensesOverview: async (query) => expenses.expensesOverview(db, query ?? {}),
    expenseCreate: async (input) => expenses.createExpense(db, input),
    expenseUpdate: async (id, input) => expenses.updateExpense(db, id, input),
    expenseDelete: async (id) => expenses.deleteExpense(db, id),

    proformasList: async (query) => proformas.listProformas(db, query ?? {}),
    proformaGet: async (id) => proformas.getProforma(db, id),
    proformaNextNumber: async (date) => proformas.nextProformaNumber(db, date),
    proformaCreate: async (input) => proformas.createProforma(db, input),
    proformaUpdate: async (id, input) => proformas.updateProforma(db, id, input),
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
