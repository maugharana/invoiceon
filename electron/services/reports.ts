import { allocate, isIsoDate, splitTax, todayIso, type RateGroup } from '../../shared/gst';
import { bucketKeys, bucketOf, granularityFor } from '../../shared/periods';
import type { GstReport, GstTotals, InvoiceType, PaymentMethod, SalesReport, StockReport } from '../../shared/types';
import { all, type Db } from '../db/connection';
import { UserError } from './common';
import { listDesigns, loadVariants } from './inventory';
import { taxByRate } from './invoices';
import { loadPaid } from './payments';

// ── Shared loading ──────────────────────────────────────────────────────────
interface InvoiceRow {
  id: string;
  number: string;
  seq: number;
  type: InvoiceType;
  customer_id: string | null;
  buyer_json: string;
  place_of_supply: string;
  issue_date: string;
  gst_rate_percent: number;
  intra_state: number;
  subtotal_paise: number;
  discount_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
}

interface LineRow {
  invoice_id: string;
  design_id: string | null;
  design_name: string;
  color: string;
  size: string;
  hsn: string;
  qty: number;
  amount_paise: number;
  unit_cost_paise: number;
  gst_rate_percent: number | null;
  taxable_paise: number | null;
  tax_paise: number | null;
}

/** One line of an issued invoice with its share of the invoice's discount and tax worked out. */
export interface LineShare {
  designId: string | null;
  designName: string;
  color: string;
  size: string;
  hsn: string;
  qty: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  cost: number;
}

export interface LoadedInvoice {
  row: InvoiceRow;
  buyerName: string;
  buyerGstin: string;
  lines: LineShare[];
  /** The invoice's tax by rate, lowest first (one entry for an invoice with a single rate). */
  groups: RateGroup[];
}

export function checkRange(range: { from: string; to: string }): void {
  if (!isIsoDate(range?.from) || !isIsoDate(range?.to)) throw new UserError('Choose a valid date range.');
  if (range.from > range.to) throw new UserError('The start date is after the end date.');
}

/**
 * Issued invoices dated in the range, each with its lines. An invoice-level discount and the tax are spread over the lines
 * in proportion to their value, to the exact paisa (see allocate), so anything summed from lines equals the invoice's own figures.
 */
export function loadInvoices(db: Db, range: { from: string; to: string }): LoadedInvoice[] {
  const rows = all<InvoiceRow>(db, "SELECT * FROM invoices WHERE status = 'issued' AND issue_date BETWEEN ? AND ? ORDER BY issue_date, seq", range.from, range.to);
  if (rows.length === 0) return [];
  const lineRows = all<LineRow>(
    db,
    `SELECT l.invoice_id, v.design_id, l.design_name, l.color, l.size, l.hsn, l.qty, l.amount_paise, l.unit_cost_paise, l.gst_rate_percent, l.taxable_paise, l.tax_paise
     FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id LEFT JOIN variants v ON v.id = l.variant_id
     WHERE i.status = 'issued' AND i.issue_date BETWEEN ? AND ? ORDER BY l.position`,
    range.from,
    range.to,
  );
  const byInvoice = new Map<string, LineRow[]>();
  for (const l of lineRows) {
    const list = byInvoice.get(l.invoice_id);
    if (list) list.push(l);
    else byInvoice.set(l.invoice_id, [l]);
  }

  return rows.map((row) => {
    const lines = byInvoice.get(row.id) ?? [];
    const groups = taxByRate(row, lines);
    let taxable: number[];
    let cgst: number[];
    let sgst: number[];
    let igst: number[];
    if (lines.length > 0 && lines.every((l) => l.taxable_paise !== null && l.tax_paise !== null)) {
      // Made after lines kept their own figures: each line's taxable value is stored, and each rate's tax is shared over its own lines.
      taxable = lines.map((l) => l.taxable_paise!);
      cgst = lines.map(() => 0);
      sgst = lines.map(() => 0);
      igst = lines.map(() => 0);
      for (const g of groups) {
        const idx = lines.map((l, k) => ((l.gst_rate_percent ?? row.gst_rate_percent) === g.ratePercent ? k : -1)).filter((k) => k >= 0);
        const weights = idx.map((k) => taxable[k]!);
        const c = allocate(g.cgstPaise, weights);
        const s = allocate(g.sgstPaise, weights);
        const ig = allocate(g.igstPaise, weights);
        idx.forEach((k, n) => {
          cgst[k] = c[n]!;
          sgst[k] = s[n]!;
          igst[k] = ig[n]!;
        });
      }
    } else {
      // Older invoices have one rate and no line discounts, so the invoice's figures are shared by line value, as they always were.
      taxable = allocate(row.taxable_paise, lines.map((l) => l.amount_paise));
      cgst = allocate(row.cgst_paise, taxable);
      sgst = allocate(row.sgst_paise, taxable);
      igst = allocate(row.igst_paise, taxable);
    }
    const buyer = JSON.parse(row.buyer_json) as { name: string; gstin: string };
    return {
      row,
      buyerName: buyer.name,
      buyerGstin: buyer.gstin,
      groups,
      lines: lines.map((l, i): LineShare => ({ designId: l.design_id, designName: l.design_name, color: l.color, size: l.size, hsn: l.hsn, qty: l.qty, taxable: taxable[i]!, cgst: cgst[i]!, sgst: sgst[i]!, igst: igst[i]!, cost: l.qty * l.unit_cost_paise })),
    };
  });
}

