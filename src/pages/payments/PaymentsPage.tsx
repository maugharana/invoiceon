import { Ban, BellRing, Download, FileText, HandCoins, Plus, SearchX, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { paymentsCsv } from '../../../shared/csv';
import { formatDate, todayIso } from '../../../shared/gst';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type DuesRow, type Payment, type PaymentMethod } from '../../../shared/types';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { DateRangeFilter, Pager, SortableTh, sortBy, usePager, useSort, type DateRangeValue } from '../../components/listTools';
import { Button, Card, EmptyState, ErrorNote, Field, Figure, IconButton, Input, Money, PageHeader, Pill, SearchInput, Segmented, Select, TableSkeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { useDocumentOutput } from '../../lib/documents';
import { useCsvExport } from '../../lib/exportCsv';
import { plural } from '../../lib/format';
import { navigate, paths } from '../../lib/router';
import { RecordPaymentModal } from './RecordPaymentModal';
import { RemindersModal } from './RemindersModal';

function Tabs({ tab }: { tab: 'payments' | 'dues' }) {
  const tabs = [
    { id: 'payments', label: 'Payments', href: paths.payments },
    { id: 'dues', label: 'Dues', href: paths.dues },
  ] as const;
  return (
    <div className="mb-6 flex gap-6 border-b border-line" role="tablist">
      {tabs.map((t) => (
        <a key={t.id} href={`#${t.href}`} role="tab" aria-selected={tab === t.id} className={`-mb-px border-b-2 pb-2.5 transition-colors duration-150 ${tab === t.id ? 'border-brand font-medium text-brand' : 'border-transparent text-ink-muted hover:text-ink'}`}>
          {t.label}
        </a>
      ))}
    </div>
  );
}

/** Shared frame for Payments and Dues: title, the four headline figures, the tabs. */
function PaymentsShell({ tab, children }: { tab: 'payments' | 'dues'; children: ReactNode }) {
  const summary = useQuery(() => api.paymentsSummary());
  const [recording, setRecording] = useState(false);
  const s = summary.data;
  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="What you've received, and who still owes you."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setRecording(true)}>
            Record payment
          </Button>
        }
      />
      {s && (
        <div className="mb-8 grid grid-cols-4 gap-6">
          <Figure label="Received this month" sub={plural(s.paymentsThisMonth, 'payment')} highlight={tab === 'payments'}>
            <Money paise={s.receivedThisMonthPaise} fractionDigits={0} />
          </Figure>
          <Figure label="Outstanding" sub="On issued invoices" highlight={tab === 'dues'}>
            <Money paise={s.outstandingPaise} fractionDigits={0} />
          </Figure>
          <Figure label="Overdue" sub="Past their due date">
            <Money paise={s.overduePaise} fractionDigits={0} />
          </Figure>
          <Figure label="Advance held" sub={s.customersWithAdvance ? `From ${plural(s.customersWithAdvance, 'customer')}` : 'None'}>
            <Money paise={s.advanceHeldPaise} fractionDigits={0} />
          </Figure>
        </div>
      )}
      <Tabs tab={tab} />
      {children}
      {recording && <RecordPaymentModal onClose={() => setRecording(false)} />}
    </>
  );
}

