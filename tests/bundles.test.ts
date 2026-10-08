import { describe, expect, it } from 'vitest';
import { bundleGross, bundleNet, bundleSource, priceBundle, type BundleLine } from '../shared/bundle';
import { planRepeat } from '../shared/repeatBill';

const rupees = (n: number) => n * 100;
const saree: BundleLine = { variantId: 'saree', qty: 1, unitPricePaise: rupees(3400) };
const blouse: BundleLine = { variantId: 'blouse', qty: 1, unitPricePaise: rupees(600) };
const fall: BundleLine = { variantId: 'fall', qty: 1, unitPricePaise: rupees(200) };

describe('giving a bundle a price of its own', () => {
  it('takes the saving off the items in proportion to their value, adding up exactly to the bundle price', () => {
    const priced = priceBundle([saree, blouse, fall], rupees(3999))!; // ₹4,200 at list price
    expect(priced.reduce((sum, l) => sum + (l.discountPaise ?? 0), 0)).toBe(rupees(201));
    // The bigger the item, the bigger its share of the saving.
    expect(priced[0]!.discountPaise).toBeGreaterThan(priced[1]!.discountPaise!);
    expect(priced[1]!.discountPaise).toBeGreaterThan(priced[2]!.discountPaise!);
    expect(bundleGross(priced)).toBe(rupees(4200));
    expect(bundleNet(priced)).toBe(rupees(3999));
  });

  it('is exact for any quantities and prices, never taking more off an item than the item is worth', () => {
    let seed = 99;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let i = 0; i < 300; i++) {
      const lines: BundleLine[] = Array.from({ length: 1 + rand(5) }, (_, k) => ({ variantId: `v${k}`, qty: 1 + rand(4), unitPricePaise: 1 + rand(500_000) }));
      const total = bundleGross(lines);
      const target = rand(total + 1);
      const priced = priceBundle(lines, target)!;
      expect(bundleNet(priced)).toBe(target);
      priced.forEach((l, k) => {
        expect(l.discountPaise).toBeGreaterThanOrEqual(0);
        expect(l.discountPaise!).toBeLessThanOrEqual(lines[k]!.qty * lines[k]!.unitPricePaise);
      });
    }
  });

  it('replaces discounts the items already had, and refuses a price above the list price or below nothing', () => {
    const priced = priceBundle([{ ...saree, discountPaise: rupees(500) }, blouse], rupees(3800))!;
    expect(bundleNet(priced)).toBe(rupees(3800));
    expect(priceBundle([saree, blouse], rupees(4001))).toBeNull();
    expect(priceBundle([saree, blouse], -1)).toBeNull();
    expect(priceBundle([saree, blouse], rupees(4000))!.every((l) => l.discountPaise === 0)).toBe(true);
    expect(priceBundle([saree, blouse], 0)).not.toBeNull();
  });
});

describe('putting a bundle on a bill', () => {
  const names = new Map([
    ['saree', { designName: 'Banarasi Kadhua', color: 'Wine', size: '6.3 m' }],
    ['blouse', { designName: 'Blouse piece', color: 'Wine', size: '1 m' }],
  ]);
  const variants = new Map([
    ['saree', { stock: 5, held: 0, sellPricePaise: rupees(3500) }],
    ['blouse', { stock: 0, held: 0, sellPricePaise: rupees(700) }],
  ]);

  it("adds the items at the bundle's own prices and discounts, and says what could not be added", () => {
    const priced = priceBundle([saree, blouse], rupees(3700))!;
    const plan = planRepeat(bundleSource(priced, names), variants, { todayPrices: false });
    expect(plan.items).toEqual([{ variantId: 'saree', qty: 1, price: rupees(3400), discount: priced[0]!.discountPaise, note: '' }]);
    expect(plan.skipped).toEqual([{ label: 'Blouse piece (Wine, 1 m)', reason: 'out' }]);
  });
});
