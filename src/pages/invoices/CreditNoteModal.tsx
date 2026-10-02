import { useEffect, useMemo, useState } from 'react';
import { formatDate, todayIso } from '../../../shared/gst';
import { formatMoney } from '../../../shared/money';
import { CREDIT_NOTE_REASONS, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type Customer, type CreditNotePreview, type Invoice, type PaymentMethod } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, Money, Select } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { toNumber } from '../../lib/format';
import { navigate, paths } from '../../lib/router';

/** Takes goods back from an issued invoice. It shows what the credit comes to as items are chosen, and how the money settles. */
export function CreditNoteModal({ invoice: inv, customer, onClose }: { invoice: Invoice; customer: Customer | null | undefined; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const settings = useQuery(() => api.getSettings());
  const accounts = settings.data?.paymentAccounts ?? [];
  const [qty, setQty] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [issueDate, setIssueDate] = useState(todayIso());
  const [reason, setReason] = useState<string>(CREDIT_NOTE_REASONS[0]);
  const [note, setNote] = useState('');
  const [settlement, setSettlement] = useState<'refund' | 'credit'>(inv.customerId ? 'credit' : 'refund');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [accountId, setAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [preview, setPreview] = useState<CreditNotePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const asked = useMemo(() => Object.entries(qty).map(([invoiceLineId, q]) => ({ invoiceLineId, qty: toNumber(q) || 0, restock: restock[invoiceLineId] ?? true })).filter((l) => l.qty > 0), [qty, restock]);

  // The figures come from the same code that will save the note, so what is shown is what is written.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .creditNotePreview({ invoiceId: inv.id, lines: asked })
        .then((p) => {
          if (!cancelled) {
            setPreview(p);
            setError(null);
          }
        })
        .catch((err) => !cancelled && setError(errorMessage(err)));
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [inv.id, asked]);

  const total = preview?.totalPaise ?? 0;
  const excess = preview?.excessPaise ?? 0;
  const refunding = excess > 0 && (settlement === 'refund' || !inv.customerId);
  const creditable = (preview?.lines ?? []).filter((l) => l.creditableQty > 0);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const made = await api.creditNoteCreate({
        invoiceId: inv.id,
        issueDate,
        reason,
        note,
        lines: asked,
        settlement,
        ...(refunding ? { refund: { method, accountId: accountId || undefined, reference } } : {}),
      });
      refresh();
      toast.success(`${made.number} issued`);
      onClose();
      navigate(paths.creditNote(made.id));
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Take goods back from ${inv.number}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={total <= 0 || !preview} onClick={() => void save()}>
            {total > 0 ? `Issue credit note · ${formatMoney(total)}` : 'Issue credit note'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <p className="text-ink-muted">Enter how many of each item came back. A credit note with its own number and tax is made, and the pieces you choose go back into stock.</p>

        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Item</th>
                <th className="th text-right">Sold</th>
                <th className="th w-36 text-right">Taking back</th>
                <th className="th w-24">Back on shelf</th>
                <th className="th text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {(preview?.lines ?? []).map((l) => (
                <tr key={l.invoiceLineId} className="border-b border-line/70 last:border-0">
                  <td className="td">
                    <div>{l.designName}</div>
                    <div className="text-xs text-ink-muted">
                      {l.color} · {l.size}
                      {l.creditedQty > 0 && <> · {l.creditedQty} already credited</>}
                    </div>
                  </td>
                  <td className="td num text-right">{l.soldQty}</td>
                  <td className="td text-right">
                    {l.creditableQty > 0 ? (
                      <span className="flex items-center justify-end gap-2">
                        <button type="button" onClick={() => setQty((q) => ({ ...q, [l.invoiceLineId]: String(l.creditableQty) }))} className="text-xs text-brand hover:underline">
                          All {l.creditableQty}
                        </button>
                        <Input value={qty[l.invoiceLineId] ?? ''} inputMode="numeric" placeholder="0" aria-label={`Quantity taken back, ${l.designName} ${l.color}`} onChange={(e) => setQty((q) => ({ ...q, [l.invoiceLineId]: e.target.value.replace(/\D/g, '').slice(0, 5) }))} className="num h-8 w-16 text-right" />
                      </span>
                    ) : (
                      <span className="text-xs text-ink-muted">Fully credited</span>
                    )}
                  </td>
                  <td className="td">
                    {l.creditableQty > 0 && (
                      <input type="checkbox" checked={restock[l.invoiceLineId] ?? true} onChange={(e) => setRestock((r) => ({ ...r, [l.invoiceLineId]: e.target.checked }))} aria-label={`Put ${l.designName} ${l.color} back on the shelf`} className="h-4 w-4 accent-[#0F6E56]" />
                    )}
                  </td>
                  <td className="td text-right">{l.qty > 0 ? <Money paise={l.taxablePaise + l.taxPaise} /> : <span className="text-ink-muted/50">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {creditable.length > 0 && <p className="-mt-3 text-xs text-ink-muted">Untick “Back on shelf” for damaged pieces, so they don't go back into stock.</p>}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Why">
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              {CREDIT_NOTE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date" hint={`Not before the invoice (${formatDate(inv.issueDate)})`}>
            <Input type="date" value={issueDate} min={inv.issueDate} max={todayIso()} onChange={(e) => setIssueDate(e.target.value)} className="num" />
          </Field>
          <Field label="Note" className="col-span-2" hint="Optional. Printed on the credit note.">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </Field>
        </div>

        {total > 0 && preview && (
          <div className="rounded-lg bg-canvas px-4 py-3">
            <dl className="space-y-1.5">
              <div className="flex justify-between">
                <dt className="text-ink-muted">Taxable value and GST</dt>
                <dd>
                  <Money paise={preview.taxablePaise} /> + <Money paise={preview.taxPaise} />
                </dd>
              </div>
              {preview.roundOffPaise !== 0 && (
                <div className="flex justify-between text-ink-muted">
                  <dt>Round off</dt>
                  <dd>
                    {preview.roundOffPaise < 0 ? '− ' : '+ '}
                    <Money paise={Math.abs(preview.roundOffPaise)} />
                  </dd>
                </div>
              )}
              <div className="flex justify-between font-medium">
                <dt>Credit</dt>
                <dd>
                  <Money paise={total} />
                </dd>
              </div>
              {preview.appliedToInvoicePaise > 0 && (
                <div className="flex justify-between text-ink-muted">
                  <dt>Reduces what {inv.buyerName} owes on {inv.number}</dt>
                  <dd>
                    <Money paise={preview.appliedToInvoicePaise} />
                  </dd>
                </div>
              )}
              {excess > 0 && (
                <div className="flex justify-between">
                  <dt>They had already paid, so this is due back to them</dt>
                  <dd>
                    <Money paise={excess} />
                  </dd>
                </div>
              )}
            </dl>
          </div>
        )}

        {excess > 0 && (
          <div className="space-y-3 rounded-lg border border-line p-4">
            <div className="text-sm font-medium">What to do with the {formatMoney(excess)}</div>
            <div role="radiogroup" aria-label="Settlement" className="flex flex-wrap gap-4">
              <label className={`flex items-center gap-2 ${inv.customerId ? '' : 'opacity-50'}`}>
                <input type="radio" name="settlement" checked={settlement === 'credit' && !!inv.customerId} disabled={!inv.customerId} onChange={() => setSettlement('credit')} className="accent-[#0F6E56]" />
                Keep it as credit for their next invoice
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="settlement" checked={settlement === 'refund' || !inv.customerId} onChange={() => setSettlement('refund')} className="accent-[#0F6E56]" />
                Refund it now
              </label>
            </div>
            {!inv.customerId && <p className="text-xs text-ink-muted">This customer isn't saved, so there is nowhere to keep credit. It is refunded.</p>}
            {refunding && (
              <div className="grid grid-cols-3 gap-3">
                <Field label="Refunded by">
                  <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABEL[m]}
                      </option>
                    ))}
                  </Select>
                </Field>
                {accounts.length > 0 && (
                  <Field label="Paid from">
                    <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                      <option value="">Not linked</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                <Field label="Reference">
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
                </Field>
              </div>
            )}
            {customer && customer.advancePaise > 0 && settlement === 'credit' && <p className="text-xs text-ink-muted">{customer.name} already holds {formatMoney(customer.advancePaise)} in advance. This is added to it.</p>}
          </div>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}
