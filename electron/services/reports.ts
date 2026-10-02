import { allocate, isIsoDate, todayIso } from '../../shared/gst';
import { bucketKeys, bucketOf, granularityFor } from '../../shared/periods';
import type { GstReport, GstTotals, InvoiceType, PaymentMethod, SalesReport, StockReport } from '../../shared/types';
import { all, type Db } from '../db/connection';
import { UserError } from './common';
import { listDesigns, loadVariants } from './inventory';
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
    `SELECT l.invoice_id, v.design_id, l.design_name, l.color, l.size, l.hsn, l.qty, l.amount_paise, l.unit_cost_paise
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
    const taxable = allocate(row.taxable_paise, lines.map((l) => l.amount_paise));
    const cgst = allocate(row.cgst_paise, taxable);
    const sgst = allocate(row.sgst_paise, taxable);
    const igst = allocate(row.igst_paise, taxable);
    const buyer = JSON.parse(row.buyer_json) as { name: string; gstin: string };
    return {
      row,
      buyerName: buyer.name,
      buyerGstin: buyer.gstin,
      lines: lines.map((l, i): LineShare => ({ designId: l.design_id, designName: l.design_name, color: l.color, size: l.size, hsn: l.hsn, qty: l.qty, taxable: taxable[i]!, cgst: cgst[i]!, sgst: sgst[i]!, igst: igst[i]!, cost: l.qty * l.unit_cost_paise })),
    };
  });
}

const sum = <T>(items: T[], f: (t: T) => number): number => items.reduce((s, t) => s + f(t), 0);

// ── Sales ───────────────────────────────────────────────────────────────────
export function salesReport(db: Db, range: { from: string; to: string }): SalesReport {
  checkRange(range);
  const invoices = loadInvoices(db, range);
  const paid = loadPaid(db);
  const granularity = granularityFor(range);

  const lines = invoices.flatMap((i) => i.lines);
  const taxablePaise = sum(invoices, (i) => i.row.taxable_paise);
  const cost = sum(lines, (l) => l.cost);
  const grossProfitPaise = taxablePaise - cost;

  const cancelled = all<{ n: number; s: number }>(db, "SELECT COUNT(*) AS n, COALESCE(SUM(total_paise), 0) AS s FROM invoices WHERE status = 'cancelled' AND issue_date BETWEEN ? AND ?", range.from, range.to)[0]!;

  // Payments are measured by the day the money arrived — independent of which invoice (or advance) they went to.
  const payments = all<{ received_on: string; method: PaymentMethod; amount_paise: number }>(
    db,
    "SELECT received_on, method, amount_paise FROM payments WHERE voided_at IS NULL AND kind = 'receipt' AND received_on BETWEEN ? AND ?",
    range.from,
    range.to,
  );

  const series = new Map(bucketKeys(range, granularity).map((key) => [key, { key, invoicedPaise: 0, collectedPaise: 0, invoices: 0 }]));
  for (const i of invoices) {
    const point = series.get(bucketOf(i.row.issue_date, granularity))!;
    point.invoicedPaise += i.row.total_paise;
    point.invoices += 1;
  }
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

  const customers = new Map<string, { customerId: string | null; name: string; invoices: number; invoicedPaise: number }>();
  for (const i of invoices) {
    const key = i.row.customer_id ?? 'walk-in';
    const c = customers.get(key) ?? { customerId: i.row.customer_id, name: i.row.customer_id ? i.buyerName : 'Walk-in customers', invoices: 0, invoicedPaise: 0 };
    c.invoices += 1;
    c.invoicedPaise += i.row.total_paise;
    customers.set(key, c);
  }

  const types = (['B2B', 'B2C'] as const).map((type) => {
    const of = invoices.filter((i) => i.row.type === type);
    return { type, invoices: of.length, invoicedPaise: sum(of, (i) => i.row.total_paise) };
  });

  return {
    range,
    invoicedPaise: sum(invoices, (i) => i.row.total_paise),
    taxablePaise,
    gstPaise: sum(invoices, (i) => i.row.cgst_paise + i.row.sgst_paise + i.row.igst_paise),
    invoiceCount: invoices.length,
    piecesSold: sum(lines, (l) => l.qty),
    cancelledCount: cancelled.n,
    cancelledPaise: cancelled.s,
    collectedPaise: sum(payments, (p) => p.amount_paise),
    paymentCount: payments.length,
    stillUnpaidPaise: sum(invoices, (i) => i.row.total_paise - (paid.get(i.row.id) ?? 0)),
    grossProfitPaise,
    marginPercent: taxablePaise > 0 ? (grossProfitPaise / taxablePaise) * 100 : null,
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

  const states = new Map<string, GstReport['b2cByState'][number]>();
  for (const i of invoices.filter((x) => x.row.type === 'B2C')) {
    const key = `${i.row.place_of_supply}|${i.row.gst_rate_percent}`;
    const s = states.get(key) ?? { placeOfSupply: i.row.place_of_supply, ratePercent: i.row.gst_rate_percent, invoices: 0, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
    s.invoices += 1;
    s.taxablePaise += i.row.taxable_paise;
    s.cgstPaise += i.row.cgst_paise;
    s.sgstPaise += i.row.sgst_paise;
    s.igstPaise += i.row.igst_paise;
    states.set(key, s);
  }

  const cancelled = all<{ n: number }>(db, "SELECT COUNT(*) AS n FROM invoices WHERE status = 'cancelled' AND issue_date BETWEEN ? AND ?", range.from, range.to)[0]!.n;

  return {
    range,
    totals,
    b2b,
    b2c,
    hsn: [...hsn.values()].sort((a, b) => b.taxablePaise - a.taxablePaise),
    b2bRegister: invoices
      .filter((i) => i.row.type === 'B2B')
      .map((i) => ({
        invoiceId: i.row.id,
        number: i.row.number,
        date: i.row.issue_date,
        customer: i.buyerName,
        gstin: i.buyerGstin,
        placeOfSupply: i.row.place_of_supply,
        ratePercent: i.row.gst_rate_percent,
        taxablePaise: i.row.taxable_paise,
        cgstPaise: i.row.cgst_paise,
        sgstPaise: i.row.sgst_paise,
        igstPaise: i.row.igst_paise,
        totalPaise: i.row.total_paise,
      })),
    b2cByState: [...states.values()].sort((a, b) => b.taxablePaise - a.taxablePaise),
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
