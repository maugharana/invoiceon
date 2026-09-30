import type { GstReport, SalesReport, StockReport } from './types';
import { PAYMENT_METHOD_LABEL } from './types';

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
    ...(r.returns.count > 0
      ? [
          [],
          ['Credit notes (returns and adjustments)', r.returns.count],
          ['Credited (incl. GST)', rs(r.returns.totalPaise)],
          ['Credited (taxable value)', rs(r.returns.taxablePaise)],
          ['Refunded to customers', rs(r.returns.refundedPaise)],
          ['Pieces returned', r.returns.piecesReturned],
          ['Net invoiced (invoiced less credit notes)', rs(r.netInvoicedPaise)],
          ['Net gross profit', rs(r.netGrossProfitPaise)],
        ]
      : []),
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

/** Credit and debit note register: one row per credit note and GST rate, with the invoice it corrects. */
const creditNoteRows = (r: GstReport): Row[] => [
  ['Type', 'GSTIN of buyer', 'Buyer name', 'Credit note number', 'Credit note date', 'Original invoice number', 'Original invoice date', 'Place of supply', 'GST rate %', 'Taxable value', 'CGST', 'SGST', 'IGST', 'Note value'],
  ...r.creditNoteRegister.map((n): Row => [n.type, n.gstin, n.customer, n.number, n.date, n.invoiceNumber, n.invoiceDate, n.placeOfSupply, n.ratePercent, rs(n.taxablePaise), rs(n.cgstPaise), rs(n.sgstPaise), rs(n.igstPaise), rs(n.totalPaise)]),
];

export const gstCreditNotesCsv = (r: GstReport): string => toCsv(creditNoteRows(r));

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
    ...(r.creditNoteRegister.length > 0 ? [[], ['Credit notes'], ...creditNoteRows(r), [], ['Net GST after credit notes', rs(r.netTotals.taxPaise)]] : []),
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
