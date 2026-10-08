import { describe, expect, it } from 'vitest';
import { parseInvoiceDraft } from '../shared/invoiceDraft';
import { onboardingDone, onboardingSteps } from '../shared/onboarding';
import { MAX_RECENT, cleanRecent, pushRecent, type RecentItem } from '../shared/recent';
import { GO_SHORTCUTS, goTarget, isTypingContext } from '../shared/shortcuts';

const item = (id: string, kind: RecentItem['kind'] = 'invoice'): RecentItem => ({ kind, id, title: `Title ${id}` });

describe('recently viewed', () => {
  it('puts the newest first and moves a reopened item up instead of listing it twice', () => {
    let list: RecentItem[] = [];
    for (const id of ['a', 'b', 'c']) list = pushRecent(list, item(id));
    expect(list.map((r) => r.id)).toEqual(['c', 'b', 'a']);
    list = pushRecent(list, item('a'));
    expect(list.map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });

  it('tells apart items of different kinds that share an id, and keeps only the latest few', () => {
    let list = pushRecent([], item('1', 'invoice'));
    list = pushRecent(list, item('1', 'customer'));
    expect(list.map((r) => r.kind)).toEqual(['customer', 'invoice']);
    for (let i = 0; i < 20; i++) list = pushRecent(list, item(`n${i}`));
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]!.id).toBe('n19');
  });

  it('repairs a saved list: bad entries, repeats and non-lists are dropped', () => {
    expect(cleanRecent(null)).toEqual([]);
    expect(cleanRecent('nope')).toEqual([]);
    expect(
      cleanRecent([
        { kind: 'invoice', id: 'a', title: 'A', hint: 'Sunita' },
        { kind: 'invoice', id: 'a', title: 'A again' },
        { kind: 'spaceship', id: 'b', title: 'B' },
        { kind: 'design', id: '', title: 'No id' },
        { kind: 'design', id: 'd', title: '' },
        null,
        7,
        { kind: 'customer', id: 'c', title: 'C', hint: '' },
      ]),
    ).toEqual([
      { kind: 'invoice', id: 'a', title: 'A', hint: 'Sunita' },
      { kind: 'customer', id: 'c', title: 'C' },
    ]);
  });
});

describe('keyboard shortcuts', () => {
  it('has one distinct letter for every page', () => {
    const keys = GO_SHORTCUTS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(GO_SHORTCUTS.every((s) => s.path.startsWith('/'))).toBe(true);
  });

  it('turns a letter after G into a page, in either case, and ignores other letters', () => {
    expect(goTarget('i')?.path).toBe('/invoices');
    expect(goTarget('I')?.path).toBe('/invoices');
    expect(goTarget('d')?.label).toBe('Dashboard');
    expect(goTarget('z')).toBeNull();
    expect(goTarget('')).toBeNull();
  });

  it('stays out of the way while typing or holding a modifier', () => {
    const none = { ctrlKey: false, metaKey: false, altKey: false };
    expect(isTypingContext({ tagName: 'INPUT' }, none)).toBe(true);
    expect(isTypingContext({ tagName: 'textarea' }, none)).toBe(true);
    expect(isTypingContext({ tagName: 'SELECT' }, none)).toBe(true);
    expect(isTypingContext({ tagName: 'DIV', isContentEditable: true }, none)).toBe(true);
    expect(isTypingContext({ tagName: 'BODY' }, none)).toBe(false);
    expect(isTypingContext(null, none)).toBe(false);
    expect(isTypingContext({ tagName: 'BODY' }, { ...none, ctrlKey: true })).toBe(true);
    expect(isTypingContext({ tagName: 'BODY' }, { ...none, altKey: true })).toBe(true);
  });
});

describe('getting-started checklist', () => {
  const empty = { businessName: '', addressLine: '', gstin: '', invoiceBank: '', upiId: '' };
  const none = { designs: 0, customers: 0, invoices: 0 };

  it('starts with nothing done on an empty shop', () => {
    const steps = onboardingSteps(empty, none);
    expect(steps.map((s) => s.id)).toEqual(['profile', 'gstin', 'payments', 'saree', 'customer', 'invoice']);
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(onboardingDone(steps)).toBe(false);
  });

  it('ticks each step from what is really there', () => {
    const steps = onboardingSteps({ businessName: 'Mau Gharana', addressLine: 'Chowk', gstin: '09AABCK1234M1ZI', invoiceBank: '', upiId: 'a@sbi' }, { designs: 3, customers: 0, invoices: 1 });
    expect(Object.fromEntries(steps.map((s) => [s.id, s.done]))).toEqual({ profile: true, gstin: true, payments: true, saree: true, customer: false, invoice: true });
    expect(onboardingDone(steps)).toBe(false);
  });

  it('needs both a name and an address for the profile step, and counts bank details or UPI for payments', () => {
    const step = (s: Partial<typeof empty>, id: string) => onboardingSteps({ ...empty, ...s }, none).find((x) => x.id === id)!.done;
    expect(step({ businessName: 'X' }, 'profile')).toBe(false);
    expect(step({ businessName: 'X', addressLine: '  ' }, 'profile')).toBe(false);
    expect(step({ businessName: 'X', addressLine: 'Y' }, 'profile')).toBe(true);
    expect(step({ invoiceBank: 'SBI' }, 'payments')).toBe(true);
    expect(step({ upiId: 'a@sbi' }, 'payments')).toBe(true);
  });

  it('is finished only when every step is', () => {
    const full = onboardingSteps({ businessName: 'M', addressLine: 'A', gstin: 'G', invoiceBank: 'B', upiId: '' }, { designs: 1, customers: 1, invoices: 1 });
    expect(onboardingDone(full)).toBe(true);
  });
});

