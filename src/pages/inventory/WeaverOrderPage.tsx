import { ArrowLeft, Ban, HandCoins, PackageCheck, Pencil, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { formatDate, todayIso } from '../../../shared/gst';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, WEAVER_ORDER_STATUS_LABEL, type PaymentMethod, type WeaverOrder } from '../../../shared/types';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorNote, Field, Figure, Input, Money, MoneyInput, PageHeader, Pill, Select, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { plural, toNumber } from '../../lib/format';
import { navigate, paths } from '../../lib/router';
import { WEAVER_STATUS_TONE } from './WeaverOrdersPage';

type Dialog = 'receive' | 'pay' | 'cancel' | null;

export function WeaverOrderPage({ id }: { id: string }) {
  const toast = useToast();
  const refresh = useRefresh();
  const query = useQuery(() => api.weaverOrderGet(id), [id]);
  const o = query.data;
  const [dialog, setDialog] = useState<Dialog>(null);
  const [takingBack, setTakingBack] = useState<string | null>(null);

  const back = (
    <a href={`#${paths.weaverOrders}`} className="inline-flex items-center gap-1.5 rounded-lg text-ink-muted transition-colors hover:text-ink">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Weaver orders
    </a>
  );
  if (query.error && !o) {
    return (
      <>
        <PageHeader back={back} title="Order not found" />
        <ErrorNote>{query.error}</ErrorNote>
      </>
    );
  }
  if (!o) {
    return (
      <>
        <PageHeader back={back} title="" />
        <Spinner />
      </>
    );
  }

  const live = o.status === 'open' || o.status === 'partial';
  const balance = Math.max(0, o.totalPaise - o.paidPaise);
  const activePayments = o.payments.filter((p) => !p.voidedAt);
  const lineName = (lineId: string) => {
    const l = o.lines.find((x) => x.id === lineId);
    return l ? `${l.designName} (${l.color}, ${l.size})` : 'A saree';
  };

  return (
    <>
      <PageHeader
        back={back}
        title={o.number}
        subtitle={
          <span>
            {o.vendorName}
            {o.proformaId && (
              <>
                {' · for quote '}
                <a href={`#${paths.proforma(o.proformaId)}`} className="num text-brand transition-colors hover:text-brand-hover">
                  {o.proformaNumber}
                </a>
              </>
            )}
          </span>
        }
        actions={
          <>
            {o.status !== 'cancelled' && (
              <Button icon={<Pencil className="h-4 w-4" />} onClick={() => navigate(paths.editWeaverOrder(o.id))}>
                Edit
              </Button>
            )}
            {o.status !== 'cancelled' && balance > 0 && (
              <Button icon={<HandCoins className="h-4 w-4" />} onClick={() => setDialog('pay')} disabled={o.totalPaise <= 0} title={o.totalPaise <= 0 ? 'Edit the order and enter the price of each piece first' : undefined}>
                Record payment
              </Button>
            )}
            {o.status !== 'cancelled' && o.receivedPieces === 0 && (
              <Button variant="danger" icon={<Ban className="h-4 w-4" />} onClick={() => setDialog('cancel')}>
                Cancel
              </Button>
            )}
            {live && (
              <Button variant="primary" icon={<PackageCheck className="h-4 w-4" />} onClick={() => setDialog('receive')}>
                Mark received
              </Button>
            )}
          </>
        }
      />

      <Card className="mb-6 p-6">
        <div className="grid grid-cols-4 gap-8">
          <Figure label="Status" sub={o.late ? 'Past the expected day' : o.expectedOn && live ? `Expected ${formatDate(o.expectedOn)}` : `Ordered ${formatDate(o.orderedOn)}`}>
            <Pill tone={WEAVER_STATUS_TONE[o.status]}>{WEAVER_ORDER_STATUS_LABEL[o.status]}</Pill>
          </Figure>
          <Figure label="Pieces arrived" sub={live ? `${o.pieces - o.receivedPieces} still to come` : undefined}>
            <span className="num">
              {o.receivedPieces} of {o.pieces}
            </span>
          </Figure>
          <Figure label="Order total" sub={o.totalPaise <= 0 ? 'No prices yet' : o.paidPaise > 0 ? undefined : 'Nothing paid yet'}>
            <Money paise={o.totalPaise} fractionDigits={0} />
          </Figure>
          <Figure label="Still to pay" highlight={balance > 0 && o.status !== 'cancelled'} sub={o.paidPaise > 0 ? `${plural(activePayments.length, 'payment')} so far` : undefined}>
            <Money paise={o.status === 'cancelled' ? 0 : balance} fractionDigits={0} />
          </Figure>
        </div>
        {(o.note || o.status === 'cancelled') && (
          <div className="mt-4 border-t border-line pt-4 text-sm text-ink-muted">
            {o.status === 'cancelled' && <p>Cancelled{o.cancelReason ? `: ${o.cancelReason}` : ''}.</p>}
            {o.note && <p>{o.note}</p>}
          </div>
        )}
      </Card>

      <Card className="mb-6 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <th className="th">Saree</th>
              <th className="th text-right">Ordered</th>
              <th className="th text-right">Arrived</th>
              <th className="th text-right">Price each</th>
              <th className="th text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {o.lines.map((l) => (
              <tr key={l.id} className="border-b border-line/70 last:border-0">
                <td className="td">
                  <div>{l.designName}</div>
                  <div className="text-xs text-ink-muted">
                    {l.color} · {l.size} · {l.sku}
                  </div>
                </td>
                <td className="td num text-right">{l.qty}</td>
                <td className={`td num text-right ${l.receivedQty >= l.qty ? 'text-status-paid-fg' : ''}`}>{l.receivedQty}</td>
                <td className="td text-right">{l.unitCostPaise > 0 ? <Money paise={l.unitCostPaise} /> : <span className="text-ink-muted">Not set</span>}</td>
                <td className="td text-right">
                  <Money paise={l.amountPaise} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid grid-cols-2 gap-6 pb-8">
        <Card className="p-6">
          <h2 className="mb-3 text-base">Deliveries</h2>
          {o.receipts.length === 0 ? (
            <p className="text-ink-muted">Nothing has arrived yet.</p>
          ) : (
            <ul className="space-y-2">
              {o.receipts.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-4">
                  <span className="min-w-0 truncate">
                    <span className="num mr-2">{r.qty}</span>
                    {lineName(r.lineId)}
                  </span>
                  <span className="num shrink-0 text-xs text-ink-muted">{formatDate(r.receivedOn)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-6">
          <h2 className="mb-3 text-base">Paid to {o.vendorName}</h2>
          {o.payments.length === 0 ? (
            <p className="text-ink-muted">No payments yet. A payment is also entered under Expenses, so it counts in your profit.</p>
          ) : (
            <ul className="space-y-2">
              {o.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3">
                  <span className={`min-w-0 ${p.voidedAt ? 'text-ink-muted line-through' : ''}`}>
                    <Money paise={p.amountPaise} /> <span className="text-xs text-ink-muted">{PAYMENT_METHOD_LABEL[p.method]}{p.reference ? ` · ${p.reference}` : ''}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="num text-xs text-ink-muted">{formatDate(p.paidOn)}</span>
                    {!p.voidedAt && o.status !== 'cancelled' && (
                      <button type="button" aria-label="Take this payment back" title="Take this payment back" onClick={() => setTakingBack(p.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink">
                        <Undo2 className="h-4 w-4" aria-hidden />
                      </button>
                    )}
                    {p.voidedAt && <span className="text-xs text-ink-muted">Taken back</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {dialog === 'receive' && <ReceiveModal order={o} onClose={() => setDialog(null)} />}
      {dialog === 'pay' && <PayModal order={o} balance={balance} onClose={() => setDialog(null)} />}
      {dialog === 'cancel' && <CancelModal order={o} onClose={() => setDialog(null)} />}
      {takingBack && (
        <ConfirmDialog
          title="Take this payment back?"
          confirmLabel="Take it back"
          danger
          body="Use this when it was entered by mistake. The payment no longer counts, and the expense it made is removed."
          onClose={() => setTakingBack(null)}
          onConfirm={async () => {
            await api.weaverPaymentVoid(takingBack);
            refresh();
            toast.success('Payment taken back');
          }}
        />
      )}
    </>
  );
}

function ReceiveModal({ order: o, onClose }: { order: WeaverOrder; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const open = o.lines.filter((l) => l.qty > l.receivedQty);
  const [arrived, setArrived] = useState<Record<string, string>>({});
  const [receivedOn, setReceivedOn] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const count = (id: string) => toNumber(arrived[id] ?? '') || 0;
  const total = open.reduce((s, l) => s + count(l.id), 0);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const r = await api.weaverOrderReceive(o.id, { receivedOn, lines: open.filter((l) => count(l.id) > 0).map((l) => ({ lineId: l.id, qty: count(l.id) })) });
      refresh();
      toast.success(r.status === 'received' ? `${plural(total, 'piece')} received. ${r.number} is complete.` : `${plural(total, 'piece')} received`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Receive on ${o.number}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={total <= 0} onClick={() => void submit()}>
            {total > 0 ? `Receive ${plural(total, 'piece')}` : 'Receive'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-muted">Enter how many of each saree arrived. They go into your stock now, ready to invoice. Cost prices are not changed.</p>
        <Field label="Arrived on">
          <Input type="date" value={receivedOn} max={todayIso()} onChange={(e) => setReceivedOn(e.target.value)} className="num max-w-[12rem]" />
        </Field>
        <ul className="overflow-hidden rounded-lg border border-line">
          {open.map((l) => {
            const left = l.qty - l.receivedQty;
            return (
              <li key={l.id} className="flex items-center justify-between gap-4 border-b border-line/70 px-4 py-2.5 last:border-0">
                <span className="min-w-0">
                  <span className="block truncate">{l.designName}</span>
                  <span className="text-xs text-ink-muted">
                    {l.color} · {l.size} · {left} still to come
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <button type="button" onClick={() => setArrived((a) => ({ ...a, [l.id]: String(left) }))} className="text-xs text-brand hover:underline">
                    All {left}
                  </button>
                  <Input value={arrived[l.id] ?? ''} inputMode="numeric" aria-label={`Arrived, ${l.designName} ${l.color}`} placeholder="0" onChange={(e) => setArrived((a) => ({ ...a, [l.id]: e.target.value.replace(/\D/g, '').slice(0, 5) }))} className="num h-8 w-20 text-right" />
                </span>
              </li>
            );
          })}
        </ul>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}

function PayModal({ order: o, balance, onClose }: { order: WeaverOrder; balance: number; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const settings = useQuery(() => api.getSettings());
  const [amount, setAmount] = useState(balance);
  const [method, setMethod] = useState<PaymentMethod>('bank');
  const [accountId, setAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const accounts = settings.data?.paymentAccounts ?? [];

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api.weaverOrderPay(o.id, { paidOn, amountPaise: amount, method, accountId: accountId || undefined, reference });
      refresh();
      toast.success(`Paid ${o.vendorName}`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Pay ${o.vendorName}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={amount <= 0} onClick={() => void submit()}>
            Record payment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-muted">
          On {o.number}: <Money paise={o.paidPaise} /> paid of <Money paise={o.totalPaise} />. This is also entered under Expenses as “Weaver payments”.
        </p>
        <Field label="Amount paid">
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
            <Input type="date" value={paidOn} max={todayIso()} onChange={(e) => setPaidOn(e.target.value)} className="num" />
          </Field>
        </div>
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
        <Field label="Reference" hint="UPI id, cheque number… optional">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}

function CancelModal({ order: o, onClose }: { order: WeaverOrder; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api.weaverOrderCancel(o.id, reason);
      refresh();
      toast.success(`${o.number} cancelled`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Cancel ${o.number}?`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Keep the order</Button>
          <Button variant="danger" loading={saving} onClick={() => void submit()}>
            Cancel order
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-muted">Nothing has arrived on this order, so it can be cancelled. It stays in the list as cancelled.</p>
        <Field label="Why" hint="Optional">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} data-autofocus />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}
