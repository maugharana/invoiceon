import { ChevronRight, FileMinus2, FileText, Plus, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatDate } from '../../../shared/gst';
import { Button, Card, EmptyState, ErrorNote, InvoicePill, Money, PageHeader, SearchInput, Segmented, TableSkeleton, TypePill } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { plural } from '../../lib/format';
import { navigate, paths } from '../../lib/router';

type Status = 'all' | 'open' | 'overdue' | 'cancelled';
type Type = 'all' | 'B2B' | 'B2C';

export function InvoicesPage({ initialStatus }: { initialStatus: Status }) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [type, setType] = useState<Type>('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  const invoices = useQuery(() => api.invoicesList({ search: debounced, status, type }), [debounced, status, type]);
  const anyInvoices = useQuery(() => api.invoicesList());
  const list = invoices.data;
  const none = anyInvoices.data?.length === 0;

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="Every invoice you've issued, newest first."
        actions={
          <Button icon={<FileMinus2 className="h-4 w-4" />} onClick={() => navigate(paths.creditNotes)}>
            Credit notes
          </Button>
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
          <div className="mb-4 flex items-center justify-between gap-4">
            <SearchInput value={search} onChange={setSearch} placeholder="Search invoice number or customer" />
            <div className="flex items-center gap-3">
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
            </div>
          </div>

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
                    <th className="th">Invoice</th>
                    <th className="th">Date</th>
                    <th className="th">Customer</th>
                    <th className="th">Type</th>
                    <th className="th text-right">Total</th>
                    <th className="th">Status</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {list?.map((i) => (
                    <tr
                      key={i.id}
                      tabIndex={0}
                      onClick={() => navigate(paths.invoice(i.id))}
                      onKeyDown={(e) => e.key === 'Enter' && navigate(paths.invoice(i.id))}
                      className="animate-fade-in group cursor-pointer border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas focus-visible:bg-canvas"
                    >
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
          {list && list.length > 0 && <p className="mt-3 text-xs text-ink-muted">Showing {plural(list.length, 'invoice')}</p>}
        </>
      )}
    </>
  );
}
