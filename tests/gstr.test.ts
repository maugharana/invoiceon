import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import * as credits from '../electron/services/creditNotes';
import * as customers from '../electron/services/customers';
import { gstr1 } from '../electron/services/gstr';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import { gstReport } from '../electron/services/reports';
import { saveSettings } from '../electron/services/settings';
import { todayIso } from '../shared/gst';

const rupees = (n: number) => n * 100;
const today = todayIso();
const lastDay = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0).getDate();
const month = { from: `${today.slice(0, 7)}-01`, to: `${today.slice(0, 7)}-${String(lastDay).padStart(2, '0')}` };
const dmy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
let db: Db;
let cotton: string;
let silk: string;
let biz: string;
let shopper: string;

beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { gstin: '09AABCK1234M1ZI', state: 'Uttar Pradesh', invoicePrefix: 'MG' });
  const d1 = inventory.createDesign(db, { code: 'MG-001', name: 'Cotton', fabric: '', hsnCode: '5208', description: '', defaultPricePaise: rupees(800) });
  cotton = inventory.createVariant(db, d1.id, { color: 'Red', size: '6 m', sellPricePaise: rupees(800), baseCostPaise: 0, reorderLevel: 0, openingStock: 50, bom: [] }).id;
  const d2 = inventory.createDesign(db, { code: 'MG-002', name: 'Banarasi', fabric: '', hsnCode: '5007', description: '', defaultPricePaise: rupees(3000), gstRatePercent: 18 });
  silk = inventory.createVariant(db, d2.id, { color: 'Gold', size: '6 m', sellPricePaise: rupees(3000), baseCostPaise: 0, reorderLevel: 0, openingStock: 50, bom: [] }).id;
  biz = customers.createCustomer(db, { name: 'Kanchan Sarees', type: 'B2B', phone: '', email: '', gstin: '09AAACH7409R1ZZ', address: '', city: 'Varanasi', state: 'Uttar Pradesh', pincode: '', notes: '' }).id;
  shopper = customers.createCustomer(db, { name: 'Meena', type: 'B2C', phone: '', email: '', gstin: '', address: '', city: 'Delhi', state: 'Delhi', pincode: '', notes: '' }).id;
});

const restock = () => {
  inventory.adjustStock(db, { variantId: silk, delta: 100, reason: 'purchase', note: '' });
  inventory.adjustStock(db, { variantId: cotton, delta: 100, reason: 'purchase', note: '' });
};

const sell = (over: Partial<Parameters<typeof invoices.createInvoice>[1]>) =>
  invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: cotton, qty: 1, unitPricePaise: rupees(800) }], ...over });

