import { isValidGstin } from './gst';
import { lineShares } from './invoiceShares';
import { STATES } from './states';
import type { Invoice } from './types';

/**
 * Files for the government's two online forms. InvoiceOn can't issue an e-way bill number or an e-invoice number (IRN) itself: those
 * come from the government's portals. What it can do is prepare the file those portals take, from the invoice, and say what is missing
 * before it is uploaded. The layouts follow the portals' published JSON formats; the portals check the file on upload and name any
 * field they don't accept, so a first upload is worth doing with one invoice.
 */

export interface GovFile {
  json: string;
  /** Things the portal would reject: the file should not be uploaded until they are put right. */
  problems: string[];
  /** Worth knowing, but not a reason to stop. */
  notes: string[];
}

const rupees = (paise: number): number => Math.round(paise) / 100;
const ddmmyyyy = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const stateCode = (name: string): number | null => {
  const found = STATES.find((s) => s.name.toLowerCase() === name.trim().toLowerCase());
  return found ? Number(found.code) : null;
};
const clean = (s: string, max: number): string => s.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Checks both forms share: the seller, the buyer's place, and a valid HSN on every line. */
function commonProblems(inv: Invoice, forEway: boolean): string[] {
  const out: string[] = [];
  if (inv.status === 'cancelled') out.push('This invoice is cancelled.');
  if (!isValidGstin(inv.seller.gstin)) out.push("Your own GSTIN is missing or not valid. Add it in Settings → Business Profile.");
  if (!/^\d{6}$/.test(inv.seller.pincode)) out.push('Your business address needs a 6 digit pincode. Add it in Settings → Business Profile.');
  if (stateCode(inv.seller.state) === null) out.push('Your business address needs a state. Add it in Settings → Business Profile.');
  if (inv.number.length > 16) out.push(`The invoice number ${inv.number} is longer than the 16 characters the portal accepts. Shorten the invoice prefix in Settings.`);
  const badHsn = inv.lines.filter((l) => !/^\d{4,8}$/.test(l.hsn.trim()));
  if (badHsn.length > 0) out.push(`${badHsn.length === 1 ? 'An item has' : `${badHsn.length} items have`} no valid HSN code (4 to 8 digits): ${[...new Set(badHsn.map((l) => l.designName))].join(', ')}. Add it to the design.`);
  if (!forEway && inv.type !== 'B2B') out.push('An e-invoice is for business (B2B) tax invoices. This is a retail invoice.');
  return out;
}

// ── E-way bill ──────────────────────────────────────────────────────────────
export interface EwayInput {
  mode: 'road' | 'rail' | 'air' | 'ship';
  /** Kilometres between the two pincodes. 0 lets the portal work it out. */
  distanceKm: number;
  transporterName: string;
  /** The transporter's GSTIN (or transport ID), if goods go with one. */
  transporterId: string;
  transDocNo: string;
  /** yyyy-mm-dd, or ''. */
  transDocDate: string;
  vehicleNo: string;
  vehicleType: 'regular' | 'oversize';
}

export const EWAY_THRESHOLD_PAISE = 5_000_000;

const MODE_CODE = { road: '1', rail: '2', air: '3', ship: '4' } as const;

