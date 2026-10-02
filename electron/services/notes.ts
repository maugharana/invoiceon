import { isIsoDate } from '../../shared/gst';
import { NOTE_KINDS, type DueNote, type Note, type NoteInput, type NoteSubject } from '../../shared/types';
import { all, get, run, type Db } from '../db/connection';
import { UserError, newId, nowIso, optionalText } from './common';

interface NoteRow {
  id: string;
  subject_type: NoteSubject;
  subject_id: string;
  kind: Note['kind'];
  body: string;
  due_date: string | null;
  amount_paise: number;
  done_at: string | null;
  created_at: string;
}

const toNote = (r: NoteRow): Note => ({
  id: r.id,
  subjectType: r.subject_type,
  subjectId: r.subject_id,
  kind: r.kind,
  body: r.body,
  dueDate: r.due_date,
  amountPaise: r.amount_paise,
  doneAt: r.done_at,
  createdAt: r.created_at,
});

const SUBJECT_TABLE: Record<NoteSubject, string> = { customer: 'customers', proforma: 'proformas', invoice: 'invoices' };

function requireSubject(db: Db, type: NoteSubject, id: string): void {
  const table = SUBJECT_TABLE[type];
  if (!table) throw new UserError('That note is not attached to anything.');
  const row = get<{ id: string }>(db, `SELECT id FROM ${table} WHERE id = ?`, id);
  if (!row) throw new UserError('What this note is about no longer exists.');
}

/** A customer's, quote's or invoice's notes, newest first. */
export function listNotes(db: Db, subjectType: NoteSubject, subjectId: string): Note[] {
  return all<NoteRow>(db, 'SELECT * FROM notes WHERE subject_type = ? AND subject_id = ? AND deleted_at IS NULL ORDER BY created_at DESC', subjectType, subjectId).map(toNote);
}

export function addNote(db: Db, input: NoteInput): Note {
  if (!NOTE_KINDS.includes(input.kind)) throw new UserError('Choose what kind of note this is.');
  requireSubject(db, input.subjectType, input.subjectId);
  const body = optionalText(input.body, 'Note', 500);
  const dueDate = input.dueDate ? input.dueDate : null;
  if (dueDate !== null && !isIsoDate(dueDate)) throw new UserError('Enter a valid date.');
  const amount = input.amountPaise ?? 0;
  if (!Number.isInteger(amount) || amount < 0) throw new UserError('The amount should be zero or more.');
  if (input.kind === 'followup' && !dueDate) throw new UserError('Choose the day to follow up.');
  if (input.kind === 'promise' && (!dueDate || amount <= 0)) throw new UserError('A promise to pay needs the day and the amount.');
  if (!body && input.kind !== 'promise' && input.kind !== 'followup') throw new UserError('Write something for the note.');
  const id = newId();
  const now = nowIso();
  run(db, 'INSERT INTO notes (id, subject_type, subject_id, kind, body, due_date, amount_paise, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, input.subjectType, input.subjectId, input.kind, body, dueDate, amount, now, now);
  return toNote(get<NoteRow>(db, 'SELECT * FROM notes WHERE id = ?', id)!);
}

/** Ticks a follow-up or promise off (or reopens it). */
export function setNoteDone(db: Db, id: string, done: boolean): Note {
  const row = get<NoteRow>(db, 'SELECT * FROM notes WHERE id = ? AND deleted_at IS NULL', id);
  if (!row) throw new UserError('That note no longer exists.');
  run(db, 'UPDATE notes SET done_at = ?, updated_at = ? WHERE id = ?', done ? nowIso() : null, nowIso(), id);
  return toNote(get<NoteRow>(db, 'SELECT * FROM notes WHERE id = ?', id)!);
}

export function deleteNote(db: Db, id: string): void {
  const row = get<NoteRow>(db, 'SELECT * FROM notes WHERE id = ? AND deleted_at IS NULL', id);
  if (!row) throw new UserError('That note no longer exists.');
  run(db, 'UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
}

/**
 * Follow-ups and promises still open, soonest first, with what they are about, so the dashboard, the dues page and the
 * notifications can all show them. `onOrBefore` limits to ones due by then (overdue ones always included).
 */
export function openDueNotes(db: Db, opts: { onOrBefore?: string; kind?: Note['kind'] } = {}): DueNote[] {
  const rows = all<NoteRow & { customer_id: string | null; customer_name: string | null; label: string }>(
    db,
    `SELECT n.*,
       CASE n.subject_type
         WHEN 'customer' THEN n.subject_id
         WHEN 'invoice' THEN (SELECT customer_id FROM invoices WHERE id = n.subject_id)
         ELSE (SELECT customer_id FROM proformas WHERE id = n.subject_id) END AS customer_id,
       CASE n.subject_type
         WHEN 'customer' THEN (SELECT name FROM customers WHERE id = n.subject_id)
         WHEN 'invoice' THEN (SELECT json_extract(buyer_json, '$.name') FROM invoices WHERE id = n.subject_id)
         ELSE (SELECT json_extract(buyer_json, '$.name') FROM proformas WHERE id = n.subject_id) END AS customer_name,
       CASE n.subject_type
         WHEN 'customer' THEN ''
         WHEN 'invoice' THEN (SELECT number FROM invoices WHERE id = n.subject_id)
         ELSE (SELECT number FROM proformas WHERE id = n.subject_id) END AS label
     FROM notes n
     WHERE n.deleted_at IS NULL AND n.done_at IS NULL AND n.kind IN ('followup', 'promise') AND n.due_date IS NOT NULL
       AND (? IS NULL OR n.due_date <= ?) AND (? IS NULL OR n.kind = ?)
     ORDER BY n.due_date, n.created_at`,
    opts.onOrBefore ?? null,
    opts.onOrBefore ?? null,
    opts.kind ?? null,
    opts.kind ?? null,
  );
  return rows.map((r) => ({ ...toNote(r), customerId: r.customer_id, customerName: r.customer_name ?? 'Walk-in customer', subjectLabel: r.label }));
}
