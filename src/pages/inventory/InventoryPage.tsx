import { Boxes, ChevronRight, Download, Plus, SearchX, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { designsCsv } from '../../../shared/csv';
import { MARGIN_LABEL, NO_FILTERS, SOLD_LABEL, applyDesignFilters, fabricsOf, filtersActive, type DesignFilters, type MarginBand, type SoldBand } from '../../../shared/designFilters';
import { formatDate, todayIso } from '../../../shared/gst';
import { formatMoney } from '../../../shared/money';
import { Pager, SortableTh, sortBy, usePager, useSort } from '../../components/listTools';
import { Button, Card, EmptyState, ErrorNote, Field, Figure, Money, MoneyInput, SearchInput, Segmented, Select, TableSkeleton, StockPill } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { useCsvExport } from '../../lib/exportCsv';
import { plural } from '../../lib/format';
import { navigate, paths } from '../../lib/router';
import { DesignFormModal } from './DesignFormModal';
import { InventoryShell } from './InventoryTabs';

type Filter = 'all' | 'low' | 'out';
type SortKey = 'name' | 'stock' | 'value' | 'price' | 'margin' | 'sold' | 'cover';

export function InventoryPage({ initialFilter }: { initialFilter: Filter }) {
  const toast = useToast();
  const refresh = useRefresh();
  const saveCsv = useCsvExport();
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [adding, setAdding] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const [columns, setColumns] = useState<DesignFilters>(NO_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const sort = useSort<SortKey>('name', 'asc');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  const summary = useQuery(() => api.inventorySummary());
  const designs = useQuery(() => api.designsList({ search: debounced, status: filter }), [debounced, filter]);
  const everything = useQuery(() => api.designsList());
  const suggestedCode = useQuery(() => api.designNextCode());

  const s = summary.data;
  const isEmptyInventory = s?.designCount === 0;
  const fabrics = useMemo(() => fabricsOf(everything.data ?? []), [everything.data]);

  const shown = useMemo(() => {
    const rows = applyDesignFilters(designs.data ?? [], columns, todayIso());
    switch (sort.key) {
      case 'stock':
        return sortBy(rows, (d) => d.totalStock, sort.dir);
      case 'value':
        return sortBy(rows, (d) => d.stockValuePaise, sort.dir);
      case 'price':
        return sortBy(rows, (d) => d.minPricePaise, sort.dir);
      case 'margin':
        return sortBy(rows, (d) => d.marginPercent ?? -1e9, sort.dir);
      case 'sold':
        return sortBy(rows, (d) => d.lastSoldOn ?? '', sort.dir);
      case 'cover':
        return sortBy(rows, (d) => d.daysOfStock ?? 1e9, sort.dir);
      default:
        return sortBy(rows, (d) => d.name, sort.dir);
    }
  }, [designs.data, columns, sort.key, sort.dir]);
  const pager = usePager(shown);
  useEffect(() => pager.setPage(0), [debounced, filter, columns, sort.key, sort.dir]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = filtersActive(columns);
  const setColumn = <K extends keyof DesignFilters>(key: K, value: DesignFilters[K]) => setColumns((c) => ({ ...c, [key]: value }));

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
          {!isEmptyInventory && (
            <Button icon={<Download className="h-4 w-4" />} disabled={shown.length === 0} onClick={() => void saveCsv(`designs-${todayIso()}.csv`, designsCsv(shown), 'Designs saved')} title="Save the designs shown as a spreadsheet">
              Export CSV
            </Button>
          )}
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
            <div className="flex items-center gap-3">
              <SearchInput value={search} onChange={setSearch} placeholder="Search name, short name, code, color or SKU" />
              <Button icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
                Filters{active ? ' · on' : ''}
              </Button>
            </div>
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

          {showFilters && (
            <Card className="animate-fade-in mb-4 p-4">
              <div className="grid grid-cols-5 items-end gap-4">
                <Field label="Fabric">
                  <Select value={columns.fabric} onChange={(e) => setColumn('fabric', e.target.value)}>
                    <option value="">Any fabric</option>
                    {fabrics.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Price from" hint="Before GST">
                  <MoneyInput value={columns.minPricePaise} onChange={(v) => setColumn('minPricePaise', v)} aria-label="Lowest price" />
                </Field>
                <Field label="Price up to">
                  <MoneyInput value={columns.maxPricePaise} onChange={(v) => setColumn('maxPricePaise', v)} aria-label="Highest price" />
                </Field>
                <Field label="Margin">
                  <Select value={columns.margin} onChange={(e) => setColumn('margin', e.target.value as MarginBand)}>
                    {(Object.keys(MARGIN_LABEL) as MarginBand[]).map((m) => (
                      <option key={m} value={m}>
                        {MARGIN_LABEL[m]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Last sold">
                  <Select value={columns.sold} onChange={(e) => setColumn('sold', e.target.value as SoldBand)}>
                    {(Object.keys(SOLD_LABEL) as SoldBand[]).map((m) => (
                      <option key={m} value={m}>
                        {SOLD_LABEL[m]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {active && (
                <div className="mt-3 text-right">
                  <Button variant="ghost" className="h-8 text-xs" onClick={() => setColumns(NO_FILTERS)}>
                    Clear these filters
                  </Button>
                </div>
              )}
            </Card>
          )}

          <Card className="overflow-x-auto">
            {designs.loading ? (
              <TableSkeleton />
            ) : shown.length === 0 ? (
              <EmptyState
                icon={<SearchX className="h-6 w-6" />}
                title="No designs match"
                body={debounced ? `Nothing found for “${debounced}”.` : active ? 'No design fits those filters.' : filter === 'out' ? 'Nothing is out of stock.' : 'Nothing is running low.'}
                actions={
                  <Button
                    onClick={() => {
                      setSearch('');
                      setFilter('all');
                      setColumns(NO_FILTERS);
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
                    <SortableTh label="Design" active={sort.key === 'name'} dir={sort.dir} onSort={() => sort.toggle('name')} />
                    <th className="th">Fabric</th>
                    <SortableTh label="In stock" right active={sort.key === 'stock'} dir={sort.dir} onSort={() => sort.toggle('stock', 'desc')} />
                    <SortableTh label="Stock value" right active={sort.key === 'value'} dir={sort.dir} onSort={() => sort.toggle('value', 'desc')} />
                    <SortableTh label="Price" right active={sort.key === 'price'} dir={sort.dir} onSort={() => sort.toggle('price')} />
                    <SortableTh label="Margin" right active={sort.key === 'margin'} dir={sort.dir} onSort={() => sort.toggle('margin', 'desc')} />
                    <SortableTh label="Last sold" active={sort.key === 'sold'} dir={sort.dir} onSort={() => sort.toggle('sold', 'desc')} />
                    <SortableTh label="Stock lasts" right active={sort.key === 'cover'} dir={sort.dir} onSort={() => sort.toggle('cover')} />
                    <th className="th">Status</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {pager.pageItems.map((d) => (
                    <tr
                      key={d.id}
                      tabIndex={0}
                      onClick={() => navigate(paths.design(d.id))}
                      onKeyDown={(e) => e.key === 'Enter' && navigate(paths.design(d.id))}
                      className="animate-fade-in group cursor-pointer border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas focus-visible:bg-canvas"
                    >
                      <td className="td">
                        <div>{d.name}</div>
                        <div className="text-xs text-ink-muted">
                          {d.nickname && <span className="text-ink">{d.nickname}</span>}
                          {d.nickname && ' · '}
                          {d.code} · {plural(d.variantCount, 'variant')}
                        </div>
                      </td>
                      <td className="td text-ink-muted">{d.fabric || '—'}</td>
                      <td className="td num text-right">{d.totalStock}</td>
                      <td className="td text-right">
                        <Money paise={d.stockValuePaise} />
                      </td>
                      <td className="td num whitespace-nowrap text-right">
                        {d.maxPricePaise === 0 ? <span className="text-ink-muted">—</span> : d.minPricePaise === d.maxPricePaise ? formatMoney(d.minPricePaise, { fractionDigits: 0 }) : `${formatMoney(d.minPricePaise, { fractionDigits: 0 })} – ${formatMoney(d.maxPricePaise, { fractionDigits: 0 })}`}
                      </td>
                      <td className={`td num text-right ${d.marginPercent !== null && d.marginPercent < 0 ? 'text-status-overdue-fg' : ''}`}>{d.marginPercent === null ? <span className="text-ink-muted">—</span> : `${Math.round(d.marginPercent)}%`}</td>
                      <td className="td num whitespace-nowrap text-ink-muted">{d.lastSoldOn ? formatDate(d.lastSoldOn) : 'Never'}</td>
                      <td className="td num text-right" title={d.daysOfStock === null ? 'Nothing sold in the last 30 days, so there is no pace to go by' : `${plural(d.soldLast30Days, 'piece')} sold in the last 30 days`}>
                        {d.daysOfStock === null ? <span className="text-ink-muted">—</span> : d.daysOfStock === 0 ? <span className="text-status-overdue-fg">None left</span> : `${d.daysOfStock} days`}
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
          {shown.length > 0 && <Pager pager={pager} noun="design" />}
        </>
      )}

      {adding && <DesignFormModal suggestedCode={suggestedCode.data} onClose={() => setAdding(false)} onSaved={(d) => navigate(paths.design(d.id))} />}
    </InventoryShell>
  );
}
