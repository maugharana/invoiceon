import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../electron/db/connection';
import * as creditNotes from '../electron/services/creditNotes';
import * as customers from '../electron/services/customers';
import { gstFilingExport } from '../electron/services/filing';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import { saveSettings } from '../electron/services/settings';
import { isPortalDocNumber, portalDate, stateCodeOf, toRupees } from '../shared/filing';
import { todayIso } from '../shared/gst';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { businessName: 'Mau Gharana', state: 'Uttar Pradesh', gstin: '09AAACH7409R1ZZ', addressLine: '12 Weavers Lane', city: 'Mau', pincode: '275101', gstRatePercent: 5 });
});

const rupees = (n: number) => n * 100;
const today = todayIso();
const range = { from: today, to: today };
const parse = (f: { content: string }) => JSON.parse(f.content);

function design(code: string, hsn: string, price: number, rate?: number | null, stock = 50) {
  const d = inventory.createDesign(db, { code, name: `Design ${code}`, fabric: '', hsnCode: hsn, description: '', defaultPricePaise: rupees(price), gstRatePercent: rate });
  const v = inventory.createVariant(db, d.id, { color: 'Red', size: '5.5 m', sellPricePaise: rupees(price), baseCostPaise: rupees(price / 4), reorderLevel: 0, openingStock: stock, bom: [] });
  return v;
}
const shop = (over = {}) => customers.createCustomer(db, { name: 'Meera Sarees', type: 'B2B', phone: '', email: '', gstin: '27AAPFU0939F1ZV', address: '5 Market Road', city: 'Pune', state: 'Maharashtra', pincode: '411001', notes: '', ...over });
const walkIn = (over = {}) => customers.createCustomer(db, { name: 'Sunita', type: 'B2C', phone: '', email: '', gstin: '', address: '', city: 'Mau', state: 'Uttar Pradesh', pincode: '275101', notes: '', ...over });
const sale = (variantId: string, qty: number, price: number, over = {}) => invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId, qty, unitPricePaise: rupees(price) }], ...over });

describe('small helpers', () => {
  it('turns states into GST codes and dates into portal format', () => {
    expect(stateCodeOf('Uttar Pradesh')).toBe('09');
    expect(stateCodeOf(' maharashtra ')).toBe('27');
    expect(stateCodeOf('Atlantis')).toBeNull();
    expect(portalDate('2026-04-09', '-')).toBe('09-04-2026');
    expect(portalDate('2026-04-09', '/')).toBe('09/04/2026');
    expect(toRupees(12345)).toBe(123.45);
    expect(toRupees(5)).toBe(0.05);
  });

  it('knows which invoice numbers the e-invoice portal takes', () => {
    expect(isPortalDocNumber('INV/2025-26/0042')).toBe(true);
    expect(isPortalDocNumber('INV/2025-26/00042')).toBe(false); // 17 characters
    expect(isPortalDocNumber('0042')).toBe(false); // starts with zero
    expect(isPortalDocNumber('INV 42')).toBe(false);
  });
});

