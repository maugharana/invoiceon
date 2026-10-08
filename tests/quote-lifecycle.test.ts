import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../electron/db/connection';
import * as customers from '../electron/services/customers';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as payments from '../electron/services/payments';
import * as moreReports from '../electron/services/moreReports';
import * as proformas from '../electron/services/proformas';
import { saveSettings } from '../electron/services/settings';
import { addDays, todayIso } from '../shared/gst';
import { buildPipeline } from '../shared/pipeline';
import type { ProformaInput } from '../shared/types';

const rupees = (n: number) => n * 100;
const today = todayIso();
let db: Db;
let red: string;
let blue: string;
let customerId: string;

beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { gstin: '09AABCK1234M1ZI' });
  const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: '', hsnCode: '5007', description: '', defaultPricePaise: rupees(1000) });
  const mk = (color: string, stock: number) => inventory.createVariant(db, d.id, { color, size: '6 m', sellPricePaise: rupees(1000), baseCostPaise: 0, reorderLevel: 0, openingStock: stock, bom: [] }).id;
  red = mk('Red', 10);
  blue = mk('Blue', 10);
  customerId = customers.createCustomer(db, { name: 'Meena', type: 'B2C', phone: '', email: '', gstin: '', address: '', city: '', state: '', pincode: '', notes: '' }).id;
});

const quote = (over: Partial<ProformaInput> = {}) =>
  proformas.createProforma(db, {
    type: 'B2C',
    customerId,
    issueDate: today,
    validUntil: addDays(today, 15),
    discountPaise: 0,
    notes: '',
    lines: [
      { variantId: red, qty: 4, unitPricePaise: rupees(1000) },
      { variantId: blue, qty: 2, unitPricePaise: rupees(1000) },
    ],
    ...over,
  });
const stock = (id: string) => inventory.getVariant(db, id).stock;

describe('invoicing part of a quote', () => {
  it('takes only the chosen pieces, leaves the quote part-invoiced, and finishes it on the last part', () => {
    const q = quote();
    const first = proformas.convertProforma(db, q.id, [{ variantId: red, qty: 3 }]);
    expect(first.totalPaise).toBe(rupees(3000) * 1.05);
    expect(stock(red)).toBe(7);
    expect(stock(blue)).toBe(10); // untouched
    const mid = proformas.getProforma(db, q.id);
    expect(mid.status).toBe('partial');
    expect(mid.lines.map((l) => [l.qty, l.invoicedQty])).toEqual([[4, 3], [2, 0]]);
    expect(mid.invoicedPaise).toBe(rupees(3000));
    expect(mid.stage).toBe('accepted');

    // "Everything left" takes the remaining 1 red and 2 blue.
    const second = proformas.convertProforma(db, q.id);
    expect(second.lines.map((l) => [l.variantId, l.qty]).sort()).toEqual([[blue, 2], [red, 1]].sort());
    const done = proformas.getProforma(db, q.id);
    expect(done.status).toBe('converted');
    expect(done.invoices.map((i) => i.number)).toEqual([first.number, second.number]);
    expect(() => proformas.convertProforma(db, q.id)).toThrow(/already invoice/);
  });

  it('refuses more than is left, a repeated item, or an item not on the quote — changing nothing', () => {
    const q = quote();
    expect(() => proformas.convertProforma(db, q.id, [{ variantId: red, qty: 5 }])).toThrow(/Only 4/);
    expect(() => proformas.convertProforma(db, q.id, [{ variantId: red, qty: 1 }, { variantId: red, qty: 1 }])).toThrow(/twice/);
    expect(() => proformas.convertProforma(db, q.id, [{ variantId: 'x', qty: 1 }])).toThrow(/not on this quote/);
    expect(() => proformas.convertProforma(db, q.id, [{ variantId: red, qty: 0 }])).toThrow(/1 or more/);
    proformas.convertProforma(db, q.id, [{ variantId: red, qty: 4 }]);
    expect(() => proformas.convertProforma(db, q.id, [{ variantId: red, qty: 1 }])).toThrow(/already been invoiced in full/);
    expect(stock(red)).toBe(6);
  });

  it('shares the quoted discount between the parts so that together they carry exactly what was quoted', () => {
    const q = quote({ discountPaise: rupees(601) });
    const a = proformas.convertProforma(db, q.id, [{ variantId: red, qty: 3 }]); // half of the 6000 subtotal is 3000 → ₹300.16 floored by value
    const b = proformas.convertProforma(db, q.id);
    expect(a.discountPaise + b.discountPaise).toBe(rupees(601));
    expect(a.discountPaise).toBe(Math.floor((rupees(601) * rupees(3000)) / rupees(6000)));
  });

  it('puts a fully-invoiced quote back to open when one of its invoices is cancelled', () => {
    const q = quote();
    const a = proformas.convertProforma(db, q.id, [{ variantId: red, qty: 4 }]);
    proformas.convertProforma(db, q.id);
    expect(proformas.getProforma(db, q.id).status).toBe('converted');
    invoices.cancelInvoice(db, a.id, 'wrong');
    const after = proformas.getProforma(db, q.id);
    expect(after.status).toBe('partial');
    expect(after.lines.map((l) => l.invoicedQty)).toEqual([0, 2]);
    expect(after.invoices).toHaveLength(1);
    // The 4 reds are available to invoice again.
    expect(proformas.convertProforma(db, q.id, [{ variantId: red, qty: 4 }]).lines[0].qty).toBe(4);
  });

  it('cannot be edited once any of it is invoiced', () => {
    const q = quote();
    proformas.convertProforma(db, q.id, [{ variantId: red, qty: 1 }]);
    expect(() => proformas.updateProforma(db, q.id, { type: 'B2C', customerId, issueDate: today, validUntil: addDays(today, 15), discountPaise: 0, notes: '', lines: [{ variantId: red, qty: 1, unitPricePaise: 1 }] })).toThrow(/already been invoiced/);
  });
});