// ── Payments ────────────────────────────────────────────────────────────────
function VoidPaymentDialog({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [reason, setReason] = useState('');
  return (
    <ConfirmDialog
      title="Reverse this payment?"
      confirmLabel="Reverse payment"
      danger
      onClose={onClose}
      body={
        <div className="space-y-4">
          <p>
            <Money paise={payment.amountPaise} /> from {payment.customerName} will be marked reversed and counted as not received
            {payment.allocations.length > 0 && <>, so {payment.allocations.map((a) => a.invoiceNumber).join(', ')} will owe it again</>}. The record stays in their ledger. Use this for a mistake, a bounced cheque, or a refund.
          </p>
          <Field label="Reason">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional — e.g. cheque bounced" data-autofocus />
          </Field>
        </div>
      }
      onConfirm={async () => {
        await api.paymentVoid(payment.id, reason);
        refresh();
        toast.success('Payment reversed');
      }}
    />
  );
}

export function PaymentsPage() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<'all' | 'advance' | 'voided'>('all');
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const [dates, setDates] = useState<DateRangeValue>({});
  const [method, setMethod] = useState<'' | PaymentMethod>('');
  const sort = useSort<'date' | 'customer' | 'method' | 'amount'>('date', 'desc');
  const saveCsv = useCsvExport();
  const docs = useDocumentOutput();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  const payments = useQuery(() => api.paymentsList({ search: debounced, status, method: method || undefined, from: dates.from, to: dates.to }), [debounced, status, method, dates.from, dates.to]);
  const any = useQuery(() => api.paymentsList());
  const list = payments.data;
  const none = any.data?.length === 0;
  const sorted = useMemo(() => {
    const rows = list ?? [];
    if (sort.key === 'customer') return sortBy(rows, (p) => p.customerName, sort.dir);
    if (sort.key === 'method') return sortBy(rows, (p) => PAYMENT_METHOD_LABEL[p.method], sort.dir);
    if (sort.key === 'amount') return sortBy(rows, (p) => p.amountPaise, sort.dir);
    return sortBy(rows, (p) => p.receivedOn, sort.dir);
  }, [list, sort.key, sort.dir]);
  const pager = usePager(sorted);
  useEffect(() => pager.setPage(0), [debounced, status, method, dates.from, dates.to, sort.key, sort.dir]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <PaymentsShell tab="payments">
      {payments.error && <ErrorNote>{payments.error}</ErrorNote>}
      {none ? (
        <Card>
          <EmptyState icon={<HandCoins className="h-6 w-6" />} title="No payments yet" body="Record money as it comes in — against an invoice, or as an advance when a customer pays before their invoice is ready." />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between gap-4">
            <SearchInput value={search} onChange={setSearch} placeholder="Search customer, reference or invoice" />
            <div className="flex flex-wrap items-center justify-end gap-3">
              <DateRangeFilter onChange={setDates} />
              <div className="w-40">
                <Select value={method} onChange={(e) => setMethod(e.target.value as '' | PaymentMethod)} aria-label="Method">
                  <option value="">Any method</option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABEL[m]}
                    </option>
                  ))}
                </Select>
              </div>
              <Segmented
                label="Payment filter"
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'advance', label: 'Advance held' },
                  { value: 'voided', label: 'Reversed' },
                ]}
              />
              <Button icon={<Download className="h-4 w-4" />} disabled={sorted.length === 0} onClick={() => void saveCsv(`payments-${todayIso()}.csv`, paymentsCsv(sorted), 'Payments saved')}>
                Export CSV
              </Button>
            </div>
          </div>
          <Card className="overflow-x-auto">
            {payments.loading ? (
              <TableSkeleton />
            ) : list?.length === 0 ? (
              <EmptyState icon={<SearchX className="h-6 w-6" />} title="No payments match" body="Try a different search or filter." actions={<Button onClick={() => { setSearch(''); setStatus('all'); setMethod(''); }}>Clear filters</Button>} />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <SortableTh label="Date" active={sort.key === 'date'} dir={sort.dir} onSort={() => sort.toggle('date', 'desc')} />
                    <SortableTh label="Customer" active={sort.key === 'customer'} dir={sort.dir} onSort={() => sort.toggle('customer')} />
                    <SortableTh label="Method" active={sort.key === 'method'} dir={sort.dir} onSort={() => sort.toggle('method')} />
                    <th className="th">Applied to</th>
                    <SortableTh label="Amount" right active={sort.key === 'amount'} dir={sort.dir} onSort={() => sort.toggle('amount', 'desc')} />
                    <th className="w-20" />
                  </tr>
                </thead>
                <tbody>
                  {pager.pageItems.map((p) => (
                    <tr key={p.id} className={`animate-fade-in border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas ${p.voided ? 'text-ink-muted' : ''}`}>
                      <td className="td num whitespace-nowrap text-ink-muted">{formatDate(p.receivedOn)}</td>
                      <td className="td">
                        {p.customerId ? (
                          <a href={`#${paths.customer(p.customerId)}`} className="transition-colors hover:text-brand">{p.customerName}</a>
                        ) : (
                          p.customerName
                        )}
                      </td>
                      <td className="td">
                        {PAYMENT_METHOD_LABEL[p.method]}
                        {p.reference && <div className="num text-xs text-ink-muted">{p.reference}</div>}
                      </td>
                      <td className="td">
                        {p.voided ? (
                          <Pill tone="overdue">Reversed{p.voidReason ? ` — ${p.voidReason}` : ''}</Pill>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {p.allocations.map((a) => (
                              <a key={a.invoiceId} href={`#${paths.invoice(a.invoiceId)}`} className="num text-xs transition-colors hover:text-brand">
                                {a.invoiceNumber}
                                <span className="text-ink-muted"> · <Money paise={a.amountPaise} fractionDigits={0} /></span>
                              </a>
                            ))}
                            {p.advancePaise > 0 && <Pill tone="partial">Advance <Money paise={p.advancePaise} fractionDigits={0} className="ml-1" /></Pill>}
                          </div>
                        )}
                      </td>
                      <td className="td text-right">
                        <Money paise={p.amountPaise} className={p.voided ? 'line-through' : ''} />
                      </td>
                      <td className="td">
                        <div className="flex justify-end gap-0.5">
                          <IconButton label={`Receipt for ${p.customerName}, ${formatDate(p.receivedOn)}`} onClick={() => void docs.savePdf(paths.printReceipt(p.id), () => api.paymentReceiptExportPdf(p.id))}>
                            <FileText className="h-4 w-4" />
                          </IconButton>
                          {!p.voided && (
                            <IconButton label={`Reverse payment from ${p.customerName}`} onClick={() => setVoiding(p)}>
                              <Undo2 className="h-4 w-4" />
                            </IconButton>
                          )}
                        </div>
                        {p.voided && <Ban className="h-4 w-4 text-ink-muted/50" aria-label="Reversed" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          {list && list.length > 0 && <Pager pager={pager} noun="payment" />}
        </>
      )}
      {voiding && <VoidPaymentDialog payment={voiding} onClose={() => setVoiding(null)} />}
    </PaymentsShell>
  );
}

// ── Dues ────────────────────────────────────────────────────────────────────
const BUCKETS = [
  // Brand palette only (gold is reserved for the one highlight figure): teal for fine, then browns and reds that darken with age.
  { key: 'currentPaise', label: 'Not yet due', bar: 'bg-brand/70' },
  { key: 'days1to30Paise', label: '1–30 days late', bar: 'bg-status-partial-fg/60' },
  { key: 'days31to60Paise', label: '31–60 days late', bar: 'bg-status-overdue-fg/60' },
  { key: 'days61plusPaise', label: '61+ days late', bar: 'bg-status-overdue-fg' },
] as const;

export function DuesPage() {
  const dues = useQuery(() => api.duesReport());
  const [paying, setPaying] = useState<DuesRow | null>(null);
  const [reminding, setReminding] = useState(false);
  const settings = useQuery(() => api.getSettings());
  const d = dues.data;
  const total = d?.outstandingPaise ?? 0;

  return (
    <PaymentsShell tab="dues">
      {dues.error && <ErrorNote>{dues.error}</ErrorNote>}
      {dues.loading ? (
        <TableSkeleton />
      ) : d && d.rows.length === 0 ? (
        <Card>
          <EmptyState icon={<HandCoins className="h-6 w-6" />} title="Nobody owes you anything" body={d.advanceHeldPaise > 0 ? 'Every invoice is paid. You are holding advance from some customers, shown above.' : 'Every issued invoice is paid. Money owed will show up here, aged by how late it is.'} />
        </Card>
      ) : (
        d && (
          <>
            <div className="mb-4 flex justify-end">
              <Button icon={<BellRing className="h-4 w-4" />} onClick={() => setReminding(true)} title="Ready-written reminders for everyone who is overdue">
                Send reminders
              </Button>
            </div>
            {/* How old is what you're owed? */}
            <Card className="mb-6 p-6">
              <h2 className="mb-4 text-base">How late is it?</h2>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-status-neutral-bg" role="img" aria-label="Outstanding by age">
                {BUCKETS.map((b) => (
                  <div key={b.key} className={`${b.bar} transition-[width] duration-500`} style={{ width: total ? `${(d[b.key] / total) * 100}%` : 0 }} />
                ))}
              </div>
              <dl className="mt-4 grid grid-cols-4 gap-6">
                {BUCKETS.map((b) => (
                  <div key={b.key}>
                    <dt className="flex items-center gap-2 text-xs text-ink-muted">
                      <span className={`h-2 w-2 rounded-full ${b.bar}`} aria-hidden />
                      {b.label}
                    </dt>
                    <dd className="mt-1 text-lg tracking-tight"><Money paise={d[b.key]} fractionDigits={0} /></dd>
                  </div>
                ))}
              </dl>
            </Card>

            <Card className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className="th">Customer</th>
                    <th className="th text-right">Not yet due</th>
                    <th className="th text-right">1–30</th>
                    <th className="th text-right">31–60</th>
                    <th className="th text-right">61+</th>
                    <th className="th text-right">Owes</th>
                    <th className="w-36" />
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr
                      key={r.customerId ?? 'walk-in'}
                      tabIndex={r.customerId ? 0 : undefined}
                      onClick={() => r.customerId && navigate(paths.customer(r.customerId))}
                      onKeyDown={(e) => e.key === 'Enter' && r.customerId && navigate(paths.customer(r.customerId))}
                      className={`animate-fade-in border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas ${r.customerId ? 'cursor-pointer' : ''}`}
                    >
                      <td className="td min-w-[13rem]">
                        <div>{r.customerName}</div>
                        <div className="whitespace-nowrap text-xs text-ink-muted">
                          {plural(r.openInvoices, 'invoice')}
                          {r.oldestDueDate && <> · oldest due {formatDate(r.oldestDueDate)}</>}
                          {r.advancePaise > 0 && <span className="text-status-partial-fg"> · <Money paise={r.advancePaise} fractionDigits={0} /> advance held</span>}
                        </div>
                      </td>
                      <Cell paise={r.currentPaise} />
                      <Cell paise={r.days1to30Paise} />
                      <Cell paise={r.days31to60Paise} />
                      <Cell paise={r.days61plusPaise} late />
                      <td className="td text-right"><Money paise={r.outstandingPaise} /></td>
                      <td className="td text-right" onClick={(e) => e.stopPropagation()}>
                        {r.customerId && (
                          <Button className="h-8 px-3 text-xs" onClick={() => setPaying(r)}>
                            Record payment
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )
      )}
      {reminding && d && <RemindersModal rows={d.rows} businessName={settings.data?.businessName ?? ''} upiId={settings.data?.upiId ?? ''} template={settings.data?.msgDue ?? ''} onClose={() => setReminding(false)} />}
      {paying?.customerId && <CustomerPaymentModal customerId={paying.customerId} onClose={() => setPaying(null)} />}
    </PaymentsShell>
  );
}

const Cell = ({ paise, late }: { paise: number; late?: boolean }) => (
  <td className={`td text-right ${paise === 0 ? 'text-ink-muted/50' : late ? 'text-status-overdue-fg' : ''}`}>{paise === 0 ? '—' : <Money paise={paise} fractionDigits={0} />}</td>
);

/** Loads the customer record, then opens the payment dialog for them. */
function CustomerPaymentModal({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const customer = useQuery(() => api.customerGet(customerId), [customerId]);
  if (!customer.data) return null;
  return <RecordPaymentModal customer={customer.data} onClose={onClose} />;
}
