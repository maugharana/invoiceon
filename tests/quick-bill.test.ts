import { describe, expect, it } from 'vitest';
import { findVariants, parseAmount, parseQuickBill, resolveQuickBill } from '../shared/quickBill';
import type { Customer, SaleVariant, Salesperson } from '../shared/types';

const rupees = (n: number) => n * 100;

describe('amounts as people type them', () => {
  it('reads plain, comma, rupee-sign, k, thousand and lakh forms', () => {
    expect(parseAmount('5000')).toBe(rupees(5000));
    expect(parseAmount('₹5,000')).toBe(rupees(5000));
    expect(parseAmount('rs. 2500/-')).toBe(rupees(2500));
    expect(parseAmount('5k')).toBe(rupees(5000));
    expect(parseAmount('5.5k')).toBe(rupees(5500));
    expect(parseAmount('1.5 lakh')).toBe(rupees(150000));
    expect(parseAmount('2 thousand')).toBe(rupees(2000));
    expect(parseAmount('12.50')).toBe(1250);
    expect(parseAmount('no number')).toBeNull();
    expect(parseAmount('10%')).toBeNull();
  });
});

describe('reading a line', () => {
  it('splits the example line into item, discount, name and payment', () => {
    const p = parseQuickBill('2 kadhua ivory, 10% off, Meena, paid 5000 UPI');
    expect(p.items).toEqual([{ text: 'kadhua ivory', qty: 2, pricePaise: null }]);
    expect(p.discount).toEqual({ kind: 'percent', percent: 10 });
    expect(p.plain).toEqual(['Meena']);
    expect(p.payment).toEqual({ mode: 'paid', method: 'upi', amountPaise: rupees(5000) });
    expect(p.unknown).toEqual([]);
  });

  it('reads quantities before or after the name, as words, and several items in one piece', () => {
    expect(parseQuickBill('kadhua wine x3').items).toEqual([{ text: 'kadhua wine', qty: 3, pricePaise: null }]);
    expect(parseQuickBill('3 x chanderi lemon').items[0]).toMatchObject({ text: 'chanderi lemon', qty: 3 });
    expect(parseQuickBill('two kadhua ivory').items[0]).toMatchObject({ qty: 2 });
    expect(parseQuickBill('ek chanderi lemon').items[0]).toMatchObject({ qty: 1, text: 'chanderi lemon' });
    expect(parseQuickBill('1 kadhua ivory and 2 chanderi lemon + 3 butidar maroon').items.map((i) => [i.qty, i.text])).toEqual([[1, 'kadhua ivory'], [2, 'chanderi lemon'], [3, 'butidar maroon']]);
    expect(parseQuickBill('2 sarees kadhua').items[0]).toMatchObject({ qty: 2, text: 'kadhua' });
  });

  it('reads a price typed for an item', () => {
    expect(parseQuickBill('2 kadhua ivory at 14000').items[0]).toEqual({ text: 'kadhua ivory', qty: 2, pricePaise: rupees(14000) });
    expect(parseQuickBill('kadhua wine @ 13.5k').items[0]).toEqual({ text: 'kadhua wine', qty: 1, pricePaise: rupees(13500) });
    expect(parseQuickBill('3 chanderi for 3000 each').items[0]).toMatchObject({ qty: 3, pricePaise: rupees(3000) });
  });

  it('does not take a size like 6.3 m for a quantity, and leaves a bare name as something to look up', () => {
    const p = parseQuickBill('kadhua wine 6.3 m');
    expect(p.items).toEqual([]);
    expect(p.plain).toEqual(['kadhua wine 6.3 m']);
    expect(parseQuickBill('2 sarees').unknown).toEqual(['2 sarees']);
  });

  it('reads how it was paid: method words, amounts in all forms, in full, and later', () => {
    const pay = (s: string) => parseQuickBill(s).payment;
    expect(pay('paid 5k cash')).toEqual({ mode: 'paid', method: 'cash', amountPaise: rupees(5000) });
    expect(pay('received 5,000 gpay')).toEqual({ mode: 'paid', method: 'upi', amountPaise: rupees(5000) });
    expect(pay('paid 1.5 lakh by neft')).toEqual({ mode: 'paid', method: 'bank', amountPaise: rupees(150000) });
    expect(pay('paid in full by card')).toEqual({ mode: 'paid', method: 'card', amountPaise: null });
    expect(pay('paid by credit card')).toEqual({ mode: 'paid', method: 'card', amountPaise: null });
    expect(pay('paid cheque')).toEqual({ mode: 'paid', method: 'cheque', amountPaise: null });
    expect(pay('paid')).toEqual({ mode: 'paid', method: null, amountPaise: null });
    for (const later of ['pay later', 'unpaid', 'on credit', 'udhaar', 'credit', 'will pay later']) expect(pay(later)).toEqual({ mode: 'later' });
  });

  it('keeps the item when the comma before the payment is forgotten, and reads the amount after the word', () => {
    const p = parseQuickBill('2 kadhua ivory paid 5000 upi');
    expect(p.items).toEqual([{ text: 'kadhua ivory', qty: 2, pricePaise: null }]);
    expect(p.payment).toEqual({ mode: 'paid', method: 'upi', amountPaise: rupees(5000) });
    const q = parseQuickBill('kadhua wine 10% off paid cash');
    expect(q.plain).toEqual(['kadhua wine']);
    expect(q.discount).toEqual({ kind: 'percent', percent: 10 });
    expect(q.payment).toMatchObject({ mode: 'paid', method: 'cash' });
    expect(parseQuickBill('5000 paid upi').payment).toEqual({ mode: 'paid', method: 'upi', amountPaise: rupees(5000) });
  });

  it('does not take "got" or "gave" for a payment', () => {
    const p = parseQuickBill('customer got 2 kadhua ivory');
    expect(p.payment).toBeNull();
    expect(parseQuickBill('gave 2 chanderi lemon').payment).toBeNull();
  });

  it('reads discounts as a share or an amount, and ignores a percentage that is not a discount', () => {
    const d = (s: string) => parseQuickBill(s).discount;
    expect(d('10% off')).toEqual({ kind: 'percent', percent: 10 });
    expect(d('discount 7.5%')).toEqual({ kind: 'percent', percent: 7.5 });
    expect(d('5 percent less')).toEqual({ kind: 'percent', percent: 5 });
    expect(d('15%')).toEqual({ kind: 'percent', percent: 15 });
    expect(d('500 off')).toEqual({ kind: 'amount', paise: rupees(500) });
    expect(d('discount ₹250')).toEqual({ kind: 'amount', paise: rupees(250) });
    expect(d('less 1k')).toEqual({ kind: 'amount', paise: rupees(1000) });
    expect(d('kadhua ivory')).toBeNull();
  });

  it('reads due days, who sold it, the customer, walk-in and a note', () => {
    expect(parseQuickBill('due in 15 days').dueDays).toBe(15);
    expect(parseQuickBill('net 30').dueDays).toBe(30);
    expect(parseQuickBill('sold by Ravi').soldBy).toBe('Ravi');
    expect(parseQuickBill('by Anil').soldBy).toBe('Anil');
    expect(parseQuickBill('for Meena Textiles').customer).toBe('Meena Textiles');
    expect(parseQuickBill('customer: Kanchan').customer).toBe('Kanchan');
    expect(parseQuickBill('walk-in').walkIn).toBe(true);
    expect(parseQuickBill('note: wrap as a gift, please')).toMatchObject({ note: 'wrap as a gift', unknown: [] }); // the comma ends the note; a bare "please" is ignored
    expect(parseQuickBill('Note: gift wrap please').note).toBe('gift wrap please');
  });

  it('never fails: nothing, junk and odd punctuation give back what could not be read', () => {
    expect(parseQuickBill('')).toMatchObject({ items: [], plain: [], unknown: [] });
    expect(parseQuickBill(' , ;; ')).toMatchObject({ items: [], plain: [] });
    expect(parseQuickBill('2 ,').unknown).toEqual([]);
    expect(() => parseQuickBill(undefined as unknown as string)).not.toThrow();
  });
});

