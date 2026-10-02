import { CircleCheck, Download, Pencil, Plus, Receipt, SearchX, Table2, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { expensesBreakdownCsv, expensesCsv } from '../../../shared/csv';
import { formatDate, todayIso } from '../../../shared/gst';
import { PERIOD_LABEL, resolvePeriod, type PeriodPreset } from '../../../shared/periods';
import { PAYMENT_METHOD_LABEL, type Expense } from '../../../shared/types';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Pager, SortableTh, sortBy, usePager, useSort } from '../../components/listTools';
import { Button, Card, EmptyState, ErrorNote, Figure, IconButton, Money, PageHeader, Pill, SearchInput, Segmented, Select, TableSkeleton } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { useCsvExport } from '../../lib/exportCsv';
import { plural } from '../../lib/format';
import { BudgetCard, MarkPaidModal, RecurringPanel, VendorsPanel } from './ExpenseExtras';
import { ExpenseFormModal } from './ExpenseFormModal';
import { ImportExpensesModal } from './ImportExpensesModal';

type Period = 'all' | Exclude<PeriodPreset, 'custom'>;
const PERIODS: Period[] = ['all', 'this-month', 'last-month', 'this-quarter', 'this-fy', 'last-fy'];
const label = (p: Period) => (p === 'all' ? 'All time' : PERIOD_LABEL[p]);

