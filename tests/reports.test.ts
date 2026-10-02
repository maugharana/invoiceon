import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import * as customers from '../electron/services/customers';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as materials from '../electron/services/materials';
import * as payments from '../electron/services/payments';
import * as reports from '../electron/services/reports';
import { saveSettings } from '../electron/services/settings';
import { gstB2bCsv, gstCsv, gstHsnCsv, salesCsv, stockCsv, toCsv } from '../shared/csv';
import { addDays, allocate, todayIso } from '../shared/gst';
import { bucketKeys, granularityFor, resolvePeriod } from '../shared/periods';
import type { InvoiceInput } from '../shared/types';

const rupees = (n: number) => n * 100;
const today = todayIso();

describe('allocate (exact proportional split)', () => {
  it('always adds back to the total, whatever the weights', () => {
    for (const [total, weights] of [[100, [1, 1, 1]], [1, [5, 5]], [999, [333, 333, 334]], [12345, [7, 13, 29, 51]], [10_000_000_000, [3_333_333_333, 3_333_333_333, 3_333_333_334]]] as const) {
      const parts = allocate(total, [...weights]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(parts.every((p) => Number.isInteger(p) && p >= 0)).toBe(true);
    }
  });
  it('is proportional, gives leftover paise to the biggest remainders, and copes with nothing to split', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1000, [3, 1])).toEqual([750, 250]);
    expect(allocate(50, [0, 0])).toEqual([0, 0]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    expect(allocate(100, [])).toEqual([]);
  });
});

