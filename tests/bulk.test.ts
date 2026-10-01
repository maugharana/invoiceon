import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import * as bulk from '../electron/services/bulk';
import * as customers from '../electron/services/customers';
import { exportEverything } from '../electron/services/exportAll';
import * as expenses from '../electron/services/expenses';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import { todayIso } from '../shared/gst';
import type { CustomerInput, ExpenseInput } from '../shared/types';

const rupees = (n: number) => n * 100;
const today = todayIso();
let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});

const blank: CustomerInput = { name: 'A', type: 'B2C', phone: '', email: '', gstin: '', address: '', city: '', state: '', pincode: '', notes: '' };
const exp = (over: Partial<ExpenseInput> = {}): ExpenseInput => ({ date: today, category: 'Rent', vendor: '', amountPaise: rupees(100), method: 'cash', reference: '', note: '', ...over });

function shop() {
  const mk = (code: string, name: string) => {
    const d = inventory.createDesign(db, { code, name, fabric: 'Silk', hsnCode: '5007', description: '', defaultPricePaise: rupees(1000) });
    const red = inventory.createVariant(db, d.id, { color: 'Red', size: '6 m', sellPricePaise: rupees(1000), baseCostPaise: rupees(400), reorderLevel: 2, openingStock: 10, bom: [] });
    const blue = inventory.createVariant(db, d.id, { color: 'Blue', size: '6 m', sellPricePaise: rupees(2000), baseCostPaise: rupees(400), reorderLevel: 2, openingStock: 5, bom: [] });
    return { d, red, blue };
  };
  return { a: mk('MG-001', 'Alpha'), b: mk('MG-002', 'Beta') };
}

describe('importing customers', () => {
  it('adds each row, and skips ones already on file by phone or GSTIN (also within the sheet)', () => {
    customers.createCustomer(db, { ...blank, name: 'Existing', phone: '98765 43210' });
    const r = bulk.importCustomers(db, [
      { row: 2, value: { ...blank, name: 'Same phone', phone: '+91 9876543210' } },
      { row: 3, value: { ...blank, name: 'New one', phone: '9000000001' } },
      { row: 4, value: { ...blank, name: 'Same as row 3', phone: '09000000001' } },
      { row: 5, value: { ...blank, name: 'Firm', type: 'B2B', gstin: '09AABCK1234M1ZI' } },
      { row: 6, value: { ...blank, name: 'Firm again', type: 'B2B', gstin: '09aabck1234m1zi' } },
    ]);
    expect(r.created).toBe(2);
    expect(r.skipped.map((s) => [s.row, s.name])).toEqual([[2, 'Same phone'], [4, 'Same as row 3'], [6, 'Firm again']]);
    expect(customers.listCustomers(db)).toHaveLength(3);
  });

  it('adds nothing, and names the row, when one is invalid', () => {
    expect(() => bulk.importCustomers(db, [{ row: 2, value: { ...blank, name: 'Fine', phone: '1111111111' } }, { row: 3, value: { ...blank, name: 'Bad firm', type: 'B2B', gstin: 'nope' } }])).toThrow(/Row 3 \(Bad firm\): .*GSTIN.*Nothing was added/);
    expect(customers.listCustomers(db)).toHaveLength(0);
    expect(() => bulk.importCustomers(db, [])).toThrow(/no customers to add/);
  });
});

describe('adding expenses from a sheet', () => {
  it('adds them all, or none', () => {
    expect(bulk.bulkAddExpenses(db, [{ row: 2, value: exp() }, { row: 3, value: exp({ category: 'Tea', amountPaise: rupees(40) }) }])).toBe(2);
    expect(expenses.listExpenses(db)).toHaveLength(2);
    expect(() => bulk.bulkAddExpenses(db, [{ row: 2, value: exp({ category: 'Wages' }) }, { row: 3, value: exp({ amountPaise: 0 }) }])).toThrow(/Row 3 \(Rent\): .*Amount.*Nothing was added/);
    expect(expenses.listExpenses(db)).toHaveLength(2);
    expect(() => bulk.bulkAddExpenses(db, [])).toThrow(/no expenses/);
  });
});

