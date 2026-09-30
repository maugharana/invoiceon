import { PhoneCall } from 'lucide-react';
import { useState } from 'react';
import { CONTACT_LABEL, PROMISE_LABEL, type PromiseState } from '../../../shared/followup';
import { formatDate } from '../../../shared/gst';
import { useToast } from '../../components/Toast';
import { Button, Card, Money } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { formatDateTime } from '../../lib/format';
import { FollowUpDialog } from '../payments/FollowUpDialog';

const TONE: Record<PromiseState, string> = { open: 'bg-status-partial-bg text-status-partial-fg', kept: 'bg-status-paid-bg text-status-paid-fg', broken: 'bg-status-overdue-bg text-status-overdue-fg', cancelled: 'bg-status-neutral-bg text-ink-muted' };

/** Reminders, calls and promises to pay for one customer. Shown once there is something to show, or while they owe money. */
export function FollowUpsCard({ customerId, customerName, owedPaise }: { customerId: string; customerName: string; owedPaise: number }) {
  const toast = useToast();
  const refresh = useRefresh();
  const data = useQuery(() => api.customerFollowUps(customerId), [customerId]);
  const [open, setOpen] = useState(false);
  const d = data.data;
  if (!d) return null;
  if (d.contacts.length === 0 && d.promises.length === 0 && owedPaise <= 0) return null;

  async function cancel(id: string) {
    try {
      await api.promiseCancel(id);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base">
          <PhoneCall className="h-4 w-4 text-brand" aria-hidden /> Follow-ups
        </h2>
        <Button onClick={() => setOpen(true)}>Log a follow-up</Button>
      </div>
      <Card className="p-5">
        {d.promises.length === 0 && d.contacts.length === 0 ? (
          <p className="text-ink-muted">Nobody has been in touch about what {customerName} owes yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-8">
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-muted">Promises to pay</h3>
              {d.promises.length === 0 ? (
                <p className="text-sm text-ink-muted">None.</p>
              ) : (
                <ul className="space-y-2.5 text-sm">
                  {d.promises.slice(0, 5).map((p) => (
                    <li key={p.id} className="flex items-start gap-3">
                      <span className={`mt-0.5 rounded-full px-2 py-0.5 text-xs ${TONE[p.state]}`}>{PROMISE_LABEL[p.state]}</span>
                      <div className="min-w-0 flex-1">
                        <div>
                          <Money paise={p.amountPaise} fractionDigits={0} /> by {formatDate(p.promisedOn)}
                        </div>
                        <div className="text-xs text-ink-muted">
                          {p.paidSincePaise > 0 ? 'Paid since: ' : 'Nothing paid since'}
                          {p.paidSincePaise > 0 && <Money paise={p.paidSincePaise} fractionDigits={0} />}
                          {p.note && ` · ${p.note}`}
                        </div>
                      </div>
                      {p.state === 'open' && (
                        <button type="button" className="text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => void cancel(p.id)}>
                          Cancel
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-muted">Contact log</h3>
              {d.contacts.length === 0 ? (
                <p className="text-sm text-ink-muted">None.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {d.contacts.slice(0, 6).map((c) => (
                    <li key={c.id}>
                      <div>
                        {CONTACT_LABEL[c.channel]}
                        {c.note && <span className="text-ink-muted"> · {c.note}</span>}
                      </div>
                      <div className="text-xs text-ink-muted">{formatDateTime(c.createdAt)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Card>
      {open && <FollowUpDialog customerId={customerId} customerName={customerName} owedPaise={owedPaise} onClose={() => setOpen(false)} />}
    </section>
  );
}