describe('periods', () => {
  it('resolves the Indian financial year and its quarters', () => {
    expect(resolvePeriod({ preset: 'this-fy' }, '2026-09-29')).toEqual({ from: '2026-04-01', to: '2027-03-31' });
    expect(resolvePeriod({ preset: 'this-fy' }, '2027-02-10')).toEqual({ from: '2026-04-01', to: '2027-03-31' });
    expect(resolvePeriod({ preset: 'last-fy' }, '2026-09-29')).toEqual({ from: '2025-04-01', to: '2026-03-31' });
    expect(resolvePeriod({ preset: 'this-quarter' }, '2026-09-29')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(resolvePeriod({ preset: 'this-quarter' }, '2026-04-01')).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(resolvePeriod({ preset: 'this-quarter' }, '2026-12-31')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(resolvePeriod({ preset: 'this-quarter' }, '2027-02-14')).toEqual({ from: '2027-01-01', to: '2027-03-31' });
  });
  it('resolves months, including the January → December wrap and leap Februaries', () => {
    expect(resolvePeriod({ preset: 'this-month' }, '2026-09-29')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(resolvePeriod({ preset: 'last-month' }, '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(resolvePeriod({ preset: 'this-month' }, '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
  it('repairs a backwards or malformed custom range', () => {
    expect(resolvePeriod({ preset: 'custom', from: '2026-09-10', to: '2026-09-01' }, '2026-09-29')).toEqual({ from: '2026-09-01', to: '2026-09-10' });
    expect(resolvePeriod({ preset: 'custom', from: 'nope', to: '2026-09-15' }, '2026-09-29')).toEqual({ from: '2026-09-01', to: '2026-09-15' });
  });
  it('buckets short ranges by day and long ones by month, with every bucket present', () => {
    expect(granularityFor({ from: '2026-09-01', to: '2026-09-30' })).toBe('day');
    expect(granularityFor({ from: '2026-04-01', to: '2027-03-31' })).toBe('month');
    expect(bucketKeys({ from: '2026-09-28', to: '2026-10-02' }, 'day')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(bucketKeys({ from: '2026-11-15', to: '2027-02-03' }, 'month')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(bucketKeys({ from: '2026-04-01', to: '2027-03-31' }, 'month')).toHaveLength(12);
  });
});

describe('csv', () => {
  it('quotes awkward cells, starts with a BOM for Excel, and keeps money as plain numbers', () => {
    const csv = toCsv([['a,b', 'say "hi"', 'x\ny', 1234.5]]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toBe('﻿"a,b","say ""hi""","x\ny",1234.5\r\n');
  });
});

// ── Fixtures ────────────────────────────────────────────────────────────────
let db: Db;
let silk: string;
let cotton: string;
beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { gstin: '09AABCK1234M1ZI' });
  const mat = materials.createMaterial(db, { name: 'Yarn', unit: 'kg', unitCostPaise: rupees(1000) });
  const d1 = inventory.createDesign(db, { code: 'MG-001', name: 'Silk Butidar', fabric: 'Silk', hsnCode: '5007', description: '', defaultPricePaise: rupees(1000) });
  silk = inventory.createVariant(db, d1.id, { color: 'Maroon', size: '6.3 m', sellPricePaise: rupees(1000), baseCostPaise: rupees(300), reorderLevel: 0, openingStock: 100, bom: [{ materialId: mat.id, qty: 0.2 }] }).id; // cost 500
  const d2 = inventory.createDesign(db, { code: 'MG-002', name: 'Cotton Chanderi', fabric: 'Cotton', hsnCode: '5208', description: '', defaultPricePaise: rupees(400) });
  cotton = inventory.createVariant(db, d2.id, { color: 'Sky', size: '5.5 m', sellPricePaise: rupees(400), baseCostPaise: rupees(150), reorderLevel: 0, openingStock: 100, bom: [] }).id; // cost 150
});

const cust = (name: string, over: Record<string, string> = {}) =>
  customers.createCustomer(db, { name, type: 'B2C', phone: '', email: '', gstin: '', address: '', city: 'Mau', state: 'Uttar Pradesh', pincode: '', notes: '', ...over });
const b2bCust = (name: string, state: string, gstin: string) => cust(name, { type: 'B2B', gstin, state });

const invoice = (over: Partial<InvoiceInput> & { issueDate?: string } = {}) =>
  invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: today, dueDate: null, discountPaise: 0, notes: '', lines: [{ variantId: silk, qty: 1, unitPricePaise: rupees(1000) }], ...over });

const thisMonth = resolvePeriod({ preset: 'this-month' });
const wide = { from: addDays(today, -400), to: today };

describe('sales report', () => {
  it('measures invoiced by invoice date and collected by payment date, independently', () => {
    const c = cust('Asha');
    const oldInv = invoice({ customerId: c.id, issueDate: addDays(today, -70), dueDate: addDays(today, -60) }); // 1,050
    invoice({ customerId: c.id, lines: [{ variantId: silk, qty: 2, unitPricePaise: rupees(1000) }] }); // 2,100
    // Asha pays the OLD invoice today, and an advance yesterday.
    payments.recordPayment(db, { customerId: c.id, amountPaise: rupees(1050), method: 'upi', reference: '', receivedOn: today, note: '', allocations: [{ invoiceId: oldInv.id, amountPaise: rupees(1050) }] });
    payments.recordPayment(db, { customerId: c.id, amountPaise: rupees(500), method: 'cash', reference: '', receivedOn: addDays(today, -1), note: '', allocations: [] });

    const r = reports.salesReport(db, { from: addDays(today, -3), to: today });
    expect(r.invoicedPaise).toBe(rupees(2100)); // only the invoice dated in the window
    expect(r.collectedPaise).toBe(rupees(1550)); // both payments landed in the window — even though one paid an old invoice
    expect(r).toMatchObject({ invoiceCount: 1, paymentCount: 2, stillUnpaidPaise: rupees(2100) });
    // and looking at the earlier window instead: the old invoice shows as invoiced there, with nothing collected
    const before = reports.salesReport(db, { from: addDays(today, -80), to: addDays(today, -50) });
    expect(before).toMatchObject({ invoicedPaise: rupees(1050), collectedPaise: 0, stillUnpaidPaise: 0 });
  });

  it('splits taxable value, GST, pieces and profit, with the discount shared across lines', () => {
    invoice({ discountPaise: rupees(300), lines: [{ variantId: silk, qty: 2, unitPricePaise: rupees(1000) }, { variantId: cotton, qty: 5, unitPricePaise: rupees(400) }] });
    // subtotal 4,000; discount 300 → taxable 3,700; GST 5% = 185; total 3,885. Cost: 2×500 + 5×150 = 1,750.
    const r = reports.salesReport(db, thisMonth);
    expect(r).toMatchObject({ invoicedPaise: rupees(3885), taxablePaise: rupees(3700), gstPaise: rupees(185), piecesSold: 7, grossProfitPaise: rupees(3700 - 1750) });
    expect(r.marginPercent).toBeCloseTo(((3700 - 1750) / 3700) * 100, 5);
    // per-design revenue is each line's share of the *discounted* value and adds back to the taxable total
    expect(r.topDesigns.reduce((s, d) => s + d.revenuePaise, 0)).toBe(r.taxablePaise);
    expect(r.topDesigns.reduce((s, d) => s + d.profitPaise, 0)).toBe(r.grossProfitPaise);
    expect(r.topDesigns[0]).toMatchObject({ name: 'Silk Butidar', pieces: 2 });
  });

  it('leaves cancelled invoices out but reports them, and ignores reversed payments', () => {
    const c = cust('Bela');
    const gone = invoice({ customerId: c.id });
    invoices.cancelInvoice(db, gone.id, '');
    invoice({ customerId: c.id });
    const p = payments.recordPayment(db, { customerId: c.id, amountPaise: rupees(300), method: 'cash', reference: '', receivedOn: today, note: '', allocations: [] });
    payments.voidPayment(db, p.id, 'mistake');
    const r = reports.salesReport(db, thisMonth);
    expect(r).toMatchObject({ invoiceCount: 1, invoicedPaise: rupees(1050), cancelledCount: 1, cancelledPaise: rupees(1050), collectedPaise: 0, paymentCount: 0 });
  });

  it('breaks down by type, method and customer', () => {
    const a = cust('Asha');
    invoice({ customerId: a.id });
    invoice({ customerId: a.id, lines: [{ variantId: cotton, qty: 1, unitPricePaise: rupees(400) }] });
    invoice(); // walk-in
    invoice({ payment: { amountPaise: rupees(1050), method: 'cash', reference: '' } });
    payments.recordPayment(db, { customerId: a.id, amountPaise: rupees(2000), method: 'upi', reference: '', receivedOn: today, note: '', allocations: [] });
    const r = reports.salesReport(db, thisMonth);
    expect(r.byType).toEqual([{ type: 'B2B', invoices: 0, invoicedPaise: 0 }, { type: 'B2C', invoices: 4, invoicedPaise: rupees(1050 + 420 + 1050 + 1050) }]);
    expect(r.byMethod).toEqual([{ method: 'upi', count: 1, paise: rupees(2000) }, { method: 'cash', count: 1, paise: rupees(1050) }]);
    expect(r.topCustomers[0]).toMatchObject({ name: 'Walk-in customers', invoices: 2, invoicedPaise: rupees(2100) });
    expect(r.topCustomers[1]).toMatchObject({ name: 'Asha', invoices: 2 });
  });

  it('fills every day of the window, and the chart series adds up to the headline figures', () => {
    invoice({ issueDate: addDays(today, -2) });
    invoice();
    payments.recordPayment(db, { customerId: null, amountPaise: rupees(1050), method: 'cash', reference: '', receivedOn: addDays(today, -1), note: '', allocations: [{ invoiceId: invoices.listInvoices(db)[0]!.id, amountPaise: rupees(1050) }] });
    const r = reports.salesReport(db, { from: addDays(today, -4), to: today });
    expect(r.granularity).toBe('day');
    expect(r.series.map((p) => p.key)).toEqual([-4, -3, -2, -1, 0].map((n) => addDays(today, n)));
    expect(r.series.reduce((s, p) => s + p.invoicedPaise, 0)).toBe(r.invoicedPaise);
    expect(r.series.reduce((s, p) => s + p.collectedPaise, 0)).toBe(r.collectedPaise);
    expect(r.series.reduce((s, p) => s + p.invoices, 0)).toBe(r.invoiceCount);
  });

  it('goes month by month over a long window', () => {
    invoice({ issueDate: addDays(today, -100) });
    invoice();
    const r = reports.salesReport(db, wide);
    expect(r.granularity).toBe('month');
    expect(r.series.reduce((s, p) => s + p.invoicedPaise, 0)).toBe(rupees(2100));
  });

  it('handles an empty period gracefully', () => {
    const r = reports.salesReport(db, thisMonth);
    expect(r).toMatchObject({ invoicedPaise: 0, invoiceCount: 0, marginPercent: null, topDesigns: [], topCustomers: [], byMethod: [] });
  });

  it('rejects a bad range', () => {
    expect(() => reports.salesReport(db, { from: 'x', to: today })).toThrow(/valid date range/);
    expect(() => reports.salesReport(db, { from: today, to: addDays(today, -1) })).toThrow(/after the end date/);
  });
});

describe('GST report', () => {
  it('totals tax by type and splits CGST/SGST from IGST', () => {
    const local = b2bCust('Kanchan', 'Uttar Pradesh', '09AAACH7409R1ZZ');
    const far = b2bCust('Meera', 'Maharashtra', '27AAPFU0939F1ZV');
    invoice({ type: 'B2B', customerId: local.id, lines: [{ variantId: silk, qty: 2, unitPricePaise: rupees(1000) }] }); // 2,000 → 100 (50+50)
    invoice({ type: 'B2B', customerId: far.id, lines: [{ variantId: cotton, qty: 5, unitPricePaise: rupees(400) }] }); // 2,000 → 100 IGST
    invoice(); // B2C 1,000 → 50
    const r = reports.gstReport(db, thisMonth);
    expect(r.totals).toMatchObject({ invoices: 3, taxablePaise: rupees(5000), cgstPaise: rupees(75), sgstPaise: rupees(75), igstPaise: rupees(100), taxPaise: rupees(250), invoiceValuePaise: rupees(5250) });
    expect(r.b2b).toMatchObject({ invoices: 2, taxablePaise: rupees(4000), taxPaise: rupees(200) });
    expect(r.b2c).toMatchObject({ invoices: 1, taxablePaise: rupees(1000), taxPaise: rupees(50) });
    expect(r.b2b.taxPaise + r.b2c.taxPaise).toBe(r.totals.taxPaise);
  });

  it('builds a B2B register with buyer GSTINs and a B2C summary by state', () => {
    const far = b2bCust('Meera', 'Maharashtra', '27AAPFU0939F1ZV');
    const inv = invoice({ type: 'B2B', customerId: far.id });
    invoice();
    invoice();
    const r = reports.gstReport(db, thisMonth);
    expect(r.b2bRegister).toEqual([expect.objectContaining({ invoiceId: inv.id, number: inv.number, customer: 'Meera', gstin: '27AAPFU0939F1ZV', placeOfSupply: 'Maharashtra', ratePercent: 5, igstPaise: rupees(50), totalPaise: rupees(1050) })]);
    expect(r.b2cByState).toEqual([{ placeOfSupply: 'Uttar Pradesh', ratePercent: 5, invoices: 2, taxablePaise: rupees(2000), cgstPaise: rupees(50), sgstPaise: rupees(50), igstPaise: 0 }]);
  });

  it('HSN summary adds back to the invoice totals exactly, even with discounts that split unevenly', () => {
    // Awkward on purpose: odd prices, a discount that doesn't divide, three lines over two HSN codes.
    invoice({ discountPaise: 3333, lines: [{ variantId: silk, qty: 3, unitPricePaise: 33333 }, { variantId: cotton, qty: 7, unitPricePaise: 12345 }] });
    invoice({ discountPaise: 1, lines: [{ variantId: cotton, qty: 3, unitPricePaise: 9999 }, { variantId: silk, qty: 2, unitPricePaise: 7777 }] });
    const r = reports.gstReport(db, thisMonth);
    expect(r.hsn.reduce((s, h) => s + h.taxablePaise, 0)).toBe(r.totals.taxablePaise);
    expect(r.hsn.reduce((s, h) => s + h.cgstPaise, 0)).toBe(r.totals.cgstPaise);
    expect(r.hsn.reduce((s, h) => s + h.sgstPaise, 0)).toBe(r.totals.sgstPaise);
    expect(r.hsn.reduce((s, h) => s + h.igstPaise, 0)).toBe(r.totals.igstPaise);
    expect(r.hsn.reduce((s, h) => s + h.qty, 0)).toBe(3 + 7 + 3 + 2);
    expect(r.hsn.map((h) => h.hsn).sort()).toEqual(['5007', '5208']);
  });

  it('is by invoice date, leaves out cancelled invoices, and says how many were cancelled', () => {
    invoice({ issueDate: addDays(today, -90) });
    const gone = invoice();
    invoices.cancelInvoice(db, gone.id, '');
    invoice();
    const r = reports.gstReport(db, thisMonth);
    expect(r.totals.invoices).toBe(1);
    expect(r.cancelledCount).toBe(1);
    expect(reports.gstReport(db, wide).totals.invoices).toBe(2);
  });

  it('agrees with the sales report on taxable value and tax', () => {
    invoice({ discountPaise: rupees(50), lines: [{ variantId: silk, qty: 3, unitPricePaise: rupees(1000) }] });
    invoice({ lines: [{ variantId: cotton, qty: 4, unitPricePaise: rupees(400) }] });
    const g = reports.gstReport(db, thisMonth);
    const s = reports.salesReport(db, thisMonth);
    expect(g.totals.taxablePaise).toBe(s.taxablePaise);
    expect(g.totals.taxPaise).toBe(s.gstPaise);
    expect(g.totals.invoiceValuePaise).toBe(s.invoicedPaise);
  });
});

describe('stock valuation', () => {
  it('values stock at cost (base + materials) and at selling price', () => {
    const r = reports.stockReport(db);
    // silk: 100 × 500 cost / 1000 price ; cotton: 100 × 150 / 400
    expect(r).toMatchObject({ asOf: today, pieces: 200, costValuePaise: rupees(50000 + 15000), retailValuePaise: rupees(100000 + 40000), designCount: 2, variantCount: 2, outOfStockVariants: 0 });
    expect(r.rows.map((d) => d.name)).toEqual(['Silk Butidar', 'Cotton Chanderi']); // biggest value first
    expect(r.rows[0]!.variants[0]).toMatchObject({ pieces: 100, unitCostPaise: rupees(500), costValuePaise: rupees(50000), lastSoldOn: null });
  });

  it('falls as pieces are sold and follows a material price change', () => {
    invoice({ lines: [{ variantId: silk, qty: 40, unitPricePaise: rupees(1000) }] });
    expect(reports.stockReport(db).rows[0]!.variants[0]).toMatchObject({ pieces: 60, costValuePaise: rupees(60 * 500), lastSoldOn: today });
    const mat = materials.listMaterials(db)[0]!;
    materials.updateMaterial(db, mat.id, { name: 'Yarn', unit: 'kg', unitCostPaise: rupees(2000) }); // silk cost 300 + 0.2 × 2000 = 700
    expect(reports.stockReport(db).rows[0]!.variants[0]).toMatchObject({ unitCostPaise: rupees(700), costValuePaise: rupees(60 * 700) });
  });

  it('rebuilds quantities for a past date from the stock ledger', () => {
    // Give the ledger a history: opening 12 days ago, a 30-piece sale 5 days ago (rewriting the timestamps directly).
    const ago = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    invoice({ lines: [{ variantId: silk, qty: 30, unitPricePaise: rupees(1000) }], issueDate: addDays(today, -5) });
    db.prepare("UPDATE stock_movements SET created_at = ? WHERE reason = 'opening' AND variant_id = ?").run(ago(12), silk);
    db.prepare("UPDATE stock_movements SET created_at = ? WHERE reason = 'sale' AND variant_id = ?").run(ago(5), silk);

    const back = (n: number) => reports.stockReport(db, addDays(today, -n)).rows.find((d) => d.name === 'Silk Butidar')!.variants[0]!;
    expect(back(20).pieces).toBe(0); // before it existed
    expect(back(8).pieces).toBe(100); // after opening, before the sale
    expect(back(3).pieces).toBe(70); // after the sale
    expect(reports.stockReport(db).rows.find((d) => d.name === 'Silk Butidar')!.variants[0]!.pieces).toBe(70); // today agrees with the live balance
    expect(back(8).lastSoldOn).toBeNull(); // last-sold respects the as-of date too
    expect(back(3).lastSoldOn).toBe(addDays(today, -5));
  });

  it('counts empty variants and rejects future or invalid dates', () => {
    invoice({ lines: [{ variantId: cotton, qty: 100, unitPricePaise: rupees(400) }] });
    expect(reports.stockReport(db).outOfStockVariants).toBe(1);
    expect(() => reports.stockReport(db, addDays(today, 1))).toThrow(/today or an earlier/);
    expect(() => reports.stockReport(db, 'soon')).toThrow(/valid date/);
  });
});

describe('csv exports of real reports', () => {
  it('produces well-formed files a spreadsheet can read', () => {
    saveSettings(db, { businessName: 'Mau, Gharana "Sarees"' });
    const far = b2bCust('Meera, "Textiles"', 'Maharashtra', '27AAPFU0939F1ZV');
    invoice({ type: 'B2B', customerId: far.id, lines: [{ variantId: silk, qty: 2, unitPricePaise: rupees(1000) }] });
    invoice();

    const g = reports.gstReport(db, thisMonth);
    const b2b = gstB2bCsv(g).replace(/^﻿/, '').split('\r\n');
    expect(b2b[0]).toContain('GSTIN of buyer');
    expect(b2b[1]).toContain('"Meera, ""Textiles"""'); // awkward name survives quoting
    expect(b2b[1]).toContain('2000.00'); // plain decimal, no ₹, no digit grouping
    expect(gstHsnCsv(g)).toContain('5007,3,3000.00'); // both silk lines under one HSN
    const combined = gstCsv(g);
    expect(combined).toContain('B2B invoices');
    expect(combined).toContain('HSN summary');

    expect(salesCsv(reports.salesReport(db, thisMonth))).toContain('Invoiced (incl. GST),3150.00');
    expect(stockCsv(reports.stockReport(db))).toContain('MG-001,Silk Butidar');
  });
});

describe('report API', () => {
  it('serves the reports and explains that file export is desktop-only', async () => {
    const api = createApi(db);
    invoice();
    expect((await api.reportSales(thisMonth)).invoiceCount).toBe(1);
    expect((await api.reportGst(thisMonth)).totals.invoices).toBe(1);
    expect((await api.reportStock()).asOf).toBe(today);
    expect((await api.reportStock(null as unknown as undefined)).asOf).toBe(today); // JSON turns undefined into null
    await expect(api.reportSales({ from: 'bad', to: 'bad' })).rejects.toThrow(/valid date range/);
    await expect(api.exportSave('x.csv', 'a')).rejects.toThrow(/desktop app only/);
    const saved: string[] = [];
    const desktop = createApi(db, { exportDocumentPdf: async () => ({ saved: false }), printDocument: async () => {}, saveTextFile: async (name, content) => (saved.push(`${name}|${content}`), { saved: true, path: 'p' }), saveZipFile: async (name, b64) => (saved.push(`zip:${name}|${b64}`), { saved: true, path: 'z' }) });
    expect(await desktop.exportSave('a/b:c.csv', 'data')).toEqual({ saved: true, path: 'p' });
    expect(saved).toEqual(['a-b-c.csv|data']); // path characters are stripped from the name
    await expect(api.exportSaveZip('x.zip', 'AAAA')).rejects.toThrow(/desktop app only/);
    expect(await desktop.exportSaveZip('a/b.zip', 'QUJD')).toEqual({ saved: true, path: 'z' });
    expect(saved.at(-1)).toBe('zip:a-b.zip|QUJD');
  });
});