describe('unfinished invoice recovery', () => {
  const good = { savedAt: '2026-10-02T10:00:00Z', type: 'B2B', customerId: 'c1', buyerName: '', issueDate: '2026-10-02', dueDate: '2026-10-17', discountPaise: 5000, notes: 'Gift wrap', lines: [{ variantId: 'v1', qty: '2', price: 100000 }], receivedPaise: 20000, payMethod: 'upi' };

  it('reads back a good draft as it was saved', () => {
    // Items saved before they could carry a discount, rate or note come back without any.
    expect(parseInvoiceDraft(good)).toEqual({ ...good, lines: [{ variantId: 'v1', qty: '2', price: 100000, discount: 0, rate: '', note: '' }] });
    const withExtras = { ...good, lines: [{ variantId: 'v1', qty: '2', price: 100000, discount: 5000, rate: '12', note: 'Pre-washed' }] };
    expect(parseInvoiceDraft(withExtras)).toEqual(withExtras);
  });

  it('keeps a percent discount on an item and the other parts of a split payment, and drops invalid ones', () => {
    const saved = { ...good, lines: [{ variantId: 'v1', qty: '3', price: 100000, discount: 150000, discountPct: 50, rate: '', note: '' }], extras: [{ method: 'cash', amountPaise: 30000, reference: '', accountId: 'cash' }] };
    expect(parseInvoiceDraft(saved)).toEqual({ ...saved, lines: [{ ...saved.lines[0], discount: 150000 }] });
    const bad = parseInvoiceDraft({ ...saved, lines: [{ ...saved.lines[0], discountPct: 250 }], extras: [{ method: 'barter', amountPaise: 100 }, { method: 'upi', amountPaise: 0 }, 'x'] })!;
    expect(bad.lines[0]!.discountPct).toBeUndefined();
    expect(bad.extras).toBeUndefined();
  });

  it('drops an item discount, rate or note that is not valid', () => {
    const d = parseInvoiceDraft({ ...good, lines: [{ variantId: 'v1', qty: '1', price: 1, discount: -5, rate: '12abc', note: 7 }, { variantId: 'v2', qty: '1', price: 1, rate: '5.255' }] });
    expect(d!.lines).toEqual([{ variantId: 'v1', qty: '1', price: 1, discount: 0, rate: '', note: '' }, { variantId: 'v2', qty: '1', price: 1, discount: 0, rate: '', note: '' }]);
  });

  it('has nothing to restore without items or a customer', () => {
    expect(parseInvoiceDraft({ ...good, lines: [], customerId: null })).toBeNull();
    expect(parseInvoiceDraft({ ...good, lines: [] })?.customerId).toBe('c1'); // a customer alone is worth keeping
    expect(parseInvoiceDraft(null)).toBeNull();
    expect(parseInvoiceDraft('nope')).toBeNull();
    expect(parseInvoiceDraft(7)).toBeNull();
  });

  it('repairs damaged fields instead of trusting them', () => {
    const d = parseInvoiceDraft({ type: 'weird', customerId: 5, buyerName: 9, issueDate: 'yesterday', dueDate: '10/10/2026', discountPaise: -4, notes: null, receivedPaise: 1.5, payMethod: 'barter', lines: [{ variantId: 'v', qty: 3, price: 'x' }, { variantId: '', qty: '1', price: 1 }, null, 'junk', { variantId: 'w', qty: '4', price: 250 }] });
    expect(d).toMatchObject({ type: 'B2C', customerId: null, buyerName: '', issueDate: '', dueDate: '', discountPaise: 0, notes: '', receivedPaise: 0, payMethod: 'cash' });
    expect(d!.lines).toEqual([{ variantId: 'v', qty: '1', price: 0, discount: 0, rate: '', note: '' }, { variantId: 'w', qty: '4', price: 250, discount: 0, rate: '', note: '' }]);
  });

  it('caps an absurd number of lines', () => {
    const lines = Array.from({ length: 500 }, (_, i) => ({ variantId: `v${i}`, qty: '1', price: 1 }));
    expect(parseInvoiceDraft({ ...good, lines })!.lines).toHaveLength(200);
  });
});
