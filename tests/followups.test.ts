import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../electron/db/connection';
import * as creditNotes from '../electron/services/creditNotes';
import * as customers from '../electron/services/customers';
import * as followups from '../electron/services/followups';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as payments from '../electron/services/payments';
import { saveSettings } from '../electron/services/settings';
import { addDays, todayIso } from '../shared/gst';
import { FOLLOW_UP_AFTER_DAYS, ago, daysBetween, needsFollowUp, promiseState } from '../shared/followup';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { state: 'Uttar Pradesh', gstin: '09AAACH7409R1ZZ', gstRatePercent: 5 });
});

const rupees = (n: number) => n * 100;
const today = todayIso();

function debtor(name = 'Sunita', owes = 10_000) {
  const d = inventory.createDesign(db, { code: `MG-${name}`, name: `Design ${name}`, fabric: '', hsnCode: '5007', description: '', defaultPricePaise: rupees(owes) });
  const v = inventory.createVariant(db, d.id, { color: 'Red', size: '5.5 m', sellPricePaise: rupees(owes), baseCostPaise: rupees(owes / 4), reorderLevel: 0, openingStock: 5, bom: [] });
  const c = customers.createCustomer(db, { name, type: 'B2C', phone: '', email: '', gstin: '', address: '', city: 'Mau', state: 'Uttar Pradesh', pincode: '', notes: '' });
  const inv = invoices.createInvoice(db, { type: 'B2C', customerId: c.id, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: v.id, qty: 1, unitPricePaise: rupees(owes) }] });
  return { c, inv };
}
const pay = (customerId: string, invoiceId: string | null, amountPaise: number) =>
  payments.recordPayment(db, { customerId, amountPaise, method: 'cash', reference: '', receivedOn: today, note: '', allocations: invoiceId ? [{ invoiceId, amountPaise }] : [] });

describe('the maths', () => {
  it('counts days between calendar dates', () => {
    expect(daysBetween('2026-03-01', '2026-03-08')).toBe(7);
    expect(daysBetween('2026-03-08', '2026-03-01')).toBe(-7);
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
    expect(ago('2026-03-01', '2026-03-01')).toBe('today');
    expect(ago('2026-02-28', '2026-03-01')).toBe('yesterday');
    expect(ago('2026-02-20', '2026-03-01')).toBe('9 days ago');
  });

  it('keeps a promise until the day is over, then breaks it if the money did not come', () => {
    const p = { promisedOn: '2026-03-10', amountPaise: 5000, cancelled: false, paidSincePaise: 0 };
    expect(promiseState(p, '2026-03-09')).toBe('open');
    expect(promiseState(p, '2026-03-10')).toBe('open'); // they have until the end of the day
    expect(promiseState(p, '2026-03-11')).toBe('broken');
    expect(promiseState({ ...p, paidSincePaise: 4999 }, '2026-03-11')).toBe('broken');
    expect(promiseState({ ...p, paidSincePaise: 5000 }, '2026-03-11')).toBe('kept');
    expect(promiseState({ ...p, paidSincePaise: 9000 }, '2026-03-09')).toBe('kept'); // paid early
    expect(promiseState({ ...p, cancelled: true, paidSincePaise: 9000 }, '2026-03-09')).toBe('cancelled');
  });

  it('says who is worth chasing today', () => {
    const base = { overduePaise: 100, lastContactDate: null as string | null, promise: null as { state: 'open' | 'broken' | 'kept' | 'cancelled' } | null };
    expect(needsFollowUp({ ...base, overduePaise: 0 }, '2026-03-10')).toBe(false); // nothing overdue
    expect(needsFollowUp(base, '2026-03-10')).toBe(true); // never contacted
    expect(needsFollowUp({ ...base, lastContactDate: '2026-03-09' }, '2026-03-10')).toBe(false); // contacted yesterday
    expect(needsFollowUp({ ...base, lastContactDate: '2026-03-03' }, '2026-03-10')).toBe(true); // a week ago
    expect(FOLLOW_UP_AFTER_DAYS).toBe(7);
    expect(needsFollowUp({ ...base, lastContactDate: '2026-03-09', promise: { state: 'broken' } }, '2026-03-10')).toBe(true); // promise broken, chase now
    expect(needsFollowUp({ ...base, promise: { state: 'open' } }, '2026-03-10')).toBe(false); // they have promised a day still to come
    expect(needsFollowUp({ ...base, promise: { state: 'kept' } }, '2026-03-10')).toBe(true); // kept, but still overdue and never contacted
  });
});

describe('logging contact', () => {
  it('records how and when, newest first', () => {
    const { c } = debtor();
    followups.logContact(db, c.id, 'call', 'Said the money comes Friday');
    followups.logContact(db, c.id, 'whatsapp', '');
    const { contacts } = followups.customerFollowUps(db, c.id);
    expect(contacts.map((x) => x.channel)).toEqual(['whatsapp', 'call']);
    expect(contacts[1]!.note).toBe('Said the money comes Friday');
  });

  it('checks the channel and the customer', () => {
    const { c } = debtor();
    expect(() => followups.logContact(db, c.id, 'pigeon' as never, '')).toThrow(/how you got in touch/);
    expect(() => followups.logContact(db, 'nobody', 'call', '')).toThrow(/no longer exists|not found/i);
    expect(() => followups.logContact(db, c.id, 'call', 'x'.repeat(300))).toThrow(/Note/);
  });
});

