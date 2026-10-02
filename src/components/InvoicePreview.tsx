import { computeInvoice, todayIso, addDays } from '../../shared/gst';
import type { Invoice, Settings } from '../../shared/types';
import { InvoiceDocument } from './InvoiceDocument';

/**
 * A sample B2B invoice drawn from the settings as they are *right now* (saved or not), so changing a colour, uploading a
 * logo or typing bank details shows up instantly. It is the real InvoiceDocument — what you see here is what a PDF will be.
 */
export function sampleInvoice(s: Settings): Invoice {
  const today = todayIso();
  const base = [
    { id: 'l1', variantId: 'v1', designName: 'Mau Silk Butidar', color: 'Maroon', size: '6.3 m', sku: 'MG-001-MAR-6.3M', hsn: '5007', qty: 2, unitPricePaise: 980000 },
    { id: 'l2', variantId: 'v2', designName: 'Cotton Silk Chanderi', color: 'Sky blue', size: '5.5 m', sku: 'MG-004-SB-5.5M', hsn: '5208', qty: 3, unitPricePaise: 340000 },
  ].map((l) => ({ ...l, amountPaise: l.qty * l.unitPricePaise }));
  const t = computeInvoice({ lines: base.map((l) => ({ amountPaise: l.amountPaise, ratePercent: s.gstRatePercent })), discountPaise: 0, intraState: true, inclusive: s.pricesIncludeGst, roundOff: s.roundOff });
  const lines = base.map((l, i) => ({ ...l, discountPaise: 0, ratePercent: s.gstRatePercent, note: '', taxablePaise: t.lines[i]!.taxablePaise, taxPaise: t.lines[i]!.taxPaise }));
  const paid = 1000000;
  return {
    id: 'sample',
    number: `${s.invoicePrefix || 'INV'}/${today.slice(0, 4)}-${String((Number(today.slice(2, 4)) + 1) % 100).padStart(2, '0')}/0001`,
    type: 'B2B',
    customerId: null,
    buyerName: 'Kanchan Sarees & Fabrics',
    issueDate: today,
    dueDate: addDays(today, s.defaultDueDays),
    totalPaise: t.totalPaise,
    paidPaise: paid,
    status: 'partial',
    deliveryStatus: 'none',
    shipTo: null,
    transport: '',
    trackingNo: '',
    deliveredOn: null,
    series: '',
    seller: { name: s.businessName || 'Your business name', gstin: s.gstin, address: s.addressLine, city: s.city, state: s.state, pincode: s.pincode, phone: s.phone, email: s.email, terms: s.invoiceTerms, bank: s.invoiceBank, footer: s.invoiceFooter, upiId: s.upiId },
    branding: { accent: s.invoiceAccent, logo: s.invoiceLogo, showSignature: s.invoiceShowSignature, showUpiQr: s.invoiceShowUpiQr, language: s.invoiceLanguage },
    buyer: { name: 'Kanchan Sarees & Fabrics', gstin: '09AABCK1234M1ZI', address: 'Chowk Bazaar', city: 'Varanasi', state: 'Uttar Pradesh', pincode: '221001', phone: '9876500022' },
    placeOfSupply: 'Uttar Pradesh',
    gstRatePercent: s.gstRatePercent,
    pricesIncludeGst: s.pricesIncludeGst,
    intraState: true,
    subtotalPaise: t.subtotalPaise,
    lineDiscountPaise: 0,
    credits: [],
    creditedPaise: 0,
    taxByRate: t.byRate,
    discountPaise: 0,
    taxablePaise: t.taxablePaise,
    cgstPaise: t.cgstPaise,
    sgstPaise: t.sgstPaise,
    igstPaise: 0,
    roundOffPaise: t.roundOffPaise,
    notes: 'Sample invoice — this is how yours will look.',
    lines,
    creditNotes: [],
    creditedPaise: 0,
    payments: [{ paymentId: 'p1', receivedOn: today, method: 'bank', reference: 'NEFT 4471', amountPaise: paid }],
    cancelledAt: null,
    cancelReason: '',
    createdAt: new Date().toISOString(),
  };
}

const SCALE = 0.5;

/** The invoice shrunk to fit beside the settings form. Purely visual: not interactive, not selectable. */
export function InvoicePreview({ settings }: { settings: Settings }) {
  return (
    <div
      aria-label="Live preview of your invoice"
      className="pointer-events-none select-none overflow-hidden rounded-lg border border-line bg-white"
      style={{ width: `calc(210mm * ${SCALE})`, height: `calc(297mm * ${SCALE})` }}
    >
      <div style={{ transform: `scale(${SCALE})`, transformOrigin: 'top left', width: '210mm' }}>
        <InvoiceDocument invoice={sampleInvoice(settings)} />
      </div>
    </div>
  );
}
