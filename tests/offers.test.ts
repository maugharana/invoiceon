import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../electron/db/connection';
import * as creditNotes from '../electron/services/creditNotes';
import * as customers from '../electron/services/customers';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as offers from '../electron/services/offers';
import { saveSettings } from '../electron/services/settings';
import { computeTotalsMulti, todayIso } from '../shared/gst';
import { describeOffer, isOfferLive, loyaltyEarned, loyaltyValue, offerDiscount, type OfferInput } from '../shared/offers';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { state: 'Uttar Pradesh', gstin: '09AAACH7409R1ZZ', gstRatePercent: 5 });
});

const rupees = (n: number) => n * 100;
const today = todayIso();
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function design(code: string, price: number, stock = 50) {
  const d = inventory.createDesign(db, { code, name: `Design ${code}`, fabric: '', hsnCode: '5007', description: '', defaultPricePaise: rupees(price) });
  const v = inventory.createVariant(db, d.id, { color: 'Red', size: '5.5 m', sellPricePaise: rupees(price), baseCostPaise: rupees(price / 4), reorderLevel: 0, openingStock: stock, bom: [] });
  return { d, v };
}
const customer = (name = 'Sunita') => customers.createCustomer(db, { name, type: 'B2C', phone: '', email: '', gstin: '', address: '', city: 'Mau', state: 'Uttar Pradesh', pincode: '', notes: '' });
const offerInput = (over: Partial<OfferInput> = {}): OfferInput => ({ name: 'Diwali 10%', kind: 'percent', value: 10, minBillPaise: 0, designId: null, startDate: plusDays(-1), endDate: plusDays(30), active: true, ...over });
const sale = (variantId: string, qty: number, price: number, over: Record<string, unknown> = {}) =>
  invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId, qty, unitPricePaise: rupees(price) }], ...over });
const stockOf = (variantId: string) => inventory.getVariant(db, variantId).stock;
const loyaltyOn = (over = {}) => offers.saveLoyaltyConfig(db, { enabled: true, pointsPer100: 1, paisePerPoint: 100, minRedeem: 10, ...over });

describe('the offer maths', () => {
  const lines = [{ designId: 'a', amountPaise: rupees(3000) }, { designId: 'b', amountPaise: rupees(2000) }];

  it('takes a percentage of the bill, or a flat amount, never more than the bill', () => {
    expect(offerDiscount({ kind: 'percent', value: 10, minBillPaise: 0, designId: null }, lines)).toBe(rupees(500));
    expect(offerDiscount({ kind: 'flat', value: rupees(300), minBillPaise: 0, designId: null }, lines)).toBe(rupees(300));
    expect(offerDiscount({ kind: 'flat', value: rupees(9000), minBillPaise: 0, designId: null }, lines)).toBe(rupees(5000));
    expect(offerDiscount({ kind: 'percent', value: 100, minBillPaise: 0, designId: null }, lines)).toBe(rupees(5000));
  });

  it('rounds a percentage to the paisa', () => {
    expect(offerDiscount({ kind: 'percent', value: 7.5, minBillPaise: 0, designId: null }, [{ designId: null, amountPaise: 12_345 }])).toBe(926); // 925.875
  });

  it('needs the minimum bill, counted on the whole bill', () => {
    const o = { kind: 'percent' as const, value: 10, minBillPaise: rupees(5000), designId: null };
    expect(offerDiscount(o, lines)).toBe(rupees(500));
    expect(offerDiscount({ ...o, minBillPaise: rupees(5001) }, lines)).toBe(0);
  });

  it('applies to one design only when asked', () => {
    const o = { kind: 'percent' as const, value: 10, minBillPaise: 0, designId: 'b' };
    expect(offerDiscount(o, lines)).toBe(rupees(200));
    expect(offerDiscount({ ...o, designId: 'zzz' }, lines)).toBe(0);
    expect(offerDiscount({ kind: 'flat', value: rupees(500), minBillPaise: 0, designId: 'b' }, lines)).toBe(rupees(500));
    expect(offerDiscount({ kind: 'flat', value: rupees(5000), minBillPaise: 0, designId: 'b' }, lines)).toBe(rupees(2000)); // only that design's value
  });

  it('is live between its dates, inclusive, and only while switched on', () => {
    const o = { active: true, startDate: '2026-10-01', endDate: '2026-10-31' };
    expect([isOfferLive(o, '2026-09-30'), isOfferLive(o, '2026-10-01'), isOfferLive(o, '2026-10-31'), isOfferLive(o, '2026-11-01')]).toEqual([false, true, true, false]);
    expect(isOfferLive({ ...o, endDate: null }, '2030-01-01')).toBe(true);
    expect(isOfferLive({ ...o, active: false }, '2026-10-15')).toBe(false);
  });

  it('describes itself in plain words', () => {
    const money = (p: number) => `Rs ${p / 100}`;
    expect(describeOffer({ kind: 'percent', value: 10, minBillPaise: 0 }, money)).toBe('10% off');
    expect(describeOffer({ kind: 'flat', value: rupees(500), minBillPaise: rupees(5000) }, money)).toBe('Rs 500 off on bills of Rs 5000 or more');
  });

  it('earns whole points only, and values them', () => {
    expect(loyaltyEarned(rupees(1999), 1)).toBe(19);
    expect(loyaltyEarned(rupees(99), 1)).toBe(0);
    expect(loyaltyEarned(rupees(1000), 2)).toBe(20);
    expect(loyaltyValue(50, 100)).toBe(5000);
  });
});

