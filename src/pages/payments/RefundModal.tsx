import { useState, type FormEvent } from 'react';
import { todayIso } from '../../../shared/gst';
import { formatMoney } from '../../../shared/money';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type Customer, type PaymentMethod } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, MoneyInput, Select } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';

/** Gives back money a customer is holding with us: an advance they paid, or credit left by a credit note. It is money out. */
export function RefundModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const settings = useQuery(() => api.getSettings());
  const held = customer.advancePaise;
  const [amount, setAmount] = useState(held);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const accounts = settings.data?.paymentAccounts ?? [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.paymentRefund({ customerId: customer.id, amountPaise: amount, method, date, accountId: accountId || undefined, reference, note });
      refresh();
      toast.success(`${formatMoney(amount)} refunded to ${customer.name}`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Refund ${customer.name}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="refund-form" loading={saving} disabled={amount <= 0 || amount > held}>
            Refund {amount > 0 ? formatMoney(amount) : ''}
          </Button>
        </>
      }
    >
      <form id="refund-form" onSubmit={submit} className="space-y-4">
        <p className="text-ink-muted">
          {customer.name} is holding <span className="num text-ink">{formatMoney(held)}</span> with you (an advance, or credit from a credit note). Refunding gives that money back to them. It is paid out of the account you choose, and it comes off what you hold for them.
        </p>
        <Field label="Amount to give back" error={amount > held ? `They are holding only ${formatMoney(held)}` : undefined}>
          <MoneyInput value={amount} onChange={setAmount} data-autofocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Paid back by">
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date">
            <Input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {accounts.length > 0 && (
          <Field label="Taken from">
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Not linked to an account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Reference">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / note" />
          </Field>
          <Field label="Note">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}