/** A credit note in a report: its figures, each line's share of the tax, and what it was worth to the books. */
export interface LoadedCredit {
  id: string;
  number: string;
  invoiceNumber: string;
  date: string;
  type: InvoiceType;
  customerId: string | null;
  buyerName: string;
  buyerGstin: string;
  placeOfSupply: string;
  intra: boolean;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  groups: RateGroup[];
  lines: (LineShare & { rate: number; restocked: boolean })[];
}

/** Credit notes dated in the range. Their tax is shared over their lines by rate, exactly as for invoices. */
export function loadCredits(db: Db, range: { from: string; to: string }): LoadedCredit[] {
  const notes = all<{
    id: string; number: string; invoice_number: string; issue_date: string; type: InvoiceType; customer_id: string | null; buyer_json: string; place_of_supply: string; intra_state: number;
    taxable_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number; total_paise: number;
  }>(db, 'SELECT n.*, i.number AS invoice_number FROM credit_notes n JOIN invoices i ON i.id = n.invoice_id WHERE n.issue_date BETWEEN ? AND ? ORDER BY n.issue_date, n.seq', range.from, range.to);
  if (notes.length === 0) return [];
  const lineRows = all<{ credit_note_id: string; design_id: string | null; design_name: string; color: string; size: string; hsn: string; qty: number; gst_rate_percent: number; taxable_paise: number; tax_paise: number; restocked: number; unit_cost_paise: number }>(
    db,
    `SELECT l.credit_note_id, v.design_id, l.design_name, l.color, l.size, l.hsn, l.qty, l.gst_rate_percent, l.taxable_paise, l.tax_paise, l.restocked, l.unit_cost_paise
     FROM credit_note_lines l JOIN credit_notes n ON n.id = l.credit_note_id LEFT JOIN variants v ON v.id = l.variant_id
     WHERE n.issue_date BETWEEN ? AND ? ORDER BY l.position`,
    range.from,
    range.to,
  );
  return notes.map((n) => {
    const mine = lineRows.filter((l) => l.credit_note_id === n.id);
    const intra = n.intra_state === 1;
    const byRate = new Map<number, { taxable: number; tax: number }>();
    for (const l of mine) {
      const g = byRate.get(l.gst_rate_percent) ?? { taxable: 0, tax: 0 };
      g.taxable += l.taxable_paise;
      g.tax += l.tax_paise;
      byRate.set(l.gst_rate_percent, g);
    }
    const groups: RateGroup[] = [...byRate.entries()].sort(([a], [b]) => a - b).map(([ratePercent, g]) => ({ ratePercent, taxablePaise: g.taxable, taxPaise: g.tax, ...splitTax(g.tax, intra) }));
    const cgst = mine.map(() => 0);
    const sgst = mine.map(() => 0);
    const igst = mine.map(() => 0);
    for (const g of groups) {
      const idx = mine.map((l, k) => (l.gst_rate_percent === g.ratePercent ? k : -1)).filter((k) => k >= 0);
      const weights = idx.map((k) => mine[k]!.taxable_paise);
      const c = allocate(g.cgstPaise, weights);
      const s = allocate(g.sgstPaise, weights);
      const ig = allocate(g.igstPaise, weights);
      idx.forEach((k, m) => {
        cgst[k] = c[m]!;
        sgst[k] = s[m]!;
        igst[k] = ig[m]!;
      });
    }
    const buyer = JSON.parse(n.buyer_json) as { name: string; gstin: string };
    return {
      id: n.id,
      number: n.number,
      invoiceNumber: n.invoice_number,
      date: n.issue_date,
      type: n.type,
      customerId: n.customer_id,
      buyerName: buyer.name,
      buyerGstin: buyer.gstin,
      placeOfSupply: n.place_of_supply,
      intra: n.intra_state === 1,
      taxable: n.taxable_paise,
      cgst: n.cgst_paise,
      sgst: n.sgst_paise,
      igst: n.igst_paise,
      total: n.total_paise,
      groups,
      lines: mine.map((l, k) => ({
        designId: l.design_id,
        designName: l.design_name,
        color: l.color,
        size: l.size,
        hsn: l.hsn,
        qty: l.qty,
        taxable: l.taxable_paise,
        cgst: cgst[k]!,
        sgst: sgst[k]!,
        igst: igst[k]!,
        // Pieces that went back on the shelf are no longer a cost of the sale; damaged ones still are.
        cost: l.restocked === 1 ? l.qty * l.unit_cost_paise : 0,
        rate: l.gst_rate_percent,
        restocked: l.restocked === 1,
      })),
    };
  });
}

