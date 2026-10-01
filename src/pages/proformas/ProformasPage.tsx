import { ChevronRight, ClipboardList, Download, Plus, SearchX } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { proformasCsv } from '../../../shared/csv';
import { formatDate, todayIso } from '../../../shared/gst';
import type { ProformaStatus } from '../../../shared/types';
import { Button, Card, EmptyState, ErrorNote, Money, PageHeader, ProformaPill, SearchInput, Segmented, TableSkeleton, TypePill } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { DateRangeFilter, Pager, SortableTh, sortBy, usePager, useSort, type DateRangeValue } from '../../components/listTools';
import { useCsvExport } from '../../lib/exportCsv';
import { navigate, paths } from '../../lib/router';

type Status = 'all' | ProformaStatus;

export function ProformasPage({ initialStatus }: { initialStatus: Status }) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [dates, setDates] = useState<DateRangeValue>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const saveCsv = useCsvExport();
  const sort = useSort<'date' | 'number' | 'customer' | 'valid' | 'total'>('date', 'desc');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  const proformas = useQuery(() => api.proformasList({ search: debounced, status, from: dates.from, to: dates.to }), [debounced, status, dates.from, dates.to]);
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
              label="Proforma status"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: 'All' },
                { value: 'open', label: 'Open' },
                { value: 'expired', label: 'Expired' },
                { value: 'converted', label: 'Invoiced' },
                { value: 'cancelled', label: 'Cancelled' },
              ]}
            />
            </div>
          </div>

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
          {list && list.length > 0 && <Pager pager={pager} noun="proforma" />}
        </>
      )}
    </>
  );
}