describe('stock-take', () => {
  it('adjusts only what differs, with a note in the history, and reports the net change', () => {
    const { a } = shop();
    const r = bulk.applyStockTake(db, [{ variantId: a.red.id, counted: 8 }, { variantId: a.blue.id, counted: 5 }], 'October count');
    expect(r).toMatchObject({ checked: 2, adjusted: 1, pieceDifference: -2, changes: [{ variantId: a.red.id, before: 10, after: 8 }] });
    expect(inventory.getVariant(db, a.red.id).stock).toBe(8);
    expect(inventory.getVariant(db, a.blue.id).stock).toBe(5);
    const last = inventory.listMovements(db, a.red.id)[0]!;
    expect(last).toMatchObject({ delta: -2, reason: 'adjustment', note: 'October count' });
  });

  it('counts up as well as down, and changes nothing if any count is invalid', () => {
    const { a } = shop();
    expect(bulk.applyStockTake(db, [{ variantId: a.red.id, counted: 14 }]).pieceDifference).toBe(4);
    expect(() => bulk.applyStockTake(db, [{ variantId: a.red.id, counted: 1 }, { variantId: a.blue.id, counted: -1 }])).toThrow(/whole numbers/);
    expect(() => bulk.applyStockTake(db, [{ variantId: a.red.id, counted: 1 }, { variantId: a.red.id, counted: 2 }])).toThrow(/twice/);
    expect(() => bulk.applyStockTake(db, [])).toThrow(/nothing counted/);
    expect(inventory.getVariant(db, a.red.id).stock).toBe(14);
  });

  it('keeps stock from going negative by counting, and works through the API', async () => {
    const { a } = shop();
    expect((await createApi(db).stockTakeApply([{ variantId: a.red.id, counted: 0 }])).adjusted).toBe(1);
    expect(inventory.getVariant(db, a.red.id).stock).toBe(0);
  });
});

describe('bulk changes to designs', () => {
  it('sets the reorder level on every variant', () => {
    const { a, b } = shop();
    const r = bulk.bulkChangeDesigns(db, { ids: [a.d.id, b.d.id], kind: 'reorder', level: 7 });
    expect(r).toEqual({ designs: 2, variants: 4 });
    expect(inventory.loadVariants(db).every((v) => v.reorderLevel === 7)).toBe(true);
  });

  it('sets a price, or changes prices by a percentage, rounding to the paisa', () => {
    const { a, b } = shop();
    bulk.bulkChangeDesigns(db, { ids: [a.d.id], kind: 'price', mode: 'set', value: rupees(1500) });
    expect(inventory.loadVariants(db, { designId: a.d.id }).map((v) => v.sellPricePaise)).toEqual([rupees(1500), rupees(1500)]);
    bulk.bulkChangeDesigns(db, { ids: [b.d.id], kind: 'price', mode: 'percent', value: 10 });
    expect(inventory.getVariant(db, b.red.id).sellPricePaise).toBe(rupees(1100));
    expect(inventory.getVariant(db, b.blue.id).sellPricePaise).toBe(rupees(2200));
    bulk.bulkChangeDesigns(db, { ids: [b.d.id], kind: 'price', mode: 'percent', value: -50 });
    expect(inventory.getVariant(db, b.red.id).sellPricePaise).toBe(rupees(550));
  });

  it('keeps costing and stock when it changes a price', () => {
    const { a } = shop();
    bulk.bulkChangeDesigns(db, { ids: [a.d.id], kind: 'price', mode: 'percent', value: 5 });
    expect(inventory.getVariant(db, a.red.id)).toMatchObject({ baseCostPaise: rupees(400), stock: 10, sku: a.red.sku });
  });

  it('archives many designs, and does nothing at all if any step fails', () => {
    const { a, b } = shop();
    expect(() => bulk.bulkChangeDesigns(db, { ids: [a.d.id, 'missing'], kind: 'archive' })).toThrow(/no longer exists/);
    expect(inventory.listDesigns(db)).toHaveLength(2);
    expect(bulk.bulkChangeDesigns(db, { ids: [a.d.id, b.d.id], kind: 'archive' })).toEqual({ designs: 2, variants: 0 });
    expect(inventory.listDesigns(db)).toHaveLength(0);
  });

  it('refuses silly input', () => {
    const { a } = shop();
    expect(() => bulk.bulkChangeDesigns(db, { ids: [], kind: 'archive' })).toThrow(/at least one/);
    expect(() => bulk.bulkChangeDesigns(db, { ids: [a.d.id], kind: 'price', mode: 'percent', value: -95 })).toThrow(/between/);
    expect(() => bulk.bulkChangeDesigns(db, { ids: [a.d.id], kind: 'price', mode: 'set', value: -5 })).toThrow(/cost/);
    expect(() => bulk.bulkChangeDesigns(db, { ids: [a.d.id], kind: 'reorder', level: -1 })).toThrow(/reorder level/);
    expect(inventory.getVariant(db, a.red.id).reorderLevel).toBe(2);
  });
});