describe('GSTR-1', () => {
  it('needs your GSTIN', () => {
    saveSettings(db, { gstin: '' });
    expect(() => gstFilingExport(db, { kind: 'gstr1', ...range })).toThrow(/GSTIN/);
  });

  it('rejects a bad range and an unknown kind', () => {
    expect(() => gstFilingExport(db, { kind: 'gstr1', from: 'x', to: today })).toThrow(/valid date range/);
    expect(() => gstFilingExport(db, { kind: 'gstr1', from: today, to: '2000-01-01' })).toThrow(/after the end date/);
    expect(() => gstFilingExport(db, { kind: 'nope' as never, ...range })).toThrow(/Choose which file/);
  });

  it('sorts sales into B2B, B2CL and B2CS and adds up to the invoices', () => {
    const cotton = design('MG-1', '5208', 1000);
    const silk = design('MG-2', '5007', 3000, 18);
    const big = design('MG-3', '5007', 300000, 5);
    const m = shop();
    // B2B between states, two rates.
    const b2b = invoices.createInvoice(db, { type: 'B2B', customerId: m.id, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: cotton.id, qty: 1, unitPricePaise: rupees(1000) }, { variantId: silk.id, qty: 1, unitPricePaise: rupees(3000) }] });
    // Two small walk in sales in state, at the same rate: one B2CS row.
    const a = sale(cotton.id, 1, 1000, { customerId: walkIn().id });
    const b = sale(cotton.id, 2, 1000, { customerId: walkIn({ name: 'Rani' }).id });
    // A big sale to another state: B2CL.
    const large = sale(big.id, 1, 300000, { customerId: walkIn({ name: 'Anil', city: 'Nagpur', state: 'Maharashtra' }).id });

    const f = gstFilingExport(db, { kind: 'gstr1', ...range });
    const j = parse(f);
    expect(j.gstin).toBe('09AAACH7409R1ZZ');
    expect(j.fp).toBe(`${today.slice(5, 7)}${today.slice(0, 4)}`);

    expect(j.b2b).toHaveLength(1);
    expect(j.b2b[0].ctin).toBe('27AAPFU0939F1ZV');
    const inv = j.b2b[0].inv[0];
    expect(inv).toMatchObject({ inum: b2b.number, idt: portalDate(today, '-'), pos: '27', rchrg: 'N', inv_typ: 'R', val: toRupees(b2b.totalPaise) });
    expect(inv.itms).toHaveLength(2);
    expect(inv.itms.map((i: { itm_det: { rt: number } }) => i.itm_det.rt)).toEqual([5, 18]);
    expect(inv.itms[0].itm_det).toMatchObject({ txval: 1000, iamt: 50, camt: 0, samt: 0 });
    expect(inv.itms[1].itm_det).toMatchObject({ txval: 3000, iamt: 540 });

    expect(j.b2cl).toEqual([{ pos: '27', inv: [expect.objectContaining({ inum: large.number, val: toRupees(large.totalPaise) })] }]);
    expect(j.b2cl[0].inv[0].itms[0].itm_det).toMatchObject({ rt: 5, txval: 300000, iamt: 15000 });

    // 3 pieces at 1000, 5%, in state: CGST and SGST 2.5% each.
    expect(j.b2cs).toEqual([{ sply_ty: 'INTRA', rt: 5, typ: 'OE', pos: '09', txval: 3000, camt: 75, samt: 75, csamt: 0 }]);

    // Everything the sections say adds up to what was invoiced.
    const taxable = (x: { txval: number }[]) => x.reduce((s, i) => s + i.txval, 0);
    const b2bT = taxable(j.b2b[0].inv.flatMap((i: { itms: { itm_det: { txval: number } }[] }) => i.itms.map((t) => t.itm_det)));
    const b2clT = taxable(j.b2cl[0].inv.flatMap((i: { itms: { itm_det: { txval: number } }[] }) => i.itms.map((t) => t.itm_det)));
    expect(b2bT + b2clT + taxable(j.b2cs)).toBe((b2b.taxablePaise + a.taxablePaise + b.taxablePaise + large.taxablePaise) / 100);
    expect(f.count).toBe(1 + 1 + 2);

    // The HSN summary counts every piece once.
    expect(j.hsn.data.reduce((s: number, h: { qty: number }) => s + h.qty, 0)).toBe(1 + 1 + 1 + 2 + 1);
    const silkRow = j.hsn.data.find((h: { hsn_sc: string; rt: number }) => h.hsn_sc === '5007' && h.rt === 18);
    expect(silkRow).toMatchObject({ uqc: 'PCS', qty: 1, txval: 3000, iamt: 540, val: 3540 });

    // One series of four invoices, none cancelled.
    expect(j.doc_issue.doc_det).toHaveLength(1);
    expect(j.doc_issue.doc_det[0]).toMatchObject({ doc_num: 1 });
    expect(j.doc_issue.doc_det[0].docs[0]).toMatchObject({ totnum: 4, cancel: 0, net_issue: 4 });
  });

  it('leaves cancelled invoices out of the sections but counts them in the document series', () => {
    const v = design('MG-1', '5208', 1000);
    sale(v.id, 1, 1000);
    const gone = sale(v.id, 1, 1000);
    invoices.cancelInvoice(db, gone.id, 'wrong size');
    const j = parse(gstFilingExport(db, { kind: 'gstr1', ...range }));
    expect(j.b2cs[0]).toMatchObject({ txval: 1000 });
    expect(j.doc_issue.doc_det[0].docs[0]).toMatchObject({ totnum: 2, cancel: 1, net_issue: 1 });
  });

  it('reports a credit note to a registered buyer in cdnr, tied to its invoice', () => {
    const v = design('MG-1', '5007', 1000);
    const m = shop();
    const inv = invoices.createInvoice(db, { type: 'B2B', customerId: m.id, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: v.id, qty: 2, unitPricePaise: rupees(1000) }] });
    const cn = creditNotes.createCreditNote(db, { invoiceId: inv.id, issueDate: today, kind: 'return', reason: 'Damaged', notes: '', lines: [{ invoiceLineId: inv.lines[0]!.id, qty: 1, restock: true }] });
    const j = parse(gstFilingExport(db, { kind: 'gstr1', ...range }));
    expect(j.cdnr).toHaveLength(1);
    expect(j.cdnr[0].ctin).toBe('27AAPFU0939F1ZV');
    expect(j.cdnr[0].nt[0]).toMatchObject({ ntty: 'C', nt_num: cn.number, inum: inv.number, pos: '27', val: toRupees(cn.totalPaise) });
    expect(j.cdnr[0].nt[0].itms[0].itm_det).toMatchObject({ txval: 1000, rt: 5, iamt: 50 });
    // Returned pieces and value come off the HSN summary: one of two pieces left.
    expect(j.hsn.data[0]).toMatchObject({ qty: 1, txval: 1000 });
    expect(j.doc_issue.doc_det.map((d: { doc_num: number }) => d.doc_num)).toEqual([1, 5]);
  });

  it('takes a small consumer return off the B2CS total rather than listing it', () => {
    const v = design('MG-1', '5208', 1000);
    const inv = sale(v.id, 3, 1000, { customerId: walkIn().id });
    creditNotes.createCreditNote(db, { invoiceId: inv.id, issueDate: today, kind: 'return', reason: 'x', notes: '', lines: [{ invoiceLineId: inv.lines[0]!.id, qty: 1, restock: true }] });
    const j = parse(gstFilingExport(db, { kind: 'gstr1', ...range }));
    expect(j.cdnr).toBeUndefined();
    expect(j.b2cs).toEqual([{ sply_ty: 'INTRA', rt: 5, typ: 'OE', pos: '09', txval: 2000, camt: 50, samt: 50, csamt: 0 }]);
  });

  it('drops a B2CS row that a full return brings to nothing', () => {
    const v = design('MG-1', '5208', 1000);
    const inv = sale(v.id, 1, 1000, { customerId: walkIn().id });
    creditNotes.createCreditNote(db, { invoiceId: inv.id, issueDate: today, kind: 'return', reason: 'x', notes: '', lines: [{ invoiceLineId: inv.lines[0]!.id, qty: 1, restock: true }] });
    expect(parse(gstFilingExport(db, { kind: 'gstr1', ...range })).b2cs).toBeUndefined();
  });

  it('warns about a bad buyer GSTIN, a missing HSN and a rate that is not a GST slab', () => {
    const odd = design('MG-1', '', 1000, 7);
    const m = shop();
    invoices.createInvoice(db, { type: 'B2B', customerId: m.id, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: odd.id, qty: 1, unitPricePaise: rupees(1000) }] });
    db.prepare("UPDATE invoices SET buyer_json = json_set(buyer_json, '$.gstin', '27BROKEN')").run();
    const f = gstFilingExport(db, { kind: 'gstr1', ...range });
    const text = f.warnings.join('\n');
    expect(text).toMatch(/GSTIN "27BROKEN" is not valid/);
    expect(text).toMatch(/7%, which is not one of the standard/);
    expect(text).toMatch(/HSN/);
  });

  it('warns when the range spans months', () => {
    const f = gstFilingExport(db, { kind: 'gstr1', from: '2026-01-01', to: '2026-03-31' });
    expect(f.warnings.join('\n')).toMatch(/more than one month/);
    expect(parse(f).fp).toBe('032026');
  });
});

