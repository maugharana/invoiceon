import { AlertCircle, ArrowDownRight, ArrowUpRight, ChevronRight, ClipboardList, Clock, FileText, HandCoins, Hourglass, Plus, Receipt, Sparkles, type LucideIcon } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { formatDate, todayIso } from '../../shared/gst';
import { formatMoney } from '../../shared/money';
import { PERIOD_LABEL, resolvePeriod, type PeriodPreset } from '../../shared/periods';
import { AgingChart, ChartCard, C_EXPENSES, C_INVOICED, C_RECEIVED, RankedBars, Sparkline, TrendChart } from '../components/charts';
import { SalesChart } from '../components/SalesChart';
import { Button, Card, EmptyState, ErrorNote, InvoicePill, Money, PageHeader, Select, TypePill, rolling } from '../components/ui';
import { GettingStarted } from '../components/GettingStarted';
import { useQuickCreate } from '../components/QuickCreate';
import { api } from '../lib/api';
import { useQuery } from '../lib/data';
import { plural } from '../lib/format';
import { bucketLabel } from '../components/SalesChart';
import { navigate, paths } from '../lib/router';
import type { DashboardOverview } from '../../shared/types';

type Period = 'all' | Exclude<PeriodPreset, 'custom'>;
const PERIODS: Period[] = ['all', 'this-month', 'last-month', 'this-quarter', 'this-fy', 'last-fy'];
const periodLabel = (p: Period) => (p === 'all' ? 'All time' : PERIOD_LABEL[p]);
const STORE_KEY = 'invoiceon.dashboard.period';

function loadPeriod(): Period {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return PERIODS.includes(v as Period) ? (v as Period) : 'all';
  } catch {
    return 'all';
  }
}

/** A quarter that ends in the future is shown up to today: the charts shouldn't trail off into days that haven't happened. */
function rangeFor(period: Period): { from: string; to: string } | null {
  if (period === 'all') return null;
  const r = resolvePeriod({ preset: period });
  return { from: r.from, to: r.to > todayIso() ? todayIso() : r.to };
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

/** Up or down against the period just before. Nothing is shown when there was nothing before to compare with. */
function Delta({ now, before }: { now: number; before: number | undefined }) {
  if (before === undefined || before <= 0) return null;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return <span className="text-xs text-ink-muted">Same as before</span>;
  const up = pct > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs ${up ? 'bg-status-paid-bg text-status-paid-fg' : 'bg-status-overdue-bg text-status-overdue-fg'}`} title="Compared with the period just before">
      <Icon className="h-3 w-3" aria-hidden />
      {Math.abs(pct)}%
    </span>
  );
}

function StatCard({ label, icon: Icon, tone = 'brand', value, sub, spark, sparkColor, delta, onClick, index }: { label: string; icon: LucideIcon; tone?: 'brand' | 'amber' | 'red'; value: ReactNode; sub: ReactNode; spark?: number[]; sparkColor?: string; delta?: ReactNode; onClick: () => void; index: number }) {
  const tint = tone === 'red' ? 'bg-status-overdue-bg text-status-overdue-fg' : tone === 'amber' ? 'bg-status-partial-bg text-status-partial-fg' : 'bg-brand-tint text-brand';
  return (
    <button type="button" onClick={onClick} style={{ ['--i' as string]: index } as React.CSSProperties} className="card-hover animate-fade-up stagger flex flex-col justify-start rounded-lg border border-line bg-surface p-5 text-left shadow-card">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] uppercase tracking-wider text-ink-muted">{label}</span>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tint}`}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div className="text-[26px] leading-none tracking-tight">{rolling(value)}</div>
        {spark && <Sparkline values={spark} color={sparkColor ?? C_INVOICED} width={52} />}
      </div>
      <div className="mt-3 text-xs text-ink-muted">
        <div>{sub}</div>
        <div className="mt-1.5 h-5">{delta}</div>
      </div>
    </button>
  );
}

/** One or two plain sentences on what needs doing, written from the same figures the cards show. */
function briefing(o: DashboardOverview, lowStock: number, openQuotes: number): string {
  const parts: string[] = [];
  if (o.overdueCount > 0) parts.push(`${formatMoney(o.overduePaise, { fractionDigits: 0 })} is past due on ${plural(o.overdueCount, 'invoice')}`);
  else if (o.outstandingPaise > 0) parts.push(`${formatMoney(o.outstandingPaise, { fractionDigits: 0 })} is waiting on ${plural(o.openInvoices, 'invoice')}, none of it overdue`);
  else if (o.invoiceCount > 0) parts.push('Everything you have invoiced has been paid');
  if (lowStock > 0) parts.push(`${plural(lowStock, 'design')} ${lowStock === 1 ? 'is' : 'are'} low on stock`);
  if (openQuotes > 0) parts.push(`${plural(openQuotes, 'quote')} ${openQuotes === 1 ? 'is' : 'are'} waiting for an answer`);
  if (parts.length === 0) return 'Nothing needs your attention right now.';
  return `${parts.join(' · ')}.`;
}

