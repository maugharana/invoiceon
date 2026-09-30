import { ChevronRight, Plus, SearchX, Truck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatDate } from '../../../shared/gst';
import { Button, Card, EmptyState, ErrorNote, Figure, InvoicePill, Money, SearchInput, Segmented, TableSkeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { plural } from '../../lib/format';
import { navigate, paths } from '../../lib/router';
import { PurchasesShell } from './PurchasesShell';

type Status = 'all' | 'open' | 'overdue' | 'cancelled';

export function PurchasesPage({ initialStatus }: { initialStatus: Status }) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  const bills = useQuery(() => api.purchaseBillsList({ search: debounced, status }), [debounced, status]);
  const anyBills = useQuery(() => api.purchaseBillsList());
  const summary = useQuery(() => api.purchasesSummary());
  const list = bills.data;
  const none = anyBills.data?.length === 0;
  const sm = summary.data;

  const newBill = (
    <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => navigate(paths.newBill())}>
      Enter a bill
    </Button>
  );

  return (
    <PurchasesShell tab="bills" actions={newBill}>
      {bills.error && <ErrorNote>{bills.error}</ErrorNote>}
      {none ? (
        <Card>
          <EmptyState icon={<Truck className="h-6 w-6" />} title="No purchase bills yet" body="Enter what you buy from suppliers. Sarees you buy come into stock, you always know what you owe, and the GST you paid is set off in your GST report." actions={newBill} />
        </Card>
      ) : (
        <>
          <div className="mb-8 grid grid-cols-3 gap-6">
            <Figure label="You owe suppliers" sub={sm ? plural(sm.openBills, 'open bill') : ' '} highlight>
              <Money paise={sm?.outstandingPaise ?? 0} fractionDigits={0} />
            </Figure>
            <Figure label="Overdue" sub="Past their due date">
              <Money paise={sm?.overduePaise ?? 0} fractionDigits={0} />
            </Figure>
            <Figure label="Bought this month" sub={sm ? plural(sm.monthBills, 'bill') : ' '}>
              <Money paise={sm?.monthBilledPaise ?? 0} fractionDigits={0} />
            </Figure>
          </div>

          <div className="mb-4 flex items-center justify-between gap-4">
            <SearchInput value={search} onChange={setSearch} placeholder="Search bill number or supplier" />
            <Segmented
              label="Bill status"
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
          <Card className="overflow-x-auto">
            {bills.loading ? (
              <TableSkeleton />
            ) : list?.length === 0 ? (
              <EmptyState icon={<SearchX className="h-6 w-6" />} title="No bills match" body="Try a different search or filter." actions={<Button onClick={() => { setSearch(''); setStatus('all'); }}>Clear filters</Button>} />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className="th">Bill</th>
                    <th className="th">Date</th>
                    <th className="th">Supplier</th>
                    <th className="th text-right">Total</th>
                    <th className="th text-right">Balance</th>
                    <th className="th">Status</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {list?.map((b) => (
                    <tr key={b.id} tabIndex={0} onClick={() => navigate(paths.bill(b.id))} onKeyDown={(e) => e.key === 'Enter' && navigate(paths.bill(b.id))} className="animate-fade-in group cursor-pointer border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas focus-visible:bg-canvas">
                      <td className="td num whitespace-nowrap">{b.billNumber}</td>
                      <td className="td num whitespace-nowrap text-ink-muted">{formatDate(b.billDate)}</td>
                      <td className="td">{b.supplierName}</td>
                      <td className="td text-right"><Money paise={b.totalPaise} className={b.status === 'cancelled' ? 'text-ink-muted line-through' : ''} /></td>
                      <td className="td text-right">{b.status === 'cancelled' ? <span className="text-ink-muted/50">-</span> : <Money paise={b.totalPaise - b.paidPaise} />}</td>
                      <td className="td"><InvoicePill status={b.status} /></td>
                      <td className="td text-ink-muted/50 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink-muted"><ChevronRight className="h-4 w-4" aria-hidden /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          {list && list.length > 0 && <p className="mt-3 text-xs text-ink-muted">Showing {plural(list.length, 'bill')}</p>}
        </>
      )}
    </PurchasesShell>
  );
}
