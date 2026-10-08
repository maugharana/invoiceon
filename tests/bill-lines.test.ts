import { describe, expect, it } from 'vitest';
import { fixedDiscountTooBig, lineDiscountPaise, percentOf } from '../shared/billLines';

const rupees = (n: number) => n * 100;

describe('the discount on one line of a bill', () => {
  it('is a share of the line as it stands, so it follows the quantity', () => {
    const line = { discountPaise: rupees(1500), discountPct: 50 }; // picked when the line was 3 × ₹1,000
    expect(lineDiscountPaise(rupees(3000), line)).toBe(rupees(1500));
    expect(lineDiscountPaise(rupees(1000), line)).toBe(rupees(500)); // the quantity fell to 1
    expect(lineDiscountPaise(0, line)).toBe(0);
  });

  it('is a fixed amount otherwise, never more than the line and never below nothing', () => {
    expect(lineDiscountPaise(rupees(1000), { discountPaise: rupees(300), discountPct: null })).toBe(rupees(300));
    expect(lineDiscountPaise(rupees(1000), { discountPaise: rupees(1500), discountPct: null })).toBe(rupees(1000));
    expect(lineDiscountPaise(rupees(1000), { discountPaise: -5, discountPct: null })).toBe(0);
  });

  it('rounds a share to the nearest paisa', () => {
    expect(percentOf(33_333, 10)).toBe(3333);
    expect(percentOf(1, 50)).toBe(1);
    expect(percentOf(rupees(1000), 7.5)).toBe(rupees(75));
  });

  it('counts a typed amount above the line as too big, but never a share, however stale the amount kept beside it', () => {
    expect(fixedDiscountTooBig(rupees(1000), { discountPaise: rupees(1001), discountPct: null })).toBe(true);
    expect(fixedDiscountTooBig(rupees(1000), { discountPaise: rupees(1000), discountPct: null })).toBe(false);
    // 50% off 3 × ₹1,000 left ₹1,500 behind; after the quantity drops to 1 the amount is stale, the share is fine.
    expect(fixedDiscountTooBig(rupees(1000), { discountPaise: rupees(1500), discountPct: 50 })).toBe(false);
  });
});
