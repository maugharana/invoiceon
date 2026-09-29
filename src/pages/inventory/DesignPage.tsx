import { Archive, ArrowLeft, History, Package, Pencil, PackagePlus, Plus } from 'lucide-react';
import { useState } from 'react';
import { formatMoney } from '../../../shared/money';
import type { Variant } from '../../../shared/types';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, EmptyState, ErrorNote, Figure, IconButton, Money, PageHeader, Spinner, StockPill } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { plural } from '../../lib/format';
import { navigate, paths } from '../../lib/router';
import { DesignFormModal } from './DesignFormModal';
import { AdjustStockModal, StockHistoryModal } from './StockModals';
import { VariantFormModal } from './VariantFormModal';

type Dialog =
  | { kind: 'edit-design' }
  | { kind: 'archive-design' }
  | { kind: 'variant'; variant?: Variant }
  | { kind: 'adjust'; variant: Variant }
  | { kind: 'history'; variant: Variant }
  | { kind: 'archive-variant'; variant: Variant };

function Margin({ variant }: { variant: Variant }) {
  if (variant.sellPricePaise <= 0) return null;
  const pct = ((variant.sellPricePaise - variant.unitCostPaise) / variant.sellPricePaise) * 100;
  return <div className={`num text-xs ${pct < 0 ? 'text-status-overdue-fg' : 'text-ink-muted'}`}>{pct.toFixed(0)}% margin</div>;
}

