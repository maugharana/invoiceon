import { formatMoney } from '../../shared/money';
import type { AuditEntry, AuditQuery } from '../../shared/types';
import { all, run, type Db } from '../db/connection';
import { newId, nowIso } from './common';
import { getSettings } from './settings';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- arguments and results of many different calls

interface Rule {
  label: string;
  entity: string;
  /** Looks at the books just before the change, for a summary that says what was different. */
  before?: (db: Db) => unknown;
  /** The id of the thing touched: from the result by default, or from the first argument. */
  id?: (args: Any[], result: Any) => string;
  summary?: (args: Any[], result: Any, before: Any) => string;
}

const money = (p: unknown) => (typeof p === 'number' ? formatMoney(p, { fractionDigits: p % 100 === 0 ? 0 : 2 }) : '');
const join = (...parts: unknown[]) => parts.filter((p) => typeof p === 'string' && p !== '').join(' · ');
const first = (a: Any[]) => (typeof a[0] === 'string' ? a[0] : '');
const resultId = (_a: Any[], r: Any) => (r && typeof r === 'object' && typeof r.id === 'string' ? r.id : '');

const named = (key = 'name') => (_a: Any[], r: Any) => (r && typeof r === 'object' && typeof r[key] === 'string' ? r[key] : '');
const arg0Id = (a: Any[]) => first(a);

/**
 * Which calls change something, and how each reads in the activity log. Reading, searching and printing are not listed, so they are
 * never logged. The summary is a short description (a number, a name, an amount), never the full record.
 */