describe('managing offers', () => {
  it('saves, lists and archives, and checks what it is given', () => {
    const { d } = design('MG-1', 1000);
    const o = offers.saveOffer(db, null, offerInput({ designId: d.id }));
    expect(o).toMatchObject({ name: 'Diwali 10%', kind: 'percent', value: 10, designId: d.id, active: true });
    expect(offers.saveOffer(db, o.id, offerInput({ name: 'Renamed', value: 15 }))).toMatchObject({ name: 'Renamed', value: 15, designId: null });
    expect(offers.listOffers(db)).toHaveLength(1);
    offers.archiveOffer(db, o.id);
    expect(offers.listOffers(db)).toEqual([]);
    expect(() => offers.getOffer(db, o.id)).toThrow(/no longer exists/);

    expect(() => offers.saveOffer(db, null, offerInput({ name: ' ' }))).toThrow(/Offer name/);
    expect(() => offers.saveOffer(db, null, offerInput({ value: 0 }))).toThrow(/how much/);
    expect(() => offers.saveOffer(db, null, offerInput({ value: 101 }))).toThrow(/more than 100/);
    expect(() => offers.saveOffer(db, null, offerInput({ kind: 'flat', value: 50.5 }))).toThrow(/whole number of paise/);
    expect(() => offers.saveOffer(db, null, offerInput({ startDate: 'x' }))).toThrow(/first day/);
    expect(() => offers.saveOffer(db, null, offerInput({ endDate: plusDays(-5) }))).toThrow(/before it starts/);
    expect(() => offers.saveOffer(db, null, offerInput({ designId: 'nope' }))).toThrow(/design no longer exists/);
    expect(() => offers.saveOffer(db, null, offerInput({ kind: 'weird' as never }))).toThrow(/percentage or a flat/);
  });
});

