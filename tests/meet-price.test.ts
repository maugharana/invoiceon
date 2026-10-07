import { describe, expect, it } from 'vitest';
import { computeInvoice, type PricedLine, type RoundOff } from '../shared/gst';
import { billCost, discountForTarget, lowestSafe, roundFigures, type MeetBill } from '../shared/meetPrice';

const rupees = (n: number) => n * 100;

const bill = (lines: PricedLine[], over: Partial<MeetBill> = {}): MeetBill => ({ lines, intraState: true, inclusive: false, roundOff: 'nearest', ...over });
const totalWith = (b: MeetBill, discountPaise: number) =>
  computeInvoice({ lines: b.lines, discountPaise: (b.otherDiscountPaise ?? 0) + discountPaise, intraState: b.intraState, inclusive: b.inclusive, roundOff: b.roundOff }).totalPaise;

describe('meeting the customer at a price', () => {
  it('finds the discount that brings the total to the agreed figure, GST included', () => {
    const b = bill([{ amountPaise: rupees(3000), ratePercent: 5 }]); // ₹3,150 with GST
    const r = discountForTarget(b, rupees(3000));
    expect(r).toMatchObject({ totalPaise: rupees(3000), fullTotalPaise: rupees(3150), reachable: true });
    expect(totalWith(b, r.discountPaise)).toBe(rupees(3000));
    // The smallest discount that does it: one paisa less and the total is back above the figure.
    expect(totalWith(b, r.discountPaise - 1)).toBeGreaterThan(rupees(3000));
  });

  it('works when the prices already include GST, and with several rates and discounts on the lines', () => {
    const b = bill(
      [
        { amountPaise: rupees(12000), discountPaise: rupees(500), ratePercent: 5 },
        { amountPaise: rupees(7500), ratePercent: 12 },
        { amountPaise: rupees(950), ratePercent: 0 },
      ],
      { inclusive: true, intraState: false },
    );
    for (const target of [rupees(19000), rupees(18500), rupees(15000), rupees(1000)]) {
      const r = discountForTarget(b, target);
      expect(r.reachable).toBe(true);
      expect(r.totalPaise).toBe(target);
    }
  });

  it('leaves loyalty-point discount in place and takes only what is still needed', () => {
    const b = bill([{ amountPaise: rupees(10000), ratePercent: 5 }], { otherDiscountPaise: rupees(200) });
    const r = discountForTarget(b, rupees(9000));
    expect(r.totalPaise).toBe(rupees(9000));
    expect(totalWith(b, r.discountPaise)).toBe(rupees(9000));
    // Together they are more than the points alone would be.
    expect(r.discountPaise).toBeGreaterThan(0);
  });

  it('with exact paise (no rounding) comes to the figure or as near under it as one paisa of rounding allows', () => {
    const b = bill([{ amountPaise: 1_234_567, ratePercent: 18 }], { roundOff: 'none' });
    for (const target of [1_000_000, 999_999, 1_234_000, 5_001]) {
      const r = discountForTarget(b, target);
      expect(r.totalPaise).toBeLessThanOrEqual(target);
      expect(target - r.totalPaise).toBeLessThanOrEqual(2);
    }
  });

  it('gives nothing when the figure is the bill itself, and says so when it is more than the bill', () => {
    const b = bill([{ amountPaise: rupees(1000), ratePercent: 5 }]);
    expect(discountForTarget(b, rupees(1050))).toMatchObject({ discountPaise: 0, reachable: true });
    expect(discountForTarget(b, rupees(2000))).toMatchObject({ discountPaise: 0, totalPaise: rupees(1050), reachable: false });
  });

  it('never overshoots, for any mix of lines, rates, rounding and figure', () => {
    let seed = 12345;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const rounds: RoundOff[] = ['nearest', 'up', 'down', 'none'];
    for (let i = 0; i < 300; i++) {
      const lines: PricedLine[] = Array.from({ length: 1 + rand(4) }, () => ({ amountPaise: 10_000 + rand(2_000_000), discountPaise: rand(3) === 0 ? rand(5000) : 0, ratePercent: [0, 5, 12, 18][rand(4)]! }));
      const b = bill(lines, { inclusive: rand(2) === 1, intraState: rand(2) === 1, roundOff: rounds[rand(4)]!, otherDiscountPaise: rand(3) === 0 ? rand(3000) : 0 });
      const full = totalWith(b, 0);
      const target = Math.max(1, Math.floor((full * (1 + rand(95))) / 100));
      const r = discountForTarget(b, target);
      expect(r.totalPaise).toBeLessThanOrEqual(target);
      expect(r.totalPaise).toBe(totalWith(b, r.discountPaise));
      expect(target - r.totalPaise).toBeLessThan(200);
    }
  });
});

describe('the lowest price without a loss', () => {
  it('is the largest discount that keeps the sales value (before GST) at or above cost', () => {
    const b = bill([{ amountPaise: rupees(2000), ratePercent: 5 }]); // two pieces at ₹1,000
    const safe = lowestSafe(b, rupees(1200)); // cost ₹600 each
    expect(safe).toEqual({ discountPaise: rupees(800), totalPaise: rupees(1260) });
    const below = computeInvoice({ lines: b.lines, discountPaise: rupees(801), intraState: true });
    expect(below.taxablePaise).toBeLessThan(rupees(1200));
  });

  it('is nothing at all when the bill is below cost before any discount on the whole', () => {
    expect(lowestSafe(bill([{ amountPaise: rupees(1000), ratePercent: 5 }]), rupees(1500))).toBeNull();
  });
});

describe('round figures and what a bill costs', () => {
  it('offers the next round figures just under the total, once each', () => {
    expect(roundFigures(rupees(27405))).toEqual([rupees(27400), rupees(27000), rupees(25000)]);
    expect(roundFigures(rupees(27000))).toEqual([rupees(26900), rupees(26500), rupees(26000), rupees(25000)]);
    expect(roundFigures(rupees(50))).toEqual([]);
  });

  it('adds up what the pieces cost, and says when a cost is not known', () => {
    expect(billCost([{ qty: 2, unitCostPaise: rupees(600) }, { qty: 1, unitCostPaise: rupees(300) }])).toEqual({ costPaise: rupees(1500), known: true });
    expect(billCost([{ qty: 2, unitCostPaise: rupees(600) }, { qty: 1, unitCostPaise: null }]).known).toBe(false);
    expect(billCost([]).known).toBe(false);
  });
});
