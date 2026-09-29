import { useState, type FormEvent } from 'react';
import { todayIso } from '../../../shared/gst';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type Expense, type PaymentMethod } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, MoneyInput, Select } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';

interface Props {
  /** Existing expense when editing. */
  expense?: Expense;
  /** Start with this category (from the expenses list filter). */
  defaultCategory?: string;
  onClose: () => void;
  onSaved?: (expense: Expense) => void;
}

export function ExpenseFormModal({ expense, defaultCategory = '', onClose, onSaved }: Props) {
  const toast = useToast();
  const refresh = useRefresh();
  const settings = useQuery(() => api.getSettings());
  const [date, setDate] = useState(expense?.date ?? todayIso());
  const [category, setCategory] = useState(expense?.category ?? defaultCategory);
  const [vendor, setVendor] = useState(expense?.vendor ?? '');
  const [amount, setAmount] = useState(expense?.amountPaise ?? 0);
  const [method, setMethod] = useState<PaymentMethod>(expense?.method ?? 'cash');
  const [reference, setReference] = useState(expense?.reference ?? '');
  const [note, setNote] = useState(expense?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const input = { date, category, vendor, amountPaise: amount, method, reference, note };
    try {
      const saved = expense ? await api.expenseUpdate(expense.id, input) : await api.expenseCreate(input);
      refresh();
      toast.success(expense ? 'Expense updated' : 'Expense recorded');
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={expense ? 'Edit expense' : 'New expense'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="expense-form" loading={saving}>
            {expense ? 'Save changes' : 'Record expense'}
          </Button>
        </>
      }
    >
      <form id="expense-form" onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount">
            <MoneyInput value={amount} onChange={setAmount} aria-label="Amount" data-autofocus />
          </Field>
          <Field label="Date">
            <Input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} className="num" />
          </Field>
        </div>
        <Field label="Category" hint="Pick from your list or type a new one. Edit the list in Settings → Expense Categories.">
          <Input value={category} onChange={(e) => setCategory(e.target.value)} list="expense-categories" placeholder="e.g. Rent" maxLength={40} />
          <datalist id="expense-categories">
            {(settings.data?.expenseCategories ?? []).map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Paid to">
          <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Optional — a shop, a person" maxLength={80} />
        </Field>
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
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / bill no." maxLength={60} />
          </Field>
        </div>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" maxLength={300} />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}
