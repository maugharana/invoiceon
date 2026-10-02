// Preferences that change how things look and read, without changing any figure.

export const PAPER_SIZES = ['A4', 'A5', 'Letter'] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];
/** Width and height in millimetres. The invoice is designed on A4 and scaled to the others. */
export const PAPER_MM: Record<PaperSize, { w: number; h: number }> = { A4: { w: 210, h: 297 }, A5: { w: 148, h: 210 }, Letter: { w: 215.9, h: 279.4 } };
export const PAPER_LABEL: Record<PaperSize, string> = { A4: 'A4 (210 × 297 mm)', A5: 'A5 (148 × 210 mm)', Letter: 'Letter (8.5 × 11 in)' };

export const DATE_FORMATS = ['short', 'slash', 'iso'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
export const DATE_FORMAT_LABEL: Record<DateFormat, string> = { short: '12 Mar 2027', slash: '12/03/2027', iso: '2027-03-12' };

export const LANGUAGES = ['en', 'hi', 'gu'] as const;
export type Language = (typeof LANGUAGES)[number];
export const LANGUAGE_LABEL: Record<Language, string> = { en: 'English', hi: 'हिन्दी (Hindi)', gu: 'ગુજરાતી (Gujarati)' };

/** The words printed on an invoice, in each language. Names, numbers and amounts are never translated. */
export interface InvoiceWords {
  invoice: string;
  taxInvoice: string;
  proforma: string;
  billTo: string;
  shipTo: string;
  transport: string;
  date: string;
  dueDate: string;
  validUntil: string;
  item: string;
  qty: string;
  rate: string;
  amount: string;
  subtotal: string;
  discount: string;
  total: string;
  balanceDue: string;
  received: string;
  payTo: string;
  terms: string;
  signatory: string;
  scanToPay: string;
}

export const INVOICE_WORDS: Record<Language, InvoiceWords> = {
  en: { invoice: 'Invoice', taxInvoice: 'Tax Invoice', proforma: 'Proforma Invoice', billTo: 'Bill to', shipTo: 'Ship to', transport: 'Transport', date: 'Date', dueDate: 'Due date', validUntil: 'Valid until', item: 'Item', qty: 'Qty', rate: 'Rate', amount: 'Amount', subtotal: 'Subtotal', discount: 'Discount', total: 'Total', balanceDue: 'Balance due', received: 'Received', payTo: 'Pay to', terms: 'Terms', signatory: 'Authorised signatory', scanToPay: 'Scan to pay' },
  hi: { invoice: 'चालान', taxInvoice: 'कर चालान', proforma: 'प्रोफार्मा चालान', billTo: 'बिल प्राप्तकर्ता', shipTo: 'माल भेजने का पता', transport: 'परिवहन', date: 'दिनांक', dueDate: 'देय तिथि', validUntil: 'मान्य तिथि', item: 'विवरण', qty: 'मात्रा', rate: 'दर', amount: 'राशि', subtotal: 'उप-योग', discount: 'छूट', total: 'कुल', balanceDue: 'बकाया राशि', received: 'प्राप्त', payTo: 'भुगतान करें', terms: 'शर्तें', signatory: 'अधिकृत हस्ताक्षरकर्ता', scanToPay: 'भुगतान के लिए स्कैन करें' },
  gu: { invoice: 'ઇન્વૉઇસ', taxInvoice: 'ટેક્સ ઇન્વૉઇસ', proforma: 'પ્રોફોર્મા ઇન્વૉઇસ', billTo: 'બિલ મેળવનાર', shipTo: 'માલ મોકલવાનું સરનામું', transport: 'પરિવહન', date: 'તારીખ', dueDate: 'નિયત તારીખ', validUntil: 'માન્ય તારીખ', item: 'વિગત', qty: 'જથ્થો', rate: 'દર', amount: 'રકમ', subtotal: 'પેટા-સરવાળો', discount: 'છૂટ', total: 'કુલ', balanceDue: 'બાકી રકમ', received: 'મળેલ', payTo: 'ચુકવણી કરો', terms: 'શરતો', signatory: 'અધિકૃત સહી કરનાર', scanToPay: 'ચુકવણી માટે સ્કૅન કરો' },
};

// ── Message templates ───────────────────────────────────────────────────────
export type TemplateKind = 'invoice' | 'quote' | 'due';

export const TEMPLATE_LABEL: Record<TemplateKind, string> = { invoice: 'Sending an invoice', quote: 'Reminding about a quote', due: 'Reminding about money owed' };

/** The blanks each message can use. They are replaced with the real details when the message is made. */
export const TEMPLATE_BLANKS: Record<TemplateKind, { key: string; label: string }[]> = {
  invoice: [
    { key: 'name', label: 'customer name' },
    { key: 'business', label: 'your business name' },
    { key: 'number', label: 'invoice number' },
    { key: 'total', label: 'invoice total' },
    { key: 'balance', label: 'balance still due' },
    { key: 'due', label: 'due date' },
    { key: 'upi', label: 'your UPI ID' },
  ],
  quote: [
    { key: 'name', label: 'customer name' },
    { key: 'business', label: 'your business name' },
    { key: 'number', label: 'quote number' },
    { key: 'total', label: 'quote total' },
    { key: 'valid_until', label: 'valid-until date' },
  ],
  due: [
    { key: 'name', label: 'customer name' },
    { key: 'business', label: 'your business name' },
    { key: 'owed', label: 'total owed' },
    { key: 'overdue', label: 'part that is overdue' },
    { key: 'invoices', label: 'number of open invoices' },
    { key: 'oldest_due', label: 'oldest due date' },
    { key: 'upi', label: 'your UPI ID' },
  ],
};

/** Replaces {blanks} in a template. A blank with no value becomes nothing; an unknown {word} is left as typed. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-z_]+)\}/g, (whole, key: string) => (key in values ? values[key]! : whole));
}
