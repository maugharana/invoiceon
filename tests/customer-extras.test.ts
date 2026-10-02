import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../electron/db/connection';
import { attentionItems } from '../electron/services/attention';
import * as customers from '../electron/services/customers';
import * as notes from '../electron/services/notes';
import { saveSettings } from '../electron/services/settings';
import { checkCredit, dueDateFromTerms } from '../shared/credit';
import { addDays, todayIso } from '../shared/gst';
import { nextOccurrence, upcomingOccasions } from '../shared/occasions';
import { hasTag, normalizeTags, parseTags, tagCounts } from '../shared/tags';
import type { CustomerInput } from '../shared/types';

const today = todayIso();
let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { gstin: '09AABCK1234M1ZI' });
});

const blank: CustomerInput = { name: 'Sunita', type: 'B2C', phone: '', email: '', gstin: '', address: '', city: '', state: '', pincode: '', notes: '' };
const customer = (over: Partial<CustomerInput> = {}) => customers.createCustomer(db, { ...blank, ...over });

describe('tags', () => {
  it('tidies a typed list: trims, drops blanks and repeats, keeps the first spelling', () => {
    expect(parseTags(' Bridal, silk ;; BRIDAL ,  regular  customer ,')).toEqual(['Bridal', 'silk', 'regular customer']);
    expect(normalizeTags('a,b,A')).toBe('a, b');
    expect(parseTags(null)).toEqual([]);
  });

  it('counts tags across records, most used first, and matches ignoring case', () => {
    expect(tagCounts(['bridal, silk', 'Silk', '', 'wholesale'])).toEqual([
      { tag: 'silk', count: 2 },
      { tag: 'bridal', count: 1 },
      { tag: 'wholesale', count: 1 },
    ]);
    expect(hasTag('Bridal, Silk', 'silk')).toBe(true);
    expect(hasTag('Bridal', 'silk')).toBe(false);
    expect(hasTag('', '')).toBe(true);
  });
});

describe('birthdays and anniversaries', () => {
  it('finds the next time a date comes round, counting today and wrapping into next year', () => {
    expect(nextOccurrence('1990-10-05', '2026-10-02')).toEqual({ date: '2026-10-05', daysAway: 3 });
    expect(nextOccurrence('1990-10-02', '2026-10-02')).toEqual({ date: '2026-10-02', daysAway: 0 });
    expect(nextOccurrence('1990-01-10', '2026-12-30')).toEqual({ date: '2027-01-10', daysAway: 11 });
  });

  it('keeps a 29 February birthday on the 28th in a year with no leap day', () => {
    expect(nextOccurrence('2000-02-29', '2027-02-01')).toEqual({ date: '2027-02-28', daysAway: 27 });
    expect(nextOccurrence('2000-02-29', '2028-02-01')?.date).toBe('2028-02-29');
  });

  it('lists only the ones within the window, soonest first, and ignores junk', () => {
    const got = upcomingOccasions({ birthday: '1980-10-04', anniversary: '2010-10-03' }, '2026-10-02', 3);
    expect(got.map((o) => [o.kind, o.daysAway])).toEqual([['anniversary', 1], ['birthday', 2]]);
    expect(upcomingOccasions({ birthday: '1980-11-30' }, '2026-10-02', 3)).toEqual([]);
    expect(nextOccurrence('not a date', '2026-10-02')).toBeNull();
  });
});

describe('credit limit and payment terms', () => {
  it('warns only when a limit is set and the invoice takes them past it', () => {
    expect(checkCredit(0, 500_000, 900_000).overLimit).toBe(false); // 0 = no limit
    expect(checkCredit(1_000_000, 400_000, 600_000)).toMatchObject({ overLimit: false, excessPaise: 0 }); // exactly at the limit is fine
    expect(checkCredit(1_000_000, 400_000, 700_000)).toMatchObject({ overLimit: true, afterPaise: 1_100_000, excessPaise: 100_000 });
  });

  it('turns payment terms into a due date', () => {
    expect(dueDateFromTerms('2026-10-02', 30)).toBe('2026-11-01');
    expect(dueDateFromTerms('2026-10-02', 0)).toBe('2026-10-02');
    expect(dueDateFromTerms('2026-10-02', null)).toBeNull();
  });
});

