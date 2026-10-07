import { Repeat } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatDate } from '../../../shared/gst';
import { formatMoney } from '../../../shared/money';
import { planRepeat, repeatMessage, type RepeatItem, type RepeatVariant } from '../../../shared/repeatBill';
import type { SaleVariant } from '../../../shared/types';
import { useToast } from '../../components/Toast';
import { Button, Select } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { plural } from '../../lib/format';
import { DesignThumb } from './invoiceParts';

/**
 * "Bill the same again": a returning customer's earlier bill turned into the items of this one in a tap, at the same prices or at
 * today's, or with only the items you tick. Anything sold out or no longer sold is left out and said so. The discount on the whole
 * bill and any payment are not carried over: only what was bought.
 */
export function RepeatBill({ customerId, customerName, variants, covers, allowOutOfStock, onAdd }: { customerId: string; customerName: string; variants: SaleVariant[]; covers: Record<string, string>; allowOutOfStock: boolean; onAdd: (items: RepeatItem[]) => void }) {
  const toast = useToast();
  const bills = useQuery(() => api.invoicesList({ customerId }), [customerId]);
  const usable = useMemo(() => (bills.data ?? []).filter((b) => b.status !== 'cancelled').slice(0, 8), [bills.data]);
  const [pickedId, setPickedId] = useState('');
  const bill = usable.find((b) => b.id === pickedId) ?? usable[0];
  const detail = useQuery(() => (bill ? api.invoiceGet(bill.id) : Promise.resolve(null)), [bill?.id]);
  const [choosing, setChoosing] = useState(false);
  const [off, setOff] = useState<Set<string>>(new Set());
  const byId = useMemo(() => new Map<string, RepeatVariant>(variants.map((v) => [v.variantId, { stock: v.stock, held: v.held, sellPricePaise: v.sellPricePaise }])), [variants]);
  const variantOf = useMemo(() => new Map(variants.map((v) => [v.variantId, v])), [variants]);

  if (!bill) return null;
  const lines = detail.data?.lines ?? [];
  const ready = !detail.loading && lines.length > 0;

  function add(todayPrices: boolean, onlyTicked: boolean) {
    const plan = planRepeat(lines, byId, { todayPrices, allowOutOfStock, include: onlyTicked ? (id) => !off.has(id) : undefined });
    if (plan.items.length > 0) onAdd(plan.items);
    const clean = plan.items.length > 0 && plan.skipped.length === 0 && plan.reduced.length === 0;
    const message = clean ? `Added ${plural(plan.items.length, 'item')} from ${bill!.number}.` : repeatMessage(plan);
    if (clean) toast.success(message);
    else toast.info(message);
    setChoosing(false);
  }

  const status = (variantId: string): 'ok' | 'out' | 'gone' => {
    const v = byId.get(variantId);
    if (!v) return 'gone';
    return !allowOutOfStock && v.stock - v.held <= 0 ? 'out' : 'ok';
  };
  const tickedCount = lines.filter((l) => status(l.variantId) === 'ok' && !off.has(l.variantId)).length;

  return (
    <div className="rounded-lg border border-brand/20 bg-brand-tint/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface text-brand">
            <Repeat className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="font-medium">Bill the same again</p>
            <p className="num truncate text-xs text-ink-muted">
              {usable[0] === bill ? 'Last bill' : 'Earlier bill'} for {customerName}: {bill.number} · {formatDate(bill.issueDate)} · {detail.loading ? '…' : plural(lines.length, 'item')} · {formatMoney(bill.totalPaise, { fractionDigits: 0 })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={!ready} onClick={() => add(false, false)} title="The same items, quantities and prices as that bill">
            Same items, same prices
          </Button>
          <Button disabled={!ready} onClick={() => add(true, false)} title="The same items and quantities, at what they sell for now">
            At today's prices
          </Button>
          <Button disabled={!ready} aria-expanded={choosing} onClick={() => setChoosing((c) => !c)}>
            Choose items…
          </Button>
        </div>
      </div>

      {usable.length > 1 && (
        <div className="mt-3 flex items-center gap-2 text-xs text-ink-muted">
          <span>Or use an earlier bill</span>
          <div className="w-72">
            <Select value={bill.id} onChange={(e) => setPickedId(e.target.value)} aria-label="Earlier bills" className="h-8 text-xs">
              {usable.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.number} · {formatDate(b.issueDate)} · {formatMoney(b.totalPaise, { fractionDigits: 0 })}
                </option>
              ))}
            </Select>
          </div>
        </div>
      )}

      {choosing && ready && (
        <div className="mt-3 rounded-lg border border-line bg-surface">
          <ul className="divide-y divide-line/70">
            {lines.map((l) => {
              const st = status(l.variantId);
              const v = variantOf.get(l.variantId);
              const ticked = st === 'ok' && !off.has(l.variantId);
              return (
                <li key={l.id}>
                  <label className={`flex items-center gap-3 px-4 py-2.5 ${st === 'ok' ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                    <input
                      type="checkbox"
                      checked={ticked}
                      disabled={st !== 'ok'}
                      onChange={() =>
                        setOff((s) => {
                          const next = new Set(s);
                          if (next.has(l.variantId)) next.delete(l.variantId);
                          else next.add(l.variantId);
                          return next;
                        })
                      }
                      className="h-4 w-4 accent-[#0F6E56]"
                    />
                    <DesignThumb src={v ? covers[v.designId] : undefined} name={l.designName} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{l.designName}</span>
                      <span className="block truncate text-xs text-ink-muted">
                        {l.color} · {l.size}
                      </span>
                    </span>
                    <span className="num text-xs text-ink-muted">× {l.qty}</span>
                    <span className="num w-24 text-right">{st === 'ok' ? formatMoney(l.unitPricePaise, { fractionDigits: 0 }) : <span className="text-status-overdue-fg">{st === 'out' ? 'Out of stock' : 'Not sold now'}</span>}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-2.5">
            <Button disabled={tickedCount === 0} onClick={() => add(true, true)}>
              Ticked, today's prices
            </Button>
            <Button variant="primary" disabled={tickedCount === 0} onClick={() => add(false, true)}>
              Add {plural(tickedCount, 'ticked item')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
