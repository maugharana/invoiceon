import { isIsoDate, isValidRate } from '../../shared/gst';
import type { Salesperson, SalespersonInput, SalespeopleReport, SalespersonReportRow } from '../../shared/types';
import { all, get, run, type Db } from '../db/connection';
import { UserError, newId, nowIso, requireText } from './common';

// The people who sell: kept apart from the people who sign in, because a shop's sales team is often not the same list (someone who
// never touches the computer still makes sales). An invoice remembers who sold it and the commission rate at that moment, so a
// later change of rate never rewrites what was already earned.

interface Row {
  id: string;
  name: string;
  commission_percent: number;
  deleted_at: string | null;
  invoices: number;
}

const toPerson = (r: Row): Salesperson => ({ id: r.id, name: r.name, commissionPercent: r.commission_percent, archived: r.deleted_at !== null, invoiceCount: r.invoices });

const SELECT = "SELECT s.id, s.name, s.commission_percent, s.deleted_at, (SELECT COUNT(*) FROM invoices i WHERE i.salesperson_id = s.id AND i.status = 'issued') AS invoices FROM salespeople s";

/** Everyone, in the order they are listed: those still selling first, then those who have been archived. */
export function listSalespeople(db: Db): Salesperson[] {
  return all<Row>(db, `${SELECT} ORDER BY s.deleted_at IS NOT NULL, s.name COLLATE NOCASE`).map(toPerson);
}

function getRow(db: Db, id: string): Row {
  const r = get<Row>(db, `${SELECT} WHERE s.id = ?`, String(id));
  if (!r) throw new UserError('That person is not on the sales team.');
  return r;
}

function checkInput(db: Db, input: SalespersonInput, exceptId = ''): { name: string; commission: number } {
  const name = requireText(input?.name, 'Name', 60);
  const commission = Number(input?.commissionPercent ?? 0);
  if (!isValidRate(commission)) throw new UserError('Commission should be a percentage from 0 to 100, with at most two decimals.');
  const clash = get<{ id: string }>(db, 'SELECT id FROM salespeople WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL AND id <> ?', name, exceptId);
  if (clash) throw new UserError(`There is already someone called ${name} on the sales team.`);
  return { name, commission };
}

export function createSalesperson(db: Db, input: SalespersonInput): Salesperson {
  const { name, commission } = checkInput(db, input);
  const id = newId();
  const now = nowIso();
  run(db, 'INSERT INTO salespeople (id, name, commission_percent, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', id, name, commission, now, now);
  return toPerson(getRow(db, id));
}

export function updateSalesperson(db: Db, id: string, input: SalespersonInput): Salesperson {
  const existing = getRow(db, id);
  const { name, commission } = checkInput(db, input, existing.deleted_at === null ? id : '');
  run(db, 'UPDATE salespeople SET name = ?, commission_percent = ?, updated_at = ? WHERE id = ?', name, commission, nowIso(), id);
  return toPerson(getRow(db, id));
}

/** Takes someone off the list for new bills. What they sold, and the commission on it, stays as it was. */
export function archiveSalesperson(db: Db, id: string): void {
  const r = getRow(db, id);
  if (r.deleted_at !== null) throw new UserError(`${r.name} is already archived.`);
  run(db, 'UPDATE salespeople SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
}

export function restoreSalesperson(db: Db, id: string): Salesperson {
  const r = getRow(db, id);
  if (r.deleted_at === null) return toPerson(r);
  if (get(db, 'SELECT 1 AS x FROM salespeople WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL AND id <> ?', r.name, id)) throw new UserError(`${r.name} can't be brought back: someone else on the team has that name now.`);
  run(db, 'UPDATE salespeople SET deleted_at = NULL, updated_at = ? WHERE id = ?', nowIso(), id);
  return toPerson(getRow(db, id));
}

/** Who a bill is being credited to: someone still on the team, with the rate to remember on it. */
export function resolveSalesperson(db: Db, id: string): { id: string; name: string; commissionPercent: number } {
  const r = getRow(db, id);
  if (r.deleted_at !== null) throw new UserError(`${r.name} has been archived, so they can't be credited with a new sale.`);
  return { id: r.id, name: r.name, commissionPercent: r.commission_percent };
}

// ── The report ──────────────────────────────────────────────────────────────
/**
 * What each person sold in the period, before GST, less goods taken back in the period on what they sold, and the commission on that
 * at the rate each bill carried. A bill with nobody recorded is counted under "No one recorded", so the total is the whole shop's.
 */
export function salespeopleReport(db: Db, range: { from: string; to: string }): SalespeopleReport {
  if (!isIsoDate(range?.from) || !isIsoDate(range?.to)) throw new UserError('Choose a valid date range.');
  if (range.from > range.to) throw new UserError('The start date is after the end date.');

  const sold = all<{ who: string | null; percent: number; taxable: number }>(db, "SELECT salesperson_id AS who, commission_percent AS percent, taxable_paise AS taxable FROM invoices WHERE status = 'issued' AND issue_date BETWEEN ? AND ?", range.from, range.to);
  const back = all<{ who: string | null; percent: number; taxable: number }>(
    db,
    "SELECT i.salesperson_id AS who, i.commission_percent AS percent, n.taxable_paise AS taxable FROM credit_notes n JOIN invoices i ON i.id = n.invoice_id WHERE n.status = 'issued' AND n.issue_date BETWEEN ? AND ?",
    range.from,
    range.to,
  );

  const blank = (key: string, name: string, commissionPercent: number | null): SalespersonReportRow => ({ salespersonId: key === '' ? null : key, name, commissionPercent, invoices: 0, salesPaise: 0, returnsPaise: 0, netPaise: 0, commissionPaise: 0 });
  const rows = new Map<string, SalespersonReportRow>();
  const people = listSalespeople(db);
  for (const p of people) if (!p.archived) rows.set(p.id, blank(p.id, p.name, p.commissionPercent));
  const rowFor = (who: string | null): SalespersonReportRow => {
    const key = who ?? '';
    let row = rows.get(key);
    if (!row) {
      const p = people.find((x) => x.id === who);
      row = key === '' ? blank('', 'No one recorded', null) : blank(key, p ? `${p.name} (archived)` : 'Unknown', p?.commissionPercent ?? null);
      rows.set(key, row);
    }
    return row;
  };

  for (const s of sold) {
    const row = rowFor(s.who);
    row.invoices += 1;
    row.salesPaise += s.taxable;
    row.commissionPaise += Math.round((s.taxable * s.percent) / 100);
  }
  for (const b of back) {
    const row = rowFor(b.who);
    row.returnsPaise += b.taxable;
    row.commissionPaise -= Math.round((b.taxable * b.percent) / 100);
  }
  const list = [...rows.values()];
  for (const r of list) r.netPaise = r.salesPaise - r.returnsPaise;
  list.sort((a, b) => (a.salespersonId === null ? 1 : b.salespersonId === null ? -1 : b.netPaise - a.netPaise || a.name.localeCompare(b.name)));
  const sum = (f: (r: SalespersonReportRow) => number) => list.reduce((s, r) => s + f(r), 0);
  return {
    range,
    rows: list,
    totals: { invoices: sum((r) => r.invoices), salesPaise: sum((r) => r.salesPaise), returnsPaise: sum((r) => r.returnsPaise), netPaise: sum((r) => r.netPaise), commissionPaise: sum((r) => r.commissionPaise) },
  };
}