describe('promises to pay', () => {
  it('records a promise as open', () => {
    const { c } = debtor();
    const p = followups.createPromise(db, c.id, { promisedOn: addDays(today, 3), amountPaise: rupees(5000), note: 'After the wedding' });
    expect(p).toMatchObject({ state: 'open', amountPaise: rupees(5000), paidSincePaise: 0, note: 'After the wedding' });
  });

  it('checks the day and the amount', () => {
    const { c } = debtor();
    expect(() => followups.createPromise(db, c.id, { promisedOn: 'soon', amountPaise: 100, note: '' })).toThrow(/day they promised/);
    expect(() => followups.createPromise(db, c.id, { promisedOn: addDays(today, -1), amountPaise: 100, note: '' })).toThrow(/in the past/);
    expect(() => followups.createPromise(db, c.id, { promisedOn: today, amountPaise: 0, note: '' })).toThrow(/Amount/);
    expect(() => followups.createPromise(db, 'nobody', { promisedOn: today, amountPaise: 100, note: '' })).toThrow();
    expect(followups.createPromise(db, c.id, { promisedOn: today, amountPaise: 100, note: '' }).state).toBe('open'); // today is fine
  });

  it('is kept when the promised amount arrives after the promise, even in pieces', () => {
    const { c, inv } = debtor();
    const p = followups.createPromise(db, c.id, { promisedOn: addDays(today, 5), amountPaise: rupees(5000), note: '' });
    pay(c.id, inv.id, rupees(2000));
    expect(followups.customerFollowUps(db, c.id).promises[0]).toMatchObject({ id: p.id, state: 'open', paidSincePaise: rupees(2000) });
    pay(c.id, inv.id, rupees(3000));
    expect(followups.customerFollowUps(db, c.id).promises[0]).toMatchObject({ state: 'kept', paidSincePaise: rupees(5000) });
  });

  it('is not kept by money that arrived before it was made', () => {
    const { c, inv } = debtor();
    pay(c.id, inv.id, rupees(6000));
    const p = followups.createPromise(db, c.id, { promisedOn: addDays(today, 2), amountPaise: rupees(3000), note: '' });
    expect(p).toMatchObject({ state: 'open', paidSincePaise: 0 });
  });

  it('is undone when the payment that kept it is reversed', () => {
    const { c, inv } = debtor();
    followups.createPromise(db, c.id, { promisedOn: addDays(today, 2), amountPaise: rupees(1000), note: '' });
    const payment = pay(c.id, inv.id, rupees(1000));
    expect(followups.followUps(db)[0]!.promise!.state).toBe('kept');
    payments.voidPayment(db, payment.id, 'bounced');
    expect(followups.followUps(db)[0]!.promise!.state).toBe('open');
  });

  it('is not kept by a credit note, which is not money', () => {
    const { c, inv } = debtor();
    followups.createPromise(db, c.id, { promisedOn: addDays(today, 2), amountPaise: rupees(1000), note: '' });
    creditNotes.createCreditNote(db, { invoiceId: inv.id, issueDate: today, kind: 'return', reason: 'x', notes: '', lines: [{ invoiceLineId: inv.lines[0]!.id, qty: 1, restock: true }] });
    expect(followups.followUps(db)[0]!.promise!.paidSincePaise).toBe(0);
  });

  it('breaks once the day has passed without the money', () => {
    const { c } = debtor();
    followups.createPromise(db, c.id, { promisedOn: addDays(today, 1), amountPaise: rupees(1000), note: '' });
    db.prepare('UPDATE payment_promises SET promised_on = ?').run(addDays(today, -1)); // "time passes"
    expect(followups.followUps(db)[0]!.promise!.state).toBe('broken');
  });

  it('can be cancelled, once, and then stops counting', () => {
    const { c } = debtor();
    const p = followups.createPromise(db, c.id, { promisedOn: addDays(today, 2), amountPaise: rupees(1000), note: '' });
    followups.cancelPromise(db, p.id);
    expect(followups.customerFollowUps(db, c.id).promises[0]!.state).toBe('cancelled');
    expect(followups.followUps(db)).toEqual([]); // nothing left that matters for the dues list
    expect(() => followups.cancelPromise(db, p.id)).toThrow(/already cancelled/);
    expect(() => followups.cancelPromise(db, 'nope')).toThrow(/no longer exists/);
  });
});

describe('the dues list view', () => {
  it('lists each customer with their last contact and latest live promise', () => {
    const a = debtor('Sunita').c;
    const b = debtor('Rani').c;
    debtor('Meera'); // nothing logged: not in the list
    followups.logContact(db, a.id, 'call', '');
    followups.logContact(db, a.id, 'whatsapp', '');
    const old = followups.createPromise(db, b.id, { promisedOn: addDays(today, 2), amountPaise: rupees(1000), note: '' });
    const latest = followups.createPromise(db, b.id, { promisedOn: addDays(today, 6), amountPaise: rupees(2000), note: '' });
    const list = followups.followUps(db);
    expect(list).toHaveLength(2);
    const fa = list.find((f) => f.customerId === a.id)!;
    expect(fa).toMatchObject({ contactCount: 2, lastContactChannel: 'whatsapp', promise: null });
    const fb = list.find((f) => f.customerId === b.id)!;
    expect(fb).toMatchObject({ contactCount: 0, lastContactAt: null });
    expect(fb.promise!.id).toBe(latest.id);
    expect(old.id).not.toBe(latest.id);
  });
});
