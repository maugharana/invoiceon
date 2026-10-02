import { addDays } from './gst';

/** Credit limit and payment terms: what a new invoice would do to what a customer owes, and when it falls due. */

export interface CreditCheck {
  /** True when the invoice would take what they owe past their limit. Always false when no limit is set. */
  overLimit: boolean;
  limitPaise: number;
  /** What they owe after this invoice. */
  afterPaise: number;
  /** By how much it goes over; 0 when it doesn't. */
  excessPaise: number;
}

/** A limit of 0 means "no limit". */
export function checkCredit(limitPaise: number, outstandingPaise: number, newInvoicePaise: number): CreditCheck {
  const afterPaise = outstandingPaise + newInvoicePaise;
  const overLimit = limitPaise > 0 && afterPaise > limitPaise;
  return { overLimit, limitPaise, afterPaise, excessPaise: overLimit ? afterPaise - limitPaise : 0 };
}

/** The due date a customer's payment terms give an invoice, or null if they have no terms. 0 days means due on the day. */
export function dueDateFromTerms(issueDate: string, termsDays: number | null | undefined): string | null {
  if (termsDays == null) return null;
  return addDays(issueDate, termsDays);
}
