import { useMemo, useState, type FormEvent } from 'react';
import { formatDate, todayIso } from '../../../shared/gst';
import { formatMoney } from '../../../shared/money';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type Customer, type InvoiceSummary, type PaymentMethod } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, InvoicePill, Money, MoneyInput, Segmented, Select } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { navigate, paths } from '../../lib/router';

interface Props {
  /** Start with this customer chosen (from a customer's page). */
  customer?: Customer | null;
  /** Start from one invoice: its balance is prefilled and it is settled first. Walk-in invoices have no customer. */
  invoice?: InvoiceSummary | null;
  onClose: () => void;
  onDone?: () => void;
}

const owed = (i: InvoiceSummary) => i.totalPaise - i.paidPaise;

// How the money is shared out is a habit: some people always want oldest-first, others always pick. The choice is remembered.
type Share = 'oldest' | 'pick';
const SHARE_KEY = 'invoiceon.payment.share';
function loadShare(): Share {
  try {
    return localStorage.getItem(SHARE_KEY) === 'pick' ? 'pick' : 'oldest';
  } catch {
    return 'oldest';
  }
}

export function RecordPaymentModal({ customer: presetCustomer = null, invoice: presetInvoice = null, onClose, onDone }: Props) {
  const toast = useToast();
  const refresh = useRefresh();
  const customers = useQuery(() => api.customersList());

  // A walk-in invoice has no customer to choose. Otherwise the customer is either preset or picked here.
  const walkIn = !!presetInvoice && !presetInvoice.customerId;
  const [customerId, setCustomerId] = useState<string>(presetCustomer?.id ?? presetInvoice?.customerId ?? '');
  const customer = customers.data?.find((c) => c.id === customerId) ?? presetCustomer;

  const openInvoices = useQuery(
    () => (walkIn ? Promise.resolve([presetInvoice!]) : customerId ? api.invoicesList({ customerId, status: 'open' }) : Promise.resolve([] as InvoiceSummary[])),
    [customerId, walkIn],
  );
  // The invoice you came from is settled first, then oldest due date first.
  const invoices = useMemo(
    () =>
      [...(openInvoices.data ?? [])]
        .filter((i) => owed(i) > 0)
        .sort((a, b) => (a.id === presetInvoice?.id ? -1 : b.id === presetInvoice?.id ? 1 : (a.dueDate ?? a.issueDate).localeCompare(b.dueDate ?? b.issueDate))),
    [openInvoices.data, presetInvoice?.id],
  );

  const [amount, setAmount] = useState(presetInvoice ? owed(presetInvoice) : 0);
  const [receivedOn, setReceivedOn] = useState(todayIso());
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [share, setShareState] = useState<Share>(loadShare);
  const [manual, setManual] = useState<Record<string, number> | null>(null); // null = automatic (oldest first), or empty when picking
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const auto = useMemo(() => {
    let left = amount;
    const out: Record<string, number> = {};
    for (const i of invoices) {
      const take = Math.min(left, owed(i));
      if (take > 0) out[i.id] = take;
      left -= take;
    }
    return out;
  }, [amount, invoices]);
  const alloc = manual ?? (share === 'pick' ? {} : auto);
  const setShare = (next: Share) => {
    setShareState(next);
    setManual(null);
    try {
      localStorage.setItem(SHARE_KEY, next);
    } catch {
      /* remembering the choice is a nicety */
    }
  };
  const applied = invoices.reduce((s, i) => s + (alloc[i.id] ?? 0), 0);
  const advance = amount - applied;
  const over = invoices.find((i) => (alloc[i.id] ?? 0) > owed(i));
  const canAdvance = !!customerId && !walkIn;

  const problem =
    amount <= 0
      ? 'Enter the amount received.'
      : !walkIn && !customerId
        ? 'Choose the customer.'
        : applied > amount
          ? 'More is applied to invoices than was received.'
          : over
            ? `${over.number} only has ${formatMoney(owed(over))} left to pay.`
            : advance > 0 && !canAdvance
              ? 'The whole amount must go to the invoice — there is no customer to hold the rest for.'
              : receivedOn > todayIso()
                ? 'The payment date can\'t be in the future.'
                : null;

  function setAllocation(invoiceId: string, value: number) {
    setManual({ ...alloc, [invoiceId]: value });
  }

  async function save() {
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      await api.paymentRecord({
        customerId: customerId || null,
        amountPaise: amount,
        method,
        reference,
        receivedOn,
        note,
        allocations: invoices.filter((i) => (alloc[i.id] ?? 0) > 0).map((i) => ({ invoiceId: i.id, amountPaise: alloc[i.id]! })),
      });
      refresh();
      toast.success(advance > 0 ? `${formatMoney(amount)} recorded — ${formatMoney(advance)} held as advance` : `${formatMoney(amount)} payment recorded`);
      onDone?.();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  /** Pure advance: hand the money to the New invoice screen, where it's recorded together with the invoice. */
  function recordWithInvoice() {
    if (problem) return setError(problem);
    onClose();
    navigate(paths.newInvoice(customerId, { amountPaise: amount, method, reference }));
  }

  const pureAdvance = amount > 0 && applied === 0 && canAdvance;

  return (
    <Modal
      title={presetInvoice ? `Record payment — ${presetInvoice.number}` : 'Record payment'}
      size="lg"
      onClose={onClose}
      footer={
        pureAdvance ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button loading={saving} disabled={!!problem} onClick={() => void save()}>
              Hold as advance
            </Button>
            <Button variant="primary" disabled={!!problem || saving} onClick={recordWithInvoice}>
              Record &amp; create invoice
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" form="payment-form" loading={saving} disabled={!!problem}>
              Record payment
            </Button>
          </>
        )
      }
    >
      <form
        id="payment-form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-5"
      >
        {!walkIn && (
          <Field label="Customer">
            {presetCustomer || presetInvoice ? (
              <div className="flex h-9 items-center rounded-lg border border-line bg-canvas px-3">{customer?.name ?? presetInvoice?.buyerName}</div>
            ) : (
              <Select value={customerId} onChange={(e) => { setCustomerId(e.target.value); setManual(null); }} data-autofocus>
                <option value="">Choose a customer…</option>
                {customers.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.outstandingPaise > 0 ? ` — owes ${formatMoney(c.outstandingPaise, { fractionDigits: 0 })}` : c.advancePaise > 0 ? ` — advance ${formatMoney(c.advancePaise, { fractionDigits: 0 })}` : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        <div className="grid grid-cols-4 gap-4">
          <Field label="Amount received">
            <MoneyInput value={amount} onChange={(p) => { setAmount(p); setManual(null); }} {...(presetCustomer || presetInvoice ? { 'data-autofocus': true } : {})} />
          </Field>
          <Field label="Date">
            <Input type="date" value={receivedOn} max={todayIso()} onChange={(e) => setReceivedOn(e.target.value)} className="num" />
          </Field>
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reference">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." />
          </Field>
        </div>

        {/* Where the money goes */}
        <div className="rounded-lg border border-line">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-xs font-medium text-ink-muted">Apply to</span>
            <span className="flex items-center gap-3">
              {manual && share === 'oldest' && (
                <button type="button" onClick={() => setManual(null)} className="text-xs text-brand transition-colors hover:text-brand-hover">
                  Reset to oldest first
                </button>
              )}
              <Segmented
                label="How to share the payment"
                value={share}
                onChange={setShare}
                options={[
                  { value: 'oldest', label: 'Oldest first' },
                  { value: 'pick', label: "I'll choose" },
                ]}
              />
            </span>
          </div>
          {!customerId && !walkIn ? (
            <p className="px-4 py-4 text-ink-muted">Choose a customer to see what they owe.</p>
          ) : openInvoices.loading ? (
            <p className="px-4 py-4 text-ink-muted">Loading…</p>
          ) : invoices.length === 0 ? (
            <p className="px-4 py-4 text-ink-muted">{customer?.name ?? 'This customer'} has no unpaid invoices, so this will be an advance.</p>
          ) : (
            <ul>
              {invoices.map((i) => (
                <li key={i.id} className="grid grid-cols-[1fr_auto_14rem] items-center gap-4 border-b border-line/70 px-4 py-2.5 last:border-0">
                  <div className="min-w-0">
                    <div className="num">{i.number}</div>
                    <div className="text-xs text-ink-muted">Due {i.dueDate ? formatDate(i.dueDate) : '—'}</div>
                  </div>
                  <div className="flex items-center gap-3 text-right">
                    <InvoicePill status={i.status} />
                    <span className="text-xs text-ink-muted">
                      owes <Money paise={owed(i)} />
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {share === 'pick' && (
                      <button type="button" onClick={() => setAllocation(i.id, Math.min(owed(i), Math.max(0, amount - applied + (alloc[i.id] ?? 0))))} disabled={amount - applied + (alloc[i.id] ?? 0) <= 0} className="whitespace-nowrap text-xs text-brand transition-colors hover:text-brand-hover disabled:text-ink-muted/50">
                        Pay in full
                      </button>
                    )}
                    <MoneyInput value={alloc[i.id] ?? 0} onChange={(p) => setAllocation(i.id, p)} aria-label={`Apply to ${i.number}`} className="h-8" />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-1 border-t border-line bg-canvas px-4 py-3">
            <div className="flex justify-between">
              <span className="text-ink-muted">On invoices</span>
              <Money paise={applied} />
            </div>
            <div className="flex justify-between">
              <span className={advance > 0 ? 'text-ink' : 'text-ink-muted'}>Held as advance</span>
              <span key={advance} className={`animate-tick ${advance < 0 ? 'text-status-overdue-fg' : ''}`}>
                <Money paise={advance} />
              </span>
            </div>
          </div>
        </div>

        {advance > 0 && canAdvance && (
          <p className="text-xs text-ink-muted">
            {pureAdvance
              ? `Nothing here is on an invoice yet. Choose “Record & create invoice” to issue the invoice now with this payment attached, or “Hold as advance” to keep it on ${customer?.name ?? 'the customer'} until their invoice is ready — it will be applied then.`
              : `${formatMoney(advance)} is more than these invoices need. It will be held as advance and applied to ${customer?.name ?? 'the customer'}'s next invoice.`}
          </p>
        )}
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        {!error && problem && amount > 0 && <p className="text-xs text-status-overdue-fg">{problem}</p>}
      </form>
    </Modal>
  );
}