describe('an invoice with an offer', () => {
  it('adds the offer to the typed discount, with the same totals as if it had all been typed in', () => {
    const { v } = design('MG-1', 1000);
    const o = offers.saveOffer(db, null, offerInput());
    const inv = sale(v.id, 3, 1000, { offerId: o.id, discountPaise: rupees(100) });
    expect(inv).toMatchObject({ offerName: 'Diwali 10%', offerDiscountPaise: rupees(300), discountPaise: rupees(400), pointsRedeemed: 0 });
    const expected = computeTotalsMulti({ lines: [{ amountPaise: rupees(3000), ratePercent: 5 }], discountPaise: rupees(400), intraState: true });
    expect(inv).toMatchObject({ taxablePaise: expected.taxablePaise, totalPaise: expected.totalPaise, roundOffPaise: expected.roundOffPaise });
    expect(stockOf(v.id)).toBe(47);
  });

  it('keeps the offer name on the invoice even after the offer is archived or renamed', () => {
    const { v } = design('MG-1', 1000);
    const o = offers.saveOffer(db, null, offerInput());
    const inv = sale(v.id, 1, 1000, { offerId: o.id });
    offers.saveOffer(db, o.id, offerInput({ name: 'Something else' }));
    offers.archiveOffer(db, o.id);
    expect(invoices.getInvoice(db, inv.id).offerName).toBe('Diwali 10%');
  });

  it('refuses an offer that is not running, or does not fit the bill, and creates nothing', () => {
    const { v } = design('MG-1', 1000);
    const other = design('MG-2', 500);
    const past = offers.saveOffer(db, null, offerInput({ name: 'Old', startDate: plusDays(-30), endDate: plusDays(-10) }));
    const big = offers.saveOffer(db, null, offerInput({ name: 'Big bills', minBillPaise: rupees(10_000) }));
    const forOther = offers.saveOffer(db, null, offerInput({ name: 'Other only', designId: other.d.id }));
    const off = offers.saveOffer(db, null, offerInput({ name: 'Off', active: false }));
    expect(() => sale(v.id, 1, 1000, { offerId: past.id })).toThrow(/not running/);
    expect(() => sale(v.id, 1, 1000, { offerId: off.id })).toThrow(/not running/);
    expect(() => sale(v.id, 1, 1000, { offerId: big.id })).toThrow(/needs ₹10,000\.00 or more/);
    expect(() => sale(v.id, 1, 1000, { offerId: forOther.id })).toThrow(/that design is not on it/);
    expect(() => sale(v.id, 1, 1000, { offerId: 'nope' })).toThrow(/no longer exists/);
    expect(invoices.listInvoices(db)).toEqual([]);
    expect(stockOf(v.id)).toBe(50);
  });

  it('still refuses a discount bigger than the bill', () => {
    const { v } = design('MG-1', 1000);
    const o = offers.saveOffer(db, null, offerInput({ value: 100 }));
    expect(() => sale(v.id, 1, 1000, { offerId: o.id, discountPaise: rupees(1) })).toThrow(/can't be more than the invoice subtotal/);
  });

  it('leaves an invoice without an offer exactly as it was', () => {
    const { v } = design('MG-1', 1000);
    const inv = sale(v.id, 1, 1000, { discountPaise: rupees(50) });
    expect(inv).toMatchObject({ offerName: '', offerDiscountPaise: 0, pointsRedeemed: 0, pointsRedeemedPaise: 0, pointsEarned: 0, discountPaise: rupees(50) });
  });
});

describe('loyalty points', () => {
  it('starts switched off with sensible numbers, and checks what it is given', () => {
    expect(offers.loyaltyConfig(db)).toEqual({ enabled: false, pointsPer100: 1, paisePerPoint: 100, minRedeem: 50 });
    expect(() => offers.saveLoyaltyConfig(db, { enabled: true, pointsPer100: 0, paisePerPoint: 100, minRedeem: 0 })).toThrow(/Points for every/);
    expect(() => offers.saveLoyaltyConfig(db, { enabled: true, pointsPer100: 1, paisePerPoint: 0, minRedeem: 0 })).toThrow(/worth/);
    expect(loyaltyOn({ pointsPer100: 2 })).toMatchObject({ enabled: true, pointsPer100: 2 });
  });

  it('earns nothing while switched off, and nothing for a walk-in', () => {
    const { v } = design('MG-1', 1000);
    const c = customer();
    expect(sale(v.id, 5, 1000, { customerId: c.id }).pointsEarned).toBe(0);
    loyaltyOn();
    expect(sale(v.id, 5, 1000).pointsEarned).toBe(0);
    expect(offers.pointsOf(db, c.id)).toBe(0);
  });

  it('earns on the taxable value after discount, to the whole point', () => {
    const { v } = design('MG-1', 1000);
    const c = customer();
    loyaltyOn();
    const inv = sale(v.id, 3, 1000, { customerId: c.id, discountPaise: rupees(50) }); // taxable 2950
    expect(inv.pointsEarned).toBe(29);
    expect(offers.pointsOf(db, c.id)).toBe(29);
    const account = offers.loyaltyAccount(db, c.id);
    expect(account).toMatchObject({ points: 29, valuePaise: rupees(29) });
    expect(account.entries[0]).toMatchObject({ kind: 'earn', points: 29, invoiceNumber: inv.number });
  });

  it('spends points as part of the discount, and the balance follows', () => {
    const { v } = design('MG-1', 1000);
    const c = customer();
    loyaltyOn();
    sale(v.id, 5, 1000, { customerId: c.id }); // earns 50
    const inv = sale(v.id, 2, 1000, { customerId: c.id, redeemPoints: 30, discountPaise: rupees(20) });
    expect(inv).toMatchObject({ pointsRedeemed: 30, pointsRedeemedPaise: rupees(30), discountPaise: rupees(50) });
    const taxable = rupees(2000 - 50);
    expect(inv.taxablePaise).toBe(taxable);
    expect(inv.pointsEarned).toBe(19); // earns on what was actually paid for
    expect(offers.pointsOf(db, c.id)).toBe(50 - 30 + 19);
  });

  it('checks a redemption: enough points, the minimum, a saved customer, and switched on', () => {
    const { v } = design('MG-1', 1000);
    const c = customer();
    expect(() => sale(v.id, 1, 1000, { customerId: c.id, redeemPoints: 10 })).toThrow(/not switched on/);
    loyaltyOn({ minRedeem: 20 });
    sale(v.id, 5, 1000, { customerId: c.id }); // 50 points
    expect(() => sale(v.id, 1, 1000, { customerId: c.id, redeemPoints: 10 })).toThrow(/20 at a time or more/);
    expect(() => sale(v.id, 1, 1000, { customerId: c.id, redeemPoints: 60 })).toThrow(/has 50 points, not 60/);
    expect(() => sale(v.id, 1, 1000, { redeemPoints: 20 })).toThrow(/saved customer/);
    expect(() => sale(v.id, 1, 1000, { customerId: c.id, redeemPoints: 50, discountPaise: rupees(960) })).toThrow(/can't be more than the invoice subtotal/);
    expect(offers.pointsOf(db, c.id)).toBe(50); // the failed attempts changed nothing
    expect(invoices.listInvoices(db)).toHaveLength(1);
  });

  it('takes back what was earned and gives back what was spent when an invoice is cancelled', () => {
    const { v } = design('MG-1', 1000);
    const c = customer();
    loyaltyOn();
    sale(v.id, 5, 1000, { customerId: c.id }); // 50
    const inv = sale(v.id, 2, 1000, { customerId: c.id, redeemPoints: 30 }); // -30, +19
    expect(offers.pointsOf(db, c.id)).toBe(39);
    invoices.cancelInvoice(db, inv.id, 'mistake');
    expect(offers.pointsOf(db, c.id)).toBe(50);
    expect(offers.loyaltyAccount(db, c.id).entries.map((e) => e.kind)).toEqual(expect.arrayContaining(['reverse-earn', 'reverse-redeem']));
  });

  it('takes back a share of the points when goods are returned, and gives them back if the credit note is cancelled', () => {
    const { v } = design('MG-1', 1000);
    const c = customer();
    loyaltyOn();
    const inv = sale(v.id, 4, 1000, { customerId: c.id }); // 40 points
    const cn = creditNotes.createCreditNote(db, { invoiceId: inv.id, issueDate: today, kind: 'return', reason: 'x', notes: '', lines: [{ invoiceLineId: inv.lines[0]!.id, qty: 1, restock: true }] });
    expect(offers.pointsOf(db, c.id)).toBe(30); // one of four pieces
    creditNotes.cancelCreditNote(db, cn.id, 'wrong');
    expect(offers.pointsOf(db, c.id)).toBe(40);
  });

  it('never takes back more than was earned across several returns', () => {
    const { v } = design('MG-1', 1000);
    const c = customer();
    loyaltyOn();
    const inv = sale(v.id, 3, 1000, { customerId: c.id }); // 30 points
    for (let i = 0; i < 3; i++) creditNotes.createCreditNote(db, { invoiceId: inv.id, issueDate: today, kind: 'return', reason: 'x', notes: '', lines: [{ invoiceLineId: inv.lines[0]!.id, qty: 1, restock: true }] });
    expect(offers.pointsOf(db, c.id)).toBe(0);
  });

  it('lets someone correct a balance by hand, with a reason', () => {
    const c = customer();
    expect(offers.adjustPoints(db, c.id, 25, 'Birthday bonus')).toMatchObject({ points: 25 });
    expect(offers.adjustPoints(db, c.id, -10, 'Given twice').entries[0]).toMatchObject({ kind: 'adjust', points: -10, note: 'Given twice' });
    expect(() => offers.adjustPoints(db, c.id, 0, 'x')).toThrow(/how many points/);
    expect(() => offers.adjustPoints(db, c.id, 5, ' ')).toThrow(/Reason/);
    expect(() => offers.adjustPoints(db, 'nope', 5, 'x')).toThrow(/no longer exists|not found/i);
  });

  it('ties an offer and points together on one invoice', () => {
    const { v } = design('MG-1', 1000);
    const c = customer();
    loyaltyOn();
    sale(v.id, 5, 1000, { customerId: c.id }); // 50 points
    const o = offers.saveOffer(db, null, offerInput());
    const inv = sale(v.id, 4, 1000, { customerId: c.id, offerId: o.id, redeemPoints: 20, discountPaise: rupees(10) });
    expect(inv).toMatchObject({ offerDiscountPaise: rupees(400), pointsRedeemedPaise: rupees(20), discountPaise: rupees(400 + 20 + 10) });
  });
});
