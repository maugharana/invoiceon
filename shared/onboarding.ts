// The "Getting started" checklist on a new installation. Each step says whether it is already done, worked out from the data itself, so it
// ticks itself as the owner sets things up and never needs to be told.

export type OnboardingStepId = 'profile' | 'sarees' | 'customers' | 'invoice' | 'backup';

export interface OnboardingStep {
  id: OnboardingStepId;
  done: boolean;
}

export interface OnboardingStatus {
  steps: OnboardingStep[];
  /** Hidden by the owner, or finished. */
  dismissed: boolean;
}

export const ONBOARDING_LABEL: Record<OnboardingStepId, { title: string; hint: string }> = {
  profile: { title: 'Tell us about your business', hint: 'Address, phone and GSTIN print on every invoice.' },
  sarees: { title: 'Add your sarees', hint: 'Paste them from a spreadsheet, or type them in.' },
  customers: { title: 'Add your customers', hint: 'Paste or upload your list. Duplicates are skipped.' },
  invoice: { title: 'Make your first invoice', hint: 'Pick a customer, add sarees, print or send it.' },
  backup: { title: 'Keep a copy off this computer', hint: 'A synced folder or a USB drive protects the books.' },
};
