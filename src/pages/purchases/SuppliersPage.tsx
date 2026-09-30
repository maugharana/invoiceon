import { ChevronRight, Plus, SearchX, Truck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, ErrorNote, Money, SearchInput, TableSkeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { plural } from '../../lib/format';
import { navigate, paths } from '../../lib/router';
import { PurchasesShell } from './PurchasesShell';
import { SupplierFormModal } from './SupplierFormModal';

export function SuppliersPage() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  const suppliers = useQuery(() => api.suppliersList({ search: debounced }), [debounced]);
  const everyone = useQuery(() => api.suppliersList());
  const list = suppliers.data;
  const none = everyone.data?.length === 0;
  const add = (
    <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
      Add supplier
    </Button>
  );

  return (
    <PurchasesShell tab="suppliers" actions={add}>
      {suppliers.error && <ErrorNote>{suppliers.error}</ErrorNote>}
      {none ? (
        <Card>
          <EmptyState icon={<Truck className="h-6 w-6" />} title="No suppliers yet" body="Add the people and businesses you buy yarn, zari or finished sarees from. Their bills, and what you owe them, build up here." actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add supplier</Button>} />
        </Card>
      ) : (
        <>
          <div className="mb-4">
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, phone, GSTIN or city" />
          </div>
          <Card className="overflow-x-auto">
            {suppliers.loading ? (
              <TableSkeleton />
            ) : list?.length === 0 ? (
              <EmptyState icon={<SearchX className="h-6 w-6" />} title="No suppliers match" body={`Nothing found for "${debounced}".`} actions={<Button onClick={() => setSearch('')}>Clear search</Button>} />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className="th">Supplier</th>
                    <th className="th">Location</th>
                    <th className="th text-right">Bills</th>
                    <th className="th text-right">You owe</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {list?.map((s) => (
                    <tr key={s.id} tabIndex={0} onClick={() => navigate(paths.supplier(s.id))} onKeyDown={(e) => e.key === 'Enter' && navigate(paths.supplier(s.id))} className="animate-fade-in group cursor-pointer border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas focus-visible:bg-canvas">
                      <td className="td">
                        {s.name}
                        <div className="text-xs text-ink-muted">{[s.phone, s.gstin].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="td text-ink-muted">{[s.city, s.state].filter(Boolean).join(', ') || '-'}</td>
                      <td className="td num text-right">{s.billCount}</td>
                      <td className="td text-right">
                        {s.outstandingPaise > 0 ? <Money paise={s.outstandingPaise} /> : s.advancePaise > 0 ? <span className="text-status-partial-fg"><Money paise={s.advancePaise} /> advance</span> : <span className="text-ink-muted/50">-</span>}
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
          {list && list.length > 0 && <p className="mt-3 text-xs text-ink-muted">Showing {plural(list.length, 'supplier')}</p>}
        </>
      )}
      {adding && <SupplierFormModal onClose={() => setAdding(false)} onSaved={(s) => { setAdding(false); navigate(paths.supplier(s.id)); }} />}
    </PurchasesShell>
  );
}