describe('where a quote stands', () => {
  it('can be marked accepted, then lost with a reason, and reopened', () => {
    const q = quote();
    expect(q.stage).toBe('open');
    expect(proformas.setQuoteStage(db, q.id, 'accepted').stage).toBe('accepted');
    const lost = proformas.setQuoteStage(db, q.id, 'lost', 'Found it cheaper');
    expect(lost).toMatchObject({ stage: 'lost', lostReason: 'Found it cheaper', status: 'lost' });
    expect(() => proformas.convertProforma(db, q.id)).toThrow(/marked lost/);
    expect(() => proformas.updateProforma(db, q.id, { type: 'B2C', customerId, issueDate: today, validUntil: addDays(today, 15), discountPaise: 0, notes: '', lines: [{ variantId: red, qty: 1, unitPricePaise: 1 }] })).toThrow(/marked lost/);
    const reopened = proformas.setQuoteStage(db, q.id, 'open');
    expect(reopened).toMatchObject({ stage: 'open', lostReason: '', status: 'open' });
  });

  it('will not be called lost once part of it is invoiced, or after it is cancelled or fully invoiced', () => {
    const q = quote();
    proformas.convertProforma(db, q.id, [{ variantId: red, qty: 1 }]);
    expect(() => proformas.setQuoteStage(db, q.id, 'lost', '')).toThrow(/already invoiced/);
    proformas.cancelProforma(db, q.id, '');
    expect(() => proformas.setQuoteStage(db, q.id, 'accepted')).toThrow(/cancelled/);
  });
});

describe('versions of a quote', () => {
  it('keeps what a quote was before each change, newest first', () => {
    const q = quote();
    const edit = (qty: number, price: number) =>
      proformas.updateProforma(db, q.id, { type: 'B2C', customerId, issueDate: today, validUntil: addDays(today, 20), discountPaise: 0, notes: `v${qty}`, lines: [{ variantId: red, qty, unitPricePaise: price }] });
    edit(2, rupees(900));
    edit(1, rupees(800));
    const revs = proformas.listRevisions(db, q.id);
    expect(revs.map((r) => r.version)).toEqual([2, 1]);
    expect(revs[1]).toMatchObject({ version: 1, totalPaise: q.totalPaise, notes: '' });
    expect(revs[1].lines.map((l) => l.qty)).toEqual([4, 2]);
    expect(revs[0].lines).toHaveLength(1);
    expect(revs[0].lines[0]).toMatchObject({ qty: 2, unitPricePaise: rupees(900) });
    expect(proformas.getProforma(db, q.id).lines[0]).toMatchObject({ qty: 1, unitPricePaise: rupees(800) });
  });

  it('has no versions until it is first changed', () => {
    expect(proformas.listRevisions(db, quote().id)).toEqual([]);
  });
});

