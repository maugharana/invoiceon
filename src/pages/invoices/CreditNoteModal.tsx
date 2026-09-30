import { useMemo, useState, type FormEvent } from 'react';
import { creditedTaxable, lineNetAmounts, previewCredit, splitCredit } from '../../../shared/credit';
import { todayIso } from '../../../shared/gst';
import { formatMoney } from '../../../shared/money';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type CreditNoteKind, type Invoice, type PaymentMethod } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, Money, MoneyInput, Segmented, Select } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useRefresh } from '../../lib/data';
import { navigate, paths } from '../../lib/router';

const lineRate = (l: Invoice['lines'][number], inv: Invoice) => l.gstRatePercent ?? inv.gstRatePercent;

/**
 * Issue a credit note against an invoice: pick the pieces coming back (or an amount to take off the price), and say where the money
 * goes. The total shown is worked out with the same code the server uses, so it is the figure that will be saved.
 */
export function CreditNoteModal({ invoice: inv, onClose }: { invoice: Invoice; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [kind, setKind] = useState<CreditNoteKind>('return');
  const [issueDate, setIssueDate] = useState(todayIso());
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [adjustment, setAdjustment] = useState(0);
  const rates = useMemo(() => [...new Set(inv.lines.map((l) => lineRate(l, inv)))].sort((a, b) => a - b), [inv]);
  const [rate, setRate] = useState<number>(rates[0] ?? inv.gstRatePercent);
  const [refunding, setRefunding] = useState(false);
  const [refundAmount, setRefundAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const nets = useMemo(() => lineNetAmounts(inv.lines.map((l) => l.amountPaise), inv.discountPaise), [inv]);
  const outstanding = inv.totalPaise - inv.paidPaise;

  const items = useMemo(() => {
    if (kind === 'adjustment') return adjustment > 0 ? [{ taxablePaise: adjustment, ratePercent: rate }] : [];
    return inv.lines.flatMap((l, i) => {
      const q = qty[l.id] ?? 0;
      return q > 0 ? [{ taxablePaise: creditedTaxable(nets[i]!, l.qty, l.creditedQty ?? 0, q), ratePercent: lineRate(l, inv) }] : [];
    });
  }, [kind, adjustment, rate, qty, inv, nets]);

  const total = items.length ? previewCredit(items, inv.intraState).totalPaise : 0;
  // A walk-in sale has nobody to hold a credit for, so whatever the invoice doesn't still owe must go back as a refund.
  const mustRefund = !inv.customerId ? Math.max(0, total - Math.max(outstanding, 0)) : 0;
  const wanted = refunding ? (refundAmount ?? total) : mustRefund;
  const refund = Math.min(Math.max(wanted, mustRefund), total);
  const split = splitCredit(total, refund, outstanding);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const cn = await api.creditNoteCreate({
        invoiceId: inv.id,
        issueDate,
        kind,
        reason,
        notes,
        lines: kind === 'return' ? inv.lines.filter((l) => (qty[l.id] ?? 0) > 0).map((l) => ({ invoiceLineId: l.id, qty: qty[l.id]!, restock: restock[l.id] ?? true })) : undefined,
        adjustment: kind === 'adjustment' ? { taxablePaise: adjustment, ratePercent: rates.length > 1 ? rate : undefined } : undefined,
        refund: refund > 0 ? { amountPaise: refund, method, reference } : undefined,
      });
      refresh();
      toast.success(`${cn.number} issued`);
      onClose();
      navigate(paths.creditNote(cn.id));
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Credit note for ${inv.number}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="credit-note-form" loading={saving} disabled={total <= 0}>
            Issue credit note
          </Button>
        </>
      }
    >
      <form id="credit-note-form" onSubmit={submit} className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <Segmented
            label="Kind of credit note"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'return', label: 'Sales return' },
              { value: 'adjustment', label: 'Price adjustment' },
            ]}
          />
          <div className="w-40">
            <Input type="date" value={issueDate} min={inv.issueDate} max={todayIso()} onChange={(e) => setIssueDate(e.target.value)} className="num" aria-label="Credit note date" />
          </div>
        </div>

        {kind === 'return' ? (
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full">
              <thead className="bg-canvas text-xs text-ink-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Sold</th>
                  <th className="px-3 py-2 text-right font-medium">Returned</th>
                  <th className="w-24 px-3 py-2 text-right font-medium">Returning</th>
                  <th className="w-28 px-3 py-2 text-left font-medium">Back on shelf</th>
                </tr>
              </thead>
              <tbody>
                {inv.lines.map((l) => {
                  const left = l.qty - (l.creditedQty ?? 0);
                  return (
                    <tr key={l.id} className="border-t border-line/70">
                      <td className="px-3 py-2">
                        <div>{l.designName}</div>
                        <div className="text-xs text-ink-muted">{l.color} · {l.size}</div>
                      </td>
                      <td className="num px-3 py-2 text-right">{l.qty}</td>
                      <td className="num px-3 py-2 text-right text-ink-muted">{l.creditedQty ?? 0}</td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          max={left}
                          disabled={left <= 0}
                          value={qty[l.id] ?? 0}
                          onChange={(e) => setQty((q) => ({ ...q, [l.id]: Math.min(left, Math.max(0, Math.trunc(Number(e.target.value) || 0))) }))}
                          className="num text-right"
                          aria-label={`Quantity of ${l.designName} ${l.color} returned`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <label className="flex items-center gap-2 text-ink-muted">
                          <input type="checkbox" checked={restock[l.id] ?? true} onChange={(e) => setRestock((r) => ({ ...r, [l.id]: e.target.checked }))} className="h-4 w-4 accent-[#0F6E56]" />
                          Resaleable
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Amount to take off, before GST" hint={`Up to the ${formatMoney(inv.taxablePaise)} the invoice was for, before GST.`}>
              <MoneyInput value={adjustment} onChange={setAdjustment} aria-label="Amount to credit before GST" data-autofocus />
            </Field>
            {rates.length > 1 && (
              <Field label="GST rate" hint="This invoice has items at different rates.">
                <Select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
                  {rates.map((r) => (
                    <option key={r} value={r}>
                      {+r.toFixed(2)}%
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        )}

        <Field label={kind === 'adjustment' ? 'Reason (printed on the credit note)' : 'Reason'} hint={kind === 'return' ? 'Optional, e.g. colour not as expected.' : undefined}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'adjustment' ? 'e.g. Small flaw, agreed discount' : 'Optional'} maxLength={200} />
        </Field>

        <div className="rounded-lg border border-line p-4">
          <label className="flex cursor-pointer items-center gap-3">
            <input type="checkbox" checked={refunding || mustRefund > 0} disabled={mustRefund > 0} onChange={(e) => setRefunding(e.target.checked)} className="h-4 w-4 accent-[#0F6E56]" />
            <span>
              Pay money back to the customer
              {mustRefund > 0 && <span className="ml-2 text-xs text-ink-muted">Required: a walk-in sale has no account to keep a credit in.</span>}
            </span>
          </label>
          {(refunding || mustRefund > 0) && (
            <div className="mt-3 grid grid-cols-3 gap-4">
              <Field label="Refund amount">
                <MoneyInput value={refund} onChange={setRefundAmount} aria-label="Refund amount" />
              </Field>
              <Field label="Paid by">
                <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  {PAYMENT_METHODS.filter((m) => m !== 'other').map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABEL[m]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reference">
                <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR" maxLength={60} />
              </Field>
            </div>
          )}
        </div>

        <Field label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, printed on the credit note" maxLength={300} />
        </Field>

        <div className="rounded-lg bg-canvas px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-ink-muted">Credit note total, GST included</span>
            <Money paise={total} className="text-base" />
          </div>
          {total > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-ink-muted">
              {split.toInvoice > 0 && (
                <li>
                  <Money paise={split.toInvoice} /> comes off what {inv.buyerName} still owes on this invoice.
                </li>
              )}
              {split.held > 0 && (
                <li>
                  <Money paise={split.held} /> is kept as credit for {inv.buyerName}, to use on their next invoice.
                </li>
              )}
              {split.refund > 0 && (
                <li>
                  <Money paise={split.refund} /> is paid back to them.
                </li>
              )}
            </ul>
          )}
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}
