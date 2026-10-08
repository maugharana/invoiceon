import { Package, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { bundleGross, bundleNet, bundleSource, priceBundle, type BundleLine } from '../../../shared/bundle';
import { formatMoney } from '../../../shared/money';
import { planRepeat, repeatMessage, type RepeatItem, type RepeatVariant } from '../../../shared/repeatBill';
import type { QuoteTemplate, SaleVariant } from '../../../shared/types';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, MoneyInput } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { plural } from '../../lib/format';

/**
 * Bundles: sets of items sold together at a price of their own (a saree with its blouse piece and fall). Saved once, then added to a
 * bill or a quote in one tap. A bundle that cannot be added in full (something sold out or no longer sold) adds what it can and says
 * what it left out.
 */
export function Bundles({ variants, quote, current, onAdd, onNote }: { variants: SaleVariant[]; quote: boolean; /** The items on the bill now, which "save as a bundle" keeps. */ current: BundleLine[]; onAdd: (items: RepeatItem[]) => void; onNote?: (note: string) => void }) {
  const toast = useToast();
  const list = useQuery(() => api.quoteTemplatesList());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<QuoteTemplate | null>(null);
  const refresh = useRefresh();

  const byId = useMemo(() => new Map<string, RepeatVariant>(variants.map((v) => [v.variantId, { stock: v.stock, held: v.held, sellPricePaise: v.sellPricePaise }])), [variants]);
  const names = useMemo(() => new Map(variants.map((v) => [v.variantId, { designName: v.designName, color: v.color, size: v.size }])), [variants]);
  const bundles = list.data ?? [];

  function add(t: QuoteTemplate) {
    const plan = planRepeat(bundleSource(t.lines, names), byId, { todayPrices: false, allowOutOfStock: quote });
    if (plan.items.length > 0) {
      onAdd(plan.items);
      if (t.notes && onNote) onNote(t.notes);
    }
    const clean = plan.items.length > 0 && plan.skipped.length === 0 && plan.reduced.length === 0;
    if (clean) toast.success(`Added “${t.name}”.`);
    else toast.info(repeatMessage(plan));
  }

  if (bundles.length === 0 && current.length === 0) return null;
  return (
    <div className="space-y-2">
      {bundles.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-muted">Bundles</span>
          {bundles.map((t) => {
            const worth = bundleNet(t.lines);
            const detail = t.lines.map((l) => `${l.qty} × ${names.get(l.variantId)?.designName ?? 'item'}${names.get(l.variantId)?.color ? ` (${names.get(l.variantId)!.color})` : ''}`).join('\n');
            return (
              <span key={t.id} className="inline-flex items-center overflow-hidden rounded-full border border-line bg-surface">
                <button type="button" onClick={() => add(t)} title={detail} className="inline-flex items-center gap-1.5 px-3 py-1 transition-colors hover:bg-brand-tint hover:text-brand">
                  <Package className="h-3 w-3" aria-hidden />
                  {t.name} <span className="num text-ink-muted">· {plural(t.lines.length, 'item')} · {formatMoney(worth, { fractionDigits: 0 })}</span>
                </button>
                <button type="button" aria-label={`Delete bundle ${t.name}`} onClick={() => setDeleting(t)} className="border-l border-line px-2 py-1 text-ink-muted transition-colors hover:bg-status-overdue-bg hover:text-status-overdue-fg">
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}
      {current.length > 0 && (
        <button type="button" onClick={() => setSaving(true)} className="inline-flex items-center gap-1.5 text-xs text-brand transition-colors hover:text-brand-hover">
          <Plus className="h-3.5 w-3.5" aria-hidden /> Save these items as a bundle
        </button>
      )}
      {saving && <SaveBundleModal current={current} names={names} onClose={() => setSaving(false)} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.name}”?`}
          body="The bundle is removed from the list. Bills already made from it are not affected."
          confirmLabel="Delete"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.quoteTemplateDelete(deleting.id);
            setDeleting(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function SaveBundleModal({ current, names, onClose }: { current: BundleLine[]; names: Map<string, { designName: string; color: string; size: string }>; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const worth = bundleNet(current);
  const [name, setName] = useState('');
  const [price, setPrice] = useState(worth);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = bundleGross(current);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // The price as it stands keeps the items' own discounts; a different price is shared over the items as discounts.
      const lines = price === worth ? current : priceBundle(current, price);
      if (!lines) throw new Error(`A bundle can't cost more than its items do (${formatMoney(list)}).`);
      await api.quoteTemplateSave({ name, notes: '', lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty, unitPricePaise: l.unitPricePaise, ...(l.discountPaise ? { discountPaise: l.discountPaise } : {}) })) });
      toast.success(`Bundle “${name.trim()}” saved`);
      refresh();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Save as a bundle"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
            Save bundle
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ul className="divide-y divide-line/70 rounded-lg border border-line text-sm">
          {current.map((l) => {
            const n = names.get(l.variantId);
            return (
              <li key={l.variantId} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate">
                  {l.qty} × {n?.designName ?? 'Item'}
                  <span className="text-ink-muted"> · {[n?.color, n?.size].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="num shrink-0 text-ink-muted">{formatMoney(l.qty * l.unitPricePaise, { fractionDigits: 0 })}</span>
              </li>
            );
          })}
        </ul>
        <Field label="Bundle name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Saree with blouse and fall" data-autofocus onKeyDown={(e) => e.key === 'Enter' && name.trim() && void save()} />
        </Field>
        <Field label="Bundle price" hint={price < list ? `A saving of ${formatMoney(list - price)} on the ${formatMoney(list)} the items come to separately, shared over the items.` : `The items come to ${formatMoney(list)} at their prices. Lower the price to give the bundle its own.`}>
          <MoneyInput value={price} onChange={setPrice} aria-label="Bundle price" />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <p className="text-xs text-ink-muted">Saving under a name you already use replaces that bundle. The price is before GST, like the prices on the bill.</p>
      </div>
    </Modal>
  );
}
