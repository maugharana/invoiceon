import { formatMoney } from '../../shared/money';
import type { IntegrityCheck, IntegrityReport } from '../../shared/types';
import { verifyAuditChain } from '../audit';
import { all, type Db } from '../db/connection';
import { nowIso } from './common';
import { listCustomers } from './customers';
import { listSuppliers } from './suppliers';
import { supplierLedger } from './purchases';
import { customerLedger } from './receivables';
import { listWeavers, weaverLedger } from './weavers';

const SHOWN = 12;
const money = (p: number) => formatMoney(p);

/** Collects problems for one check, keeping the first few in words and counting the rest. */
function check(id: string, title: string, checked: number, run: (problem: (text: string) => void) => void): IntegrityCheck {
  const problems: string[] = [];
  let count = 0;
  run((text) => {
    count += 1;
    if (problems.length < SHOWN) problems.push(text);
  });
  return { id, title, checked, problemCount: count, problems };
}

/**
 * Looks at the records themselves (not the app's own summaries) and says where they disagree. Everything here is read only; nothing is
 * repaired, because a repair that guessed wrong would be worse than a problem that is reported.
 */
export function integrityCheck(db: Db): IntegrityReport {
  const checks: IntegrityCheck[] = [];

  // 1. The database file itself.
  {
    const rows = all<{ integrity_check: string }>(db, 'PRAGMA integrity_check');
    const fk = all<{ table: string; rowid: number; parent: string }>(db, 'PRAGMA foreign_key_check');
    checks.push(
      check('database', 'The database file is sound', 1, (problem) => {
        for (const r of rows) if (r.integrity_check !== 'ok') problem(`The database reports: ${r.integrity_check}`);
        for (const f of fk) problem(`A record in ${f.table} points at a ${f.parent} record that is missing.`);
      }),
    );
  }

  // 2. Stock: the balance on each saree is the sum of its ledger, and the ledger's running balance follows.
  {
    const variants = all<{ id: string; sku: string; stock: number }>(db, 'SELECT id, sku, stock FROM variants');
    const moves = all<{ variant_id: string; delta: number; balance_after: number; created_at: string }>(db, 'SELECT variant_id, delta, balance_after, created_at FROM stock_movements ORDER BY variant_id, created_at, rowid');
    const byVariant = new Map<string, typeof moves>();
    for (const m of moves) byVariant.set(m.variant_id, [...(byVariant.get(m.variant_id) ?? []), m]);
    checks.push(
      check('stock', 'Stock on hand matches its history', variants.length, (problem) => {
        for (const v of variants) {
          const list = byVariant.get(v.id) ?? [];
          const sum = list.reduce((s, m) => s + m.delta, 0);
          if (sum !== v.stock) problem(`${v.sku}: ${v.stock} on the shelf, but its history adds up to ${sum}.`);
          let running = 0;
          for (const m of list) {
            running += m.delta;
            if (m.balance_after !== running) {
              problem(`${v.sku}: the history's running balance jumps at ${m.created_at.slice(0, 10)} (${m.balance_after}, expected ${running}).`);
              break;
            }
          }
        }
      }),
    );
  }

  // 3. Invoices and proformas add up: lines to subtotal, less discount to taxable, plus tax and round-off to the total, and tax by rate to the tax.
  for (const [table, lineTable, fk, label] of [['invoices', 'invoice_lines', 'invoice_id', 'Invoice'], ['proformas', 'proforma_lines', 'proforma_id', 'Proforma']] as const) {
    const docs = all<{ id: string; number: string; subtotal_paise: number; discount_paise: number; taxable_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number; round_off_paise: number; total_paise: number; tax_summary_json: string | null }>(db, `SELECT * FROM ${table}`);
    const lines = all<{ doc: string; qty: number; unit_price_paise: number; amount_paise: number }>(db, `SELECT ${fk} AS doc, qty, unit_price_paise, amount_paise FROM ${lineTable}`);
    const byDoc = new Map<string, typeof lines>();
    for (const l of lines) byDoc.set(l.doc, [...(byDoc.get(l.doc) ?? []), l]);
    checks.push(
      check(table, `${label} figures add up`, docs.length, (problem) => {
        for (const d of docs) {
          const own = byDoc.get(d.id) ?? [];
          if (own.length === 0) problem(`${label} ${d.number} has no items.`);
          for (const l of own) if (l.qty * l.unit_price_paise !== l.amount_paise) problem(`${label} ${d.number}: an item's amount is not its quantity times its price.`);
          const subtotal = own.reduce((s, l) => s + l.amount_paise, 0);
          if (subtotal !== d.subtotal_paise) problem(`${label} ${d.number}: the items add up to ${money(subtotal)} but the subtotal says ${money(d.subtotal_paise)}.`);
          if (d.subtotal_paise - d.discount_paise !== d.taxable_paise) problem(`${label} ${d.number}: subtotal less discount is not the taxable value.`);
          const total = d.taxable_paise + d.cgst_paise + d.sgst_paise + d.igst_paise + d.round_off_paise;
          if (total !== d.total_paise) problem(`${label} ${d.number}: taxable value, tax and round-off come to ${money(total)} but the total says ${money(d.total_paise)}.`);
          if (d.tax_summary_json) {
            const g = JSON.parse(d.tax_summary_json) as { taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number }[];
            const sum = (f: (x: (typeof g)[number]) => number) => g.reduce((s, x) => s + f(x), 0);
            if (sum((x) => x.taxablePaise) !== d.taxable_paise || sum((x) => x.cgstPaise) !== d.cgst_paise || sum((x) => x.sgstPaise) !== d.sgst_paise || sum((x) => x.igstPaise) !== d.igst_paise) problem(`${label} ${d.number}: the tax by rate does not add up to the document's tax.`);
          }
        }
      }),
    );
  }

  // 4. Invoice numbers run without gaps within a financial year (a cancelled number still counts: it was used).
  {
    const rows = all<{ fy: string; seq: number }>(db, 'SELECT fy, seq FROM invoices ORDER BY fy, seq');
    const byFy = new Map<string, number[]>();
    for (const r of rows) byFy.set(r.fy, [...(byFy.get(r.fy) ?? []), r.seq]);
    checks.push(
      check('numbering', 'Invoice numbers run without gaps', rows.length, (problem) => {
        for (const [fy, seqs] of byFy) {
          for (let i = 0; i < seqs.length; i++) if (seqs[i] !== i + 1) {
            problem(`Financial year ${fy}: invoice ${i + 1} is missing (the numbers jump to ${seqs[i]}).`);
            break;
          }
        }
      }),
    );
  }

  // 5. Payments: nothing applied beyond what was paid or owed, and nothing live on a cancelled invoice.
  {
    const payments = all<{ id: string; amount_paise: number; applied: number; voided_at: string | null; reference: string }>(
      db,
      `SELECT p.id, p.amount_paise, p.voided_at, p.reference, COALESCE((SELECT SUM(a.amount_paise) FROM payment_allocations a WHERE a.payment_id = p.id AND a.released_at IS NULL), 0) AS applied FROM payments p`,
    );
    const invoices = all<{ number: string; total_paise: number; paid: number }>(
      db,
      `SELECT i.number, i.total_paise, COALESCE((SELECT SUM(a.amount_paise) FROM payment_allocations a JOIN payments p ON p.id = a.payment_id WHERE a.invoice_id = i.id AND a.released_at IS NULL AND p.voided_at IS NULL), 0) AS paid FROM invoices i`,
    );
    const stuck = all<{ number: string }>(db, `SELECT i.number FROM payment_allocations a JOIN payments p ON p.id = a.payment_id JOIN invoices i ON i.id = a.invoice_id WHERE i.status = 'cancelled' AND a.released_at IS NULL AND p.voided_at IS NULL`);
    checks.push(
      check('payments', 'Payments are applied correctly', payments.length, (problem) => {
        for (const p of payments) if (!p.voided_at && p.applied > p.amount_paise) problem(`A payment of ${money(p.amount_paise)} (${p.reference || 'no reference'}) has ${money(p.applied)} applied to invoices.`);
        for (const i of invoices) if (i.paid > i.total_paise) problem(`Invoice ${i.number}: ${money(i.paid)} applied against a total of ${money(i.total_paise)}.`);
        for (const s of stuck) problem(`Invoice ${s.number} is cancelled but still has payments applied to it.`);
      }),
    );
  }

  // 6. Customers, suppliers and weavers: each running statement ends on the balance their page shows.
  {
    const customers = listCustomers(db);
    const suppliers = listSuppliers(db);
    const weavers = listWeavers(db);
    checks.push(
      check('balances', 'Customer, supplier and weaver balances agree with their statements', customers.length + suppliers.length + weavers.length, (problem) => {
        for (const c of customers) {
          const ledger = customerLedger(db, c.id);
          const last = ledger.entries.at(-1)?.balancePaise ?? 0;
          if (ledger.balancePaise !== c.outstandingPaise - c.advancePaise || last !== ledger.balancePaise) problem(`Customer ${c.name}: the statement ends at ${money(last)} but they are shown as ${money(c.outstandingPaise - c.advancePaise)}.`);
        }
        for (const s of suppliers) {
          const ledger = supplierLedger(db, s.id);
          const last = ledger.entries.at(-1)?.balancePaise ?? 0;
          if (ledger.balancePaise !== s.outstandingPaise - s.advancePaise || last !== ledger.balancePaise) problem(`Supplier ${s.name}: the statement ends at ${money(last)} but you are shown as owing ${money(s.outstandingPaise - s.advancePaise)}.`);
        }
        for (const w of weavers) {
          const last = weaverLedger(db, w.id).entries.at(-1)?.balancePaise ?? 0;
          if (last !== w.balancePaise) problem(`Weaver ${w.name}: the statement ends at ${money(last)} but the balance is ${money(w.balancePaise)}.`);
        }
      }),
    );
  }

  // 7. Credit notes never return more than was sold or credit more than the invoice was for.
  {
    const lines = all<{ number: string; sku: string; qty: number; credited: number }>(
      db,
      `SELECT i.number, l.sku, l.qty, COALESCE((SELECT SUM(cl.qty) FROM credit_note_lines cl JOIN credit_notes c ON c.id = cl.credit_note_id WHERE cl.invoice_line_id = l.id AND c.status = 'issued'), 0) AS credited FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id`,
    );
    const invoices = all<{ number: string; total_paise: number; credited: number }>(db, `SELECT i.number, i.total_paise, COALESCE((SELECT SUM(c.total_paise) FROM credit_notes c WHERE c.invoice_id = i.id AND c.status = 'issued'), 0) AS credited FROM invoices i`);
    checks.push(
      check('credit-notes', 'Credit notes stay within what was sold', lines.length, (problem) => {
        for (const l of lines) if (l.credited > l.qty) problem(`Invoice ${l.number}: ${l.credited} of ${l.sku} returned but only ${l.qty} sold.`);
        // A rupee of slack: totals are rounded to the rupee, so credits summing to a fully credited invoice can differ by that much.
        for (const i of invoices) if (i.credited > i.total_paise + 100) problem(`Invoice ${i.number}: credit notes total ${money(i.credited)} against an invoice of ${money(i.total_paise)}.`);
      }),
    );
  }

  // 8. Purchase bills and supplier payments.
  {
    const bills = all<{ bill_number: string; total_paise: number; paid: number }>(
      db,
      `SELECT b.bill_number, b.total_paise, COALESCE((SELECT SUM(a.amount_paise) FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id = a.payment_id WHERE a.bill_id = b.id AND a.released_at IS NULL AND p.voided_at IS NULL), 0) AS paid FROM purchase_bills b`,
    );
    const payments = all<{ amount_paise: number; applied: number; reference: string }>(db, `SELECT p.amount_paise, p.reference, COALESCE((SELECT SUM(a.amount_paise) FROM supplier_payment_allocations a WHERE a.payment_id = p.id AND a.released_at IS NULL), 0) AS applied FROM supplier_payments p WHERE p.voided_at IS NULL`);
    checks.push(
      check('purchases', 'Supplier bills and payments are applied correctly', bills.length + payments.length, (problem) => {
        for (const b of bills) if (b.paid > b.total_paise) problem(`Bill ${b.bill_number}: ${money(b.paid)} paid against a total of ${money(b.total_paise)}.`);
        for (const p of payments) if (p.applied > p.amount_paise) problem(`A payment of ${money(p.amount_paise)} (${p.reference || 'no reference'}) has ${money(p.applied)} applied to bills.`);
      }),
    );
  }

  // 9. The activity log's own chain.
  {
    const chain = verifyAuditChain(db);
    checks.push(check('audit', 'The activity log has not been tampered with', chain.checked, (problem) => chain.problems.forEach(problem)));
  }

  return { ranAt: nowIso(), checks, problemCount: checks.reduce((s, c) => s + c.problemCount, 0) };
}