describe('the GSTR-1 file', () => {
  it('lists an inter-state sale to a private buyer above ₹1 lakh invoice by invoice, and keeps everything else in the small-supplies totals', () => {
    restock();
    // Silk is 18%: 33 × ₹3,000 = ₹99,000 + tax = ₹1,16,820 (large); 28 × ₹3,000 = ₹84,000 + tax = ₹99,120 (small).
    const big = sell({ customerId: shopper, lines: [{ variantId: silk, qty: 33, unitPricePaise: rupees(3000) }] });
    const small = sell({ customerId: shopper, lines: [{ variantId: silk, qty: 28, unitPricePaise: rupees(3000) }] });
    expect([big.totalPaise, small.totalPaise]).toEqual([rupees(116820), rupees(99120)]);
    const out = gstr1(db, month);
    const file = JSON.parse(out.json);
    expect(file.b2cl).toEqual([{ pos: '07', inv: [{ inum: big.number, idt: dmy(today), val: 116820, itms: [{ num: 1, itm_det: { txval: 99000, rt: 18, iamt: 17820, csamt: 0 } }] }] }]);
    expect(file.b2cs).toEqual([{ sply_ty: 'INTER', rt: 18, typ: 'OE', pos: '07', txval: 84000, iamt: 15120, camt: 0, samt: 0, csamt: 0 }]);
    expect(out.counts).toMatchObject({ b2clInvoices: 1, b2cLines: 1 });
  });

  it('does not list a large sale inside the state, or one of exactly ₹1 lakh, as B2CL', () => {
    restock();
    sell({ customerId: null, lines: [{ variantId: silk, qty: 40, unitPricePaise: rupees(3000) }] }); // ₹1,41,600 but within Uttar Pradesh
    saveSettings(db, { gstRatePercent: 0 });
    sell({ customerId: shopper, lines: [{ variantId: cotton, qty: 125, unitPricePaise: rupees(800) }] }); // exactly ₹1,00,000, inter-state
    expect(JSON.parse(gstr1(db, month).json).b2cl).toBeUndefined();
  });

  it('puts a credit note against a B2CL invoice in the unregistered-credit-note table, not in the small totals', () => {
    restock();
    const big = sell({ customerId: shopper, lines: [{ variantId: silk, qty: 33, unitPricePaise: rupees(3000) }] });
    const note = credits.createCreditNote(db, { invoiceId: big.id, issueDate: today, reason: 'Returned', lines: [{ invoiceLineId: invoices.getInvoice(db, big.id).lines[0]!.id, qty: 3, restock: true }], settlement: 'credit' });
    const file = JSON.parse(gstr1(db, month).json);
    expect(file.cdnur).toEqual([{ typ: 'B2CL', ntty: 'C', nt_num: note.number, nt_dt: dmy(today), pos: '07', val: 10620, itms: [{ num: 1, itm_det: { txval: 9000, rt: 18, iamt: 1620, csamt: 0 } }] }]);
    expect(file.b2cs).toBeUndefined();
  });

  it('lists the documents issued separately for each numbering series', () => {
    saveSettings(db, { b2bPrefix: 'B2B' });
    sell({});
    sell({ type: 'B2B', customerId: biz });
    sell({ type: 'B2B', customerId: biz });
    const fy = invoices.nextInvoiceNumber(db, today).split('/')[1];
    const docs = JSON.parse(gstr1(db, month).json).doc_issue.doc_det;
    expect(docs).toEqual([{ doc_num: 1, docs: [
      { num: 1, from: `MG/${fy}/0001`, to: `MG/${fy}/0001`, totnum: 1, cancel: 0, net_issue: 1 },
      { num: 2, from: `B2B/${fy}/0001`, to: `B2B/${fy}/0002`, totnum: 2, cancel: 0, net_issue: 2 },
    ] }]);
  });

  it('lists business invoices by buyer, with tax by rate, the date the portal wants, and the place of supply', () => {
    const inv = sell({ type: 'B2B', customerId: biz, lines: [{ variantId: cotton, qty: 2, unitPricePaise: rupees(800) }, { variantId: silk, qty: 1, unitPricePaise: rupees(3000) }] });
    const out = gstr1(db, month);
    const file = JSON.parse(out.json);
    expect(file).toMatchObject({ gstin: '09AABCK1234M1ZI', fp: `${today.slice(5, 7)}${today.slice(0, 4)}` });
    expect(file.b2b).toHaveLength(1);
    expect(file.b2b[0].ctin).toBe('09AAACH7409R1ZZ');
    const [row] = file.b2b[0].inv;
    expect(row).toMatchObject({ inum: inv.number, idt: dmy(today), val: inv.totalPaise / 100, pos: '09', rchrg: 'N', inv_typ: 'R' });
    expect(row.itms).toEqual([
      { num: 1, itm_det: { txval: 1600, rt: 5, iamt: 0, camt: 40, samt: 40, csamt: 0 } },
      { num: 2, itm_det: { txval: 3000, rt: 18, iamt: 0, camt: 270, samt: 270, csamt: 0 } },
    ]);
    expect(out.fileName).toBe(`GSTR1_09AABCK1234M1ZI_${file.fp}.json`);
  });

  it('rolls retail sales up by in-state or out-of-state, rate and state, never bill by bill', () => {
    sell({});
    sell({});
    sell({ customerId: shopper }); // Delhi: out of state
    const file = JSON.parse(gstr1(db, month).json);
    expect(file.b2b).toBeUndefined();
    expect(file.b2cs).toEqual([
      { sply_ty: 'INTRA', rt: 5, typ: 'OE', pos: '09', txval: 1600, iamt: 0, camt: 40, samt: 40, csamt: 0 },
      { sply_ty: 'INTER', rt: 5, typ: 'OE', pos: '07', txval: 800, iamt: 40, camt: 0, samt: 0, csamt: 0 },
    ]);
  });

  it('takes credit notes to retail buyers off the retail totals, and lists those to businesses on their own', () => {
    const retail = sell({ lines: [{ variantId: cotton, qty: 3, unitPricePaise: rupees(800) }] });
    const trade = sell({ type: 'B2B', customerId: biz, lines: [{ variantId: silk, qty: 2, unitPricePaise: rupees(3000) }] });
    const r = credits.createCreditNote(db, { invoiceId: retail.id, issueDate: today, reason: 'Returned', lines: [{ invoiceLineId: invoices.getInvoice(db, retail.id).lines[0]!.id, qty: 1, restock: true }], settlement: 'refund', refund: { method: 'cash' } });
    const t = credits.createCreditNote(db, { invoiceId: trade.id, issueDate: today, reason: 'Returned', lines: [{ invoiceLineId: invoices.getInvoice(db, trade.id).lines[0]!.id, qty: 1, restock: true }], settlement: 'refund', refund: { method: 'cash' } });
    const file = JSON.parse(gstr1(db, month).json);
    expect(file.b2cs).toEqual([{ sply_ty: 'INTRA', rt: 5, typ: 'OE', pos: '09', txval: 1600, iamt: 0, camt: 40, samt: 40, csamt: 0 }]);
    expect(file.cdnr).toEqual([
      {
        ctin: '09AAACH7409R1ZZ',
        nt: [{ ntty: 'C', nt_num: t.number, nt_dt: dmy(today), val: t.totalPaise / 100, pos: '09', rchrg: 'N', inv_typ: 'R', itms: [{ num: 1, itm_det: { txval: 3000, rt: 18, iamt: 0, camt: 270, samt: 270, csamt: 0 } }] }],
      },
    ]);
    expect(r.number).not.toBe(t.number);
  });

  it('agrees with the GST report to the paisa: the HSN summary is net of credit notes, and the documents issued are counted', () => {
    const a = sell({ lines: [{ variantId: cotton, qty: 3, unitPricePaise: rupees(800) }, { variantId: silk, qty: 1, unitPricePaise: rupees(3000) }] });
    const b = sell({});
    sell({});
    invoices.cancelInvoice(db, b.id, 'wrong');
    credits.createCreditNote(db, { invoiceId: a.id, issueDate: today, reason: 'Returned', lines: [{ invoiceLineId: invoices.getInvoice(db, a.id).lines[0]!.id, qty: 1, restock: true }], settlement: 'refund', refund: { method: 'cash' } });
    const out = gstr1(db, month);
    const file = JSON.parse(out.json);
    const report = gstReport(db, month);
    const sum = (key: string) => file.hsn.data.reduce((s: number, h: Record<string, number>) => s + h[key]!, 0);
    expect(Math.round(sum('txval') * 100)).toBe(report.netTotals.taxablePaise);
    expect(Math.round((sum('camt') + sum('samt') + sum('iamt')) * 100)).toBe(report.netTotals.taxPaise);
    expect(file.hsn.data.map((h: { hsn_sc: string; qty: number; uqc: string }) => [h.hsn_sc, h.qty, h.uqc])).toEqual([['5208', 3, 'PCS'], ['5007', 1, 'PCS']]);
    expect(file.doc_issue.doc_det).toEqual([
      { doc_num: 1, docs: [{ num: 1, from: a.number, to: expect.stringMatching(/\/0003$/), totnum: 3, cancel: 1, net_issue: 2 }] },
      { doc_num: 5, docs: [{ num: 1, from: expect.stringMatching(/^CN\//), to: expect.stringMatching(/^CN\//), totnum: 1, cancel: 0, net_issue: 1 }] },
    ]);
    expect(out.counts).toMatchObject({ creditNotes: 1, hsnLines: 2 });
  });

  it('warns about what the portal will reject, instead of hiding it', () => {
    saveSettings(db, { gstin: '' });
    const noHsn = inventory.createDesign(db, { code: 'MG-009', name: 'Plain', fabric: '', hsnCode: '', description: '', defaultPricePaise: rupees(500) });
    const v = inventory.createVariant(db, noHsn.id, { color: 'Blue', size: '6 m', sellPricePaise: rupees(500), baseCostPaise: 0, reorderLevel: 0, openingStock: 5, bom: [] });
    sell({ lines: [{ variantId: v.id, qty: 1, unitPricePaise: rupees(500) }] });
    const out = gstr1(db, month);
    expect(out.warnings.some((w) => /own GSTIN is not set/.test(w))).toBe(true);
    expect(out.warnings.some((w) => /no HSN code/.test(w))).toBe(true);
  });

  it('is for one month, and an empty month is an empty but valid file', async () => {
    expect(() => gstr1(db, { from: '2026-09-01', to: '2026-10-31' })).toThrow(/one month at a time/);
    const file = JSON.parse(gstr1(db, month).json);
    expect(file).toEqual({ gstin: '09AABCK1234M1ZI', fp: expect.any(String), version: 'GST3.0.4', hash: 'hash', gt: 0, cur_gt: 0 });
    const api = createApi(db);
    expect((await api.reportGstr1(month)).counts.b2bInvoices).toBe(0);
  });
});
