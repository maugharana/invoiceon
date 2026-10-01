import { ArrowLeft, Download, Printer } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { toCsv } from '../../../shared/csv';
import { todayIso } from '../../../shared/gst';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, EmptyState, ErrorNote, Figure, Input, PageHeader, SearchInput, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { useCsvExport } from '../../lib/exportCsv';
import { plural } from '../../lib/format';
import { matchesAll } from '../../../shared/search';
import { navigate, paths } from '../../lib/router';

/**
 * Count what is physically on the shelf, type each count against the system's figure, and post the differences as adjustments in one
 * step. Leave a box blank for anything you haven't counted: it isn't touched. Print the sheet to count on paper first.
 */
export function StockTakePage() {
  const toast = useToast();
  const refresh = useRefresh();
  const saveCsv = useCsvExport();
  const report = useQuery(() => api.reportStock());
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState(false);

  const back = (
    <a href={`#${paths.inventory()}`} className="inline-flex items-center gap-1.5 rounded-lg text-ink-muted transition-colors hover:text-ink print:hidden">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Inventory
    </a>
  );
  const r = report.data;
  const variants = useMemo(() => (r?.rows ?? []).flatMap((d) => d.variants.map((v) => ({ ...v, design: d.name }))), [r]);

  const entered = variants.filter((v) => counts[v.variantId] !== undefined && counts[v.variantId] !== '');
  const valid = (v: (typeof variants)[number]) => /^\d+$/.test(counts[v.variantId] ?? '');
  const invalid = entered.filter((v) => !valid(v));
  const differing = entered.filter((v) => valid(v) && Number(counts[v.variantId]) !== v.pieces);
  const net = differing.reduce((s, v) => s + Number(counts[v.variantId]) - v.pieces, 0);

  if (report.error && !r) return <ErrorNote>{report.error}</ErrorNote>;
  if (!r) return <Spinner />;

  async function apply() {
    const result = await api.stockTakeApply(
      entered.map((v) => ({ variantId: v.variantId, counted: Number(counts[v.variantId]) })),
      `Stock-take ${todayIso()}`,
    );
    refresh();
    setCounts({});
    toast.success(result.adjusted === 0 ? 'Every count matched. Nothing to change.' : `${plural(result.adjusted, 'piece count')} corrected (${result.pieceDifference > 0 ? '+' : ''}${result.pieceDifference} pieces in all)`);
    navigate(paths.inventory());
  }

  const visible = (design: string, v: (typeof variants)[number]) => matchesAll(`${design} ${v.sku} ${v.color} ${v.size}`, search);

  return (
    <>
      <PageHeader
        back={back}
        title="Stock-take"
        subtitle="Count what is on the shelf, type it in, and fix the differences in one go."
        actions={
          <>
            <Button
              icon={<Download className="h-4 w-4" />}
              onClick={() => void saveCsv(`stock-count-sheet-${todayIso()}.csv`, toCsv([['Design', 'SKU', 'Colour', 'Size', 'In the system', 'Counted'], ...variants.map((v) => [v.design, v.sku, v.color, v.size, v.pieces, ''])]), 'Count sheet saved')}
            >
              Count sheet (CSV)
            </Button>
            <Button icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
              Print
            </Button>
          </>
        }
      />

      {variants.length === 0 ? (
        <Card>
          <EmptyState icon={<Download className="h-6 w-6" />} title="Nothing to count" body="Add designs and stock under Inventory first." />
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-4 gap-6 print:hidden">
            <Figure label="Variants">{variants.length}</Figure>
            <Figure label="Counted" sub="Boxes filled in">{entered.length}</Figure>
            <Figure label="Different" sub="From the system" highlight>
              {differing.length}
            </Figure>
            <Figure label="Net difference" sub="Pieces">
              {net > 0 ? `+${net}` : net}
            </Figure>
          </div>
          <div className="mb-4 flex items-center justify-between gap-4 print:hidden">
            <SearchInput value={search} onChange={setSearch} placeholder="Find a design, colour or SKU" />
            <div className="flex gap-2">
              <Button onClick={() => setCounts(Object.fromEntries(variants.map((v) => [v.variantId, String(v.pieces)])))} title="Start every box at the system's figure, then change the ones that differ">
                Fill all with system counts
              </Button>
              <Button variant="ghost" onClick={() => setCounts({})} disabled={entered.length === 0}>
                Clear
              </Button>
            </div>
          </div>
          <Card className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className="th">Design</th>
                  <th className="th">Colour · size</th>
                  <th className="th text-right">In the system</th>
                  <th className="th w-32 text-right">Counted</th>
                  <th className="th w-24 text-right">Difference</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((d) => {
                  const rows = d.variants.filter((v) => visible(d.name, { ...v, design: d.name }));
                  if (rows.length === 0) return null;
                  return (
                    <Fragment key={d.designId}>
                      {rows.map((v, i) => {
                        const text = counts[v.variantId] ?? '';
                        const bad = text !== '' && !/^\d+$/.test(text);
                        const diff = text !== '' && !bad ? Number(text) - v.pieces : null;
                        return (
                          <tr key={v.variantId} className="border-b border-line/70 last:border-0">
                            <td className="td">{i === 0 ? d.name : <span className="text-ink-muted/40">″</span>}</td>
                            <td className="td text-ink-muted">
                              {v.color} · {v.size}
                              <div className="num text-xs">{v.sku}</div>
                            </td>
                            <td className="td num text-right">{v.pieces}</td>
                            <td className="td text-right">
                              <Input
                                inputMode="numeric"
                                value={text}
                                aria-label={`Counted, ${d.name} ${v.color} ${v.size}`}
                                aria-invalid={bad}
                                onChange={(e) => setCounts((c) => ({ ...c, [v.variantId]: e.target.value.trim() }))}
                                className="num h-8 text-right print:border-0"
                              />
                            </td>
                            <td className={`td num text-right ${diff === null || diff === 0 ? 'text-ink-muted/50' : diff > 0 ? 'text-status-paid-fg' : 'text-status-overdue-fg'}`}>{diff === null ? '' : diff === 0 ? '✓' : diff > 0 ? `+${diff}` : diff}</td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <div className="mt-6 flex items-center justify-between gap-4 print:hidden">
            <p className="text-xs text-ink-muted">{invalid.length > 0 ? <span className="text-status-overdue-fg">{plural(invalid.length, 'box')} must be a whole number.</span> : 'Blank boxes are left alone.'}</p>
            <Button variant="primary" disabled={entered.length === 0 || invalid.length > 0} onClick={() => setConfirm(true)}>
              Review and apply
            </Button>
          </div>
        </>
      )}

      {confirm && (
        <ConfirmDialog
          title="Apply this stock-take?"
          confirmLabel={differing.length === 0 ? 'Done' : `Correct ${plural(differing.length, 'count')}`}
          onClose={() => setConfirm(false)}
          body={
            differing.length === 0 ? (
              <p>All {plural(entered.length, 'count')} match the system. Nothing needs changing.</p>
            ) : (
              <div className="space-y-3">
                <p>
                  {plural(differing.length, 'variant')} will be corrected ({net > 0 ? '+' : ''}
                  {net} pieces in all). Each shows in its stock history as an adjustment.
                </p>
                <ul className="max-h-48 divide-y divide-line/70 overflow-y-auto rounded-lg border border-line text-sm">
                  {differing.map((v) => (
                    <li key={v.variantId} className="flex justify-between gap-4 px-3 py-1.5">
                      <span className="truncate">
                        {v.design} · {v.color} {v.size}
                      </span>
                      <span className="num shrink-0">
                        {v.pieces} → {counts[v.variantId]}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          }
          onConfirm={apply}
        />
      )}
    </>
  );
}
