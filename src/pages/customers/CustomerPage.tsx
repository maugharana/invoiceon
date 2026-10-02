import { Archive, ArrowLeft, Download, FileText, HandCoins, Pencil, Plus, Printer, ScrollText } from 'lucide-react';
import { useState } from 'react';
import { formatDate, todayIso } from '../../../shared/gst';
import { formatMoney } from '../../../shared/money';
import { occasionLabel, upcomingOccasions } from '../../../shared/occasions';
import { Menu } from '../../components/Menu';
import { ConfirmDialog } from '../../components/Modal';
import { NotesPanel } from '../../components/NotesPanel';
import { LoyaltyCard, WishlistCard } from './CustomerExtras';
import { TagChips } from '../../components/TagInput';
import { useToast } from '../../components/Toast';
import { Button, Card, EmptyState, ErrorNote, Figure, InvoicePill, Money, PageHeader, Spinner, TypePill } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { useDocumentOutput } from '../../lib/documents';
import { useRecent } from '../../lib/recent';
import { plural } from '../../lib/format';
import { navigate, paths } from '../../lib/router';
import { RecordPaymentModal } from '../payments/RecordPaymentModal';
import { CustomerFormModal } from './CustomerFormModal';

export function CustomerPage({ id }: { id: string }) {
  const toast = useToast();
  const refresh = useRefresh();
  const customer = useQuery(() => api.customerGet(id), [id]);
  const ledger = useQuery(() => api.customerLedger(id), [id]);
  const invoices = useQuery(() => api.invoicesList({ customerId: id }), [id]);
  const purchases = useQuery(() => api.customerPurchases(id), [id]);
  const [dialog, setDialog] = useState<'edit' | 'archive' | 'pay' | null>(null);
  const c = customer.data;
  const docs = useDocumentOutput();
  useRecent(c ? { kind: 'customer', id: c.id, title: c.name, hint: [c.phone, c.city].filter(Boolean).join(' · ') } : null);

  const back = (
    <a href={`#${paths.customers}`} className="inline-flex items-center gap-1.5 rounded-lg text-ink-muted transition-colors hover:text-ink">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Customers
    </a>
  );

  if (customer.error && !c) {
    return (
      <>
        <PageHeader title="Customer not found" back={back} />
        <ErrorNote>{customer.error}</ErrorNote>
      </>
    );
  }
  if (!c) {
    return (
      <>
        <PageHeader title="" back={back} />
        <Spinner />
      </>
    );
  }

  const address = [c.address, [c.city, c.state, c.pincode].filter(Boolean).join(', ')].filter(Boolean);
  const balance = c.outstandingPaise - c.advancePaise; // + they owe you, − you hold their money
  const balanceLabel = balance > 0 ? 'They owe you' : balance < 0 ? 'Advance held' : 'Settled';
  const received = ledger.data?.receivedPaise ?? 0;
  const occasions = upcomingOccasions(c, todayIso(), 14);
  const overLimit = c.creditLimitPaise > 0 && c.outstandingPaise > c.creditLimitPaise;

  return (
    <>
      <PageHeader
        back={back}
        title={
          <span className="flex items-center gap-3">
            {c.name}
            <TypePill type={c.type} />
          </span>
        }
        subtitle={[c.phone, c.email].filter(Boolean).join(' · ') || undefined}
        actions={
          <>
            <Menu
              label="Statement"
              icon={<ScrollText className="h-4 w-4" />}
              items={[
                { label: 'Save as PDF', icon: <Download className="h-4 w-4" />, onClick: () => void docs.savePdf(paths.printStatement(id), () => api.customerStatementExportPdf(id)) },
                { label: 'Print', icon: <Printer className="h-4 w-4" />, onClick: () => void docs.print(paths.printStatement(id), () => api.customerStatementPrint(id)) },
              ]}
            />
            <Button icon={<HandCoins className="h-4 w-4" />} onClick={() => setDialog('pay')}>
              Record payment
            </Button>
            <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setDialog('edit')}>
              Edit
            </Button>
            <Button variant="danger" icon={<Archive className="h-4 w-4" />} onClick={() => setDialog('archive')}>
              Archive
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-4 gap-6">
        <Figure label={balanceLabel} sub={c.advancePaise > 0 && c.outstandingPaise > 0 ? `${formatMoney(c.outstandingPaise, { fractionDigits: 0 })} due, ${formatMoney(c.advancePaise, { fractionDigits: 0 })} advance` : undefined} highlight>
          <Money paise={Math.abs(balance)} fractionDigits={0} />
        </Figure>
        <Figure label="Total billed" sub="Excludes cancelled">
          <Money paise={c.billedPaise} fractionDigits={0} />
        </Figure>
        <Figure label="Received" sub={[ledger.data && ledger.data.writtenOffPaise > 0 ? `Plus ${formatMoney(ledger.data.writtenOffPaise, { fractionDigits: 0 })} written off` : '', ledger.data && ledger.data.creditedPaise > 0 ? `${formatMoney(ledger.data.creditedPaise, { fractionDigits: 0 })} in credit notes` : ''].filter(Boolean).join(' · ') || undefined}>
          <Money paise={received} fractionDigits={0} />
        </Figure>
        <Figure label="Invoices">{c.invoiceCount}</Figure>
      </div>
      <div className="mb-4 text-ink-muted">
        {[c.gstin && `GSTIN ${c.gstin}`, ...address, c.notes].filter(Boolean).join(' · ') || 'No address or GSTIN saved.'}
      </div>
      <div className="mb-8 space-y-2 text-sm">
        {(c.tags || c.creditLimitPaise > 0 || c.paymentTermsDays != null || occasions.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-ink-muted">
            <TagChips tags={c.tags} />
            {c.creditLimitPaise > 0 && (
              <span className={overLimit ? 'text-status-partial-fg' : ''}>
                Credit limit <Money paise={c.creditLimitPaise} fractionDigits={0} />
                {overLimit && ' · over the limit'}
              </span>
            )}
            {c.paymentTermsDays != null && <span>Pays in {c.paymentTermsDays === 0 ? 'the day' : `${c.paymentTermsDays} days`}</span>}
            {occasions.map((o) => (
              <span key={o.kind}>
                {occasionLabel(o.kind)} {o.daysAway === 0 ? 'today' : o.daysAway === 1 ? 'tomorrow' : `in ${o.daysAway} days`}
              </span>
            ))}
          </div>
        )}
        {c.addresses.length > 0 && (
          <div className="text-ink-muted">
            {c.addresses.map((a, i) => (
              <div key={i}>
                <span className="text-ink">{a.label || 'Address'}:</span> {[a.address, a.city, a.state, a.pincode].filter(Boolean).join(', ')}
              </div>
            ))}
          </div>
        )}
        {c.contacts.length > 0 && (
          <div className="text-ink-muted">
            {c.contacts.map((p, i) => (
              <div key={i}>
                <span className="text-ink">{p.name || 'Contact'}</span>
                {p.role && ` (${p.role})`}
                {[p.phone, p.email].filter(Boolean).length > 0 && ` · ${[p.phone, p.email].filter(Boolean).join(' · ')}`}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ledger */}
      <div className="mb-3 flex items-end justify-between">
        <h2 className="text-base">Ledger</h2>
        <span className="text-xs text-ink-muted">Invoices add to the balance; payments reduce it. A minus balance means you hold their advance.</span>
      </div>
      <Card className="mb-8 overflow-x-auto">
        {ledger.data?.entries.length === 0 ? (
          <EmptyState icon={<FileText className="h-6 w-6" />} title="No activity yet" body={`Invoices and payments for ${c.name} will build up here as a running statement.`} />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Date</th>
                <th className="th">Details</th>
                <th className="th text-right">Billed</th>
                <th className="th text-right">Received</th>
                <th className="th text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {ledger.data?.entries.map((e, i) => {
                const reversal = e.kind === 'invoice-cancelled' || e.kind === 'payment-voided' || e.kind === 'credit-note-cancelled';
                const link = e.invoiceId;
                return (
                  <tr
                    key={i}
                    tabIndex={link ? 0 : undefined}
                    onClick={() => link && navigate(paths.invoice(link))}
                    onKeyDown={(ev) => ev.key === 'Enter' && link && navigate(paths.invoice(link))}
                    className={`animate-fade-in border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas ${link ? 'cursor-pointer' : ''} ${reversal ? 'text-ink-muted' : ''}`}
                  >
                    <td className="td num whitespace-nowrap text-ink-muted">{formatDate(e.date)}</td>
                    <td className="td">{e.description}</td>
                    <td className="td text-right">{e.debitPaise ? <Money paise={e.debitPaise} /> : <span className="text-ink-muted/50">—</span>}</td>
                    <td className="td text-right">{e.creditPaise ? <Money paise={e.creditPaise} /> : <span className="text-ink-muted/50">—</span>}</td>
                    <td className={`td text-right ${e.balancePaise < 0 ? 'text-status-partial-fg' : ''}`}><Money paise={e.balancePaise} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* What she has bought — so "what did she take last time?" has an answer. */}
      {purchases.data && purchases.data.length > 0 && (
        <>
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-base">What they've bought</h2>
            <span className="text-xs text-ink-muted">By design, from issued invoices · amounts before GST</span>
          </div>
          <Card className="mb-8 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className="th">Design</th>
                  <th className="th">Colours and sizes</th>
                  <th className="th text-right">Pieces</th>
                  <th className="th text-right">Spent</th>
                  <th className="th">Last bought</th>
                </tr>
              </thead>
              <tbody>
                {purchases.data.map((p) => (
                  <tr key={p.designName} className="animate-fade-in border-b border-line/70 last:border-0">
                    <td className="td">
                      {p.designName}
                      <div className="text-xs text-ink-muted">{plural(p.invoiceCount, 'invoice')}</div>
                    </td>
                    <td className="td text-ink-muted">{p.variants.join(' · ')}</td>
                    <td className="td num text-right">{p.pieces}</td>
                    <td className="td text-right">
                      <Money paise={p.amountPaise} />
                    </td>
                    <td className="td num whitespace-nowrap text-ink-muted">{formatDate(p.lastBoughtOn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      <LoyaltyCard customer={c} />
      <WishlistCard customer={c} />
      <NotesPanel subjectType="customer" subjectId={c.id} title="Notes and follow-ups" />

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base">Invoices</h2>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate(paths.newInvoice(c.id))}>
          New invoice
        </Button>
      </div>
      <Card className="overflow-x-auto">
        {invoices.data?.length === 0 ? (
          <EmptyState icon={<FileText className="h-6 w-6" />} title="No invoices yet" body={`Invoices made out to ${c.name} will be listed here.`} />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Invoice</th>
                <th className="th">Date</th>
                <th className="th text-right">Total</th>
                <th className="th text-right">Balance</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.data?.map((i) => (
                <tr key={i.id} tabIndex={0} onClick={() => navigate(paths.invoice(i.id))} onKeyDown={(e) => e.key === 'Enter' && navigate(paths.invoice(i.id))} className="animate-fade-in cursor-pointer border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas focus-visible:bg-canvas">
                  <td className="td num">{i.number}</td>
                  <td className="td num text-ink-muted">{formatDate(i.issueDate)}</td>
                  <td className="td text-right"><Money paise={i.totalPaise} className={i.status === 'cancelled' ? 'text-ink-muted line-through' : ''} /></td>
                  <td className="td text-right">{i.status === 'cancelled' || i.totalPaise - i.paidPaise === 0 ? <span className="text-ink-muted/50">—</span> : <Money paise={i.totalPaise - i.paidPaise} />}</td>
                  <td className="td"><InvoicePill status={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {dialog === 'pay' && <RecordPaymentModal customer={c} onClose={() => setDialog(null)} />}
      {dialog === 'edit' && <CustomerFormModal customer={c} onClose={() => setDialog(null)} onSaved={() => setDialog(null)} />}
      {dialog === 'archive' && (
        <ConfirmDialog
          title={`Archive ${c.name}?`}
          confirmLabel="Archive customer"
          danger
          body={<>They'll be removed from your customer list and the invoice picker. Invoices already issued to them keep their details and stay in your records. A customer who still owes you, or whose advance you hold, can't be archived until that's settled.</>}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.customerArchive(c.id);
            refresh();
            const id = c.id;
            toast.success(`${c.name} archived`, { label: 'Undo', onClick: async () => { try { await api.customerRestore(id); refresh(); toast.success('Customer brought back'); } catch (err) { toast.error(errorMessage(err)); } } });
            navigate(paths.customers);
          }}
        />
      )}
    </>
  );
}
