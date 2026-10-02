import { Factory, Plus } from 'lucide-react';
import { useState } from 'react';
import { addDays, formatDate, todayIso } from '../../../shared/gst';
import { formatMoney } from '../../../shared/money';
import { PRODUCTION_STATUS_LABEL, type ProductionOrder, type ProductionStatus, type Variant } from '../../../shared/types';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, EmptyState, ErrorNote, Field, Input, Money, MoneyInput, Pill, Segmented, Select, TableSkeleton, Textarea, type PillTone } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { plural } from '../../lib/format';
import { InventoryShell } from './InventoryTabs';
import { SupplierSelect } from './MaterialModals';

const TONE: Record<ProductionStatus, PillTone> = { planned: 'neutral', making: 'partial', done: 'paid', cancelled: 'neutral' };

function StatusPill({ o }: { o: ProductionOrder }) {
  return o.overdue ? <Pill tone="overdue">Overdue</Pill> : <Pill tone={TONE[o.status]}>{PRODUCTION_STATUS_LABEL[o.status]}</Pill>;
}

/** Making sarees, in-house or by a karigar: what is being made, what has come back, and what it needs. */
export function ProductionPage() {
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const list = useQuery(() => api.productionList({ status: filter }), [filter]);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <InventoryShell
      tab="production"
      actions={
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
          New order
        </Button>
      }
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-ink-muted">Sarees being made, and the work given to karigars. Materials come off the shelf when work starts; finished pieces go on it as they arrive.</p>
        <Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} />
      </div>
      {list.error ? (
        <ErrorNote>{list.error}</ErrorNote>
      ) : !list.data ? (
        <TableSkeleton rows={3} columns={6} />
      ) : list.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Factory className="h-6 w-6" />}
            title={filter === 'open' ? 'Nothing is being made' : 'No production orders yet'}
            body="Plan an order for a colour and size: how many, who makes them and what they are paid. The raw materials, the finished stock and the karigar's bill are all looked after as the pieces arrive."
            actions={
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                New order
              </Button>
            }
          />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Order</th>
                <th className="th">Saree</th>
                <th className="th">Made by</th>
                <th className="th text-right">Received</th>
                <th className="th">Due</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((o) => (
                <tr key={o.id} tabIndex={0} onClick={() => setOpenId(o.id)} onKeyDown={(e) => e.key === 'Enter' && setOpenId(o.id)} className="cursor-pointer border-b border-line/70 transition-colors last:border-0 hover:bg-canvas focus-visible:bg-canvas">
                  <td className="td num">{o.number}</td>
                  <td className="td">
                    <div>{o.designName}</div>
                    <div className="text-xs text-ink-muted">{o.color} · {o.size}</div>
                  </td>
                  <td className="td text-ink-muted">{o.vendorName || 'In-house'}</td>
                  <td className="td num text-right">{o.receivedQty} / {o.qty}</td>
                  <td className={`td num whitespace-nowrap ${o.overdue ? 'text-status-overdue-fg' : 'text-ink-muted'}`}>{o.dueOn ? formatDate(o.dueOn) : '—'}</td>
                  <td className="td"><StatusPill o={o} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {creating && <OrderFormModal onClose={() => setCreating(false)} onSaved={(o) => { setCreating(false); setOpenId(o.id); }} />}
      {openId && <OrderModal id={openId} onClose={() => setOpenId(null)} />}
    </InventoryShell>
  );
}

