import { createHash } from 'node:crypto';
import { localDateOf } from '../shared/gst';
import { formatMoney } from '../shared/money';
import type { Api } from '../shared/api';
import type { AuditEntry, AuditQuery } from '../shared/types';
import { all, get, run, type Db } from './db/connection';
import { newId, nowIso } from './services/common';
import { getCustomer } from './services/customers';
import { getDesign, getVariant } from './services/inventory';
import { listMaterials } from './services/materials';
import { getSettings } from './services/settings';

// The activity log. Every change made through the API is recorded after it succeeds: who, when, and a sentence saying what. The log is
// append only (triggers refuse edits and deletes) and hash chained (each entry carries the hash of the one before it), so tampering
// behind the app's back is detectable. A failure to write the log never fails the action being logged.

export interface Actor {
  id: string | null;
  name: string;
}

const GENESIS = '0'.repeat(64);
const money = (p: number) => formatMoney(p, { fractionDigits: 0 });

interface Row {
  id: string;
  at: string;
  actor: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  summary: string;
  detail_json: string | null;
  prev_hash: string;
  hash: string;
}

const hashOf = (prev: string, r: Omit<Row, 'prev_hash' | 'hash'>): string =>
  createHash('sha256').update(JSON.stringify([prev, r.id, r.at, r.actor, r.actor_id, r.action, r.entity, r.entity_id, r.summary, r.detail_json])).digest('hex');

export function appendAudit(db: Db, actor: Actor, e: { action: string; entity: string; entityId?: string | null; summary: string; detail?: Record<string, unknown> | null }): void {
  const prev = get<{ hash: string }>(db, 'SELECT hash FROM audit_log ORDER BY rowid DESC LIMIT 1')?.hash ?? GENESIS;
  const row = { id: newId(), at: nowIso(), actor: actor.name, actor_id: actor.id, action: e.action, entity: e.entity, entity_id: e.entityId ?? null, summary: e.summary.slice(0, 500), detail_json: e.detail ? JSON.stringify(e.detail) : null };
  run(db, 'INSERT INTO audit_log (id, at, actor, actor_id, action, entity, entity_id, summary, detail_json, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', row.id, row.at, row.actor, row.actor_id, row.action, row.entity, row.entity_id, row.summary, row.detail_json, prev, hashOf(prev, row));
}

export function listAudit(db: Db, query: AuditQuery = {}): AuditEntry[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (query.entity) {
    where.push('entity = ?');
    params.push(query.entity);
  }
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? 300) || 300, 1), 5000);
  const q = (query.search ?? '').trim().toLowerCase();
  return all<Row>(db, `SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY rowid DESC`, ...params)
    .filter((r) => (!query.from || localDateOf(r.at) >= query.from) && (!query.to || localDateOf(r.at) <= query.to))
    .filter((r) => !q || `${r.summary} ${r.actor} ${r.action} ${r.entity}`.toLowerCase().includes(q))
    .slice(0, limit)
    .map((r): AuditEntry => ({ id: r.id, at: r.at, actor: r.actor, action: r.action, entity: r.entity, entityId: r.entity_id, summary: r.summary, detail: r.detail_json ? (JSON.parse(r.detail_json) as Record<string, unknown>) : null }));
}

/** Walks the whole chain and says where it breaks. */
export function verifyAuditChain(db: Db): { checked: number; problems: string[] } {
  const problems: string[] = [];
  let prev = GENESIS;
  let checked = 0;
  for (const r of all<Row>(db, 'SELECT * FROM audit_log ORDER BY rowid')) {
    checked += 1;
    if (r.prev_hash !== prev) problems.push(`Entry ${checked} (${r.at.slice(0, 16).replace('T', ' ')}, "${r.summary.slice(0, 50)}") does not follow on from the one before it: something was removed or changed.`);
    else if (hashOf(prev, r) !== r.hash) problems.push(`Entry ${checked} (${r.at.slice(0, 16).replace('T', ' ')}, "${r.summary.slice(0, 50)}") has been altered.`);
    prev = r.hash;
  }
  return { checked, problems };
}

// ── What gets recorded, and how it reads ────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type A = any;
interface Ctx {
  args: A[];
  result: A;
  before: A;
}
interface Note {
  summary: string;
  entityId?: string | null;
  detail?: Record<string, unknown>;
}
interface Rule {
  entity: string;
  action: string;
  before?: (db: Db, args: A[]) => unknown;
  /** Return null to leave this call out of the log (nothing actually changed). */
  describe: (c: Ctx) => Note | null;
}