describe('e-invoice', () => {
  it('prepares B2B invoices only, with items that add up to the invoice', () => {
    const cotton = design('MG-1', '5208', 1000);
    const silk = design('MG-2', '5007', 3000, 18);
    const m = shop();
    const inv = invoices.createInvoice(db, { type: 'B2B', customerId: m.id, issueDate: today, dueDate: today, discountPaise: rupees(400), notes: '', lines: [{ variantId: cotton.id, qty: 1, unitPricePaise: rupees(1000) }, { variantId: silk.id, qty: 1, unitPricePaise: rupees(3000) }] });
    sale(cotton.id, 1, 1000); // a B2C sale: no IRN
    const f = gstFilingExport(db, { kind: 'einvoice', ...range });
    const list = parse(f);
    expect(f.count).toBe(1);
    expect(list).toHaveLength(1);
    const e = list[0];
    expect(e.Version).toBe('1.1');
    expect(e.TranDtls).toEqual({ TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' });
    expect(e.DocDtls).toEqual({ Typ: 'INV', No: inv.number, Dt: portalDate(today, '/') });
    expect(e.SellerDtls).toMatchObject({ Gstin: '09AAACH7409R1ZZ', Stcd: '09', Pin: 275101, Loc: 'Mau' });
    expect(e.BuyerDtls).toMatchObject({ Gstin: '27AAPFU0939F1ZV', Stcd: '27', Pos: '27', Pin: 411001, Loc: 'Pune' });
    expect(e.ItemList).toHaveLength(2);
    for (const it of e.ItemList) {
      expect(it).toMatchObject({ IsServc: 'N', Unit: 'PCS' });
      expect(Math.round((it.TotAmt - it.Discount) * 100)).toBe(Math.round(it.AssAmt * 100));
      expect(Math.round((it.AssAmt + it.IgstAmt + it.CgstAmt + it.SgstAmt) * 100)).toBe(Math.round(it.TotItemVal * 100));
    }
    const items = (k: string) => e.ItemList.reduce((s: number, it: Record<string, number>) => s + Math.round(it[k]! * 100), 0);
    expect(items('AssAmt')).toBe(Math.round(e.ValDtls.AssVal * 100));
    expect(items('IgstAmt')).toBe(Math.round(e.ValDtls.IgstVal * 100));
    expect(items('TotItemVal') + Math.round(e.ValDtls.RndOffAmt * 100)).toBe(Math.round(e.ValDtls.TotInvVal * 100));
    expect(e.ValDtls.TotInvVal).toBe(toRupees(inv.totalPaise));
    expect(f.warnings.join('\n')).not.toMatch(/pincode|HSN/);
  });

  it('includes a credit note as CRN pointing at its invoice', () => {
    const v = design('MG-1', '5007', 1000);
    const m = shop();
    const inv = invoices.createInvoice(db, { type: 'B2B', customerId: m.id, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: v.id, qty: 2, unitPricePaise: rupees(1000) }] });
    const cn = creditNotes.createCreditNote(db, { invoiceId: inv.id, issueDate: today, kind: 'return', reason: 'x', notes: '', lines: [{ invoiceLineId: inv.lines[0]!.id, qty: 1, restock: true }] });
    const list = parse(gstFilingExport(db, { kind: 'einvoice', ...range }));
    expect(list).toHaveLength(2);
    const note = list.find((e: { DocDtls: { Typ: string } }) => e.DocDtls.Typ === 'CRN');
    expect(note.DocDtls.No).toBe(cn.number);
    expect(note.PrecDocDtls).toEqual([{ InvNo: inv.number, InvDt: portalDate(today, '/') }]);
    expect(note.ValDtls.TotInvVal).toBe(toRupees(cn.totalPaise));
    expect(note.ItemList[0]).toMatchObject({ Qty: 1, AssAmt: 1000, IgstAmt: 50 });
  });

  it('warns about what the portal would refuse', () => {
    const v = design('MG-1', 'silk', 1000);
    const m = shop({ pincode: '', city: 'X' });
    invoices.createInvoice(db, { type: 'B2B', customerId: m.id, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: v.id, qty: 1, unitPricePaise: rupees(1000) }] });
    const text = gstFilingExport(db, { kind: 'einvoice', ...range }).warnings.join('\n');
    expect(text).toMatch(/pincode/);
    expect(text).toMatch(/city is missing or shorter/);
    expect(text).toMatch(/no valid HSN/);
  });
});

