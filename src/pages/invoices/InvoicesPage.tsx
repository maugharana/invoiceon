import { ChevronRight, Download, FileText, Notebook, Plus, Printer, SearchX } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { invoicesCsv } from '../../../shared/csv';
import { formatDate, todayIso } from '../../../shared/gst';
import { DateRangeFilter, FilterBar, Pager, SortableTh, sortBy, usePager, useSort, type DateRangeValue } from '../../components/listTools';
import { DELIVERY_STATUS_LABEL, type DeliveryStatus } from '../../../shared/types';
import { Menu } from '../../components/Menu';
import { Button, Card, EmptyState, ErrorNote, InvoicePill, Money, PageHeader, SearchInput, Segmented, Select, TableSkeleton, TypePill } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { useDocumentOutput } from '../../lib/documents';
import { useCsvExport } from '../../lib/exportCsv';
import { navigate, paths } from '../../lib/router';

type Status = 'all' | 'open' | 'overdue' | 'cancelled';
type Type = 'all' | 'B2B' | 'B2C';

export function InvoicesPage({ initialStatus }: { initialStatus: Status }) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [type, setType] = useState<Type>('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [dates, setDates] = useState<DateRangeValue>({});
  const [delivery, setDelivery] = useState<'' | DeliveryStatus>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const saveCsv = useCsvExport();
  const docs = useDocumentOutput();
  const sort = useSort<'date' | 'number' | 'customer' | 'total'>('date', 'desc');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  const invoices = useQuery(() => api.invoicesList({ search: debounced, status, type, from: dates.from, to: dates.to, delivery: delivery || undefined }), [debounced, status, type, dates.from, dates.to, delivery]);
  const anyInvoices = useQuery(() => api.invoicesList());
  const list = invoices.data;
  const sorted = useMemo(() => {
    const rows = list ?? [];
    if (sort.key === 'date') return sortBy(rows, (i) => i.issueDate + String(i.number), sort.dir);
    if (sort.key === 'number') return sortBy(rows, (i) => i.number, sort.dir);
    if (sort.key === 'customer') return sortBy(rows, (i) => i.buyerName, sort.dir);
    return sortBy(rows, (i) => i.totalPaise, sort.dir);
  }, [list, sort.key, sort.dir]);
  const pager = usePager(sorted);
  const toExport = selected.size > 0 ? sorted.filter((i) => selected.has(i.id)) : sorted;
  const pageAllSelected = pager.pageItems.length > 0 && pager.pageItems.every((i) => selected.has(i.id));
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
      for (const i of pager.pageItems) {
        if (pageAllSelected) next.delete(i.id);
        else next.add(i.id);
      }
      return next;
    });
  useEffect(() => pager.setPage(0), [debounced, status, type, dates.from, dates.to, delivery, sort.key, sort.dir]); // eslint-disable-line react-hooks/exhaustive-deps
  const none = anyInvoices.data?.length === 0;

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="Every invoice you've issued, newest first."
        actions={
          !none && (
            <>
              <Button onClick={() => navigate(paths.quickBill)} title="The counter screen: scan, press how they paid">
                Quick bill
              </Button>
              {selected.size > 0 && (
                <>
                  <Button icon={<Download className="h-4 w-4" />} onClick={() => void docs.savePdf(paths.printInvoices([...selected]), () => api.invoicesExportPdf([...selected]))} title="Save the ticked invoices together in one PDF, one per page">
                    PDF of {selected.size}
                  </Button>
                  <Button icon={<Printer className="h-4 w-4" />} onClick={() => void docs.print(paths.printInvoices([...selected]), () => api.invoicesPrint([...selected]))} title="Print the ticked invoices">
                    Print {selected.size}
                  </Button>
                </>
              )}
              <Menu
                label="More"
                items={[
                  { label: 'Credit notes', icon: <Notebook className="h-4 w-4" />, onClick: () => navigate(paths.creditNotes) },
                  {
                    label: selected.size > 0 ? `Export ${selected.size} selected as CSV` : 'Export CSV',
                    icon: <Download className="h-4 w-4" />,
                    disabledReason: toExport.length === 0 ? 'Nothing to export' : undefined,
                    onClick: () => void saveCsv(`invoices-${todayIso()}.csv`, invoicesCsv(toExport), 'Invoices saved'),
                  },
                ]}
              />
            </>
          )
        }
      />
      {invoices.error && <ErrorNote>{invoices.error}</ErrorNote>}

      {none ? (
        <Card>
          <EmptyState
            icon={<FileText className="h-6 w-6" />}
            title="No invoices yet"
            body="Issue your first invoice — stock comes off the shelf automatically, and you can print it or save it as a PDF."
            actions={
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => navigate(paths.newInvoice())}>
                New invoice
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <FilterBar
            search={<SearchInput value={search} onChange={setSearch} placeholder="Search invoice number or customer" />}
            filters={
              <>
                <DateRangeFilter onChange={setDates} />
                <Select value={delivery} onChange={(e) => setDelivery(e.target.value as '' | DeliveryStatus)} className="w-36" aria-label="Delivery">
                  <option value="">Any delivery</option>
                  {(['pending', 'dispatched', 'delivered'] as const).map((d) => (
                    <option key={d} value={d}>
                      {DELIVERY_STATUS_LABEL[d]}
                    </option>
                  ))}
                </Select>
                <Segmented
                  label="Invoice type"
                  value={type}
                  onChange={setType}
                  options={[
                    { value: 'all', label: 'All types' },
                    { value: 'B2B', label: 'B2B' },
                    { value: 'B2C', label: 'B2C' },
                  ]}
                />
              </>
            }
            status={
              <Segmented
                label="Invoice status"
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'open', label: 'Open' },
                  { value: 'overdue', label: 'Overdue' },
                  { value: 'cancelled', label: 'Cancelled' },
                ]}
              />
            }
          />

          <Card className="overflow-x-auto">
            {invoices.loading ? (
              <TableSkeleton />
            ) : list?.length === 0 ? (
              <EmptyState
                icon={<SearchX className="h-6 w-6" />}
                title="No invoices match"
                body="Try a different search or filter."
                actions={
                  <Button
                    onClick={() => {
                      setSearch('');
                      setStatus('all');
                      setType('all');
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
                    <th className="w-10 pl-4">
                      <input type="checkbox" checked={pageAllSelected} onChange={togglePage} aria-label="Select all invoices on this page" className="h-4 w-4 accent-[#0F6E56]" />
                    </th>
                    <SortableTh label="Invoice" active={sort.key === 'number'} dir={sort.dir} onSort={() => sort.toggle('number')} />
                    <SortableTh label="Date" active={sort.key === 'date'} dir={sort.dir} onSort={() => sort.toggle('date', 'desc')} />
                    <SortableTh label="Customer" active={sort.key === 'customer'} dir={sort.dir} onSort={() => sort.toggle('customer')} />
                    <th className="th">Type</th>
                    <SortableTh label="Total" right active={sort.key === 'total'} dir={sort.dir} onSort={() => sort.toggle('total', 'desc')} />
                    <th className="th">Status</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {pager.pageItems.map((i) => (
                    <tr
                      key={i.id}
                      tabIndex={0}
                      onClick={() => navigate(paths.invoice(i.id))}
                      onKeyDown={(e) => e.key === 'Enter' && navigate(paths.invoice(i.id))}
                      className="animate-fade-in group cursor-pointer border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas focus-visible:bg-canvas"
                    >
                      <td className="w-10 pl-4" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggleOne(i.id)} aria-label={`Select ${i.number}`} className="h-4 w-4 accent-[#0F6E56]" />
                      </td>
                      <td className="td num whitespace-nowrap">{i.number}</td>
                      <td className="td num whitespace-nowrap text-ink-muted">{formatDate(i.issueDate)}</td>
                      <td className="td">{i.buyerName}</td>
                      <td className="td">
                        <TypePill type={i.type} />
                      </td>
                      <td className="td text-right">
                        <Money paise={i.totalPaise} className={i.status === 'cancelled' ? 'text-ink-muted line-through' : ''} />
                      </td>
                      <td className="td">
                        <InvoicePill status={i.status} />
                        {i.deliveryStatus !== 'none' && i.status !== 'cancelled' && <div className="mt-1 text-xs text-ink-muted">{DELIVERY_STATUS_LABEL[i.deliveryStatus]}</div>}
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
          {list && list.length > 0 && <Pager pager={pager} noun="invoice" />}
        </>
      )}
    </>
  );
}
