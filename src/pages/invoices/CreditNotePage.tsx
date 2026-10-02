import { ArrowLeft, Ban, Download, HandCoins, Printer } from 'lucide-react';
import { useState } from 'react';
import { formatDate, todayIso } from '../../../shared/gst';
import { formatMoney } from '../../../shared/money';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type CreditNote, type PaymentMethod } from '../../../shared/types';
import { CreditNoteDocument } from '../../components/CreditNoteDocument';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorNote, Field, Figure, Input, Money, MoneyInput, PageHeader, Pill, Select, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { paths } from '../../lib/router';

type Dialog = 'refund' | 'cancel' | null;

export function CreditNotePage({ id }: { id: string }) {
  const toast = useToast();
  const query = useQuery(() => api.creditNoteGet(id), [id]);
  const n = query.data;
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<'pdf' | 'print' | null>(null);

  const back = (
    <a href={`#${paths.creditNotes}`} className="inline-flex items-center gap-1.5 rounded-lg text-ink-muted transition-colors hover:text-ink">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Credit notes
    </a>
  );
  if (query.error && !n) {
    return (
      <>
        <PageHeader back={back} title="Credit note not found" />
        <ErrorNote>{query.error}</ErrorNote>
      </>
    );
  }
  if (!n) {
    return (
      <>
        <PageHeader back={back} title="" />
        <Spinner />
      </>
    );
  }

  const issued = n.status === 'issued';
  const applied = n.applications.reduce((s, a) => s + a.amountPaise, 0);
  const refunded = n.refunds.reduce((s, r) => s + r.amountPaise, 0);

  const openPrintView = () => {
    window.open(`${location.origin}${location.pathname}#/print/credit-note/${encodeURIComponent(id)}`, '_blank');
    toast.info('Opened in a new tab: click “Save as PDF / Print” there, then choose “Save as PDF”.');
  };
  async function run(kind: 'pdf' | 'print', work: () => Promise<unknown>) {
    setBusy(kind);
    try {
      await work();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }
  const exportPdf = () => (window.invoiceon ? run('pdf', async () => ((await api.creditNoteExportPdf(id)).saved ? toast.success('PDF saved') : undefined)) : openPrintView());
  const print = () => (window.invoiceon ? run('print', () => api.creditNotePrint(id)) : openPrintView());

  return (
    <>
      <PageHeader
        back={back}
        title={
          <span className="flex items-center gap-3">
            <span className="num">{n.number}</span>
            <Pill tone={issued ? 'paid' : 'neutral'}>{issued ? 'Issued' : 'Cancelled'}</Pill>
          </span>
        }
        subtitle={
          <span>
            {n.customerId ? <a href={`#${paths.customer(n.customerId)}`} className="transition-colors hover:text-brand">{n.buyerName}</a> : n.buyerName}
            {' · against '}
            <a href={`#${paths.invoice(n.invoiceId)}`} className="num text-brand transition-colors hover:text-brand-hover">
              {n.invoiceNumber}
            </a>
          </span>
        }
        actions={
          <>
            <Button icon={<Download className="h-4 w-4" />} loading={busy === 'pdf'} disabled={busy !== null} onClick={() => void exportPdf()}>
              Save PDF
            </Button>
            <Button icon={<Printer className="h-4 w-4" />} loading={busy === 'print'} disabled={busy !== null} onClick={() => void print()}>
              Print
            </Button>
            {issued && n.heldPaise > 0 && (
              <Button icon={<HandCoins className="h-4 w-4" />} onClick={() => setDialog('refund')}>
                Refund the credit
              </Button>
            )}
            {issued && (
              <Button variant="danger" icon={<Ban className="h-4 w-4" />} onClick={() => setDialog('cancel')}>
                Cancel
              </Button>
            )}
          </>
        }
      />

      <Card className="mb-6 p-6">
        <div className="grid grid-cols-4 gap-8">
          <Figure label="Credited" sub={formatDate(n.issueDate)}>
            <Money paise={n.totalPaise} fractionDigits={0} />
          </Figure>
          <Figure label="Taken off the invoice" sub={applied > 0 ? n.applications.map((a) => a.invoiceNumber).join(', ') : undefined}>
            <Money paise={issued ? applied : 0} fractionDigits={0} />
          </Figure>
          <Figure label="Refunded" sub={refunded > 0 ? `${n.refunds.length} ${n.refunds.length === 1 ? 'payment' : 'payments'}` : undefined}>
            <Money paise={refunded} fractionDigits={0} />
          </Figure>
          <Figure label="Kept as credit" highlight={issued && n.heldPaise > 0} sub={issued && n.heldPaise > 0 ? 'Goes onto their next invoice' : undefined}>
            <Money paise={issued ? n.heldPaise : 0} fractionDigits={0} />
          </Figure>
        </div>
        <p className="mt-4 border-t border-line pt-4 text-sm text-ink-muted">
          {n.reason}
          {n.lines.some((l) => !l.restocked) && ' · Some pieces were not put back on the shelf.'}
        </p>
      </Card>

      <div className="overflow-x-auto pb-8">
        <div className="mx-auto w-max rounded-lg border border-line shadow-overlay">
          <CreditNoteDocument note={n} />
        </div>
      </div>

      {dialog === 'refund' && <RefundModal note={n} onClose={() => setDialog(null)} />}
      {dialog === 'cancel' && <CancelModal note={n} onClose={() => setDialog(null)} />}
    </>
  );
}

function RefundModal({ note: n, onClose }: { note: CreditNote; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const settings = useQuery(() => api.getSettings());
  const accounts = settings.data?.paymentAccounts ?? [];
  const [amount, setAmount] = useState(n.heldPaise);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [accountId, setAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api.creditNoteRefund(n.id, { method, accountId: accountId || undefined, reference, amountPaise: amount });
      refresh();
      toast.success(`${formatMoney(amount)} refunded to ${n.buyerName}`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Refund ${n.buyerName}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={amount <= 0} onClick={() => void submit()}>
            Record refund
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-muted">
          <Money paise={n.heldPaise} /> is being kept as credit on {n.number}. Hand back all or part of it. It is also entered under Expenses as “Customer refunds”.
        </p>
        <Field label="Amount refunded">
          <MoneyInput value={amount} onChange={setAmount} data-autofocus />
        </Field>
        <Field label="How">
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
              <option value="">Not linked to an account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Reference" hint="Optional">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <p className="text-xs text-ink-muted">Refunding on {formatDate(todayIso())}.</p>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}

function CancelModal({ note: n, onClose }: { note: CreditNote; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api.creditNoteCancel(n.id, reason);
      refresh();
      toast.success(`${n.number} cancelled`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Cancel ${n.number}?`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Keep it</Button>
          <Button variant="danger" loading={saving} onClick={() => void submit()}>
            Cancel credit note
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-muted">Use this for a credit note made by mistake. The credit comes off the invoice again, and the pieces it put back on the shelf come off it. It keeps its number and stays on record.</p>
        <Field label="Why" hint="Optional">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} data-autofocus />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}
