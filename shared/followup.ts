// Chasing money: a log of every time a customer was reminded or called, and promises to pay. Whether a promise was kept is worked out from the
// payments actually received since it was made, never stored, so it cannot drift from the books.

import type { Paise } from './money';

export type ContactChannel = 'whatsapp' | 'call' | 'visit' | 'other';

export const CONTACT_LABEL: Record<ContactChannel, string> = { whatsapp: 'Reminded on WhatsApp', call: 'Called', visit: 'Visited', other: 'Contacted' };

export interface Contact {
  id: string;
  customerId: string;
  channel: ContactChannel;
  note: string;
  createdAt: string;
}

export interface PromiseInput {
  /** The day they said they would pay. */
  promisedOn: string;
  amountPaise: Paise;
  note: string;
}

export type PromiseState = 'open' | 'kept' | 'broken' | 'cancelled';

export const PROMISE_LABEL: Record<PromiseState, string> = { open: 'Promised', kept: 'Kept', broken: 'Broken', cancelled: 'Cancelled' };

export interface PaymentPromise {
  id: string;
  customerId: string;
  promisedOn: string;
  amountPaise: Paise;
  note: string;
  createdAt: string;
  state: PromiseState;
  /** Money received from them since the promise was made. */
  paidSincePaise: Paise;
}

/** A customer's follow-up position, for the dues list. */
export interface FollowUp {
  customerId: string;
  lastContactAt: string | null;
  lastContactChannel: ContactChannel | null;
  contactCount: number;
  /** The latest promise that was not cancelled. */
  promise: PaymentPromise | null;
}

export interface CustomerFollowUps {
  contacts: Contact[];
  promises: PaymentPromise[];
}

/**
 * Kept once they have paid the promised amount since the promise was made. Otherwise still open until the promised day has passed, then broken.
 * (The promised day itself is still open: they have until the end of it.)
 */
export function promiseState(p: { promisedOn: string; amountPaise: Paise; cancelled: boolean; paidSincePaise: Paise }, today: string): PromiseState {
  if (p.cancelled) return 'cancelled';
  if (p.paidSincePaise >= p.amountPaise) return 'kept';
  return p.promisedOn < today ? 'broken' : 'open';
}

/** Days between two calendar dates (b minus a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export const FOLLOW_UP_AFTER_DAYS = 7;

/**
 * Whether a customer is worth chasing today: something is overdue, they have not promised to pay by a day still to come, and either a promise
 * was broken or nobody has been in touch for a week (or ever).
 */
export function needsFollowUp(f: { overduePaise: Paise; lastContactDate: string | null; promise: { state: PromiseState } | null }, today: string): boolean {
  if (f.overduePaise <= 0) return false;
  if (f.promise?.state === 'open') return false;
  if (f.promise?.state === 'broken') return true;
  return f.lastContactDate === null || daysBetween(f.lastContactDate, today) >= FOLLOW_UP_AFTER_DAYS;
}

/** "today", "yesterday", "3 days ago". */
export function ago(date: string, today: string): string {
  const n = daysBetween(date, today);
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
}
