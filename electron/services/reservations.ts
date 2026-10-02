import { todayIso } from '../../shared/gst';
import { all, type Db } from '../db/connection';

// A quote can hold its pieces for the customer until it lapses. Nothing leaves the shelf (stock stays physical); the held pieces are
// simply not for sale to anyone else. A held piece frees itself when the quote is invoiced, lost, cancelled or past its date.

export interface Held {
  qty: number;
  /** The numbers of the quotes holding it, for the message that says why. */
  quotes: string[];
}

/** For each variant, the pieces held by quotes that are still live (not lapsed, lost, cancelled or fully invoiced). */
export function heldByQuotes(db: Db, exceptQuoteId = '', today: string = todayIso()): Map<string, Held> {
  const out = new Map<string, Held>();
  for (const r of all<{ variant_id: string; left: number; number: string }>(
    db,
    `SELECT l.variant_id, l.qty - l.invoiced_qty AS left, p.number
     FROM proforma_lines l JOIN proformas p ON p.id = l.proforma_id
     WHERE p.reserve_stock = 1 AND p.status = 'open' AND p.stage <> 'lost' AND p.valid_until >= ? AND p.id <> ? AND l.qty > l.invoiced_qty
     ORDER BY p.issue_date, p.seq`,
    today,
    exceptQuoteId,
  )) {
    const h = out.get(r.variant_id) ?? { qty: 0, quotes: [] };
    h.qty += r.left;
    if (!h.quotes.includes(r.number)) h.quotes.push(r.number);
    out.set(r.variant_id, h);
  }
  return out;
}
