// Sharing an invoice or a reminder: message templates, WhatsApp and email links, and the UPI payment link behind the QR code.
// All pure, so what gets sent is easy to test.

export const DEFAULT_INVOICE_MESSAGE = `Hello {customer},

Thank you for shopping with {business}. Your invoice {number} for {total} is ready.{dueLine}{upiLine}

Regards,
{business}`;

export const DEFAULT_REMINDER_MESSAGE = `Hello {customer},

A gentle reminder from {business}: {owedLine}
{invoices}{upiLine}

Please ignore this if you have already paid. Thank you!`;

export const DEFAULT_EMAIL_SUBJECT = 'Invoice {number} from {business}';

/**
 * Fills {placeholders} in a template. An unknown or empty placeholder becomes nothing, and the blank lines that leaves behind are
 * tidied, so a template never sends "{typo}" to a customer.
 */
export function renderTemplate(template: string, vars: Record<string, string | number | undefined>): string {
  return template
    .replace(/\{(\w+)\}/g, (_m, key: string) => String(vars[key] ?? ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * A phone number as WhatsApp wants it: digits only with the country code. Ten digit Indian numbers get 91; a leading 0 is dropped;
 * anything that cannot be a phone number gives null, so the link opens WhatsApp's own "choose a contact" instead of a wrong chat.
 */
export function whatsappNumber(phone: string, defaultCountry = '91'): string | null {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = defaultCountry + digits;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

export function whatsappUrl(phone: string, text: string): string {
  const n = whatsappNumber(phone);
  return `https://wa.me/${n ?? ''}?text=${encodeURIComponent(text)}`;
}

export function mailtoUrl(email: string, subject: string, body: string): string {
  return `mailto:${email.trim()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** A UPI id looks like name@bank. */
export const isValidUpiId = (id: string): boolean => /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9]{1,32}$/.test(id.trim());

/** The link a UPI app opens to pay: scanning the QR code on an invoice fills in who to pay, how much and what for. */
export function upiPaymentLink(o: { upiId: string; payeeName: string; amountPaise: number; note: string }): string {
  const params = [`pa=${encodeURIComponent(o.upiId.trim())}`, `pn=${encodeURIComponent(o.payeeName.trim().slice(0, 40))}`];
  if (o.amountPaise > 0) params.push(`am=${(o.amountPaise / 100).toFixed(2)}`);
  params.push('cu=INR', `tn=${encodeURIComponent(o.note.trim().slice(0, 40))}`);
  return `upi://pay?${params.join('&')}`;
}
