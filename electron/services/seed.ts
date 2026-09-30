import { addDays, todayIso } from '../../shared/gst';
import { get, tx, type Db } from '../db/connection';
import { UserError } from './common';
import { createCreditNote } from './creditNotes';
import { createCustomer } from './customers';
import { createExpense } from './expenses';
import { createDesign, createVariant, nextDesignCode } from './inventory';
import { cancelInvoice, createInvoice, variantsForSale } from './invoices';
import { createMaterial } from './materials';
import { recordPayment } from './payments';
import { cancelProforma, createProforma } from './proformas';
import { getSettings, saveSettings } from './settings';

const rupees = (n: number) => n * 100;

/**
 * Realistic saree data so a new install — or a demo — can be explored end to end: designs and stock, materials, customers,
 * invoices in every state, payments (one an advance), and so data in every report. Dates are relative to today. Refuses to
 * run on a database that already has designs.
 */
export function loadSampleData(db: Db): void {
  if (get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM designs WHERE deleted_at IS NULL')?.n) {
    throw new UserError('Sample data can only be loaded into an empty inventory.');
  }

  tx(db, () => {
    // Fictional customers (the GSTINs are format-valid but made up) so invoicing can be tried straight away.
    const blank = { email: '', address: '', pincode: '', notes: '' };
    createCustomer(db, { ...blank, name: 'Sunita Verma', type: 'B2C', phone: '9876500011', gstin: '', city: 'Mau', state: 'Uttar Pradesh' });
    createCustomer(db, { ...blank, name: 'Kanchan Sarees & Fabrics', type: 'B2B', phone: '9876500022', gstin: '09AABCK1234M1ZI', address: 'Chowk Bazaar', city: 'Varanasi', state: 'Uttar Pradesh' });
    createCustomer(db, { ...blank, name: 'Meera Textiles', type: 'B2B', phone: '9876500033', gstin: '27AAPFU0939F1ZV', address: 'Dadar West', city: 'Mumbai', state: 'Maharashtra' });
    createCustomer(db, { ...blank, name: 'Anjali Gupta', type: 'B2C', phone: '9876500044', gstin: '', address: 'Aliganj', city: 'Lucknow', state: 'Uttar Pradesh' });

    // A B2B invoice needs the seller's own GSTIN, so give an empty profile a sample one (format-valid, made up).
    // Replace these in Settings before issuing real invoices.
    if (!getSettings(db).gstin) {
      saveSettings(db, {
        gstin: '09AAACH7409R1ZZ',
        addressLine: 'Bhikhari Pura',
        pincode: '275101',
        phone: '9876543210',
        email: 'hello@maugharana.example',
        invoiceBank: 'State Bank of India, Mau branch\nA/c 1234567890 · IFSC SBIN0001234\nUPI: maugharana@sbi',
        invoiceFooter: 'Thank you for shopping with Mau Gharana!',
        proformaTerms: '50% advance to confirm the order. Balance before dispatch.',
        paymentAccounts: [
          { id: 'sample-sbi', name: 'SBI current account', kind: 'bank', details: 'A/c 1234567890 · IFSC SBIN0001234' },
          { id: 'sample-upi', name: 'Shop UPI', kind: 'upi', details: 'maugharana@sbi' },
          { id: 'sample-cash', name: 'Cash drawer', kind: 'cash', details: '' },
        ],
      });
    }

    const silk = createMaterial(db, { name: 'Pure silk yarn', unit: 'kg', unitCostPaise: rupees(4600) });
    const cotton = createMaterial(db, { name: 'Cotton yarn', unit: 'kg', unitCostPaise: rupees(380) });
    const zari = createMaterial(db, { name: 'Zari thread', unit: 'kg', unitCostPaise: rupees(9000) });
    const dye = createMaterial(db, { name: 'Dyeing & finishing', unit: 'pc', unitCostPaise: rupees(180) });
    const blouse = createMaterial(db, { name: 'Blouse piece fabric', unit: 'm', unitCostPaise: rupees(350) });
    const pack = createMaterial(db, { name: 'Packaging', unit: 'pc', unitCostPaise: rupees(40) });

    const designs = [
      {
        name: 'Mau Silk Butidar', fabric: 'Pure silk', hsn: '5007', price: 9800, base: 1800,
        bom: [[silk.id, 0.62], [zari.id, 0.07], [dye.id, 1], [blouse.id, 0.8], [pack.id, 1]],
        variants: [['Maroon', '6.3 m', 6], ['Emerald', '6.3 m', 4], ['Royal blue', '6.3 m', 1], ['Mustard', '5.5 m', 0]],
      },
      {
        name: 'Banarasi Katan Kadhua', fabric: 'Katan silk', hsn: '5007', price: 14500, base: 2600,
        bom: [[silk.id, 0.78], [zari.id, 0.12], [dye.id, 1], [blouse.id, 0.8], [pack.id, 1]],
        variants: [['Wine', '6.3 m', 3], ['Ivory', '6.3 m', 2], ['Rani pink', '6.3 m', 5]],
      },
      {
        name: 'Tanchoi Jamawar', fabric: 'Silk blend', hsn: '5007', price: 7200, base: 1400,
        bom: [[silk.id, 0.4], [cotton.id, 0.25], [zari.id, 0.03], [dye.id, 1], [pack.id, 1]],
        variants: [['Peacock green', '5.5 m', 8], ['Onion pink', '5.5 m', 7]],
      },
      {
        name: 'Cotton Silk Chanderi', fabric: 'Cotton silk', hsn: '5208', price: 3400, base: 650,
        bom: [[cotton.id, 0.45], [silk.id, 0.1], [dye.id, 1], [pack.id, 1]],
        variants: [['Sky blue', '5.5 m', 12], ['Lemon', '5.5 m', 9], ['Peach', '5.5 m', 2]],
      },
      {
        name: 'Organza Floral Jaal', fabric: 'Organza', hsn: '5407', price: 5600, base: 900,
        bom: [[silk.id, 0.22], [zari.id, 0.02], [dye.id, 1], [pack.id, 1]],
        variants: [['Blush', '5.5 m', 0], ['Sage', '5.5 m', 0]],
      },
    ] as const;

    for (const d of designs) {
      const design = createDesign(db, {
        code: nextDesignCode(db),
        name: d.name,
        fabric: d.fabric,
        hsnCode: d.hsn,
        description: '',
        defaultPricePaise: rupees(d.price),
      });
      for (const [color, size, stock] of d.variants) {
        createVariant(db, design.id, {
          color,
          size,
          sellPricePaise: rupees(d.price),
          mrpPaise: rupees(Math.ceil((d.price * 1.3) / 100) * 100),
          baseCostPaise: rupees(d.base),
          reorderLevel: 2,
          openingStock: stock,
          bom: d.bom.map(([materialId, qty]) => ({ materialId, qty })),
        });
      }
    }

    addSampleSales(db);
    addSampleExpenses(db);
    addSampleProformas(db);
  });
}

