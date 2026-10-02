import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../electron/db/connection';
import { LATEST_SCHEMA_VERSION, migrate } from '../electron/db/migrations';
import * as customers from '../electron/services/customers';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as proformas from '../electron/services/proformas';
import { gstReport } from '../electron/services/reports';
import { getSettings, saveSettings } from '../electron/services/settings';
import { computeInvoice, computeTotals, resolveRate, roundTotal, todayIso } from '../shared/gst';
import type { InvoiceInput, LineInput } from '../shared/types';

const rupees = (n: number) => n * 100;
const today = todayIso();

describe('rounding the total', () => {
  it('rounds as the policy says; the default is the nearest rupee', () => {
    expect(roundTotal(105050)).toBe(105100);
    expect(roundTotal(105049)).toBe(105000);
    expect(roundTotal(105001, 'up')).toBe(105100);
    expect(roundTotal(105099, 'down')).toBe(105000);
    expect(roundTotal(105049, 'none')).toBe(105049);
    expect(roundTotal(105100, 'up')).toBe(105100);
  });

  it('puts the difference on its own line, whichever way', () => {
    const base = { lineAmounts: [rupees(1000) + 33], discountPaise: 0, ratePercent: 5, intraState: true };
    // 1000.33 + 50.02 tax = 1050.35
    expect(computeTotals(base)).toMatchObject({ totalPaise: rupees(1050), roundOffPaise: -35 });
    expect(computeTotals({ ...base, roundOff: 'up' })).toMatchObject({ totalPaise: rupees(1051), roundOffPaise: 65 });
    expect(computeTotals({ ...base, roundOff: 'down' })).toMatchObject({ totalPaise: rupees(1050), roundOffPaise: -35 });
    expect(computeTotals({ ...base, roundOff: 'none' })).toMatchObject({ totalPaise: 105035, roundOffPaise: 0 });
  });
});

describe('an invoice with several rates and line discounts', () => {
  it('is exactly the old answer when everything is at one rate with no line discounts', () => {
    const a = computeInvoice({ lines: [{ amountPaise: rupees(1000), ratePercent: 5 }, { amountPaise: 33333, ratePercent: 5 }], discountPaise: 4000, intraState: true });
    const b = computeTotals({ lineAmounts: [rupees(1000), 33333], discountPaise: 4000, ratePercent: 5, intraState: true });
    const { lines: _l, byRate: _r, ...totalsOnly } = a;
    expect(totalsOnly).toEqual(b);
    expect(a.byRate).toHaveLength(1);
    expect(a.lineDiscountPaise).toBe(0);
  });

  it('works out tax once per rate and shows each rate separately', () => {
    const t = computeInvoice({
      lines: [
        { amountPaise: rupees(800), ratePercent: 5 },
        { amountPaise: rupees(3000), ratePercent: 18 },
      ],
      discountPaise: 0,
      intraState: true,
    });
    expect(t.byRate).toEqual([
      { ratePercent: 5, taxablePaise: rupees(800), taxPaise: rupees(40), cgstPaise: rupees(20), sgstPaise: rupees(20), igstPaise: 0 },
      { ratePercent: 18, taxablePaise: rupees(3000), taxPaise: rupees(540), cgstPaise: rupees(270), sgstPaise: rupees(270), igstPaise: 0 },
    ]);
    expect(t).toMatchObject({ taxablePaise: rupees(3800), taxPaise: rupees(580), cgstPaise: rupees(290), sgstPaise: rupees(290), totalPaise: rupees(4380) });
  });

  it('takes a line discount off that line only, before the tax', () => {
    const t = computeInvoice({
      lines: [
        { amountPaise: rupees(1000), discountPaise: rupees(200), ratePercent: 5 },
        { amountPaise: rupees(1000), ratePercent: 5 },
      ],
      discountPaise: 0,
      intraState: false,
    });
    expect(t).toMatchObject({ subtotalPaise: rupees(2000), lineDiscountPaise: rupees(200), discountPaise: 0, taxablePaise: rupees(1800), igstPaise: rupees(90), totalPaise: rupees(1890) });
    expect(t.lines.map((l) => l.taxablePaise)).toEqual([rupees(800), rupees(1000)]);
  });

  it('never lets a discount exceed what it comes off', () => {
    const t = computeInvoice({ lines: [{ amountPaise: rupees(100), discountPaise: rupees(500), ratePercent: 5 }], discountPaise: rupees(900), intraState: true });
    expect(t).toMatchObject({ lineDiscountPaise: rupees(100), discountPaise: 0, taxablePaise: 0, totalPaise: 0 });
  });

  it('carves the tax out when prices include GST, rate by rate', () => {
    const t = computeInvoice({
      lines: [
        { amountPaise: rupees(1050), ratePercent: 5 },
        { amountPaise: rupees(1180), ratePercent: 18 },
      ],
      discountPaise: 0,
      intraState: true,
      inclusive: true,
    });
    expect(t.byRate.map((g) => [g.ratePercent, g.taxablePaise, g.taxPaise])).toEqual([
      [5, rupees(1000), rupees(50)],
      [18, rupees(1000), rupees(180)],
    ]);
    expect(t.totalPaise).toBe(rupees(2230));
  });

  it('always adds up: line shares equal the totals, to the paisa, for awkward numbers', () => {
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let round = 0; round < 300; round++) {
      const rates = [0, 5, 12, 18, 28, 2.5];
      const lines = Array.from({ length: 1 + rnd(6) }, () => {
        const amountPaise = 1 + rnd(900_000);
        return { amountPaise, discountPaise: rnd(3) === 0 ? rnd(amountPaise + 1) : 0, ratePercent: rates[rnd(rates.length)]! };
      });
      const net = lines.reduce((s, l) => s + l.amountPaise - l.discountPaise, 0);
      const t = computeInvoice({ lines, discountPaise: rnd(Math.max(net, 1) + 1), intraState: rnd(2) === 0, inclusive: rnd(2) === 0, roundOff: (['nearest', 'up', 'down', 'none'] as const)[rnd(4)] });
      expect(t.lines.reduce((s, l) => s + l.taxablePaise, 0)).toBe(t.taxablePaise);
      expect(t.lines.reduce((s, l) => s + l.taxPaise, 0)).toBe(t.taxPaise);
      expect(t.byRate.reduce((s, g) => s + g.taxPaise, 0)).toBe(t.taxPaise);
      expect(t.cgstPaise + t.sgstPaise + t.igstPaise).toBe(t.taxPaise);
      expect(t.totalPaise).toBe(t.taxablePaise + t.taxPaise + t.roundOffPaise);
      expect(t.lines.reduce((s, l) => s + l.payablePaise, 0)).toBe(net - t.discountPaise);
      if (t.roundOffPaise !== 0 && !(t.totalPaise % 100 === 0)) throw new Error('rounded total is not a whole rupee');
    }
  });
});

