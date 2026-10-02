import { ArrowLeft, Download, Printer, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { formatDate } from '../../../shared/gst';
import { InvoiceDocument } from '../../components/InvoiceDocument';
import { useToast } from '../../components/Toast';
import { Button, Card, EmptyState, ErrorNote, Money, PageHeader, SearchInput, Spinner, TableSkeleton } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { creditNoteAsInvoice } from '../../lib/creditNote';
import { useQuery } from '../../lib/data';
import { navigate, paths } from '../../lib/router';
import { useRecent } from '../../lib/recent';

/** Every credit note, newest first. A credit note is made from the invoice it reverses, so there is no "new" button here. */
export function CreditNotesPage() {
  const [search, setSearch] = useState('');
  const list = useQuery(() => api.creditNotesList({ search }), [search]);
  const back = (
    <a href={`#${paths.invoices()}`} className="inline-flex items-center gap-1.5 rounded-lg text-ink-muted transition-colors hover:text-ink">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Invoices
    </a>
  );
  return (
    <>
      <PageHeader title="Credit notes" subtitle="Goods taken back and sales corrected. To make one, open the invoice and choose “Take items back”." back={back} />
      {list.error ? (
        <ErrorNote>{list.error}</ErrorNote>
      ) : !list.data ? (
        <TableSkeleton rows={4} columns={5} />
      ) : list.data.length === 0 && !search ? (
        <Card>
          <EmptyState icon={<Undo2 className="h-5 w-5" />} title="No credit notes yet" body="When a customer brings something back, open its invoice and choose “Take items back”. The stock, the GST and the money are all put right in one step." />
        </Card>
      ) : (
        <>
          <div className="mb-4">
            <SearchInput value={search} onChange={setSearch} placeholder="Search credit note, invoice, customer or reason" />
          </div>
          <Card className="overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className="th">Credit note</th>
                  <th className="th">Date</th>
                  <th className="th">Against</th>
                  <th className="th">Customer</th>
                  <th className="th">Reason</th>
                  <th className="th text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((n) => (
                  <tr key={n.id} className="cursor-pointer border-b border-line/70 transition-colors last:border-0 hover:bg-canvas" onClick={() => navigate(paths.creditNote(n.id))}>
                    <td className="td num">{n.number}</td>
                    <td className="td num text-ink-muted">{formatDate(n.issueDate)}</td>
                    <td className="td num text-ink-muted">{n.invoiceNumber}</td>
                    <td className="td">{n.buyerName}</td>
                    <td className="td max-w-[16rem] truncate text-ink-muted">{n.reason}</td>
                    <td className="td text-right">
                      <Money paise={n.totalPaise} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.data.length === 0 && <p className="px-4 py-6 text-center text-ink-muted">No credit notes match.</p>}
          </Card>
        </>
      )}
    </>
  );
}

export function CreditNotePage({ id }: { id: string }) {
  const toast = useToast();
  const query = useQuery(() => api.creditNoteGet(id), [id]);
  const note = query.data;
  useRecent(note ? { kind: 'invoice', id: note.invoiceId, title: note.number, hint: note.buyerName } : null);
  const [busy, setBusy] = useState<'pdf' | 'print' | null>(null);

  const back = (
    <a href={`#${paths.creditNotes}`} className="inline-flex items-center gap-1.5 rounded-lg text-ink-muted transition-colors hover:text-ink">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Credit notes
    </a>
  );
  if (query.error && !note) {
    return (
      <>
        <PageHeader title="Credit note not found" back={back} />
        <ErrorNote>{query.error}</ErrorNote>
      </>
    );
  }
  if (!note) {
    return (
      <>
        <PageHeader title="" back={back} />
        <Spinner />
      </>
    );
  }

  const openPrintView = () => {
    window.open(`${location.origin}${location.pathname}#${paths.printCreditNote(id)}`, '_blank');
    toast.info('Opened in a new tab — click “Save as PDF / Print” there, then choose “Save as PDF”.');
  };
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
  const exportPdf = () => (window.invoiceon ? run('pdf', async () => ((await api.creditNoteExportPdf(id)).saved ? toast.success('PDF saved') : undefined)) : openPrintView());
  const print = () => (window.invoiceon ? run('print', () => api.creditNotePrint(id)) : openPrintView());
  const restocked = note.lines.filter((l) => l.restocked).reduce((s, l) => s + l.qty, 0);
  const notRestocked = note.lines.filter((l) => !l.restocked).reduce((s, l) => s + l.qty, 0);

  return (
    <>
      <PageHeader
        back={back}
        title={<span className="num">{note.number}</span>}
        subtitle={
          <>
            Against <a className="num transition-colors hover:text-brand" href={`#${paths.invoice(note.invoiceId)}`}>{note.invoiceNumber}</a> · {note.customerId ? <a href={`#${paths.customer(note.customerId)}`} className="transition-colors hover:text-brand">{note.buyerName}</a> : note.buyerName}
          </>
        }
        actions={
          <>
            <Button icon={<Download className="h-4 w-4" />} loading={busy === 'pdf'} disabled={busy !== null} onClick={() => void exportPdf()}>
              Save PDF
            </Button>
            <Button icon={<Printer className="h-4 w-4" />} loading={busy === 'print'} disabled={busy !== null} onClick={() => void print()}>
              Print
            </Button>
          </>
        }
      />

      <Card className="mb-6 p-6">
        <div className="grid gap-6 sm:grid-cols-3">
          <div>
            <div className="text-xs font-medium text-ink-muted">What happened to the money</div>
            <ul className="mt-2 space-y-1">
              {note.appliedPaise > 0 && <li>Taken off what was owed on {note.invoiceNumber}: <Money paise={note.appliedPaise} /></li>}
              {note.refundedPaise > 0 && <li>Refunded: <Money paise={note.refundedPaise} /></li>}
              {note.heldPaise > 0 && <li>Kept as credit for {note.buyerName}: <Money paise={note.heldPaise} /></li>}
              {note.appliedPaise + note.refundedPaise + note.heldPaise === 0 && <li className="text-ink-muted">Nothing to settle.</li>}
            </ul>
          </div>
          <div>
            <div className="text-xs font-medium text-ink-muted">What happened to the stock</div>
            <ul className="mt-2 space-y-1">
              {restocked > 0 && <li>{restocked} piece{restocked === 1 ? '' : 's'} back on the shelf</li>}
              {notRestocked > 0 && <li>{notRestocked} piece{notRestocked === 1 ? '' : 's'} not put back (damaged)</li>}
            </ul>
          </div>
          <div>
            <div className="text-xs font-medium text-ink-muted">Reason</div>
            <p className="mt-2">{note.reason}</p>
          </div>
        </div>
      </Card>

      <div className="overflow-x-auto pb-8">
        <div className="mx-auto w-max rounded-lg border border-line shadow-overlay">
          <InvoiceDocument invoice={creditNoteAsInvoice(note)} variant="credit-note" against={{ invoiceNumber: note.invoiceNumber, reason: note.reason }} />
        </div>
      </div>
    </>
  );
}
