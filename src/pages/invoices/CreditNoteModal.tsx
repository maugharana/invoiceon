import { useEffect, useState } from 'react';
import { todayIso } from '../../../shared/gst';
import { formatMoney } from '../../../shared/money';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type CreditNote, type CreditNoteInput, type CreditNotePreview, type Invoice, type PaymentMethod } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, Money, Select, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';

interface Pick {
  qty: number;
  restock: boolean;
}

/** Taking some of an invoice back. Shows what the credit note will come to, and what happens to the money, before anything is made. */
export function CreditNoteModal({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone: (note: CreditNote) => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const returnable = useQuery(() => api.creditNoteReturnable(invoice.id), [invoice.id]);
  const settings = useQuery(() => api.getSettings());
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(todayIso());
  const [leftover, setLeftover] = useState<'refund' | 'credit'>(invoice.customerId ? 'credit' : 'refund');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [accountId, setAccountId] = useState('');
  const [preview, setPreview] = useState<CreditNotePreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const chosen = Object.entries(picks).filter(([, p]) => p.qty > 0);
  const input = (): CreditNoteInput => ({
    invoiceId: invoice.id,
    issueDate: date,
    reason,
    lines: chosen.map(([invoiceLineId, p]) => ({ invoiceLineId, qty: p.qty, restock: p.restock })),
    leftover: preview && preview.leftoverPaise > 0 ? leftover : undefined,
    refund: preview && preview.leftoverPaise > 0 && leftover === 'refund' ? { method, accountId: accountId || undefined } : undefined,
  });

  // The figures are worked out by the same code that will make the note, so what is shown is what will be issued.
  const key = JSON.stringify([chosen, date]);
  useEffect(() => {
    if (chosen.length === 0) {
      setPreview(null);
      setProblem(null);
      return;
    }
    let live = true;
    api
      .creditNotePreview({ invoiceId: invoice.id, issueDate: date, reason: '-', lines: chosen.map(([invoiceLineId, p]) => ({ invoiceLineId, qty: p.qty, restock: p.restock })) })
      .then((p) => live && (setPreview(p), setProblem(null)))
      .catch((err) => live && (setPreview(null), setProblem(errorMessage(err))));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  async function submit() {
    setSaving(true);
    try {
      const note = await api.creditNoteCreate(input());
      refresh();
      toast.success(`Credit note ${note.number} issued`);
      onDone(note);
    } catch (err) {
      setProblem(errorMessage(err));
      setSaving(false);
    }
  }

  const accounts = settings.data?.paymentAccounts ?? [];
  const setPick = (lineId: string, patch: Partial<Pick>) => setPicks((p) => ({ ...p, [lineId]: { ...(p[lineId] ?? { qty: 0, restock: true }), ...patch } }));
  const canIssue = !!preview && reason.trim().length > 0 && !saving;

  return (
    <Modal
      title={`Take items back — ${invoice.number}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!canIssue} loading={saving} onClick={() => void submit()}>
            Issue credit note
          </Button>
        </>
      }
    >
      {!returnable.data ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          <p className="text-ink-muted">Choose what {invoice.buyerName} is bringing back. A credit note reverses the sale of those pieces, and the GST on them, to the paisa. The invoice itself stays as it was.</p>

          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line bg-canvas text-left text-xs text-ink-muted">
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="w-24 px-3 py-2 text-right font-medium">Bought</th>
                  <th className="w-28 px-3 py-2 text-right font-medium">Bringing back</th>
                  <th className="w-24 px-3 py-2 font-medium">Back on shelf</th>
                </tr>
              </thead>
              <tbody>
                {returnable.data.map((l) => {
                  const p = picks[l.invoiceLineId];
                  return (
                    <tr key={l.invoiceLineId} className="border-b border-line/70 last:border-0">
                      <td className="px-3 py-2">
                        <div>{l.designName}</div>
                        <div className="text-xs text-ink-muted">
                          {l.color} · {l.size} · <span className="num">{formatMoney(l.unitPricePaise)}</span>
                        </div>
                      </td>
                      <td className="num px-3 py-2 text-right">
                        {l.qty}
                        {l.creditedQty > 0 && <div className="text-xs text-ink-muted">{l.creditedQty} already back</div>}
                      </td>
                      <td className="px-3 py-2">
                        {l.remainingQty > 0 ? (
                          <Input
                            type="number"
                            min={0}
                            max={l.remainingQty}
                            step={1}
                            value={p?.qty ?? 0}
                            aria-label={`Quantity to take back, ${l.color} ${l.size}`}
                            onChange={(e) => setPick(l.invoiceLineId, { qty: Math.max(0, Math.min(l.remainingQty, Math.floor(Number(e.target.value) || 0))) })}
                            className="num h-8 text-right"
                          />
                        ) : (
                          <span className="block text-right text-xs text-ink-muted">All back</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {l.remainingQty > 0 && (
                          <label className="flex items-center gap-2 text-xs text-ink-muted" title="Untick for damaged pieces that cannot be sold again">
                            <input type="checkbox" checked={p?.restock ?? true} onChange={(e) => setPick(l.invoiceLineId, { restock: e.target.checked })} className="h-4 w-4 accent-[#0F6E56]" />
                            Resell
                          </label>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-[1fr_10rem] gap-4">
            <Field label="Reason" hint="Printed on the credit note, e.g. wrong colour, small defect.">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is it coming back?" maxLength={200} />
            </Field>
            <Field label="Date">
              <Input type="date" value={date} min={invoice.issueDate} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>

          {problem && <ErrorNote>{problem}</ErrorNote>}

          {preview && (
            <div className="space-y-3 rounded-lg bg-canvas p-4">
              <dl className="space-y-1.5">
                <div className="flex justify-between"><dt className="text-ink-muted">Value of the pieces</dt><dd><Money paise={preview.taxablePaise} /></dd></div>
                {preview.taxByRate.map((g) => (
                  <div key={g.ratePercent} className="flex justify-between"><dt className="text-ink-muted">GST taken back @ {g.ratePercent}%</dt><dd><Money paise={g.taxPaise} /></dd></div>
                ))}
                {preview.roundOffPaise !== 0 && <div className="flex justify-between text-ink-muted"><dt>Round off</dt><dd className="num">{preview.roundOffPaise < 0 ? '−' : '+'}{formatMoney(Math.abs(preview.roundOffPaise))}</dd></div>}
                <div className="flex justify-between border-t border-line pt-2"><dt>Credit note total</dt><dd className="text-base"><Money paise={preview.totalPaise} /></dd></div>
              </dl>

              <div className="border-t border-line pt-3">
                {preview.appliedPaise > 0 && (
                  <p>
                    <Money paise={preview.appliedPaise} /> is taken off what {invoice.buyerName} still owes on this invoice.
                  </p>
                )}
                {preview.leftoverPaise > 0 && (
                  <div className="mt-2 space-y-3">
                    <p>
                      {invoice.buyerName} has already paid, so <Money paise={preview.leftoverPaise} /> is left over. What should happen to it?
                    </p>
                    <div className="space-y-2">
                      <label className="flex cursor-pointer items-start gap-3">
                        <input type="radio" name="leftover" checked={leftover === 'credit'} disabled={!invoice.customerId} onChange={() => setLeftover('credit')} className="mt-1 h-4 w-4 accent-[#0F6E56]" />
                        <span className={invoice.customerId ? '' : 'text-ink-muted'}>
                          Keep it as credit for their next purchase
                          {!invoice.customerId && <span className="block text-xs">Not possible for a walk-in sale: there is no customer to keep it for.</span>}
                        </span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-3">
                        <input type="radio" name="leftover" checked={leftover === 'refund'} onChange={() => setLeftover('refund')} className="mt-1 h-4 w-4 accent-[#0F6E56]" />
                        <span>Give the money back now</span>
                      </label>
                    </div>
                    {leftover === 'refund' && (
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
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
