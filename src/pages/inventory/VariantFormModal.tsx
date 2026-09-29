import { X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { formatMoney, mulPaise } from '../../../shared/money';
import type { DesignDetail, Material, Variant } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, Money, MoneyInput, Select } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { toNumber } from '../../lib/format';
import { paths } from '../../lib/router';
import { COMMON_COLORS, COMMON_SIZES } from '../../lib/sarees';


interface CostLine {
  key: number;
  materialId: string;
  qty: string;
}

interface Props {
  design: DesignDetail;
  /** Existing variant when editing; omitted when creating. */
  variant?: Variant;
  onClose: () => void;
}

export function VariantFormModal({ design, variant, onClose }: Props) {
  const toast = useToast();
  const refresh = useRefresh();
  const materials = useQuery(() => api.materialsList());
  const settings = useQuery(() => api.getSettings());

  const [color, setColor] = useState(variant?.color ?? '');
  const [size, setSize] = useState(variant?.size ?? design.variants.at(-1)?.size ?? '6.3 m');
  const [sell, setSell] = useState(variant?.sellPricePaise ?? design.variants.at(-1)?.sellPricePaise ?? design.defaultPricePaise);
  const [mrp, setMrp] = useState(variant?.mrpPaise ?? design.variants.at(-1)?.mrpPaise ?? 0);
  const [base, setBase] = useState(variant?.baseCostPaise ?? design.variants.at(-1)?.baseCostPaise ?? 0);
  const [reorder, setReorder] = useState(variant ? String(variant.reorderLevel) : '');
  const [opening, setOpening] = useState('');
  const [sku, setSku] = useState(variant?.sku ?? '');
  const [lines, setLines] = useState<CostLine[]>(() => {
    const source = variant ?? design.variants.at(-1);
    return (source?.bom ?? []).map((b, i) => ({ key: i, materialId: b.materialId, qty: String(b.qty) }));
  });
  const [nextKey, setNextKey] = useState(100);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<'close' | 'another' | null>(null);

  const reorderValue = reorder === '' ? (settings.data?.defaultReorderLevel ?? 0) : toNumber(reorder);
  const byId = useMemo(() => new Map((materials.data ?? []).map((m) => [m.id, m])), [materials.data]);

  const lineCost = (l: CostLine): number => {
    const m = byId.get(l.materialId);
    const qty = toNumber(l.qty);
    return m && Number.isFinite(qty) && qty > 0 ? mulPaise(qty, m.unitCostPaise) : 0;
  };
  const materialsCost = lines.reduce((s, l) => s + lineCost(l), 0);
  const unitCost = base + materialsCost;
  const profit = sell - unitCost;
  const marginPct = sell > 0 ? (profit / sell) * 100 : null;

  const unusedMaterials = (materials.data ?? []).filter((m) => !lines.some((l) => l.materialId === m.id));

  function addLine(m: Material) {
    setLines((ls) => [...ls, { key: nextKey, materialId: m.id, qty: '' }]);
    setNextKey((k) => k + 1);
  }

  async function save(andAddAnother: boolean) {
    setError(null);
    const stockNumber = opening === '' ? 0 : toNumber(opening);
    if (Number.isNaN(reorderValue)) return setError('Reorder level must be a number.');
    if (Number.isNaN(stockNumber)) return setError('Opening stock must be a number.');
    for (const l of lines) {
      const q = toNumber(l.qty);
      if (!Number.isFinite(q) || q <= 0) return setError(`Enter a quantity for ${byId.get(l.materialId)?.name ?? 'each raw material'}, or remove the line.`);
    }
    setSaving(andAddAnother ? 'another' : 'close');
    const input = {
      color,
      size,
      sku: sku || undefined,
      sellPricePaise: sell,
      mrpPaise: mrp,
      baseCostPaise: base,
      reorderLevel: reorderValue,
      openingStock: variant ? undefined : stockNumber,
      bom: lines.map((l) => ({ materialId: l.materialId, qty: toNumber(l.qty) })),
    };
    try {
      if (variant) await api.variantUpdate(variant.id, input);
      else await api.variantCreate(design.id, input);
      refresh();
      if (andAddAnother) {
        toast.success(`${color} / ${size} added`);
        // Colour variants of one design usually share size, price and costing: keep those, clear what's unique.
        setColor('');
        setOpening('');
        setSku('');
        setSaving(null);
        document.getElementById('variant-color')?.focus();
      } else {
        toast.success(variant ? 'Variant updated' : `${color} / ${size} added`);
        onClose();
      }
    } catch (err) {
      setError(errorMessage(err));
      setSaving(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void save(false);
  }

  return (
    <Modal
      title={variant ? `Edit variant — ${variant.color} / ${variant.size}` : `Add variant — ${design.name}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {!variant && (
            <Button loading={saving === 'another'} disabled={saving !== null} onClick={() => void save(true)}>
              Save &amp; add another
            </Button>
          )}
          <Button variant="primary" type="submit" form="variant-form" loading={saving === 'close'} disabled={saving !== null}>
            {variant ? 'Save changes' : 'Add variant'}
          </Button>
        </>
      }
    >
      <form id="variant-form" onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Color">
            <Input id="variant-color" value={color} onChange={(e) => setColor(e.target.value)} list="color-options" placeholder="e.g. Maroon" data-autofocus />
            <datalist id="color-options">
              {[...new Set([...design.variants.map((v) => v.color), ...COMMON_COLORS])].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Size">
            <Input value={size} onChange={(e) => setSize(e.target.value)} list="size-options" placeholder="6.3 m" />
            <datalist id="size-options">
              {COMMON_SIZES.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="MRP" hint="The printed price, GST included. Optional.">
            <MoneyInput value={mrp} onChange={setMrp} />
          </Field>
          <Field label="Selling price (SP)" hint="What you charge, before GST" error={mrp > 0 && sell > mrp ? 'Higher than the MRP' : undefined}>
            <MoneyInput value={sell} onChange={setSell} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Reorder level" hint="Warn at or below this">
            <Input type="number" min={0} step={1} value={reorder} onChange={(e) => setReorder(e.target.value)} placeholder={String(settings.data?.defaultReorderLevel ?? 2)} className="num text-right" />
          </Field>
          {variant ? (
            <Field label="In stock now" hint="Change it with Adjust stock">
              <Input value={variant.stock} disabled className="num text-right" readOnly />
            </Field>
          ) : (
            <Field label="Opening stock" hint="Pieces on the shelf today">
              <Input type="number" min={0} step={1} value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" className="num text-right" />
            </Field>
          )}
        </div>

        {variant && (
          <Field label="SKU" hint="Generated from the design code, color and size. Change it only if you use your own codes.">
            <Input value={sku} onChange={(e) => setSku(e.target.value)} />
          </Field>
        )}

        <fieldset className="rounded-lg border border-line bg-canvas/60 p-4">
          <legend className="px-1 text-xs font-medium text-ink-muted">Cost per piece</legend>

          <div className="grid grid-cols-[1fr_11rem] items-end gap-4">
            <div>
              <div className="text-sm">Making / purchase cost</div>
              <div className="text-xs text-ink-muted">Weaving labour, or what you paid for a ready piece</div>
            </div>
            <MoneyInput value={base} onChange={setBase} aria-label="Making or purchase cost" />
          </div>

          <div className="mt-4 border-t border-line pt-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm">Raw materials</div>
              {unusedMaterials.length > 0 && (
                <Select
                  aria-label="Add raw material"
                  value=""
                  onChange={(e) => {
                    const m = byId.get(e.target.value);
                    if (m) addLine(m);
                  }}
                  className="h-8 w-52 text-xs"
                >
                  <option value="">+ Add raw material…</option>
                  {unusedMaterials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({formatMoney(m.unitCostPaise)}/{m.unit})
                    </option>
                  ))}
                </Select>
              )}
            </div>

            {lines.length === 0 ? (
              <p className="text-xs text-ink-muted">
                {materials.data && materials.data.length === 0 ? (
                  <>
                    No raw materials set up yet. Add silk, zari, dye etc. under{' '}
                    <a href={`#${paths.materials}`} className="text-brand underline underline-offset-2" onClick={onClose}>
                      Raw materials
                    </a>{' '}
                    to have this cost worked out automatically.
                  </>
                ) : (
                  'Optional. Add what goes into one piece and the cost updates whenever material prices change.'
                )}
              </p>
            ) : (
              <ul className="space-y-2">
                {lines.map((l) => {
                  const m = byId.get(l.materialId);
                  return (
                    <li key={l.key} className="grid grid-cols-[1fr_7rem_5rem_7rem_2rem] items-center gap-3">
                      <span className="truncate">{m?.name ?? 'Unknown material'}</span>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={l.qty}
                        onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x)))}
                        aria-label={`Quantity of ${m?.name ?? 'material'}`}
                        placeholder="Qty"
                        className="num h-8 text-right"
                      />
                      <span className="text-xs text-ink-muted">
                        {m?.unit} × {m ? formatMoney(m.unitCostPaise, { fractionDigits: 0 }) : ''}
                      </span>
                      <Money paise={lineCost(l)} className="text-right" />
                      <button type="button" aria-label={`Remove ${m?.name ?? 'material'}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink">
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-sm">
            <div className="flex justify-between text-ink-muted">
              <dt>Raw materials</dt>
              <dd><Money paise={materialsCost} /></dd>
            </div>
            <div className="flex justify-between text-ink-muted">
              <dt>Making / purchase</dt>
              <dd><Money paise={base} /></dd>
            </div>
            <div className="flex justify-between font-medium">
              <dt>Cost per piece</dt>
              <dd><Money paise={unitCost} /></dd>
            </div>
            {sell > 0 && (
              <div className="flex justify-between text-ink-muted">
                <dt>Margin at selling price</dt>
                <dd className={`num ${profit < 0 ? 'text-status-overdue-fg' : ''}`}>
                  {formatMoney(profit)}
                  {marginPct !== null && ` · ${marginPct.toFixed(0)}%`}
                </dd>
              </div>
            )}
          </dl>
        </fieldset>

        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}