describe('deposits against a quote', () => {
  const deposit = (proformaId: string, amount: number, over: Partial<Parameters<typeof payments.recordPayment>[1]> = {}) =>
    payments.recordPayment(db, { customerId, amountPaise: amount, method: 'cash', reference: '', receivedOn: today, note: 'Deposit', allocations: [], proformaId, ...over });

  it('is held as advance, shown on the quote, and put toward the invoice when it is made', () => {
    const q = quote();
    deposit(q.id, rupees(2000));
    expect(proformas.getProforma(db, q.id).depositPaise).toBe(rupees(2000));
    expect(customers.getCustomer(db, customerId).advancePaise).toBe(rupees(2000));
    const inv = proformas.convertProforma(db, q.id, [{ variantId: red, qty: 4 }]); // ₹4,200 with GST
    expect(inv.paidPaise).toBe(rupees(2000));
    expect(customers.getCustomer(db, customerId).advancePaise).toBe(0);
    // A second part does not use the same deposit twice.
    const second = proformas.convertProforma(db, q.id);
    expect(second.paidPaise).toBe(0);
  });

  it('only applies up to the invoice, keeping the rest for the next part', () => {
    const q = quote();
    deposit(q.id, rupees(9000));
    const first = proformas.convertProforma(db, q.id, [{ variantId: red, qty: 1 }]); // ₹1,050
    expect(first.paidPaise).toBe(rupees(1050));
    const second = proformas.convertProforma(db, q.id);
    expect(second.paidPaise).toBe(second.totalPaise); // ₹5,250 — still covered
    expect(customers.getCustomer(db, customerId).advancePaise).toBe(rupees(9000) - rupees(1050) - second.totalPaise);
  });

  it('is refused for a closed quote, another customer, or no customer', () => {
    const q = quote();
    const other = customers.createCustomer(db, { name: 'Other', type: 'B2C', phone: '', email: '', gstin: '', address: '', city: '', state: '', pincode: '', notes: '' });
    expect(() => deposit(q.id, 100, { customerId: other.id })).toThrow(/own customer/);
    expect(() => deposit(q.id, 100, { customerId: null })).toThrow(/customer/);
    expect(() => deposit('nope', 100)).toThrow(/no longer exists/);
    proformas.setQuoteStage(db, q.id, 'lost', '');
    expect(() => deposit(q.id, 100)).toThrow(/closed/);
  });

  it('stops counting once the deposit payment is reversed', () => {
    const q = quote();
    const p = deposit(q.id, rupees(500));
    payments.voidPayment(db, p.id, 'mistake');
    expect(proformas.getProforma(db, q.id).depositPaise).toBe(0);
  });
});

describe('quote templates', () => {
  it('saves a set of items, lists it, replaces it under the same name, and removes it', () => {
    const t = proformas.saveTemplate(db, { name: 'Bridal set', notes: 'Includes blouse', lines: [{ variantId: red, qty: 2, unitPricePaise: rupees(1000) }] });
    expect(proformas.listTemplates(db)).toEqual([t]);
    const again = proformas.saveTemplate(db, { name: 'bridal SET', notes: '', lines: [{ variantId: blue, qty: 1, unitPricePaise: rupees(900) }] });
    expect(again.id).toBe(t.id);
    expect(proformas.listTemplates(db)).toHaveLength(1);
    expect(proformas.listTemplates(db)[0].lines[0].variantId).toBe(blue);
    proformas.deleteTemplate(db, t.id);
    expect(proformas.listTemplates(db)).toEqual([]);
    expect(() => proformas.deleteTemplate(db, t.id)).toThrow(/no longer exists/);
  });

  it('keeps a discount on each item, which is how a bundle has a price of its own, and still reads templates saved without one', () => {
    const t = proformas.saveTemplate(db, { name: 'Wedding bundle', notes: '', lines: [{ variantId: red, qty: 2, unitPricePaise: rupees(1000), discountPaise: rupees(150) }, { variantId: blue, qty: 1, unitPricePaise: rupees(900) }] });
    expect(t.lines).toEqual([{ variantId: red, qty: 2, unitPricePaise: rupees(1000), discountPaise: rupees(150) }, { variantId: blue, qty: 1, unitPricePaise: rupees(900) }]);
    expect(proformas.listTemplates(db)[0]!.lines[0]!.discountPaise).toBe(rupees(150));
    db.exec(`UPDATE quote_templates SET lines_json = '[{"variantId":"${red}","qty":1,"unitPricePaise":100000}]'`);
    expect(proformas.listTemplates(db)[0]!.lines).toEqual([{ variantId: red, qty: 1, unitPricePaise: 100000 }]);
    expect(() => proformas.saveTemplate(db, { name: 'x', notes: '', lines: [{ variantId: red, qty: 1, unitPricePaise: rupees(1000), discountPaise: rupees(1001) }] })).toThrow(/more than the item/);
    expect(() => proformas.saveTemplate(db, { name: 'x', notes: '', lines: [{ variantId: red, qty: 1, unitPricePaise: rupees(1000), discountPaise: -1 }] })).toThrow(/more than the item/);
  });

  it('needs a name, items, and items that exist', () => {
    expect(() => proformas.saveTemplate(db, { name: ' ', notes: '', lines: [{ variantId: red, qty: 1, unitPricePaise: 1 }] })).toThrow(/name/);
    expect(() => proformas.saveTemplate(db, { name: 'x', notes: '', lines: [] })).toThrow(/at least one/);
    expect(() => proformas.saveTemplate(db, { name: 'x', notes: '', lines: [{ variantId: 'nope', qty: 1, unitPricePaise: 1 }] })).toThrow(/no longer exists/);
  });
});

