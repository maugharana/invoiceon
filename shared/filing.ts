// Filing helpers: the small pure pieces shared by the GSTR-1, e-invoice and e-way bill exports.
import { STATES } from './states';

export type FilingKind = 'gstr1' | 'einvoice' | 'eway';

/** A registered business's invoice to an unregistered buyer, between states, above this value, is reported invoice by invoice (B2CL). */
export const B2CL_LIMIT_PAISE = 250_000_00;
/** Goods worth more than this need an e-way bill to move. */
export const EWAY_LIMIT_PAISE = 50_000_00;

export interface EwayTransport {
  mode: 'road' | 'rail' | 'air' | 'ship';
  /** Kilometres. 0 lets the e-way bill portal work it out from the pincodes. */
  distanceKm: number;
  vehicleNo: string;
  transporterName: string;
  /** The transporter's GSTIN, when they have one. */
  transporterId: string;
  /** The transport document (lorry receipt, bill of lading) number and its date. */
  docNo: string;
  docDate: string;
}

export interface FilingRequest {
  kind: FilingKind;
  from: string;
  to: string;
  /** e-way bill only: which invoices, when not every invoice above the e-way bill limit. */
  invoiceIds?: string[];
  transport?: EwayTransport;
}

export interface FilingFile {
  filename: string;
  /** JSON text, ready to save and upload. */
  content: string;
  /** How many invoices, notes or e-way bills are in the file. */
  count: number;
  /** Plain lines saying what went in. */
  summary: string[];
  /** Things to fix or check before uploading. The file is still produced. */
  warnings: string[];
}

/** Two digit GST state code for a state name as InvoiceOn stores it, or null if it is not one of the known states. */
export function stateCodeOf(name: string): string | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  return STATES.find((s) => s.name.toLowerCase() === n)?.code ?? null;
}

/** Paise to a rupee amount with two decimals, as the GST portals want numbers. */
export const toRupees = (paise: number): number => Number((paise / 100).toFixed(2));

/** `2026-04-09` to `09-04-2026` (GSTR-1) or `09/04/2026` (e-invoice, e-way bill). */
export function portalDate(iso: string, sep: '-' | '/'): string {
  const [y, m, d] = iso.split('-');
  return `${d}${sep}${m}${sep}${y}`;
}

/** The GSTR-1 filing period, `042026` for any date in April 2026. */
export const filingPeriod = (iso: string): string => `${iso.slice(5, 7)}${iso.slice(0, 4)}`;

/** The standard GST slabs. A line at any other rate is still exported, with a warning. */
export const STANDARD_RATES: readonly number[] = [0, 0.25, 3, 5, 12, 18, 28];

/**
 * Whether an invoice number is one the e-invoice portal accepts: at most 16 characters, letters, digits, "/" and "-", not starting
 * with a zero or a symbol.
 */
export const isPortalDocNumber = (n: string): boolean => /^[A-Za-z1-9]([A-Za-z0-9/-]{0,14}[A-Za-z0-9])?$/.test(n);

export const EWAY_MODE: Record<EwayTransport['mode'], number> = { road: 1, rail: 2, air: 3, ship: 4 };
