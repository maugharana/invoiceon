import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../electron/db/connection';
import * as creditNotes from '../electron/services/creditNotes';
import * as customers from '../electron/services/customers';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as proformas from '../electron/services/proformas';
import * as reports from '../electron/services/reports';
import { getSettings, saveSettings } from '../electron/services/settings';
import { computeTotals, resolveGstRate, todayIso } from '../shared/gst';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { state: 'Uttar Pradesh', gstin: '09AAACH7409R1ZZ', gstRatePercent: 5 });
});

const rupees = (n: number) => n * 100;
const today = todayIso();

function design(code: string, hsn: string, price: number, gstRatePercent?: number | null, stock = 20) {
  const d = inventory.createDesign(db, { code, name: `Design ${code}`, fabric: '', hsnCode: hsn, description: '', defaultPricePaise: rupees(price), gstRatePercent });
  const v = inventory.createVariant(db, d.id, { color: 'Red', size: '5.5 m', sellPricePaise: rupees(price), baseCostPaise: rupees(price / 4), reorderLevel: 0, openingStock: stock, bom: [] });
  return { d, v };
}
const line = (variantId: string, qty: number, price: number) => ({ variantId, qty, unitPricePaise: rupees(price) });
const b2c = (lines: { variantId: string; qty: number; unitPricePaise: number }[], over = {}) => ({ type: 'B2C' as const, customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines, ...over });

describe('which rate a piece gets', () => {
  it('prefers the design, then the price slab, then the shop rate', () => {
    const rule = { gstRatePercent: 5, gstSlabsEnabled: true, gstSlabs: [{ upToPaise: rupees(2500), ratePercent: 5 }, { upToPaise: null, ratePercent: 18 }] };
    expect(resolveGstRate(rule, 12, rupees(9000))).toBe(12); // the design says so
    expect(resolveGstRate(rule, null, rupees(2500))).toBe(5); // up to and including the limit
    expect(resolveGstRate(rule, null, rupees(2501))).toBe(18);
    expect(resolveGstRate({ ...rule, gstSlabsEnabled: false }, null, rupees(9000))).toBe(5); // slabs off: the shop rate
    expect(resolveGstRate(rule, 0, rupees(9000))).toBe(0); // 0% is a real rate, not "unset"
  });
});

describe('an invoice with pieces at different rates', () => {
  it('taxes each piece at its own rate and shows one tax row per rate', () => {
    const cotton = design('MG-1', '5208', 1000); // shop rate 5%
    const silk = design('MG-2', '5007', 3000, 18);
    const inv = invoices.createInvoice(db, b2c([line(cotton.v.id, 1, 1000), line(silk.v.id, 1, 3000)]));
    expect(inv.taxSummary).toEqual([
      { ratePercent: 5, taxablePaise: rupees(1000), cgstPaise: rupees(25), sgstPaise: rupees(25), igstPaise: 0 },
      { ratePercent: 18, taxablePaise: rupees(3000), cgstPaise: rupees(270), sgstPaise: rupees(270), igstPaise: 0 },
    ]);
    expect(inv.lines.map((l) => l.gstRatePercent)).toEqual([5, 18]);
    expect(inv.gstRatePercent).toBe(18); // the biggest slice, for places that show one rate
    expect(inv.taxablePaise).toBe(rupees(4000));
    expect(inv.cgstPaise + inv.sgstPaise).toBe(rupees(50 + 540));
    expect(inv.totalPaise).toBe(rupees(4000 + 590));
  });

  it('shares the invoice discount across the pieces before working out each rate', () => {
    const cotton = design('MG-1', '5208', 1000);
    const silk = design('MG-2', '5007', 3000, 18);
    const inv = invoices.createInvoice(db, b2c([line(cotton.v.id, 1, 1000), line(silk.v.id, 1, 3000)], { discountPaise: rupees(400) })); // 10% off everything
    expect(inv.taxSummary.map((g) => [g.ratePercent, g.taxablePaise])).toEqual([[5, rupees(900)], [18, rupees(2700)]]);
    expect(inv.totalPaise).toBe(rupees(900 + 45 + 2700 + 486));
  });

  it('charges IGST per rate when the buyer is in another state', () => {
    const cotton = design('MG-1', '5208', 1000);
    const silk = design('MG-2', '5007', 3000, 18);
    const c = customers.createCustomer(db, { name: 'Meera', type: 'B2B', phone: '', email: '', gstin: '27AAPFU0939F1ZV', address: '', city: '', state: 'Maharashtra', pincode: '', notes: '' });
    const inv = invoices.createInvoice(db, b2c([line(cotton.v.id, 1, 1000), line(silk.v.id, 1, 3000)], { type: 'B2B', customerId: c.id }));
    expect(inv.intraState).toBe(false);
    expect(inv.taxSummary.map((g) => g.igstPaise)).toEqual([rupees(50), rupees(540)]);
    expect(inv.cgstPaise + inv.sgstPaise).toBe(0);
  });

  it('follows price slabs when the shop turns them on, using the price typed on the invoice', () => {
    saveSettings(db, { gstSlabsEnabled: true, gstSlabs: [{ upToPaise: rupees(2500), ratePercent: 5 }, { upToPaise: null, ratePercent: 18 }] });
    const a = design('MG-1', '5007', 2000);
    const b = design('MG-2', '5007', 6000);
    const inv = invoices.createInvoice(db, b2c([line(a.v.id, 1, 2000), line(b.v.id, 1, 6000)]));
    expect(inv.lines.map((l) => l.gstRatePercent)).toEqual([5, 18]);
    // Marking the cheap one up past the limit moves it into the higher slab.
    const marked = invoices.createInvoice(db, b2c([line(a.v.id, 1, 2600)]));
    expect(marked.lines[0]!.gstRatePercent).toBe(18);
    expect(marked.taxSummary).toHaveLength(1);
  });

  it('works out exactly what it always did when every piece has the same rate', () => {
    const a = design('MG-1', '5007', 1000);
    const inv = invoices.createInvoice(db, b2c([{ variantId: a.v.id, qty: 3, unitPricePaise: 12345 }], { discountPaise: 1001 }));
    const old = computeTotals({ lineAmounts: [3 * 12345], discountPaise: 1001, ratePercent: 5, intraState: true });
    expect(inv).toMatchObject({ taxablePaise: old.taxablePaise, cgstPaise: old.cgstPaise, sgstPaise: old.sgstPaise, roundOffPaise: old.roundOffPaise, totalPaise: old.totalPaise, gstRatePercent: 5 });
    expect(inv.taxSummary).toHaveLength(1);
  });

  it('reads an invoice from before rates could differ as one rate for the whole document', () => {
    const a = design('MG-1', '5007', 1000);
    const inv = invoices.createInvoice(db, b2c([line(a.v.id, 2, 1000)]));
    db.prepare('UPDATE invoices SET tax_summary_json = NULL WHERE id = ?').run(inv.id);
    db.prepare('UPDATE invoice_lines SET gst_rate_percent = NULL WHERE invoice_id = ?').run(inv.id);
    const old = invoices.getInvoice(db, inv.id);
    expect(old.taxSummary).toEqual([{ ratePercent: 5, taxablePaise: rupees(2000), cgstPaise: rupees(50), sgstPaise: rupees(50), igstPaise: 0 }]);
    expect(old.lines[0]!.gstRatePercent).toBe(5);
    // and the reports still read it
    expect(reports.gstReport(db, { from: today, to: today }).totals.taxPaise).toBe(rupees(100));
  });
});