// ── The shop's own names ────────────────────────────────────────────────────
let id = 0;
const variant = (design: string, color: string, size: string, stock = 5, over: Partial<SaleVariant> = {}): SaleVariant => {
  id += 1;
  return { variantId: `v${id}`, designId: `d-${design}`, designCode: `MG-${design.slice(0, 3).toUpperCase()}`, designName: design, designNickname: '', hsn: '', gstRatePercent: null, barcode: '', held: 0, color, size, sku: `${design.slice(0, 3).toUpperCase()}-${color.slice(0, 3).toUpperCase()}-${size}`, stock, sellPricePaise: rupees(1000), unitCostPaise: rupees(500), ...over };
};
const customer = (name: string, phone = '', city = ''): Customer => ({ id: `c-${name}`, name, phone, city } as unknown as Customer);
const person = (name: string): Salesperson => ({ id: `p-${name}`, name, commissionPercent: 2, archived: false, invoiceCount: 0 });

const kadhuaIvory = variant('Banarasi Kadhua', 'Ivory', '6.3');
const kadhuaWine = variant('Banarasi Kadhua', 'Wine', '6.3');
const chanderiLemon = variant('Cotton Chanderi', 'Lemon', '5.5');
const chanderiPeach = variant('Cotton Chanderi', 'Peach', '5.5', 0);
const meenakari = variant('Meenakari Silk', 'Red', '6');
const data = { variants: [kadhuaIvory, kadhuaWine, chanderiLemon, chanderiPeach, meenakari], customers: [customer('Meena Textiles', '9876500033', 'Mumbai'), customer('Kanchan Sarees & Fabrics', '9876500022', 'Varanasi'), customer('Sunita Verma', '9876500011', 'Mau')], team: [person('Ravi Kumar'), person('Anil Shah')] };

