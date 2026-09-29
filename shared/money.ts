// All money in InvoiceOn is stored and passed around as integer paise (₹1 = 100 paise).
// Floats never touch a stored amount; they only appear transiently for quantity × rate maths.

export type Paise = number;

/** quantity × unit price, rounded to the nearest paisa. */
export function mulPaise(qty: number, unitPaise: Paise): Paise {
  return Math.round(qty * unitPaise);
}

/** "₹1,23,456.00" — Indian digit grouping. fractionDigits 0 rounds to whole rupees (for headline figures). */
export function formatMoney(paise: Paise, opts: { fractionDigits?: 0 | 2; symbol?: boolean } = {}): string {
  const { fractionDigits = 2, symbol = true } = opts;
  const abs = Math.abs(paise);
  const rupees = fractionDigits === 0 ? Math.round(abs / 100) : abs / 100;
  const body = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(rupees);
  return `${paise < 0 ? '−' : ''}${symbol ? '₹' : ''}${body}`;
}

/** Short form for chart axes, in Indian units: ₹950, ₹12K, ₹1.5L, ₹2.3Cr. */
export function formatCompactMoney(paise: Paise): string {
  const rupees = Math.abs(paise) / 100;
  const trim = (n: number) => String(+n.toFixed(1));
  const body = rupees >= 1e7 ? `${trim(rupees / 1e7)}Cr` : rupees >= 1e5 ? `${trim(rupees / 1e5)}L` : rupees >= 1e3 ? `${trim(rupees / 1e3)}K` : String(Math.round(rupees));
  return `${paise < 0 ? '−' : ''}₹${body}`;
}

/** Parses what a person types into a rupee field ("1,250", "₹ 99.5", "12.05") into paise. Null if not a valid amount. */
export function parseMoney(input: string): Paise | null {
  const cleaned = input.replace(/[₹,\s]/g, '');
  if (cleaned === '') return null;
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? '').padEnd(2, '0'));
  const paise = whole * 100 + frac;
  return Number.isSafeInteger(paise) ? paise : null;
}

/** Paise → the string shown inside an editable rupee field ("1250" or "1250.50"). */
export function moneyToInput(paise: Paise): string {
  if (paise === 0) return '';
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
}
