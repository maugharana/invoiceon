import { ArrowLeft, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { todayIso } from '../../../shared/gst';
import { formatMoney, mulPaise } from '../../../shared/money';
import type { SaleVariant, WeaverOrderInput } from '../../../shared/types';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorNote, Field, Input, Money, MoneyInput, PageHeader, Spinner, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { toNumber } from '../../lib/format';
import { navigate, paths } from '../../lib/router';
import { ItemPicker } from '../invoices/NewInvoicePage';
import { QuickAddItemModal } from '../invoices/QuickAddItemModal';
import { SupplierSelect } from './MaterialModals';

interface Line {
  /** Present when the line is already on the saved order. */
  id?: string;
  variantId: string;
  qty: string;
  cost: number;
  /** How the saree is shown, kept so a line still reads right if its saree is not in the list of items. */
  label: string;
  received: number;
}

/** Places an order with a weaver, or changes one. From a quote, it starts with what the quote is short of. */
export function WeaverOrderEditPage({ quoteId = null, editId = null }: { quoteId?: string | null; editId?: string | null }) {
  const toast = useToast();
  const refresh = useRefresh();
  const variants = useQuery(() => api.variantsForSale());
  const existing = useQuery(() => (editId ? api.weaverOrderGet(editId) : Promise.resolve(null)), [editId]);

  const [vendorId, setVendorId] = useState('');
  const [orderedOn, setOrderedOn] = useState(todayIso());
  const [expectedOn, setExpectedOn] = useState('');
  const [note, setNote] = useState('');
  const [proformaId, setProformaId] = useState<string | null>(null);
  const [forQuote, setForQuote] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [justAdded, setJustAdded] = useState<SaleVariant[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const sellable = useMemo(() => {
    const loaded = variants.data ?? [];
    const have = new Set(loaded.map((v) => v.variantId));
    return [...loaded, ...justAdded.filter((v) => !have.has(v.variantId))];
  }, [variants.data, justAdded]);
  const byId = useMemo(() => new Map(sellable.map((v) => [v.variantId, v])), [sellable]);
  const labelOf = (v: SaleVariant) => `${v.designName}|${v.color}, ${v.size}|${v.sku}`;

  // Fill the form once what it needs has arrived: the saved order when changing one, the quote's shortfall when starting from a quote.
  useEffect(() => {
    if (filled || !variants.data) return;
    if (editId) {
      const o = existing.data;
      if (!o) return;
      setFilled(true);
      setVendorId(o.vendorId);
      setOrderedOn(o.orderedOn);
      setExpectedOn(o.expectedOn ?? '');
      setNote(o.note);
      setProformaId(o.proformaId);
      setForQuote(o.proformaNumber);
      setLines(o.lines.map((l) => ({ id: l.id, variantId: l.variantId, qty: String(l.qty), cost: l.unitCostPaise, label: `${l.designName}|${l.color}, ${l.size}|${l.sku}`, received: l.receivedQty })));
    } else if (quoteId) {
      setFilled(true);
      api
        .weaverOrderDraft(quoteId)
        .then((d) => {
          setProformaId(d.proformaId);
          setForQuote(d.proformaNumber);
          setNote(d.note);
          if (d.vendorId) setVendorId(d.vendorId);
          const map = new Map(variants.data!.map((v) => [v.variantId, v]));
          setLines(d.lines.map((l) => ({ variantId: l.variantId, qty: String(l.qty), cost: l.unitCostPaise, label: map.has(l.variantId) ? labelOf(map.get(l.variantId)!) : '', received: 0 })));
        })
        .catch((err) => setError(errorMessage(err)));
    } else {
      setFilled(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filled, variants.data, existing.data, editId, quoteId]);

  function addVariant(v: SaleVariant) {
    setLines((ls) => {
      const there = ls.find((l) => l.variantId === v.variantId);
      if (there) return ls.map((l) => (l === there ? { ...l, qty: String((toNumber(l.qty) || 0) + 1) } : l));
      return [...ls, { variantId: v.variantId, qty: '1', cost: 0, label: labelOf(v), received: 0 }];
    });
  }

  const total = lines.reduce((s, l) => s + mulPaise(toNumber(l.qty) || 0, l.cost), 0);
  const bad = lines.find((l) => !Number.isInteger(toNumber(l.qty)) || toNumber(l.qty) < 1 || toNumber(l.qty) < l.received);
  const problem = !vendorId ? 'Choose the weaver.' : lines.length === 0 ? 'Add at least one saree.' : bad ? 'Each saree needs a whole number of pieces, at least 1 and not fewer than have arrived.' : null;

  async function save() {
    if (problem) return;
    setSaving(true);
    setError(null);
    const input: WeaverOrderInput = {
      vendorId,
      orderedOn,
      expectedOn: expectedOn || null,
      note,
      proformaId,
      lines: lines.map((l) => ({ ...(l.id ? { id: l.id } : {}), variantId: l.variantId, qty: toNumber(l.qty), unitCostPaise: l.cost })),
    };
    try {
      const saved = editId ? await api.weaverOrderUpdate(editId, input) : await api.weaverOrderCreate(input);
      refresh();
      toast.success(editId ? `${saved.number} updated` : `${saved.number} placed with ${saved.vendorName}`);
      navigate(paths.weaverOrder(saved.id));
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  const back = (
    <a href={`#${editId ? paths.weaverOrder(editId) : paths.weaverOrders}`} className="inline-flex items-center gap-1.5 rounded-lg text-ink-muted transition-colors hover:text-ink">
      <ArrowLeft className="h-4 w-4" aria-hidden /> {editId ? 'Back to the order' : 'Weaver orders'}
    </a>
  );

  if (editId && existing.loading) {
    return (
      <>
        <PageHeader back={back} title="Change order" />
        <Spinner />
      </>
    );
  }

  return (
    <>
      <PageHeader
        back={back}
        title={editId ? `Change ${existing.data?.number ?? 'order'}` : 'New weaver order'}
        subtitle={forQuote ? `For quote ${forQuote}. Pieces you already have or have on order are not counted again.` : 'The sarees you are asking a weaver for. They go into stock when you mark them received.'}
        actions={
          <Button variant="primary" loading={saving} disabled={!!problem} onClick={() => void save()}>
            {editId ? 'Save changes' : 'Place order'}
          </Button>
        }
      />
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="grid grid-cols-[1fr_20rem] items-start gap-6">
        <div className="space-y-6">
          <Card className="p-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <SupplierSelect value={vendorId} onChange={setVendorId} label="Weaver" noun="weaver" hint="Who you are ordering from. Add a new one if they are not in the list." />
              </div>
              <Field label="Ordered on">
                <Input type="date" value={orderedOn} max={todayIso()} onChange={(e) => setOrderedOn(e.target.value)} className="num" />
              </Field>
              <Field label="Expected by" hint="Optional. You are told when it is late.">
                <Input type="date" value={expectedOn} min={orderedOn} onChange={(e) => setExpectedOn(e.target.value)} className="num" />
              </Field>
              <Field label="Note" className="col-span-2">
                <Textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} rows={2} placeholder="Colour matching, border width, anything the weaver should know" />
              </Field>
            </div>
          </Card>

          <Card className="overflow-visible">
            <div className="border-b border-line px-6 py-4">
              <h2 className="text-base">Sarees</h2>
            </div>
            {lines.length > 0 && (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className="th">Saree</th>
                    <th className="th w-24 text-right">Pieces</th>
                    <th className="th w-40 text-right">Price each</th>
                    <th className="th w-32 text-right">Amount</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const v = byId.get(l.variantId);
                    const [design, colourSize, sku] = (v ? labelOf(v) : l.label).split('|');
                    return (
                      <tr key={l.variantId} className="border-b border-line/70 align-top last:border-0">
                        <td className="td">
                          <div>{design}</div>
                          <div className="text-xs text-ink-muted">
                            {colourSize} · {sku}
                            {v && <> · {v.stock} in stock</>}
                            {l.received > 0 && <> · {l.received} received</>}
                          </div>
                        </td>
                        <td className="td text-right">
                          <Input value={l.qty} inputMode="numeric" aria-label={`Pieces, ${design} ${colourSize}`} onChange={(e) => setLines((ls) => ls.map((x) => (x === l ? { ...x, qty: e.target.value.replace(/\D/g, '').slice(0, 5) } : x)))} className="num h-8 text-right" />
                        </td>
                        <td className="td">
                          <MoneyInput value={l.cost} aria-label={`Price each, ${design} ${colourSize}`} onChange={(c) => setLines((ls) => ls.map((x) => (x === l ? { ...x, cost: c } : x)))} className="h-8" />
                        </td>
                        <td className="td text-right">
                          <Money paise={mulPaise(toNumber(l.qty) || 0, l.cost)} />
                        </td>
                        <td className="td">
                          {l.received === 0 && (
                            <button type="button" aria-label={`Remove ${design} ${colourSize}`} onClick={() => setLines((ls) => ls.filter((x) => x !== l))} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink">
                              <X className="h-4 w-4" aria-hidden />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <div className="p-6">
              <ItemPicker variants={sellable} taken={new Set(lines.map((l) => l.variantId))} onPick={addVariant} onCreate={(name) => setAdding(name)} allowOutOfStock />
              {lines.length === 0 && <p className="mt-2 text-xs text-ink-muted">Search a saree you already have, or choose “Not in inventory? Add” to enter a new one. It is added to your inventory with no stock until it arrives.</p>}
            </div>
          </Card>
        </div>

        <Card className="sticky top-4 p-6">
          <h2 className="text-base">Summary</h2>
          <dl className="mt-4 space-y-2">
            <div className="flex justify-between">
              <dt className="text-ink-muted">Sarees</dt>
              <dd className="num">{lines.reduce((s, l) => s + (toNumber(l.qty) || 0), 0)}</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-line pt-3">
              <dt>Total to pay the weaver</dt>
              <dd className="text-xl">
                <Money paise={total} />
              </dd>
            </div>
          </dl>
          {total === 0 && lines.length > 0 && <p className="mt-3 text-xs text-ink-muted">No prices yet. Add them when the weaver has agreed, so you can record what you pay.</p>}
          {problem && lines.length > 0 && <p className="mt-3 text-xs text-ink-muted">{problem}</p>}
          <Button variant="primary" className="mt-5 w-full" loading={saving} disabled={!!problem} onClick={() => void save()}>
            {editId ? 'Save changes' : `Place order${total > 0 ? ` · ${formatMoney(total)}` : ''}`}
          </Button>
        </Card>
      </div>

      {adding !== null && (
        <QuickAddItemModal
          initialName={adding}
          quote
          noStockNote="It starts with no stock. The pieces come into stock when you mark them received from the weaver."
          onClose={() => setAdding(null)}
          onAdded={(v) => {
            setJustAdded((a) => [...a, v]);
            addVariant(v);
            setAdding(null);
            refresh();
            toast.success(`${v.designName} (${v.color}) is now in your inventory.`);
          }}
        />
      )}
    </>
  );
}