/** The e-way bill upload file (JSON) for one invoice. */
export function ewayBillFile(inv: Invoice, input: EwayInput): GovFile {
  const problems = commonProblems(inv, true);
  const notes: string[] = [];
  const toState = stateCode(inv.shipTo?.state || inv.buyer.state);
  const toPin = (inv.shipTo?.pincode || inv.buyer.pincode).trim();
  const billState = stateCode(inv.buyer.state);
  if (!/^\d{6}$/.test(toPin)) problems.push('The place the goods go to needs a 6 digit pincode. Add it to the customer or the ship-to address.');
  if (toState === null) problems.push('The place the goods go to needs a state. Add it to the customer or the ship-to address.');
  if (inv.type === 'B2B' && !isValidGstin(inv.buyer.gstin)) problems.push("The buyer's GSTIN is missing or not valid.");
  if (!Number.isInteger(input.distanceKm) || input.distanceKm < 0 || input.distanceKm > 4000) problems.push('Distance should be a whole number of kilometres from 0 to 4000. Use 0 to let the portal work it out from the pincodes.');
  if (input.vehicleNo.trim() && !/^[A-Z0-9]{7,15}$/i.test(input.vehicleNo.replace(/[\s-]/g, ''))) problems.push('The vehicle number should be 7 to 15 letters and digits, like UP32AB1234.');
  if (input.transporterId.trim() && !isValidGstin(input.transporterId)) problems.push("The transporter's GSTIN is not valid. Leave it empty if there is none.");
  if (input.transDocNo.trim() && !input.transDocDate) problems.push('Enter the date of the transport document (the LR or bilty).');
  if (!input.vehicleNo.trim() && !input.transporterId.trim()) notes.push('No vehicle number or transporter is given, so only Part A is prepared. The vehicle can be added on the portal before the goods move.');
  if (inv.totalPaise < EWAY_THRESHOLD_PAISE) notes.push('An e-way bill is needed when the goods are worth more than ₹50,000, and some states ask for one on smaller or local movements. Check the rule that applies to this movement.');
  if (!inv.intraState) notes.push('This is a supply to another state, so an e-way bill is needed above ₹50,000.');

  const shares = lineShares(inv);
  const items = inv.lines.map((l, i) => {
    const rate = l.ratePercent;
    return {
      productName: clean(l.designName, 100),
      productDesc: clean(`${l.color} ${l.size}`, 100),
      hsnCode: Number(l.hsn.trim()) || 0,
      quantity: l.qty,
      qtyUnit: 'PCS',
      cgstRate: inv.intraState ? rate / 2 : 0,
      sgstRate: inv.intraState ? rate / 2 : 0,
      igstRate: inv.intraState ? 0 : rate,
      cessRate: 0,
      cessNonadvol: 0,
      taxableAmount: rupees(shares[i]!.taxable),
    };
  });
  const bill: Record<string, unknown> = {
    userGstin: inv.seller.gstin,
    supplyType: 'O',
    subSupplyType: 1,
    subSupplyDesc: '',
    docType: 'INV',
    docNo: inv.number,
    docDate: ddmmyyyy(inv.issueDate),
    transType: billState !== null && toState !== null && billState !== toState ? 2 : 1,
    fromGstin: inv.seller.gstin,
    fromTrdName: clean(inv.seller.name, 100),
    fromAddr1: clean(inv.seller.address, 120),
    fromAddr2: '',
    fromPlace: clean(inv.seller.city, 50),
    fromPincode: Number(inv.seller.pincode) || 0,
    actFromStateCode: stateCode(inv.seller.state) ?? 0,
    fromStateCode: stateCode(inv.seller.state) ?? 0,
    toGstin: inv.buyer.gstin.trim() || 'URP',
    toTrdName: clean(inv.buyer.name, 100),
    toAddr1: clean(inv.shipTo?.address || inv.buyer.address, 120),
    toAddr2: '',
    toPlace: clean(inv.shipTo?.city || inv.buyer.city, 50),
    toPincode: Number(toPin) || 0,
    actToStateCode: toState ?? 0,
    toStateCode: billState ?? toState ?? 0,
    totalValue: rupees(inv.taxablePaise),
    cgstValue: rupees(inv.cgstPaise),
    sgstValue: rupees(inv.sgstPaise),
    igstValue: rupees(inv.igstPaise),
    cessValue: 0,
    totInvValue: rupees(inv.totalPaise),
    transMode: MODE_CODE[input.mode],
    transDistance: String(input.distanceKm),
    transporterName: clean(input.transporterName, 100),
    transporterId: input.transporterId.trim().toUpperCase(),
    transDocNo: clean(input.transDocNo, 15),
    transDocDate: input.transDocDate ? ddmmyyyy(input.transDocDate) : '',
    vehicleNo: input.vehicleNo.replace(/[\s-]/g, '').toUpperCase(),
    vehicleType: input.vehicleType === 'oversize' ? 'O' : 'R',
    itemList: items,
  };
  return { json: JSON.stringify({ version: '1.0.0621', billLists: [bill] }, null, 2), problems, notes };
}

