import { Banknote, Building2, Plus, Smartphone, Trash2, Wallet, type LucideIcon } from 'lucide-react';
import { PAYMENT_ACCOUNT_KINDS, type PaymentAccount, type PaymentAccountKind } from '../../../shared/types';
import { Button, Field, Input, MoneyInput, Select } from '../../components/ui';
import type { SectionProps } from './draft';

const KIND: Record<PaymentAccountKind, { label: string; icon: LucideIcon; placeholder: string }> = {
  bank: { label: 'Bank account', icon: Building2, placeholder: 'A/c number · IFSC' },
  cash: { label: 'Cash', icon: Banknote, placeholder: 'e.g. Shop drawer' },
  upi: { label: 'UPI', icon: Smartphone, placeholder: 'name@bank' },
  wallet: { label: 'Wallet / other', icon: Wallet, placeholder: 'Details' },
};

export function PaymentAccountsSection({ draft, set }: SectionProps) {
  const list = draft.paymentAccounts;
  const change = (id: string, patch: Partial<PaymentAccount>) => set('paymentAccounts', list.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  return (
    <div className="space-y-5">
      <p className="rounded-lg bg-canvas px-3 py-2 text-ink-muted">Where your money is kept. Each payment and bill can be recorded against one, and Payments → Cash & accounts shows what is in each. They also feed “Payment Instructions”. Enter what each held when you started recording here.</p>

      {list.length === 0 && <p className="text-ink-muted">No accounts yet.</p>}
      <ul className="space-y-3">
        {list.map((a) => {
          const Icon = KIND[a.kind].icon;
          return (
            <li key={a.id} className="grid grid-cols-[auto_1fr_11rem_auto] items-start gap-x-3 gap-y-2 rounded-lg border border-line p-3">
              <div className="row-span-2 flex h-9 w-9 items-center justify-center rounded-full bg-brand-tint text-brand">
                <Icon className="h-4 w-4" aria-hidden />
              </div>
              <Input value={a.name} onChange={(e) => change(a.id, { name: e.target.value })} placeholder="Account name" aria-label="Account name" maxLength={60} />
              <Select value={a.kind} onChange={(e) => change(a.id, { kind: e.target.value as PaymentAccountKind })} aria-label="Account type">
                {PAYMENT_ACCOUNT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND[k].label}
                  </option>
                ))}
              </Select>
              <button type="button" aria-label={`Remove ${a.name || 'account'}`} onClick={() => set('paymentAccounts', list.filter((x) => x.id !== a.id))} className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-status-overdue-bg hover:text-status-overdue-fg">
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
              <Input className="col-span-2" value={a.details} onChange={(e) => change(a.id, { details: e.target.value })} placeholder={KIND[a.kind].placeholder} aria-label="Account details" maxLength={200} />
              <div className="col-start-2 col-span-2">
                <Field label="Balance when you started" hint="Money already in it before you began recording">
                  <MoneyInput value={a.openingPaise ?? 0} onChange={(p) => change(a.id, { openingPaise: p })} className="max-w-[12rem]" />
                </Field>
              </div>
            </li>
          );
        })}
      </ul>

      <Button icon={<Plus className="h-4 w-4" />} onClick={() => set('paymentAccounts', [...list, { id: crypto.randomUUID(), name: '', kind: 'bank', details: '', openingPaise: 0 }])}>
        Add account
      </Button>
    </div>
  );
}
