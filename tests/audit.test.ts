import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Api } from '../shared/api';
import { appendAudit, listAudit, verifyAuditChain } from '../electron/audit';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import { integrityCheck } from '../electron/services/integrity';
import * as payments from '../electron/services/payments';
import { loadSampleData } from '../electron/services/seed';
import { addDays, todayIso } from '../shared/gst';

const today = todayIso();
const rupees = (n: number) => n * 100;
let db: Db;
let api: Api;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'invoiceon-audit-'));
  db = openDb(join(dir, 'invoiceon.db'));
  api = createApi(db, undefined, dir, () => ({ id: 'u1', name: 'Rafiq' }));
});

async function setup() {
  await api.saveSettings({ state: 'Uttar Pradesh', gstin: '09AAACH7409R1ZZ' });
  const d = await api.designCreate({ code: 'MG-001', name: 'Butidar', fabric: 'Silk', hsnCode: '5007', description: '', defaultPricePaise: rupees(9800) });
  const v = await api.variantCreate(d.id, { color: 'Maroon', size: '6.3 m', sellPricePaise: rupees(9800), baseCostPaise: rupees(1800), reorderLevel: 1, openingStock: 5, bom: [] });
  return { d, v };
}
const sale = (variantId: string, qty = 1) => ({ type: 'B2C' as const, customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId, qty, unitPricePaise: rupees(9800) }] });

describe('the activity log', () => {
  it('records changes in plain words, with who made them', async () => {
    const { v } = await setup();
    const inv = await api.invoiceCreate(sale(v.id));
    await api.invoiceCancel(inv.id, 'wrong customer');
    const log = await api.auditList();
    const said = log.map((e) => e.summary);
    expect(said).toContain('Cancelled invoice ' + inv.number + ' (wrong customer)');
    expect(said).toContain(`Issued invoice ${inv.number} to Walk-in customer for ₹10,290`);
    expect(said.some((s) => s.startsWith('Added design MG-001 Butidar'))).toBe(true);
    expect(log[0]).toMatchObject({ actor: 'Rafiq', action: 'Cancelled invoice', entity: 'invoice', entityId: inv.id });
    expect(log.every((e) => e.actor === 'Rafiq')).toBe(true);
  });

  it('notes what changed when a price or cost is edited, old and new', async () => {
    const { v } = await setup();
    await api.variantUpdate(v.id, { color: 'Maroon', size: '6.3 m', sellPricePaise: rupees(10500), mrpPaise: 0, baseCostPaise: rupees(1800), reorderLevel: 1, bom: [] });
    const entry = (await api.auditList({ entity: 'variant' }))[0]!;
    expect(entry.summary).toContain('selling price ₹9,800 to ₹10,500');
    expect(entry.detail).toMatchObject({ sellPricePaise: { from: rupees(9800), to: rupees(10500) } });
    // a save that changes nothing is not worth a line
    const before = (await api.auditList()).length;
    await api.saveSettings({ businessName: (await api.getSettings()).businessName });
    expect((await api.auditList()).length).toBe(before);
  });

  it('records stock adjustments and settings changes by name, without dumping large values', async () => {
    const { v } = await setup();
    await api.stockAdjust({ variantId: v.id, delta: -2, reason: 'damage', note: 'moth' });
    await api.saveSettings({ invoiceLogo: `data:image/png;base64,${'A'.repeat(500)}`, city: 'Mau' });
    const log = await api.auditList();
    expect(log.find((e) => e.entity === 'stock')!.summary).toBe('Stock of MG-001-MAR-6.3M -2 (damage: moth), now 3');
    const settingsEntry = log.find((e) => e.summary.startsWith('Changed settings'))!;
    expect(settingsEntry.summary).toContain('invoiceLogo');
    expect(JSON.stringify(settingsEntry.detail)).not.toContain('AAAAAAAAAA'); // the logo is named, not stored
  });

  it('does not record an action that failed, or a read', async () => {
    const { v } = await setup();
    const before = (await api.auditList()).length;
    await expect(api.invoiceCreate(sale(v.id, 99))).rejects.toThrow(/Not enough stock/);
    await api.invoicesList();
    await api.dashboardOverview(null);
    expect((await api.auditList()).length).toBe(before);
  });

  it('filters by kind, date and words', async () => {
    const { v } = await setup();
    await api.invoiceCreate(sale(v.id));
    expect((await api.auditList({ entity: 'invoice' })).every((e) => e.entity === 'invoice')).toBe(true);
    expect((await api.auditList({ search: 'butidar' })).length).toBeGreaterThan(0);
    expect(await api.auditList({ from: addDays(today, 1) })).toHaveLength(0);
    expect((await api.auditList({ to: today })).length).toBeGreaterThan(0);
    expect(await api.auditList({ limit: 2 })).toHaveLength(2);
  });
});

