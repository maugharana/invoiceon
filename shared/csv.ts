import { INVOICE_STATUS_LABEL } from './gst';
import { STOCK_STATUS_LABEL } from './stock';
import type { AccountBook, Customer, DayBook, DesignSummary, PurchasesReport, QuotesReport, DuesReport, Expense, ExpensesBreakdown, MarginReport, MoversReport, ProfitAndLoss, StockMovementReport, StockMovementRow, GstReport, InvoiceSummary, Payment, ProformaSummary, SalesReport, StockReport } from './types';
import { PAYMENT_METHOD_LABEL, PROFORMA_STATUS_LABEL } from './types';

type Row = (string | number)[];

/** Quotes a cell when it needs it (commas, quotes, line breaks). */
const cell = (v: string | number): string => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Excel opens UTF-8 CSVs correctly only with a byte-order mark, and otherwise mangles ₹ and Indian names. */
export const toCsv = (rows: Row[]): string => `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;

/** Plain decimal rupees for spreadsheets ("1234.50"): no symbol and no digit grouping, so it sums and sorts. */
export const rs = (paise: number): string => (paise / 100).toFixed(2);

export function salesCsv(r: SalesReport): string {
  return toCsv([
    ['Sales report', `${r.range.from} to ${r.range.to}`],
    [],
    ['Invoiced (incl. GST)', rs(r.invoicedPaise)],
    ['Taxable value', rs(r.taxablePaise)],
    ['GST', rs(r.gstPaise)],
    ['Invoices', r.invoiceCount],
    ['Pieces sold', r.piecesSold],
    ['Collected (payments received)', rs(r.collectedPaise)],
    ['Gross profit (taxable value less cost)', rs(r.grossProfitPaise)],
    ['Still unpaid on these invoices', rs(r.stillUnpaidPaise)],
    [],
    [r.granularity === 'day' ? 'Date' : 'Month', 'Invoiced', 'Collected', 'Invoices'],
    ...r.series.map((p) => [p.key, rs(p.invoicedPaise), rs(p.collectedPaise), p.invoices]),
    [],
    ['Design', 'Pieces', 'Sales (excl. GST)', 'Gross profit'],
    ...r.topDesigns.map((d) => [d.name, d.pieces, rs(d.revenuePaise), rs(d.profitPaise)]),
    [],
    ['Customer', 'Invoices', 'Invoiced'],
    ...r.topCustomers.map((c) => [c.name, c.invoices, rs(c.invoicedPaise)]),
    [],
    ['Payment method', 'Payments', 'Collected'],
    ...r.byMethod.map((m) => [PAYMENT_METHOD_LABEL[m.method], m.count, rs(m.paise)]),
  ]);
}

// GST sections. Each builds its own rows so they can be exported alone or stacked into one file.
const b2bRows = (r: GstReport): Row[] => [
  ['GSTIN of buyer', 'Buyer name', 'Invoice number', 'Invoice date', 'Place of supply', 'GST rate %', 'Taxable value', 'CGST', 'SGST', 'IGST', 'Invoice value'],
  ...r.b2bRegister.map((i): Row => [i.gstin, i.customer, i.number, i.date, i.placeOfSupply, i.ratePercent, rs(i.taxablePaise), rs(i.cgstPaise), rs(i.sgstPaise), rs(i.igstPaise), rs(i.totalPaise)]),
];

const b2cRows = (r: GstReport): Row[] => [
  ['Place of supply', 'GST rate %', 'Invoices', 'Taxable value', 'CGST', 'SGST', 'IGST'],
  ...r.b2cByState.map((s): Row => [s.placeOfSupply, s.ratePercent, s.invoices, rs(s.taxablePaise), rs(s.cgstPaise), rs(s.sgstPaise), rs(s.igstPaise)]),
];

const hsnRows = (r: GstReport): Row[] => [
  ['HSN', 'Quantity', 'Taxable value', 'CGST', 'SGST', 'IGST', 'Total tax'],
  ...r.hsn.map((h): Row => [h.hsn, h.qty, rs(h.taxablePaise), rs(h.cgstPaise), rs(h.sgstPaise), rs(h.igstPaise), rs(h.taxPaise)]),
];

/** B2B invoice register, in the shape GSTR-1 asks for (invoice-wise, with the buyer's GSTIN). */
export const gstB2bCsv = (r: GstReport): string => toCsv(b2bRows(r));
/** B2C (retail) supplies rolled up by state and rate, as GSTR-1 wants them. */
export const gstB2cCsv = (r: GstReport): string => toCsv(b2cRows(r));
export const gstHsnCsv = (r: GstReport): string => toCsv(hsnRows(r));

/** One file with the totals and all three GST views stacked under headings. */
export const gstCsv = (r: GstReport): string =>
  toCsv([
    ['GST summary', `${r.range.from} to ${r.range.to}`],
    ['Taxable value', rs(r.totals.taxablePaise)],
    ['CGST', rs(r.totals.cgstPaise)],
    ['SGST', rs(r.totals.sgstPaise)],
    ['IGST', rs(r.totals.igstPaise)],
    ['Total tax', rs(r.totals.taxPaise)],
    [],
    ['B2B invoices'],
    ...b2bRows(r),
    [],
    ['B2C summary'],
    ...b2cRows(r),
    [],
    ['HSN summary'],
    ...hsnRows(r),
  ]);

export function stockCsv(r: StockReport): string {
  return toCsv([
    ['Stock valuation as of', r.asOf],
    [],
    ['Design code', 'Design', 'SKU', 'Color', 'Size', 'Pieces', 'Cost per piece', 'Selling price', 'Value at cost', 'Value at selling price', 'Last sold'],
    ...r.rows.flatMap((d) => d.variants.map((v): Row => [d.code, d.name, v.sku, v.color, v.size, v.pieces, rs(v.unitCostPaise), rs(v.sellPricePaise), rs(v.costValuePaise), rs(v.retailValuePaise), v.lastSoldOn ?? ''])),
    [],
    ['Total', '', '', '', '', r.pieces, '', '', rs(r.costValuePaise), rs(r.retailValuePaise), ''],
  ]);
}

// ── Lists ───────────────────────────────────────────────────────────────────
/** The invoices as listed: one row each, with what was paid and what is still owed. */
export function invoicesCsv(rows: InvoiceSummary[]): string {
  return toCsv([
    ['Invoice', 'Date', 'Due date', 'Customer', 'Type', 'Total', 'Paid', 'Balance', 'Status'],
    ...rows.map((i) => [i.number, i.issueDate, i.dueDate ?? '', i.buyerName, i.type, rs(i.totalPaise), rs(i.paidPaise), rs(i.status === 'cancelled' ? 0 : i.totalPaise - i.paidPaise), INVOICE_STATUS_LABEL[i.status]]),
  ]);
}

/** The designs as listed, with their stock and what it is worth at cost. */
export function designsCsv(rows: DesignSummary[]): string {
  return toCsv([
    ['Code', 'Design', 'Short name', 'Fabric', 'HSN', 'Variants', 'In stock', 'Stock value (cost)', 'Default price (excl. GST)', 'Status'],
    ...rows.map((d) => [d.code, d.name, d.nickname, d.fabric, d.hsnCode, d.variantCount, d.totalStock, rs(d.stockValuePaise), rs(d.defaultPricePaise), STOCK_STATUS_LABEL[d.status]]),
  ]);
}

/** The customers as listed: contact details and what they owe or hold. */
export function customersCsv(rows: Customer[]): string {
  return toCsv([
    ['Customer', 'Type', 'Phone', 'Email', 'GSTIN', 'City', 'State', 'Invoices', 'Billed', 'Owes', 'Advance held', 'Tags'],
    ...rows.map((c) => [c.name, c.type, c.phone, c.email, c.gstin, c.city, c.state, c.invoiceCount, rs(c.billedPaise), rs(c.outstandingPaise), rs(c.advancePaise), c.tags]),
  ]);
}

/** The proformas as listed. */
export function proformasCsv(rows: ProformaSummary[]): string {
  return toCsv([
    ['Proforma', 'Date', 'Valid until', 'Customer', 'Type', 'Total', 'Status', 'Invoice'],
    ...rows.map((p) => [p.number, p.issueDate, p.validUntil, p.buyerName, p.type, rs(p.totalPaise), PROFORMA_STATUS_LABEL[p.status], p.invoiceNumber ?? '']),
  ]);
}


/** The payments as listed: what came in, how, and where it went. */
export function paymentsCsv(rows: Payment[]): string {
  return toCsv([
    ['Date', 'Customer', 'Method', 'Reference', 'Amount', 'Applied to invoices', 'Held as advance', 'Status', 'Note'],
    ...rows.map((p) => [p.receivedOn, p.customerName, PAYMENT_METHOD_LABEL[p.method], p.reference, rs(p.amountPaise), p.allocations.map((a) => a.invoiceNumber).join(' '), rs(p.advancePaise), p.voided ? `Reversed${p.voidReason ? `: ${p.voidReason}` : ''}` : 'Received', p.note]),
  ]);
}

/** The expenses as listed. */
export function expensesCsv(rows: Expense[]): string {
  return toCsv([
    ['Date', 'Category', 'Paid to', 'Paid by', 'Reference', 'Amount', 'Note'],
    ...rows.map((e) => [e.date, e.category, e.vendor, PAYMENT_METHOD_LABEL[e.method], e.reference, rs(e.amountPaise), e.note]),
  ]);
}

/** Spending by category and month, with the total for the stretch before when there is one. */
export function expensesBreakdownCsv(b: ExpensesBreakdown): string {
  return toCsv([
    ['Category', ...b.months, 'Total', ...(b.previous ? ['Previous period'] : [])],
    ...b.rows.map((r) => [r.category, ...r.byMonth.map(rs), rs(r.totalPaise), ...(b.previous ? [rs(r.previousPaise ?? 0)] : [])]),
    ['Total', ...b.monthTotals.map(rs), rs(b.totalPaise), ...(b.previous ? [rs(b.previous.totalPaise)] : [])],
  ]);
}

// ── More reports ────────────────────────────────────────────────────────────
export function profitLossCsv(r: ProfitAndLoss): string {
  const last = r.lastYear;
  const line = (label: string, now: number, before?: number): Row => [label, rs(now), ...(last ? [before === undefined ? '' : rs(before)] : [])];
  return toCsv([
    ['Profit and loss', `${r.range.from} to ${r.range.to}`],
    [],
    ['', 'This period', ...(last ? [`Same dates last year (${last.range.from} to ${last.range.to})`] : [])],
    line('Sales (before GST)', r.salesPaise, last?.salesPaise),
    line('Cost of goods sold', r.costOfGoodsPaise, last?.costOfGoodsPaise),
    line('Gross profit', r.grossProfitPaise, last?.grossProfitPaise),
    [],
    ...r.expensesByCategory.map((c) => line(`Expense: ${c.category}`, c.paise, last?.expensesByCategory.find((x) => x.category.toLowerCase() === c.category.toLowerCase())?.paise ?? 0)),
    line('Total expenses', r.expensesPaise, last?.expensesPaise),
    [],
    line('Net profit', r.netProfitPaise, last?.netProfitPaise),
  ]);
}

export function marginCsv(r: MarginReport): string {
  const by = { design: 'Design', colour: 'Colour', customer: 'Customer' }[r.by];
  return toCsv([
    [`Margin by ${by.toLowerCase()}`, `${r.range.from} to ${r.range.to}`],
    [],
    [by, 'Pieces', 'Invoices', 'Sales (excl. GST)', 'Cost', 'Profit', 'Margin %'],
    ...r.rows.map((m) => [m.name, m.pieces, m.invoiceCount, rs(m.revenuePaise), rs(m.costPaise), rs(m.profitPaise), m.marginPercent === null ? '' : m.marginPercent.toFixed(1)]),
    ['Total', r.totals.pieces, '', rs(r.totals.revenuePaise), rs(r.totals.costPaise), rs(r.totals.profitPaise), r.totals.marginPercent === null ? '' : r.totals.marginPercent.toFixed(1)],
  ]);
}

export function purchasesCsv(r: PurchasesReport): string {
  return toCsv([
    ['Purchases and input GST', `${r.range.from} to ${r.range.to}`],
    [],
    ['Date', 'Vendor', 'Vendor GSTIN', 'Category', 'Taxable value', 'GST', 'Total'],
    ...r.entries.map((e) => [e.date, e.vendor, e.vendorGstin, e.category, rs(e.taxablePaise), rs(e.gstPaise), rs(e.totalPaise)]),
    ['Total', '', '', '', rs(r.taxablePaise), rs(r.gstPaise), rs(r.totalPaise)],
    [],
    ['Spending with no GST recorded', rs(r.withoutGstPaise)],
  ]);
}

export function accountBookCsv(b: AccountBook): string {
  const kind = { receipt: 'Received', expense: 'Paid', 'transfer-in': 'Moved in', 'transfer-out': 'Moved out' } as const;
  const rows: Row[] = [['Account book', `${b.range.from} to ${b.range.to}`]];
  for (const a of b.accounts) {
    rows.push([], [a.name, 'Opening', rs(a.openingPaise)], ['Date', 'Type', 'Party', 'Details', 'Money in', 'Money out', 'Balance']);
    for (const e of a.entries) rows.push([e.date, kind[e.kind], e.party, e.detail, e.inPaise ? rs(e.inPaise) : '', e.outPaise ? rs(e.outPaise) : '', rs(e.balancePaise)]);
    rows.push(['Closing', '', '', '', rs(a.inPaise), rs(a.outPaise), rs(a.closingPaise)]);
  }
  rows.push([], ['All accounts', '', '', '', '', '', rs(b.totalClosingPaise)]);
  return toCsv(rows);
}

export function quotesCsv(r: QuotesReport): string {
  const pct = (v: number | null) => (v === null ? '' : v.toFixed(1));
  return toCsv([
    ['Quotes', `${r.range.from} to ${r.range.to}`],
    [],
    ['Outcome', 'Quotes', 'Quoted value'],
    ['Won (any of it invoiced)', r.won.count, rs(r.won.quotedPaise)],
    ['Lost', r.lost.count, rs(r.lost.quotedPaise)],
    ['Expired without an answer', r.expired.count, rs(r.expired.quotedPaise)],
    ['Still open', r.open.count, rs(r.open.quotedPaise)],
    ['Withdrawn (cancelled)', r.withdrawn, ''],
    [],
    ['Win rate by count %', pct(r.winRatePercent)],
    ['Win rate by value %', pct(r.winRateByValuePercent)],
    ['Invoiced from won quotes', rs(r.won.invoicedPaise)],
    ['Average days to win', r.averageDaysToWin === null ? '' : r.averageDaysToWin.toFixed(1)],
    [],
    ['Why quotes were lost', 'Quotes', 'Quoted value'],
    ...r.lostReasons.map((l) => [l.reason, l.count, rs(l.quotedPaise)]),
    [],
    ['Month', 'Quotes', 'Quoted value', 'Won'],
    ...r.byMonth.map((m) => [m.month, m.count, rs(m.quotedPaise), m.wonCount]),
  ]);
}

export function movementCsv(r: StockMovementReport): string {
  const cols = (m: Omit<StockMovementRow, 'designId' | 'name'>): Row => [m.opening, m.added, m.returned, m.sold, m.damaged, m.adjusted, m.closing];
  return toCsv([
    ['Stock movement', `${r.range.from} to ${r.range.to}`],
    [],
    ['Design', 'Opening', 'Added', 'Returned', 'Sold', 'Damaged', 'Adjusted', 'Closing'],
    ...r.rows.map((m) => [m.name, ...cols(m)]),
    ['Total', ...cols(r.totals)],
  ]);
}

export function moversCsv(r: MoversReport): string {
  const label: Record<string, string> = { fast: 'Fast mover', steady: 'Steady', dead: 'Not moving', none: 'No stock' };
  return toCsv([
    [`Fast movers and dead stock`, `last ${r.days} days`],
    [],
    ['Design', 'Group', 'Sold', 'In stock', 'Stock lasts (days)', 'Last sold', 'Stock value (cost)'],
    ...r.rows.map((m) => [m.name, label[m.class] ?? m.class, m.sold, m.stock, m.daysOfStock ?? '', m.lastSoldOn ?? '', rs(m.stockValuePaise)]),
  ]);
}

export function dayBookCsv(b: DayBook): string {
  const title = { all: 'Day book', cash: 'Cash book', bank: 'Bank book' }[b.mode];
  const kind = { sale: 'Sale', receipt: 'Received', expense: 'Paid' } as const;
  const book = b.mode !== 'all';
  return toCsv([
    [title, `${b.range.from} to ${b.range.to}`],
    ...(book ? [['Opening balance', rs(b.openingPaise ?? 0)]] : []),
    [],
    ['Date', 'Type', 'Party', 'Details', 'Method', 'Invoiced', 'Money in', 'Money out', ...(book ? ['Balance'] : [])],
    ...b.entries.map((e) => [e.date, kind[e.kind], e.party, e.detail, e.method ? PAYMENT_METHOD_LABEL[e.method] : '', e.invoicedPaise ? rs(e.invoicedPaise) : '', e.inPaise ? rs(e.inPaise) : '', e.outPaise ? rs(e.outPaise) : '', ...(book ? [rs(e.balancePaise ?? 0)] : [])]),
    [],
    ['Totals', '', '', '', '', rs(b.invoicedPaise), rs(b.inPaise), rs(b.outPaise), ...(book ? [rs(b.closingPaise ?? 0)] : [])],
  ]);
}

/** Who owes what, by how late it is (the aged receivables report). */
export function receivablesCsv(d: DuesReport): string {
  return toCsv([
    ['Aged receivables', 'as of today'],
    [],
    ['Customer', 'Open invoices', 'Oldest due', 'Not yet due', '1–30 days late', '31–60 days late', '61+ days late', 'Owes', 'Advance held'],
    ...d.rows.map((r) => [r.customerName, r.openInvoices, r.oldestDueDate ?? '', rs(r.currentPaise), rs(r.days1to30Paise), rs(r.days31to60Paise), rs(r.days61plusPaise), rs(r.outstandingPaise), rs(r.advancePaise)]),
    ['Total', '', '', rs(d.currentPaise), rs(d.days1to30Paise), rs(d.days31to60Paise), rs(d.days61plusPaise), rs(d.outstandingPaise), rs(d.advanceHeldPaise)],
  ]);
}
