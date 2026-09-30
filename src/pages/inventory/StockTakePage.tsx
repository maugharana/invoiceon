import { ClipboardCheck, Download, ScanBarcode } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toCsv } from '../../../shared/csv';
import { todayIso } from '../../../shared/gst';
import { formatMoney } from '../../../shared/money';
import type { StockTake, StockTakeLine, StockTakeResult } from '../../../shared/stocktake';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, EmptyState, ErrorNote, Field, Figure, Input, Pill, SearchInput, Segmented, Select, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { formatDateTime, plural } from '../../lib/format';
import { useBarcodeScanner } from '../../lib/scanner';
import { InventoryShell } from './InventoryTabs';

type View = 'all' | 'uncounted' | 'differences';

/**
 * A physical stock take. Walk the shelves and type in (or scan) how many of each saree there are; the page shows where that differs from the
 * books. Nothing changes until you finish: then each difference becomes a stock adjustment, and sarees you did not count are left alone.
 */
export function StockTakePage() {
  const current = useQuery(() => api.stockTakeCurrent());
  const history = useQuery(() => api.stockTakesList());
  // Held here, not in the counting screen: applying ends the count, which replaces that screen with the start screen.
  const [result, setResult] = useState<StockTakeResult | null>(null);
  return (
    <InventoryShell tab="count">
      {current.error && <ErrorNote>{current.error}</ErrorNote>}
      {current.loading ? <Spinner /> : current.data ? <Counting take={current.data} onApplied={setResult} /> : <Begin past={history.data ?? []} />}
      {result && (
        <ConfirmDialog
          title="Count applied"
          confirmLabel="Done"
          onClose={() => setResult(null)}
          onConfirm={() => setResult(null)}
          body={
            <div className="space-y-2">
              <p>{result.adjusted === 0 ? 'No adjustments were needed.' : `${plural(result.adjusted, 'adjustment')} made to stock.`}</p>
              {result.clamped.length > 0 && (
                <>
                  <p>Some were smaller than counted, because pieces sold after they were counted:</p>
                  <ul className="list-disc pl-5 text-xs text-ink-muted">
                    {result.clamped.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          }
        />
      )}
    </InventoryShell>
  );
}

function Begin({ past }: { past: { id: string; name: string; status: string; finishedAt: string | null; totals: { counted: number; differences: number; surplusPieces: number; shortagePieces: number; varianceCostPaise: number } }[] }) {
  const toast = useToast();
  const refresh = useRefresh();
  const designs = useQuery(() => api.designsList({}));
  const [name, setName] = useState(`Stock take ${todayIso()}`);
  const [designId, setDesignId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      await api.stockTakeStart({ name, designId: designId || null });
      refresh();
    } catch (err) {
      setError(errorMessage(err));
      toast.error(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <Card className="max-w-xl space-y-4 p-6">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-brand" aria-hidden />
          <h2 className="text-base">Start a stock take</h2>
        </div>
        <p className="text-sm text-ink-muted">Count what is really on the shelves, see where it differs from the books, then put the differences right in one step. You can stop and carry on another day, and selling goes on as normal while you count.</p>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label="Name">
          <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Count">
          <Select value={designId} onChange={(e) => setDesignId(e.target.value)} aria-label="What to count">
            <option value="">Every saree</option>
            {designs.data?.map((d) => (
              <option key={d.id} value={d.id}>
                Only {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void begin()}>
          Start counting
        </Button>
      </Card>

      {past.length > 0 && (
        <section>
          <h2 className="mb-3 text-base">Past counts</h2>
          <Card>
            <ul className="divide-y divide-line/70 text-sm">
              {past.map((p) => (
                <li key={p.id} className="flex items-center gap-4 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{p.name}</div>
                    <div className="text-xs text-ink-muted">{p.finishedAt ? formatDateTime(p.finishedAt) : ''}</div>
                  </div>
                  {p.status === 'cancelled' ? (
                    <Pill tone="neutral">Cancelled</Pill>
                  ) : (
                    <span className="text-xs text-ink-muted">
                      {plural(p.totals.counted, 'saree')} counted, {p.totals.differences === 0 ? 'no differences' : `${p.totals.surplusPieces} over, ${p.totals.shortagePieces} short (${formatMoney(p.totals.varianceCostPaise, { fractionDigits: 0 })} at cost)`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}

function Counting({ take, onApplied }: { take: StockTake; onApplied: (r: StockTakeResult) => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [view, setView] = useState<View>('all');
  const [search, setSearch] = useState('');
  const [applying, setApplying] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return take.lines
      .filter((l) => (view === 'uncounted' ? l.counted === null : view === 'differences' ? (l.variance ?? 0) !== 0 : true))
      .filter((l) => !q || `${l.designName} ${l.color} ${l.size} ${l.sku}`.toLowerCase().includes(q));
  }, [take.lines, view, search]);

  async function set(line: StockTakeLine, counted: number | null) {
    try {
      await api.stockTakeCount(take.id, line.variantId, counted);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  // A scanner adds one to the saree whose SKU it reads: pick up each piece, scan it, and the count follows.
  useBarcodeScanner((code) => {
    const line = take.lines.find((l) => l.sku.toLowerCase() === code.trim().toLowerCase());
    if (!line) return toast.error(`"${code}" is not part of this count.`);
    void set(line, (line.counted ?? 0) + 1);
    toast.success(`${line.designName}, ${line.color}: ${(line.counted ?? 0) + 1}`);
  });

  async function exportSheet() {
    // A blind sheet for walking the shelves: what is what, with a blank to fill in, and deliberately not what the books expect.
    const csv = toCsv([['Design', 'Colour', 'Size', 'SKU', 'Counted'], ...take.lines.map((l) => [l.designName, l.color, l.size, l.sku, ''])]);
    const name = `Count sheet ${todayIso()}.csv`;
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

  const t = take.totals;
  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-6">
        <div>
          <h2 className="text-lg tracking-tight">{take.name}</h2>
          <p className="text-sm text-ink-muted">
            Started {formatDateTime(take.createdAt)}. <ScanBarcode className="inline h-4 w-4" aria-hidden /> A barcode scanner adds one to the saree it reads.
          </p>
        </div>
        <div className="flex gap-2">
          <Button icon={<Download className="h-4 w-4" />} onClick={() => void exportSheet()}>
            Count sheet
          </Button>
          <Button onClick={() => setCancelling(true)}>Cancel count</Button>
          <Button variant="primary" disabled={t.counted === 0} onClick={() => setApplying(true)}>
            Finish and apply
          </Button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-4 gap-6">
        <Figure label="Counted" sub={`of ${t.lines} sarees`}>
          {t.counted}
        </Figure>
        <Figure label="Differences" highlight={t.differences > 0}>
          {t.differences}
        </Figure>
        <Figure label="Over / short" sub="Pieces">
          +{t.surplusPieces} / −{t.shortagePieces}
        </Figure>
        <Figure label="Effect on stock value" sub="At cost">
          {formatMoney(t.varianceCostPaise, { fractionDigits: 0 })}
        </Figure>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search design, colour or SKU" />
        <Segmented
          label="Show"
          value={view}
          onChange={setView}
          options={[
            { value: 'all', label: 'All', count: t.lines },
            { value: 'uncounted', label: 'Not counted', count: t.lines - t.counted },
            { value: 'differences', label: 'Differences', count: t.differences },
          ]}
        />
      </div>

      <Card className="overflow-x-auto">
        {shown.length === 0 ? (
          <EmptyState icon={<ClipboardCheck className="h-6 w-6" />} title="Nothing here" body={view === 'uncounted' ? 'Every saree has been counted.' : view === 'differences' ? 'So far the count agrees with the books.' : 'No sarees match your search.'} />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Saree</th>
                <th className="th text-right">Books say</th>
                <th className="th w-32 text-right">Counted</th>
                <th className="th w-28 text-right">Difference</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.variantId} className="border-b border-line/70 last:border-0">
                  <td className="td">
                    <div>{l.designName}</div>
                    <div className="text-xs text-ink-muted">
                      {l.color} · {l.size} · {l.sku}
                    </div>
                  </td>
                  <td className="td num text-right text-ink-muted">{l.systemNow}</td>
                  <td className="td text-right">
                    <CountBox line={l} onSave={(n) => void set(l, n)} />
                  </td>
                  <td className="td text-right">
                    {l.variance === null ? <span className="text-ink-muted/50">—</span> : l.variance === 0 ? <span className="text-brand">Matches</span> : <Pill tone={l.variance < 0 ? 'overdue' : 'partial'}>{l.variance > 0 ? `+${l.variance}` : l.variance}</Pill>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {applying && (
        <ConfirmDialog
          title="Finish and apply this count?"
          confirmLabel="Apply differences"
          onClose={() => setApplying(false)}
          body={
            <div className="space-y-3">
              <p>
                {t.differences === 0 ? 'Everything you counted agrees with the books, so nothing will change.' : `${plural(t.differences, 'saree')} will be adjusted: ${t.surplusPieces} piece${t.surplusPieces === 1 ? '' : 's'} added and ${t.shortagePieces} taken off, written into each saree's stock history.`}
              </p>
              {t.lines - t.counted > 0 && <p>The {plural(t.lines - t.counted, 'saree')} you did not count will be left exactly as they are.</p>}
            </div>
          }
          onConfirm={async () => {
            const r = await api.stockTakeApply(take.id);
            refresh();
            setApplying(false);
            onApplied(r);
          }}
        />
      )}
      {cancelling && (
        <ConfirmDialog
          title="Cancel this count?"
          confirmLabel="Cancel the count"
          danger
          onClose={() => setCancelling(false)}
          body={<p>The counts you have entered are thrown away. Stock is not changed.</p>}
          onConfirm={async () => {
            await api.stockTakeCancel(take.id);
            refresh();
            setCancelling(false);
          }}
        />
      )}
    </>
  );
}

/** A number box that saves when you leave it or press Enter, and clears the count when emptied. */
function CountBox({ line, onSave }: { line: StockTakeLine; onSave: (n: number | null) => void }) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (line.counted === null ? '' : String(line.counted));
  const commit = () => {
    if (text === null) return;
    const v = text.trim() === '' ? null : Math.max(0, Math.trunc(Number(text)));
    setText(null);
    if (v !== line.counted && (v === null || Number.isFinite(v))) onSave(v);
  };
  return (
    <Input
      type="number"
      min={0}
      inputMode="numeric"
      aria-label={`Counted ${line.sku}`}
      className="num ml-auto h-8 w-24 text-right"
      value={shown}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
