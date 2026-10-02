import { ArrowLeft, Ban, BookmarkPlus, Copy, Download, FileCheck2, HandCoins, History, Pencil, Printer, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState } from 'react';
import { formatDate } from '../../../shared/gst';
import { InvoiceDocument } from '../../components/InvoiceDocument';
import { Menu } from '../../components/Menu';
import { ConfirmDialog } from '../../components/Modal';
import { NotesPanel } from '../../components/NotesPanel';
import { useToast } from '../../components/Toast';
import { QUOTE_STAGE_LABEL } from '../../../shared/types';
import { Button, Card, ErrorNote, Field, Figure, Input, Money, PageHeader, Pill, ProformaPill, Spinner, TypePill } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { useRecent } from '../../lib/recent';
import { navigate, paths } from '../../lib/router';
import { proformaAsInvoice } from '../../lib/proforma';
import { ConvertQuoteModal, DepositModal, LostModal, RevisionsModal, SaveTemplateModal } from './QuoteModals';

export function ProformaPage({ id }: { id: string }) {
  const toast = useToast();
  const refresh = useRefresh();
  const query = useQuery(() => api.proformaGet(id), [id]);
  const p = query.data;
  useRecent(p ? { kind: 'proforma', id: p.id, title: p.number, hint: p.buyerName } : null);
  const [busy, setBusy] = useState<'pdf' | 'print' | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [converting, setConverting] = useState(false);
  const [dialog, setDialog] = useState<'deposit' | 'lost' | 'versions' | 'template' | null>(null);
  const revisions = useQuery(() => api.proformaRevisions(id), [id]);
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

  // Open for business: it can be invoiced (all or part), have a deposit, and be accepted or lost.
  const live = p.status === 'open' || p.status === 'expired' || p.status === 'partial';
  // Items or prices can only change while nothing has been invoiced.
  const editable = p.status === 'open' || p.status === 'expired';
  const remaining = p.lines.reduce((s, l) => s + (l.qty - l.invoicedQty), 0);

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

  async function setStage(stage: 'open' | 'accepted') {
    try {
      await api.proformaSetStage(id, stage);
      refresh();
      toast.success(stage === 'accepted' ? 'Marked as accepted' : 'Back to waiting');
    } catch (err) {
      toast.error(errorMessage(err));
    }
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
            {editable && (
              <Button icon={<Pencil className="h-4 w-4" />} onClick={() => navigate(paths.editProforma(id))} title="Change this quote's items, prices or dates">
                Edit
              </Button>
            )}
            <Menu
              label="More"
              items={[
                { label: 'Duplicate', icon: <Copy className="h-4 w-4" />, onClick: () => navigate(paths.duplicateProforma(id)) },
                { label: 'Save as a template', icon: <BookmarkPlus className="h-4 w-4" />, onClick: () => setDialog('template') },
                { label: 'Earlier versions', icon: <History className="h-4 w-4" />, onClick: () => setDialog('versions'), disabledReason: revisions.data && revisions.data.length === 0 ? 'This quote has not been changed' : undefined },
                ...(live && p.customerId ? [{ label: 'Take a deposit', icon: <HandCoins className="h-4 w-4" />, onClick: () => setDialog('deposit') }] : []),
                ...(live && p.stage !== 'accepted' && p.status !== 'partial' ? [{ label: 'Mark accepted', icon: <ThumbsUp className="h-4 w-4" />, onClick: () => void setStage('accepted') }] : []),
                ...(live && p.status !== 'partial' ? [{ label: 'Mark lost', icon: <ThumbsDown className="h-4 w-4" />, onClick: () => setDialog('lost') }] : []),
                ...(p.status === 'lost' ? [{ label: 'Reopen', icon: <ThumbsUp className="h-4 w-4" />, onClick: () => void setStage('open') }] : []),
              ]}
            />
            {live && (
              <Button variant="danger" icon={<Ban className="h-4 w-4" />} onClick={() => setCancelling(true)}>
                Cancel
              </Button>
            )}
            {live && (
              <Button variant="primary" icon={<FileCheck2 className="h-4 w-4" />} onClick={() => setConverting(true)}>
                {p.status === 'partial' ? 'Invoice the rest' : 'Convert to invoice'}
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
          <Figure label="Invoice" sub={p.status === 'partial' ? `${remaining} ${remaining === 1 ? 'piece' : 'pieces'} still to invoice` : undefined}>
            {p.invoices.length > 0 ? (
              <span className="flex flex-wrap gap-x-3">
                {p.invoices.map((i) => (
                  <a key={i.id} href={`#${paths.invoice(i.id)}`} className="num text-brand transition-colors hover:text-brand-hover">
                    {i.number}
                  </a>
                ))}
              </span>
            ) : (
              <span className="text-ink-muted">Not yet</span>
            )}
          </Figure>
        </div>
        {(p.stage !== 'open' || p.depositPaise > 0) && (
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-4">
            {p.stage !== 'open' && (
              <span className="flex items-center gap-2">
                <Pill tone={p.stage === 'lost' ? 'overdue' : 'paid'}>{QUOTE_STAGE_LABEL[p.stage]}</Pill>
                {p.lostReason && <span className="text-ink-muted">{p.lostReason}</span>}
              </span>
            )}
            {p.depositPaise > 0 && (
              <span className="text-ink-muted">
                Deposit taken: <Money paise={p.depositPaise} />
              </span>
            )}
          </div>
        )}
      </Card>

      <NotesPanel subjectType="proforma" subjectId={p.id} kinds={['followup', 'call', 'visit', 'note']} title="Follow-ups" />

      <div className="overflow-x-auto pb-8">
        <div className="mx-auto w-max rounded-lg border border-line shadow-overlay">
          <InvoiceDocument invoice={proformaAsInvoice(p)} variant="proforma" />
        </div>
      </div>

      {converting && <ConvertQuoteModal proforma={p} onClose={() => setConverting(false)} />}
      {dialog === 'deposit' && <DepositModal proforma={p} onClose={() => setDialog(null)} />}
      {dialog === 'lost' && <LostModal proforma={p} onClose={() => setDialog(null)} />}
      {dialog === 'versions' && <RevisionsModal proforma={p} onClose={() => setDialog(null)} />}
      {dialog === 'template' && <SaveTemplateModal proforma={p} onClose={() => setDialog(null)} />}
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