function OrderFormModal({ order, onClose, onSaved }: { order?: ProductionOrder; onClose: () => void; onSaved: (o: ProductionOrder) => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const designs = useQuery(() => api.designsList());
  const [designId, setDesignId] = useState('');
  const detail = useQuery(() => (designId ? api.designGet(designId) : Promise.resolve(null)), [designId]);
  const [variantId, setVariantId] = useState(order?.variantId ?? '');
  const [qty, setQty] = useState(String(order?.qty ?? ''));
  const [vendorId, setVendorId] = useState(order?.vendorId ?? '');
  const [wage, setWage] = useState(order?.wagePaise ?? 0);
  const [dueOn, setDueOn] = useState(order?.dueOn ?? addDays(todayIso(), 15));
  const [note, setNote] = useState(order?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const variants: Variant[] = detail.data?.variants ?? [];

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const input = { variantId, qty: Number(qty), vendorId: vendorId || null, wagePaise: vendorId ? wage : 0, dueOn: dueOn || null, note };
      const saved = order ? await api.productionUpdate(order.id, input) : await api.productionCreate(input);
      refresh();
      toast.success(order ? 'Order updated' : `Order ${saved.number} planned`);
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={order ? `Change ${order.number}` : 'New production order'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!variantId || !Number(qty)} loading={saving} onClick={() => void save()}>
            {order ? 'Save' : 'Plan order'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {order ? (
          <p className="rounded-lg bg-canvas px-3 py-2">{order.designName} · {order.color} · {order.size}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Design">
              <Select value={designId} onChange={(e) => { setDesignId(e.target.value); setVariantId(''); }}>
                <option value="">Choose a design…</option>
                {(designs.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Colour and size">
              <Select value={variantId} disabled={!designId} onChange={(e) => setVariantId(e.target.value)}>
                <option value="">{designId ? 'Choose…' : '—'}</option>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>{v.color} · {v.size}</option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="How many pieces">
            <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} className="num text-right" />
          </Field>
          <Field label="Due by">
            <Input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
          </Field>
        </div>
        <SupplierSelect value={vendorId} onChange={setVendorId} label="Made by" hint="A karigar or vendor from your list. Leave empty for work done in-house." />
        {vendorId && (
          <Field label="Wage for each piece" hint="Each batch that arrives raises a bill to them for pieces × this wage, which you pay from Expenses.">
            <MoneyInput value={wage} onChange={setWage} />
          </Field>
        )}
        <Field label="Note">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — e.g. border design, deadline reason" />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}

function OrderModal({ id, onClose }: { id: string; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const query = useQuery(() => api.productionGet(id), [id]);
  const o = query.data;
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'cancel' | 'close' | null>(null);

  async function act(kind: string, work: () => Promise<unknown>, done: string) {
    setBusy(kind);
    try {
      await work();
      refresh();
      toast.success(done);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (!o) return <Modal title="Order" onClose={onClose}>{query.error ? <ErrorNote>{query.error}</ErrorNote> : <p className="text-ink-muted">Loading…</p>}</Modal>;
  if (editing) return <OrderFormModal order={o} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />;
  const open = o.status === 'planned' || o.status === 'making';
  const short = o.materials.some((m) => m.shortQty > 0);
  const toReceive = Number(qty) || o.remainingQty;

  return (
    <Modal
      title={`${o.number} — ${o.designName}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          {open && o.receivedQty === 0 && (
            <Button variant="danger" className="mr-auto" onClick={() => setConfirm('cancel')}>
              Cancel order
            </Button>
          )}
          {o.status === 'making' && o.receivedQty > 0 && (
            <Button className="mr-auto" onClick={() => setConfirm('close')} title="Finish with the pieces received; the materials for the rest go back">
              Close with fewer pieces
            </Button>
          )}
          {o.status === 'planned' && <Button onClick={() => setEditing(true)}>Change</Button>}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-ink-muted">
          <span>{o.color} · {o.size}</span>
          <span>Made by {o.vendorName || 'in-house'}</span>
          {o.wagePaise > 0 && <span>Wage <Money paise={o.wagePaise} fractionDigits={0} /> a piece</span>}
          {o.dueOn && <span className={o.overdue ? 'text-status-overdue-fg' : ''}>Due {formatDate(o.dueOn)}</span>}
          <StatusPill o={o} />
        </div>
        {o.note && <p className="rounded-lg bg-canvas px-3 py-2">{o.note}</p>}

        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <h3 className="text-base">Pieces</h3>
            <span className="num">{o.receivedQty} of {o.qty} received</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-line/60" role="progressbar" aria-valuenow={o.receivedQty} aria-valuemax={o.qty}>
            <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${Math.min(100, (o.receivedQty / o.qty) * 100)}%` }} />
          </div>
          {o.receipts.length > 0 && (
            <ul className="mt-3 divide-y divide-line/70">
              {o.receipts.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-1.5">
                  <span><span className="num text-ink-muted">{formatDate(r.receivedOn)}</span> <span className="ml-3">{plural(r.qty, 'piece')} received</span></span>
                  {r.wagePaise > 0 && <span className="text-ink-muted">wage <Money paise={r.wagePaise} fractionDigits={0} /> billed</span>}
                </li>
              ))}
            </ul>
          )}
          {open && (
            <div className="mt-3 flex items-end gap-3">
              <Field label="Pieces that arrived" className="w-40">
                <Input type="number" min={1} max={o.remainingQty} value={qty} placeholder={String(o.remainingQty)} onChange={(e) => setQty(e.target.value)} className="num text-right" />
              </Field>
              <Button variant="primary" loading={busy === 'receive'} disabled={short && !o.materialsIssued} onClick={() => void act('receive', async () => { await api.productionReceive(o.id, { qty: toReceive }); setQty(''); }, `${plural(toReceive, 'piece')} added to stock`)}>
                Receive {toReceive}
              </Button>
              {short && !o.materialsIssued && <span className="pb-2 text-xs text-status-overdue-fg">Buy the missing material first</span>}
            </div>
          )}
        </div>

        {o.materials.length > 0 && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-base">Raw materials</h3>
              {open && !o.materialsIssued && (
                <Button loading={busy === 'issue'} disabled={short} onClick={() => void act('issue', () => api.productionIssueMaterials(o.id), 'Materials handed over')}>
                  Hand over materials
                </Button>
              )}
              {o.materialsIssued && <span className="text-xs text-ink-muted">Handed over</span>}
            </div>
            <div className="overflow-hidden rounded-lg border border-line">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line bg-canvas text-left text-xs text-ink-muted">
                    <th className="px-3 py-2 font-medium">Material</th>
                    <th className="px-3 py-2 text-right font-medium">Needed</th>
                    <th className="px-3 py-2 text-right font-medium">On the shelf</th>
                    <th className="px-3 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {o.materials.map((m) => (
                    <tr key={m.materialId} className="border-b border-line/70 last:border-0">
                      <td className="px-3 py-2">{m.name}</td>
                      <td className="num px-3 py-2 text-right">{m.neededQty} {m.unit}</td>
                      <td className="num px-3 py-2 text-right">{m.inStockQty} {m.unit}</td>
                      <td className="px-3 py-2 text-xs">{m.shortQty > 0 ? <span className="text-status-overdue-fg">short by {m.shortQty} {m.unit}</span> : o.materialsIssued ? <span className="text-ink-muted">issued {m.issuedQty}</span> : <span className="text-status-paid-fg">enough</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-ink-muted">What the costing says each piece takes, with its wastage, times {o.qty}. The materials come off the shelf when handed over (or when the first pieces arrive).</p>
          </div>
        )}
      </div>

      {confirm === 'cancel' && (
        <ConfirmDialog title={`Cancel ${o.number}?`} confirmLabel="Cancel order" danger body="Nothing has arrived yet. Any materials already handed over go back on the shelf." onConfirm={() => act('cancel', () => api.productionCancel(o.id), 'Order cancelled')} onClose={() => setConfirm(null)} />
      )}
      {confirm === 'close' && (
        <ConfirmDialog
          title={`Close ${o.number} with ${o.receivedQty} of ${o.qty} pieces?`}
          confirmLabel="Close order"
          body={`The ${o.qty - o.receivedQty} pieces still to come will not be made. The raw material meant for them goes back on the shelf. The wage billed so far (${formatMoney(o.receipts.reduce((s, r) => s + r.wagePaise, 0), { fractionDigits: 0 })}) stays as it is.`}
          onConfirm={() => act('close', () => api.productionCloseShort(o.id), 'Order closed')}
          onClose={() => setConfirm(null)}
        />
      )}
    </Modal>
  );
}