describe('e-way bill', () => {
  it('picks invoices above the limit and fills the goods and places in', () => {
    const v = design('MG-1', '5007', 60000);
    const small = design('MG-2', '5007', 1000);
    const m = shop();
    const big = invoices.createInvoice(db, { type: 'B2B', customerId: m.id, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: v.id, qty: 1, unitPricePaise: rupees(60000) }] });
    sale(small.id, 1, 1000);
    const f = gstFilingExport(db, { kind: 'eway', ...range });
    const j = parse(f);
    expect(f.count).toBe(1);
    expect(j.version).toBe('1.0.0621');
    const b = j.billLists[0];
    expect(b).toMatchObject({ userGstin: '09AAACH7409R1ZZ', supplyType: 'O', docType: 'INV', docNo: big.number, fromStateCode: 9, toStateCode: 27, fromPincode: 275101, toPincode: 411001, toGstin: '27AAPFU0939F1ZV', totalValue: 60000, igstValue: 3000, totInvValue: toRupees(big.totalPaise) });
    expect(b.itemList[0]).toMatchObject({ hsnCode: 5007, quantity: 1, qtyUnit: 'PCS', taxableAmount: 60000, igstRate: 5, cgstRate: 0, sgstRate: 0 });
    expect(b.transMode).toBeUndefined();
  });

  it('adds transport details, and lets you pick smaller invoices, which go to URP buyers when unregistered', () => {
    const v = design('MG-1', '5007', 1000);
    const inv = sale(v.id, 1, 1000, { customerId: walkIn().id });
    const f = gstFilingExport(db, {
      kind: 'eway',
      ...range,
      invoiceIds: [inv.id],
      transport: { mode: 'road', distanceKm: 120, vehicleNo: 'up 53 ab 1234', transporterName: 'Shree Transport', transporterId: '', docNo: 'LR-7', docDate: today },
    });
    const b = parse(f).billLists[0];
    expect(b).toMatchObject({ toGstin: 'URP', toStateCode: 9, transMode: '1', transDistance: '120', vehicleNo: 'UP53AB1234', vehicleType: 'R', transporterName: 'Shree Transport', transDocNo: 'LR-7', transDocDate: portalDate(today, '/') });
    expect(b.itemList[0]).toMatchObject({ cgstRate: 2.5, sgstRate: 2.5, igstRate: 0 });
  });

  it('says so when nothing is above the limit, and refuses a silly distance', () => {
    const v = design('MG-1', '5007', 1000);
    sale(v.id, 1, 1000);
    const f = gstFilingExport(db, { kind: 'eway', ...range });
    expect(f.count).toBe(0);
    expect(f.warnings.join('\n')).toMatch(/No invoice in this range is above/);
    expect(() => gstFilingExport(db, { kind: 'eway', ...range, transport: { mode: 'road', distanceKm: 99999, vehicleNo: 'X', transporterName: '', transporterId: '', docNo: '', docDate: '' } })).toThrow(/Distance/);
  });
});
