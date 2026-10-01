/** A UPI ID looks like "name@bank": letters, digits, dots, dashes or underscores, an @, then the bank's handle. */
export const isValidUpiId = (id: string): boolean => /^[A-Za-z0-9._-]{2,}@[A-Za-z][A-Za-z0-9]{1,}$/.test(id);

/**
 * The link a UPI app reads from a QR code to open a payment with the payee, amount and note already filled in. The amount is
 * rupees to two decimals; leave it out (0) and the customer types it themselves.
 */
export function upiPayLink(p: { upiId: string; payeeName: string; amountPaise: number; note: string }): string {
  const q = [`pa=${encodeURIComponent(p.upiId)}`, `pn=${encodeURIComponent(p.payeeName)}`];
  if (p.amountPaise > 0) q.push(`am=${(p.amountPaise / 100).toFixed(2)}`);
  q.push('cu=INR');
  if (p.note) q.push(`tn=${encodeURIComponent(p.note)}`);
  return `upi://pay?${q.join('&')}`;
}