describe('which rate a line gets', () => {
  const shop = { gstRatePercent: 5, rateSlabs: [{ upToPaise: rupees(2500), ratePercent: 5 }, { upToPaise: rupees(10000), ratePercent: 12 }] };
  const line = (over: Partial<Parameters<typeof resolveRate>[0]> = {}) => resolveRate({ qty: 1, netPaise: rupees(1000), ...over }, shop);

  it('goes: typed on the line, then the design, then a price slab, then the shop rate', () => {
    expect(line({ override: 18, designRate: 12 })).toBe(18);
    expect(line({ override: 0, designRate: 12 })).toBe(0); // zero is a real rate, not "none"
    expect(line({ designRate: 12 })).toBe(12);
    expect(line({})).toBe(5);
    expect(line({ netPaise: rupees(2500) })).toBe(5); // the limit itself is inside the slab
    expect(line({ netPaise: rupees(2501) })).toBe(12);
    expect(line({ netPaise: rupees(10001) })).toBe(5); // above every slab: the shop's usual rate
  });

  it('judges a slab by what one piece sells for, so a bigger quantity does not change the rate', () => {
    expect(line({ qty: 4, netPaise: rupees(8000) })).toBe(5); // 4 × 2000
    expect(line({ qty: 4, netPaise: rupees(12000) })).toBe(12); // 4 × 3000
  });
});

// ── through the books ──
let db: Db;
let cheap: string;
let dear: string;
let dearDesign: string;

beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { gstin: '09AABCK1234M1ZI', invoicePrefix: 'MG', state: 'Uttar Pradesh' });
  const d1 = inventory.createDesign(db, { code: 'MG-001', name: 'Cotton', fabric: '', hsnCode: '5208', description: '', defaultPricePaise: rupees(800) });
  cheap = inventory.createVariant(db, d1.id, { color: 'Red', size: '6 m', sellPricePaise: rupees(800), baseCostPaise: rupees(300), reorderLevel: 0, openingStock: 50, bom: [] }).id;
  const d2 = inventory.createDesign(db, { code: 'MG-002', name: 'Banarasi', fabric: '', hsnCode: '5007', description: '', defaultPricePaise: rupees(3000) });
  dearDesign = d2.id;
  dear = inventory.createVariant(db, d2.id, { color: 'Gold', size: '6 m', sellPricePaise: rupees(3000), baseCostPaise: rupees(1500), reorderLevel: 0, openingStock: 50, bom: [] }).id;
});

