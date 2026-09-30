import { ChevronRight, Plus, SearchX, Upload, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, ErrorNote, Money, PageHeader, SearchInput, TableSkeleton, TypePill } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { plural } from '../../lib/format';
import { navigate, paths } from '../../lib/router';
import { CustomerFormModal } from './CustomerFormModal';

export function CustomersPage() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  const customers = useQuery(() => api.customersList({ search: debounced }), [debounced]);
  const everyone = useQuery(() => api.customersList());
  const list = customers.data;
  const none = everyone.data?.length === 0;

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Everyone you sell to, with what you've billed them."
        actions={
          <>
            <Button icon={<Upload className="h-4 w-4" />} onClick={() => navigate(paths.importCustomers)}>
              Import
            </Button>
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
              <>
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
                  Add customer
                </Button>
                <Button icon={<Upload className="h-4 w-4" />} onClick={() => navigate(paths.importCustomers)}>
                  Import from a spreadsheet
                </Button>
              </>
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-4">
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, phone, GSTIN or city" />
          </div>
          <Card className="overflow-x-auto">
            {customers.loading ? (
              <TableSkeleton />
            ) : list?.length === 0 ? (
              <EmptyState icon={<SearchX className="h-6 w-6" />} title="No customers match" body={`Nothing found for “${debounced}”.`} actions={<Button onClick={() => setSearch('')}>Clear search</Button>} />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className="th">Customer</th>
                    <th className="th">Type</th>
                    <th className="th">Location</th>
                    <th className="th">GSTIN</th>
                    <th className="th text-right">Invoices</th>
                    <th className="th text-right">Billed</th>
                    <th className="th text-right">Balance</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {list?.map((c) => (
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
          {list && list.length > 0 && <p className="mt-3 text-xs text-ink-muted">Showing {plural(list.length, 'customer')}</p>}
        </>
      )}

      {adding && <CustomerFormModal onClose={() => setAdding(false)} onSaved={(c) => navigate(paths.customer(c.id))} />}
    </>
  );
}
