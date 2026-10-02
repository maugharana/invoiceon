import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { addDays, todayIso } from '../../../shared/gst';
import { mulPaise, formatMoney } from '../../../shared/money';
import { MATERIAL_REASON_LABEL, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type ExpenseStatus, type Material, type MaterialMovementReason, type PaymentMethod, type PurchaseResult, type Simulation } from '../../../shared/types';
import { suggestAccount } from '../../../shared/accountChoice';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, IconButton, Input, Money, MoneyInput, Segmented, Select, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { formatDateTime, toNumber } from '../../lib/format';

/** Pick who something is bought from, or add them on the spot. */
export function SupplierSelect({ value, onChange, label = 'Supplier', hint, noun = 'supplier' }: { value: string; onChange: (id: string) => void; label?: string; hint?: string; noun?: string }) {
  const refresh = useRefresh();
  const vendors = useQuery(() => api.vendorsList());
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    try {
      const v = await api.vendorCreate({ name, phone: '', gstin: '', address: '', notes: '' });
      refresh();
      onChange(v.id);
      setAdding(false);
      setName('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Field label={label} hint={hint}>
      {adding ? (
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${noun[0]!.toUpperCase()}${noun.slice(1)}'s name`} data-autofocus />
          <Button variant="primary" disabled={!name.trim()} onClick={() => void add()}>
            Add
          </Button>
          <Button onClick={() => setAdding(false)}>Cancel</Button>
        </div>
      ) : (
        <Select
          value={value}
          onChange={(e) => {
            if (e.target.value === '__new__') setAdding(true);
            else onChange(e.target.value);
          }}
        >
          <option value="">Not set</option>
          {(vendors.data ?? []).map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
          <option value="__new__">＋ Add a new {noun}…</option>
        </Select>
      )}
      {error && <span className="mt-1 block text-xs text-status-overdue-fg">{error}</span>}
    </Field>
  );
}

// ── Taking stock in or out by hand ──────────────────────────────────────────
export function AdjustMaterialModal({ material, onClose }: { material: Material; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [reason, setReason] = useState<MaterialMovementReason>('used');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const n = toNumber(qty);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api.materialAdjust({ materialId: material.id, delta: direction === 'out' ? -n : n, reason, note });
      refresh();
      toast.success(`${material.name} updated`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Adjust ${material.name}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!(n > 0)} onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-muted">
          In hand now: <span className="num text-ink">{material.stockQty} {material.unit}</span>. Bought some? Use “Buy materials” so the price and bill are kept.
        </p>
        <Segmented
          label="Direction"
          value={direction}
          onChange={(d) => {
            setDirection(d);
            setReason(d === 'out' ? 'used' : 'adjustment');
          }}
          options={[
            { value: 'out', label: 'Take out' },
            { value: 'in', label: 'Add (count correction)' },
          ]}
        />
        <div className="grid grid-cols-2 gap-4">
          <Field label={`Quantity (${material.unit})`}>
            <Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className="num" data-autofocus />
          </Field>
          {direction === 'out' && (
            <Field label="Why">
              <Select value={reason} onChange={(e) => setReason(e.target.value as MaterialMovementReason)}>
                <option value="used">Used in making</option>
                <option value="wastage">Wasted / spoiled</option>
                <option value="adjustment">Count correction</option>
              </Select>
            </Field>
          )}
        </div>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — e.g. batch for the Diwali order" />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}

// ── History of stock and price ──────────────────────────────────────────────
export function MaterialHistoryModal({ material, onClose }: { material: Material; onClose: () => void }) {
  const [tab, setTab] = useState<'stock' | 'price'>('stock');
  const movements = useQuery(() => api.materialMovements(material.id), [material.id]);
  const prices = useQuery(() => api.materialPriceHistory(material.id), [material.id]);
  const source = { opening: 'Starting price', manual: 'Changed by hand', purchase: 'From a purchase' } as const;

  return (
    <Modal title={material.name} size="lg" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="mb-4">
        <Segmented
          label="History"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'stock', label: 'Stock' },
            { value: 'price', label: 'Price' },
          ]}
        />
      </div>
      <div className="-mx-2 max-h-[50vh] overflow-y-auto">
        {tab === 'stock' ? (
          movements.loading ? (
            <Spinner />
          ) : (movements.data?.length ?? 0) === 0 ? (
            <p className="py-6 text-center text-ink-muted">No stock movements yet.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className="th">When</th>
                  <th className="th">Why</th>
                  <th className="th text-right">Change</th>
                  <th className="th text-right">In hand</th>
                </tr>
              </thead>
              <tbody>
                {movements.data?.map((m) => (
                  <tr key={m.id} className="border-b border-line/60 last:border-0">
                    <td className="td whitespace-nowrap text-ink-muted">{formatDateTime(m.createdAt)}</td>
                    <td className="td">
                      {MATERIAL_REASON_LABEL[m.reason]}
                      {m.note && <div className="text-xs text-ink-muted">{m.note}</div>}
                    </td>
                    <td className={`td num text-right ${m.delta > 0 ? 'text-status-paid-fg' : 'text-status-overdue-fg'}`}>
                      {m.delta > 0 ? '+' : '−'}
                      {Math.abs(m.delta)} {material.unit}
                    </td>
                    <td className="td num text-right">{m.balanceAfter}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : prices.loading ? (
          <Spinner />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">From</th>
                <th className="th text-right">Cost per {material.unit}</th>
                <th className="th text-right">Change</th>
                <th className="th">How</th>
              </tr>
            </thead>
            <tbody>
              {prices.data?.map((p, i) => {
                const before = prices.data![i + 1];
                const diff = before ? p.unitCostPaise - before.unitCostPaise : 0;
                return (
                  <tr key={p.changedAt + i} className="border-b border-line/60 last:border-0">
                    <td className="td whitespace-nowrap text-ink-muted">
                      {formatDateTime(p.changedAt)}
                      {i === 0 && <span className="ml-2 text-xs text-brand">now</span>}
                    </td>
                    <td className="td text-right">
                      <Money paise={p.unitCostPaise} />
                    </td>
                    <td className={`td text-right ${diff > 0 ? 'text-status-overdue-fg' : diff < 0 ? 'text-status-paid-fg' : 'text-ink-muted'}`}>
                      {before ? diff === 0 ? 'same' : <>{diff > 0 ? '▲ ' : '▼ '}<Money paise={Math.abs(diff)} /></> : 'first price'}
                    </td>
                    <td className="td text-ink-muted">{source[p.source]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}

// ── Buying materials ────────────────────────────────────────────────────────
interface PurchaseRow {
  key: number;
  materialId: string;
  qty: string;
  price: number;
}

export function PurchaseModal({ materials, onClose, presetMaterialId }: { materials: Material[]; onClose: () => void; presetMaterialId?: string }) {
  const toast = useToast();
  const refresh = useRefresh();
  const settings = useQuery(() => api.getSettings());
  const accounts = settings.data?.paymentAccounts ?? [];
  const first = materials.find((m) => m.id === presetMaterialId) ?? materials[0];
  const [supplierId, setSupplierId] = useState(first?.supplierId ?? '');
  const [date, setDate] = useState(todayIso());
  const [billNo, setBillNo] = useState('');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<PurchaseRow[]>(first ? [{ key: 1, materialId: first.id, qty: '', price: first.unitCostPaise }] : []);
  const [gst, setGst] = useState(0);
  const [showGst, setShowGst] = useState(false);
  const [record, setRecord] = useState(true);
  const [status, setStatus] = useState<ExpenseStatus>('paid');
  const [method, setMethod] = useState<PaymentMethod>('bank');
  const [accountId, setAccountId] = useState('');
  const [dueDate, setDueDate] = useState(addDays(todayIso(), 15));
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<PurchaseResult | null>(null);

  const byId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const total = rows.reduce((s, r) => s + mulPaise(toNumber(r.qty) || 0, r.price), 0);
  const ready = rows.length > 0 && rows.every((r) => toNumber(r.qty) > 0);

  const setRow = (key: number, patch: Partial<PurchaseRow>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  function pickMaterial(key: number, id: string) {
    const m = byId.get(id);
    setRow(key, { materialId: id, price: m?.unitCostPaise ?? 0 });
    if (!supplierId && m?.supplierId) setSupplierId(m.supplierId);
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const r = await api.purchaseCreate({
        supplierId: supplierId || null,
        date,
        billNo,
        note,
        gstPaise: showGst ? gst : 0,
        lines: rows.map((x) => ({ materialId: x.materialId, qty: toNumber(x.qty), unitCostPaise: x.price })),
        expense: record ? { method, accountId: touched ? accountId : suggestAccount(method, accounts), status, dueDate: status === 'unpaid' ? dueDate : null } : null,
      });
      refresh();
      if (r.priceChanges.length === 0) {
        toast.success('Purchase recorded');
        onClose();
      } else setResult(r);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  if (result) {
    return (
      <Modal title="Purchase recorded" size="sm" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <p className="mb-3 text-ink-muted">Stock is updated. These materials now cost what you just paid, and every saree that uses them has been re-costed:</p>
        <ul className="divide-y divide-line/70">
          {result.priceChanges.map((c) => (
            <li key={c.materialId} className="flex items-center justify-between py-2">
              <span>{c.materialName}</span>
              <span className={`num text-xs ${c.toPaise > c.fromPaise ? 'text-status-overdue-fg' : 'text-status-paid-fg'}`}>
                {formatMoney(c.fromPaise, { fractionDigits: 0 })} → {formatMoney(c.toPaise, { fractionDigits: 0 })}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-muted">Use “What if prices change?” to see what this does to your margins.</p>
      </Modal>
    );
  }

  return (
    <Modal
      title="Buy raw materials"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!ready} onClick={() => void submit()}>
            Record purchase
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-4">
          <SupplierSelect value={supplierId} onChange={setSupplierId} label="Bought from" />
          <Field label="Date">
            <Input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} className="num" />
          </Field>
          <Field label="Bill number">
            <Input value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="Optional" />
          </Field>
        </div>

        <div className="rounded-lg border border-line">
          <div className="grid grid-cols-[1fr_6rem_9rem_7rem_2rem] gap-3 border-b border-line px-3 py-2 text-xs font-medium text-ink-muted">
            <span>Material</span>
            <span className="text-right">Quantity</span>
            <span className="text-right">Price each</span>
            <span className="text-right">Amount</span>
            <span />
          </div>
          {rows.map((r) => {
            const m = byId.get(r.materialId);
            const changed = m && r.price !== m.unitCostPaise;
            return (
              <div key={r.key} className="grid grid-cols-[1fr_6rem_9rem_7rem_2rem] items-start gap-3 border-b border-line/70 px-3 py-2 last:border-0">
                <div>
                  <Select value={r.materialId} onChange={(e) => pickMaterial(r.key, e.target.value)} aria-label="Material">
                    {materials.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} ({x.unit})
                      </option>
                    ))}
                  </Select>
                  {changed && m && (
                    <div className={`mt-1 text-xs ${r.price > m.unitCostPaise ? 'text-status-overdue-fg' : 'text-status-paid-fg'}`}>
                      {r.price > m.unitCostPaise ? 'Dearer' : 'Cheaper'} than the {formatMoney(m.unitCostPaise, { fractionDigits: 0 })} it was
                    </div>
                  )}
                </div>
                <Input value={r.qty} onChange={(e) => setRow(r.key, { qty: e.target.value })} inputMode="decimal" className="num text-right" aria-label="Quantity" data-autofocus={r === rows[0] ? true : undefined} />
                <MoneyInput value={r.price} onChange={(p) => setRow(r.key, { price: p })} aria-label="Price each" />
                <div className="flex h-9 items-center justify-end">
                  <Money paise={mulPaise(toNumber(r.qty) || 0, r.price)} />
                </div>
                <IconButton label="Remove this line" onClick={() => setRows(rows.filter((x) => x.key !== r.key))} disabled={rows.length === 1}>
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </div>
            );
          })}
          <div className="flex items-center justify-between px-3 py-2">
            <Button
              className="h-8 text-xs"
              icon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => {
                const next = materials.find((m) => !rows.some((r) => r.materialId === m.id));
                if (next) setRows([...rows, { key: Math.max(0, ...rows.map((r) => r.key)) + 1, materialId: next.id, qty: '', price: next.unitCostPaise }]);
              }}
              disabled={rows.length >= materials.length}
            >
              Add another material
            </Button>
            <span>
              Total <Money paise={total} className="ml-2 text-base" />
            </span>
          </div>
        </div>

        {showGst ? (
          <Field label="GST on the bill" hint="Included in the prices above. Claimed as input tax.">
            <MoneyInput value={gst} onChange={setGst} className="max-w-[12rem]" />
          </Field>
        ) : (
          <button type="button" onClick={() => setShowGst(true)} className="text-sm text-brand transition-colors hover:text-brand-hover">
            + This bill has GST on it
          </button>
        )}

        <div className="rounded-lg bg-canvas p-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} className="h-4 w-4 accent-[#0F6E56]" />
            <span>Also record it as an expense</span>
          </label>
          {record && (
            <div className="mt-3 space-y-3">
              <Segmented
                label="Is it paid?"
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'paid', label: 'Paid' },
                  { value: 'unpaid', label: 'Pay later' },
                ]}
              />
              <div className="grid grid-cols-3 gap-3">
                <Field label="Paid by">
                  <Select
                    value={method}
                    onChange={(e) => {
                      setMethod(e.target.value as PaymentMethod);
                      setTouched(false);
                    }}
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABEL[m]}
                      </option>
                    ))}
                  </Select>
                </Field>
                {accounts.length > 0 && (
                  <Field label="From account">
                    <Select
                      value={touched ? accountId : suggestAccount(method, accounts)}
                      onChange={(e) => {
                        setTouched(true);
                        setAccountId(e.target.value);
                      }}
                    >
                      <option value="">Not recorded</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {status === 'unpaid' && (
                  <Field label="Due date">
                    <Input type="date" value={dueDate} min={date} onChange={(e) => setDueDate(e.target.value)} className="num" />
                  </Field>
                )}
              </div>
            </div>
          )}
        </div>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}

// ── What if prices change? ──────────────────────────────────────────────────
export function SimulatorModal({ materials, onClose }: { materials: Material[]; onClose: () => void }) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [result, setResult] = useState<Simulation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const changes = materials.filter((m) => prices[m.id] !== undefined && prices[m.id] !== m.unitCostPaise).map((m) => ({ materialId: m.id, unitCostPaise: prices[m.id]! }));

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.materialsSimulate(changes));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const bump = (percent: number) => {
    const next: Record<string, number> = {};
    for (const m of materials) next[m.id] = Math.round(m.unitCostPaise * (1 + percent / 100));
    setPrices(next);
    setResult(null);
  };

  return (
    <Modal
      title="What if prices change?"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" loading={busy} disabled={changes.length === 0} onClick={() => void run()}>
            Show the effect
          </Button>
        </>
      }
    >
      <p className="mb-4 text-ink-muted">Type the price a material might go to and see what it does to the cost and margin of each saree. Nothing is changed.</p>
      <div className="mb-3 flex items-center gap-2 text-xs text-ink-muted">
        All materials:
        {[5, 10, 20].map((p) => (
          <button key={p} type="button" onClick={() => bump(p)} className="rounded-md border border-line px-2 py-1 transition-colors hover:border-brand hover:text-brand">
            +{p}%
          </button>
        ))}
        <button type="button" onClick={() => { setPrices({}); setResult(null); }} className="ml-1 underline-offset-2 hover:underline">
          Reset
        </button>
      </div>
      <div className="mb-4 max-h-48 overflow-y-auto rounded-lg border border-line">
        {materials.map((m) => (
          <div key={m.id} className="grid grid-cols-[1fr_8rem_9rem] items-center gap-3 border-b border-line/70 px-3 py-1.5 last:border-0">
            <span>
              {m.name} <span className="text-xs text-ink-muted">per {m.unit}</span>
            </span>
            <span className="text-right text-ink-muted">
              <Money paise={m.unitCostPaise} />
            </span>
            <MoneyInput
              value={prices[m.id] ?? m.unitCostPaise}
              onChange={(p) => {
                setPrices({ ...prices, [m.id]: p });
                setResult(null);
              }}
              aria-label={`New price of ${m.name}`}
              className="h-8"
            />
          </div>
        ))}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {result && (
        <>
          <div className="mb-3 grid grid-cols-3 gap-4 rounded-lg bg-canvas p-3">
            <div>
              <div className="text-xs text-ink-muted">Sarees affected</div>
              <div className="num text-base">{result.rows.length}</div>
            </div>
            <div>
              <div className="text-xs text-ink-muted">Stock in hand, at cost</div>
              <div className="text-base">
                <Money paise={result.stockCostNowPaise} fractionDigits={0} /> → <Money paise={result.stockCostThenPaise} fractionDigits={0} />
              </div>
            </div>
            <div>
              <div className="text-xs text-ink-muted">Warnings</div>
              <div className={`text-base ${result.belowCostCount > 0 ? 'text-status-overdue-fg' : result.lowMarginCount > 0 ? 'text-status-partial-fg' : ''}`}>
                {result.belowCostCount > 0 ? `${result.belowCostCount} below cost` : result.lowMarginCount > 0 ? `${result.lowMarginCount} thin margin` : 'None'}
              </div>
            </div>
          </div>
          {result.rows.length === 0 ? (
            <p className="text-ink-muted">No saree uses those materials.</p>
          ) : (
            <div className="max-h-56 overflow-y-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className="th">Saree</th>
                    <th className="th text-right">Cost</th>
                    <th className="th text-right">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.variantId} className="border-b border-line/60 last:border-0">
                      <td className="td">
                        {r.designName}
                        <div className="text-xs text-ink-muted">
                          {r.color} · {r.size} · sells at {formatMoney(r.sellPricePaise, { fractionDigits: 0 })}
                        </div>
                      </td>
                      <td className="td text-right">
                        <Money paise={r.costNowPaise} fractionDigits={0} /> → <Money paise={r.costThenPaise} fractionDigits={0} />
                      </td>
                      <td className={`td num text-right ${r.costThenPaise > r.sellPricePaise ? 'text-status-overdue-fg' : ''}`}>
                        {r.marginNowPercent === null ? '—' : `${r.marginNowPercent.toFixed(0)}%`} → {r.marginThenPercent === null ? '—' : `${r.marginThenPercent.toFixed(0)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