export function DesignPage({ id }: { id: string }) {
  const toast = useToast();
  const refresh = useRefresh();
  const design = useQuery(() => api.designGet(id), [id]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const d = design.data;
  const close = () => setDialog(null);

  const back = (
    <a href={`#${paths.inventory()}`} className="inline-flex items-center gap-1.5 rounded-lg text-ink-muted transition-colors hover:text-ink">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Inventory
    </a>
  );

  if (design.error && !d) {
    return (
      <>
        <PageHeader title="Design not found" back={back} />
        <ErrorNote>{design.error}</ErrorNote>
      </>
    );
  }
  if (!d) {
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
        title={
          <span className="flex items-center gap-3">
            {d.name}
            <StockPill status={d.status} />
          </span>
        }
        subtitle={[d.nickname, d.code, d.fabric, d.hsnCode && `HSN ${d.hsnCode}`].filter(Boolean).join(' · ')}
        actions={
          <>
            <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setDialog({ kind: 'edit-design' })}>
              Edit
            </Button>
            <Button variant="danger" icon={<Archive className="h-4 w-4" />} onClick={() => setDialog({ kind: 'archive-design' })}>
              Archive
            </Button>
          </>
        }
      />

      {d.description && <p className="-mt-4 mb-8 max-w-2xl text-ink-muted">{d.description}</p>}

      <div className="mb-8 grid grid-cols-4 gap-6">
        <Figure label="Pieces in stock">{d.totalStock}</Figure>
        <Figure label="Variants">{d.variantCount}</Figure>
        <Figure label="Default price" sub="Before GST">
          <Money paise={d.defaultPricePaise} fractionDigits={0} />
        </Figure>
        <Figure label="Stock value" sub="At cost" highlight>
          <Money paise={d.stockValuePaise} fractionDigits={0} />
        </Figure>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base">Variants</h2>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setDialog({ kind: 'variant' })}>
          Add variant
        </Button>
      </div>

      <Card className="overflow-x-auto">
        {d.variants.length === 0 ? (
          <EmptyState
            icon={<Package className="h-6 w-6" />}
            title="No variants yet"
            body="A variant is one color in one size — it's what you actually hold stock of and sell. Add the first one."
            actions={
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setDialog({ kind: 'variant' })}>
                Add variant
              </Button>
            }
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Color</th>
                <th className="th">Size</th>
                <th className="th text-right">In stock</th>
                <th className="th text-right">Cost</th>
                <th className="th text-right">Price</th>
                <th className="th">Status</th>
                <th className="w-[9.5rem]" />
              </tr>
            </thead>
            <tbody>
              {d.variants.map((v) => (
                <tr key={v.id} className="animate-fade-in border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas">
                  <td className="td whitespace-nowrap">
                    <div>{v.color}</div>
                    <div className="text-xs text-ink-muted">{v.sku}</div>
                  </td>
                  <td className="td whitespace-nowrap text-ink-muted">{v.size}</td>
                  <td className="td num text-right">
                    <span key={v.stock} className="animate-tick inline-block">
                      {v.stock}
                    </span>
                  </td>
                  <td className="td text-right">
                    <Money paise={v.unitCostPaise} />
                    {v.bom.length > 0 && <div className="num text-xs text-ink-muted">{plural(v.bom.length, 'material')}</div>}
                  </td>
                  <td className="td text-right">
                    <Money paise={v.sellPricePaise} />
                    <Margin variant={v} />
                    {v.mrpPaise > 0 && <div className="num text-xs text-ink-muted">MRP {formatMoney(v.mrpPaise, { fractionDigits: 0 })}</div>}
                  </td>
                  <td className="td">
                    <StockPill status={v.status} />
                  </td>
                  <td className="td">
                    <div className="flex justify-end gap-0.5">
                      <IconButton label={`Adjust stock, ${v.color} ${v.size}`} onClick={() => setDialog({ kind: 'adjust', variant: v })}>
                        <PackagePlus className="h-4 w-4" />
                      </IconButton>
                      <IconButton label={`Stock history, ${v.color} ${v.size}`} onClick={() => setDialog({ kind: 'history', variant: v })}>
                        <History className="h-4 w-4" />
                      </IconButton>
                      <IconButton label={`Edit ${v.color} ${v.size}`} onClick={() => setDialog({ kind: 'variant', variant: v })}>
                        <Pencil className="h-4 w-4" />
                      </IconButton>
                      <IconButton label={`Archive ${v.color} ${v.size}`} onClick={() => setDialog({ kind: 'archive-variant', variant: v })}>
                        <Archive className="h-4 w-4" />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <p className="mt-3 text-xs text-ink-muted">
        Cost = making/purchase cost + raw materials. Margin is on the selling price, before GST. “Low stock” means at or below the variant's reorder level.
      </p>

      {dialog?.kind === 'edit-design' && (
        <DesignFormModal
          design={d}
          onClose={close}
          onSaved={() => close()}
        />
      )}
      {dialog?.kind === 'variant' && <VariantFormModal design={d} variant={dialog.variant} onClose={close} />}
      {dialog?.kind === 'adjust' && <AdjustStockModal variant={dialog.variant} onClose={close} />}
      {dialog?.kind === 'history' && <StockHistoryModal variant={dialog.variant} onClose={close} />}
      {dialog?.kind === 'archive-variant' && (
        <ConfirmDialog
          title="Archive this variant?"
          confirmLabel="Archive"
          danger
          body={
            <>
              {dialog.variant.color} / {dialog.variant.size} will disappear from stock and valuation
              {dialog.variant.stock > 0 && <>, including its <strong className="text-ink">{plural(dialog.variant.stock, 'piece')}</strong> in stock</>}. Past records that mention it are kept.
            </>
          }
          onClose={close}
          onConfirm={async () => {
            await api.variantArchive(dialog.variant.id);
            refresh();
            toast.success('Variant archived');
          }}
        />
      )}
      {dialog?.kind === 'archive-design' && (
        <ConfirmDialog
          title={`Archive ${d.name}?`}
          confirmLabel="Archive design"
          danger
          body={
            <>
              This removes the design and its {plural(d.variantCount, 'variant')} from inventory
              {d.totalStock > 0 && <>, including <strong className="text-ink">{plural(d.totalStock, 'piece')}</strong> in stock</>}. Past records that mention it are kept.
            </>
          }
          onClose={close}
          onConfirm={async () => {
            await api.designArchive(d.id);
            refresh();
            toast.success(`${d.name} archived`);
            navigate(paths.inventory());
          }}
        />
      )}
    </>
  );
}