const RULES: Record<string, Rule> = {
  saveSettings: {
    label: 'Changed settings',
    entity: 'settings',
    before: (db) => getSettings(db),
    // The settings screen saves everything at once, so name only what is actually different.
    summary: (a, _r, before) => {
      const changed = Object.keys(a[0] ?? {}).filter((k) => JSON.stringify((a[0] ?? {})[k]) !== JSON.stringify(before?.[k]));
      return changed.length === 0 ? 'nothing different' : changed.length > 8 ? `${changed.length} settings` : changed.join(', ');
    },
  },
  sampleDataLoad: { label: 'Loaded the sample data', entity: 'data' },
  backupNow: { label: 'Made a backup', entity: 'data' },
  dataExportAll: { label: 'Exported all the data', entity: 'data' },

  designCreate: { label: 'Added a design', entity: 'design', summary: (_a, r) => join(r?.code, r?.name) },
  designUpdate: { label: 'Changed a design', entity: 'design', id: arg0Id, summary: (_a, r) => join(r?.code, r?.name) },
  designDuplicate: { label: 'Copied a design', entity: 'design', summary: (_a, r) => join(r?.code, r?.name) },
  designArchive: { label: 'Archived a design', entity: 'design', id: arg0Id },
  designRestore: { label: 'Brought a design back', entity: 'design', summary: (_a, r) => join(r?.code, r?.name) },
  designsBulk: { label: 'Changed several designs', entity: 'design', id: () => '', summary: (a, r) => join(a[0]?.kind, `${r?.designs ?? 0} designs`) },
  inventoryBulkAdd: { label: 'Added sarees from a sheet', entity: 'design', id: () => '', summary: (_a, r) => join(`${r?.designsCreated ?? 0} new designs`, `${r?.variantsCreated ?? 0} pieces`) },
  variantCreate: { label: 'Added a colour and size', entity: 'design', id: (_a, r) => r?.designId ?? '', summary: (_a, r) => join(r?.sku) },
  variantUpdate: { label: 'Changed a colour and size', entity: 'design', id: (_a, r) => r?.designId ?? '', summary: (_a, r) => join(r?.sku) },
  variantArchive: { label: 'Archived a colour and size', entity: 'variant', id: arg0Id },
  variantRestore: { label: 'Brought a colour and size back', entity: 'design', id: (_a, r) => r?.designId ?? '', summary: (_a, r) => join(r?.sku) },
  stockAdjust: { label: 'Adjusted stock', entity: 'design', id: (_a, r) => r?.designId ?? '', summary: (a, r) => join(r?.sku, `${(a[0]?.delta ?? 0) > 0 ? '+' : ''}${a[0]?.delta ?? ''}`, a[0]?.reason) },
  stockTakeApply: { label: 'Applied a stock-take', entity: 'stock', id: () => '', summary: (_a, r) => join(`${r?.checked ?? 0} counted`, `${r?.adjusted ?? 0} adjusted`) },
  stockTransfer: { label: 'Moved stock between places', entity: 'variant', id: (a) => a[0]?.variantId ?? '', summary: (_a, r) => join(`${r?.qty ?? ''} from ${r?.fromName ?? ''} to ${r?.toName ?? ''}`) },
  locationCreate: { label: 'Added a place for stock', entity: 'location', summary: (_a, r) => r?.name ?? '' },
  locationRename: { label: 'Renamed a place for stock', entity: 'location', summary: (_a, r) => r?.name ?? '' },
  locationArchive: { label: 'Removed a place for stock', entity: 'location', id: arg0Id },

  materialCreate: { label: 'Added a raw material', entity: 'material', summary: named() },
  materialUpdate: { label: 'Changed a raw material', entity: 'material', summary: (_a, r) => join(r?.name, money(r?.unitCostPaise)) },
  materialDelete: { label: 'Deleted a raw material', entity: 'material', id: arg0Id },
  materialAdjust: { label: 'Adjusted raw-material stock', entity: 'material', id: (a) => a[0]?.materialId ?? '', summary: (a, r) => join(r?.name, `${a[0]?.delta ?? ''} ${r?.unit ?? ''}`.trim(), a[0]?.reason) },
  purchaseCreate: { label: 'Recorded a purchase', entity: 'purchase', summary: (_a, r) => join(r?.supplierName, r?.billNo, money(r?.totalPaise)) },
  purchaseDelete: { label: 'Took back a purchase', entity: 'purchase', id: arg0Id },

  customerCreate: { label: 'Added a customer', entity: 'customer', summary: named() },
  customerUpdate: { label: 'Changed a customer', entity: 'customer', id: arg0Id, summary: named() },
  customerArchive: { label: 'Archived a customer', entity: 'customer', id: arg0Id },
  customerRestore: { label: 'Brought a customer back', entity: 'customer', summary: named() },
  customerMerge: { label: 'Merged two customers', entity: 'customer', summary: (_a, r) => `Kept ${r?.name ?? ''}` },
  customersImport: { label: 'Imported customers from a sheet', entity: 'customer', id: () => '', summary: (_a, r) => `${r?.created ?? 0} added` },

  invoiceCreate: { label: 'Issued an invoice', entity: 'invoice', summary: (_a, r) => join(r?.number, r?.buyerName, money(r?.totalPaise)) },
  invoiceCancel: { label: 'Cancelled an invoice', entity: 'invoice', id: arg0Id, summary: (a, r) => join(r?.number, a[1]) },
  invoiceApplyAdvance: { label: 'Applied an advance to an invoice', entity: 'invoice', id: arg0Id, summary: (_a, r) => r?.number ?? '' },
  invoiceSetDelivery: { label: 'Updated delivery', entity: 'invoice', id: arg0Id, summary: (a, r) => join(r?.number, a[1]?.status) },
  proformaCreate: { label: 'Made a proforma', entity: 'proforma', summary: (_a, r) => join(r?.number, r?.buyerName, money(r?.totalPaise)) },
  proformaUpdate: { label: 'Changed a proforma', entity: 'proforma', id: arg0Id, summary: (_a, r) => join(r?.number, money(r?.totalPaise)) },
  proformaCancel: { label: 'Cancelled a proforma', entity: 'proforma', id: arg0Id, summary: (_a, r) => r?.number ?? '' },
  proformaConvert: { label: 'Invoiced a proforma', entity: 'invoice', summary: (_a, r) => join(r?.number, money(r?.totalPaise)) },
  proformaSetStage: { label: 'Moved a proforma along', entity: 'proforma', id: arg0Id, summary: (a, r) => join(r?.number, a[1], a[2]) },
  quoteTemplateSave: { label: 'Saved a quote template', entity: 'template', summary: named() },
  quoteTemplateDelete: { label: 'Deleted a quote template', entity: 'template', id: arg0Id },

  paymentRecord: { label: 'Recorded a payment', entity: 'payment', summary: (_a, r) => join(money(r?.amountPaise), r?.customerName, r?.method) },
  paymentVoid: { label: 'Reversed a payment', entity: 'payment', id: arg0Id, summary: (a, r) => join(money(r?.amountPaise), r?.customerName, a[1]) },
  paymentChequeStatus: { label: 'Moved a cheque along', entity: 'payment', id: arg0Id, summary: (a, r) => join(money(r?.amountPaise), r?.customerName, a[1]) },
  paymentsReconcile: { label: 'Matched payments to the bank statement', entity: 'payment', id: () => '', summary: (a, r) => `${r ?? 0} ${a[1] === null ? 'untick' : 'ticked'}` },
  photoAdd: { label: 'Added a picture', entity: 'design', id: (a) => a[0]?.ownerId ?? '', summary: (a) => a[0]?.ownerType ?? '' },
  photoDelete: { label: 'Removed a picture', entity: 'photo', id: arg0Id },
  creditNoteCreate: { label: 'Issued a credit note', entity: 'invoice', id: (_a, r) => r?.invoiceId ?? '', summary: (_a, r) => join(r?.number, r?.buyerName, money(r?.totalPaise)) },
  paymentRefund: { label: 'Refunded a customer', entity: 'payment', id: (_a, r) => r?.[0]?.id ?? '', summary: (a, r) => join(r?.[0]?.customerName, money(a[0]?.amountPaise)) },
  paymentWriteOff: { label: 'Wrote off a balance', entity: 'payment', summary: (_a, r) => join(money(r?.amountPaise), r?.note) },
  transferCreate: { label: 'Moved money between accounts', entity: 'transfer', summary: (_a, r) => money(r?.amountPaise) },
  transferDelete: { label: 'Undid a move of money', entity: 'transfer', id: arg0Id },
  dayCloseSave: { label: 'Closed the day', entity: 'day', id: arg0Id, summary: (_a, r) => join(r?.day, `counted ${money(r?.countedPaise)}`, `expected ${money(r?.expectedPaise)}`) },
  instalmentsSet: { label: 'Set an instalment plan', entity: 'invoice', id: arg0Id, summary: (a) => `${a[1]?.length ?? 0} instalments` },
  instalmentsClear: { label: 'Removed an instalment plan', entity: 'invoice', id: arg0Id },

  expenseCreate: { label: 'Recorded an expense', entity: 'expense', summary: (_a, r) => join(money(r?.amountPaise), r?.category, r?.vendor) },
  expenseUpdate: { label: 'Changed an expense', entity: 'expense', id: arg0Id, summary: (_a, r) => join(money(r?.amountPaise), r?.category) },
  expenseDelete: { label: 'Deleted an expense', entity: 'expense', id: arg0Id },
  expenseRestore: { label: 'Brought an expense back', entity: 'expense', summary: (_a, r) => join(money(r?.amountPaise), r?.category) },
  expenseMarkPaid: { label: 'Paid a bill', entity: 'expense', id: arg0Id, summary: (_a, r) => join(money(r?.amountPaise), r?.vendor || r?.category) },
  expensesBulkAdd: { label: 'Added expenses from a sheet', entity: 'expense', id: () => '', summary: (_a, r) => `${r ?? 0} added` },
  vendorCreate: { label: 'Added a vendor', entity: 'vendor', summary: named() },
  vendorUpdate: { label: 'Changed a vendor', entity: 'vendor', id: arg0Id, summary: named() },
  vendorArchive: { label: 'Archived a vendor', entity: 'vendor', id: arg0Id },
  recurringCreate: { label: 'Added a standing expense', entity: 'expense', summary: (_a, r) => join(r?.category, money(r?.amountPaise)) },
  recurringUpdate: { label: 'Changed a standing expense', entity: 'expense', id: arg0Id, summary: (_a, r) => join(r?.category, money(r?.amountPaise)) },
  recurringDelete: { label: 'Removed a standing expense', entity: 'expense', id: arg0Id },
  recurringRun: { label: 'Entered standing expenses that came due', entity: 'expense', id: () => '', summary: (_a, r) => `${r ?? 0} entries` },
};