/** Invoices in every state, so each screen and report has something to show. */
function addSampleSales(db: Db): void {
  const today = todayIso();
  const day = (n: number) => addDays(today, n);
  const variants = variantsForSale(db);
  const item = (design: string, color: string, qty: number) => {
    const v = variants.find((x) => x.designName.includes(design) && x.color === color)!;
    return { variantId: v.variantId, qty, unitPricePaise: v.sellPricePaise };
  };
  const idOf = (name: string) => get<{ id: string }>(db, 'SELECT id FROM customers WHERE name LIKE ? AND deleted_at IS NULL', `${name}%`)!.id;
  const base = { notes: '', discountPaise: 0 };

  // 1. B2B, same state (CGST + SGST): a big old invoice, part-paid — now overdue for the balance.
  const kanchan = idOf('Kanchan');
  const a = createInvoice(db, { ...base, type: 'B2B', customerId: kanchan, issueDate: day(-52), dueDate: day(-37), discountPaise: rupees(200), notes: 'Festival stock — please pack in boxes.', lines: [item('Butidar', 'Maroon', 2), item('Tanchoi', 'Peacock green', 3)] });
  recordPayment(db, { customerId: kanchan, amountPaise: rupees(20000), method: 'bank', reference: 'NEFT 4471', receivedOn: day(-45), note: '', allocations: [{ invoiceId: a.id, amountPaise: rupees(20000) }] });

  // 2. B2B, other state (IGST): unpaid and overdue.
  createInvoice(db, { ...base, type: 'B2B', customerId: idOf('Meera'), issueDate: day(-21), dueDate: day(-6), lines: [item('Katan', 'Rani pink', 2)] });

  // 3. B2B, not yet due: shows up under "not yet due" on the dues page.
  createInvoice(db, { ...base, type: 'B2B', customerId: kanchan, issueDate: day(-4), dueDate: day(11), lines: [item('Katan', 'Wine', 1)] });

  // 4. B2C, saved customer, paid in full by UPI at the counter.
  const sunita = createInvoice(db, { ...base, type: 'B2C', customerId: idOf('Sunita'), issueDate: day(-9), dueDate: day(-9), lines: [item('Chanderi', 'Sky blue', 3)], payment: { amountPaise: rupees(10710), method: 'upi', reference: 'UPI 20918' } });
  // She sent one piece back with a zari snag: refunded by UPI, and not put back on the shelf, so stock and dues stay as they are.
  createCreditNote(db, {
    invoiceId: sunita.id,
    issueDate: day(-6),
    kind: 'return',
    reason: 'Zari snag found on one piece',
    notes: '',
    lines: [{ invoiceLineId: sunita.lines[0]!.id, qty: 1, restock: false }],
    refund: { amountPaise: rupees(3570), method: 'upi', reference: 'UPI 20977' },
  });

  // 5. B2C walk-in, paid in cash, with a discount.
  createInvoice(db, { ...base, type: 'B2C', customerId: null, buyerName: 'Anita Rao', issueDate: day(-2), dueDate: day(-2), discountPaise: rupees(500), lines: [item('Tanchoi', 'Onion pink', 1), item('Chanderi', 'Lemon', 2)], payment: { amountPaise: rupees(14175), method: 'cash', reference: '' } });

  // 6. A cancelled invoice (stock goes back on the shelf).
  const gone = createInvoice(db, { ...base, type: 'B2C', customerId: null, issueDate: day(-1), dueDate: day(-1), lines: [item('Chanderi', 'Peach', 1)] });
  cancelInvoice(db, gone.id, 'Customer changed their mind');

  // 7. An advance: a customer booking a saree pays a deposit before any invoice exists.
  recordPayment(db, { customerId: idOf('Anjali'), amountPaise: rupees(3000), method: 'upi', reference: 'UPI 33107', receivedOn: day(-3), note: 'Booking: Katan Kadhua in Ivory', allocations: [] });
}

