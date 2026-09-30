import { Boxes, ChevronRight, Plus, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, ErrorNote, Figure, Money, SearchInput, Segmented, TableSkeleton, StockPill } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { plural } from '../../lib/format';
import { navigate, paths } from '../../lib/router';
import { DesignFormModal } from './DesignFormModal';
import { InventoryShell } from './InventoryTabs';

type Filter = 'all' | 'low' | 'out';

export function InventoryPage({ initialFilter }: { initialFilter: Filter }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [adding, setAdding] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  const summary = useQuery(() => api.inventorySummary());
  const designs = useQuery(() => api.designsList({ search: debounced, status: filter }), [debounced, filter]);
  const suggestedCode = useQuery(() => api.designNextCode());
  const covers = useQuery(() => api.designCovers());

  const s = summary.data;
  const isEmptyInventory = s?.designCount === 0;

  async function loadSample() {
    setLoadingSample(true);
    try {
      await api.sampleDataLoad();
      refresh();
      toast.success('Sample designs added — archive or edit them any time');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoadingSample(false);
    }
  }

  return (
    <InventoryShell
      tab="designs"
      actions={
        <>
          <Button onClick={() => setAdding(true)}>Add one design</Button>
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => navigate(paths.addSarees)}>
            Add sarees
          </Button>
        </>
      }
    >
      {s && !isEmptyInventory && (
        <div className="mb-8 grid grid-cols-4 gap-6">
          <Figure label="Designs">{s.designCount}</Figure>
          <Figure label="Variants" sub="Color × size">{s.variantCount}</Figure>
          <Figure label="Pieces in stock">{s.unitsInStock}</Figure>
          <Figure label="Stock value" sub="At cost" highlight>
            <Money paise={s.stockValuePaise} fractionDigits={0} />
          </Figure>
        </div>
      )}

      {designs.error && <ErrorNote>{designs.error}</ErrorNote>}

      {isEmptyInventory ? (
        <Card>
          <EmptyState
            icon={<Boxes className="h-6 w-6" />}
            title="No designs yet"
            body="Add your sarees in one sheet: name, ID, MRP, selling price, cost and stock, one row per piece. You can paste straight from Excel. Or load sample data to look around first."
            actions={
              <>
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => navigate(paths.addSarees)}>
                  Add sarees
                </Button>
                <Button loading={loadingSample} onClick={() => void loadSample()}>
                  Load sample data
                </Button>
              </>
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between gap-4">
            <SearchInput value={search} onChange={setSearch} placeholder="Search design, code, color or SKU" />
            <Segmented
              label="Stock filter"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'low', label: 'Low stock', count: s?.lowStockDesigns },
                { value: 'out', label: 'Out of stock', count: s?.outOfStockDesigns },
              ]}
            />
          </div>

          <Card className="overflow-x-auto">
            {designs.loading ? (
              <TableSkeleton />
            ) : designs.data?.length === 0 ? (
              <EmptyState
                icon={<SearchX className="h-6 w-6" />}
                title="No designs match"
                body={debounced ? `Nothing found for “${debounced}”.` : filter === 'out' ? 'Nothing is out of stock.' : 'Nothing is running low.'}
                actions={
                  <Button
                    onClick={() => {
                      setSearch('');
                      setFilter('all');
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className="th">Design</th>
                    <th className="th">Fabric</th>
                    <th className="th text-right">Variants</th>
                    <th className="th text-right">In stock</th>
                    <th className="th text-right">Stock value</th>
                    <th className="th">Status</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {designs.data?.map((d) => (
                    <tr
                      key={d.id}
                      tabIndex={0}
                      onClick={() => navigate(paths.design(d.id))}
                      onKeyDown={(e) => e.key === 'Enter' && navigate(paths.design(d.id))}
                      className="animate-fade-in group cursor-pointer border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas focus-visible:bg-canvas"
                    >
                      <td className="td">
                        <div className="flex items-center gap-3">
                          {covers.data?.[d.id] ? <img src={covers.data[d.id]} alt="" className="h-11 w-9 shrink-0 rounded-md border border-line object-cover" /> : null}
                          <div>
                            <div>{d.name}</div>
                            <div className="text-xs text-ink-muted">{d.code}</div>
                          </div>
                        </div>
                      </td>
                      <td className="td text-ink-muted">{d.fabric || '—'}</td>
                      <td className="td num text-right">{d.variantCount}</td>
                      <td className="td num text-right">{d.totalStock}</td>
                      <td className="td text-right">
                        <Money paise={d.stockValuePaise} />
                      </td>
                      <td className="td">
                        <StockPill status={d.status} />
                      </td>
                      <td className="td pr-3 text-ink-muted/50 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink-muted">
                        <ChevronRight className="h-4 w-4" aria-hidden />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          {designs.data && designs.data.length > 0 && <p className="mt-3 text-xs text-ink-muted">Showing {plural(designs.data.length, 'design')}</p>}
        </>
      )}

      {adding && <DesignFormModal suggestedCode={suggestedCode.data} onClose={() => setAdding(false)} onSaved={(d) => navigate(paths.design(d.id))} />}
    </InventoryShell>
  );
}
