import { BookImage, Download, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DEFAULT_CATALOGUE, encodeCatalogueRequest } from '../../../shared/catalogue';
import { CatalogueSheet } from '../../components/CatalogueSheet';
import { useToast } from '../../components/Toast';
import { Button, Card, EmptyState, ErrorNote, Field, Input, SearchInput } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { plural } from '../../lib/format';
import { InventoryShell } from './InventoryTabs';

/**
 * A catalogue to share with customers: the designs you choose, each with its cover photo, colours and price, as a PDF (send it on WhatsApp)
 * or on paper. It only ever shows what customers should see: never costs.
 */
export function CataloguePage() {
  const toast = useToast();
  const designs = useQuery(() => api.designsList({}));
  const covers = useQuery(() => api.designCovers());
  const [title, setTitle] = useState(DEFAULT_CATALOGUE.title);
  const [inStockOnly, setInStockOnly] = useState(true);
  const [showPrices, setShowPrices] = useState(true);
  const [columns, setColumns] = useState<2 | 3>(3);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<'print' | 'pdf' | null>(null);

  const request = useMemo(() => ({ title: title.trim() || DEFAULT_CATALOGUE.title, designIds: [...picked], inStockOnly, showPrices, columns }), [title, picked, inStockOnly, showPrices, columns]);
  const query = encodeCatalogueRequest(request);
  const preview = useQuery(() => api.catalogueData(query), [query]);

  const shown = (designs.data ?? []).filter((d) => `${d.name} ${d.code} ${d.fabric}`.toLowerCase().includes(search.trim().toLowerCase()));
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function output(kind: 'print' | 'pdf') {
    if (!window.invoiceon) {
      window.open(`${location.origin}${location.pathname}#/print/catalogue?${query}`, '_blank');
      toast.info('Opened in a new tab. Use the Print button there, then choose "Save as PDF" to share it.');
      return;
    }
    setBusy(kind);
    try {
      if (kind === 'print') await api.cataloguePrint(query);
      else if ((await api.catalogueExportPdf(query)).saved) toast.success('PDF saved');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const count = preview.data?.items.length ?? 0;

  return (
    <InventoryShell tab="catalogue">
      {designs.error && <ErrorNote>{designs.error}</ErrorNote>}
      {designs.data?.length === 0 ? (
        <Card>
          <EmptyState icon={<BookImage className="h-6 w-6" />} title="No designs to show yet" body="Add designs, and photos of them, under Inventory. Then come back to make a catalogue you can share with customers." />
        </Card>
      ) : (
        <div className="grid grid-cols-[20rem_1fr] items-start gap-6">
          <div className="space-y-4">
            <Card className="space-y-4 p-4">
              <Field label="Title">
                <Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} /> Only what is in stock
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={showPrices} onChange={(e) => setShowPrices(e.target.checked)} /> Show prices
              </label>
              <Field label="Designs per row">
                <div className="flex gap-2">
                  {([2, 3] as const).map((n) => (
                    <Button key={n} variant={columns === n ? 'primary' : 'secondary'} onClick={() => setColumns(n)}>
                      {n}
                    </Button>
                  ))}
                </div>
              </Field>
              <div className="flex gap-2">
                <Button variant="primary" className="flex-1" icon={<Download className="h-4 w-4" />} loading={busy === 'pdf'} disabled={count === 0 || busy !== null} onClick={() => void output('pdf')}>
                  {window.invoiceon ? 'Save PDF' : 'Open to save'}
                </Button>
                {window.invoiceon && (
                  <Button icon={<Printer className="h-4 w-4" />} loading={busy === 'print'} disabled={count === 0 || busy !== null} onClick={() => void output('print')}>
                    Print
                  </Button>
                )}
              </div>
            </Card>
            <Card className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium">Designs</h3>
                <span className="text-xs text-ink-muted">{picked.size === 0 ? 'All' : `${picked.size} chosen`}</span>
              </div>
              <SearchInput value={search} onChange={setSearch} placeholder="Search designs" />
              <ul className="mt-3 max-h-80 space-y-0.5 overflow-y-auto">
                {shown.map((d) => (
                  <li key={d.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-canvas">
                      <input type="checkbox" checked={picked.has(d.id)} onChange={() => toggle(d.id)} />
                      {covers.data?.[d.id] ? <img src={covers.data[d.id]} alt="" className="h-8 w-6 rounded object-cover" /> : <span className="h-8 w-6 rounded bg-canvas" />}
                      <span className="min-w-0 flex-1 truncate">{d.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
              {picked.size > 0 && (
                <button type="button" className="mt-2 text-xs text-brand underline-offset-2 hover:underline" onClick={() => setPicked(new Set())}>
                  Clear, and use every design
                </button>
              )}
            </Card>
          </div>

          <div className="min-w-0">
            <p className="mb-3 text-xs text-ink-muted">
              Preview: {plural(count, 'design')}
              {preview.data && preview.data.items.some((i) => !i.photo) ? '. Some have no photo yet: add them on the design’s page.' : '.'}
            </p>
            <div className="overflow-auto rounded-lg border border-line bg-canvas p-4">
              <div className="origin-top-left" style={{ zoom: 0.55 }}>
                {preview.data ? <CatalogueSheet data={preview.data} columns={columns} showPrices={showPrices} inStockOnly={inStockOnly} /> : null}
              </div>
            </div>
          </div>
        </div>
      )}
    </InventoryShell>
  );
}
