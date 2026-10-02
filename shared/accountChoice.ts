import type { PaymentAccount, PaymentMethod } from './types';

/** The kinds of account each way of paying usually goes into, best first. */
const KINDS_FOR: Record<PaymentMethod, PaymentAccount['kind'][]> = {
  cash: ['cash'],
  upi: ['upi', 'wallet', 'bank'],
  bank: ['bank'],
  cheque: ['bank'],
  card: ['bank', 'wallet'],
  other: [],
};

/** The account to suggest for a payment method: the first account of a fitting kind, or none if there isn't one. */
export function suggestAccount(method: PaymentMethod, accounts: PaymentAccount[]): string {
  for (const kind of KINDS_FOR[method]) {
    const match = accounts.find((a) => a.kind === kind);
    if (match) return match.id;
  }
  return '';
}
