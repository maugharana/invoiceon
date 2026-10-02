import { Pencil, Plus, Repeat, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { suggestAccount } from '../../../shared/accountChoice';
import { formatDate, todayIso } from '../../../shared/gst';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, RECURRING_FREQUENCIES, RECURRING_LABEL, type BudgetLine, type Expense, type PaymentMethod, type RecurringExpense, type RecurringFrequency, type Vendor } from '../../../shared/types';
import { Modal, ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, EmptyState, ErrorNote, Field, IconButton, Input, Money, MoneyInput, Select, Spinner, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { plural } from '../../lib/format';

// ── Budgets ─────────────────────────────────────────────────────────────────
/** This month against the limits set in Settings → Expense categories. Hidden when no budget is set. */
export function BudgetCard({ lines, onPick }: { lines: BudgetLine[]; onPick: (category: string) => void }) {
  if (lines.length === 0) return null;
  const tone = { ok: 'bg-brand/70', near: 'bg-status-partial-fg/70', over: 'bg-status-overdue-fg' } as const;
  return (
    <Card className="mb-6 p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-base">This month against budget</h2>
        <span className="text-xs text-ink-muted">Set the limits in Settings → Expense categories</span>
      </div>
      <ul className="space-y-3">
        {lines.map((l) => (
          <li key={l.category}>
            <button type="button" onClick={() => onPick(l.category)} className="block w-full text-left">
              <div className="mb-1 flex items-baseline justify-between">
                <span>{l.category}</span>
                <span className={`num text-xs ${l.status === 'over' ? 'text-status-overdue-fg' : l.status === 'near' ? 'text-status-partial-fg' : 'text-ink-muted'}`}>
                  <Money paise={l.spentPaise} fractionDigits={0} /> of <Money paise={l.budgetPaise} fractionDigits={0} />
                  {l.status === 'over' && ` · over by `}
                  {l.status === 'over' && <Money paise={l.spentPaise - l.budgetPaise} fractionDigits={0} />}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-status-neutral-bg" role="img" aria-label={`${Math.round(l.percent)}% of the budget used`}>
                <div className={`h-full rounded-full transition-[width] duration-500 ${tone[l.status]}`} style={{ width: `${Math.min(100, l.percent)}%` }} />
              </div>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── Marking a bill paid ─────────────────────────────────────────────────────
export function MarkPaidModal({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const settings = useQuery(() => api.getSettings());
  const accounts = settings.data?.paymentAccounts ?? [];
  const [paidOn, setPaidOn] = useState(todayIso());
  const [method, setMethod] = useState<PaymentMethod>(expense.method);
  const [accountId, setAccountId] = useState(expense.accountId);
  const [reference, setReference] = useState(expense.reference);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api.expenseMarkPaid(expense.id, { paidOn, method, accountId, reference });
      refresh();
      toast.success('Marked paid');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Mark as paid"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            Mark paid
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-muted">
          <Money paise={expense.amountPaise} /> to {expense.vendor || expense.category}
          {expense.dueDate && <> · due {formatDate(expense.dueDate)}</>}
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Paid on">
            <Input type="date" value={paidOn} max={todayIso()} onChange={(e) => setPaidOn(e.target.value)} className="num" data-autofocus />
          </Field>
          <Field label="Paid by">
            <Select
              value={method}
              onChange={(e) => {
                const m = e.target.value as PaymentMethod;
                setMethod(m);
                if (!expense.accountId) setAccountId(suggestAccount(m, accounts));
              }}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {accounts.length > 0 && (
          <Field label="Paid from account">
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Not recorded</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Reference">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}

// ── Vendors ─────────────────────────────────────────────────────────────────
export function VendorsPanel({ onOpen }: { onOpen: (vendorId: string) => void }) {
  const vendors = useQuery(() => api.vendorsList());
  const [editing, setEditing] = useState<Vendor | 'new' | null>(null);
  const rows = vendors.data ?? [];

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-ink-muted">Everyone you pay. Names you type on an expense are added here automatically; add a phone or GSTIN to keep their details with them.</p>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
          Add vendor
        </Button>
      </div>
      {vendors.loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={<Repeat className="h-6 w-6" />} title="No vendors yet" body="Type a name under “Paid to” on an expense and they appear here, with what you have spent with them." />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Vendor</th>
                <th className="th">GSTIN</th>
                <th className="th text-right">Entries</th>
                <th className="th text-right">Spent</th>
                <th className="th text-right">You owe</th>
                <th className="th">Last</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} tabIndex={0} onClick={() => onOpen(v.id)} onKeyDown={(e) => e.key === 'Enter' && onOpen(v.id)} className="animate-fade-in cursor-pointer border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas">
                  <td className="td">
                    {v.name}
                    {v.phone && <div className="num text-xs text-ink-muted">{v.phone}</div>}
                  </td>
                  <td className="td num text-xs text-ink-muted">{v.gstin || '—'}</td>
                  <td className="td num text-right">{v.expenseCount}</td>
                  <td className="td text-right">
                    <Money paise={v.spendPaise} />
                  </td>
                  <td className="td text-right">{v.unpaidPaise > 0 ? <Money paise={v.unpaidPaise} className="text-status-overdue-fg" /> : <span className="text-ink-muted/50">—</span>}</td>
                  <td className="td num whitespace-nowrap text-ink-muted">{v.lastSpentOn ? formatDate(v.lastSpentOn) : '—'}</td>
                  <td className="td" onClick={(e) => e.stopPropagation()}>
                    <IconButton label={`Edit ${v.name}`} onClick={() => setEditing(v)}>
                      <Pencil className="h-4 w-4" />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {editing && <VendorModal vendor={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function VendorModal({ vendor, onClose }: { vendor?: Vendor; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [name, setName] = useState(vendor?.name ?? '');
  const [phone, setPhone] = useState(vendor?.phone ?? '');
  const [gstin, setGstin] = useState(vendor?.gstin ?? '');
  const [address, setAddress] = useState(vendor?.address ?? '');
  const [notes, setNotes] = useState(vendor?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const input = { name, phone, gstin: gstin.toUpperCase(), address, notes };
      if (vendor) await api.vendorUpdate(vendor.id, input);
      else await api.vendorCreate(input);
      refresh();
      toast.success(vendor ? 'Vendor updated' : 'Vendor added');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={vendor ? 'Edit vendor' : 'New vendor'}
      onClose={onClose}
      footer={
        <>
          {vendor && (
            <Button variant="danger" className="mr-auto" onClick={() => setArchiving(true)}>
              Archive
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            {vendor ? 'Save changes' : 'Add vendor'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
          </Field>
          <Field label="GSTIN" hint="Needed to claim the GST on their bills">
            <Input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} maxLength={15} className="num uppercase" />
          </Field>
        </div>
        <Field label="Address">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <Field label="Notes">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
      {archiving && vendor && (
        <ConfirmDialog
          title={`Archive ${vendor.name}?`}
          confirmLabel="Archive vendor"
          danger
          body={<p>They leave the list and the “Paid to” suggestions. Their past expenses are kept as they are.</p>}
          onClose={() => setArchiving(false)}
          onConfirm={async () => {
            await api.vendorArchive(vendor.id);
            refresh();
            toast.success(`${vendor.name} archived`);
            onClose();
          }}
        />
      )}
    </Modal>
  );
}

// ── Standing expenses ───────────────────────────────────────────────────────
export function RecurringPanel() {
  const toast = useToast();
  const refresh = useRefresh();
  const list = useQuery(() => api.recurringList());
  const due = useQuery(() => api.recurringDue());
  const [editing, setEditing] = useState<RecurringExpense | 'new' | null>(null);
  const rows = list.data ?? [];
  const dueCount = (due.data ?? []).reduce((s, d) => s + d.dates.length, 0);

  async function addDue() {
    try {
      const n = await api.recurringRun();
      refresh();
      toast.success(`${plural(n, 'entry', 'entries')} added`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-xs text-ink-muted">Rent, salaries, subscriptions: set them once and add each period's entry with one click when it comes due.</p>
        <div className="flex gap-2">
          {dueCount > 0 && (
            <Button variant="primary" onClick={() => void addDue()}>
              Add {plural(dueCount, 'due entry', 'due entries')}
            </Button>
          )}
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            New standing expense
          </Button>
        </div>
      </div>
      {list.loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={<Repeat className="h-6 w-6" />} title="No standing expenses" body="Add the bills that repeat — shop rent every month, a yearly insurance — and they will be entered for you when they fall due." />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Expense</th>
                <th className="th">How often</th>
                <th className="th">Next due</th>
                <th className="th text-right">Amount</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const late = r.nextDate <= todayIso();
                return (
                  <tr key={r.id} className="animate-fade-in border-b border-line/70 last:border-0">
                    <td className="td">
                      {r.category}
                      {r.vendor && <div className="text-xs text-ink-muted">{r.vendor}</div>}
                    </td>
                    <td className="td text-ink-muted">
                      {RECURRING_LABEL[r.frequency]}
                      {r.endDate && <div className="text-xs">until {formatDate(r.endDate)}</div>}
                    </td>
                    <td className={`td num whitespace-nowrap ${late ? 'text-status-partial-fg' : 'text-ink-muted'}`}>
                      {formatDate(r.nextDate)}
                      {late && <div className="text-xs">due now</div>}
                    </td>
                    <td className="td text-right">
                      <Money paise={r.amountPaise} />
                    </td>
                    <td className="td">
                      <div className="flex justify-end gap-0.5">
                        <IconButton label={`Edit ${r.category}`} onClick={() => setEditing(r)}>
                          <Pencil className="h-4 w-4" />
                        </IconButton>
                        <IconButton label={`Delete ${r.category}`} onClick={() => void api.recurringDelete(r.id).then(() => { refresh(); toast.success('Standing expense removed'); })}>
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {editing && <RecurringModal recurring={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function RecurringModal({ recurring, onClose }: { recurring?: RecurringExpense; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const settings = useQuery(() => api.getSettings());
  const accounts = settings.data?.paymentAccounts ?? [];
  const [category, setCategory] = useState(recurring?.category ?? '');
  const [vendor, setVendor] = useState(recurring?.vendor ?? '');
  const [amount, setAmount] = useState(recurring?.amountPaise ?? 0);
  const [gst, setGst] = useState(recurring?.gstPaise ?? 0);
  const [method, setMethod] = useState<PaymentMethod>(recurring?.method ?? 'bank');
  const [accountId, setAccountId] = useState(recurring?.accountId ?? '');
  const [frequency, setFrequency] = useState<RecurringFrequency>(recurring?.frequency ?? 'monthly');
  const [nextDate, setNextDate] = useState(recurring?.nextDate ?? todayIso());
  const [endDate, setEndDate] = useState(recurring?.endDate ?? '');
  const [note, setNote] = useState(recurring?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const input = { category, vendor, amountPaise: amount, gstPaise: gst, method, accountId, note, frequency, nextDate, endDate: endDate || null };
      if (recurring) await api.recurringUpdate(recurring.id, input);
      else await api.recurringCreate(input);
      refresh();
      toast.success(recurring ? 'Standing expense updated' : 'Standing expense added');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={recurring ? 'Edit standing expense' : 'New standing expense'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            {recurring ? 'Save changes' : 'Add'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Category">
            <Input value={category} onChange={(e) => setCategory(e.target.value)} list="recurring-categories" placeholder="e.g. Rent" maxLength={40} data-autofocus />
            <datalist id="recurring-categories">
              {(settings.data?.expenseCategories ?? []).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Paid to">
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount each time">
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
          <Field label="GST in it" hint="Optional">
            <MoneyInput value={gst} onChange={setGst} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="How often">
            <Select value={frequency} onChange={(e) => setFrequency(e.target.value as RecurringFrequency)}>
              {RECURRING_FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {RECURRING_LABEL[f]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Next due">
            <Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className="num" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Paid by">
            <Select
              value={method}
              onChange={(e) => {
                const m = e.target.value as PaymentMethod;
                setMethod(m);
                if (!recurring?.accountId) setAccountId(suggestAccount(m, accounts));
              }}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
          {accounts.length > 0 ? (
            <Field label="From account">
              <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Not recorded</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <span />
          )}
        </div>
        <Field label="Stops after" hint="Optional. Leave blank to carry on until you remove it.">
          <Input type="date" value={endDate} min={nextDate} onChange={(e) => setEndDate(e.target.value)} className="num max-w-[12rem]" />
        </Field>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}
