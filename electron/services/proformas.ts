import { addDays, financialYear, formatInvoiceNumber, isIsoDate, todayIso } from '../../shared/gst';
import { matchesAll } from '../../shared/search';
import type { Invoice, InvoiceLine, InvoiceType, Party, Proforma, ProformaInput, ProformaQuery, ProformaStatus, ProformaSummary } from '../../shared/types';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, isUniqueViolation, newId, nowIso, optionalText } from './common';
import { brandingOf, checkDocument, createInvoice, priceLines, sellerSnapshot } from './invoices';
import { getSettings } from './settings';

interface Row {
  id: string;
  number: string;
  fy: string;
  seq: number;
  type: InvoiceType;
  customer_id: string | null;
  seller_json: string;
  buyer_json: string;
  place_of_supply: string;
  issue_date: string;
  valid_until: string;
  gst_rate_percent: number;
  intra_state: number;
  subtotal_paise: number;
  discount_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  round_off_paise: number;
  total_paise: number;
  notes: string;
  status: 'open' | 'converted' | 'cancelled';
  invoice_id: string | null;
  invoice_number: string | null;
  cancelled_at: string | null;
  cancel_reason: string;
  created_at: string;
}

interface LineRow {
  id: string;
  variant_id: string;
  design_name: string;
  color: string;
  size: string;
  sku: string;
  hsn: string;
  qty: number;
  unit_price_paise: number;
  amount_paise: number;
}

// A quote lapses on its own; nothing needs to run for that to happen.
const statusOf = (r: Pick<Row, 'status' | 'valid_until'>): ProformaStatus => (r.status === 'open' && r.valid_until < todayIso() ? 'expired' : r.status);

const SELECT = 'SELECT p.*, i.number AS invoice_number FROM proformas p LEFT JOIN invoices i ON i.id = p.invoice_id';

function toSummary(r: Row): ProformaSummary {
  return {
    id: r.id,
    number: r.number,
    type: r.type,
    customerId: r.customer_id,
    buyerName: (JSON.parse(r.buyer_json) as Party).name,
    issueDate: r.issue_date,
    validUntil: r.valid_until,
    totalPaise: r.total_paise,
    status: statusOf(r),
    invoiceId: r.invoice_id,
    invoiceNumber: r.invoice_number,
  };
}

function toProforma(db: Db, r: Row): Proforma {
  const lines = all<LineRow>(db, 'SELECT * FROM proforma_lines WHERE proforma_id = ? ORDER BY position', r.id).map(
    (l): InvoiceLine => ({ id: l.id, variantId: l.variant_id, designName: l.design_name, color: l.color, size: l.size, sku: l.sku, hsn: l.hsn, qty: l.qty, unitPricePaise: l.unit_price_paise, amountPaise: l.amount_paise }),
  );
  return {
    ...toSummary(r),
    seller: { bank: '', footer: '', ...JSON.parse(r.seller_json) },
    branding: brandingOf(db),
    buyer: JSON.parse(r.buyer_json),
    placeOfSupply: r.place_of_supply,
    gstRatePercent: r.gst_rate_percent,
    intraState: r.intra_state === 1,
    subtotalPaise: r.subtotal_paise,
    discountPaise: r.discount_paise,
    taxablePaise: r.taxable_paise,
    cgstPaise: r.cgst_paise,
    sgstPaise: r.sgst_paise,
    igstPaise: r.igst_paise,
    roundOffPaise: r.round_off_paise,
    notes: r.notes,
    lines,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
    createdAt: r.created_at,
  };
}

export function getProforma(db: Db, id: string): Proforma {
  const row = get<Row>(db, `${SELECT} WHERE p.id = ?`, id);
  if (!row) throw new UserError('That proforma no longer exists.');
  return toProforma(db, row);
}

export function listProformas(db: Db, query: ProformaQuery = {}): ProformaSummary[] {
  return all<Row>(db, `${SELECT} ORDER BY p.issue_date DESC, p.seq DESC, p.created_at DESC`)
    .map(toSummary)
    .filter((s) => matchesAll(`${s.number} ${s.buyerName}`, query.search))
    .filter((s) => !query.status || query.status === 'all' || s.status === query.status);
}

const nextSequence = (db: Db, fy: string): number => get<{ next: number }>(db, 'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM proformas WHERE fy = ?', fy)?.next ?? 1;

