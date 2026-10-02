import { useState } from 'react';
import type { Invoice } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, Money, MoneyInput } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useRefresh } from '../../lib/data';

/** Writes off all or part of what is left on an invoice: for a small shortfall you will not chase. No money comes in. */
export function WriteOffModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const balance = invoice.totalPaise - invoice.paidPaise;
  const [amount, setAmount] = useState(balance);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api.paymentWriteOff({ invoiceId: invoice.id, amountPaise: amount, reason });
      refresh();
      toast.success('Balance written off');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Write off on ${invoice.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={saving} disabled={amount <= 0 || amount > balance} onClick={() => void submit()}>
            Write off
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-muted">
          <Money paise={balance} /> is still owed. Writing it off settles the invoice without any money coming in, so it never counts as received. You can reverse it later from the Payments list.
        </p>
        <Field label="Amount to write off">
          <MoneyInput value={amount} onChange={setAmount} data-autofocus />
        </Field>
        <Field label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional — e.g. small shortfall, goodwill" />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}
