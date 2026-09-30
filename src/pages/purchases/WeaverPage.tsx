import { Archive, ArrowLeft, ClipboardList, HandCoins, Pencil, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { addDays, formatDate, todayIso } from '../../../shared/gst';
import { formatMoney } from '../../../shared/money';
import { JOB_ORDER_STATUS_LABEL, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type JobOrderStatus, type PaymentMethod, type Weaver } from '../../../shared/types';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, EmptyState, ErrorNote, Field, Figure, Input, Money, MoneyInput, PageHeader, Pill, Select, Spinner, Textarea, type PillTone } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { toNumber } from '../../lib/format';
import { navigate, paths } from '../../lib/router';
import { WeaverFormModal } from './WeaversPage';

const STATUS_TONE: Record<JobOrderStatus, PillTone> = { open: 'partial', complete: 'paid', closed: 'neutral', cancelled: 'neutral' };
export const JobOrderPill = ({ status, overdue }: { status: JobOrderStatus; overdue?: boolean }) => (overdue ? <Pill tone="overdue">Overdue</Pill> : <Pill tone={STATUS_TONE[status]}>{JOB_ORDER_STATUS_LABEL[status]}</Pill>);

/** A new order for a weaver: which saree, how many, and the wage per piece. */
export function NewJobOrderModal({ weaver, onClose }: { weaver: Weaver; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const variants = useQuery(() => api.variantsForSale());
  const [variantId, setVariantId] = useState('');
  const [qty, setQty] = useState('5');
  const [wage, setWage] = useState(0);
  const [expectedOn, setExpectedOn] = useState(addDays(todayIso(), 21));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const n = toNumber(qty);
      const order = await api.jobOrderCreate({ weaverId: weaver.id, variantId, qty: n, wagePaise: wage, expectedOn: expectedOn || null, note });
      refresh();
      toast.success(`${order.number} placed with ${weaver.name}`);
      onClose();
      navigate(paths.jobOrder(order.id));
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`New order for ${weaver.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="job-order-form" loading={saving} disabled={!variantId}>
            Place order
          </Button>
        </>
      }
    >
      <form id="job-order-form" onSubmit={submit} className="space-y-4">
        <Field label="Saree to make">
          <Select value={variantId} onChange={(e) => setVariantId(e.target.value)} aria-label="Saree to make" data-autofocus>
            <option value="">Choose a saree</option>
            {(variants.data ?? []).map((v) => (
              <option key={v.variantId} value={v.variantId}>
                {v.designName} · {v.color} · {v.size}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Pieces">
            <Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" className="num text-right" aria-label="Pieces" />
          </Field>
          <Field label="Wage per piece">
            <MoneyInput value={wage} onChange={setWage} aria-label="Wage per piece" />
          </Field>
          <Field label="Expected by">
            <Input type="date" value={expectedOn} min={todayIso()} onChange={(e) => setExpectedOn(e.target.value)} className="num" />
          </Field>
        </div>
        <Field label="Note">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Border, motifs, anything the weaver should know (optional)" />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}

function PayWeaverModal({ weaver, onClose }: { weaver: Weaver; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [amount, setAmount] = useState(Math.max(0, weaver.balancePaise));
  const [paidOn, setPaidOn] = useState(todayIso());
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.weaverPaymentRecord({ weaverId: weaver.id, amountPaise: amount, method, reference, paidOn, note });
      refresh();
      toast.success(`${formatMoney(amount)} paid to ${weaver.name}`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Pay ${weaver.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="weaver-pay-form" loading={saving} disabled={amount <= 0}>
            Record payment
          </Button>
        </>
      }
    >
      <form id="weaver-pay-form" onSubmit={submit} className="space-y-4">
        <p className="text-ink-muted">
          {weaver.balancePaise > 0 ? <>You owe {weaver.name} <Money paise={weaver.balancePaise} /> for pieces received.</> : <>Nothing is owed right now. A payment now is held as an advance against future pieces.</>}
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount">
            <MoneyInput value={amount} onChange={setAmount} aria-label="Amount" data-autofocus />
          </Field>
          <Field label="Date">
            <Input type="date" value={paidOn} max={todayIso()} onChange={(e) => setPaidOn(e.target.value)} className="num" />
          </Field>
          <Field label="Paid by">
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => (
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
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional, e.g. advance for yarn" maxLength={200} />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}

export function WeaverPage({ id }: { id: string }) {
  const toast = useToast();
  const refresh = useRefresh();
  const weaver = useQuery(() => api.weaverGet(id), [id]);
  const ledger = useQuery(() => api.weaverLedger(id), [id]);
  const orders = useQuery(() => api.jobOrdersList({ weaverId: id }), [id]);
  const payments = useQuery(() => api.weaverPaymentsList({ weaverId: id }), [id]);
  const [dialog, setDialog] = useState<'edit' | 'archive' | 'pay' | 'order' | null>(null);
  const [reversing, setReversing] = useState<string | null>(null);
  const w = weaver.data;

  const back = (
    <a href={`#${paths.weavers}`} className="inline-flex items-center gap-1.5 rounded-lg text-ink-muted transition-colors hover:text-ink">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Weavers
    </a>
  );
  if (weaver.error && !w) {
    return (
      <>
        <PageHeader title="Weaver not found" back={back} />
        <ErrorNote>{weaver.error}</ErrorNote>
      </>
    );
  }
  if (!w) {
    return (
      <>
        <PageHeader title="" back={back} />
        <Spinner />
      </>
    );
  }

  return (
    <>
      <PageHeader
        back={back}
        title={w.name}
        subtitle={[w.phone, w.place].filter(Boolean).join(' · ') || undefined}
        actions={
          <>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setDialog('order')}>
              New order
            </Button>
            <Button icon={<HandCoins className="h-4 w-4" />} onClick={() => setDialog('pay')}>
              Pay
            </Button>
            <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setDialog('edit')}>
              Edit
            </Button>
            <Button variant="danger" icon={<Archive className="h-4 w-4" />} onClick={() => setDialog('archive')}>
              Archive
            </Button>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-4 gap-6">
        <Figure label={w.balancePaise > 0 ? 'You owe them' : w.balancePaise < 0 ? 'Paid ahead' : 'Settled'} highlight>
          <Money paise={Math.abs(w.balancePaise)} fractionDigits={0} />
        </Figure>
        <Figure label="Wages earned" sub="On pieces received">
          <Money paise={w.earnedPaise} fractionDigits={0} />
        </Figure>
        <Figure label="Paid">
          <Money paise={w.paidPaise} fractionDigits={0} />
        </Figure>
        <Figure label="Pieces still out" sub={`${w.openOrders} open ${w.openOrders === 1 ? 'order' : 'orders'}`}>
          {w.piecesPending}
        </Figure>
      </div>
      {w.notes && <p className="mb-8 text-ink-muted">{w.notes}</p>}

      <h2 className="mb-3 text-base">Orders</h2>
      <Card className="mb-8 overflow-x-auto">
        {orders.data?.length === 0 ? (
          <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="No orders yet" body={`Place an order with ${w.name}: which saree, how many, and the wage per piece.`} actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setDialog('order')}>New order</Button>} />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Order</th>
                <th className="th">Saree</th>
                <th className="th text-right">Received</th>
                <th className="th text-right">Wage</th>
                <th className="th">Expected</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.data?.map((o) => (
                <tr key={o.id} tabIndex={0} onClick={() => navigate(paths.jobOrder(o.id))} onKeyDown={(e) => e.key === 'Enter' && navigate(paths.jobOrder(o.id))} className="animate-fade-in cursor-pointer border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas focus-visible:bg-canvas">
                  <td className="td num whitespace-nowrap">{o.number}</td>
                  <td className="td">
                    {o.designName}
                    <div className="text-xs text-ink-muted">{o.color} · {o.size}</div>
                  </td>
                  <td className="td num text-right">{o.receivedQty} of {o.qty}</td>
                  <td className="td text-right"><Money paise={o.wagePaise} /></td>
                  <td className="td num whitespace-nowrap text-ink-muted">{o.expectedOn ? formatDate(o.expectedOn) : '-'}</td>
                  <td className="td"><JobOrderPill status={o.status} overdue={o.overdue} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="mb-3 flex items-end justify-between">
        <h2 className="text-base">Statement</h2>
        <span className="text-xs text-ink-muted">Wages are earned when pieces come back; payments reduce what you owe. A minus balance means you have paid ahead.</span>
      </div>
      <Card className="mb-8 overflow-x-auto">
        {ledger.data?.entries.length === 0 ? (
          <p className="p-6 text-ink-muted">Nothing yet. Receive pieces or record a payment and it builds up here.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Date</th>
                <th className="th">Details</th>
                <th className="th text-right">Earned</th>
                <th className="th text-right">Paid</th>
                <th className="th text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {ledger.data?.entries.map((e, i) => (
                <tr key={i} onClick={() => e.orderId && navigate(paths.jobOrder(e.orderId))} className={`animate-fade-in border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas ${e.orderId ? 'cursor-pointer' : ''} ${e.kind === 'received-reversed' || e.kind === 'payment-voided' ? 'text-ink-muted' : ''}`}>
                  <td className="td num whitespace-nowrap text-ink-muted">{formatDate(e.date)}</td>
                  <td className="td">{e.description}</td>
                  <td className="td text-right">{e.earnedPaise ? <Money paise={e.earnedPaise} /> : <span className="text-ink-muted/50">-</span>}</td>
                  <td className="td text-right">{e.paidPaise ? <Money paise={e.paidPaise} /> : <span className="text-ink-muted/50">-</span>}</td>
                  <td className={`td text-right ${e.balancePaise < 0 ? 'text-status-partial-fg' : ''}`}><Money paise={e.balancePaise} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {(payments.data ?? []).some((p) => !p.voided) && (
        <>
          <h2 className="mb-3 text-base">Payments</h2>
          <Card className="overflow-x-auto">
            <table className="w-full">
              <tbody>
                {payments.data?.filter((p) => !p.voided).map((p) => (
                  <tr key={p.id} className="border-b border-line/70 last:border-0">
                    <td className="td num whitespace-nowrap text-ink-muted">{formatDate(p.paidOn)}</td>
                    <td className="td">
                      {PAYMENT_METHOD_LABEL[p.method]}
                      {p.reference && <span className="num ml-2 text-xs text-ink-muted">{p.reference}</span>}
                      {p.note && <div className="text-xs text-ink-muted">{p.note}</div>}
                    </td>
                    <td className="td text-right"><Money paise={p.amountPaise} /></td>
                    <td className="td w-24 text-right"><Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => setReversing(p.id)}>Reverse</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {dialog === 'edit' && <WeaverFormModal weaver={w} onClose={() => setDialog(null)} onSaved={() => setDialog(null)} />}
      {dialog === 'pay' && <PayWeaverModal weaver={w} onClose={() => setDialog(null)} />}
      {dialog === 'order' && <NewJobOrderModal weaver={w} onClose={() => setDialog(null)} />}
      {dialog === 'archive' && (
        <ConfirmDialog
          title={`Archive ${w.name}?`}
          confirmLabel="Archive weaver"
          danger
          body={<p>They disappear from your weaver list. This is refused while they have open orders or money is owed either way.</p>}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.weaverArchive(w.id);
            refresh();
            toast.success(`${w.name} archived`);
            navigate(paths.weavers);
          }}
        />
      )}
      {reversing && (
        <ConfirmDialog
          title="Reverse this payment?"
          confirmLabel="Reverse payment"
          danger
          body={<p>It stops counting as paid, so the balance goes back up. It stays in the statement as a reversal.</p>}
          onClose={() => setReversing(null)}
          onConfirm={async () => {
            try {
              await api.weaverPaymentVoid(reversing, '');
              refresh();
              toast.success('Payment reversed');
            } catch (err) {
              throw new Error(errorMessage(err));
            }
          }}
        />
      )}
    </>
  );
}
