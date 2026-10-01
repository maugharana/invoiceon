import { ArrowLeft, Ban, Copy, Download, FileCheck2, Pencil, Printer } from 'lucide-react';
import { useState } from 'react';
import { formatDate } from '../../../shared/gst';
import { InvoiceDocument } from '../../components/InvoiceDocument';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorNote, Field, Figure, Input, Money, PageHeader, ProformaPill, Spinner, TypePill } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { useRecent } from '../../lib/recent';
import { navigate, paths } from '../../lib/router';
import { proformaAsInvoice } from '../../lib/proforma';

export function ProformaPage({ id }: { id: string }) {
  const toast = useToast();
  const refresh = useRefresh();
  const query = useQuery(() => api.proformaGet(id), [id]);
  const p = query.data;
  useRecent(p ? { kind: 'proforma', id: p.id, title: p.number, hint: p.buyerName } : null);
  const [busy, setBusy] = useState<'pdf' | 'print' | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [converting, setConverting] = useState(false);
  const [reason, setReason] = useState('');

  const back = (
    <a href={`#${paths.proformas()}`} className="inline-flex items-center gap-1.5 rounded-lg text-ink-muted transition-colors hover:text-ink">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Proformas
    </a>
  );

  if (query.error && !p) {
    return (
      <>
        <PageHeader title="Proforma not found" back={back} />
        <ErrorNote>{query.error}</ErrorNote>
      </>
    );
  }
  if (!p) {
    return (
      <>
        <PageHeader title="" back={back} />
        <Spinner />
      </>
    );
  }

  const live = p.status === 'open' || p.status === 'expired';

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

  // In a plain browser there's no desktop shell to write a file, so open the print view where "Save as PDF" is available.
  const openPrintView = () => {
    window.open(`${location.origin}${location.pathname}#/print/proforma/${encodeURIComponent(id)}`, '_blank');
    toast.info('Opened in a new tab — click “Save as PDF / Print” there, then choose “Save as PDF”.');
  };
  const exportPdf = () => (window.invoiceon ? run('pdf', async () => ((await api.proformaExportPdf(id)).saved ? toast.success('PDF saved') : undefined)) : openPrintView());
  const print = () => (window.invoiceon ? run('print', () => api.proformaPrint(id)) : openPrintView());

  // A failure (usually "not enough stock") is shown inside the dialog and leaves the quote exactly as it was.
  async function convert() {
    const inv = await api.proformaConvert(id);
    refresh();
    toast.success(`Invoice ${inv.number} issued from ${p!.number}`);
    navigate(paths.invoice(inv.id));
  }

  return (
    <>
      <PageHeader
        back={back}
        title={
          <span className="flex items-center gap-3">
            <span className="num">{p.number}</span>
            <TypePill type={p.type} />
            <ProformaPill status={p.status} />
          </span>
        }
        subtitle={p.customerId ? <a href={`#${paths.customer(p.customerId)}`} className="transition-colors hover:text-brand">{p.buyerName}</a> : p.buyerName}
        actions={
          <>
            <Button icon={<Download className="h-4 w-4" />} loading={busy === 'pdf'} disabled={busy !== null} onClick={() => void exportPdf()}>
              Save PDF
            </Button>
            <Button icon={<Printer className="h-4 w-4" />} loading={busy === 'print'} disabled={busy !== null} onClick={() => void print()}>
              Print
            </Button>
            <Button icon={<Copy className="h-4 w-4" />} onClick={() => navigate(paths.duplicateProforma(id))} title="Start a new quote with the same customer, items and prices">
              Duplicate
            </Button>
            {live && (
              <Button icon={<Pencil className="h-4 w-4" />} onClick={() => navigate(paths.editProforma(id))} title="Change this quote's items, prices or dates">
                Edit
              </Button>
            )}
            {live && (
              <Button variant="danger" icon={<Ban className="h-4 w-4" />} onClick={() => setCancelling(true)}>
                Cancel
              </Button>
            )}
            {live && (
              <Button variant="primary" icon={<FileCheck2 className="h-4 w-4" />} onClick={() => setConverting(true)}>
                Convert to invoice
              </Button>
            )}
          </>
        }
      />

      <Card className="mb-6 p-6">
        <div className="grid grid-cols-4 gap-8">
          <Figure label="Quoted total" highlight={live}>
            <Money paise={p.totalPaise} fractionDigits={0} />
          </Figure>
          <Figure label="Date">
            <span className="num">{formatDate(p.issueDate)}</span>
          </Figure>
          <Figure label="Valid until" sub={p.status === 'expired' ? 'Lapsed — you can still invoice it' : undefined}>
            <span className="num">{formatDate(p.validUntil)}</span>
          </Figure>
          <Figure label="Invoice">
            {p.invoiceId ? (
              <a href={`#${paths.invoice(p.invoiceId)}`} className="num text-brand transition-colors hover:text-brand-hover">
                {p.invoiceNumber}
              </a>
            ) : (
              <span className="text-ink-muted">Not yet</span>
            )}
          </Figure>
        </div>
      </Card>

      <div className="overflow-x-auto pb-8">
        <div className="mx-auto w-max rounded-lg border border-line shadow-overlay">
          <InvoiceDocument invoice={proformaAsInvoice(p)} variant="proforma" />
        </div>
      </div>

      {converting && (
        <ConfirmDialog
          title={`Turn ${p.number} into an invoice?`}
          confirmLabel="Issue invoice"
          onClose={() => setConverting(false)}
          body={
            <p>
              An invoice for <Money paise={p.totalPaise} /> is issued today at the quoted prices, and the pieces come off your shelves. If any piece is short, nothing changes and you'll be told which. This proforma is then marked as invoiced.
            </p>
          }
          onConfirm={convert}
        />
      )}
      {cancelling && (
        <ConfirmDialog
          title={`Cancel ${p.number}?`}
          confirmLabel="Cancel proforma"
          danger
          body={
            <div className="space-y-4">
              <p>The quote is marked cancelled and keeps its number. Nothing else changes — it never took any stock.</p>
              <Field label="Reason">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional — e.g. customer bought elsewhere" data-autofocus />
              </Field>
            </div>
          }
          onClose={() => setCancelling(false)}
          onConfirm={async () => {
            await api.proformaCancel(p.id, reason);
            refresh();
            toast.success(`${p.number} cancelled`);
          }}
        />
      )}
    </>
  );
}
