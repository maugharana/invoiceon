import { ChevronRight, FileMinus2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatDate } from '../../../shared/gst';
import { Button, Card, EmptyState, ErrorNote, Money, PageHeader, Pill, SearchInput, Segmented, TableSkeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { navigate, paths } from '../../lib/router';

/** Every credit note, newest first. They are made from an invoice, with Take goods back. */
export function CreditNotesPage() {
  const [status, setStatus] = useState<'issued' | 'all'>('issued');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 150);
    return () => clearTimeout(t);
  }, [search]);
  const notes = useQuery(() => api.creditNotesList({ search: debounced, status: status === 'issued' ? 'issued' : undefined }), [debounced, status]);
  const anyNotes = useQuery(() => api.creditNotesList());
  const list = notes.data ?? [];

  return (
    <>
      <PageHeader
        back={
          <a href={`#${paths.invoices()}`} className="inline-flex items-center gap-1.5 rounded-lg text-ink-muted transition-colors hover:text-ink">
            Invoices
          </a>
        }
        title="Credit notes"
        subtitle="Goods taken back from an invoice. To make one, open the invoice and choose Take goods back."
        actions={<Button onClick={() => navigate(paths.invoices())}>Go to invoices</Button>}
      />
      {notes.error && <ErrorNote>{notes.error}</ErrorNote>}
      {(anyNotes.data ?? []).length === 0 && !anyNotes.loading ? (
        <Card>
          <EmptyState icon={<FileMinus2 className="h-6 w-6" />} title="No credit notes yet" body="When a customer returns a saree, open its invoice and choose Take goods back. A credit note with its own number and GST is made, the piece goes back into stock, and the money is settled: taken off what they owe, refunded, or kept as credit." />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between gap-4">
            <SearchInput value={search} onChange={setSearch} placeholder="Search credit note, invoice or customer" />
            <Segmented
              label="Show"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'issued', label: 'Standing' },
                { value: 'all', label: 'All' },
              ]}
            />
          </div>
          <Card className="overflow-hidden">
            {notes.loading ? (
              <TableSkeleton rows={5} columns={6} />
            ) : list.length === 0 ? (
              <EmptyState icon={<FileMinus2 className="h-6 w-6" />} title="Nothing here" body="No credit notes match." />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className="th">Credit note</th>
                    <th className="th">Date</th>
                    <th className="th">Invoice</th>
                    <th className="th">Customer</th>
                    <th className="th">Reason</th>
                    <th className="th text-right">Credited</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((n) => (
                    <tr key={n.id} tabIndex={0} onClick={() => navigate(paths.creditNote(n.id))} onKeyDown={(e) => e.key === 'Enter' && navigate(paths.creditNote(n.id))} className="animate-fade-in group cursor-pointer border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas focus-visible:bg-canvas">
                      <td className="td num whitespace-nowrap">
                        {n.number}
                        {n.status === 'cancelled' && (
                          <span className="ml-2">
                            <Pill tone="neutral">Cancelled</Pill>
                          </span>
                        )}
                      </td>
                      <td className="td num whitespace-nowrap text-ink-muted">{formatDate(n.issueDate)}</td>
                      <td className="td num whitespace-nowrap">{n.invoiceNumber}</td>
                      <td className="td">{n.buyerName}</td>
                      <td className="td text-ink-muted">{n.reason}</td>
                      <td className="td text-right">
                        <Money paise={n.totalPaise} className={n.status === 'cancelled' ? 'text-ink-muted line-through' : ''} />
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
    </>
  );
}