// ── E-invoice ───────────────────────────────────────────────────────────────
/** The e-invoice upload file (JSON, schema 1.1) for one business invoice. */
export function eInvoiceFile(inv: Invoice): GovFile {
  const problems = commonProblems(inv, false);
  const notes: string[] = ['An e-invoice number (IRN) and QR code come from the government\'s invoice registration portal. Upload this file there; the invoice you print should carry what it returns.'];
  const buyerState = stateCode(inv.buyer.state);
  const pos = stateCode(inv.placeOfSupply);
  if (inv.type === 'B2B' && !isValidGstin(inv.buyer.gstin)) problems.push("The buyer's GSTIN is missing or not valid.");
  if (!/^\d{6}$/.test(inv.buyer.pincode.trim())) problems.push("The buyer's address needs a 6 digit pincode.");
  if (buyerState === null) problems.push("The buyer's address needs a state.");
  if (pos === null) problems.push('The place of supply is not a known state.');
  if (inv.pricesIncludeGst) notes.push('Prices on this invoice include GST, so the unit price in the file is the price before GST, worked back from the taxable value.');

  const shares = lineShares(inv);
  const items = inv.lines.map((l, i) => {
    const taxable = shares[i]!.taxable;
    const tax = shares[i]!.tax;
    const cgst = inv.intraState ? Math.floor(tax / 2) : 0;
    const sgst = inv.intraState ? tax - cgst : 0;
    const igst = inv.intraState ? 0 : tax;
    return {
      SlNo: String(i + 1),
      PrdDesc: clean(`${l.designName} ${l.color} ${l.size}`, 300),
      IsServc: 'N',
      HsnCd: l.hsn.trim(),
      Qty: l.qty,
      Unit: 'PCS',
      UnitPrice: l.qty > 0 ? Math.round((taxable / l.qty) * 10) / 1000 : 0,
      TotAmt: rupees(taxable),
      Discount: 0,
      AssAmt: rupees(taxable),
      GstRt: l.ratePercent,
      IgstAmt: rupees(igst),
      CgstAmt: rupees(cgst),
      SgstAmt: rupees(sgst),
      TotItemVal: rupees(taxable + tax),
    };
  });
  const doc = {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: 'INV', No: inv.number, Dt: ddmmyyyy(inv.issueDate) },
    SellerDtls: { Gstin: inv.seller.gstin, LglNm: clean(inv.seller.name, 100), Addr1: clean(inv.seller.address, 100), Loc: clean(inv.seller.city, 50), Pin: Number(inv.seller.pincode) || 0, Stcd: String(stateCode(inv.seller.state) ?? '').padStart(2, '0') },
    BuyerDtls: { Gstin: inv.buyer.gstin.trim(), LglNm: clean(inv.buyer.name, 100), Pos: String(pos ?? '').padStart(2, '0'), Addr1: clean(inv.buyer.address, 100), Loc: clean(inv.buyer.city, 50), Pin: Number(inv.buyer.pincode) || 0, Stcd: String(buyerState ?? '').padStart(2, '0') },
    ItemList: items,
    ValDtls: { AssVal: rupees(inv.taxablePaise), CgstVal: rupees(inv.cgstPaise), SgstVal: rupees(inv.sgstPaise), IgstVal: rupees(inv.igstPaise), CesVal: 0, Discount: 0, RndOffAmt: rupees(inv.roundOffPaise), TotInvVal: rupees(inv.totalPaise) },
  };
  return { json: JSON.stringify([doc], null, 2), problems, notes };
}