export function DashboardPage() {
  const { start } = useQuickCreate();
  const [period, setPeriodState] = useState<Period>(loadPeriod);
  const setPeriod = (p: Period) => {
    setPeriodState(p);
    try {
      localStorage.setItem(STORE_KEY, p);
    } catch {
      /* remembering the choice is a nicety */
    }
  };
  const range = useMemo(() => rangeFor(period), [period]);

  const overview = useQuery(() => api.dashboardOverview(range), [period]);
  const inventory = useQuery(() => api.inventorySummary());
  const lowDesigns = useQuery(() => api.designsList({ status: 'low' }));
  const openQuotes = useQuery(() => api.proformasList({ status: 'open' }));
  const settings = useQuery(() => api.getSettings());
  const o = overview.data;

  // Charts want the same series in the shape the shared sales chart already draws.
  const invoiceSeries = useMemo(() => (o?.trend ?? []).map((t) => ({ key: t.key, invoicedPaise: t.invoicedPaise, collectedPaise: t.receivedPaise, invoices: 0 })), [o]);
  const sparkInvoiced = useMemo(() => (o?.trend ?? []).map((t) => t.invoicedPaise), [o]);
  const sparkReceived = useMemo(() => (o?.trend ?? []).map((t) => t.receivedPaise), [o]);

  const owner = settings.data?.ownerName.split(' ')[0];
  const scope = periodLabel(period).toLowerCase();
  const brandNew = o?.invoiceCount === 0 && o.expensesPaise === 0 && (o?.recent.length ?? 0) === 0;

  return (
    <>
      <PageHeader
        title={`${greeting()}${owner ? `, ${owner}` : ''}`}
        subtitle={`${settings.data?.businessName ?? ''} · ${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}`}
        actions={
          <div className="w-40">
            <Select value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Period">
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {periodLabel(p)}
                </option>
              ))}
            </Select>
          </div>
        }
      />
      {overview.error && <ErrorNote>{overview.error}</ErrorNote>}

      <GettingStarted />

      {o && !brandNew && (
        <p className="animate-fade-up -mt-3 mb-6 flex items-start gap-2.5 text-ink">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden />
          <span>{briefing(o, inventory.data?.lowStockDesigns ?? 0, openQuotes.data?.length ?? 0)}</span>
        </p>
      )}

      {brandNew ? (
        <Card className="mb-6">
          <EmptyState
            icon={<FileText className="h-6 w-6" />}
            title="Your dashboard fills in as you work"
            body="Issue an invoice, record a payment or log an expense and the figures and charts appear here. The + button (bottom right) creates anything in one click; Ctrl K finds anything."
            actions={
              <>
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => start('invoice')}>
                  New invoice
                </Button>
                <Button onClick={() => start('customer')}>Add a customer</Button>
              </>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-4">
            <StatCard
              index={0}
              label="Total invoiced"
              icon={FileText}
              value={<Money paise={o?.invoicedPaise ?? 0} fractionDigits={0} />}
              sub={o ? `${plural(o.invoiceCount, 'invoice')} · ${scope}` : ' '}
              spark={sparkInvoiced}
              sparkColor={C_INVOICED}
              delta={o?.previous ? <Delta now={o.invoicedPaise} before={o.previous.invoicedPaise} /> : undefined}
              onClick={() => navigate(paths.invoices())}
            />
            <StatCard
              index={1}
              label="Received"
              icon={HandCoins}
              value={<Money paise={o?.receivedPaise ?? 0} fractionDigits={0} />}
              sub={o ? `${plural(o.paymentCount, 'payment')} · ${scope}` : ' '}
              spark={sparkReceived}
              sparkColor={C_RECEIVED}
              delta={o?.previous ? <Delta now={o.receivedPaise} before={o.previous.receivedPaise} /> : undefined}
              onClick={() => navigate(paths.payments)}
            />
            <StatCard
              index={2}
              label="Outstanding"
              icon={Hourglass}
              tone="amber"
              value={<Money paise={o?.outstandingPaise ?? 0} fractionDigits={0} />}
              sub={o ? (o.openInvoices === 0 ? 'Nothing owed on these invoices' : `${plural(o.openInvoices, 'unpaid invoice')}`) : ' '}
              onClick={() => navigate(paths.dues)}
            />
            <StatCard
              index={3}
              label="Overdue"
              icon={AlertCircle}
              tone={o && o.overdueCount > 0 ? 'red' : 'brand'}
              value={<Money paise={o?.overduePaise ?? 0} fractionDigits={0} />}
              sub={o ? (o.overdueCount === 0 ? 'Nothing overdue' : `${plural(o.overdueCount, 'invoice')} past due`) : ' '}
              onClick={() => navigate(o && o.overdueCount > 0 ? paths.invoices('overdue') : paths.dues)}
            />
          </div>

          <div className="animate-fade-up stagger mt-4 flex items-center gap-4 rounded-lg border border-line bg-surface px-6 py-4 shadow-card" style={{ ['--i' as string]: 4 } as React.CSSProperties}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-tint text-brand">
              <Clock className="h-4 w-4" aria-hidden />
            </span>
            <p className="flex-1 text-ink-muted">
              <span className="text-ink">Average payment time:</span>{' '}
              {o?.avgPaymentDays == null ? (
                'no invoice has been paid in full in this period yet.'
              ) : (
                <>
                  {o.avgPaymentDays < 0.5 ? (
                    <>your customers pay <span className="num text-ink">on the day</span>, across {plural(o.paidInvoiceCount, 'paid invoice')}.</>
                  ) : (
                    <>your customers take an average of <span className="num text-ink">{plural(Math.round(o.avgPaymentDays), 'day')}</span> to pay, across {plural(o.paidInvoiceCount, 'paid invoice')}.</>
                  )}
                </>
              )}
            </p>
            <button type="button" onClick={() => navigate(paths.expenses())} className="shrink-0 rounded-lg px-3 py-1.5 text-right transition-colors hover:bg-canvas">
              <div className="text-[11px] uppercase tracking-wider text-ink-muted">Spent · {scope}</div>
              <Money paise={o?.expensesPaise ?? 0} fractionDigits={0} />
            </button>
          </div>

          <h2 className="mb-4 mt-10 text-lg">Analytics</h2>
          <div className="grid grid-cols-2 gap-4">
            <ChartCard
              title="Outstanding invoice aging"
              subtitle={o ? `Total ${formatMoney(o.aging.reduce((s, b) => s + b.paise, 0), { fractionDigits: 0 })} owed today, by how old the invoice is` : undefined}
              table={{ columns: ['Age', 'Invoices', 'Owed'], rows: (o?.aging ?? []).map((b) => [b.label, String(b.count), formatMoney(b.paise)]) }}
            >
              <AgingChart buckets={o?.aging ?? []} />
            </ChartCard>
            <ChartCard title="Top clients" subtitle={`Revenue by client · ${scope}`} table={{ columns: ['Client', 'Invoiced'], rows: (o?.topClients ?? []).map((c) => [c.name, formatMoney(c.invoicedPaise)]) }}>
              <RankedBars
                color={C_INVOICED}
                rows={(o?.topClients ?? []).map((c) => ({ key: c.customerId ?? 'walk-in', label: c.name, paise: c.invoicedPaise }))}
                onPick={(key) => navigate(key === 'walk-in' ? paths.invoices() : paths.customer(key))}
                empty={<>No invoices in this period.</>}
              />
            </ChartCard>
          </div>

          <ChartCard
            className="mt-4"
            title="Revenue trend"
            subtitle="Payments received against expenses over time"
            legend={[
              { color: C_RECEIVED, label: 'Received' },
              { color: C_EXPENSES, label: 'Expenses' },
            ]}
            table={{ columns: ['Period', 'Received', 'Expenses'], rows: (o?.trend ?? []).map((t) => [bucketLabel(t.key, o!.granularity, true), formatMoney(t.receivedPaise), formatMoney(t.expensesPaise)]) }}
          >
            <TrendChart points={o?.trend ?? []} granularity={o?.granularity ?? 'month'} />
          </ChartCard>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <ChartCard title="Invoice trend" subtitle="Invoiced against received" table={{ columns: ['Period', 'Invoiced', 'Received'], rows: (o?.trend ?? []).map((t) => [bucketLabel(t.key, o!.granularity, true), formatMoney(t.invoicedPaise), formatMoney(t.receivedPaise)]) }}>
              <SalesChart series={invoiceSeries} granularity={o?.granularity ?? 'month'} collectedLabel="Received" compactLegend />
            </ChartCard>
            <ChartCard title="Expenses by category" subtitle={`Where the money went · ${scope}`} table={{ columns: ['Category', 'Spent'], rows: (o?.expensesByCategory ?? []).map((c) => [c.category, formatMoney(c.paise)]) }}>
              <RankedBars
                color={C_EXPENSES}
                rows={(o?.expensesByCategory ?? []).slice(0, 6).map((c) => ({ key: c.category, label: c.category, paise: c.paise }))}
                onPick={(key) => navigate(paths.expenses(key))}
                empty={
                  <>
                    <Receipt className="h-8 w-8 text-ink-muted/60" aria-hidden />
                    No expenses for the selected period
                    <Button className="h-8 text-xs" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => start('expense')}>
                      New expense
                    </Button>
                  </>
                }
              />
            </ChartCard>
          </div>
        </>
      )}

      <div className="mt-4 grid grid-cols-[1.4fr_1fr] gap-4">
        <Card className="overflow-hidden shadow-card">
          <div className="flex items-center justify-between border-b border-line px-6 py-4">
            <h2 className="text-base">Recent invoices</h2>
            {o && o.recent.length > 0 && (
              <a href={`#${paths.invoices()}`} className="text-brand transition-colors hover:text-brand-hover">
                View all
              </a>
            )}
          </div>
          {o && o.recent.length === 0 ? (
            <EmptyState icon={<FileText className="h-6 w-6" />} title="No invoices yet" body="Invoices you issue will appear here with their payment status." />
          ) : (
            <ul>
              {o?.recent.map((i) => (
                <li key={i.id} className="animate-fade-in border-b border-line/70 last:border-0">
                  <button type="button" onClick={() => navigate(paths.invoice(i.id))} className="group flex w-full items-center gap-4 px-6 py-3.5 text-left transition-colors duration-150 hover:bg-canvas">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="num">{i.number}</span>
                        {i.type === 'B2B' && <TypePill type="B2B" />}
                      </div>
                      <div className="truncate text-xs text-ink-muted">
                        {i.buyerName} · <span className="num">{formatDate(i.issueDate)}</span>
                      </div>
                    </div>
                    <Money paise={i.totalPaise} className={i.status === 'cancelled' ? 'text-ink-muted line-through' : ''} />
                    <span className="w-24 text-right">
                      <InvoicePill status={i.status} />
                    </span>
                    <ChevronRight className="h-4 w-4 text-ink-muted/50 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="overflow-hidden shadow-card">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="text-base">Low on stock</h2>
              <a href={`#${paths.inventory('low')}`} className="text-brand transition-colors hover:text-brand-hover">
                View
              </a>
            </div>
            {lowDesigns.data && lowDesigns.data.length === 0 ? (
              <p className="px-5 py-6 text-ink-muted">Everything is well stocked.</p>
            ) : (
              <ul>
                {lowDesigns.data?.slice(0, 4).map((d) => (
                  <li key={d.id} className="border-b border-line/70 last:border-0">
                    <button type="button" onClick={() => navigate(paths.design(d.id))} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-canvas">
                      <span className="min-w-0 truncate">{d.name}</span>
                      <span className={`num shrink-0 text-xs ${d.status === 'out' ? 'text-status-overdue-fg' : 'text-status-partial-fg'}`}>{d.status === 'out' ? 'Out of stock' : `${d.totalStock} left`}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="overflow-hidden shadow-card">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="text-base">Open quotes</h2>
              <a href={`#${paths.proformas('open')}`} className="text-brand transition-colors hover:text-brand-hover">
                View
              </a>
            </div>
            {openQuotes.data && openQuotes.data.length === 0 ? (
              <div className="flex items-center justify-between gap-3 px-5 py-6 text-ink-muted">
                <span>No quotes waiting.</span>
                <Button className="h-8 text-xs" icon={<ClipboardList className="h-3.5 w-3.5" />} onClick={() => start('proforma')}>
                  New proforma
                </Button>
              </div>
            ) : (
              <ul>
                {openQuotes.data?.slice(0, 4).map((p) => (
                  <li key={p.id} className="border-b border-line/70 last:border-0">
                    <button type="button" onClick={() => navigate(paths.proforma(p.id))} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-canvas">
                      <span className="min-w-0">
                        <span className="block truncate">{p.buyerName}</span>
                        <span className="num block text-xs text-ink-muted">{p.number} · until {formatDate(p.validUntil)}</span>
                      </span>
                      <Money paise={p.totalPaise} fractionDigits={0} className="shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
