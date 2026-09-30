import { Download, Printer, ScanBarcode, SearchX } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_LABEL_SIZE, LABEL_SIZES, encodeLabelRequest, labelSizeById, MAX_LABELS } from '../../../shared/labels';
import { LabelCard } from '../../components/LabelCard';
import { useToast } from '../../components/Toast';
import { Button, Card, EmptyState, ErrorNote, Field, Input, SearchInput, Select, TableSkeleton } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { plural } from '../../lib/format';
import { InventoryShell } from './InventoryTabs';

/**
 * Print a label for each saree: its name, a barcode of its SKU, and its price. The invoice screen reads the barcode, so a scan adds the
 * saree to the bill. Pick how many of each (a button fills in what is in stock) and the label size, check the preview, and print.
 */
export function LabelsPage({ design }: { design: string | null }) {
  const toast = useToast();
  const variants = useQuery(() => api.variantsForSale());
  const settings = useQuery(() => api.getSettings());
  const [search, setSearch] = useState('');
  const [copies, setCopies] = useState<Record<string, number>>({});
  const [size, setSize] = useState(DEFAULT_LABEL_SIZE);
  const [showPrice, setShowPrice] = useState(true);
  const [showBusiness, setShowBusiness] = useState(true);
  const [busy, setBusy] = useState<'print' | 'pdf' | null>(null);

  // Arriving from a design's page: start with that design's pieces, one label per piece in stock (at least one).
  const seeded = useMemo(() => ({ done: false }), []);
  useEffect(() => {
    if (!design || seeded.done || !variants.data) return;
    seeded.done = true;
    setCopies(Object.fromEntries(variants.data.filter((v) => v.designId === design).map((v) => [v.variantId, Math.max(1, v.stock)])));
  }, [design, variants.data, seeded]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (variants.data ?? []).filter((v) => !q || `${v.designName} ${v.designCode} ${v.color} ${v.size} ${v.sku}`.toLowerCase().includes(q));
  }, [variants.data, search]);

  const chosen = (variants.data ?? []).filter((v) => (copies[v.variantId] ?? 0) > 0);
  const total = chosen.reduce((s, v) => s + (copies[v.variantId] ?? 0), 0);
  const labelSize = labelSizeById(size);
  const request = { size, showPrice, showBusiness, items: chosen.map((v) => ({ variantId: v.variantId, copies: copies[v.variantId]! })) };
  const query = encodeLabelRequest(request);
  const set = (id: string, n: number) => setCopies((c) => ({ ...c, [id]: Math.max(0, Math.min(MAX_LABELS, Math.trunc(n) || 0)) }));

  async function output(kind: 'print' | 'pdf') {
    if (!window.invoiceon) {
      window.open(`${location.origin}${location.pathname}#/print/labels?${query}`, '_blank');
      toast.info('Opened in a new tab. Use the Print button there, then choose your label printer or "Save as PDF".');
      return;
    }
    setBusy(kind);
    try {
      if (kind === 'print') await api.labelsPrint(query);
      else if ((await api.labelsExportPdf(query)).saved) toast.success('PDF saved');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <InventoryShell tab="labels">
      {variants.error && <ErrorNote>{variants.error}</ErrorNote>}
      {variants.data?.length === 0 ? (
        <Card>
          <EmptyState icon={<ScanBarcode className="h-6 w-6" />} title="No sarees to label yet" body="Add designs and their colours and sizes under Inventory, then come back to print barcode labels for them." />
        </Card>
      ) : (
        <div className="grid grid-cols-[1fr_20rem] items-start gap-6">
          <div>
            <div className="mb-4 flex items-center justify-between gap-3">
              <SearchInput value={search} onChange={setSearch} placeholder="Search design, colour or SKU" />
              <div className="flex gap-2">
                <Button className="h-8 px-3 text-xs" onClick={() => setCopies((c) => ({ ...c, ...Object.fromEntries(shown.map((v) => [v.variantId, Math.max(1, v.stock)])) }))}>
                  One per piece in stock
                </Button>
                <Button className="h-8 px-3 text-xs" onClick={() => setCopies((c) => ({ ...c, ...Object.fromEntries(shown.map((v) => [v.variantId, 1])) }))}>
                  One each
                </Button>
                <Button variant="ghost" className="h-8 px-3 text-xs" onClick={() => setCopies({})}>
                  Clear
                </Button>
              </div>
            </div>
            <Card className="overflow-x-auto">
              {variants.loading ? (
                <TableSkeleton />
              ) : shown.length === 0 ? (
                <EmptyState icon={<SearchX className="h-6 w-6" />} title="No sarees match" body="Try a different search." actions={<Button onClick={() => setSearch('')}>Clear search</Button>} />
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="th">Saree</th>
                      <th className="th">SKU</th>
                      <th className="th text-right">In stock</th>
                      <th className="th w-28 text-right">Labels</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((v) => (
                      <tr key={v.variantId} className="border-b border-line/70 last:border-0">
                        <td className="td">
                          {v.designName}
                          <div className="text-xs text-ink-muted">{v.color} · {v.size}</div>
                        </td>
                        <td className="td num text-xs text-ink-muted">{v.sku}</td>
                        <td className="td num text-right">{v.stock}</td>
                        <td className="td">
                          <Input type="number" min={0} value={copies[v.variantId] ?? 0} onChange={(e) => set(v.variantId, Number(e.target.value))} className="num h-8 text-right" aria-label={`Labels for ${v.designName} ${v.color} ${v.size}`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          <aside className="sticky top-6 space-y-4">
            <Card className="space-y-4 p-5">
              <Field label="Label size">
                <Select value={size} onChange={(e) => setSize(e.target.value)} aria-label="Label size">
                  {LABEL_SIZES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} className="h-4 w-4 accent-[#0F6E56]" />
                Print the price (MRP if set)
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={showBusiness} onChange={(e) => setShowBusiness(e.target.checked)} className="h-4 w-4 accent-[#0F6E56]" />
                Print the shop name
              </label>
            </Card>

            <Card className="p-5">
              <div className="mb-3 text-xs font-medium text-ink-muted">Preview</div>
              {chosen.length === 0 ? (
                <p className="text-ink-muted">Choose how many labels you want of each saree.</p>
              ) : (
                <div className="flex justify-center overflow-hidden rounded-lg bg-canvas p-3">
                  <div className="border border-line shadow-card" style={{ zoom: Math.min(1.6, 250 / (labelSize.widthMm * 3.78)) }}>
                    <LabelCard variant={chosen[0]!} size={labelSize} businessName={settings.data?.businessName ?? ''} showPrice={showPrice} showBusiness={showBusiness} />
                  </div>
                </div>
              )}
              <p className="mt-3 text-xs text-ink-muted">
                {plural(total, 'label')} of {plural(chosen.length, 'saree')}
                {labelSize.sheet && total > 0 ? `, on ${Math.ceil(total / (labelSize.sheet.cols * labelSize.sheet.rows))} ${Math.ceil(total / (labelSize.sheet.cols * labelSize.sheet.rows)) === 1 ? 'sheet' : 'sheets'}` : ''}.
              </p>
              <div className="mt-4 flex gap-2">
                <Button variant="primary" className="flex-1" icon={<Printer className="h-4 w-4" />} loading={busy === 'print'} disabled={total === 0 || busy !== null} onClick={() => void output('print')}>
                  Print
                </Button>
                <Button className="flex-1" icon={<Download className="h-4 w-4" />} loading={busy === 'pdf'} disabled={total === 0 || busy !== null} onClick={() => void output('pdf')}>
                  Save PDF
                </Button>
              </div>
              <p className="mt-3 text-xs text-ink-muted">A scanner that types like a keyboard works with these: scan a label on the New invoice screen and the saree is added.</p>
            </Card>
          </aside>
        </div>
      )}
    </InventoryShell>
  );
}