describe('the quotes report', () => {
  const range = { from: addDays(today, -30), to: today };

  it('counts won, lost, lapsed, open and withdrawn, with win rates and reasons', () => {
    const won = quote(); // fully invoiced
    proformas.convertProforma(db, won.id);
    const part = quote(); // partly invoiced still counts as won
    proformas.convertProforma(db, part.id, [{ variantId: red, qty: 1 }]);
    const lostA = quote();
    proformas.setQuoteStage(db, lostA.id, 'lost', 'Too expensive');
    const lostB = quote();
    proformas.setQuoteStage(db, lostB.id, 'lost', 'too expensive');
    quote({ issueDate: addDays(today, -20), validUntil: addDays(today, -5) }); // lapsed
    quote(); // still open
    proformas.cancelProforma(db, quote().id, ''); // withdrawn, ignored in the rates

    const r = moreReports.quotesReport(db, range);
    expect(r).toMatchObject({ quoteCount: 6, withdrawn: 1 });
    expect(r.won).toMatchObject({ count: 2, quotedPaise: rupees(12600) });
    expect(r.lost.count).toBe(2);
    expect(r.expired.count).toBe(1);
    expect(r.open.count).toBe(1);
    // 2 won out of 2 + 2 + 1 decided
    expect(r.winRatePercent).toBeCloseTo(40, 5);
    expect(r.winRateByValuePercent).toBeCloseTo(40, 5);
    // The two spellings of the same reason are one line.
    expect(r.lostReasons).toHaveLength(1);
    expect(r.lostReasons[0]).toMatchObject({ count: 2, quotedPaise: rupees(12600) });
    expect(r.lostReasons[0].reason.toLowerCase()).toBe('too expensive');
    expect(r.averageDaysToWin).toBe(0);
    expect(r.won.invoicedPaise).toBe(rupees(6300) + rupees(1050)); // all of one, one piece (with GST) of the other
  });

  it('is empty and has no rates when nothing was quoted, and rejects a backwards range', () => {
    const r = moreReports.quotesReport(db, range);
    expect(r).toMatchObject({ quoteCount: 0, winRatePercent: null, winRateByValuePercent: null, averageDaysToWin: null, lostReasons: [], byMonth: [] });
    expect(() => moreReports.quotesReport(db, { from: today, to: addDays(today, -1) })).toThrow();
  });
});

describe('the quotes board', () => {
  it('puts each quote in the column for how far it has got, and leaves out withdrawn ones', () => {
    const waiting = quote();
    const accepted = quote();
    proformas.setQuoteStage(db, accepted.id, 'accepted');
    const part = quote();
    proformas.convertProforma(db, part.id, [{ variantId: red, qty: 1 }]);
    const done = quote();
    proformas.convertProforma(db, done.id);
    const lost = quote();
    proformas.setQuoteStage(db, lost.id, 'lost', 'x');
    const lapsed = quote({ issueDate: addDays(today, -20), validUntil: addDays(today, -5) });
    const lapsedButAccepted = quote({ issueDate: addDays(today, -20), validUntil: addDays(today, -5) });
    proformas.setQuoteStage(db, lapsedButAccepted.id, 'accepted');
    proformas.cancelProforma(db, quote().id, '');

    const board = buildPipeline(proformas.listProformas(db));
    expect(board.map((g) => g.column)).toEqual(['waiting', 'accepted', 'partial', 'invoiced', 'closed']);
    const ids = (c: string) => board.find((g) => g.column === c)!.quotes.map((q) => q.id).sort();
    expect(ids('waiting')).toEqual([waiting.id]);
    expect(ids('accepted')).toEqual([accepted.id, lapsedButAccepted.id].sort());
    expect(ids('partial')).toEqual([part.id]);
    expect(ids('invoiced')).toEqual([done.id]);
    expect(ids('closed')).toEqual([lost.id, lapsed.id].sort());
    expect(board.find((g) => g.column === 'waiting')!.totalPaise).toBe(waiting.totalPaise);
    expect(board.flatMap((g) => g.quotes)).toHaveLength(7); // the cancelled one is not on the board
  });
});