/** Whether a call is one that gets logged. */
export const isAudited = (method: string): boolean => method in RULES;

/** Takes the look at the books some calls need before they change anything. */
export function auditBefore(db: Db, method: string): unknown {
  try {
    return RULES[method]?.before?.(db);
  } catch {
    return undefined;
  }
}

/** Writes one line to the activity log. It never throws: the log must not be the reason a real change fails. */
export function recordAudit(db: Db, method: string, args: unknown[], result: unknown, before?: unknown): void {
  const rule = RULES[method];
  if (!rule) return;
  try {
    const id = (rule.id ?? resultId)(args, result);
    const summary = rule.summary ? rule.summary(args, result, before) : '';
    run(db, 'INSERT INTO audit_log (id, at, action, label, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?, ?)', newId(), nowIso(), method, rule.label, rule.entity, id, String(summary ?? '').slice(0, 300));
  } catch (err) {
    console.error('[audit] could not write the log', err);
  }
}

/** The most recent activity first. */
export function listAudit(db: Db, query: AuditQuery = {}): AuditEntry[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (query.entityType) {
    where.push('entity_type = ?');
    params.push(query.entityType);
  }
  // The log keeps UTC timestamps, and a day means the whole of that day.
  if (query.from) {
    where.push('at >= ?');
    params.push(`${query.from}T00:00:00.000Z`);
  }
  if (query.to) {
    where.push('at < ?');
    params.push(new Date(Date.parse(`${query.to}T00:00:00.000Z`) + 86_400_000).toISOString());
  }
  const search = (query.search ?? '').trim().toLowerCase();
  const limit = Math.min(Math.max(query.limit ?? 300, 1), 1000);
  return all<{ id: string; at: string; action: string; label: string; entity_type: string; entity_id: string; summary: string }>(
    db,
    `SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC, rowid DESC`,
    ...params,
  )
    .filter((r) => !search || `${r.label} ${r.summary} ${r.entity_type}`.toLowerCase().includes(search))
    .slice(0, limit)
    .map((r) => ({ id: r.id, at: r.at, action: r.action, label: r.label, entityType: r.entity_type, entityId: r.entity_id, summary: r.summary }));
}