describe('the log cannot be quietly rewritten', () => {
  it('refuses updates and deletes from the app itself', async () => {
    await setup();
    expect(() => db.exec("UPDATE audit_log SET summary = 'nothing happened'")).toThrow(/cannot be changed/);
    expect(() => db.exec('DELETE FROM audit_log')).toThrow(/cannot be changed/);
  });

  it('shows a chain that is intact, then notices an edit made behind the app’s back', async () => {
    await setup();
    expect(verifyAuditChain(db)).toMatchObject({ problems: [] });
    // Someone with a database editor removes the protection and rewrites one entry.
    db.exec('DROP TRIGGER audit_log_no_update');
    db.exec("UPDATE audit_log SET summary = 'Added design MG-999 Something else' WHERE rowid = 2");
    const chain = verifyAuditChain(db);
    expect(chain.problems).toHaveLength(1);
    expect(chain.problems[0]).toMatch(/Entry 2 .* has been altered/);
    expect(integrityCheck(db).checks.find((c) => c.id === 'audit')!.problemCount).toBe(1);
  });

  it('notices an entry that was removed', async () => {
    await setup();
    db.exec('DROP TRIGGER audit_log_no_delete');
    db.exec('DELETE FROM audit_log WHERE rowid = 2');
    expect(verifyAuditChain(db).problems[0]).toMatch(/does not follow on from the one before it/);
  });

  it('is left alone by a restore, which is itself recorded', async () => {
    await setup();
    const { name } = await api.backupNow();
    const invoiceFor = (await api.variantsForSale())[0]!;
    await api.invoiceCreate(sale(invoiceFor.variantId));
    const entriesBefore = (await api.auditList()).length;
    await api.backupRestore(name);
    const log = await api.auditList();
    expect(log.length).toBe(entriesBefore + 1); // nothing lost, the restore added
    expect(log[0]).toMatchObject({ entity: 'backup', action: 'Restored backup' });
    expect(log.some((e) => e.action === 'Issued invoice')).toBe(true); // still says the invoice was issued, though the restore undid it
    expect(await api.invoicesList()).toHaveLength(0);
    expect(verifyAuditChain(db).problems).toEqual([]);
  });

  it('chains entries appended directly, too', () => {
    appendAudit(db, { id: null, name: 'Owner' }, { action: 'A', entity: 'x', summary: 'one' });
    appendAudit(db, { id: null, name: 'Owner' }, { action: 'B', entity: 'x', summary: 'two', detail: { k: 1 } });
    expect(listAudit(db).map((e) => e.summary)).toEqual(['two', 'one']);
    expect(verifyAuditChain(db)).toEqual({ checked: 2, problems: [] });
  });
});

