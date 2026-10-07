import { ArrowLeft, Ban, ClipboardCopy, Copy, Download, HandCoins, Mail, MessageCircle, PackageMinus, Printer, Receipt, Send, FileJson } from 'lucide-react';
import { useState } from 'react';
import { formatDate } from '../../../shared/gst';
import { invoiceMessage, mailtoLink, whatsappLink, whatsappPhone } from '../../../shared/messages';
import { formatMoney } from '../../../shared/money';
import { PAYMENT_METHOD_LABEL } from '../../../shared/types';
import { InvoiceDocument } from '../../components/InvoiceDocument';
import { NotesPanel } from '../../components/NotesPanel';
import { Menu } from '../../components/Menu';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorNote, Field, Figure, Input, InvoicePill, Money, PageHeader, Spinner, TypePill } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { copyText } from '../../lib/clipboard';
import { useRecent } from '../../lib/recent';
import { useQuery, useRefresh } from '../../lib/data';
import { navigate, paths } from '../../lib/router';
import { RecordPaymentModal } from '../payments/RecordPaymentModal';
import { CreditNoteModal } from './CreditNoteModal';
import { GovFormsModal } from './GovFormsModal';
import { DeliveryCard } from './DeliveryCard';
import { SoldByCard } from './SoldByCard';
import { InstalmentsCard } from './InstalmentsCard';
import { WriteOffModal } from './WriteOffModal';