describe('undo (restoring what was removed)', () => {
  it('brings back a deleted expense, and only a deleted one', () => {
    const e = expenses.createExpense(db, exp());
    expect(() => expenses.restoreExpense(db, e.id)).toThrow(/can't be brought back/);
    expenses.deleteExpense(db, e.id);
    expect(expenses.restoreExpense(db, e.id).id).toBe(e.id);
    expect(expenses.listExpenses(db)).toHaveLength(1);
  });

  it('brings back an archived customer', () => {
    const c = customers.createCustomer(db, blank);
    customers.archiveCustomer(db, c.id);
    expect(customers.listCustomers(db)).toHaveLength(0);
    expect(customers.restoreCustomer(db, c.id).name).toBe('A');
    expect(() => customers.restoreCustomer(db, 'nope')).toThrow(/can't be brought back/);
  });

  it('brings back a design with the variants archived along with it, but not one archived earlier', () => {
    const { a } = shop();
    inventory.archiveVariant(db, a.blue.id); // archived on its own, before
    inventory.archiveDesign(db, a.d.id);
    expect(inventory.listDesigns(db)).toHaveLength(1);
    const back = inventory.restoreDesign(db, a.d.id);
    expect(back.variants.map((v) => v.color)).toEqual(['Red']);
    expect(inventory.listDesigns(db)).toHaveLength(2);
    expect(inventory.restoreVariant(db, a.blue.id).color).toBe('Blue'); // and it can still be undone separately
  });

  it('refuses to bring back a design whose code has been reused, leaving everything as it was', () => {
    const { a } = shop();
    inventory.archiveDesign(db, a.d.id);
    inventory.createDesign(db, { code: 'MG-001', name: 'Newcomer', fabric: '', hsnCode: '', description: '', defaultPricePaise: 0 });
    expect(() => inventory.restoreDesign(db, a.d.id)).toThrow(/can't be brought back.*code/);
    expect(inventory.listDesigns(db).map((d) => d.name)).toEqual(['Beta', 'Newcomer']);
  });

  it('works through the API', async () => {
    const api = createApi(db);
    const e = expenses.createExpense(db, exp());
    expenses.deleteExpense(db, e.id);
    expect((await api.expenseRestore(e.id)).id).toBe(e.id);
  });
});

describe('exporting everything', () => {
  it('packs a spreadsheet for each part of the book, and its contents match the book', () => {
    const { a } = shop();
    const c = customers.createCustomer(db, { ...blank, name: 'Sunita, Devi', phone: '9876543210' });
    invoices.createInvoice(db, { type: 'B2C', customerId: c.id, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: a.red.id, qty: 2, unitPricePaise: rupees(1000) }] });
    expenses.createExpense(db, exp());
    const out = exportEverything(db);
    expect(out.fileName).toBe(`invoiceon-export-${today}.zip`);
    expect(out.files).toEqual(['customers.csv', 'designs.csv', 'variants.csv', 'invoices.csv', 'invoice-lines.csv', 'payments.csv', 'expenses.csv', 'proformas.csv', 'raw-materials.csv', 'README.txt']);

    // Read the archive back through its directory.
    const bytes = Uint8Array.from(atob(out.base64), (ch) => ch.charCodeAt(0));
    const v = new DataView(bytes.buffer);
    const end = bytes.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(out.files.length);
    let at = v.getUint32(end + 16, true);
    const text = new Map<string, string>();
    for (let i = 0; i < out.files.length; i++) {
      const size = v.getUint32(at + 20, true);
      const nameLen = v.getUint16(at + 28, true);
      const local = v.getUint32(at + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
      const dataAt = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      text.set(name, new TextDecoder().decode(bytes.subarray(dataAt, dataAt + size)));
      at += 46 + nameLen;
    }
    expect(text.get('customers.csv')).toContain('"Sunita, Devi",B2C,9876543210');
    expect(text.get('invoices.csv')!.split('\r\n')).toHaveLength(3); // heading, one invoice, trailing newline
    expect(text.get('invoice-lines.csv')).toContain(',Alpha,Red,6 m,');
    expect(text.get('variants.csv')).toContain('Alpha,');
    expect(text.get('README.txt')).toContain('not a backup');
  });

  it('works on an empty book and through the API', async () => {
    expect(exportEverything(db).files).toHaveLength(10);
    expect((await createApi(db).dataExportAll()).base64.length).toBeGreaterThan(100);
  });
});

describe('documents for printing', () => {
  const host = (calls: string[]) => ({
    exportDocumentPdf: async (route: string, name: string) => (calls.push(`pdf|${route}|${name}`), { saved: true, path: 'x' }),
    printDocument: async (route: string) => void calls.push(`print|${route}`),
    saveTextFile: async () => ({ saved: false }),
    saveZipFile: async () => ({ saved: false }),
  });

  it('explain themselves outside the desktop app', async () => {
    const api = createApi(db);
    const c = customers.createCustomer(db, blank);
    await expect(api.customerStatementExportPdf(c.id)).rejects.toThrow(/desktop app only/);
    await expect(api.paymentReceiptPrint('x')).rejects.toThrow(/desktop app only/);
    await expect(api.invoicesExportPdf(['x'])).rejects.toThrow(/desktop app only/);
  });

  it('ask the shell for the right page and a sensible file name', async () => {
    const { a } = shop();
    const c = customers.createCustomer(db, { ...blank, name: 'Sunita / Devi' });
    const inv = invoices.createInvoice(db, { type: 'B2C', customerId: c.id, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: a.red.id, qty: 1, unitPricePaise: rupees(1000) }] });
    const inv2 = invoices.createInvoice(db, { type: 'B2C', customerId: c.id, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: a.red.id, qty: 1, unitPricePaise: rupees(1000) }] });
    const pay = (await import('../electron/services/payments')).recordPayment(db, { customerId: c.id, amountPaise: rupees(500), method: 'upi', reference: '', receivedOn: today, note: '', allocations: [] });
    const calls: string[] = [];
    const api = createApi(db, host(calls));

    await api.customerStatementExportPdf(c.id);
    await api.customerStatementPrint(c.id);
    await api.paymentReceiptExportPdf(pay.id);
    await api.invoicesExportPdf([inv.id, inv2.id, inv.id]); // a repeat is counted once
    await api.invoicesPrint([inv.id]);
    expect(calls).toEqual([
      `pdf|/print/statement/${c.id}|Statement - Sunita - Devi.pdf`,
      `print|/print/statement/${c.id}`,
      `pdf|/print/receipt/${pay.id}|Receipt - Sunita - Devi ${today}.pdf`,
      `pdf|/print/invoices?ids=${inv.id},${inv2.id}|2 invoices.pdf`,
      `print|/print/invoices?ids=${inv.id}`,
    ]);
    expect((await api.paymentGet(pay.id)).amountPaise).toBe(rupees(500));
  });

  it('refuse nothing chosen, something missing, or too many', async () => {
    const api = createApi(db, host([]));
    await expect(api.invoicesPrint([])).rejects.toThrow(/at least one/);
    await expect(api.invoicesExportPdf(['missing'])).rejects.toThrow(/no longer exists/);
    await expect(api.invoicesPrint(Array.from({ length: 201 }, (_, i) => `id${i}`))).rejects.toThrow(/up to 200/);
    await expect(api.customerStatementPrint('nope')).rejects.toThrow(/no longer exists/);
    await expect(api.paymentReceiptExportPdf('nope')).rejects.toThrow();
  });
});

