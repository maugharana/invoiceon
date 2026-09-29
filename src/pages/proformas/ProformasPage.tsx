import { ChevronRight, ClipboardList, Plus, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatDate } from '../../../shared/gst';
import type { ProformaStatus } from '../../../shared/types';
import { Button, Card, EmptyState, ErrorNote, Money, PageHeader, ProformaPill, SearchInput, Segmented, TableSkeleton, TypePill } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { plural } from '../../lib/format';
import { navigate, paths } from '../../lib/router';

type Status = 'all' | ProformaStatus;

export function ProformasPage({ initialStatus }: { initialStatus: Status }) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  const proformas = useQuery(() => api.proformasList({ search: debounced, status }), [debounced, status]);
  const any = useQuery(() => api.proformasList());
  const list = proformas.data;
  const none = any.data?.length === 0;

  const newButton = (
    <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => navigate(paths.newProforma())}>
      New proforma
    </Button>
  );

  return (
    <>
      <PageHeader title="Proformas" subtitle="Quotes you've sent. Turn one into an invoice when the customer says yes." actions={newButton} />
      {proformas.error && <ErrorNote>{proformas.error}</ErrorNote>}

      {none ? (
        <Card>
          <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="No proformas yet" body="A proforma is a quote you can send before the sale. It takes nothing off your shelves — until you turn it into an invoice." actions={newButton} />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between gap-4">
            <SearchInput value={search} onChange={setSearch} placeholder="Search proforma number or customer" />
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

          <Card className="overflow-x-auto">
            {proformas.loading ? (
              <TableSkeleton />
            ) : list?.length === 0 ? (
              <EmptyState icon={<SearchX className="h-6 w-6" />} title="No proformas match" body="Try a different search or filter." actions={<Button onClick={() => { setSearch(''); setStatus('all'); }}>Clear filters</Button>} />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className="th">Proforma</th>
                    <th className="th">Date</th>
                    <th className="th">Customer</th>
                    <th className="th">Type</th>
                    <th className="th">Valid until</th>
                    <th className="th text-right">Total</th>
                    <th className="th">Status</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {list?.map((p) => (
                    <tr
                      key={p.id}
                      tabIndex={0}
                      onClick={() => navigate(paths.proforma(p.id))}
                      onKeyDown={(e) => e.key === 'Enter' && navigate(paths.proforma(p.id))}
                      className="animate-fade-in group cursor-pointer border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas focus-visible:bg-canvas"
                    >
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
          {list && list.length > 0 && <p className="mt-3 text-xs text-ink-muted">Showing {plural(list.length, 'proforma')}</p>}
        </>
      )}
    </>
  );
}
