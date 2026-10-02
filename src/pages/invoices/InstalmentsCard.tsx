import { CalendarClock } from 'lucide-react';
import { useState } from 'react';
import { formatDate, todayIso } from '../../../shared/gst';
import { splitInstalments } from '../../../shared/instalmentPlan';
import type { Invoice } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorNote, Field, Input, Money, MoneyInput, Pill } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';

/** The instalment plan for an invoice: when each part is due and how much of it has been paid. */
export function InstalmentsCard({ invoice }: { invoice: Invoice }) {
  const plan = useQuery(() => api.instalmentsList(invoice.id), [invoice.id]);
  const [editing, setEditing] = useState(false);
  const rows = plan.data ?? [];
  const balance = invoice.totalPaise - invoice.paidPaise;
  if (rows.length === 0 && balance <= 0) return null;

  return (
    <Card className="mb-6 p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4 text-ink-muted" aria-hidden /> Instalments
        </h2>
        <Button className="h-8 text-xs" onClick={() => setEditing(true)}>
          {rows.length > 0 ? 'Change plan' : 'Split into instalments'}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-ink-muted">Agree a payment schedule with the customer: each instalment gets its own due date and shows up under Dues when it is near.</p>
      ) : (
        <ul className="divide-y divide-line/70">
          {rows.map((n) => (
            <li key={n.id} className="flex items-center justify-between py-2">
              <span>
                <span className="text-ink-muted">#{n.position + 1}</span> · <span className="num">{formatDate(n.dueDate)}</span>
              </span>
              <span className="flex items-center gap-4">
                {n.paidPaise > 0 && n.status !== 'paid' && (
                  <span className="text-xs text-ink-muted">
                    <Money paise={n.paidPaise} /> paid
                  </span>
                )}
                <Pill tone={n.status === 'paid' ? 'paid' : n.status === 'overdue' ? 'overdue' : 'partial'}>{n.status === 'paid' ? 'Paid' : n.status === 'overdue' ? 'Overdue' : 'Upcoming'}</Pill>
                <Money paise={n.amountPaise} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing && <InstalmentsModal invoice={invoice} existing={rows.map((r) => ({ dueDate: r.dueDate, amountPaise: r.amountPaise }))} onClose={() => setEditing(false)} />}
    </Card>
  );
}

function InstalmentsModal({ invoice, existing, onClose }: { invoice: Invoice; existing: { dueDate: string; amountPaise: number }[]; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [count, setCount] = useState(existing.length || 3);
  const [gap, setGap] = useState(30);
  // Instalments count from today (or from the invoice date, if that is later).
  const start = todayIso() > invoice.issueDate ? todayIso() : invoice.issueDate;
  const [rows, setRows] = useState(existing.length > 0 ? existing : splitInstalments(invoice.totalPaise, 3, start, 30));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const total = rows.reduce((s, r) => s + r.amountPaise, 0);
  const off = total - invoice.totalPaise;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.instalmentsSet(invoice.id, rows);
      refresh();
      toast.success('Instalment plan saved');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }
  async function remove() {
    setSaving(true);
    try {
      await api.instalmentsClear(invoice.id);
      refresh();
      toast.success('Instalment plan removed');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Instalments for ${invoice.number}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          {existing.length > 0 && (
            <Button variant="danger" className="mr-auto" onClick={() => void remove()} disabled={saving}>
              Remove plan
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={off !== 0 || rows.length === 0} onClick={() => void save()}>
            Save plan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
          <Field label="Number of instalments">
            <Input value={count} onChange={(e) => setCount(Math.max(1, Math.min(24, Number(e.target.value.replace(/\D/g, '')) || 1)))} inputMode="numeric" className="num" />
          </Field>
          <Field label="Days between them">
            <Input value={gap} onChange={(e) => setGap(Math.max(1, Math.min(365, Number(e.target.value.replace(/\D/g, '')) || 1)))} inputMode="numeric" className="num" />
          </Field>
          <Button onClick={() => setRows(splitInstalments(invoice.totalPaise, count, start, gap))}>Split evenly</Button>
        </div>
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={i} className="grid grid-cols-[2rem_1fr_1fr] items-center gap-3">
              <span className="text-ink-muted">#{i + 1}</span>
              <Input type="date" value={r.dueDate} min={invoice.issueDate} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} className="num" aria-label={`Due date of instalment ${i + 1}`} />
              <MoneyInput value={r.amountPaise} onChange={(p) => setRows(rows.map((x, j) => (j === i ? { ...x, amountPaise: p } : x)))} aria-label={`Amount of instalment ${i + 1}`} />
            </li>
          ))}
        </ul>
        <div className={`flex justify-between ${off === 0 ? 'text-ink-muted' : 'text-status-overdue-fg'}`}>
          <span>Invoice total</span>
          <span>
            <Money paise={invoice.totalPaise} />
            {off !== 0 && (
              <>
                {' '}
                · {off > 0 ? 'over by ' : 'short by '}
                <Money paise={Math.abs(off)} />
              </>
            )}
          </span>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}