const sell = (lines: LineInput[], over: Partial<InvoiceInput> = {}) =>
  invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines, ...over });

describe('issuing invoices with line discounts and several rates', () => {
  it('gives each line the rate that applies: a price slab, a design rate, or one typed on the line', () => {
    saveSettings(db, { rateSlabs: [{ upToPaise: rupees(1000), ratePercent: 5 }] });
    saveSettings(db, { gstRatePercent: 12 });
    // Cotton 800 → slab 5%; Banarasi 3000 → above the slab, the usual 12%.
    let inv = sell([{ variantId: cheap, qty: 1, unitPricePaise: rupees(800) }, { variantId: dear, qty: 1, unitPricePaise: rupees(3000) }]);
    expect(inv.lines.map((l) => l.ratePercent)).toEqual([5, 12]);
    expect(inv.taxByRate.map((g) => [g.ratePercent, g.taxablePaise, g.taxPaise])).toEqual([[5, rupees(800), rupees(40)], [12, rupees(3000), rupees(360)]]);
    expect(inv.totalPaise).toBe(rupees(4200));

    inventory.updateDesign(db, dearDesign, { code: 'MG-002', name: 'Banarasi', fabric: '', hsnCode: '5007', description: '', defaultPricePaise: rupees(3000), gstRatePercent: 18 });
    inv = sell([{ variantId: dear, qty: 1, unitPricePaise: rupees(3000) }]);
    expect(inv.lines[0]!.ratePercent).toBe(18);

    inv = sell([{ variantId: dear, qty: 1, unitPricePaise: rupees(3000), ratePercent: 0 }]);
    expect(inv.lines[0]!.ratePercent).toBe(0);
    expect(inv.cgstPaise + inv.sgstPaise + inv.igstPaise).toBe(0);
  });

  it('keeps each line\'s discount, rate, note and tax on the invoice, and the totals add up to them', () => {
    const inv = sell(
      [
        { variantId: cheap, qty: 2, unitPricePaise: rupees(800), discountPaise: rupees(100), note: 'Pre-washed' },
        { variantId: dear, qty: 1, unitPricePaise: rupees(3000), ratePercent: 18 },
      ],
      { discountPaise: rupees(50) },
    );
    expect(inv.subtotalPaise).toBe(rupees(4600));
    expect(inv.lineDiscountPaise).toBe(rupees(100));
    expect(inv.discountPaise).toBe(rupees(50));
    expect(inv.lines[0]).toMatchObject({ amountPaise: rupees(1600), discountPaise: rupees(100), note: 'Pre-washed', ratePercent: 5 });
    expect(inv.lines.reduce((s, l) => s + l.taxablePaise!, 0)).toBe(inv.taxablePaise);
    expect(inv.taxByRate.reduce((s, g) => s + g.cgstPaise, 0)).toBe(inv.cgstPaise);
    expect(inv.totalPaise).toBe(inv.taxablePaise + inv.cgstPaise + inv.sgstPaise + inv.igstPaise + inv.roundOffPaise);
  });

  it('refuses a line discount bigger than the line, a bad rate, and a discount bigger than what is left', () => {
    const line = (over: Partial<LineInput>): LineInput => ({ variantId: cheap, qty: 1, unitPricePaise: rupees(800), ...over });
    expect(() => sell([line({ discountPaise: rupees(801) })])).toThrow(/can't be more than the item/);
    expect(() => sell([line({ ratePercent: 101 })])).toThrow(/0 to 100/);
    expect(() => sell([line({ ratePercent: 5.123 })])).toThrow(/0 to 100/);
    expect(() => sell([line({ discountPaise: rupees(700) })], { discountPaise: rupees(101) })).toThrow(/more than the invoice subtotal/);
    expect(invoices.listInvoices(db)).toEqual([]);
  });

  it('follows the round-off setting', () => {
    saveSettings(db, { roundOff: 'up' });
    const inv = sell([{ variantId: cheap, qty: 1, unitPricePaise: 80033 }]); // 800.33 + 5% = 840.35
    expect(inv.totalPaise).toBe(rupees(841));
    saveSettings(db, { roundOff: 'none' });
    const exact = sell([{ variantId: cheap, qty: 1, unitPricePaise: 80033 }]);
    expect(exact.totalPaise).toBe(84035);
    expect(exact.roundOffPaise).toBe(0);
  });

  it('checks the new settings', () => {
    expect(() => saveSettings(db, { roundOff: 'sideways' as never })).toThrow(/how totals are rounded/);
    expect(() => saveSettings(db, { rateSlabs: [{ upToPaise: 0, ratePercent: 5 }] })).toThrow(/price limit/);
    expect(() => saveSettings(db, { rateSlabs: [{ upToPaise: 100, ratePercent: 150 }] })).toThrow(/0 to 100/);
    expect(() => saveSettings(db, { rateSlabs: [{ upToPaise: 100, ratePercent: 5 }, { upToPaise: 100, ratePercent: 12 }] })).toThrow(/same limit/);
    saveSettings(db, { rateSlabs: [{ upToPaise: 5000, ratePercent: 12 }, { upToPaise: 1000, ratePercent: 5 }] });
    expect(getSettings(db).rateSlabs.map((s) => s.upToPaise)).toEqual([1000, 5000]); // kept in order
    expect(() => inventory.createDesign(db, { code: 'X-1', name: 'X', fabric: '', hsnCode: '', description: '', defaultPricePaise: 1, gstRatePercent: 200 })).toThrow(/0 to 100/);
  });

  it('puts the right figures in the GST report: a row for each rate, HSN and state totals that match the invoices', async () => {
    const b2b = customers.createCustomer(db, { name: 'Kanchan', type: 'B2B', phone: '', email: '', gstin: '09AAACH7409R1ZZ', address: '', city: 'Varanasi', state: 'Uttar Pradesh', pincode: '221001', notes: '' });
    const a = sell([{ variantId: cheap, qty: 1, unitPricePaise: rupees(800) }, { variantId: dear, qty: 1, unitPricePaise: rupees(3000), ratePercent: 18 }], { type: 'B2B', customerId: b2b.id });
    const b = sell([{ variantId: cheap, qty: 1, unitPricePaise: rupees(800), discountPaise: rupees(50) }, { variantId: dear, qty: 1, unitPricePaise: rupees(3000), ratePercent: 18 }]);
    const report = gstReport(db, { from: today, to: today });

    expect(report.b2bRegister.map((r) => [r.number, r.ratePercent, r.taxablePaise, r.totalPaise])).toEqual([
      [a.number, 5, rupees(800), a.totalPaise],
      [a.number, 18, rupees(3000), 0],
    ]);
    expect(report.b2bRegister.reduce((s, r) => s + r.totalPaise, 0)).toBe(a.totalPaise);
    expect(report.b2cByState.map((s) => [s.ratePercent, s.taxablePaise]).sort()).toEqual([[18, rupees(3000)], [5, rupees(750)]].sort());

    expect(report.totals.taxablePaise).toBe(a.taxablePaise + b.taxablePaise);
    expect(report.hsn.reduce((s, h) => s + h.taxablePaise, 0)).toBe(report.totals.taxablePaise);
    expect(report.hsn.reduce((s, h) => s + h.taxPaise, 0)).toBe(report.totals.taxPaise);
    const banarasi = report.hsn.find((h) => h.hsn === '5007')!;
    expect(banarasi.taxablePaise).toBe(rupees(6000));
    expect(banarasi.cgstPaise + banarasi.sgstPaise).toBe(rupees(1080));
  });
});

describe('quotes with line discounts and rates', () => {
  const quote = (lines: LineInput[], discountPaise = 0) =>
    proformas.createProforma(db, { type: 'B2C', customerId: null, issueDate: today, validUntil: todayIso(), discountPaise, notes: '', lines });

  it('keeps the line figures, and the invoice charges exactly what was quoted', () => {
    const q = quote(
      [
        { variantId: cheap, qty: 4, unitPricePaise: rupees(800), discountPaise: rupees(100), note: 'Set of four' },
        { variantId: dear, qty: 1, unitPricePaise: rupees(3000), ratePercent: 18 },
      ],
      rupees(70),
    );
    expect(q.lines[0]).toMatchObject({ discountPaise: rupees(100), note: 'Set of four', ratePercent: 5 });
    expect(q.taxByRate.map((g) => g.ratePercent)).toEqual([5, 18]);
    // A later change of the shop's rates must not change what was promised.
    saveSettings(db, { gstRatePercent: 28 });
    const inv = proformas.convertProforma(db, q.id);
    expect(inv.totalPaise).toBe(q.totalPaise);
    expect(inv.taxByRate).toEqual(q.taxByRate);
    expect(inv.lines.map((l) => [l.discountPaise, l.ratePercent, l.note])).toEqual([[rupees(100), 5, 'Set of four'], [0, 18, '']]);
  });

  it('shares a line\'s discount over part invoices so that the parts add up to exactly the whole', () => {
    const q = quote([{ variantId: cheap, qty: 3, unitPricePaise: rupees(800), discountPaise: 10001 }], 7);
    const first = proformas.convertProforma(db, q.id, [{ variantId: cheap, qty: 1 }]);
    const second = proformas.convertProforma(db, q.id, [{ variantId: cheap, qty: 1 }]);
    const third = proformas.convertProforma(db, q.id, [{ variantId: cheap, qty: 1 }]);
    const parts = [first, second, third];
    expect(parts.reduce((s, i) => s + i.lineDiscountPaise, 0)).toBe(10001);
    expect(parts.reduce((s, i) => s + i.discountPaise, 0)).toBe(7);
    expect(parts.reduce((s, i) => s + i.taxablePaise, 0)).toBe(q.taxablePaise);
    expect(proformas.getProforma(db, q.id).status).toBe('converted');
  });

  it('refuses what an invoice would refuse', () => {
    expect(() => quote([{ variantId: cheap, qty: 1, unitPricePaise: rupees(800), discountPaise: rupees(900) }])).toThrow(/can't be more than the item/);
  });
});

describe('upgrading a book that has invoices', () => {
  it('gives old lines the invoice\'s own rate, keeps no per-line tax, and reports exactly as before', () => {
    const old = new DatabaseSync(':memory:');
    old.exec('PRAGMA foreign_keys = ON');
    migrate(old, 13);
    const now = '2026-09-01T10:00:00.000Z';
    old.exec(`
      INSERT INTO designs (id, code, name, hsn_code, created_at, updated_at) VALUES ('d1', 'MG-001', 'Butidar', '5007', '${now}', '${now}');
      INSERT INTO variants (id, design_id, sku, color, size, stock, created_at, updated_at) VALUES ('v1', 'd1', 'MG-001-RED', 'Red', '6 m', 5, '${now}', '${now}');
      INSERT INTO invoices (id, number, fy, seq, type, seller_json, buyer_json, place_of_supply, issue_date, gst_rate_percent, intra_state, subtotal_paise, discount_paise, taxable_paise, cgst_paise, sgst_paise, round_off_paise, total_paise, created_at, updated_at)
        VALUES ('i1', 'MG/2026-27/0001', '2026-27', 1, 'B2C', '{}', '{"name":"Sunita","gstin":""}', 'Uttar Pradesh', '2026-09-01', 12, 1, 300000, 0, 300000, 18000, 18000, 0, 336000, '${now}', '${now}');
      INSERT INTO invoice_lines (id, invoice_id, variant_id, position, design_name, color, size, sku, hsn, qty, unit_price_paise, amount_paise, unit_cost_paise)
        VALUES ('l1', 'i1', 'v1', 0, 'Butidar', 'Red', '6 m', 'MG-001-RED', '5007', 3, 100000, 300000, 40000);
    `);
    migrate(old);
    expect((old.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(LATEST_SCHEMA_VERSION);
    expect({ ...old.prepare('SELECT gst_rate_percent, line_discount_paise, note, taxable_paise, tax_paise FROM invoice_lines').get() }).toEqual({ gst_rate_percent: 12, line_discount_paise: 0, note: '', taxable_paise: null, tax_paise: null });
    expect({ ...old.prepare('SELECT line_discount_paise FROM invoices').get() }).toEqual({ line_discount_paise: 0 });
    expect({ ...old.prepare('SELECT gst_rate_percent FROM designs').get() }).toEqual({ gst_rate_percent: null });

    // The old invoice still shows its one rate and the same tax, and the GST report is unchanged.
    const inv = invoices.getInvoice(old as unknown as Db, 'i1');
    expect(inv.taxByRate).toEqual([{ ratePercent: 12, taxablePaise: 300000, taxPaise: 36000, cgstPaise: 18000, sgstPaise: 18000, igstPaise: 0 }]);
    expect(inv.lines[0]).toMatchObject({ ratePercent: 12, discountPaise: 0, taxablePaise: null });
    const report = gstReport(old as unknown as Db, { from: '2026-09-01', to: '2026-09-01' });
    expect(report.hsn).toEqual([{ hsn: '5007', qty: 3, taxablePaise: 300000, cgstPaise: 18000, sgstPaise: 18000, igstPaise: 0, taxPaise: 36000 }]);
    expect(report.b2cByState).toEqual([{ placeOfSupply: 'Uttar Pradesh', ratePercent: 12, invoices: 1, taxablePaise: 300000, cgstPaise: 18000, sgstPaise: 18000, igstPaise: 0 }]);
  });
});
