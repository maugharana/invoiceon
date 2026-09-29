import type { Invoice, Proforma } from '../../shared/types';

/**
 * A proforma has the same content as an invoice, so the invoice document draws it directly. "Valid until" plays the part of the
 * due date, a cancelled quote gets the cancelled watermark, and there is never anything paid.
 */
export function proformaAsInvoice(p: Proforma): Invoice {
  return {
    id: p.id,
    number: p.number,
    type: p.type,
    customerId: p.customerId,
    buyerName: p.buyerName,
    issueDate: p.issueDate,
    dueDate: p.validUntil,
    totalPaise: p.totalPaise,
    paidPaise: 0,
    status: p.status === 'cancelled' ? 'cancelled' : 'unpaid',
    seller: p.seller,
    branding: p.branding,
    buyer: p.buyer,
    placeOfSupply: p.placeOfSupply,
    gstRatePercent: p.gstRatePercent,
    intraState: p.intraState,
    subtotalPaise: p.subtotalPaise,
    discountPaise: p.discountPaise,
    taxablePaise: p.taxablePaise,
    cgstPaise: p.cgstPaise,
    sgstPaise: p.sgstPaise,
    igstPaise: p.igstPaise,
    roundOffPaise: p.roundOffPaise,
    notes: p.notes,
    lines: p.lines,
    payments: [],
    cancelledAt: p.cancelledAt,
    cancelReason: p.cancelReason,
    createdAt: p.createdAt,
  };
}
