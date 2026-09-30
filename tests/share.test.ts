import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../electron/db/connection';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as proformas from '../electron/services/proformas';
import { getSettings, saveSettings } from '../electron/services/settings';
import { todayIso } from '../shared/gst';
import { DEFAULT_INVOICE_MESSAGE, isValidUpiId, mailtoUrl, renderTemplate, upiPaymentLink, whatsappNumber, whatsappUrl } from '../shared/share';

describe('message templates', () => {
  it('fills placeholders, and drops unknown ones instead of sending them', () => {
    expect(renderTemplate('Hi {customer}, invoice {number} is {total}. {typo}', { customer: 'Sunita', number: 'MG/1', total: '₹500' })).toBe('Hi Sunita, invoice MG/1 is ₹500.');
  });

  it('tidies the blank lines an empty placeholder leaves behind', () => {
    const text = renderTemplate('Hello {customer}\n\n{dueLine}\n\n\n\nBye', { customer: 'A', dueLine: '' });
    expect(text).toBe('Hello A\n\nBye');
  });

  it('the standard invoice message reads well with and without a balance', () => {
    const paid = renderTemplate(DEFAULT_INVOICE_MESSAGE, { customer: 'Sunita', business: 'Mau Gharana', number: 'MG/1', total: '₹1,050', dueLine: '', upiLine: '' });
    expect(paid).toContain('Hello Sunita,');
    expect(paid).toContain('invoice MG/1 for ₹1,050 is ready.');
    expect(paid).not.toContain('{');
    const owing = renderTemplate(DEFAULT_INVOICE_MESSAGE, { customer: 'Sunita', business: 'Mau Gharana', number: 'MG/1', total: '₹1,050', dueLine: ' ₹1,050 is due by 15 Oct 2026.', upiLine: '\nYou can pay by UPI to maugharana@sbi.' });
    expect(owing).toContain('is ready. ₹1,050 is due by 15 Oct 2026.\nYou can pay by UPI to maugharana@sbi.');
  });
});

describe('WhatsApp and email links', () => {
  it('turns Indian numbers into what WhatsApp wants', () => {
    expect(whatsappNumber('98765 43210')).toBe('919876543210');
    expect(whatsappNumber('098765 43210')).toBe('919876543210');
    expect(whatsappNumber('+91 98765-43210')).toBe('919876543210');
    expect(whatsappNumber('0091 9876543210')).toBe('919876543210');
    expect(whatsappNumber('+44 7911 123456')).toBe('447911123456');
    expect(whatsappNumber('12345')).toBeNull();
    expect(whatsappNumber('')).toBeNull();
    expect(whatsappNumber('phone: none')).toBeNull();
  });

  it('builds links, with the text safely encoded', () => {
    expect(whatsappUrl('9876543210', 'Hi & bye\nLine 2')).toBe('https://wa.me/919876543210?text=Hi%20%26%20bye%0ALine%202');
    expect(whatsappUrl('', 'Hello')).toBe('https://wa.me/?text=Hello'); // opens WhatsApp to choose a contact
    expect(mailtoUrl(' a@b.com ', 'Invoice MG/1', 'Total ₹5 & more')).toBe('mailto:a@b.com?subject=Invoice%20MG%2F1&body=Total%20%E2%82%B95%20%26%20more');
  });
});

describe('UPI', () => {
  it('recognises UPI ids', () => {
    for (const ok of ['maugharana@sbi', 'name.surname-1@okhdfcbank', '9876543210@ybl']) expect(isValidUpiId(ok)).toBe(true);
    for (const bad of ['', 'maugharana', '@sbi', 'a@b', 'has space@sbi', 'x@1bank']) expect(isValidUpiId(bad)).toBe(false);
  });

  it('builds the payment link a UPI app opens', () => {
    expect(upiPaymentLink({ upiId: 'maugharana@sbi', payeeName: 'Mau Gharana', amountPaise: 1281000, note: 'Invoice MG/2026-27/0001' })).toBe('upi://pay?pa=maugharana%40sbi&pn=Mau%20Gharana&am=12810.00&cu=INR&tn=Invoice%20MG%2F2026-27%2F0001');
    expect(upiPaymentLink({ upiId: 'a@sbi', payeeName: 'X', amountPaise: 12345, note: '' })).toContain('am=123.45');
    expect(upiPaymentLink({ upiId: 'a@sbi', payeeName: 'X', amountPaise: 0, note: 'n' })).not.toContain('am='); // no amount: the payer types it
    expect(upiPaymentLink({ upiId: 'a@sbi', payeeName: 'N'.repeat(60), amountPaise: 100, note: '' })).toContain(`pn=${'N'.repeat(40)}&`);
  });
});

describe('settings and invoices', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
    saveSettings(db, { state: 'Uttar Pradesh', gstin: '09AAACH7409R1ZZ' });
  });
  const stocked = () => {
    const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: '', hsnCode: '5007', description: '', defaultPricePaise: 100000 });
    return inventory.createVariant(db, d.id, { color: 'Maroon', size: '6 m', sellPricePaise: 100000, baseCostPaise: 0, reorderLevel: 0, openingStock: 5, bom: [] });
  };
  const sale = (variantId: string) => invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: todayIso(), dueDate: todayIso(), discountPaise: 0, notes: '', lines: [{ variantId, qty: 1, unitPricePaise: 100000 }] });

  it('has sensible defaults and validates the UPI id and messages', () => {
    expect(getSettings(db)).toMatchObject({ upiId: '', invoiceShowUpiQr: true, shareInvoiceMessage: DEFAULT_INVOICE_MESSAGE });
    expect(() => saveSettings(db, { upiId: 'nonsense' })).toThrow(/name@bank/);
    expect(saveSettings(db, { upiId: 'maugharana@sbi' }).upiId).toBe('maugharana@sbi');
    expect(() => saveSettings(db, { shareInvoiceMessage: '  ' })).toThrow(/required/);
    expect(() => saveSettings(db, { shareEmailSubject: 'x'.repeat(151) })).toThrow(/too long/);
  });

  it('gives an invoice and a proforma the live UPI id only when one is set and the QR is on', () => {
    const v = stocked();
    const inv = sale(v.id);
    expect(inv.payByUpi).toBeNull(); // no UPI id yet
    saveSettings(db, { upiId: 'maugharana@sbi' });
    expect(invoices.getInvoice(db, inv.id).payByUpi).toBe('maugharana@sbi'); // live: an older invoice gets it too
    const quote = proformas.createProforma(db, { type: 'B2C', customerId: null, issueDate: todayIso(), validUntil: todayIso(), discountPaise: 0, notes: '', lines: [{ variantId: v.id, qty: 1, unitPricePaise: 100000 }] });
    expect(quote.payByUpi).toBe('maugharana@sbi');
    saveSettings(db, { invoiceShowUpiQr: false });
    expect(invoices.getInvoice(db, inv.id).payByUpi).toBeNull();
    expect(proformas.getProforma(db, quote.id).payByUpi).toBeNull();
  });
});
