import { INVOICE_STATUS_LABEL } from './gst';
import { STOCK_STATUS_LABEL } from './stock';
import type { Customer, DesignSummary, Expense, ExpensesBreakdown, GstReport, InvoiceSummary, Payment, ProformaSummary, SalesReport, StockReport } from './types';
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
    ['Customer', 'Type', 'Phone', 'Email', 'GSTIN', 'City', 'State', 'Invoices', 'Billed', 'Owes', 'Advance held'],
    ...rows.map((c) => [c.name, c.type, c.phone, c.email, c.gstin, c.city, c.state, c.invoiceCount, rs(c.billedPaise), rs(c.outstandingPaise), rs(c.advancePaise)]),
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
