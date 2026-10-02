import { ChevronRight, PackageOpen, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatDate } from '../../../shared/gst';
import { WEAVER_ORDER_STATUS_LABEL, type WeaverOrderStatus, type WeaverOrderSummary } from '../../../shared/types';
import { Button, Card, EmptyState, ErrorNote, Money, Pill, SearchInput, Segmented, TableSkeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { plural } from '../../lib/format';
import { navigate, paths } from '../../lib/router';
import { InventoryShell } from './InventoryTabs';

type Filter = 'open' | 'received' | 'all';

export const WEAVER_STATUS_TONE: Record<WeaverOrderStatus, 'partial' | 'paid' | 'neutral'> = { open: 'partial', partial: 'partial', received: 'paid', cancelled: 'neutral' };

/** What is owed to the weaver on an order, in words. */
export function weaverBalanceText(o: Pick<WeaverOrderSummary, 'totalPaise' | 'paidPaise' | 'status'>): string {
  if (o.status === 'cancelled') return '';
  if (o.totalPaise <= 0) return 'No price yet';
  if (o.paidPaise >= o.totalPaise) return 'Paid in full';
  return o.paidPaise > 0 ? 'Part paid' : 'Not paid';
}

/** Orders placed with weavers for sarees you don't have yet: what is still to come, and what is owed. */
export function WeaverOrdersPage() {
  const [filter, setFilter] = useState<Filter>('open');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  const orders = useQuery(() => api.weaverOrdersList({ search: debounced, status: filter === 'all' ? undefined : filter }), [debounced, filter]);
  const everything = useQuery(() => api.weaverOrdersList());
  const list = orders.data;
  const open = (everything.data ?? []).filter((o) => o.status === 'open' || o.status === 'partial');
  const toCome = open.reduce((s, o) => s + (o.pieces - o.receivedPieces), 0);
  const owed = open.reduce((s, o) => s + Math.max(0, o.totalPaise - o.paidPaise), 0);
  const late = open.filter((o) => o.late).length;
  const none = (everything.data ?? []).length === 0;

  return (
    <InventoryShell
      tab="weaver"
      actions={
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => navigate(paths.newWeaverOrder())}>
          New weaver order
        </Button>
      }
    >
      {!none && (
        <div className="mb-6 grid grid-cols-3 gap-6">
          <div>
            <div className="text-xs text-ink-muted">Pieces still to come</div>
            <div className="num text-2xl">{toCome}</div>
            <div className="text-xs text-ink-muted">{plural(open.length, 'open order')}</div>
          </div>
          <div>
            <div className="text-xs text-ink-muted">Still to pay weavers</div>
            <div className="text-2xl">
              <Money paise={owed} fractionDigits={0} />
            </div>
            <div className="text-xs text-ink-muted">On open orders</div>
          </div>
          <div>
            <div className="text-xs text-ink-muted">Late</div>
            <div className={`num text-2xl ${late > 0 ? 'text-status-overdue-fg' : ''}`}>{late}</div>
            <div className="text-xs text-ink-muted">Past the expected day</div>
          </div>
        </div>
      )}

      {orders.error && <ErrorNote>{orders.error}</ErrorNote>}

      {none ? (
        <Card>
          <EmptyState
            icon={<PackageOpen className="h-6 w-6" />}
            title="No weaver orders yet"
            body="When a customer wants a saree you don't have, order it from the weaver here. Mark it received when it arrives and it goes into stock, ready to invoice. Track what you have paid and what is left."
            actions={
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => navigate(paths.newWeaverOrder())}>
                New weaver order
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <SearchInput value={search} onChange={setSearch} placeholder="Search order, weaver or quote" />
            <Segmented
              label="Show"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'open', label: 'To come', count: open.length },
                { value: 'received', label: 'Received' },
                { value: 'all', label: 'All' },
              ]}
            />
          </div>
          <Card className="overflow-hidden">
            {orders.loading ? (
              <TableSkeleton rows={5} columns={6} />
            ) : (list ?? []).length === 0 ? (
              <EmptyState icon={<PackageOpen className="h-6 w-6" />} title="Nothing here" body={filter === 'open' ? 'No order is waiting on a weaver.' : 'No orders match.'} />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className="th">Order</th>
                    <th className="th">Weaver</th>
                    <th className="th">Ordered</th>
                    <th className="th">Expected</th>
                    <th className="th text-right">Pieces</th>
                    <th className="th text-right">Amount</th>
                    <th className="th">Status</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {list!.map((o) => (
                    <tr key={o.id} tabIndex={0} onClick={() => navigate(paths.weaverOrder(o.id))} onKeyDown={(e) => e.key === 'Enter' && navigate(paths.weaverOrder(o.id))} className="animate-fade-in group cursor-pointer border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas focus-visible:bg-canvas">
                      <td className="td num whitespace-nowrap">
                        {o.number}
                        {o.proformaNumber && <div className="text-xs text-ink-muted">For {o.proformaNumber}</div>}
                      </td>
                      <td className="td">{o.vendorName}</td>
                      <td className="td num whitespace-nowrap text-ink-muted">{formatDate(o.orderedOn)}</td>
                      <td className={`td num whitespace-nowrap ${o.late ? 'text-status-overdue-fg' : 'text-ink-muted'}`}>{o.expectedOn ? formatDate(o.expectedOn) : 'Not set'}</td>
                      <td className="td num text-right">
                        {o.receivedPieces} / {o.pieces}
                      </td>
                      <td className="td text-right">
                        <Money paise={o.totalPaise} />
                        <div className="text-xs text-ink-muted">{weaverBalanceText(o)}</div>
                      </td>
                      <td className="td">
                        <Pill tone={WEAVER_STATUS_TONE[o.status]}>{WEAVER_ORDER_STATUS_LABEL[o.status]}</Pill>
                        {o.late && <div className="mt-1 text-xs text-status-overdue-fg">Late</div>}
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
        </>
      )}
    </InventoryShell>
  );
}