const sum = <T>(items: T[], f: (t: T) => number): number => items.reduce((s, t) => s + f(t), 0);

// ── Credit notes ────────────────────────────────────────────────────────────
interface CreditRow {
  id: string;
  number: string;
  issue_date: string;
  invoice_number: string;
  invoice_date: string;
  invoice_type: InvoiceType;
  buyer_json: string;
  place_of_supply: string;
  intra_state: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
}

/** Credit notes dated in the period that stand (cancelled ones are left out), as the GST and sales reports count them. */
function loadCreditNotes(db: Db, range: { from: string; to: string }): CreditRow[] {
  return all<CreditRow>(
    db,
    `SELECT n.id, n.number, n.issue_date, i.number AS invoice_number, i.issue_date AS invoice_date, i.type AS invoice_type, n.buyer_json, n.place_of_supply, n.intra_state,
       n.taxable_paise, n.cgst_paise, n.sgst_paise, n.igst_paise, n.total_paise
     FROM credit_notes n JOIN invoices i ON i.id = n.invoice_id WHERE n.status = 'issued' AND n.issue_date BETWEEN ? AND ? ORDER BY n.issue_date, n.seq`,
    range.from,
    range.to,
  );
}

/**
 * What goods taken back do to profit in the period. The taxable value comes off sales. Pieces that went back on the shelf also give their
 * cost back (they will be sold again), so only the profit on them is lost; damaged pieces that did not go back keep their cost.
 */
function profitTakenBack(db: Db, range: { from: string; to: string }): number {
  return (
    all<{ taxable: number; cost: number; restocked: number }>(
      db,
      `SELECT l.taxable_paise AS taxable, l.qty * il.unit_cost_paise AS cost, l.restocked
       FROM credit_note_lines l JOIN credit_notes n ON n.id = l.credit_note_id JOIN invoice_lines il ON il.id = l.invoice_line_id
       WHERE n.status = 'issued' AND n.issue_date BETWEEN ? AND ?`,
      range.from,
      range.to,
    ).reduce((s, l) => s + l.taxable - (l.restocked ? l.cost : 0), 0)
  );
}

