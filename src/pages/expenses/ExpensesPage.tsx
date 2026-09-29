import { Pencil, Plus, Receipt, SearchX, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatDate, todayIso } from '../../../shared/gst';
import { PERIOD_LABEL, resolvePeriod, type PeriodPreset } from '../../../shared/periods';
import { PAYMENT_METHOD_LABEL, type Expense } from '../../../shared/types';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, EmptyState, ErrorNote, Figure, IconButton, Money, PageHeader, SearchInput, Select, TableSkeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { plural } from '../../lib/format';
import { ExpenseFormModal } from './ExpenseFormModal';

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
  const query = { search: debounced, category: category || undefined, ...range };

  const list = useQuery(() => api.expensesList(query), [debounced, category, period]);
  const overview = useQuery(() => api.expensesOverview(query), [debounced, category, period]);
  const everything = useQuery(() => api.expensesOverview());
  const settings = useQuery(() => api.getSettings());
  const none = everything.data?.count === 0;

  // The category menu lists your Settings categories plus any used on an expense but since removed from the list.
  const categories = useMemo(() => {
    const names = new Map<string, string>();
    for (const c of [...(settings.data?.expenseCategories ?? []), ...(everything.data?.byCategory.map((c) => c.category) ?? [])]) names.set(c.toLowerCase(), c);
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  }, [settings.data, everything.data]);

  const o = overview.data;
  const top = o?.byCategory[0];

  return (
    <>
      <PageHeader
        title="Expenses"
        subtitle="What the business spends, by category."
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            New expense
          </Button>
        }
      />
      {(list.error || overview.error) && <ErrorNote>{list.error ?? overview.error}</ErrorNote>}

      {none ? (
        <Card>
          <EmptyState icon={<Receipt className="h-6 w-6" />} title="No expenses yet" body="Record rent, raw materials, wages and the rest as you spend it — the dashboard then shows what came in against what went out." actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>New expense</Button>} />
        </Card>
      ) : (
        <>
          <div className="mb-8 grid grid-cols-3 gap-6">
            <Figure label="Spent" sub={o ? plural(o.count, 'expense') : ' '} highlight>
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
            <div className="w-40">
              <Select value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Period">
                {PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {label(p)}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <Card className="overflow-x-auto">
            {list.loading ? (
              <TableSkeleton />
            ) : list.data?.length === 0 ? (
              <EmptyState icon={<SearchX className="h-6 w-6" />} title="No expenses match" body="Try a different search, category or period." actions={<Button onClick={() => { setSearch(''); setCategory(''); setPeriod('all'); }}>Clear filters</Button>} />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className="th">Date</th>
                    <th className="th">Category</th>
                    <th className="th">Paid to</th>
                    <th className="th">Paid by</th>
                    <th className="th text-right">Amount</th>
                    <th className="w-24" />
                  </tr>
                </thead>
                <tbody>
                  {list.data?.map((e) => (
                    <tr key={e.id} className="animate-fade-in border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas">
                      <td className="td num whitespace-nowrap text-ink-muted">{formatDate(e.date)}</td>
                      <td className="td">{e.category}</td>
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
                      </td>
                      <td className="td">
                        <div className="flex justify-end gap-0.5">
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
          {list.data && list.data.length > 0 && <p className="mt-3 text-xs text-ink-muted">Showing {plural(list.data.length, 'expense')}</p>}
        </>
      )}

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
            toast.success('Expense deleted');
          }}
        />
      )}
    </>
  );
}