export function InvoicePage({ id }: { id: string }) {
  const toast = useToast();
  const refresh = useRefresh();
  const query = useQuery(() => api.invoiceGet(id), [id]);
  const inv = query.data;
  useRecent(inv ? { kind: 'invoice', id: inv.id, title: inv.number, hint: inv.buyerName } : null);
  const customer = useQuery(() => (inv?.customerId ? api.customerGet(inv.customerId) : Promise.resolve(null)), [inv?.customerId]);
  const settings = useQuery(() => api.getSettings());
  const [busy, setBusy] = useState<'pdf' | 'print' | 'advance' | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [writingOff, setWritingOff] = useState(false);
  const [takingBack, setTakingBack] = useState(false);
  const [govForm, setGovForm] = useState<'eway' | 'einvoice' | null>(null);
  const [paying, setPaying] = useState(false);
  const [reason, setReason] = useState('');

  const back = (
    <a href={`#${paths.invoices()}`} className="inline-flex items-center gap-1.5 rounded-lg text-ink-muted transition-colors hover:text-ink">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Invoices
    </a>
  );

  if (query.error && !inv) {
    return (
      <>
        <PageHeader title="Invoice not found" back={back} />
        <ErrorNote>{query.error}</ErrorNote>
      </>
    );
  }
  if (!inv) {
    return (
      <>
        <PageHeader title="" back={back} />
        <Spinner />
      </>
    );
  }

  const cancelled = inv.status === 'cancelled';
  const balance = inv.totalPaise - inv.paidPaise;
  const advance = customer.data?.advancePaise ?? 0;

  async function run<T>(kind: 'pdf' | 'print' | 'advance', work: () => Promise<T>): Promise<T | undefined> {
    setBusy(kind);
    try {
      return await work();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  // In a plain browser (the localhost preview) there's no desktop shell to write a file, so open the invoice in its own tab
  // where the browser's print dialog can "Save as PDF" — same document, same layout.
  const openPrintView = () => {
    window.open(`${location.origin}${location.pathname}#/print/invoice/${encodeURIComponent(id)}`, '_blank');
    toast.info('Opened in a new tab — click “Save as PDF / Print” there, then choose “Save as PDF”.');
  };
  const exportPdf = () => (window.invoiceon ? run('pdf', async () => ((await api.invoiceExportPdf(id)).saved ? toast.success('PDF saved') : undefined)) : openPrintView());
  const print = () => (window.invoiceon ? run('print', () => api.invoicePrint(id)) : openPrintView());
  const printSlip = () => (window.invoiceon ? run('print', () => api.invoiceSlipPrint(id)) : void window.open(`${location.origin}${location.pathname}#${paths.printSlip(id)}`, '_blank'));
  // Sharing: a ready-written message. WhatsApp and email can't take the PDF from us, so the person attaches the one they save.
  const message = invoiceMessage(inv, { name: inv.seller.name, upiId: inv.seller.upiId }, settings.data?.msgInvoice ?? '');
  const phone = whatsappPhone(inv.buyer.phone ?? '');
  const email = customer.data?.email ?? '';
  const remindToAttach = 'Save the PDF (Save PDF) and attach it before you send.';
  const shareWhatsApp = () => {
    if (!phone) return;
    window.open(whatsappLink(phone, message.body), '_blank');
    toast.info(`WhatsApp opened with the message. ${remindToAttach}`);
  };
  const shareEmail = () => {
    window.open(mailtoLink(email, message.subject, message.body), '_blank');
    toast.info(`Your mail program opened with the message. ${remindToAttach}`);
  };
  const copyMessage = async () => (await copyText(`${message.subject}

${message.body}`)) ? toast.success('Message copied — paste it anywhere') : toast.error('Couldn’t copy to the clipboard');
  const applyAdvance = () =>
    run('advance', async () => {
      const after = await api.invoiceApplyAdvance(id);
      refresh();
      toast.success(`${formatMoney(after.paidPaise - inv!.paidPaise)} of advance applied`);
    });

  return (
    <>
      <PageHeader
        back={back}
        title={
          <span className="flex items-center gap-3">
            <span className="num">{inv.number}</span>
            <TypePill type={inv.type} />
            <InvoicePill status={inv.status} />
          </span>
        }
        subtitle={inv.customerId ? <a href={`#${paths.customer(inv.customerId)}`} className="transition-colors hover:text-brand">{inv.buyerName}</a> : inv.buyerName}
        actions={
          <>
            <Button icon={<Download className="h-4 w-4" />} loading={busy === 'pdf'} disabled={busy !== null} onClick={() => void exportPdf()}>
              Save PDF
            </Button>
            <Button icon={<Printer className="h-4 w-4" />} loading={busy === 'print'} disabled={busy !== null} onClick={() => void print()}>
              Print
            </Button>
            <Button icon={<Receipt className="h-4 w-4" />} disabled={busy !== null} onClick={() => void printSlip()} title="A short receipt for an 80 mm thermal printer">
              Receipt
            </Button>
            {!cancelled && (
              <Menu
                label="Share"
                icon={<Send className="h-4 w-4" />}
                items={[
                  { label: 'WhatsApp', icon: <MessageCircle className="h-4 w-4" />, onClick: shareWhatsApp, disabledReason: phone ? undefined : 'No phone number saved for this customer' },
                  { label: 'Email', icon: <Mail className="h-4 w-4" />, onClick: shareEmail },
                  { label: 'Copy the message', icon: <ClipboardCopy className="h-4 w-4" />, onClick: () => void copyMessage() },
                ]}
              />
            )}
            {!cancelled && (
              <Menu
                label="Government forms"
                icon={<FileJson className="h-4 w-4" />}
                items={[
                  { label: 'E-way bill file', onClick: () => setGovForm('eway') },
                  { label: 'E-invoice file', onClick: () => setGovForm('einvoice'), disabledReason: inv.type === 'B2B' ? undefined : 'E-invoices are for business (B2B) invoices' },
                ]}
              />
            )}
            <Button icon={<Copy className="h-4 w-4" />} onClick={() => navigate(paths.duplicateInvoice(id))} title="Start a new invoice with the same customer, items and prices">
              Duplicate
            </Button>
            {!cancelled && (
              <Button icon={<PackageMinus className="h-4 w-4" />} onClick={() => setTakingBack(true)} title="A customer returns pieces: make a credit note, put them back in stock and settle the money">
                Take goods back
              </Button>
            )}
            {!cancelled && (
              <Button variant="danger" icon={<Ban className="h-4 w-4" />} onClick={() => setCancelling(true)}>
                Cancel invoice
              </Button>
            )}
          </>
        }
      />

      {/* Payment position */}
      {!cancelled && (
        <Card className="mb-6 p-6">
          <div className="grid grid-cols-[auto_1fr] gap-10">
            <div className={`grid gap-8 ${inv.creditedPaise > 0 ? 'grid-cols-4' : 'grid-cols-3'}`}>
              <Figure label="Invoice total">
                <Money paise={inv.totalPaise} fractionDigits={0} />
              </Figure>
              {inv.creditedPaise > 0 && (
                <Figure label="Credit notes" sub={inv.creditNotes.filter((c) => c.status === 'issued').map((c) => c.number.split('/').pop()).join(', ')}>
                  <Money paise={inv.creditedPaise} fractionDigits={0} />
                </Figure>
              )}
              <Figure label="Received">
                <Money paise={inv.paidPaise - inv.creditedPaise} fractionDigits={0} />
              </Figure>
              <Figure label="Balance due" highlight={balance > 0} sub={balance > 0 && inv.dueDate ? `Due ${formatDate(inv.dueDate)}` : balance === 0 ? 'Paid in full' : undefined}>
                <Money paise={balance} fractionDigits={0} />
              </Figure>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-medium text-ink-muted">Payments</div>
                {balance > 0 && (
                  <span className="flex gap-2">
                    <Button className="h-8 px-3 text-xs" onClick={() => setWritingOff(true)} title="Clear a small balance you have decided not to chase">
                      Write off
                    </Button>
                    <Button className="h-8 px-3 text-xs" icon={<HandCoins className="h-3.5 w-3.5" />} onClick={() => setPaying(true)}>
                      Record payment
                    </Button>
                  </span>
                )}
              </div>
              {inv.payments.length === 0 ? (
                <p className="text-ink-muted">Nothing received yet.</p>
              ) : (
                <ul className="divide-y divide-line/70">
                  {inv.payments.map((p) => (
                    <li key={p.paymentId} className="flex items-center justify-between py-1.5">
                      <span>
                        <span className="num text-ink-muted">{formatDate(p.receivedOn)}</span>
                        <span className="ml-3">{PAYMENT_METHOD_LABEL[p.method]}</span>
                        {p.reference && <span className="num ml-2 text-xs text-ink-muted">{p.reference}</span>}
                      </span>
                      <Money paise={p.amountPaise} />
                    </li>
                  ))}
                </ul>
              )}
              {inv.creditNotes.length > 0 && (
                <div className="mb-3">
                  <div className="mb-1 text-xs font-medium text-ink-muted">Credit notes</div>
                  <ul className="divide-y divide-line/70">
                    {inv.creditNotes.map((c) => (
                      <li key={c.id} className="flex items-center justify-between py-1.5">
                        <span>
                          <span className="num text-ink-muted">{formatDate(c.issueDate)}</span>
                          <a href={`#${paths.creditNote(c.id)}`} className="num ml-3 text-brand transition-colors hover:text-brand-hover">
                            {c.number}
                          </a>
                          {c.status === 'cancelled' && <span className="ml-2 text-xs text-ink-muted">Cancelled</span>}
                        </span>
                        <Money paise={c.totalPaise} className={c.status === 'cancelled' ? 'text-ink-muted line-through' : ''} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {balance > 0 && advance > 0 && (
                <div className="mt-3 flex items-center justify-between rounded-lg bg-status-partial-bg px-3 py-2 text-status-partial-fg">
                  <span>{inv.buyerName} is holding <Money paise={advance} /> in advance.</span>
                  <button type="button" disabled={busy !== null} onClick={() => void applyAdvance()} className="ml-4 rounded-lg px-2 py-1 transition-colors hover:bg-white/50 disabled:opacity-50">
                    Apply to this invoice
                  </button>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {!cancelled && <InstalmentsCard invoice={inv} />}
      {!cancelled && <DeliveryCard invoice={inv} />}
      {!cancelled && <SoldByCard invoice={inv} />}
      {!cancelled && <NotesPanel subjectType="invoice" subjectId={inv.id} kinds={['promise', 'followup', 'call', 'note']} title="Follow-up and promises" />}

      {/* The paper itself — the same component the PDF and the printer use. */}
      <div className="overflow-x-auto pb-8">
        <div className="mx-auto w-max rounded-lg border border-line shadow-overlay">
          <InvoiceDocument invoice={inv} />
        </div>
      </div>

      {govForm && <GovFormsModal invoice={inv} kind={govForm} onClose={() => setGovForm(null)} />}
      {takingBack && <CreditNoteModal invoice={inv} customer={customer.data} onClose={() => setTakingBack(false)} />}
      {writingOff && <WriteOffModal invoice={inv} onClose={() => setWritingOff(false)} />}
      {paying && <RecordPaymentModal invoice={inv} customer={customer.data} onClose={() => setPaying(false)} />}
      {cancelling && (
        <ConfirmDialog
          title={`Cancel ${inv.number}?`}
          confirmLabel="Cancel invoice"
          danger
          body={
            <div className="space-y-4">
              <p>
                The pieces go back into stock and the invoice is marked cancelled. It keeps its number and stays on record — it can't be reopened. Issue a new invoice if you need a corrected one.
                {inv.paidPaise > 0 &&
                  (inv.customerId ? (
                    <> The {formatMoney(inv.paidPaise)} received on it goes back to {inv.buyerName} as advance, ready to use on the new invoice.</>
                  ) : (
                    <> The {formatMoney(inv.paidPaise)} received on it will be marked as returned to the customer.</>
                  ))}
              </p>
              <Field label="Reason">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional — e.g. wrong customer" data-autofocus />
              </Field>
            </div>
          }
          onClose={() => setCancelling(false)}
          onConfirm={async () => {
            await api.invoiceCancel(inv.id, reason);
            refresh();
            toast.success(`${inv.number} cancelled — stock restored`);
          }}
        />
      )}
    </>
  );
}
