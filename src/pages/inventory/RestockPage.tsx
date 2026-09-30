import { Download, PackageCheck, PackageSearch } from 'lucide-react';
import { useState } from 'react';
import { toCsv } from '../../../shared/csv';
import { formatDate } from '../../../shared/gst';
import { DEFAULT_INSIGHTS, type InsightParams } from '../../../shared/insights';
import { formatMoney } from '../../../shared/money';
import { useToast } from '../../components/Toast';
import { Button, Card, EmptyState, ErrorNote, Field, Figure, Input, Money, Pill, TableSkeleton } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { plural } from '../../lib/format';
import { navigate, paths } from '../../lib/router';
import { InventoryShell } from './InventoryTabs';

const money = (p: number) => formatMoney(p, { fractionDigits: 0 });

/** What to make or buy next, and what has stopped selling. It only reads: the rules are in the README and the numbers are shown with their reasons. */
export function RestockPage() {
  const toast = useToast();
  const [params, setParams] = useState<InsightParams>(DEFAULT_INSIGHTS);
  const insights = useQuery(() => api.stockInsights(params), [params.lookbackDays, params.leadDays, params.coverDays, params.deadDays]);
  const d = insights.data;
  const set = (key: keyof InsightParams, raw: string) => setParams((p) => ({ ...p, [key]: Math.trunc(Number(raw)) || 0 }));

  async function exportCsv() {
    if (!d) return;
    const csv = toCsv([
      ['Design', 'Colour', 'Size', 'SKU', 'In stock', 'On order', 'Sold in period', 'Per day', 'Days left', 'Suggested', 'Cost of batch (Rs)'],
      ...d.reorder.map((r) => [r.designName, r.color, r.size, r.sku, r.stock, r.onOrder, r.soldInPeriod, r.perDay.toFixed(2), r.daysOfCover === null ? '' : Math.floor(r.daysOfCover), r.suggestedQty, (r.costOfBatchPaise / 100).toFixed(2)]),
    ]);
    const name = `Reorder list ${d.asOf}.csv`;
    try {
      if (window.invoiceon) {
        if ((await api.exportSave(name, csv)).saved) toast.success('Saved');
      } else {
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        Object.assign(document.createElement('a'), { href: url, download: name }).click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <InventoryShell tab="restock">
      {insights.error && <ErrorNote>{insights.error}</ErrorNote>}

      <Card className="mb-6 p-5">
        <div className="grid grid-cols-4 gap-4">
          <Field label="Look at sales over" hint="days">
            <Input type="number" min={7} max={730} className="num" value={params.lookbackDays} onChange={(e) => set('lookbackDays', e.target.value)} />
          </Field>
          <Field label="A new batch takes" hint="days to arrive">
            <Input type="number" min={0} max={365} className="num" value={params.leadDays} onChange={(e) => set('leadDays', e.target.value)} />
          </Field>
          <Field label="It should then last" hint="days">
            <Input type="number" min={1} max={365} className="num" value={params.coverDays} onChange={(e) => set('coverDays', e.target.value)} />
          </Field>
          <Field label="Dead if unsold for" hint="days">
            <Input type="number" min={7} max={730} className="num" value={params.deadDays} onChange={(e) => set('deadDays', e.target.value)} />
          </Field>
        </div>
        <p className="mt-3 text-xs text-ink-muted">
          How fast a piece sold over the last {params.lookbackDays} days is projected forward {params.leadDays + params.coverDays} days ({params.leadDays} for the batch to arrive, {params.coverDays} to last), less what is on the shelf and already ordered from weavers. Pieces with a reorder level are kept above it.
        </p>
      </Card>

      {d && (
        <div className="mb-8 grid grid-cols-4 gap-6">
          <Figure label="Running out" sub="Gone before a batch could arrive" highlight={d.totals.urgent > 0}>
            {d.totals.urgent}
          </Figure>
          <Figure label="Pieces to make or buy">{d.totals.reorderPieces}</Figure>
          <Figure label="Cost of those" sub="At today's cost per piece">
            <Money paise={d.totals.reorderCostPaise} fractionDigits={0} />
          </Figure>
          <Figure label="Tied up in dead stock" sub={`${plural(d.totals.deadPieces, 'piece')} not moving`}>
            <Money paise={d.totals.deadTiedUpPaise} fractionDigits={0} />
          </Figure>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base">Running low</h2>
        <Button icon={<Download className="h-4 w-4" />} disabled={!d || d.reorder.length === 0} onClick={() => void exportCsv()}>
          Export list (CSV)
        </Button>
      </div>
      <Card className="mb-10 overflow-x-auto">
        {insights.loading ? (
          <TableSkeleton columns={6} />
        ) : d && d.reorder.length === 0 ? (
          <EmptyState icon={<PackageCheck className="h-6 w-6" />} title="Nothing needs reordering" body="Everything that is selling has enough on the shelf or on order for the days you chose." />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Saree</th>
                <th className="th text-right">In stock</th>
                <th className="th text-right">Selling</th>
                <th className="th text-right">Lasts</th>
                <th className="th text-right">On order</th>
                <th className="th text-right">Make or buy</th>
                <th className="th text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {d?.reorder.map((r) => (
                <tr key={r.variantId} tabIndex={0} onClick={() => navigate(paths.design(r.designId))} onKeyDown={(e) => e.key === 'Enter' && navigate(paths.design(r.designId))} className="cursor-pointer border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas">
                  <td className="td">
                    <div className="flex items-center gap-2">
                      {r.designName}
                      {r.urgent && <Pill tone="overdue">Running out</Pill>}
                    </div>
                    <div className="text-xs text-ink-muted">
                      {r.color} · {r.size} · {r.sku}
                    </div>
                  </td>
                  <td className="td num text-right">{r.stock}</td>
                  <td className="td num text-right text-ink-muted">{r.perDay > 0 ? `${+(r.perDay * 7).toFixed(1)} a week` : 'not selling'}</td>
                  <td className="td num text-right">{r.daysOfCover === null ? <span className="text-ink-muted/50">—</span> : `${Math.floor(r.daysOfCover)} days`}</td>
                  <td className="td num text-right">{r.onOrder || <span className="text-ink-muted/50">—</span>}</td>
                  <td className="td num text-right font-medium">{r.suggestedQty}</td>
                  <td className="td text-right"><Money paise={r.costOfBatchPaise} fractionDigits={0} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="mb-3">
        <h2 className="text-base">Not moving</h2>
        <p className="mt-0.5 text-xs text-ink-muted">On the shelf with no sale for {params.deadDays} days or more (new arrivals get that long to sell). An offer is one way to free the money.{' '}
          <a href={`#${paths.settingsSection('offers')}`} className="text-brand underline-offset-2 hover:underline">Make an offer</a>.
        </p>
      </div>
      <Card className="overflow-x-auto">
        {insights.loading ? (
          <TableSkeleton columns={5} />
        ) : d && d.dead.length === 0 ? (
          <EmptyState icon={<PackageSearch className="h-6 w-6" />} title="Nothing is stuck" body={`Every piece on the shelf has sold within ${params.deadDays} days, or has not been here that long.`} />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Saree</th>
                <th className="th text-right">Pieces</th>
                <th className="th">Last sold</th>
                <th className="th text-right">Idle</th>
                <th className="th text-right">Selling price</th>
                <th className="th text-right">Tied up (cost)</th>
              </tr>
            </thead>
            <tbody>
              {d?.dead.map((r) => (
                <tr key={r.variantId} tabIndex={0} onClick={() => navigate(paths.design(r.designId))} onKeyDown={(e) => e.key === 'Enter' && navigate(paths.design(r.designId))} className="cursor-pointer border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas">
                  <td className="td">
                    <div>{r.designName}</div>
                    <div className="text-xs text-ink-muted">
                      {r.color} · {r.size} · {r.sku}
                    </div>
                  </td>
                  <td className="td num text-right">{r.stock}</td>
                  <td className="td text-ink-muted">{r.lastSoldOn ? formatDate(r.lastSoldOn) : 'Never'}</td>
                  <td className="td num text-right">{r.idleDays} days</td>
                  <td className="td text-right"><Money paise={r.sellPricePaise} fractionDigits={0} /></td>
                  <td className="td text-right">{money(r.tiedUpPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </InventoryShell>
  );
}