/** What changed between two records, for the fields worth naming. Money fields are shown as rupees. */
function changes(before: A, after: A, fields: Record<string, string>): { text: string; detail: Record<string, unknown> } {
  const parts: string[] = [];
  const detail: Record<string, unknown> = {};
  for (const [key, label] of Object.entries(fields)) {
    if (!before || !after || JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    const isMoney = /Paise$/.test(key);
    const show = (v: unknown) => (v === null || v === undefined || v === '' ? 'none' : isMoney ? money(Number(v)) : String(v));
    parts.push(`${label} ${show(before[key])} to ${show(after[key])}`);
    detail[key] = { from: before[key], to: after[key] };
  }
  return { text: parts.join(', '), detail };
}

const id = (c: Ctx): string | null => c.result?.id ?? (typeof c.args[0] === 'string' ? c.args[0] : null);
const why = (reason: unknown) => (typeof reason === 'string' && reason.trim() ? ` (${reason.trim()})` : '');
const rule = (entity: string, action: string, describe: Rule['describe'], before?: Rule['before']): Rule => ({ entity, action, describe, before });
const simple = (entity: string, action: string, text: (c: Ctx) => string): Rule => rule(entity, action, (c) => ({ summary: text(c), entityId: id(c) }));

const DESIGN_FIELDS = { code: 'code', name: 'name', fabric: 'fabric', hsnCode: 'HSN', defaultPricePaise: 'default price', gstRatePercent: 'GST rate' };
const VARIANT_FIELDS = { sku: 'SKU', color: 'colour', size: 'size', sellPricePaise: 'selling price', mrpPaise: 'MRP', baseCostPaise: 'making cost', reorderLevel: 'reorder level' };
const CUSTOMER_FIELDS = { name: 'name', type: 'type', phone: 'phone', gstin: 'GSTIN', state: 'state', city: 'city' };

const RULES: Partial<Record<keyof Api, Rule>> = {
  saveSettings: rule(
    'settings',
    'Changed settings',
    (c) => {
      const after = c.result as A;
      const before = c.before as A;
      const keys = Object.keys(c.args[0] ?? {}).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
      if (keys.length === 0) return null;
      // Small values are kept so the log can show them; bulky ones (a logo) are only named.
      const detail: Record<string, unknown> = {};
      for (const k of keys) {
        const from = JSON.stringify(before[k]);
        const to = JSON.stringify(after[k]);
        detail[k] = from.length < 120 && to.length < 120 ? { from: before[k], to: after[k] } : 'changed';
      }
      return { summary: `Changed settings: ${keys.join(', ')}`, detail };
    },
    (db) => getSettings(db),
  ),
  designCreate: simple('design', 'Added design', (c) => `Added design ${c.result.code} ${c.result.name}`),
  designUpdate: rule('design', 'Edited design', (c) => {
    const ch = changes(c.before, c.result, DESIGN_FIELDS);
    return { summary: `Edited design ${c.result.code} ${c.result.name}${ch.text ? `: ${ch.text}` : ''}`, entityId: c.result.id, detail: ch.detail };
  }, (db, a) => getDesign(db, a[0])),
  designArchive: rule('design', 'Archived design', (c) => ({ summary: `Archived design ${c.before.code} ${c.before.name}`, entityId: c.args[0] }), (db, a) => getDesign(db, a[0])),
  inventoryBulkAdd: rule('design', 'Added sarees in bulk', (c) => ({ summary: `Added sarees from the sheet: ${c.result.variantsCreated} pieces, ${c.result.designsCreated} new designs, ${c.result.designsExtended} extended` })),
  variantCreate: simple('variant', 'Added variant', (c) => `Added ${c.result.sku} at ${money(c.result.sellPricePaise)}`),
  variantUpdate: rule('variant', 'Edited variant', (c) => {
    const ch = changes(c.before, c.result, VARIANT_FIELDS);
    return { summary: `Edited ${c.result.sku}${ch.text ? `: ${ch.text}` : ''}`, entityId: c.result.id, detail: ch.detail };
  }, (db, a) => getVariant(db, a[0])),
  variantArchive: rule('variant', 'Archived variant', (c) => ({ summary: `Archived ${c.before.sku}`, entityId: c.args[0] }), (db, a) => getVariant(db, a[0])),
  stockAdjust: rule('stock', 'Adjusted stock', (c) => ({
    summary: `Stock of ${c.result.sku} ${c.args[0].delta > 0 ? '+' : ''}${c.args[0].delta} (${c.args[0].reason}${c.args[0].note ? `: ${c.args[0].note}` : ''}), now ${c.result.stock}`,
    entityId: c.result.id,
    detail: { delta: c.args[0].delta, reason: c.args[0].reason, balance: c.result.stock },
  })),
  materialCreate: simple('material', 'Added material', (c) => `Added raw material ${c.result.name} at ${money(c.result.unitCostPaise)} per ${c.result.unit}`),
  materialUpdate: rule('material', 'Edited material', (c) => {
    const ch = changes(c.before, c.result, { name: 'name', unit: 'unit', unitCostPaise: 'cost' });
    return { summary: `Edited raw material ${c.result.name}${ch.text ? `: ${ch.text}` : ''}`, entityId: c.result.id, detail: ch.detail };
  }, (db, a) => listMaterials(db).find((m) => m.id === a[0])),
  materialDelete: rule('material', 'Deleted material', (c) => ({ summary: `Deleted raw material ${c.before?.name ?? ''}`, entityId: c.args[0] }), (db, a) => listMaterials(db).find((m) => m.id === a[0])),
  customerCreate: simple('customer', 'Added customer', (c) => `Added customer ${c.result.name}`),
  customerUpdate: rule('customer', 'Edited customer', (c) => {
    const ch = changes(c.before, c.result, CUSTOMER_FIELDS);
    return { summary: `Edited customer ${c.result.name}${ch.text ? `: ${ch.text}` : ''}`, entityId: c.result.id, detail: ch.detail };
  }, (db, a) => getCustomer(db, a[0])),
  customerArchive: rule('customer', 'Archived customer', (c) => ({ summary: `Archived customer ${c.before.name}`, entityId: c.args[0] }), (db, a) => getCustomer(db, a[0])),

  invoiceCreate: simple('invoice', 'Issued invoice', (c) => `Issued invoice ${c.result.number} to ${c.result.buyerName} for ${money(c.result.totalPaise)}`),
  invoiceCancel: simple('invoice', 'Cancelled invoice', (c) => `Cancelled invoice ${c.result.number}${why(c.args[1])}`),
  invoiceApplyAdvance: simple('invoice', 'Applied advance', (c) => `Applied advance to invoice ${c.result.number}`),
  creditNoteCreate: simple('credit-note', 'Issued credit note', (c) => `Issued credit note ${c.result.number} against ${c.result.invoiceNumber} for ${money(c.result.totalPaise)}${c.result.refundPaise ? `, ${money(c.result.refundPaise)} refunded` : ''}`),
  creditNoteCancel: simple('credit-note', 'Cancelled credit note', (c) => `Cancelled credit note ${c.result.number}${why(c.args[1])}`),
  paymentRecord: simple('payment', 'Recorded payment', (c) => `Recorded payment of ${money(c.result.amountPaise)} from ${c.result.customerName} (${c.result.method})`),
  paymentVoid: simple('payment', 'Reversed payment', (c) => `Reversed payment of ${money(c.result.amountPaise)} from ${c.result.customerName}${why(c.args[1])}`),
  proformaCreate: simple('proforma', 'Created proforma', (c) => `Created proforma ${c.result.number} for ${c.result.buyerName}, ${money(c.result.totalPaise)}`),
  proformaCancel: simple('proforma', 'Cancelled proforma', (c) => `Cancelled proforma ${c.result.number}${why(c.args[1])}`),
  proformaConvert: simple('invoice', 'Converted proforma', (c) => `Converted a proforma into invoice ${c.result.number} for ${c.result.buyerName}, ${money(c.result.totalPaise)}`),
  expenseCreate: simple('expense', 'Recorded expense', (c) => `Recorded expense of ${money(c.result.amountPaise)} for ${c.result.category}`),
  expenseUpdate: simple('expense', 'Edited expense', (c) => `Edited expense: ${money(c.result.amountPaise)} for ${c.result.category}`),
  expenseDelete: simple('expense', 'Deleted expense', () => 'Deleted an expense'),

  supplierCreate: simple('supplier', 'Added supplier', (c) => `Added supplier ${c.result.name}`),
  supplierUpdate: simple('supplier', 'Edited supplier', (c) => `Edited supplier ${c.result.name}`),
  supplierArchive: simple('supplier', 'Archived supplier', () => 'Archived a supplier'),
  purchaseBillCreate: simple('purchase-bill', 'Entered bill', (c) => `Entered bill ${c.result.billNumber} from ${c.result.supplierName} for ${money(c.result.totalPaise)}`),
  purchaseBillCancel: simple('purchase-bill', 'Cancelled bill', (c) => `Cancelled bill ${c.result.billNumber} from ${c.result.supplierName}${why(c.args[1])}`),
  purchaseBillApplyAdvance: simple('purchase-bill', 'Applied advance', (c) => `Applied advance to bill ${c.result.billNumber}`),
  supplierPaymentRecord: simple('supplier-payment', 'Paid supplier', (c) => `Paid ${money(c.result.amountPaise)} to ${c.result.supplierName} (${c.result.method})`),
  supplierPaymentVoid: simple('supplier-payment', 'Reversed supplier payment', (c) => `Reversed payment of ${money(c.result.amountPaise)} to ${c.result.supplierName}${why(c.args[1])}`),

  weaverCreate: simple('weaver', 'Added weaver', (c) => `Added weaver ${c.result.name}`),
  weaverUpdate: simple('weaver', 'Edited weaver', (c) => `Edited weaver ${c.result.name}`),
  weaverArchive: simple('weaver', 'Archived weaver', () => 'Archived a weaver'),
  jobOrderCreate: simple('job-order', 'Placed order', (c) => `Placed order ${c.result.number} with ${c.result.weaverName}: ${c.result.qty} × ${c.result.designName} (${c.result.color}) at ${money(c.result.wagePaise)}`),
  jobOrderIssueMaterial: simple('job-order', 'Handed over material', (c) => `${c.args[0].qty < 0 ? 'Took back' : 'Handed over'} material on order ${c.result.number}`),
  jobOrderReceive: simple('job-order', 'Received pieces', (c) => `Received ${c.args[0].qty} on order ${c.result.number} from ${c.result.weaverName} into stock`),
  jobOrderReverseReceipt: simple('job-order', 'Reversed receipt', (c) => `Reversed a receipt on order ${c.result.number}${why(c.args[1])}`),
  jobOrderClose: simple('job-order', 'Closed order', (c) => `Closed order ${c.result.number} short${why(c.args[1])}`),
  jobOrderCancel: simple('job-order', 'Cancelled order', (c) => `Cancelled order ${c.result.number}${why(c.args[1])}`),
  weaverPaymentRecord: simple('weaver-payment', 'Paid weaver', (c) => `Paid ${money(c.result.amountPaise)} to weaver ${c.result.weaverName} (${c.result.method})`),
  weaverPaymentVoid: simple('weaver-payment', 'Reversed weaver payment', (c) => `Reversed payment of ${money(c.result.amountPaise)} to weaver ${c.result.weaverName}${why(c.args[1])}`),

  backupRestore: simple('backup', 'Restored backup', (c) => `Restored backup ${c.result.restoredFrom} (safety copy: ${c.result.restorePoint})`),
  sampleDataLoad: simple('settings', 'Loaded sample data', () => 'Loaded the sample data'),
};

/** The API, with every change recorded in the activity log once it has succeeded. Reads pass straight through. */
export function withAudit(db: Db, api: Api, actor: () => Actor): Api {
  const wrapped = { ...api } as Record<string, (...a: A[]) => Promise<A>>;
  for (const [method, r] of Object.entries(RULES) as [keyof Api, Rule][]) {
    const inner = (api as unknown as Record<string, (...a: A[]) => Promise<A>>)[method];
    wrapped[method] = async (...args: A[]) => {
      let before: unknown;
      try {
        before = r.before?.(db, args);
      } catch {
        before = undefined; // a record that is not there yet is simply not compared; the action itself will explain the problem
      }
      const result = await inner(...args);
      try {
        const note = r.describe({ args, result, before });
        if (note) appendAudit(db, actor(), { action: r.action, entity: r.entity, entityId: note.entityId ?? null, summary: note.summary, detail: note.detail ?? null });
      } catch (err) {
        console.error(`[audit] could not record ${method}`, err);
      }
      return result;
    };
  }
  return wrapped as unknown as Api;
}