// ── Sales ───────────────────────────────────────────────────────────────────
export function salesReport(db: Db, range: { from: string; to: string }): SalesReport {
  checkRange(range);
  const invoices = loadInvoices(db, range);
  const paid = loadPaid(db);
  const granularity = granularityFor(range);

  const credits = loadCredits(db, range);
  const lines = invoices.flatMap((i) => i.lines);
  const taxablePaise = sum(invoices, (i) => i.row.taxable_paise);
  const cost = sum(lines, (l) => l.cost);
  const notes = loadCreditNotes(db, range);
  const creditedPaise = sum(notes, (n) => n.total_paise);
  const creditedTaxablePaise = sum(notes, (n) => n.taxable_paise);
  const grossProfitPaise = taxablePaise - cost - profitTakenBack(db, range);

  const cancelled = all<{ n: number; s: number }>(db, "SELECT COUNT(*) AS n, COALESCE(SUM(total_paise), 0) AS s FROM invoices WHERE status = 'cancelled' AND issue_date BETWEEN ? AND ?", range.from, range.to)[0]!;

  // Payments are measured by the day the money arrived — independent of which invoice (or advance) they went to.
  const payments = all<{ received_on: string; method: PaymentMethod; amount_paise: number }>(
    db,
    "SELECT received_on, method, CASE WHEN kind = 'refund' THEN -amount_paise ELSE amount_paise END AS amount_paise FROM payments WHERE voided_at IS NULL AND kind IN ('receipt', 'refund') AND received_on BETWEEN ? AND ?",
    range.from,
    range.to,
  );

  const series = new Map(bucketKeys(range, granularity).map((key) => [key, { key, invoicedPaise: 0, collectedPaise: 0, invoices: 0 }]));
  for (const i of invoices) {
    const point = series.get(bucketOf(i.row.issue_date, granularity))!;
    point.invoicedPaise += i.row.total_paise;
    point.invoices += 1;
  }
  for (const c of credits) series.get(bucketOf(c.date, granularity))!.invoicedPaise -= c.total;
  for (const p of payments) series.get(bucketOf(p.received_on, granularity))!.collectedPaise += p.amount_paise;

  const methods = new Map<PaymentMethod, { count: number; paise: number }>();
  for (const p of payments) {
    const m = methods.get(p.method) ?? { count: 0, paise: 0 };
    m.count += 1;
    m.paise += p.amount_paise;
    methods.set(p.method, m);
  }

  const designs = new Map<string, { designId: string; name: string; pieces: number; revenuePaise: number; profitPaise: number }>();
  for (const l of lines) {
    const key = l.designId ?? l.designName;
    const d = designs.get(key) ?? { designId: l.designId ?? '', name: l.designName, pieces: 0, revenuePaise: 0, profitPaise: 0 };
    d.pieces += l.qty;
    d.revenuePaise += l.taxable;
    d.profitPaise += l.taxable - l.cost;
    designs.set(key, d);
  }
  for (const l of creditLines) {
    const key = l.designId ?? l.designName;
    const d = designs.get(key) ?? { designId: l.designId ?? '', name: l.designName, pieces: 0, revenuePaise: 0, profitPaise: 0 };
    d.pieces -= l.qty;
    d.revenuePaise -= l.taxable;
    d.profitPaise -= l.taxable - l.cost;
    designs.set(key, d);
  }

  const customers = new Map<string, { customerId: string | null; name: string; invoices: number; invoicedPaise: number }>();
  for (const i of invoices) {
    const key = i.row.customer_id ?? 'walk-in';
    const c = customers.get(key) ?? { customerId: i.row.customer_id, name: i.row.customer_id ? i.buyerName : 'Walk-in customers', invoices: 0, invoicedPaise: 0 };
    c.invoices += 1;
    c.invoicedPaise += i.row.total_paise;
    customers.set(key, c);
  }
  for (const n of credits) {
    const key = n.customerId ?? 'walk-in';
    const c = customers.get(key) ?? { customerId: n.customerId, name: n.customerId ? n.buyerName : 'Walk-in customers', invoices: 0, invoicedPaise: 0 };
    c.invoicedPaise -= n.total;
    customers.set(key, c);
  }

  const types = (['B2B', 'B2C'] as const).map((type) => {
    const of = invoices.filter((i) => i.row.type === type);
    return { type, invoices: of.length, invoicedPaise: sum(of, (i) => i.row.total_paise) - sum(credits.filter((c) => c.type === type), (c) => c.total) };
  });

  return {
    range,
    invoicedPaise: sum(invoices, (i) => i.row.total_paise) - sum(credits, (c) => c.total),
    creditNoteCount: credits.length,
    creditNotePaise: sum(credits, (c) => c.total),
    taxablePaise,
    gstPaise: sum(invoices, (i) => i.row.cgst_paise + i.row.sgst_paise + i.row.igst_paise) - sum(credits, (c) => c.cgst + c.sgst + c.igst),
    invoiceCount: invoices.length,
    piecesSold: sum(lines, (l) => l.qty) - sum(creditLines, (l) => l.qty),
    cancelledCount: cancelled.n,
    cancelledPaise: cancelled.s,
    collectedPaise: sum(payments, (p) => p.amount_paise),
    paymentCount: payments.length,
    stillUnpaidPaise: sum(invoices, (i) => i.row.total_paise - (paid.get(i.row.id) ?? 0)),
    creditNoteCount: notes.length,
    creditedPaise,
    creditedTaxablePaise,
    netInvoicedPaise: sum(invoices, (i) => i.row.total_paise) - creditedPaise,
    grossProfitPaise,
    marginPercent: taxablePaise - creditedTaxablePaise > 0 ? (grossProfitPaise / (taxablePaise - creditedTaxablePaise)) * 100 : null,
    granularity,
    series: [...series.values()],
    byType: types,
    byMethod: [...methods.entries()].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.paise - a.paise),
    topDesigns: [...designs.values()].sort((a, b) => b.revenuePaise - a.revenuePaise).slice(0, 10),
    topCustomers: [...customers.values()].sort((a, b) => b.invoicedPaise - a.invoicedPaise).slice(0, 10),
  };
}