/** Money going out over the last two months, in the standard categories, so the expense screens and charts have something to show. */
function addSampleExpenses(db: Db): void {
  const today = todayIso();
  const rows: [number, string, string, number, 'cash' | 'upi' | 'bank', string][] = [
    [-58, 'Rent', 'Shop landlord', 12000, 'bank', ''],
    [-50, 'Raw materials', 'Varanasi Silk Traders', 38500, 'bank', 'Silk yarn, 8 kg'],
    [-44, 'Salaries & wages', 'Weavers and helpers', 24000, 'cash', ''],
    [-30, 'Rent', 'Shop landlord', 12000, 'bank', ''],
    [-27, 'Raw materials', 'Kanpur Zari House', 21600, 'upi', 'Zari thread'],
    [-19, 'Packaging', 'Shree Packaging', 3200, 'cash', 'Boxes and tissue'],
    [-12, 'Transport & freight', 'Mau Transport', 2400, 'cash', 'Parcel to Mumbai'],
    [-6, 'Electricity & utilities', 'UPPCL', 4150, 'upi', ''],
    [-3, 'Marketing', 'Instagram ads', 1800, 'upi', 'Festival collection'],
  ];
  for (const [offset, category, vendor, amount, method, note] of rows) {
    createExpense(db, { date: addDays(today, offset), category, vendor, amountPaise: rupees(amount), method, reference: '', note });
  }
}

/** Quotes in every state: two open (one for pieces not yet in stock), one lapsed, one cancelled. Nothing is converted, so the invoice figures stay as they are. */
function addSampleProformas(db: Db): void {
  const today = todayIso();
  const day = (n: number) => addDays(today, n);
  const variants = variantsForSale(db);
  const item = (design: string, color: string, qty: number) => {
    const v = variants.find((x) => x.designName.includes(design) && x.color === color)!;
    return { variantId: v.variantId, qty, unitPricePaise: v.sellPricePaise };
  };
  const idOf = (name: string) => get<{ id: string }>(db, 'SELECT id FROM customers WHERE name LIKE ? AND deleted_at IS NULL', `${name}%`)!.id;
  const base = { discountPaise: 0, notes: '' };

  createProforma(db, { ...base, type: 'B2C', customerId: idOf('Anjali'), issueDate: day(-3), validUntil: day(12), notes: 'Booking deposit of ₹3,000 received.', lines: [item('Katan', 'Ivory', 1)] });
  createProforma(db, { ...base, type: 'B2B', customerId: idOf('Meera'), issueDate: day(-1), validUntil: day(14), discountPaise: rupees(1000), notes: 'Blush will be ready in about two weeks.', lines: [item('Organza', 'Blush', 6), item('Butidar', 'Emerald', 2)] });
  createProforma(db, { ...base, type: 'B2C', customerId: idOf('Sunita'), issueDate: day(-25), validUntil: day(-10), lines: [item('Chanderi', 'Lemon', 2)] });
  const dropped = createProforma(db, { ...base, type: 'B2B', customerId: idOf('Kanchan'), issueDate: day(-15), validUntil: day(-1), lines: [item('Tanchoi', 'Onion pink', 4)] });
  cancelProforma(db, dropped.id, 'Customer bought elsewhere');
}
