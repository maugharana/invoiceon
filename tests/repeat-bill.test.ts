import { describe, expect, it } from 'vitest';
import { planRepeat, repeatMessage, type RepeatSourceLine, type RepeatVariant } from '../shared/repeatBill';

const rupees = (n: number) => n * 100;
const line = (variantId: string, qty: number, over: Partial<RepeatSourceLine> = {}): RepeatSourceLine => ({ variantId, designName: `Design ${variantId}`, color: 'Red', size: '6 m', qty, unitPricePaise: rupees(1000), discountPaise: 0, note: '', ...over });
const stock = (entries: Record<string, Partial<RepeatVariant>>): Map<string, RepeatVariant> => new Map(Object.entries(entries).map(([id, v]) => [id, { stock: 10, held: 0, sellPricePaise: rupees(1200), ...v }]));

describe('billing the same again', () => {
  it('brings the same quantities, prices, item discounts and notes', () => {
    const plan = planRepeat([line('a', 2, { discountPaise: rupees(100), note: 'Matching blouse' }), line('b', 1, { unitPricePaise: rupees(850) })], stock({ a: {}, b: {} }), { todayPrices: false });
    expect(plan.items).toEqual([
      { variantId: 'a', qty: 2, price: rupees(1000), discount: rupees(100), note: 'Matching blouse' },
      { variantId: 'b', qty: 1, price: rupees(850), discount: 0, note: '' },
    ]);
    expect(plan.skipped).toEqual([]);
    expect(plan.reduced).toEqual([]);
  });

  it("can use today's selling prices instead, which leaves the old item discount behind", () => {
    const plan = planRepeat([line('a', 2, { discountPaise: rupees(100) })], stock({ a: { sellPricePaise: rupees(1300) } }), { todayPrices: true });
    expect(plan.items[0]).toMatchObject({ price: rupees(1300), discount: 0 });
  });

  it('cuts a quantity to what is in stock (less what quotes hold), with the discount cut in step', () => {
    const plan = planRepeat([line('a', 4, { discountPaise: rupees(400) })], stock({ a: { stock: 5, held: 2 } }), { todayPrices: false });
    expect(plan.items[0]).toMatchObject({ qty: 3, discount: rupees(300) });
    expect(plan.reduced).toEqual([{ label: 'Design a (Red, 6 m)', asked: 4, got: 3 }]);
  });

  it('leaves out what is sold out or no longer sold, and says which', () => {
    const plan = planRepeat([line('a', 1), line('b', 1), line('c', 1)], stock({ a: {}, b: { stock: 0 } }), { todayPrices: false });
    expect(plan.items.map((i) => i.variantId)).toEqual(['a']);
    expect(plan.skipped).toEqual([
      { label: 'Design b (Red, 6 m)', reason: 'out' },
      { label: 'Design c (Red, 6 m)', reason: 'gone' },
    ]);
    expect(repeatMessage(plan)).toBe('Added 1 item. Design b (Red, 6 m) is out of stock. Design c (Red, 6 m) is no longer sold.');
  });

  it('keeps the whole quantity for a quote, which can promise pieces that are not on the shelf yet', () => {
    const plan = planRepeat([line('a', 4)], stock({ a: { stock: 0 } }), { todayPrices: false, allowOutOfStock: true });
    expect(plan.items[0]).toMatchObject({ qty: 4 });
    expect(plan.skipped).toEqual([]);
  });

  it('adds only the items that were ticked', () => {
    const plan = planRepeat([line('a', 1), line('b', 1), line('c', 1)], stock({ a: {}, b: {}, c: {} }), { todayPrices: false, include: (id) => id !== 'b' });
    expect(plan.items.map((i) => i.variantId)).toEqual(['a', 'c']);
    expect(plan.skipped).toEqual([]);
  });

  it('describes a cut quantity and an empty result plainly', () => {
    expect(repeatMessage(planRepeat([line('a', 4)], stock({ a: { stock: 2 } }), { todayPrices: false }))).toBe('Added 1 item. Design a (Red, 6 m): only 2 of 4.');
    expect(repeatMessage(planRepeat([line('z', 1)], stock({}), { todayPrices: false }))).toBe('Nothing could be added. Design z (Red, 6 m) is no longer sold.');
  });
});
