import { ArrowLeft, Ban, CheckCheck, PackageCheck, PackagePlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { formatDate, todayIso } from '../../../shared/gst';
import { formatMoney } from '../../../shared/money';
import type { JobOrder } from '../../../shared/types';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, EmptyState, ErrorNote, Field, Figure, Input, Money, PageHeader, Select, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { toNumber } from '../../lib/format';
import { paths } from '../../lib/router';
import { JobOrderPill } from './WeaverPage';

function IssueMaterialModal({ order, onClose }: { order: JobOrder; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const materials = useQuery(() => api.materialsList());
  const [materialId, setMaterialId] = useState('');
  const [qty, setQty] = useState('');
  const [back, setBack] = useState(false);
  const [issuedOn, setIssuedOn] = useState(todayIso());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const material = materials.data?.find((m) => m.id === materialId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const n = toNumber(qty);
      if (!Number.isFinite(n) || n <= 0) throw new Error('Enter how much, as a number above zero.');
      await api.jobOrderIssueMaterial({ orderId: order.id, materialId, qty: back ? -n : n, issuedOn, note });
      refresh();
      toast.success(back ? 'Material handed back recorded' : 'Material handed over recorded');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={back ? 'Material handed back' : 'Hand over material'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="issue-material-form" loading={saving} disabled={!materialId}>
            Save
          </Button>
        </>
      }
    >
      <form id="issue-material-form" onSubmit={submit} className="space-y-4">
        <Field label="Raw material">
          <Select value={materialId} onChange={(e) => setMaterialId(e.target.value)} aria-label="Raw material" data-autofocus>
            <option value="">Choose a raw material</option>
            {(materials.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.unit})
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={`Quantity${material ? ` (${material.unit})` : ''}`} hint={material ? `Valued at ${formatMoney(material.unitCostPaise)} per ${material.unit} today` : undefined}>
            <Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className="num text-right" aria-label="Quantity" />
          </Field>
          <Field label="Date">
            <Input type="date" value={issuedOn} max={todayIso()} onChange={(e) => setIssuedOn(e.target.value)} className="num" />
          </Field>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-ink-muted">
          <input type="checkbox" checked={back} onChange={(e) => setBack(e.target.checked)} className="h-4 w-4 accent-[#0F6E56]" />
          The weaver is handing this back (leftover material)
        </label>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" maxLength={200} />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}

function ReceiveModal({ order, onClose }: { order: JobOrder; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const left = Math.max(0, order.qty - order.receivedQty);
  const [qty, setQty] = useState(String(left || 1));
  const [receivedOn, setReceivedOn] = useState(todayIso());
  const [updateCost, setUpdateCost] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const n = toNumber(qty);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.jobOrderReceive({ orderId: order.id, qty: n, receivedOn, note, updateCost });
      refresh();
      toast.success(`${n} ${n === 1 ? 'piece' : 'pieces'} received into stock`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Receive pieces"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="receive-form" loading={saving} disabled={!Number.isInteger(n) || n < 1}>
            Receive into stock
          </Button>
        </>
      }
    >
      <form id="receive-form" onSubmit={submit} className="space-y-4">
        <p className="text-ink-muted">
          {order.designName} ({order.color}) from {order.weaverName}: {order.receivedQty} of {order.qty} received so far. {left > 0 ? `${left} still to come.` : 'The order is complete.'}
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Pieces received" hint={Number.isInteger(n) && n > 0 ? `Wage for these: ${formatMoney(n * order.wagePaise)}` : undefined}>
            <Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" className="num text-right" aria-label="Pieces received" data-autofocus />
          </Field>
          <Field label="Date">
            <Input type="date" value={receivedOn} min={order.orderedOn} max={todayIso()} onChange={(e) => setReceivedOn(e.target.value)} className="num" />
          </Field>
        </div>
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#0F6E56]" />
          <span>
            <span className="block">Set this saree's cost to what these really cost</span>
            <span className="block text-xs text-ink-muted">Wage {formatMoney(order.wagePaise)} plus the material handed over, {formatMoney(order.realCostPerPiecePaise)} a piece.</span>
          </span>
        </label>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" maxLength={200} />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}

export function JobOrderPage({ id }: { id: string }) {
  const toast = useToast();
  const refresh = useRefresh();
  const query = useQuery(() => api.jobOrderGet(id), [id]);
  const o = query.data;
  const [dialog, setDialog] = useState<'issue' | 'receive' | 'close' | 'cancel' | null>(null);
  const [reversing, setReversing] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const back = (
    <a href={o ? `#${paths.weaver(o.weaverId)}` : `#${paths.weavers}`} className="inline-flex items-center gap-1.5 rounded-lg text-ink-muted transition-colors hover:text-ink">
      <ArrowLeft className="h-4 w-4" aria-hidden /> {o ? o.weaverName : 'Weavers'}
    </a>
  );
  if (query.error && !o) {
    return (
      <>
        <PageHeader title="Order not found" back={back} />
        <ErrorNote>{query.error}</ErrorNote>
      </>
    );
  }
  if (!o) {
    return (
      <>
        <PageHeader title="" back={back} />
        <Spinner />
      </>
    );
  }

  const live = o.status === 'open' || o.status === 'complete';
  const left = Math.max(0, o.qty - o.receivedQty);

  return (
    <>
      <PageHeader
        back={back}
        title={
          <span className="flex items-center gap-3">
            <span className="num">{o.number}</span>
            <JobOrderPill status={o.status} overdue={o.overdue} />
          </span>
        }
        subtitle={
          <>
            {o.qty} × {o.designName} ({o.color}, {o.size}) for {o.weaverName} at {formatMoney(o.wagePaise)} a piece · ordered {formatDate(o.orderedOn)}
            {o.expectedOn && <> · expected {formatDate(o.expectedOn)}</>}
          </>
        }
        actions={
          live && (
            <>
              <Button variant="primary" icon={<PackageCheck className="h-4 w-4" />} onClick={() => setDialog('receive')}>
                Receive pieces
              </Button>
              <Button icon={<PackagePlus className="h-4 w-4" />} onClick={() => setDialog('issue')}>
                Hand over material
              </Button>
              {left > 0 && o.receivedQty > 0 && (
                <Button icon={<CheckCheck className="h-4 w-4" />} onClick={() => setDialog('close')}>
                  Close short
                </Button>
              )}
              {o.receivedQty === 0 && (
                <Button variant="danger" icon={<Ban className="h-4 w-4" />} onClick={() => setDialog('cancel')}>
                  Cancel
                </Button>
              )}
            </>
          )
        }
      />
      {o.status === 'closed' && <div className="mb-6 rounded-lg bg-status-neutral-bg px-4 py-3 text-ink-muted">Closed short{o.closeReason ? `: ${o.closeReason}` : ''}. What was received stays received and is still owed.</div>}
      {o.status === 'cancelled' && <div className="mb-6 rounded-lg bg-status-neutral-bg px-4 py-3 text-ink-muted">Cancelled{o.closeReason ? `: ${o.closeReason}` : ''}.</div>}

      <div className="mb-8 grid grid-cols-4 gap-6">
        <Figure label="Received" sub={left > 0 ? `${left} still to come` : o.receivedQty > o.qty ? `${o.receivedQty - o.qty} extra` : 'All in'} highlight>
          {`${o.receivedQty} of ${o.qty}`}
        </Figure>
        <Figure label="Wages earned" sub={`${formatMoney(o.wagePaise)} a piece`}>
          <Money paise={o.earnedPaise} fractionDigits={0} />
        </Figure>
        <Figure label="Material handed over" sub="At cost when issued">
          <Money paise={o.materialsValuePaise} fractionDigits={0} />
        </Figure>
        <Figure label="Real cost per piece" sub="Wage plus material">
          <Money paise={o.realCostPerPiecePaise} fractionDigits={0} />
        </Figure>
      </div>

      <h2 className="mb-3 text-base">Material handed over</h2>
      <Card className="mb-8 overflow-x-auto">
        {o.materials.length === 0 ? (
          <EmptyState icon={<PackagePlus className="h-6 w-6" />} title="No material handed over yet" body="Note the yarn, zari or dye you give the weaver for this order, so the real cost of each piece is known." />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Date</th>
                <th className="th">Material</th>
                <th className="th text-right">Quantity</th>
                <th className="th text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {o.materials.map((m) => (
                <tr key={m.id} className="border-b border-line/70 last:border-0">
                  <td className="td num whitespace-nowrap text-ink-muted">{formatDate(m.issuedOn)}</td>
                  <td className="td">
                    {m.materialName}
                    {m.note && <div className="text-xs text-ink-muted">{m.note}</div>}
                  </td>
                  <td className={`td num text-right ${m.qty < 0 ? 'text-status-partial-fg' : ''}`}>
                    {m.qty > 0 ? '' : '−'}
                    {Math.abs(+m.qty.toFixed(3))} {m.unit}
                  </td>
                  <td className="td text-right"><Money paise={Math.round(m.qty * m.unitCostPaise)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <h2 className="mb-3 text-base">Pieces received</h2>
      <Card className="overflow-x-auto">
        {o.receipts.length === 0 ? (
          <EmptyState icon={<PackageCheck className="h-6 w-6" />} title="Nothing received yet" body="When pieces come back, receive them here. They go into stock straight away and the wage for them becomes owed." />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Date</th>
                <th className="th text-right">Pieces</th>
                <th className="th text-right">Wage</th>
                <th className="th">Note</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {o.receipts.map((r) => (
                <tr key={r.id} className={`border-b border-line/70 last:border-0 ${r.reversed ? 'text-ink-muted line-through' : ''}`}>
                  <td className="td num whitespace-nowrap">{formatDate(r.receivedOn)}</td>
                  <td className="td num text-right">{r.qty}</td>
                  <td className="td text-right"><Money paise={r.qty * o.wagePaise} /></td>
                  <td className="td no-underline">{r.reversed ? <span className="no-underline">Reversed{r.reverseReason ? `: ${r.reverseReason}` : ''}</span> : r.note}</td>
                  <td className="td text-right">{!r.reversed && live && <Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => setReversing(r.id)}>Reverse</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {dialog === 'issue' && <IssueMaterialModal order={o} onClose={() => setDialog(null)} />}
      {dialog === 'receive' && <ReceiveModal order={o} onClose={() => setDialog(null)} />}
      {(dialog === 'close' || dialog === 'cancel') && (
        <ConfirmDialog
          title={dialog === 'close' ? `Close ${o.number} short?` : `Cancel ${o.number}?`}
          confirmLabel={dialog === 'close' ? 'Close order' : 'Cancel order'}
          danger
          body={
            <div className="space-y-4">
              <p>{dialog === 'close' ? `You received ${o.receivedQty} of ${o.qty}. The order stops waiting for the rest; what was received stays in stock and stays owed.` : 'Nothing has been received on it, so it simply stops. It stays on record.'}</p>
              <Field label="Reason">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" data-autofocus />
              </Field>
            </div>
          }
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            if (dialog === 'close') await api.jobOrderClose(o.id, reason);
            else await api.jobOrderCancel(o.id, reason);
            refresh();
            toast.success(dialog === 'close' ? `${o.number} closed` : `${o.number} cancelled`);
          }}
        />
      )}
      {reversing && (
        <ConfirmDialog
          title="Reverse this receipt?"
          confirmLabel="Reverse receipt"
          danger
          body={<p>The pieces come back out of stock (this is refused if some are already sold) and their wage is no longer owed. It stays on the order as a reversal.</p>}
          onClose={() => setReversing(null)}
          onConfirm={async () => {
            await api.jobOrderReverseReceipt(reversing, '');
            refresh();
            toast.success('Receipt reversed');
          }}
        />
      )}
    </>
  );
}
