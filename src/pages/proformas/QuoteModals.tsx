import { useState } from 'react';
import { formatDate, todayIso } from '../../../shared/gst';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentMethod, type Proforma } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, Money, MoneyInput, Select, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { navigate, paths } from '../../lib/router';
import { toNumber } from '../../lib/format';

/** Invoice all of a quote, or just some of the items and quantities (the rest stays on the quote for later). */
export function ConvertQuoteModal({ proforma: p, onClose }: { proforma: Proforma; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const open = p.lines.filter((l) => l.qty - l.invoicedQty > 0);
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(open.map((l) => [l.variantId, String(l.qty - l.invoicedQty)])));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const picks = open.map((l) => ({ line: l, qty: toNumber(qty[l.variantId] ?? '0') })).filter((x) => x.qty > 0);
  const bad = open.some((l) => {
    const n = toNumber(qty[l.variantId] ?? '0');
    return !Number.isInteger(n) || n < 0 || n > l.qty - l.invoicedQty;
  });
  const worth = picks.reduce((s, x) => s + x.qty * x.line.unitPricePaise, 0);
  const everything = picks.length === open.length && picks.every((x) => x.qty === x.line.qty - x.line.invoicedQty);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const inv = await api.proformaConvert(p.id, everything ? undefined : picks.map((x) => ({ variantId: x.line.variantId, qty: x.qty })));
      refresh();
      toast.success(`Invoice ${inv.number} issued from ${p.number}`);
      navigate(paths.invoice(inv.id));
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Invoice ${p.number}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={picks.length === 0 || bad} onClick={() => void submit()}>
            {everything ? 'Issue invoice' : 'Issue part invoice'}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-ink-muted">
        An invoice is issued today at the quoted prices and the pieces come off your shelves. Lower a quantity to invoice only part of the quote now; what is left stays on the quote.
        {p.depositPaise > 0 && <> The <Money paise={p.depositPaise} /> deposit is put toward it.</>}
      </p>
      <table className="w-full">
        <thead>
          <tr className="border-b border-line">
            <th className="th">Item</th>
            <th className="th text-right">Quoted</th>
            <th className="th text-right">Invoiced</th>
            <th className="th w-28 text-right">Invoice now</th>
          </tr>
        </thead>
        <tbody>
          {open.map((l) => (
            <tr key={l.variantId} className="border-b border-line/70 last:border-0">
              <td className="td">
                {l.designName}
                <div className="text-xs text-ink-muted">
                  {l.color} · {l.size}
                </div>
              </td>
              <td className="td num text-right">{l.qty}</td>
              <td className="td num text-right text-ink-muted">{l.invoicedQty || '—'}</td>
              <td className="td text-right">
                <Input
                  value={qty[l.variantId] ?? ''}
                  onChange={(e) => setQty({ ...qty, [l.variantId]: e.target.value.replace(/\D/g, '') })}
                  inputMode="numeric"
                  className="num text-right"
                  aria-label={`Quantity of ${l.designName} ${l.color} to invoice`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex justify-between text-ink-muted">
        <span>Before GST</span>
        <Money paise={worth} />
      </div>
      {bad && <p className="mt-2 text-status-overdue-fg">A quantity is more than what is left on the quote.</p>}
      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Modal>
  );
}

/** Money taken in advance for this quote. It is held as the customer's advance and goes onto the invoice. */
export function DepositModal({ proforma: p, onClose }: { proforma: Proforma; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [receivedOn, setReceivedOn] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api.paymentRecord({ customerId: p.customerId, amountPaise: amount, method, reference, receivedOn, note: `Deposit for ${p.number}`, allocations: [], proformaId: p.id });
      refresh();
      toast.success('Deposit recorded');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Deposit for ${p.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={amount <= 0} onClick={() => void submit()}>
            Record deposit
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-muted">Kept as {p.buyerName}'s advance and put toward the invoice when you make it. Quoted total: <Money paise={p.totalPaise} />.</p>
        <Field label="Amount received">
          <MoneyInput value={amount} onChange={setAmount} data-autofocus />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="How">
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date">
            <Input type="date" value={receivedOn} max={todayIso()} onChange={(e) => setReceivedOn(e.target.value)} className="num" />
          </Field>
        </div>
        <Field label="Reference" hint="UPI id, cheque number… optional">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}

/** Marks the quote lost, with why, so the Quotes report can show what is costing sales. */
export function LostModal({ proforma: p, onClose }: { proforma: Proforma; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const reasons = ['Price too high', 'Bought elsewhere', 'Changed their mind', 'Needed it sooner', 'No reply'];
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await api.proformaSetStage(p.id, 'lost', reason);
      refresh();
      toast.success(`${p.number} marked lost`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Mark ${p.number} lost`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={saving} onClick={() => void submit()}>
            Mark lost
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-muted">The quote closes but stays on record. You can reopen it if {p.buyerName} comes back.</p>
        <Field label="Why was it lost?">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" data-autofocus />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {reasons.map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)} className="rounded-md border border-line px-2 py-1 text-xs text-ink-muted transition-colors hover:border-brand hover:text-brand">
              {r}
            </button>
          ))}
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}

/** What the quote said before each change. */
export function RevisionsModal({ proforma: p, onClose }: { proforma: Proforma; onClose: () => void }) {
  const revisions = useQuery(() => api.proformaRevisions(p.id), [p.id]);
  return (
    <Modal title={`Earlier versions of ${p.number}`} size="lg" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      {revisions.loading ? (
        <Spinner />
      ) : revisions.error ? (
        <ErrorNote>{revisions.error}</ErrorNote>
      ) : (
        <div className="max-h-[55vh] space-y-5 overflow-y-auto">
          <div className="rounded-lg bg-brand-tint px-4 py-3">
            Now: <Money paise={p.totalPaise} /> · valid until <span className="num">{formatDate(p.validUntil)}</span> · {p.lines.length} {p.lines.length === 1 ? 'item' : 'items'}
          </div>
          {revisions.data?.map((r) => (
            <div key={r.version}>
              <div className="mb-1 flex items-baseline justify-between">
                <span className="font-medium">Version {r.version}</span>
                <span className="text-xs text-ink-muted">
                  replaced <span className="num">{formatDate(r.replacedAt.slice(0, 10))}</span> · was <Money paise={r.totalPaise} />
                  {r.totalPaise !== p.totalPaise && <> · now <Money paise={Math.abs(p.totalPaise - r.totalPaise)} /> {p.totalPaise > r.totalPaise ? 'more' : 'less'}</>}
                </span>
              </div>
              <ul className="divide-y divide-line/70 text-ink-muted">
                {r.lines.map((l, i) => (
                  <li key={i} className="flex justify-between py-1">
                    <span>
                      {l.qty} × {l.designName} · {l.color} {l.size}
                    </span>
                    <Money paise={l.amountPaise} />
                  </li>
                ))}
              </ul>
              {r.discountPaise > 0 && <div className="mt-1 text-xs text-ink-muted">Discount <Money paise={r.discountPaise} /></div>}
            </div>
          ))}
          {revisions.data?.length === 0 && <p className="text-ink-muted">This quote has not been changed since it was made.</p>}
        </div>
      )}
    </Modal>
  );
}

/** Keeps the items of this quote as a template for starting similar quotes. */
export function SaveTemplateModal({ proforma: p, onClose }: { proforma: Proforma; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await api.quoteTemplateSave({ name, notes: p.notes, lines: p.lines.map((l) => ({ variantId: l.variantId, qty: l.qty, unitPricePaise: l.unitPricePaise })) });
      toast.success(`Template “${name.trim()}” saved`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Save as a template"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!name.trim()} onClick={() => void submit()}>
            Save template
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-muted">The items, quantities and prices of {p.number} are kept, to start a new quote from. Saving under a name you already use replaces that template.</p>
        <Field label="Template name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Wedding bundle" data-autofocus />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}
