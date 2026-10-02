import { ArrowRightLeft, Banknote, CheckCircle2, Landmark, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatDate, todayIso } from '../../../shared/gst';
import { PERIOD_LABEL, resolvePeriod, type PeriodPreset } from '../../../shared/periods';
import { CHEQUE_STATUS_LABEL, PAYMENT_METHOD_LABEL, type AccountBookAccount, type ChequeStatus, type Payment, type ReconcilePreview } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, EmptyState, ErrorNote, Field, IconButton, Input, Money, MoneyInput, Pill, Segmented, Select, Spinner, Textarea, type PillTone } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { paths } from '../../lib/router';
import { PaymentsShell } from './PaymentsPage';

const CHEQUE_TONE: Record<ChequeStatus, PillTone> = { pending: 'partial', deposited: 'partial', cleared: 'paid', bounced: 'overdue' };

// ── Cheques ─────────────────────────────────────────────────────────────────
/** Cheques you have taken, with where each has got to. A post-dated one counts as received now; if it bounces it is reversed. */
export function ChequesPage() {
  const toast = useToast();
  const refresh = useRefresh();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const cheques = useQuery(() => api.paymentsList({ status: 'cheque' }));
  const [bouncing, setBouncing] = useState<Payment | null>(null);
  const today = todayIso();
  const rows = (cheques.data ?? []).filter((p) => filter === 'all' || p.chequeStatus === 'pending' || p.chequeStatus === 'deposited');

  async function move(p: Payment, status: ChequeStatus) {
    try {
      await api.paymentChequeStatus(p.id, status);
      refresh();
      toast.success(`Cheque ${CHEQUE_STATUS_LABEL[status].toLowerCase()}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <PaymentsShell tab="cheques">
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-xs text-ink-muted">A cheque counts as received from the day you record it. If it bounces, the payment is reversed and the invoice is owed again.</p>
        <Segmented
          label="Cheque filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: 'Not cleared' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>
      {cheques.loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={<Banknote className="h-6 w-6" />} title={filter === 'open' ? 'No cheques waiting' : 'No cheques yet'} body="When you record a payment by cheque and enter the date written on it, it is tracked here from “to deposit” through to “cleared”." />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Cheque date</th>
                <th className="th">Customer</th>
                <th className="th">Cheque no.</th>
                <th className="th text-right">Amount</th>
                <th className="th">Status</th>
                <th className="w-64" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const due = p.chequeStatus === 'pending' && p.chequeDate !== null && p.chequeDate <= today;
                return (
                  <tr key={p.id} className="animate-fade-in border-b border-line/70 last:border-0">
                    <td className="td num whitespace-nowrap">
                      {p.chequeDate ? formatDate(p.chequeDate) : '—'}
                      {due && <div className="text-xs text-status-partial-fg">ready to deposit</div>}
                      {p.chequeStatus === 'pending' && p.chequeDate !== null && p.chequeDate > today && <div className="text-xs text-ink-muted">post-dated</div>}
                    </td>
                    <td className="td">{p.customerId ? <a href={`#${paths.customer(p.customerId)}`} className="transition-colors hover:text-brand">{p.customerName}</a> : p.customerName}</td>
                    <td className="td num text-ink-muted">{p.reference || '—'}</td>
                    <td className="td text-right"><Money paise={p.amountPaise} /></td>
                    <td className="td">{p.chequeStatus && <Pill tone={CHEQUE_TONE[p.chequeStatus]}>{CHEQUE_STATUS_LABEL[p.chequeStatus]}</Pill>}</td>
                    <td className="td">
                      <div className="flex justify-end gap-2">
                        {p.chequeStatus === 'pending' && <Button className="h-8 px-3 text-xs" onClick={() => void move(p, 'deposited')}>Deposited</Button>}
                        {(p.chequeStatus === 'pending' || p.chequeStatus === 'deposited') && (
                          <>
                            <Button className="h-8 px-3 text-xs" onClick={() => void move(p, 'cleared')}>Cleared</Button>
                            <Button variant="danger" className="h-8 px-3 text-xs" onClick={() => setBouncing(p)}>Bounced</Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {bouncing && <BounceDialog payment={bouncing} onClose={() => setBouncing(null)} />}
    </PaymentsShell>
  );
}

function BounceDialog({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit() {
    setSaving(true);
    try {
      await api.paymentChequeStatus(payment.id, 'bounced', reason);
      refresh();
      toast.success('Cheque marked bounced — the payment is reversed');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }
  return (
    <Modal
      title="Cheque bounced?"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={saving} onClick={() => void submit()}>
            Mark bounced
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-muted">
          <Money paise={payment.amountPaise} /> from {payment.customerName} is reversed
          {payment.allocations.length > 0 && <>, so {payment.allocations.map((a) => a.invoiceNumber).join(', ')} will be owed again</>}.
        </p>
        <Field label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional — e.g. insufficient funds" data-autofocus />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}

// ── Cash & accounts ─────────────────────────────────────────────────────────
const PRESETS: PeriodPreset[] = ['this-month', 'last-month', 'this-fy'];

export function AccountsPage() {
  const [preset, setPreset] = useState<PeriodPreset>('this-month');
  const range = resolvePeriod({ preset });
  const book = useQuery(() => api.accountBook(range), [range.from, range.to]);
  const [transferring, setTransferring] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const noAccounts = book.data && book.data.accounts.length === 0;

  return (
    <PaymentsShell tab="accounts">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Period" value={preset} onChange={setPreset} options={PRESETS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))} />
        <Button icon={<ArrowRightLeft className="h-4 w-4" />} onClick={() => setTransferring(true)} disabled={(book.data?.accounts.filter((a) => a.accountId).length ?? 0) < 2} title="Move money between your accounts, such as cash to the bank">
          Move money
        </Button>
      </div>

      <DayCloseCard />

      {book.error && <ErrorNote>{book.error}</ErrorNote>}
      {book.loading ? (
        <Spinner />
      ) : noAccounts ? (
        <Card>
          <EmptyState icon={<Landmark className="h-6 w-6" />} title="No accounts set up" body="Add your cash drawer, bank and UPI accounts in Settings → Payment accounts. Then each payment and bill is recorded against one, and you can see what is in each." />
        </Card>
      ) : (
        book.data && (
          <>
            <div className="mb-6 grid grid-cols-3 gap-6">
              {book.data.accounts.map((a) => (
                <AccountCard
                  key={a.accountId || 'loose'}
                  account={a}
                  expanded={open.has(a.accountId)}
                  onToggle={() =>
                    setOpen((s) => {
                      const next = new Set(s);
                      if (next.has(a.accountId)) next.delete(a.accountId);
                      else next.add(a.accountId);
                      return next;
                    })
                  }
                />
              ))}
            </div>
            <p className="text-xs text-ink-muted">
              Total across accounts: <Money paise={book.data.totalClosingPaise} className="text-ink" />. A bill you have not paid yet is not money out. Entries made before accounts were linked sit under “not linked”.
            </p>
          </>
        )
      )}
      {transferring && book.data && <TransferModal accounts={book.data.accounts.filter((a) => a.accountId)} onClose={() => setTransferring(false)} />}
    </PaymentsShell>
  );
}

function AccountCard({ account: a, expanded, onToggle }: { account: AccountBookAccount; expanded: boolean; onToggle: () => void }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs text-ink-muted">{a.name}</div>
        <button type="button" onClick={onToggle} aria-expanded={expanded} className="text-xs text-brand transition-colors hover:text-brand-hover">
          {expanded ? 'Hide entries' : `${a.entries.length} ${a.entries.length === 1 ? 'entry' : 'entries'}`}
        </button>
      </div>
      <div className="text-2xl tracking-tight">
        <Money paise={a.closingPaise} fractionDigits={0} />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-ink-muted">Started</dt>
          <dd className="num">
            <Money paise={a.openingPaise} fractionDigits={0} />
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">In</dt>
          <dd className="num text-status-paid-fg">
            <Money paise={a.inPaise} fractionDigits={0} />
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Out</dt>
          <dd className="num text-status-overdue-fg">
            <Money paise={a.outPaise} fractionDigits={0} />
          </dd>
        </div>
      </dl>
      {expanded && (
        <ul className="mt-4 max-h-64 divide-y divide-line/70 overflow-y-auto text-xs">
          {a.entries.length === 0 && <li className="py-2 text-ink-muted">Nothing in this period.</li>}
          {a.entries.map((e, i) => (
            <li key={i} className="flex items-start justify-between gap-3 py-1.5">
              <span className="min-w-0">
                <span className="num text-ink-muted">{formatDate(e.date)}</span> · {e.party}
                <span className="block truncate text-ink-muted">{e.detail}</span>
              </span>
              <span className={`num shrink-0 ${e.inPaise ? 'text-status-paid-fg' : 'text-status-overdue-fg'}`}>
                {e.inPaise ? '+' : '−'}
                <Money paise={e.inPaise || e.outPaise} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TransferModal({ accounts, onClose }: { accounts: AccountBookAccount[]; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [from, setFrom] = useState(accounts.find((a) => a.kind === 'cash')?.accountId ?? accounts[0]?.accountId ?? '');
  const [to, setTo] = useState(accounts.find((a) => a.kind === 'bank')?.accountId ?? accounts[1]?.accountId ?? '');
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const transfers = useQuery(() => api.transfersList());

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api.transferCreate({ fromAccountId: from, toAccountId: to, amountPaise: amount, date, note });
      refresh();
      toast.success('Money moved');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }
  const nameOf = (id: string) => accounts.find((a) => a.accountId === id)?.name ?? 'Account';

  return (
    <Modal
      title="Move money between accounts"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={amount <= 0 || from === to} onClick={() => void submit()}>
            Move money
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="From">
            <Select value={from} onChange={(e) => setFrom(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="To">
            <Select value={to} onChange={(e) => setTo(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount">
            <MoneyInput value={amount} onChange={setAmount} data-autofocus />
          </Field>
          <Field label="Date">
            <Input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} className="num" />
          </Field>
        </div>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — e.g. deposited the day's cash" />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        {transfers.data && transfers.data.length > 0 && (
          <div>
            <div className="mb-1 text-xs text-ink-muted">Recent moves</div>
            <ul className="divide-y divide-line/70 text-xs">
              {transfers.data.slice(0, 5).map((t) => (
                <li key={t.id} className="flex items-center justify-between py-1.5">
                  <span>
                    <span className="num text-ink-muted">{formatDate(t.date)}</span> · {nameOf(t.fromAccountId)} → {nameOf(t.toAccountId)}
                  </span>
                  <span className="flex items-center gap-2">
                    <Money paise={t.amountPaise} />
                    <IconButton label="Undo this move" onClick={() => void api.transferDelete(t.id).then(() => { refresh(); toast.success('Move undone'); })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Count the drawer at the end of the day and see whether it matches what the books say should be in it. */
function DayCloseCard() {
  const toast = useToast();
  const refresh = useRefresh();
  const [day, setDay] = useState(todayIso());
  const close = useQuery(() => api.dayCloseGet(day), [day]);
  const history = useQuery(() => api.dayClosesList());
  const [counted, setCounted] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const c = close.data;
  const value = counted ?? c?.countedPaise ?? 0;
  // Nothing to compare until a count has been typed (or the day was closed earlier).
  const hasCount = counted !== null || c?.countedPaise != null;
  const difference = c ? value - c.expectedPaise : 0;

  async function save() {
    setSaving(true);
    try {
      await api.dayCloseSave(day, value, note || c?.note || '');
      refresh();
      setCounted(null);
      toast.success('Day closed');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-6 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base">
          <Banknote className="h-4 w-4 text-ink-muted" aria-hidden /> Close the day
        </h2>
        <Input type="date" value={day} max={todayIso()} onChange={(e) => { setDay(e.target.value); setCounted(null); setNote(''); }} className="num w-44" aria-label="Day" />
      </div>
      {c && (
        <div className="grid grid-cols-[1fr_1fr_1fr_2fr_auto] items-end gap-4">
          <Field label="Books say the drawer holds">
            <div className="flex h-10 items-center text-base">
              <Money paise={c.expectedPaise} />
            </div>
          </Field>
          <Field label="You counted">
            <MoneyInput value={value} onChange={setCounted} />
          </Field>
          <Field label="Difference">
            <div className={`flex h-10 items-center text-base ${!hasCount ? '' : difference === 0 ? 'text-status-paid-fg' : 'text-status-overdue-fg'}`}>
              {!hasCount ? <span className="text-ink-muted">Enter your count</span> : difference === 0 ? 'Matches' : <>{difference > 0 ? 'Over by ' : 'Short by '}<Money paise={Math.abs(difference)} className="ml-1" /></>}
            </div>
          </Field>
          <Field label="Note">
            <Input value={note || c.note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </Field>
          <Button variant="primary" icon={<CheckCircle2 className="h-4 w-4" />} loading={saving} disabled={!hasCount} onClick={() => void save()}>
            {c.countedPaise === null ? 'Close day' : 'Update'}
          </Button>
        </div>
      )}
      {c?.closedAt && <p className="mt-3 text-xs text-ink-muted">This day was closed. Your books are not changed by a difference: it is just noted here.</p>}
      {history.data && history.data.length > 0 && (
        <ul className="mt-4 divide-y divide-line/70 border-t border-line text-xs">
          {history.data.slice(0, 5).map((h) => (
            <li key={h.day} className="flex items-center justify-between py-1.5">
              <span className="num text-ink-muted">{formatDate(h.day)}</span>
              <span>
                Counted <Money paise={h.countedPaise ?? 0} /> ·{' '}
                {h.differencePaise === 0 ? <span className="text-status-paid-fg">matched</span> : <span className="text-status-overdue-fg">{(h.differencePaise ?? 0) > 0 ? 'over' : 'short'} <Money paise={Math.abs(h.differencePaise ?? 0)} /></span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Match bank statement ────────────────────────────────────────────────────
export function ReconcilePage() {
  const toast = useToast();
  const refresh = useRefresh();
  const settings = useQuery(() => api.getSettings());
  const [text, setText] = useState('');
  const [accountId, setAccountId] = useState('');
  const [preview, setPreview] = useState<ReconcilePreview | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = useQuery(() => api.paymentsList({ status: 'unreconciled' }));
  const payments = useMemo(() => new Map((open.data ?? []).map((p) => [p.id, p])), [open.data]);
  const accounts = settings.data?.paymentAccounts.filter((a) => a.kind !== 'cash') ?? [];

  async function check() {
    setBusy(true);
    setError(null);
    try {
      const p = await api.reconcilePreview(text, accountId || undefined);
      setPreview(p);
      setPicked(new Set(p.proposals.flatMap((x) => (x.paymentId ? [x.paymentId] : []))));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    try {
      const n = await api.paymentsReconcile([...picked], todayIso());
      refresh();
      toast.success(`${n} ${n === 1 ? 'payment' : 'payments'} ticked off`);
      setPreview(null);
      setText('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PaymentsShell tab="reconcile">
      <Card className="mb-6 p-6">
        <h2 className="mb-1 text-base">Match your bank statement</h2>
        <p className="mb-4 text-xs text-ink-muted">Download the statement from your bank as a spreadsheet, copy the rows (with the heading row) and paste them here. Each money-in line is matched to the payment you recorded; you confirm before anything is ticked.</p>
        <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Date, Narration, Debit, Credit\n02/10/2026, UPI/4471882/Meena, , 5000'} className="num" />
        <div className="mt-3 flex items-center justify-between gap-3">
          {accounts.length > 0 ? (
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="w-56" aria-label="Account">
              <option value="">All bank and UPI accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          ) : (
            <span />
          )}
          <Button variant="primary" loading={busy} disabled={!text.trim()} onClick={() => void check()}>
            Check statement
          </Button>
        </div>
        {error && (
          <div className="mt-3">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
      </Card>

      {preview && (
        <>
          {preview.problems.length > 0 && (
            <div className="mb-4 rounded-lg bg-status-partial-bg px-4 py-3 text-status-partial-fg">
              {preview.problems.slice(0, 4).map((p) => (
                <div key={p.row}>
                  Row {p.row}: {p.message}
                </div>
              ))}
            </div>
          )}
          <Card className="mb-4 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className="w-10 pl-4" />
                  <th className="th">Statement</th>
                  <th className="th text-right">Credit</th>
                  <th className="th">Matched to</th>
                </tr>
              </thead>
              <tbody>
                {preview.proposals.length === 0 && (
                  <tr>
                    <td colSpan={4} className="td text-center text-ink-muted">
                      No money-in lines found{preview.skippedDebits > 0 ? ` (${preview.skippedDebits} withdrawals left out)` : ''}.
                    </td>
                  </tr>
                )}
                {preview.proposals.map((l) => {
                  const p = l.paymentId ? payments.get(l.paymentId) : undefined;
                  return (
                    <tr key={l.row} className="border-b border-line/70 last:border-0">
                      <td className="w-10 pl-4">
                        {l.paymentId && (
                          <input
                            type="checkbox"
                            checked={picked.has(l.paymentId)}
                            onChange={() =>
                              setPicked((s) => {
                                const next = new Set(s);
                                if (next.has(l.paymentId!)) next.delete(l.paymentId!);
                                else next.add(l.paymentId!);
                                return next;
                              })
                            }
                            aria-label={`Tick off the payment from ${l.customerName}`}
                            className="h-4 w-4 accent-[#0F6E56]"
                          />
                        )}
                      </td>
                      <td className="td">
                        <span className="num text-ink-muted">{formatDate(l.date)}</span> · {l.description || '—'}
                      </td>
                      <td className="td text-right">
                        <Money paise={l.creditPaise} />
                      </td>
                      <td className="td">
                        {p ? (
                          <>
                            {p.customerName} <span className="text-xs text-ink-muted">· {PAYMENT_METHOD_LABEL[p.method]} {formatDate(p.receivedOn)}</span>
                            <div className="text-xs text-ink-muted">{l.reason === 'reference' ? 'Reference matches' : 'Same amount, close date'}</div>
                          </>
                        ) : (
                          <span className="text-ink-muted">No payment recorded for this</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <div className="mb-8 flex items-center justify-between">
            <span className="text-xs text-ink-muted">
              {preview.skippedDebits > 0 && `${preview.skippedDebits} withdrawals left out. `}
              {preview.unmatchedPayments.length > 0 ? `${preview.unmatchedPayments.length} recorded ${preview.unmatchedPayments.length === 1 ? 'payment has' : 'payments have'} no statement line yet.` : 'Every recorded payment found its line.'}
            </span>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} loading={busy} disabled={picked.size === 0} onClick={() => void apply()}>
              Tick off {picked.size} {picked.size === 1 ? 'payment' : 'payments'}
            </Button>
          </div>
        </>
      )}

      <h2 className="mb-3 text-base">Not matched to a statement yet</h2>
      {open.data && open.data.length === 0 ? (
        <Card>
          <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="Everything is matched" body="Every bank, UPI, card and cheque receipt has been ticked off against a statement." />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Date</th>
                <th className="th">Customer</th>
                <th className="th">Method</th>
                <th className="th text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(open.data ?? []).map((p) => (
                <tr key={p.id} className="border-b border-line/70 last:border-0">
                  <td className="td num whitespace-nowrap text-ink-muted">{formatDate(p.receivedOn)}</td>
                  <td className="td">{p.customerName}</td>
                  <td className="td">
                    {PAYMENT_METHOD_LABEL[p.method]}
                    {p.reference && <span className="num text-xs text-ink-muted"> · {p.reference}</span>}
                  </td>
                  <td className="td text-right">
                    <Money paise={p.amountPaise} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </PaymentsShell>
  );
}
