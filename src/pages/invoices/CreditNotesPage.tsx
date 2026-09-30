import { ArrowLeft, Ban, ChevronRight, Download, FileMinus2, Printer, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatDate } from '../../../shared/gst';
import { CREDIT_NOTE_KIND_LABEL } from '../../../shared/types';
import { CreditNoteDocument } from '../../components/CreditNoteDocument';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, EmptyState, ErrorNote, Field, Figure, Input, Money, PageHeader, Pill, SearchInput, Spinner, TableSkeleton } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { plural } from '../../lib/format';
import { navigate, paths } from '../../lib/router';

const back = (
  <a href={`#${paths.invoices()}`} className="inline-flex items-center gap-1.5 rounded-lg text-ink-muted transition-colors hover:text-ink">
    <ArrowLeft className="h-4 w-4" aria-hidden /> Invoices
  </a>
);

export function CreditNotesPage() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  const notes = useQuery(() => api.creditNotesList({ search: debounced }), [debounced]);
  const any = useQuery(() => api.creditNotesList());
  const list = notes.data;

  return (
    <>
      <PageHeader title="Credit notes" subtitle="Sales returns and price adjustments against issued invoices." back={back} />
      {notes.error && <ErrorNote>{notes.error}</ErrorNote>}
      {any.data?.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileMinus2 className="h-6 w-6" />}
            title="No credit notes yet"
            body="When a customer returns a saree, or you agree to take something off the price, open the invoice and choose Credit note. The stock, the customer's balance and your GST return all follow."
            actions={<Button onClick={() => navigate(paths.invoices())}>Go to invoices</Button>}
          />
        </Card>
      ) : (
        <>
          <div className="mb-4">
            <SearchInput value={search} onChange={setSearch} placeholder="Search credit note, invoice or customer" />
          </div>
          <Card className="overflow-x-auto">
            {notes.loading ? (
              <TableSkeleton />
            ) : list?.length === 0 ? (
              <EmptyState icon={<SearchX className="h-6 w-6" />} title="No credit notes match" body="Try a different search." actions={<Button onClick={() => setSearch('')}>Clear search</Button>} />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className="th">Credit note</th>
                    <th className="th">Date</th>
                    <th className="th">Invoice</th>
                    <th className="th">Customer</th>
                    <th className="th">Kind</th>
                    <th className="th text-right">Total</th>
                    <th className="th text-right">Refunded</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {list?.map((n) => (
                    <tr
                      key={n.id}
                      tabIndex={0}
                      onClick={() => navigate(paths.creditNote(n.id))}
                      onKeyDown={(e) => e.key === 'Enter' && navigate(paths.creditNote(n.id))}
                      className="animate-fade-in group cursor-pointer border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas focus-visible:bg-canvas"
                    >
                      <td className="td num whitespace-nowrap">
                        {n.number} {n.status === 'cancelled' && <Pill tone="neutral">Cancelled</Pill>}
                      </td>
                      <td className="td num whitespace-nowrap text-ink-muted">{formatDate(n.issueDate)}</td>
                      <td className="td num whitespace-nowrap text-ink-muted">{n.invoiceNumber}</td>
                      <td className="td">{n.buyerName}</td>
                      <td className="td text-ink-muted">{CREDIT_NOTE_KIND_LABEL[n.kind]}</td>
                      <td className="td text-right">
                        <Money paise={n.totalPaise} className={n.status === 'cancelled' ? 'text-ink-muted line-through' : ''} />
                      </td>
                      <td className="td text-right">{n.refundPaise ? <Money paise={n.refundPaise} /> : <span className="text-ink-muted/50">-</span>}</td>
                      <td className="td text-ink-muted/50 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink-muted">
                        <ChevronRight className="h-4 w-4" aria-hidden />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          {list && list.length > 0 && <p className="mt-3 text-xs text-ink-muted">Showing {plural(list.length, 'credit note')}</p>}
        </>
      )}
    </>
  );
}

export function CreditNotePage({ id }: { id: string }) {
  const toast = useToast();
  const refresh = useRefresh();
  const query = useQuery(() => api.creditNoteGet(id), [id]);
  const n = query.data;
  const [busy, setBusy] = useState<'pdf' | 'print' | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  const listBack = (
    <a href={`#${paths.creditNotes}`} className="inline-flex items-center gap-1.5 rounded-lg text-ink-muted transition-colors hover:text-ink">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Credit notes
    </a>
  );
  if (query.error && !n) {
    return (
      <>
        <PageHeader title="Credit note not found" back={listBack} />
        <ErrorNote>{query.error}</ErrorNote>
      </>
    );
  }
  if (!n) {
    return (
      <>
        <PageHeader title="" back={listBack} />
        <Spinner />
      </>
    );
  }

  const cancelled = n.status === 'cancelled';
  async function run(kind: 'pdf' | 'print', work: () => Promise<unknown>) {
    setBusy(kind);
    try {
      await work();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }
  const openPrintView = () => {
    window.open(`${location.origin}${location.pathname}#/print/credit-note/${encodeURIComponent(id)}`, '_blank');
    toast.info('Opened in a new tab. Click "Save as PDF / Print" there, then choose "Save as PDF".');
  };

  return (
    <>
      <PageHeader
        back={listBack}
        title={
          <span className="flex items-center gap-3">
            <span className="num">{n.number}</span>
            <Pill tone={cancelled ? 'neutral' : 'b2b'}>{cancelled ? 'Cancelled' : CREDIT_NOTE_KIND_LABEL[n.kind]}</Pill>
          </span>
        }
        subtitle={
          <>
            Against{' '}
            <a href={`#${paths.invoice(n.invoiceId)}`} className="num transition-colors hover:text-brand">
              {n.invoiceNumber}
            </a>{' '}
            for {n.customerId ? <a href={`#${paths.customer(n.customerId)}`} className="transition-colors hover:text-brand">{n.buyerName}</a> : n.buyerName}
          </>
        }
        actions={
          <>
            <Button icon={<Download className="h-4 w-4" />} loading={busy === 'pdf'} disabled={busy !== null} onClick={() => (window.invoiceon ? void run('pdf', async () => ((await api.creditNoteExportPdf(id)).saved ? toast.success('PDF saved') : undefined)) : openPrintView())}>
              Save PDF
            </Button>
            <Button icon={<Printer className="h-4 w-4" />} loading={busy === 'print'} disabled={busy !== null} onClick={() => (window.invoiceon ? void run('print', () => api.creditNotePrint(id)) : openPrintView())}>
              Print
            </Button>
            {!cancelled && (
              <Button variant="danger" icon={<Ban className="h-4 w-4" />} onClick={() => setCancelling(true)}>
                Cancel
              </Button>
            )}
          </>
        }
      />

      {!cancelled && (
        <Card className="mb-6 p-6">
          <div className="grid grid-cols-4 gap-8">
            <Figure label="Credit note total">
              <Money paise={n.totalPaise} fractionDigits={0} />
            </Figure>
            <Figure label="Off the invoice">
              <Money paise={n.appliedToInvoicePaise} fractionDigits={0} />
            </Figure>
            <Figure label="Held as credit" highlight={n.heldAsCreditPaise > 0} sub={n.heldAsCreditPaise > 0 ? 'Used on their next invoice' : undefined}>
              <Money paise={n.heldAsCreditPaise} fractionDigits={0} />
            </Figure>
            <Figure label="Refunded">
              <Money paise={n.refundPaise} fractionDigits={0} />
            </Figure>
          </div>
        </Card>
      )}

      <div className="overflow-x-auto pb-8">
        <div className="mx-auto w-max rounded-lg border border-line shadow-overlay">
          <CreditNoteDocument note={n} />
        </div>
      </div>

      {cancelling && (
        <ConfirmDialog
          title={`Cancel ${n.number}?`}
          confirmLabel="Cancel credit note"
          danger
          body={
            <div className="space-y-4">
              <p>
                {n.lines.some((l) => l.restock && l.variantId) ? 'The returned pieces come off the shelf again, and ' : ''}the invoice owes the money again. The credit note keeps its number and stays on record.
              </p>
              <Field label="Reason">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional, e.g. entered by mistake" data-autofocus />
              </Field>
            </div>
          }
          onClose={() => setCancelling(false)}
          onConfirm={async () => {
            await api.creditNoteCancel(n.id, reason);
            refresh();
            toast.success(`${n.number} cancelled`);
          }}
        />
      )}
    </>
  );
}
