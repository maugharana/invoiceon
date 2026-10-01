import { ChevronRight, Copy, Download, Plus, SearchX, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { customersCsv } from '../../../shared/csv';
import { CUSTOMER_FILTER_LABEL, filterCustomers, findDuplicateGroups, type CustomerFilter } from '../../../shared/customerList';
import { todayIso } from '../../../shared/gst';
import { Pager, SortableTh, sortBy, usePager, useSort } from '../../components/listTools';
import { Button, Card, EmptyState, ErrorNote, Money, PageHeader, SearchInput, Segmented, TableSkeleton, TypePill } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { useCsvExport } from '../../lib/exportCsv';
import { plural } from '../../lib/format';
import { navigate, paths } from '../../lib/router';
import { CustomerFormModal } from './CustomerFormModal';
import { DuplicatesModal } from './DuplicatesModal';

type SortKey = 'name' | 'invoices' | 'billed' | 'balance';

export function CustomersPage() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [adding, setAdding] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [filter, setFilter] = useState<CustomerFilter>('all');
  const sort = useSort<SortKey>('name', 'asc');
  const saveCsv = useCsvExport();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  const customers = useQuery(() => api.customersList({ search: debounced }), [debounced]);
  const everyone = useQuery(() => api.customersList());
  const none = everyone.data?.length === 0;
  const duplicates = useMemo(() => findDuplicateGroups(everyone.data ?? []), [everyone.data]);

  const shown = useMemo(() => {
    const rows = filterCustomers(customers.data ?? [], filter);
    if (sort.key === 'invoices') return sortBy(rows, (c) => c.invoiceCount, sort.dir);
    if (sort.key === 'billed') return sortBy(rows, (c) => c.billedPaise, sort.dir);
    // Balance: what they owe counts as positive, what you hold for them as negative, so "largest first" puts the biggest debtors on top.
    if (sort.key === 'balance') return sortBy(rows, (c) => c.outstandingPaise - c.advancePaise, sort.dir);
    return sortBy(rows, (c) => c.name, sort.dir);
  }, [customers.data, filter, sort.key, sort.dir]);
  const pager = usePager(shown);
  useEffect(() => pager.setPage(0), [debounced, filter, sort.key, sort.dir]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Everyone you sell to, with what you've billed them."
        actions={
          <>
            {!none && (
              <Button icon={<Download className="h-4 w-4" />} disabled={shown.length === 0} onClick={() => void saveCsv(`customers-${todayIso()}.csv`, customersCsv(shown), 'Customers saved')} title="Save the customers shown as a spreadsheet">
                Export CSV
              </Button>
            )}
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
              Add customer
            </Button>
          </>
        }
      />
      {customers.error && <ErrorNote>{customers.error}</ErrorNote>}

      {none ? (
        <Card>
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="No customers yet"
            body="Add the people and businesses you sell to. For a quick walk-in sale you can also invoice without saving a customer."
            actions={
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
                Add customer
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {duplicates.length > 0 && (
            <div className="mb-4 flex items-center justify-between gap-4 rounded-lg bg-status-partial-bg px-4 py-3 text-status-partial-fg">
              <span>
                {plural(duplicates.length, 'group')} of customers look like duplicates (the same phone number or GSTIN).
              </span>
              <Button className="h-8 text-xs" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => setReviewing(true)}>
                Review
              </Button>
            </div>
          )}
          <div className="mb-4 flex items-center justify-between gap-4">
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, phone, GSTIN or city" />
            <Segmented
              label="Customer filter"
              value={filter}
              onChange={setFilter}
              options={(Object.keys(CUSTOMER_FILTER_LABEL) as CustomerFilter[]).map((f) => ({ value: f, label: CUSTOMER_FILTER_LABEL[f] }))}
            />
          </div>
          <Card className="overflow-x-auto">
            {customers.loading ? (
              <TableSkeleton />
            ) : shown.length === 0 ? (
              <EmptyState
                icon={<SearchX className="h-6 w-6" />}
                title="No customers match"
                body={debounced ? `Nothing found for “${debounced}”.` : 'No customer fits that filter.'}
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
                    <SortableTh label="Customer" active={sort.key === 'name'} dir={sort.dir} onSort={() => sort.toggle('name')} />
                    <th className="th">Type</th>
                    <th className="th">Location</th>
                    <th className="th">GSTIN</th>
                    <SortableTh label="Invoices" right active={sort.key === 'invoices'} dir={sort.dir} onSort={() => sort.toggle('invoices', 'desc')} />
                    <SortableTh label="Billed" right active={sort.key === 'billed'} dir={sort.dir} onSort={() => sort.toggle('billed', 'desc')} />
                    <SortableTh label="Balance" right active={sort.key === 'balance'} dir={sort.dir} onSort={() => sort.toggle('balance', 'desc')} />
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {pager.pageItems.map((c) => (
                    <tr
                      key={c.id}
                      tabIndex={0}
                      onClick={() => navigate(paths.customer(c.id))}
                      onKeyDown={(e) => e.key === 'Enter' && navigate(paths.customer(c.id))}
                      className="animate-fade-in group cursor-pointer border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas focus-visible:bg-canvas"
                    >
                      <td className="td">
                        <div>{c.name}</div>
                        {c.phone && <div className="num text-xs text-ink-muted">{c.phone}</div>}
                      </td>
                      <td className="td">
                        <TypePill type={c.type} />
                      </td>
                      <td className="td text-ink-muted">{[c.city, c.state].filter(Boolean).join(', ') || '—'}</td>
                      <td className="td num text-xs text-ink-muted">{c.gstin || '—'}</td>
                      <td className="td num text-right">{c.invoiceCount}</td>
                      <td className="td text-right">{c.invoiceCount ? <Money paise={c.billedPaise} /> : <span className="text-ink-muted">—</span>}</td>
                      <td className="td text-right">
                        {c.outstandingPaise > 0 ? (
                          <>
                            <Money paise={c.outstandingPaise} />
                            <div className="text-xs text-ink-muted">owes</div>
                          </>
                        ) : c.advancePaise > 0 ? (
                          <>
                            <Money paise={c.advancePaise} className="text-status-partial-fg" />
                            <div className="text-xs text-ink-muted">advance</div>
                          </>
                        ) : (
                          <span className="text-ink-muted/50">—</span>
                        )}
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
          {shown.length > 0 && <Pager pager={pager} noun="customer" />}
        </>
      )}

      {adding && <CustomerFormModal onClose={() => setAdding(false)} onSaved={(c) => navigate(paths.customer(c.id))} />}
      {reviewing && <DuplicatesModal customers={everyone.data ?? []} onClose={() => setReviewing(false)} />}
    </>
  );
}
