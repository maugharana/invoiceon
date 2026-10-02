import { useEffect, useRef, useState, type FormEvent } from 'react';
import { suggestAccount } from '../../../shared/accountChoice';
import { addDays, todayIso } from '../../../shared/gst';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type Expense, type ExpenseStatus, type PaymentMethod } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, MoneyInput, Segmented, Select } from '../../components/ui';
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
  const vendors = useQuery(() => api.vendorsList());
  const accounts = settings.data?.paymentAccounts ?? [];
  const [date, setDate] = useState(expense?.date ?? todayIso());
  const [category, setCategory] = useState(expense?.category ?? defaultCategory);
  const [vendor, setVendor] = useState(expense?.vendor ?? '');
  const [amount, setAmount] = useState(expense?.amountPaise ?? 0);
  const [gst, setGst] = useState(expense?.gstPaise ?? 0);
  const [method, setMethod] = useState<PaymentMethod>(expense?.method ?? 'cash');
  const [reference, setReference] = useState(expense?.reference ?? '');
  const [note, setNote] = useState(expense?.note ?? '');
  const [status, setStatus] = useState<ExpenseStatus>(expense?.status ?? 'paid');
  const [dueDate, setDueDate] = useState(expense?.dueDate ?? addDays(todayIso(), 15));
  const [accountId, setAccountId] = useState(expense?.accountId ?? '');
  const accountTouched = useRef(!!expense);
  const [showGst, setShowGst] = useState((expense?.gstPaise ?? 0) > 0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The account follows the way of paying until it is chosen by hand.
  useEffect(() => {
    if (!accountTouched.current) setAccountId(suggestAccount(method, accounts));
  }, [method, settings.data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const input = { date, category, vendor, amountPaise: amount, gstPaise: showGst ? gst : 0, method, reference, note, accountId, status, dueDate: status === 'unpaid' ? dueDate : null };
    try {
      const saved = expense ? await api.expenseUpdate(expense.id, input) : await api.expenseCreate(input);
      refresh();
      toast.success(expense ? 'Expense updated' : status === 'unpaid' ? 'Bill recorded — mark it paid when you pay it' : 'Expense recorded');
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
            {expense ? 'Save changes' : status === 'unpaid' ? 'Record bill' : 'Record expense'}
          </Button>
        </>
      }
    >
      <form id="expense-form" onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount" hint={showGst ? 'The full amount, GST included' : undefined}>
            <MoneyInput value={amount} onChange={setAmount} aria-label="Amount" data-autofocus />
          </Field>
          <Field label="Date">
            <Input type="date" value={date} max={status === 'paid' ? todayIso() : undefined} onChange={(e) => setDate(e.target.value)} className="num" />
          </Field>
        </div>
        {showGst ? (
          <Field label="GST included in the amount" hint="Input tax you can set off against the GST you collect. Shown on the GST card and the Purchases report.">
            <MoneyInput value={gst} onChange={setGst} aria-label="GST amount" />
          </Field>
        ) : (
          <button type="button" onClick={() => setShowGst(true)} className="-mt-1 text-sm text-brand transition-colors hover:text-brand-hover">
            + This bill has GST on it
          </button>
        )}
        <Field label="Category" hint="Pick from your list or type a new one. Edit the list in Settings → Expense Categories.">
          <Input value={category} onChange={(e) => setCategory(e.target.value)} list="expense-categories" placeholder="e.g. Rent" maxLength={40} />
          <datalist id="expense-categories">
            {(settings.data?.expenseCategories ?? []).map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Paid to">
          <Input value={vendor} onChange={(e) => setVendor(e.target.value)} list="expense-vendors" placeholder="Optional — a shop, a person" maxLength={80} />
          <datalist id="expense-vendors">
            {(vendors.data ?? []).map((v) => (
              <option key={v.id} value={v.name} />
            ))}
          </datalist>
        </Field>
        <Segmented
          label="Is it paid?"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'paid', label: 'Paid' },
            { value: 'unpaid', label: 'Not paid yet' },
          ]}
        />
        {status === 'unpaid' && (
          <Field label="Due date" hint="It stays under “Bills to pay” until you mark it paid. Nothing leaves your cash or bank until then.">
            <Input type="date" value={dueDate} min={date} onChange={(e) => setDueDate(e.target.value)} className="num max-w-[12rem]" />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label={status === 'paid' ? 'Paid by' : 'To be paid by'}>
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
        {accounts.length > 0 && (
          <Field label={status === 'paid' ? 'Paid from account' : 'Will be paid from'}>
            <Select value={accountId} onChange={(e) => { accountTouched.current = true; setAccountId(e.target.value); }}>
              <option value="">Not recorded</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" maxLength={300} />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}