// ── GST ─────────────────────────────────────────────────────────────────────
const emptyTotals = (): GstTotals => ({ invoices: 0, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, taxPaise: 0, invoiceValuePaise: 0 });

function addInvoice(t: GstTotals, r: InvoiceRow): void {
  t.invoices += 1;
  t.taxablePaise += r.taxable_paise;
  t.cgstPaise += r.cgst_paise;
  t.sgstPaise += r.sgst_paise;
  t.igstPaise += r.igst_paise;
  t.taxPaise += r.cgst_paise + r.sgst_paise + r.igst_paise;
  t.invoiceValuePaise += r.total_paise;
}

/** GST is due on the invoice date, so this is by invoice date, not by when the customer paid. */
export function gstReport(db: Db, range: { from: string; to: string }): GstReport {
  checkRange(range);
  const invoices = loadInvoices(db, range);
  const totals = emptyTotals();
  const b2b = emptyTotals();
  const b2c = emptyTotals();
  for (const i of invoices) {
    addInvoice(totals, i.row);
    addInvoice(i.row.type === 'B2B' ? b2b : b2c, i.row);
  }
  // Credit notes dated in the period come off the tax due. The totals here are net; `credits` is what came off.
  const credits = loadCredits(db, range);
  const creditTotals = { count: credits.length, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, taxPaise: 0, valuePaise: 0 };
  for (const c of credits) {
    for (const t of [totals, c.type === 'B2B' ? b2b : b2c]) {
      t.taxablePaise -= c.taxable;
      t.cgstPaise -= c.cgst;
      t.sgstPaise -= c.sgst;
      t.igstPaise -= c.igst;
      t.taxPaise -= c.cgst + c.sgst + c.igst;
      t.invoiceValuePaise -= c.total;
    }
    creditTotals.taxablePaise += c.taxable;
    creditTotals.cgstPaise += c.cgst;
    creditTotals.sgstPaise += c.sgst;
    creditTotals.igstPaise += c.igst;
    creditTotals.taxPaise += c.cgst + c.sgst + c.igst;
    creditTotals.valuePaise += c.total;
  }

  const hsn = new Map<string, GstReport['hsn'][number]>();
  for (const l of invoices.flatMap((i) => i.lines)) {
    const key = l.hsn || '—';
    const h = hsn.get(key) ?? { hsn: key, qty: 0, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, taxPaise: 0 };
    h.qty += l.qty;
    h.taxablePaise += l.taxable;
    h.cgstPaise += l.cgst;
    h.sgstPaise += l.sgst;
    h.igstPaise += l.igst;
    h.taxPaise += l.cgst + l.sgst + l.igst;
    hsn.set(key, h);
  }

  for (const l of credits.flatMap((c) => c.lines)) {
    const key = l.hsn || '—';
    const h = hsn.get(key) ?? { hsn: key, qty: 0, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, taxPaise: 0 };
    h.qty -= l.qty;
    h.taxablePaise -= l.taxable;
    h.cgstPaise -= l.cgst;
    h.sgstPaise -= l.sgst;
    h.igstPaise -= l.igst;
    h.taxPaise -= l.cgst + l.sgst + l.igst;
    hsn.set(key, h);
  }

  const states = new Map<string, GstReport['b2cByState'][number]>();
  for (const i of invoices.filter((x) => x.row.type === 'B2C')) {
    // An invoice with two rates appears under both, with each rate's own share.
    for (const g of i.groups) {
      const key = `${i.row.place_of_supply}|${g.ratePercent}`;
      const s = states.get(key) ?? { placeOfSupply: i.row.place_of_supply, ratePercent: g.ratePercent, invoices: 0, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
      s.invoices += 1;
      s.taxablePaise += g.taxablePaise;
      s.cgstPaise += g.cgstPaise;
      s.sgstPaise += g.sgstPaise;
      s.igstPaise += g.igstPaise;
      states.set(key, s);
    }
  }

  for (const c of credits.filter((x) => x.type === 'B2C')) {
    for (const g of c.groups) {
      const key = `${c.placeOfSupply}|${g.ratePercent}`;
      const s = states.get(key) ?? { placeOfSupply: c.placeOfSupply, ratePercent: g.ratePercent, invoices: 0, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
      s.taxablePaise -= g.taxablePaise;
      s.cgstPaise -= g.cgstPaise;
      s.sgstPaise -= g.sgstPaise;
      s.igstPaise -= g.igstPaise;
      states.set(key, s);
    }
  }

  const cancelled = all<{ n: number }>(db, "SELECT COUNT(*) AS n FROM invoices WHERE status = 'cancelled' AND issue_date BETWEEN ? AND ?", range.from, range.to)[0]!.n;

  // Credit notes: what came off, and the register a return needs (a row for each rate on a note).
  const notes = loadCreditNotes(db, range);
  const credit = emptyTotals();
  for (const n of notes) {
    credit.invoices += 1;
    credit.taxablePaise += n.taxable_paise;
    credit.cgstPaise += n.cgst_paise;
    credit.sgstPaise += n.sgst_paise;
    credit.igstPaise += n.igst_paise;
    credit.taxPaise += n.cgst_paise + n.sgst_paise + n.igst_paise;
    credit.invoiceValuePaise += n.total_paise;
  }
  const net = emptyTotals();
  for (const k of ['invoices', 'taxablePaise', 'cgstPaise', 'sgstPaise', 'igstPaise', 'taxPaise', 'invoiceValuePaise'] as const) net[k] = totals[k] - credit[k];
  const rates = all<{ credit_note_id: string; rate: number; taxable: number; tax: number }>(
    db,
    `SELECT l.credit_note_id, l.gst_rate_percent AS rate, SUM(l.taxable_paise) AS taxable, SUM(l.tax_paise) AS tax FROM credit_note_lines l GROUP BY l.credit_note_id, l.gst_rate_percent ORDER BY l.gst_rate_percent`,
  );
  const creditRegister = notes.flatMap((n) =>
    rates
      .filter((r) => r.credit_note_id === n.id)
      .map((r, i) => ({
        creditNoteId: n.id,
        number: n.number,
        date: n.issue_date,
        invoiceNumber: n.invoice_number,
        invoiceDate: n.invoice_date,
        customer: (JSON.parse(n.buyer_json) as { name: string }).name,
        gstin: (JSON.parse(n.buyer_json) as { gstin: string }).gstin ?? '',
        type: n.invoice_type,
        placeOfSupply: n.place_of_supply,
        ratePercent: r.rate,
        taxablePaise: r.taxable,
        ...splitTax(r.tax, n.intra_state === 1),
        totalPaise: i === 0 ? n.total_paise : 0,
      })),
  );

  return {
    range,
    totals,
    b2b,
    b2c,
    hsn: [...hsn.values()].sort((a, b) => b.taxablePaise - a.taxablePaise),
    b2bRegister: invoices
      .filter((i) => i.row.type === 'B2B')
      // One row for each rate on an invoice. The invoice's total sits on its first row only, so a column adds up correctly.
      .flatMap((i) =>
        i.groups.map((g, n) => ({
          invoiceId: i.row.id,
          number: i.row.number,
          date: i.row.issue_date,
          customer: i.buyerName,
          gstin: i.buyerGstin,
          placeOfSupply: i.row.place_of_supply,
          ratePercent: g.ratePercent,
          taxablePaise: g.taxablePaise,
          cgstPaise: g.cgstPaise,
          sgstPaise: g.sgstPaise,
          igstPaise: g.igstPaise,
          totalPaise: n === 0 ? i.row.total_paise : 0,
        })),
      ),
    b2cByState: [...states.values()].sort((a, b) => b.taxablePaise - a.taxablePaise),
    creditNotes: credit,
    netTotals: net,
    creditRegister,
    cancelledCount: cancelled,
  };
}

// ── Stock valuation ─────────────────────────────────────────────────────────
/**
 * Stock on hand valued at cost (and, for comparison, at selling price). For a past date the quantities are rebuilt from the
 * stock ledger; the value uses each variant's *current* cost, because past cost isn't kept per date — the report says so.
 */
export function stockReport(db: Db, asOf: string = todayIso()): StockReport {
  if (!isIsoDate(asOf)) throw new UserError('Choose a valid date.');
  if (asOf > todayIso()) throw new UserError('Stock can only be valued as of today or an earlier date.');

  // The end of that local day, as the UTC timestamp the ledger stores.
  const [y, m, d] = asOf.split('-').map(Number) as [number, number, number];
  const endOfDay = new Date(y, m - 1, d + 1).toISOString();
  const historic = asOf < todayIso();
  const movedTo = new Map(all<{ variant_id: string; q: number }>(db, 'SELECT variant_id, SUM(delta) AS q FROM stock_movements WHERE created_at < ? GROUP BY variant_id', endOfDay).map((r) => [r.variant_id, r.q]));
  const lastSold = new Map(
    all<{ variant_id: string; d: string }>(db, "SELECT l.variant_id, MAX(i.issue_date) AS d FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE i.status = 'issued' AND i.issue_date <= ? GROUP BY l.variant_id", asOf).map((r) => [r.variant_id, r.d]),
  );

  const variantsByDesign = new Map<string, ReturnType<typeof loadVariants>>();
  for (const v of loadVariants(db)) {
    const list = variantsByDesign.get(v.designId);
    if (list) list.push(v);
    else variantsByDesign.set(v.designId, [v]);
  }

  const rows = listDesigns(db)
    .map((design) => {
      const variants = (variantsByDesign.get(design.id) ?? []).map((v) => {
        const pieces = historic ? (movedTo.get(v.id) ?? 0) : v.stock;
        return {
          variantId: v.id,
          sku: v.sku,
          color: v.color,
          size: v.size,
          pieces,
          unitCostPaise: v.unitCostPaise,
          sellPricePaise: v.sellPricePaise,
          costValuePaise: pieces * v.unitCostPaise,
          retailValuePaise: pieces * v.sellPricePaise,
          lastSoldOn: lastSold.get(v.id) ?? null,
        };
      });
      return { designId: design.id, code: design.code, name: design.name, fabric: design.fabric, pieces: sum(variants, (v) => v.pieces), costValuePaise: sum(variants, (v) => v.costValuePaise), retailValuePaise: sum(variants, (v) => v.retailValuePaise), variants };
    })
    .filter((d) => d.variants.length > 0)
    .sort((a, b) => b.costValuePaise - a.costValuePaise || a.name.localeCompare(b.name));

  const variants = rows.flatMap((r) => r.variants);
  return {
    asOf,
    pieces: sum(rows, (r) => r.pieces),
    costValuePaise: sum(rows, (r) => r.costValuePaise),
    retailValuePaise: sum(rows, (r) => r.retailValuePaise),
    designCount: rows.length,
    variantCount: variants.length,
    outOfStockVariants: variants.filter((v) => v.pieces <= 0).length,
    rows,
  };
}
