import type { Settings } from './types';

export interface OnboardingStep {
  id: 'profile' | 'gstin' | 'payments' | 'saree' | 'customer' | 'invoice';
  label: string;
  hint: string;
  done: boolean;
  /** Where to go to do it. */
  path: string;
}

/**
 * The first things worth doing in a new shop's book, each ticked off by what's actually in it (not by clicking), so the list
 * can't drift from reality. B2B tax invoices need your GSTIN, which is why it has its own step.
 */
export function onboardingSteps(settings: Pick<Settings, 'businessName' | 'addressLine' | 'gstin' | 'invoiceBank' | 'upiId'>, counts: { designs: number; customers: number; invoices: number }): OnboardingStep[] {
  return [
    { id: 'profile', label: 'Add your business details', hint: 'Name and address are printed on every invoice.', done: !!settings.businessName.trim() && !!settings.addressLine.trim(), path: '/settings/business' },
    { id: 'gstin', label: 'Enter your GSTIN', hint: 'Needed to issue B2B tax invoices.', done: !!settings.gstin.trim(), path: '/settings/business' },
    { id: 'payments', label: 'Say how customers can pay you', hint: 'Bank or UPI details, and a QR code on the invoice.', done: !!settings.invoiceBank.trim() || !!settings.upiId.trim(), path: '/settings/instructions' },
    { id: 'saree', label: 'Add your first sarees', hint: 'Paste a sheet from Excel, or add them one by one.', done: counts.designs > 0, path: '/inventory/add' },
    { id: 'customer', label: 'Add a customer', hint: 'Or skip this and bill walk-in customers.', done: counts.customers > 0, path: '/customers' },
    { id: 'invoice', label: 'Issue your first invoice', hint: 'Stock comes off the shelf automatically.', done: counts.invoices > 0, path: '/invoices/new' },
  ];
}

export const onboardingDone = (steps: OnboardingStep[]): boolean => steps.every((s) => s.done);
