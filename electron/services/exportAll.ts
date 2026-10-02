import { toCsv, rs } from '../../shared/csv';
import { INVOICE_STATUS_LABEL, todayIso } from '../../shared/gst';
import { PAYMENT_METHOD_LABEL, PROFORMA_STATUS_LABEL } from '../../shared/types';
import { makeZip, toBase64 } from '../../shared/zip';
import { all, type Db } from '../db/connection';
import { listCustomers } from './customers';
import { listExpenses } from './expenses';
import { listDesigns, loadVariants } from './inventory';
import { listInvoices } from './invoices';
import { listMaterials } from './materials';
import { listPayments } from './payments';
import { listProformas } from './proformas';

/**
 * Everything in the book as a set of spreadsheets in one ZIP: customers, designs and variants, invoices and their lines, payments,
 * expenses, proformas and raw materials. It is for keeping a copy, opening in Excel, or moving elsewhere. It is not a backup (use
 * Back up now for that): it can't be loaded back.
 */
export function exportEverything(db: Db): { fileName: string; base64: string; files: string[] } {
  const designs = listDesigns(db);
  const designName = new Map(designs.map((d) => [d.id, d.name]));
  const invoices = listInvoices(db);
  const invoiceNumber = new Map(invoices.map((i) => [i.id, i.number]));
  const lines = all<{ invoice_id: string; design_name: string; color: string; size: string; sku: string; hsn: string; qty: number; unit_price_paise: number; amount_paise: number; unit_cost_paise: number }>(
    db,
    'SELECT invoice_id, design_name, color, size, sku, hsn, qty, unit_price_paise, amount_paise, unit_cost_paise FROM invoice_lines ORDER BY invoice_id, position',
  );

  const files: { name: string; content: string }[] = [
    {
      name: 'customers.csv',
      content: toCsv([['Name', 'Type', 'Phone', 'Email', 'GSTIN', 'Address', 'City', 'State', 'Pincode', 'Notes', 'Invoices', 'Billed', 'Owes', 'Advance held'], ...listCustomers(db).map((c) => [c.name, c.type, c.phone, c.email, c.gstin, c.address, c.city, c.state, c.pincode, c.notes, c.invoiceCount, rs(c.billedPaise), rs(c.outstandingPaise), rs(c.advancePaise)])]),
    },
    {
      name: 'designs.csv',
      content: toCsv([['Code', 'Name', 'Short name', 'Fabric', 'HSN', 'Description', 'Default price'], ...designs.map((d) => [d.code, d.name, d.nickname, d.fabric, d.hsnCode, d.description, rs(d.defaultPricePaise)])]),
    },
    {
      name: 'variants.csv',
      content: toCsv([
        ['Design', 'SKU', 'Colour', 'Size', 'In stock', 'Reorder level', 'Cost', 'Selling price', 'MRP'],
        ...loadVariants(db).map((v) => [designName.get(v.designId) ?? '', v.sku, v.color, v.size, v.stock, v.reorderLevel, rs(v.unitCostPaise), rs(v.sellPricePaise), v.mrpPaise ? rs(v.mrpPaise) : '']),
      ]),
    },
    {
      name: 'invoices.csv',
      content: toCsv([['Invoice', 'Date', 'Due date', 'Customer', 'Type', 'Total', 'Paid', 'Status'], ...invoices.map((i) => [i.number, i.issueDate, i.dueDate ?? '', i.buyerName, i.type, rs(i.totalPaise), rs(i.paidPaise), INVOICE_STATUS_LABEL[i.status]])]),
    },
    {
      name: 'invoice-lines.csv',
      content: toCsv([
        ['Invoice', 'Design', 'Colour', 'Size', 'SKU', 'HSN', 'Quantity', 'Rate', 'Amount', 'Cost each'],
        ...lines.map((l) => [invoiceNumber.get(l.invoice_id) ?? '', l.design_name, l.color, l.size, l.sku, l.hsn, l.qty, rs(l.unit_price_paise), rs(l.amount_paise), rs(l.unit_cost_paise)]),
      ]),
    },
    {
      name: 'payments.csv',
      content: toCsv([
        ['Date', 'Customer', 'Method', 'Reference', 'Amount', 'Applied to', 'Held as advance', 'Status', 'Note'],
        ...listPayments(db).map((p) => [p.receivedOn, p.customerName, PAYMENT_METHOD_LABEL[p.method], p.reference, rs(p.amountPaise), p.allocations.map((a) => a.invoiceNumber).join(' '), rs(p.advancePaise), p.voided ? `Reversed${p.voidReason ? `: ${p.voidReason}` : ''}` : 'Received', p.note]),
      ]),
    },
    {
      name: 'expenses.csv',
      content: toCsv([['Date', 'Category', 'Paid to', 'Paid by', 'Reference', 'Amount', 'Note'], ...listExpenses(db).map((e) => [e.date, e.category, e.vendor, PAYMENT_METHOD_LABEL[e.method], e.reference, rs(e.amountPaise), e.note])]),
    },
    {
      name: 'proformas.csv',
      content: toCsv([['Proforma', 'Date', 'Valid until', 'Customer', 'Type', 'Total', 'Status', 'Invoice'], ...listProformas(db).map((p) => [p.number, p.issueDate, p.validUntil, p.buyerName, p.type, rs(p.totalPaise), PROFORMA_STATUS_LABEL[p.status], p.invoiceNumber ?? ''])]),
    },
    {
      name: 'raw-materials.csv',
      content: toCsv([['Material', 'Unit', 'Cost per unit', 'Used in variants'], ...listMaterials(db).map((m) => [m.name, m.unit, rs(m.unitCostPaise), m.usedInCount])]),
    },
  ];
  files.push({
    name: 'README.txt',
    content: `InvoiceOn data export, ${todayIso()}\r\n\r\nOne spreadsheet for each part of your book. Amounts are in rupees. Open them in Excel or Google Sheets.\r\nThis is a copy for your records, not a backup: use Settings, Data management, Back up now to make one that can be restored.\r\n\r\n${files.map((f) => f.name).join('\r\n')}\r\n`,
  });
  return { fileName: `invoiceon-export-${todayIso()}.zip`, base64: toBase64(makeZip(files)), files: files.map((f) => f.name) };
}
