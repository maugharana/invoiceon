import { Printer } from 'lucide-react';
import { useState } from 'react';
import { formatMoney } from '../../../shared/money';
import type { Variant } from '../../../shared/types';
import { Barcode } from '../../components/Barcode';
import { Modal } from '../../components/Modal';
import { PrintShell } from '../../components/PrintShell';
import { useToast } from '../../components/Toast';
import { Button, Input } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { paths } from '../../lib/router';

/** The address of the label sheet: one "variant:copies" pair for each colour and size. */
export const labelsPath = (items: { variantId: string; copies: number }[]) => paths.printLabels(items.filter((i) => i.copies > 0).map((i) => `${i.variantId}:${i.copies}`));

/** Asks how many labels of each colour and size, then prints the sheet. Stock on hand is the starting number: one label for each piece. */
export function LabelsModal({ title, variants, onClose }: { title: string; variants: Variant[]; onClose: () => void }) {
  const toast = useToast();
  const [copies, setCopies] = useState<Record<string, string>>(() => Object.fromEntries(variants.map((v) => [v.id, String(Math.max(1, v.stock))])));
  const [busy, setBusy] = useState(false);
  const items = variants.map((v) => ({ variantId: v.id, copies: Math.min(200, Math.max(0, Math.floor(Number(copies[v.id]) || 0))) }));
  const total = items.reduce((s, i) => s + i.copies, 0);

  async function print() {
    setBusy(true);
    try {
      if (window.invoiceon) await api.labelsPrint(items.filter((i) => i.copies > 0));
      else {
        window.open(`${location.origin}${location.pathname}#${labelsPath(items)}`, '_blank');
        toast.info('Opened in a new tab — click “Save as PDF / Print” there.');
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" icon={<Printer className="h-4 w-4" />} disabled={total === 0} loading={busy} onClick={() => void print()}>
            Print {total} label{total === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-ink-muted">Each label has the saree's name, colour and size, its price and a barcode. Stick it on the packet; at the counter, scan it to add the saree to a bill.</p>
      <ul className="divide-y divide-line/70">
        {variants.map((v) => (
          <li key={v.id} className="flex items-center justify-between gap-4 py-2">
            <span className="min-w-0">
              <span className="block truncate">{v.color} · {v.size}</span>
              <span className="num block text-xs text-ink-muted">{v.sku} · {v.stock} in stock</span>
            </span>
            <Input type="number" min={0} max={200} value={copies[v.id] ?? '0'} aria-label={`Labels for ${v.color} ${v.size}`} onChange={(e) => setCopies((c) => ({ ...c, [v.id]: e.target.value }))} className="num h-8 w-20 text-right" />
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** The sheet itself: three labels across, each with name, colour and size, price and barcode. Rendered for printing. */
export function PrintLabelsPage({ items }: { items: { variantId: string; copies: number }[] }) {
  const sale = useQuery(() => api.variantsForSale(), []);
  const settings = useQuery(() => api.getSettings());
  const wanted = new Map(items.map((i) => [i.variantId, i.copies]));
  if (sale.error) return <p className="p-8 text-status-overdue-fg">{sale.error}</p>;
  if (!sale.data || !settings.data) return null;
  const labels = sale.data.filter((v) => wanted.has(v.variantId)).flatMap((v) => Array.from({ length: Math.min(200, wanted.get(v.variantId) ?? 0) }, (_, n) => ({ v, n })));
  return (
    <PrintShell ready title="Labels" noun="sheet of labels">
      <div className="mx-auto grid w-[200mm] grid-cols-3 gap-x-[3mm] gap-y-[3mm] bg-white p-[5mm] text-ink print:w-auto">
        {labels.map(({ v, n }) => (
          <div key={`${v.variantId}-${n}`} className="flex h-[34mm] break-inside-avoid flex-col justify-between overflow-hidden rounded border border-line px-[2.5mm] py-[1.5mm]">
            <div>
              <div className="truncate text-[9px] leading-tight text-ink-muted">{settings.data!.businessName}</div>
              <div className="truncate text-[11px] font-medium leading-tight">{v.designName}</div>
              <div className="truncate text-[9px] leading-tight">{v.color} · {v.size}</div>
            </div>
            <div>
              <Barcode text={v.barcode || v.sku} height={34} />
              <div className="flex items-end justify-between">
                <span className="num max-w-[60%] truncate text-[8px] leading-none">{v.barcode || v.sku}</span>
                <span className="num text-[12px] font-medium leading-none">{formatMoney(v.sellPricePaise, { fractionDigits: v.sellPricePaise % 100 === 0 ? 0 : 2 })}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </PrintShell>
  );
}
