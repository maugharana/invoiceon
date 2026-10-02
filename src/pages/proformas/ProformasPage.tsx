import { ChevronRight, ClipboardList, Download, Plus, SearchX } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { proformasCsv } from '../../../shared/csv';
import { formatDate, todayIso } from '../../../shared/gst';
import { buildPipeline } from '../../../shared/pipeline';
import type { ProformaStatus, ProformaSummary } from '../../../shared/types';
import { Button, Card, EmptyState, ErrorNote, Money, PageHeader, ProformaPill, SearchInput, Segmented, TableSkeleton, TypePill } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { DateRangeFilter, Pager, SortableTh, sortBy, usePager, useSort, type DateRangeValue } from '../../components/listTools';
import { useCsvExport } from '../../lib/exportCsv';
import { navigate, paths } from '../../lib/router';

type Status = 'all' | ProformaStatus;

/** The quotes as a board: one column per stage, so it is plain what is waiting, what is won, what is lost. */
function Board({ quotes, loading }: { quotes: ProformaSummary[]; loading: boolean }) {
  const groups = useMemo(() => buildPipeline(quotes), [quotes]);
  if (loading) return <TableSkeleton />;
  return (
    <div className="grid grid-cols-5 items-start gap-3 overflow-x-auto pb-4">
      {groups.map((g) => (
        <div key={g.column} className="min-w-[11rem] rounded-xl bg-canvas p-3">
          <div className="mb-3 px-1">
            <div className="text-xs text-ink-muted">{g.label}</div>
            <div className="flex items-baseline justify-between">
              <span className="num text-base">{g.quotes.length}</span>
              <Money paise={g.totalPaise} fractionDigits={0} className="text-xs text-ink-muted" />
            </div>
          </div>
          <div className="space-y-2">
            {g.quotes.length === 0 && <p className="px-1 py-3 text-xs text-ink-muted/70">Nothing here</p>}
            {g.quotes.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => navigate(paths.proforma(q.id))}
                className="block w-full rounded-lg border border-line bg-surface p-3 text-left transition-colors duration-150 hover:border-brand"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="num text-xs text-ink-muted">{q.number}</span>
                  <Money paise={q.totalPaise} fractionDigits={0} />
                </div>
                <div className="mt-1 truncate">{q.buyerName}</div>
                <div className="mt-1 text-xs text-ink-muted">
                  {g.column === 'closed' && q.lostReason ? q.lostReason : <>Valid until <span className="num">{formatDate(q.validUntil)}</span></>}
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProformasPage({ initialStatus }: { initialStatus: Status }) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [dates, setDates] = useState<DateRangeValue>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [view, setView] = useState<'list' | 'board'>('list');
  const saveCsv = useCsvExport();
  const sort = useSort<'date' | 'number' | 'customer' | 'valid' | 'total'>('date', 'desc');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  const proformas = useQuery(() => api.proformasList({ search: debounced, status: view === 'board' ? 'all' : status, from: dates.from, to: dates.to }), [debounced, status, view, dates.from, dates.to]);
  const any = useQuery(() => api.proformasList());
  const list = proformas.data;
  const none = any.data?.length === 0;
  const sorted = useMemo(() => {
    const rows = list ?? [];
    if (sort.key === 'number') return sortBy(rows, (p) => p.number, sort.dir);
    if (sort.key === 'customer') return sortBy(rows, (p) => p.buyerName, sort.dir);
    if (sort.key === 'valid') return sortBy(rows, (p) => p.validUntil, sort.dir);
    if (sort.key === 'total') return sortBy(rows, (p) => p.totalPaise, sort.dir);
    return sortBy(rows, (p) => p.issueDate + p.number, sort.dir);
  }, [list, sort.key, sort.dir]);
  const pager = usePager(sorted);
  useEffect(() => pager.setPage(0), [debounced, status, dates.from, dates.to, sort.key, sort.dir]); // eslint-disable-line react-hooks/exhaustive-deps
  const toExport = selected.size > 0 ? sorted.filter((p) => selected.has(p.id)) : sorted;
  const pageAllSelected = pager.pageItems.length > 0 && pager.pageItems.every((p) => selected.has(p.id));
  const toggleOne = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const togglePage = () =>
    setSelected((s) => {
      const next = new Set(s);
      for (const p of pager.pageItems) {
        if (pageAllSelected) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });

  const newButton = (
    <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => navigate(paths.newProforma())}>
      New proforma
    </Button>
  );

  return (
    <>
      <PageHeader title="Proformas" subtitle="Quotes you've sent. Turn one into an invoice when the customer says yes." actions={
          <>
            {!none && (
              <Button icon={<Download className="h-4 w-4" />} disabled={toExport.length === 0} onClick={() => void saveCsv(`proformas-${todayIso()}.csv`, proformasCsv(toExport), 'Proformas saved')}>
                {selected.size > 0 ? `Export ${selected.size} selected` : 'Export CSV'}
              </Button>
            )}
            {newButton}
          </>
        }
      />
      {proformas.error && <ErrorNote>{proformas.error}</ErrorNote>}

      {none ? (
        <Card>
          <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="No proformas yet" body="A proforma is a quote you can send before the sale. It takes nothing off your shelves — until you turn it into an invoice." actions={newButton} />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between gap-4">
            <SearchInput value={search} onChange={setSearch} placeholder="Search proforma number or customer" />
            <div className="flex flex-wrap items-center justify-end gap-3">
            <DateRangeFilter onChange={setDates} />
            <Segmented
              label="View"
              value={view}
              onChange={setView}
              options={[
                { value: 'list', label: 'List' },
                { value: 'board', label: 'Board' },
              ]}
            />
            {view === 'list' && (
            <Segmented
              label="Proforma status"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: 'All' },
                { value: 'open', label: 'Open' },
                { value: 'expired', label: 'Expired' },
                { value: 'partial', label: 'Part' },
                { value: 'converted', label: 'Invoiced' },
                { value: 'lost', label: 'Lost' },
                { value: 'cancelled', label: 'Cancelled' },
              ]}
            />
            )}
            </div>
          </div>

          {view === 'board' ? (
            <Board quotes={(view === 'board' ? proformas.data : undefined) ?? []} loading={proformas.loading} />
          ) : (
          <Card className="overflow-x-auto">
            {proformas.loading ? (
              <TableSkeleton />
            ) : list?.length === 0 ? (
              <EmptyState icon={<SearchX className="h-6 w-6" />} title="No proformas match" body="Try a different search or filter." actions={<Button onClick={() => { setSearch(''); setStatus('all'); }}>Clear filters</Button>} />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className="w-10 pl-4">
                      <input type="checkbox" checked={pageAllSelected} onChange={togglePage} aria-label="Select all proformas on this page" className="h-4 w-4 accent-[#0F6E56]" />
                    </th>
                    <SortableTh label="Proforma" active={sort.key === 'number'} dir={sort.dir} onSort={() => sort.toggle('number')} />
                    <SortableTh label="Date" active={sort.key === 'date'} dir={sort.dir} onSort={() => sort.toggle('date', 'desc')} />
                    <SortableTh label="Customer" active={sort.key === 'customer'} dir={sort.dir} onSort={() => sort.toggle('customer')} />
                    <th className="th">Type</th>
                    <SortableTh label="Valid until" active={sort.key === 'valid'} dir={sort.dir} onSort={() => sort.toggle('valid', 'desc')} />
                    <SortableTh label="Total" right active={sort.key === 'total'} dir={sort.dir} onSort={() => sort.toggle('total', 'desc')} />
                    <th className="th">Status</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {pager.pageItems.map((p) => (
                    <tr
                      key={p.id}
                      tabIndex={0}
                      onClick={() => navigate(paths.proforma(p.id))}
                      onKeyDown={(e) => e.key === 'Enter' && navigate(paths.proforma(p.id))}
                      className="animate-fade-in group cursor-pointer border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas focus-visible:bg-canvas"
                    >
                      <td className="w-10 pl-4" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} aria-label={`Select ${p.number}`} className="h-4 w-4 accent-[#0F6E56]" />
                      </td>
                      <td className="td num whitespace-nowrap">{p.number}</td>
                      <td className="td num whitespace-nowrap text-ink-muted">{formatDate(p.issueDate)}</td>
                      <td className="td">{p.buyerName}</td>
                      <td className="td">
                        <TypePill type={p.type} />
                      </td>
                      <td className="td num whitespace-nowrap text-ink-muted">{formatDate(p.validUntil)}</td>
                      <td className="td text-right">
                        <Money paise={p.totalPaise} className={p.status === 'cancelled' ? 'text-ink-muted line-through' : ''} />
                      </td>
                      <td className="td">
                        <ProformaPill status={p.status} />
                        {p.invoiceNumber && <div className="num mt-0.5 text-xs text-ink-muted">{p.invoiceNumber}</div>}
                      </td>
                      <td className="td text-ink-muted/50 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink-muted">
                        <ChevronRight className="h-4 w-4" aria-hidden />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          )}
          {view === 'list' && list && list.length > 0 && <Pager pager={pager} noun="proforma" />}
        </>
      )}
    </>
  );
}