describe('the integrity check', () => {
  it('finds nothing wrong with the sample data, which touches every part', () => {
    loadSampleData(db);
    const report = integrityCheck(db);
    expect(report.checks.map((c) => c.id)).toEqual(['database', 'stock', 'invoices', 'proformas', 'numbering', 'payments', 'balances', 'credit-notes', 'purchases', 'audit']);
    expect(report.checks.filter((c) => c.problemCount > 0)).toEqual([]);
    expect(report.problemCount).toBe(0);
    expect(report.checks.find((c) => c.id === 'invoices')!.checked).toBeGreaterThan(0);
  });

  it('stays clean through returns, payments, cancellations and stock changes', async () => {
    const { v } = await setup();
    const inv = await api.invoiceCreate(sale(v.id, 2));
    await api.paymentRecord({ customerId: null, amountPaise: rupees(5000), method: 'cash', reference: '', receivedOn: today, note: '', allocations: [{ invoiceId: inv.id, amountPaise: rupees(5000) }] });
    await api.stockAdjust({ variantId: v.id, delta: -1, reason: 'damage' });
    const other = await api.invoiceCreate(sale(v.id));
    await api.invoiceCancel(other.id, '');
    expect(integrityCheck(db).problemCount).toBe(0);
  });

  it('spots stock that no longer matches its history', async () => {
    const { v } = await setup();
    db.prepare('UPDATE variants SET stock = stock + 3 WHERE id = ?').run(v.id);
    const c = integrityCheck(db).checks.find((x) => x.id === 'stock')!;
    expect(c.problemCount).toBe(1);
    expect(c.problems[0]).toContain('MG-001-MAR-6.3M: 8 on the shelf, but its history adds up to 5');
  });

  it('spots an invoice whose figures were changed', async () => {
    const { v } = await setup();
    const inv = await api.invoiceCreate(sale(v.id));
    db.prepare('UPDATE invoices SET total_paise = total_paise + 5000 WHERE id = ?').run(inv.id);
    const c = integrityCheck(db).checks.find((x) => x.id === 'invoices')!;
    expect(c.problems[0]).toContain(`Invoice ${inv.number}: taxable value, tax and round-off come to`);
  });

  it('spots a missing invoice number', async () => {
    const { v } = await setup();
    await api.invoiceCreate(sale(v.id));
    const second = await api.invoiceCreate(sale(v.id));
    await api.invoiceCreate(sale(v.id));
    db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').run(second.id);
    db.prepare('DELETE FROM invoices WHERE id = ?').run(second.id);
    const c = integrityCheck(db).checks.find((x) => x.id === 'numbering')!;
    expect(c.problems[0]).toMatch(/invoice 2 is missing \(the numbers jump to 3\)/);
  });

  it('spots a payment applied beyond what was paid, and a customer whose balance disagrees', async () => {
    const { v } = await setup();
    const inv = await api.invoiceCreate({ ...sale(v.id), customerId: (await api.customerCreate({ name: 'Sunita', type: 'B2C', phone: '', email: '', gstin: '', address: '', city: '', state: '', pincode: '', notes: '' })).id });
    const p = payments.recordPayment(db, { customerId: inv.customerId, amountPaise: rupees(1000), method: 'cash', reference: '', receivedOn: today, note: '', allocations: [{ invoiceId: inv.id, amountPaise: rupees(1000) }] });
    db.prepare('UPDATE payment_allocations SET amount_paise = ? WHERE payment_id = ?').run(rupees(4000), p.id);
    const payCheck = integrityCheck(db).checks.find((x) => x.id === 'payments')!;
    expect(payCheck.problemCount).toBeGreaterThan(0);
    expect(payCheck.problems.join(' ')).toContain('has ₹4,000.00 applied to invoices');
  });

  it('reports each problem once and keeps the count when there are many', async () => {
    const { v } = await setup();
    await api.stockAdjust({ variantId: v.id, delta: 30, reason: 'purchase' });
    for (let i = 0; i < 20; i++) await api.invoiceCreate(sale(v.id));
    db.prepare('UPDATE invoices SET subtotal_paise = subtotal_paise + 1').run();
    const c = integrityCheck(db).checks.find((x) => x.id === 'invoices')!;
    expect(c.problemCount).toBeGreaterThanOrEqual(20);
    expect(c.problems.length).toBeLessThanOrEqual(12);
  });
});