describe('proformas', () => {
  it('quote at per piece rates too, and converting keeps the rates', () => {
    const cotton = design('MG-1', '5208', 1000);
    const silk = design('MG-2', '5007', 3000, 18);
    const p = proformas.createProforma(db, { ...b2c([line(cotton.v.id, 1, 1000), line(silk.v.id, 1, 3000)]), validUntil: today });
    expect(p.taxSummary.map((g) => g.ratePercent)).toEqual([5, 18]);
    expect(p.totalPaise).toBe(rupees(4590));
    const inv = proformas.convertProforma(db, p.id);
    expect(inv.taxSummary.map((g) => g.ratePercent)).toEqual([5, 18]);
    expect(inv.totalPaise).toBe(p.totalPaise);
  });
});

describe('GST report with several rates', () => {
  it('splits HSN and register rows by rate and still adds up to the invoice totals', () => {
    const cotton = design('MG-1', '5007', 1000); // same HSN as the silk, different rate
    const silk = design('MG-2', '5007', 3000, 18);
    const c = customers.createCustomer(db, { name: 'Kanchan', type: 'B2B', phone: '', email: '', gstin: '27AAPFU0939F1ZV', address: '', city: '', state: 'Maharashtra', pincode: '', notes: '' });
    const inv = invoices.createInvoice(db, b2c([line(cotton.v.id, 2, 1000), line(silk.v.id, 1, 3000)], { type: 'B2B', customerId: c.id, discountPaise: 111 }));
    const r = reports.gstReport(db, { from: today, to: today });

    expect(r.hsn.map((h) => [h.hsn, h.ratePercent, h.qty]).sort()).toEqual([['5007', 18, 1], ['5007', 5, 2]]);
    const sum = (f: (h: (typeof r.hsn)[number]) => number) => r.hsn.reduce((s, h) => s + f(h), 0);
    expect(sum((h) => h.taxablePaise)).toBe(r.totals.taxablePaise);
    expect(sum((h) => h.igstPaise)).toBe(r.totals.igstPaise);

    expect(r.b2bRegister).toHaveLength(2);
    expect(r.b2bRegister.every((row) => row.invoiceId === inv.id && row.gstin === '27AAPFU0939F1ZV')).toBe(true);
    expect(r.b2bRegister.map((row) => row.ratePercent)).toEqual([5, 18]);
    expect(r.b2bRegister.reduce((s, row) => s + row.totalPaise, 0)).toBe(inv.totalPaise);
    expect(r.b2bRegister.reduce((s, row) => s + row.taxablePaise, 0)).toBe(inv.taxablePaise);
  });

  it('rolls retail sales up by state and rate', () => {
    const cotton = design('MG-1', '5208', 1000);
    const silk = design('MG-2', '5007', 3000, 18);
    invoices.createInvoice(db, b2c([line(cotton.v.id, 1, 1000), line(silk.v.id, 1, 3000)]));
    invoices.createInvoice(db, b2c([line(silk.v.id, 1, 3000)]));
    const r = reports.gstReport(db, { from: today, to: today });
    expect(r.b2cByState).toEqual([
      { placeOfSupply: 'Uttar Pradesh', ratePercent: 18, invoices: 2, taxablePaise: rupees(6000), cgstPaise: rupees(540), sgstPaise: rupees(540), igstPaise: 0 },
      { placeOfSupply: 'Uttar Pradesh', ratePercent: 5, invoices: 1, taxablePaise: rupees(1000), cgstPaise: rupees(25), sgstPaise: rupees(25), igstPaise: 0 },
    ]);
  });
});