describe('look and wording settings', () => {
  it('accept the choices on offer and refuse others', async () => {
    const { saveSettings, getSettings } = await import('../electron/services/settings');
    expect(getSettings(db)).toMatchObject({ paperSize: 'A4', dateFormat: 'short', invoiceLanguage: 'en', msgInvoice: '' });
    expect(saveSettings(db, { paperSize: 'A5', dateFormat: 'iso', invoiceLanguage: 'gu' })).toMatchObject({ paperSize: 'A5', dateFormat: 'iso', invoiceLanguage: 'gu' });
    expect(() => saveSettings(db, { paperSize: 'A3' as never })).toThrow(/A4, A5 or Letter/);
    expect(() => saveSettings(db, { dateFormat: 'us' as never })).toThrow(/date format/);
    expect(() => saveSettings(db, { invoiceLanguage: 'fr' as never })).toThrow(/English, Hindi or Gujarati/);
    expect(saveSettings(db, { msgDue: 'Hi {name}, {owed} is pending.' }).msgDue).toBe('Hi {name}, {owed} is pending.');
    expect(() => saveSettings(db, { msgDue: 'x'.repeat(1001) })).toThrow();
  });

  it('shape the invoice branding so the chosen language reaches old invoices too', async () => {
    const { saveSettings } = await import('../electron/services/settings');
    const { a } = shop();
    const inv = invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: a.red.id, qty: 1, unitPricePaise: rupees(1000) }] });
    expect(invoices.getInvoice(db, inv.id).branding.language).toBe('en');
    saveSettings(db, { invoiceLanguage: 'hi' });
    expect(invoices.getInvoice(db, inv.id).branding.language).toBe('hi');
  });
});
