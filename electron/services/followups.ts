import { promiseState, type ContactChannel, type Contact, type CustomerFollowUps, type FollowUp, type PaymentPromise, type PromiseInput } from '../../shared/followup';
import { isIsoDate, todayIso } from '../../shared/gst';
import { all, get, run, type Db } from '../db/connection';
import { UserError, newId, nowIso, optionalText, requireInt } from './common';
import { getCustomer } from './customers';

const CHANNELS: readonly ContactChannel[] = ['whatsapp', 'call', 'visit', 'other'];
const MAX_PAISE = 100_000_000_00;

interface ContactRow {
  id: string;
  customer_id: string;
  channel: ContactChannel;
  note: string;
  created_at: string;
}

interface PromiseRow {
  id: string;
  customer_id: string;
  promised_on: string;
  amount_paise: number;
  note: string;
  cancelled_at: string | null;
  created_at: string;
}

const toContact = (r: ContactRow): Contact => ({ id: r.id, customerId: r.customer_id, channel: r.channel, note: r.note, createdAt: r.created_at });

/** Money received from the customer since the promise was made: what says whether it was kept. Credit notes are not money. */
const paidSince = (db: Db, customerId: string, since: string): number =>
  get<{ p: number | null }>(db, "SELECT SUM(amount_paise) AS p FROM payments WHERE customer_id = ? AND voided_at IS NULL AND source <> 'credit_note' AND created_at >= ?", customerId, since)?.p ?? 0;

function toPromise(db: Db, r: PromiseRow, today: string): PaymentPromise {
  const paid = paidSince(db, r.customer_id, r.created_at);
  return { id: r.id, customerId: r.customer_id, promisedOn: r.promised_on, amountPaise: r.amount_paise, note: r.note, createdAt: r.created_at, state: promiseState({ promisedOn: r.promised_on, amountPaise: r.amount_paise, cancelled: r.cancelled_at !== null, paidSincePaise: paid }, today), paidSincePaise: paid };
}

export function logContact(db: Db, customerId: string, channel: ContactChannel, note: string): Contact {
  getCustomer(db, customerId);
  if (!CHANNELS.includes(channel)) throw new UserError('Choose how you got in touch.');
  const id = newId();
  run(db, 'INSERT INTO customer_contacts (id, customer_id, channel, note, created_at) VALUES (?, ?, ?, ?, ?)', id, customerId, channel, optionalText(note, 'Note', 200), nowIso());
  return toContact(get<ContactRow>(db, 'SELECT * FROM customer_contacts WHERE id = ?', id)!);
}

export function createPromise(db: Db, customerId: string, input: PromiseInput): PaymentPromise {
  getCustomer(db, customerId);
  const today = todayIso();
  if (!isIsoDate(input?.promisedOn)) throw new UserError('Enter the day they promised to pay by.');
  if (input.promisedOn < today) throw new UserError("The promised day can't be in the past.");
  const amount = requireInt(input.amountPaise, 'Amount', { min: 1, max: MAX_PAISE });
  const id = newId();
  run(db, 'INSERT INTO payment_promises (id, customer_id, promised_on, amount_paise, note, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, customerId, input.promisedOn, amount, optionalText(input.note, 'Note', 200), nowIso());
  return toPromise(db, get<PromiseRow>(db, 'SELECT * FROM payment_promises WHERE id = ?', id)!, today);
}

export function cancelPromise(db: Db, id: string): void {
  const row = get<PromiseRow>(db, 'SELECT * FROM payment_promises WHERE id = ?', String(id));
  if (!row) throw new UserError('That promise no longer exists.');
  if (row.cancelled_at) throw new UserError('That promise is already cancelled.');
  run(db, 'UPDATE payment_promises SET cancelled_at = ? WHERE id = ?', nowIso(), id);
}

/** Every customer who has been contacted or has a promise on record, for the dues list. */
export function followUps(db: Db): FollowUp[] {
  const today = todayIso();
  const contacts = all<ContactRow>(db, 'SELECT * FROM customer_contacts ORDER BY created_at DESC, rowid DESC');
  const promises = all<PromiseRow>(db, 'SELECT * FROM payment_promises WHERE cancelled_at IS NULL ORDER BY created_at DESC, rowid DESC');
  const ids = new Set([...contacts.map((c) => c.customer_id), ...promises.map((p) => p.customer_id)]);
  return [...ids].map((customerId) => {
    const mine = contacts.filter((c) => c.customer_id === customerId);
    const latestPromise = promises.find((p) => p.customer_id === customerId);
    return {
      customerId,
      lastContactAt: mine[0]?.created_at ?? null,
      lastContactChannel: mine[0]?.channel ?? null,
      contactCount: mine.length,
      promise: latestPromise ? toPromise(db, latestPromise, today) : null,
    };
  });
}

export function customerFollowUps(db: Db, customerId: string): CustomerFollowUps {
  getCustomer(db, customerId);
  const today = todayIso();
  return {
    contacts: all<ContactRow>(db, 'SELECT * FROM customer_contacts WHERE customer_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100', customerId).map(toContact),
    promises: all<PromiseRow>(db, 'SELECT * FROM payment_promises WHERE customer_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50', customerId).map((p) => toPromise(db, p, today)),
  };
}