export function ExpensesPage({ category: initialCategory }: { category: string | null }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState(initialCategory ?? '');
  const [period, setPeriod] = useState<Period>('all');
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [view, setView] = useState<'entries' | 'vendors' | 'standing'>('entries');
  const [vendorId, setVendorId] = useState('');
  const [onlyUnpaid, setOnlyUnpaid] = useState(false);
  const [paying, setPaying] = useState<Expense | null>(null);
  const sort = useSort<'date' | 'category' | 'vendor' | 'method' | 'amount'>('date', 'desc');
  const saveCsv = useCsvExport();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  // A period that ends in the future (this month, this year) is shown up to today.
  const range = useMemo(() => {
    if (period === 'all') return {};
    const r = resolvePeriod({ preset: period });
    return { from: r.from, to: r.to > todayIso() ? todayIso() : r.to };
  }, [period]);
  const query = { search: debounced, category: category || undefined, vendorId: vendorId || undefined, status: onlyUnpaid ? ('unpaid' as const) : undefined, ...range };

  const list = useQuery(() => api.expensesList(query), [debounced, category, period, vendorId, onlyUnpaid]);
  const overview = useQuery(() => api.expensesOverview(query), [debounced, category, period, vendorId, onlyUnpaid]);
  const breakdown = useQuery(() => api.expensesBreakdown(query), [debounced, category, period, vendorId, onlyUnpaid]);
  const budgets = useQuery(() => api.budgetStatus());
  const payables = useQuery(() => api.payables());
  const dueStanding = useQuery(() => api.recurringDue());
  const everything = useQuery(() => api.expensesOverview());
  const settings = useQuery(() => api.getSettings());
  const none = everything.data?.count === 0;

  // The category menu lists your Settings categories plus any used on an expense but since removed from the list.
  const categories = useMemo(() => {
    const names = new Map<string, string>();
    for (const c of [...(settings.data?.expenseCategories ?? []), ...(everything.data?.byCategory.map((c) => c.category) ?? [])]) names.set(c.toLowerCase(), c);
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  }, [settings.data, everything.data]);

  const lookupVendor = list.data?.find((e) => e.vendorId === vendorId)?.vendor ?? 'one vendor';
  const o = overview.data;
  const top = o?.byCategory[0];
  const b = breakdown.data;
  // How this stretch compares with the one just before, when the view has fixed dates.
  const change = b?.previous && b.previous.totalPaise > 0 ? Math.round(((b.totalPaise - b.previous.totalPaise) / b.previous.totalPaise) * 100) : null;

  const sorted = useMemo(() => {
    const rows = list.data ?? [];
    if (sort.key === 'category') return sortBy(rows, (e) => e.category, sort.dir);
    if (sort.key === 'vendor') return sortBy(rows, (e) => e.vendor, sort.dir);
    if (sort.key === 'method') return sortBy(rows, (e) => PAYMENT_METHOD_LABEL[e.method], sort.dir);
    if (sort.key === 'amount') return sortBy(rows, (e) => e.amountPaise, sort.dir);
    return sortBy(rows, (e) => e.date, sort.dir);
  }, [list.data, sort.key, sort.dir]);
  const pager = usePager(sorted);
  useEffect(() => pager.setPage(0), [debounced, category, period, vendorId, onlyUnpaid, sort.key, sort.dir]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader
        title="Expenses"
        subtitle="What the business spends, by category."
        actions={
          <>
            <Button icon={<Upload className="h-4 w-4" />} onClick={() => setImporting(true)} title="Add many expenses from an Excel or CSV sheet">
              Add from a sheet
            </Button>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
              New expense
            </Button>
          </>
        }
      />
      {(list.error || overview.error) && <ErrorNote>{list.error ?? overview.error}</ErrorNote>}

      {none ? (
        <Card>
          <EmptyState icon={<Receipt className="h-6 w-6" />} title="No expenses yet" body="Record rent, raw materials, wages and the rest as you spend it — the dashboard then shows what came in against what went out." actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>New expense</Button>} />
        </Card>
      ) : (
        <>
          <div className="mb-6">
            <Segmented
              label="Show"
              value={view}
              onChange={setView}
              options={[
                { value: 'entries', label: 'Expenses' },
                { value: 'vendors', label: 'Vendors' },
                { value: 'standing', label: 'Standing expenses' },
              ]}
            />
          </div>

          {view === 'vendors' && <VendorsPanel onOpen={(id) => { setVendorId(id); setView('entries'); }} />}
          {view === 'standing' && <RecurringPanel />}

          {view === 'entries' && (
          <>
          {(dueStanding.data?.length ?? 0) > 0 && (
            <div className="mb-4 flex items-center justify-between gap-4 rounded-lg bg-status-partial-bg px-4 py-3 text-status-partial-fg">
              <span>{plural(dueStanding.data!.reduce((s, d) => s + d.dates.length, 0), 'standing expense')} {dueStanding.data!.reduce((s, d) => s + d.dates.length, 0) === 1 ? 'has' : 'have'} come due.</span>
              <Button className="h-8 text-xs" onClick={() => setView('standing')}>
                Review
              </Button>
            </div>
          )}
          {payables.data && payables.data.unpaidCount > 0 && (
            <div className={`mb-4 flex items-center justify-between gap-4 rounded-lg px-4 py-3 ${payables.data.overdueCount > 0 ? 'bg-status-overdue-bg text-status-overdue-fg' : 'bg-canvas text-ink-muted'}`}>
              <span>
                You owe <Money paise={payables.data.unpaidPaise} fractionDigits={0} /> on {plural(payables.data.unpaidCount, 'unpaid bill')}
                {payables.data.overdueCount > 0 && <> — <Money paise={payables.data.overduePaise} fractionDigits={0} /> is past its due date</>}.
              </span>
              <Button className="h-8 text-xs" onClick={() => setOnlyUnpaid((v) => !v)}>
                {onlyUnpaid ? 'Show all' : 'Show only unpaid'}
              </Button>
            </div>
          )}
          <BudgetCard lines={budgets.data ?? []} onPick={(c) => setCategory(c)} />
          <div className="mb-8 grid grid-cols-3 gap-6">
            <Figure
              label="Spent"
              sub={
                o ? (
                  <>
                    {plural(o.count, 'expense')}
                    {change !== null && change !== 0 && (
                      <span className={change > 0 ? 'text-status-overdue-fg' : 'text-status-paid-fg'}> · {change > 0 ? '↑' : '↓'} {Math.abs(change)}% on the period before</span>
                    )}
                  </>
                ) : (
                  ' '
                )
              }
              highlight
            >
              <Money paise={o?.totalPaise ?? 0} fractionDigits={0} />
            </Figure>
            <Figure label="Biggest category" sub={top ? <Money paise={top.paise} fractionDigits={0} /> : ' '}>
              {top?.category ?? '—'}
            </Figure>
            <Figure label="Categories used" sub="In this view">
              {o?.byCategory.length ?? 0}
            </Figure>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Search paid to, category or note" />
            <div className="w-48">
              <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </div>
            {vendorId && (
              <Button className="h-9 text-xs" onClick={() => setVendorId('')} title="Show every vendor again">
                Vendor: {lookupVendor} ✕
              </Button>
            )}
            <div className="w-40">
              <Select value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Period">
                {PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {label(p)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button icon={<Table2 className="h-4 w-4" />} onClick={() => setBreakdownOpen((v) => !v)} aria-expanded={breakdownOpen}>
                Month by category
              </Button>
              <Button icon={<Download className="h-4 w-4" />} disabled={sorted.length === 0} onClick={() => void saveCsv(`expenses-${todayIso()}.csv`, expensesCsv(sorted), 'Expenses saved')}>
                Export CSV
              </Button>
            </div>
          </div>

          {breakdownOpen && b && (
            <Card className="animate-fade-in mb-4 overflow-x-auto">
              <div className="flex items-center justify-between border-b border-line px-6 py-3">
                <div>
                  <h2 className="text-base">Month by category</h2>
                  <p className="text-xs text-ink-muted">{b.previous ? `Compared with ${formatDate(b.previous.from)} – ${formatDate(b.previous.to)}` : 'Pick a period above to compare with the one before it.'}</p>
                </div>
                <Button className="h-8 text-xs" icon={<Download className="h-3.5 w-3.5" />} disabled={b.rows.length === 0} onClick={() => void saveCsv(`expenses-by-month-${todayIso()}.csv`, expensesBreakdownCsv(b), 'Table saved')}>
                  Export table
                </Button>
              </div>
              {b.rows.length === 0 ? (
                <p className="px-6 py-6 text-ink-muted">No expenses to lay out.</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="th">Category</th>
                      {b.months.map((m) => (
                        <th key={m} className="th num text-right">
                          {new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}
                        </th>
                      ))}
                      <th className="th text-right">Total</th>
                      {b.previous && <th className="th text-right">Before</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r) => (
                      <tr key={r.category} className="border-b border-line/70">
                        <td className="td">{r.category}</td>
                        {r.byMonth.map((paise, i) => (
                          <td key={b.months[i]} className={`td text-right ${paise === 0 ? 'text-ink-muted/50' : ''}`}>
                            {paise === 0 ? '—' : <Money paise={paise} fractionDigits={0} />}
                          </td>
                        ))}
                        <td className="td text-right">
                          <Money paise={r.totalPaise} fractionDigits={0} />
                        </td>
                        {b.previous && (
                          <td className="td text-right text-ink-muted">
                            <Money paise={r.previousPaise ?? 0} fractionDigits={0} />
                          </td>
                        )}
                      </tr>
                    ))}
                    <tr className="bg-canvas">
                      <td className="td">All categories</td>
                      {b.monthTotals.map((paise, i) => (
                        <td key={b.months[i]} className="td text-right">
                          <Money paise={paise} fractionDigits={0} />
                        </td>
                      ))}
                      <td className="td text-right">
                        <Money paise={b.totalPaise} fractionDigits={0} />
                      </td>
                      {b.previous && (
                        <td className="td text-right text-ink-muted">
                          <Money paise={b.previous.totalPaise} fractionDigits={0} />
                        </td>
                      )}
                    </tr>
                  </tbody>
                </table>
              )}
            </Card>
          )}

          <Card className="overflow-x-auto">
            {list.loading ? (
              <TableSkeleton />
            ) : list.data?.length === 0 ? (
              <EmptyState icon={<SearchX className="h-6 w-6" />} title="No expenses match" body="Try a different search, category or period." actions={<Button onClick={() => { setSearch(''); setCategory(''); setPeriod('all'); setVendorId(''); setOnlyUnpaid(false); }}>Clear filters</Button>} />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <SortableTh label="Date" active={sort.key === 'date'} dir={sort.dir} onSort={() => sort.toggle('date', 'desc')} />
                    <SortableTh label="Category" active={sort.key === 'category'} dir={sort.dir} onSort={() => sort.toggle('category')} />
                    <SortableTh label="Paid to" active={sort.key === 'vendor'} dir={sort.dir} onSort={() => sort.toggle('vendor')} />
                    <SortableTh label="Paid by" active={sort.key === 'method'} dir={sort.dir} onSort={() => sort.toggle('method')} />
                    <SortableTh label="Amount" right active={sort.key === 'amount'} dir={sort.dir} onSort={() => sort.toggle('amount', 'desc')} />
                    <th className="w-24" />
                  </tr>
                </thead>
                <tbody>
                  {pager.pageItems.map((e) => (
                    <tr key={e.id} className="animate-fade-in border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas">
                      <td className="td num whitespace-nowrap text-ink-muted">{formatDate(e.date)}</td>
                      <td className="td">
                        {e.category}
                        {e.recurringId && <div className="text-xs text-ink-muted">standing expense</div>}
                      </td>
                      <td className="td">
                        {e.vendor || <span className="text-ink-muted">—</span>}
                        {e.note && <div className="text-xs text-ink-muted">{e.note}</div>}
                      </td>
                      <td className="td">
                        {PAYMENT_METHOD_LABEL[e.method]}
                        {e.reference && <div className="num text-xs text-ink-muted">{e.reference}</div>}
                      </td>
                      <td className="td text-right">
                        <Money paise={e.amountPaise} />
                        {e.gstPaise > 0 && (
                          <div className="text-xs text-ink-muted">
                            incl. GST <Money paise={e.gstPaise} />
                          </div>
                        )}
                        {e.status === 'unpaid' && (
                          <div className="mt-0.5">
                            <Pill tone={e.dueDate && e.dueDate < todayIso() ? 'overdue' : 'partial'}>{e.dueDate && e.dueDate < todayIso() ? 'Overdue' : 'To pay'}{e.dueDate ? ` · ${formatDate(e.dueDate)}` : ''}</Pill>
                          </div>
                        )}
                      </td>
                      <td className="td">
                        <div className="flex justify-end gap-0.5">
                          {e.status === 'unpaid' && (
                            <IconButton label={`Mark ${e.category} bill paid`} onClick={() => setPaying(e)}>
                              <CircleCheck className="h-4 w-4" />
                            </IconButton>
                          )}
                          <IconButton label={`Edit ${e.category} expense`} onClick={() => setEditing(e)}>
                            <Pencil className="h-4 w-4" />
                          </IconButton>
                          <IconButton label={`Delete ${e.category} expense`} onClick={() => setDeleting(e)}>
                            <Trash2 className="h-4 w-4" />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          {list.data && list.data.length > 0 && <Pager pager={pager} noun="expense" />}
          </>
          )}
        </>
      )}

      {paying && <MarkPaidModal expense={paying} onClose={() => setPaying(null)} />}

      {importing && <ImportExpensesModal onClose={() => setImporting(false)} />}
      {editing && <ExpenseFormModal expense={editing === 'new' ? undefined : editing} defaultCategory={category} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog
          title="Delete this expense?"
          confirmLabel="Delete expense"
          danger
          onClose={() => setDeleting(null)}
          body={
            <p>
              <Money paise={deleting.amountPaise} /> for {deleting.category}
              {deleting.vendor ? ` (${deleting.vendor})` : ''} on {formatDate(deleting.date)} will be removed from your expenses and reports.
            </p>
          }
          onConfirm={async () => {
            await api.expenseDelete(deleting.id);
            refresh();
            const id = deleting.id;
            toast.success('Expense deleted', { label: 'Undo', onClick: async () => { try { await api.expenseRestore(id); refresh(); toast.success('Expense brought back'); } catch (err) { toast.error(errorMessage(err)); } } });
          }}
        />
      )}
    </>
  );
}
