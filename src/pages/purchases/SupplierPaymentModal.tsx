import { useMemo, useState, type FormEvent } from 'react';
import { todayIso } from '../../../shared/gst';
import { formatMoney } from '../../../shared/money';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentMethod, type PurchaseBillSummary, type Supplier } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, Money, MoneyInput, Select } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';

const owed = (b: PurchaseBillSummary) => b.totalPaise - b.paidPaise;

/** Pay a supplier. The money goes to their open bills, oldest first (or as you choose); anything over is held as an advance with them. */
export function SupplierPaymentModal({ supplier, bill, onClose }: { supplier: Supplier; bill?: PurchaseBillSummary | null; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const open = useQuery(() => api.purchaseBillsList({ supplierId: supplier.id, status: 'open' }), [supplier.id]);
  // The bill you came from is settled first, then oldest due date first.
  const bills = useMemo(
    () =>
      [...(open.data ?? [])]
        .filter((b) => owed(b) > 0)
        .sort((a, b) => (a.id === bill?.id ? -1 : b.id === bill?.id ? 1 : (a.dueDate ?? a.billDate).localeCompare(b.dueDate ?? b.billDate))),
    [open.data, bill?.id],
  );
  const [amount, setAmount] = useState(bill ? owed(bill) : 0);
  const [paidOn, setPaidOn] = useState(todayIso());
  const [method, setMethod] = useState<PaymentMethod>('bank');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const plan = useMemo(() => {
    let left = amount;
    const out: { bill: PurchaseBillSummary; take: number }[] = [];
    for (const b of bills) {
      const take = Math.min(left, owed(b));
      if (take > 0) out.push({ bill: b, take });
      left -= take;
    }
    return { rows: out, advance: left };
  }, [amount, bills]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.supplierPaymentRecord({ supplierId: supplier.id, amountPaise: amount, method, reference, paidOn, note, allocations: plan.rows.map((r) => ({ billId: r.bill.id, amountPaise: r.take })) });
      refresh();
      toast.success(plan.advance > 0 ? `${formatMoney(amount)} paid, ${formatMoney(plan.advance)} held as advance` : `${formatMoney(amount)} paid to ${supplier.name}`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Pay ${supplier.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="supplier-payment-form" loading={saving} disabled={amount <= 0}>
            Record payment
          </Button>
        </>
      }
    >
      <form id="supplier-payment-form" onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount">
            <MoneyInput value={amount} onChange={setAmount} aria-label="Amount" data-autofocus />
          </Field>
          <Field label="Date">
            <Input type="date" value={paidOn} max={todayIso()} onChange={(e) => setPaidOn(e.target.value)} className="num" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Paid by">
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reference">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." maxLength={60} />
          </Field>
        </div>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" maxLength={200} />
        </Field>
        {amount > 0 && (
          <div className="rounded-lg bg-canvas px-4 py-3 text-xs text-ink-muted">
            {plan.rows.length === 0 ? (
              <p>You have no open bills with {supplier.name}, so this is held as an advance.</p>
            ) : (
              <ul className="space-y-0.5">
                {plan.rows.map((r) => (
                  <li key={r.bill.id}>
                    <Money paise={r.take} /> goes to bill <span className="num">{r.bill.billNumber}</span>
                  </li>
                ))}
              </ul>
            )}
            {plan.advance > 0 && plan.rows.length > 0 && (
              <p className="mt-1">
                <Money paise={plan.advance} /> is held as an advance with {supplier.name}, ready for their next bill.
              </p>
            )}
          </div>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}