describe('finding the pieces', () => {
  it('finds one by its words in any order, and by its code', () => {
    expect(findVariants('ivory kadhua', data.variants).hits).toEqual([kadhuaIvory]);
    expect(findVariants(kadhuaWine.sku, data.variants).hits).toEqual([kadhuaWine]);
  });

  it('reads a slip of the pen as the word the shop uses, and says so', () => {
    const r = findVariants('kadwa ivory', data.variants);
    expect(r.hits).toEqual([kadhuaIvory]);
    expect(r.corrected).toEqual([{ from: 'kadwa', to: 'kadhua' }]);
    expect(findVariants('zzzzzz', data.variants)).toEqual({ hits: [], corrected: [] });
  });

  it('puts what is in stock first', () => {
    expect(findVariants('chanderi', data.variants).hits).toEqual([chanderiLemon, chanderiPeach]);
  });
});

describe('putting a line together with the shop\'s names', () => {
  const plan = (line: string) => resolveQuickBill(parseQuickBill(line), data);

  it('makes the whole example into a bill', () => {
    const p = plan('2 kadhua ivory, 10% off, Meena, paid 5000 UPI, sold by ravi, due in 15 days');
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ qty: 2, chosen: kadhuaIvory, assumed: false });
    expect(p.customer?.chosen?.name).toBe('Meena Textiles');
    expect(p.discount).toEqual({ kind: 'percent', percent: 10 });
    expect(p.payment).toEqual({ mode: 'paid', method: 'upi', amountPaise: rupees(5000) });
    expect(p.soldBy?.chosen?.name).toBe('Ravi Kumar');
    expect(p.dueDays).toBe(15);
    expect(p.unknown).toEqual([]);
  });

  it('leaves a choice to the person when the words fit several pieces, unless only one is in stock', () => {
    const many = plan('kadhua').items[0]!;
    expect(many.candidates).toHaveLength(2);
    expect(many.chosen).toBeNull();
    const one = plan('2 chanderi').items[0]!;
    expect(one.chosen).toBe(chanderiLemon); // the peach is out of stock
    expect(one.assumed).toBe(true);
  });

  it('takes a bare name as an item when it names one, and as the customer when it does not', () => {
    const p = plan('kadhua wine, Sunita');
    expect(p.items[0]!.chosen).toBe(kadhuaWine);
    expect(p.customer?.chosen?.name).toBe('Sunita Verma');
  });

  it('prefers the customer when the name is a whole word of theirs even though a design starts the same', () => {
    const p = plan('Meena, 2 kadhua wine');
    expect(p.customer?.chosen?.name).toBe('Meena Textiles');
    expect(p.items.map((i) => i.chosen)).toEqual([kadhuaWine]);
  });

  it('reads a slip in a customer\'s name, and offers the choice when two fit', () => {
    expect(plan('for Kanchn, 1 kadhua wine').customer?.chosen?.name).toBe('Kanchan Sarees & Fabrics');
    const two = resolveQuickBill(parseQuickBill('for Verma'), { ...data, customers: [...data.customers, customer('Anita Verma')] });
    expect(two.customer?.candidates).toHaveLength(2);
    expect(two.customer?.chosen).toBeNull();
  });

  it('treats a name that is nobody saved as a walk-in with that name, and keeps what it could not read', () => {
    const p = plan('for Shweta, 1 kadhua wine, qqqq zzzz');
    expect(p.customer?.chosen).toBeNull();
    expect(p.walkInName).toBe('Shweta');
    expect(p.unknown).toEqual(['qqqq zzzz']);
  });

  it('says when a salesperson is not on the team', () => {
    expect(plan('sold by Nobody').soldBy).toMatchObject({ text: 'Nobody', candidates: [], chosen: null });
  });
});