describe('the extra customer details', () => {
  it('saves and returns tags, limit, terms, occasions, addresses and contacts', () => {
    const c = customer({
      tags: 'Bridal, bridal, wholesale',
      creditLimitPaise: 5_000_000,
      paymentTermsDays: 15,
      birthday: '1985-03-09',
      anniversary: '2012-11-21',
      addresses: [{ label: 'Shop', address: '12 Market Rd', city: 'Varanasi', state: 'Uttar Pradesh', pincode: '221001' }, { label: '', address: '', city: '', state: '', pincode: '' }],
      contacts: [{ name: 'Ravi', role: 'Manager', phone: '9876500000', email: '' }],
    });
    const back = customers.getCustomer(db, c.id);
    expect(back.tags).toBe('Bridal, wholesale');
    expect(back.creditLimitPaise).toBe(5_000_000);
    expect(back.paymentTermsDays).toBe(15);
    expect(back.birthday).toBe('1985-03-09');
    expect(back.addresses).toHaveLength(1); // the empty one is dropped
    expect(back.addresses[0].city).toBe('Varanasi');
    expect(back.contacts).toEqual([{ name: 'Ravi', role: 'Manager', phone: '9876500000', email: '' }]);
  });

  it('defaults sensibly when the new fields are left out', () => {
    const c = customer();
    expect(c).toMatchObject({ tags: '', creditLimitPaise: 0, paymentTermsDays: null, birthday: '', anniversary: '', addresses: [], contacts: [] });
  });

  it('rejects impossible values with a plain message', () => {
    expect(() => customer({ creditLimitPaise: -1 })).toThrow(/credit limit/i);
    expect(() => customer({ paymentTermsDays: 400 })).toThrow(/between 0 and 365/);
    expect(() => customer({ birthday: '2026-02-30' })).toThrow(/valid date/i);
    expect(() => customer({ addresses: [{ label: '', address: 'x', city: '', state: 'Atlantis', pincode: '' }] })).toThrow(/state/i);
    expect(() => customer({ addresses: [{ label: '', address: 'x', city: '', state: '', pincode: '12' }] })).toThrow(/6 digits/);
  });

  it('can search by tag, and merging two customers combines their tags and notes', () => {
    const keep = customer({ name: 'Sunita', tags: 'regular', phone: '9876543210' });
    const dupe = customer({ name: 'Sunita D', tags: 'bridal, Regular', phone: '9876543210' });
    notes.addNote(db, { subjectType: 'customer', subjectId: dupe.id, kind: 'note', body: 'Likes red' });
    expect(customers.listCustomers(db, { search: 'bridal' }).map((c) => c.name)).toEqual(['Sunita D']);
    const merged = customers.mergeCustomers(db, keep.id, dupe.id);
    expect(merged.tags).toBe('regular, bridal');
    expect(notes.listNotes(db, 'customer', keep.id).map((n) => n.body)).toEqual(['Likes red']);
  });
});

describe('notes, follow-ups and promises', () => {
  it('keeps a timeline, newest first, and lets a note be removed', () => {
    const c = customer();
    notes.addNote(db, { subjectType: 'customer', subjectId: c.id, kind: 'call', body: 'Asked for new stock' });
    const second = notes.addNote(db, { subjectType: 'customer', subjectId: c.id, kind: 'visit', body: 'Came to the shop' });
    expect(notes.listNotes(db, 'customer', c.id).map((n) => n.body)).toEqual(['Came to the shop', 'Asked for new stock']);
    notes.deleteNote(db, second.id);
    expect(notes.listNotes(db, 'customer', c.id)).toHaveLength(1);
  });

  it('requires the day for a follow-up and the day and amount for a promise', () => {
    const c = customer();
    const base = { subjectType: 'customer' as const, subjectId: c.id };
    expect(() => notes.addNote(db, { ...base, kind: 'followup', body: 'Ring her' })).toThrow(/day/i);
    expect(() => notes.addNote(db, { ...base, kind: 'promise', body: '', dueDate: today })).toThrow(/day and the amount/);
    expect(() => notes.addNote(db, { ...base, kind: 'note', body: '' })).toThrow(/Write something/);
    expect(() => notes.addNote(db, { subjectType: 'customer', subjectId: 'nope', kind: 'note', body: 'x' })).toThrow(/no longer exists/);
  });

  it('lists open ones that are due, and drops them once ticked off', () => {
    const c = customer({ name: 'Meena' });
    const base = { subjectType: 'customer' as const, subjectId: c.id };
    const overdue = notes.addNote(db, { ...base, kind: 'promise', body: '', dueDate: addDays(today, -2), amountPaise: 250_000 });
    notes.addNote(db, { ...base, kind: 'followup', body: 'Show new arrivals', dueDate: addDays(today, 5) });
    const due = notes.openDueNotes(db, { onOrBefore: today });
    expect(due.map((n) => [n.kind, n.customerName])).toEqual([['promise', 'Meena']]);
    expect(notes.openDueNotes(db).map((n) => n.kind)).toEqual(['promise', 'followup']);
    notes.setNoteDone(db, overdue.id, true);
    expect(notes.openDueNotes(db, { onOrBefore: today })).toEqual([]);
    notes.setNoteDone(db, overdue.id, false);
    expect(notes.openDueNotes(db, { onOrBefore: today })).toHaveLength(1);
  });

  it('puts due follow-ups, missed promises and coming birthdays on the dashboard list', () => {
    const c = customer({ name: 'Meena', birthday: `1990-${addDays(today, 2).slice(5)}` });
    notes.addNote(db, { subjectType: 'customer', subjectId: c.id, kind: 'promise', body: '', dueDate: addDays(today, -1), amountPaise: 100_000 });
    notes.addNote(db, { subjectType: 'customer', subjectId: c.id, kind: 'followup', body: 'Ring about the saree', dueDate: today });
    const kinds = attentionItems(db, today).map((i) => i.kind);
    expect(kinds).toContain('promise');
    expect(kinds).toContain('follow-up');
    expect(kinds).toContain('occasion');
    const promise = attentionItems(db, today).find((i) => i.kind === 'promise')!;
    expect(promise.title).toMatch(/Meena promised/);
    expect(promise.title).toMatch(/overdue/);
  });
});