describe('credit notes on an invoice with several rates', () => {
  function mixed() {
    const cotton = design('MG-1', '5208', 1000);
    const silk = design('MG-2', '5007', 3000, 18);
    const c = customers.createCustomer(db, { name: 'Sunita', type: 'B2C', phone: '', email: '', gstin: '', address: '', city: '', state: 'Uttar Pradesh', pincode: '', notes: '' });
    const inv = invoices.createInvoice(db, b2c([line(cotton.v.id, 1, 1000), line(silk.v.id, 1, 3000)], { customerId: c.id }));
    return { inv, cotton, silk };
  }

  it('credits a returned piece at the rate it was sold at', () => {
    const { inv } = mixed();
    const silkLine = inv.lines.find((l) => l.gstRatePercent === 18)!;
    const cn = creditNotes.createCreditNote(db, { invoiceId: inv.id, issueDate: today, kind: 'return', reason: '', notes: '', lines: [{ invoiceLineId: silkLine.id, qty: 1, restock: true }] });
    expect(cn.taxSummary).toHaveLength(1);
    expect(cn.taxSummary[0]).toMatchObject({ ratePercent: 18, taxablePaise: rupees(3000) });
    expect(cn.totalPaise).toBe(rupees(3540));
  });

  it('asks which rate a price adjustment applies to, and only accepts rates on the invoice', () => {
    const { inv } = mixed();
    const base = { invoiceId: inv.id, issueDate: today, kind: 'adjustment' as const, reason: 'Flaw', notes: '' };
    expect(() => creditNotes.createCreditNote(db, { ...base, adjustment: { taxablePaise: rupees(100) } })).toThrow(/different GST rates/);
    expect(() => creditNotes.createCreditNote(db, { ...base, adjustment: { taxablePaise: rupees(100), ratePercent: 12 } })).toThrow(/not on this invoice/);
    const cn = creditNotes.createCreditNote(db, { ...base, adjustment: { taxablePaise: rupees(100), ratePercent: 18 } });
    expect(cn.totalPaise).toBe(rupees(118));
  });
});

describe('settings and designs', () => {
  it('validates price slabs', () => {
    expect(getSettings(db)).toMatchObject({ gstSlabsEnabled: false, gstSlabs: [{ upToPaise: 250000, ratePercent: 5 }, { upToPaise: null, ratePercent: 18 }] });
    const bad = (gstSlabs: unknown) => () => saveSettings(db, { gstSlabs: gstSlabs as never });
    expect(bad([])).toThrow(/between one and six/);
    expect(bad([{ upToPaise: 1000, ratePercent: 5 }])).toThrow(/and above/);
    expect(bad([{ upToPaise: 5000, ratePercent: 5 }, { upToPaise: 4000, ratePercent: 12 }, { upToPaise: null, ratePercent: 18 }])).toThrow(/must go up/);
    expect(bad([{ upToPaise: null, ratePercent: 5 }, { upToPaise: null, ratePercent: 18 }])).toThrow(/must go up/);
    expect(bad([{ upToPaise: null, ratePercent: 150 }])).toThrow(/between 0 and 100/);
    expect(saveSettings(db, { gstSlabsEnabled: true, gstSlabs: [{ upToPaise: rupees(1000), ratePercent: 5 }, { upToPaise: rupees(5000), ratePercent: 12 }, { upToPaise: null, ratePercent: 18 }] }).gstSlabs).toHaveLength(3);
  });

  it('validates a design rate, and blank means "use the shop rate"', () => {
    expect(() => design('MG-9', '5007', 100, 120)).toThrow(/between 0 and 100/);
    const { d } = design('MG-1', '5007', 100, 12);
    expect(inventory.getDesign(db, d.id).gstRatePercent).toBe(12);
    expect(invoices.variantsForSale(db)[0]!.designGstRatePercent).toBe(12); // what the invoice screen uses to preview the tax
    const cleared = inventory.updateDesign(db, d.id, { code: 'MG-1', name: 'Design MG-1', fabric: '', hsnCode: '5007', description: '', defaultPricePaise: 10000, gstRatePercent: null });
    expect(cleared.gstRatePercent).toBeNull();
    expect(invoices.variantsForSale(db)[0]!.designGstRatePercent).toBeNull();
  });
});