export function nextProformaNumber(db: Db, issueDate: string): string {
  if (!isIsoDate(issueDate)) throw new UserError('Enter a valid date.');
  const fy = financialYear(issueDate);
  return formatInvoiceNumber(getSettings(db).proformaPrefix, fy, nextSequence(db, fy));
}

/** A quote. It checks what an invoice would check, but takes nothing off the shelf and can be made for pieces you don't have yet. */
export function createProforma(db: Db, input: ProformaInput): Proforma {
  const settings = getSettings(db);
  if (!isIsoDate(input.validUntil)) throw new UserError('Enter a valid "valid until" date.');
  if (isIsoDate(input.issueDate) && input.validUntil < input.issueDate) throw new UserError("A proforma can't expire before its date.");
  const { type, customer, buyer, placeOfSupply, intraState, discount, notes } = checkDocument(db, settings, input);
  const seller = sellerSnapshot(settings, settings.proformaTerms || settings.invoiceTerms);

  const id = newId();
  tx(db, () => {
    const { items, totals } = priceLines(db, settings, input.lines, discount, intraState);
    const fy = financialYear(input.issueDate);
    const seq = nextSequence(db, fy);
    const number = formatInvoiceNumber(settings.proformaPrefix, fy, seq);
    const now = nowIso();
    try {
      run(
        db,
        `INSERT INTO proformas (id, number, fy, seq, type, customer_id, seller_json, buyer_json, place_of_supply, issue_date, valid_until, gst_rate_percent, intra_state,
           subtotal_paise, discount_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise, total_paise, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, number, fy, seq, type, customer?.id ?? null, JSON.stringify(seller), JSON.stringify(buyer), placeOfSupply, input.issueDate, input.validUntil, settings.gstRatePercent, intraState ? 1 : 0,
        totals.subtotalPaise, totals.discountPaise, totals.taxablePaise, totals.cgstPaise, totals.sgstPaise, totals.igstPaise, totals.roundOffPaise, totals.totalPaise, notes, now, now,
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new UserError('Another proforma took that number a moment ago. Please try again.');
      throw err;
    }
    for (const i of items) {
      run(
        db,
        'INSERT INTO proforma_lines (id, proforma_id, variant_id, position, design_name, color, size, sku, hsn, qty, unit_price_paise, amount_paise) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        newId(), id, i.variant.id, i.index, i.design.name, i.variant.color, i.variant.size, i.variant.sku, i.design.hsn_code, i.l.qty, i.l.unitPricePaise, i.amount,
      );
    }
  });
  return getProforma(db, id);
}

export function cancelProforma(db: Db, id: string, reason: string): Proforma {
  const p = getProforma(db, id);
  if (p.status === 'cancelled') throw new UserError('This proforma is already cancelled.');
  if (p.status === 'converted') throw new UserError(`This proforma became invoice ${p.invoiceNumber}. Cancel that invoice instead.`);
  run(db, "UPDATE proformas SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?", nowIso(), optionalText(reason, 'Reason', 200), nowIso(), id);
  return getProforma(db, id);
}

/**
 * Turns the quote into a real invoice dated today, at the quoted prices. This is the moment stock is taken, so it fails (and
 * changes nothing) if the pieces aren't there. The proforma is then marked as invoiced and points at its invoice.
 */
export function convertProforma(db: Db, id: string): Invoice {
  const p = getProforma(db, id);
  if (p.status === 'cancelled') throw new UserError('This proforma was cancelled.');
  if (p.status === 'converted') throw new UserError(`This proforma is already invoice ${p.invoiceNumber}.`);
  const today = todayIso();
  const settings = getSettings(db);
  return tx(db, () => {
    const invoice = createInvoice(db, {
      type: p.type,
      customerId: p.customerId,
      buyerName: p.customerId ? undefined : p.buyer.name,
      issueDate: today,
      dueDate: p.type === 'B2B' ? addDays(today, settings.defaultDueDays) : today,
      discountPaise: p.discountPaise,
      notes: p.notes,
      lines: p.lines.map((l) => ({ variantId: l.variantId, qty: l.qty, unitPricePaise: l.unitPricePaise })),
    });
    run(db, "UPDATE proformas SET status = 'converted', invoice_id = ?, updated_at = ? WHERE id = ?", invoice.id, nowIso(), id);
    return invoice;
  });
}
