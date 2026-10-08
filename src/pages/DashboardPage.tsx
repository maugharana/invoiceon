import { AlertCircle, ChevronDown, Clock, FileText, HandCoins, Hourglass, Plus, Receipt, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { todayIso } from '../../shared/gst';
import { onboardingDone, onboardingSteps } from '../../shared/onboarding';
import { defaultLayout, normaliseLayout, splitSections, type DashboardLayout, type DashboardSectionId } from '../../shared/dashboardLayout';
import { formatMoney } from '../../shared/money';
import { COMPARE_LABEL, COMPARE_OPTIONS, PERIOD_LABEL, resolvePeriod, type CompareWith, type PeriodPreset } from '../../shared/periods';
import { AgingChart, ChartCard, C_EXPENSES, C_INVOICED, C_RECEIVED, RankedBars, TrendChart } from '../components/charts';
import { SalesChart } from '../components/SalesChart';
import { Button, Card, EmptyState, ErrorNote, Money, PageHeader, Select } from '../components/ui';
import { useQuickCreate } from '../components/QuickCreate';
import { api } from '../lib/api';
import { useQuery } from '../lib/data';
import { plural } from '../lib/format';
import { bucketLabel } from '../components/SalesChart';
import { navigate, paths } from '../lib/router';
import type { DashboardOverview } from '../../shared/types';
import { LowStockCard, OpenQuotesCard } from './dashboard/ActionCards';
import { AttentionCard } from './dashboard/AttentionCard';
import { CustomizeModal } from './dashboard/CustomizeModal';
import { OnboardingCard } from './dashboard/OnboardingCard';
import { FestivalCard } from './dashboard/FestivalCard';
import { GstCard } from './dashboard/GstCard';
import { PaymentMixCard } from './dashboard/PaymentMixCard';
import { ProfitCard } from './dashboard/ProfitCard';
import { RecentInvoicesCard } from './dashboard/RecentInvoicesCard';
import { BestSellersCard, DeadStockCard } from './dashboard/SellersCards';
import { Delta, StatCard } from './dashboard/StatCard';
import { TargetCard } from './dashboard/TargetCard';
import { TodayStrip } from './dashboard/TodayStrip';

type Period = 'all' | Exclude<PeriodPreset, 'custom'>;
const PERIODS: Period[] = ['all', 'this-month', 'last-month', 'this-quarter', 'this-fy', 'last-fy'];
const periodLabel = (p: Period) => (p === 'all' ? 'All time' : PERIOD_LABEL[p]);
const STORE_KEY = 'invoiceon.dashboard.period';
const COMPARE_KEY = 'invoiceon.dashboard.compare';
const LAYOUT_KEY = 'invoiceon.dashboard.layout';
const ONBOARDING_KEY = 'invoiceon.onboarding.dismissed';
const MORE_KEY = 'invoiceon.dashboard.more';

function loadPeriod(): Period {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return PERIODS.includes(v as Period) ? (v as Period) : 'all';
  } catch {
    return 'all';
  }
}

function loadCompare(): CompareWith {
  try {
    const v = localStorage.getItem(COMPARE_KEY);
    return COMPARE_OPTIONS.includes(v as CompareWith) ? (v as CompareWith) : 'previous';
  } catch {
    return 'previous';
  }
}

function loadLayout(): DashboardLayout {
  try {
    return normaliseLayout(JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null'));
  } catch {
    return defaultLayout();
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

/** What each part under "More detail" is called in the one line that says what is inside. */
const DETAIL_NAME: Partial<Record<DashboardSectionId, string>> = {
  money: 'profit and GST',
  speed: 'payment speed',
  charts: 'charts',
  insights: 'best sellers',
  mix: 'how customers paid',
};

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
  const [compare, setCompareState] = useState<CompareWith>(loadCompare);
  const setCompare = (c: CompareWith) => {
    setCompareState(c);
    try {
      localStorage.setItem(COMPARE_KEY, c);
    } catch {
      /* remembering the choice is a nicety */
    }
  };
  const [layout, setLayoutState] = useState<DashboardLayout>(loadLayout);
  const [customizing, setCustomizing] = useState(false);
  const setLayout = (l: DashboardLayout) => {
    setLayoutState(l);
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(l));
    } catch {
      /* remembering the choice is a nicety */
    }
  };
  // The analysis sits under "More detail", closed until asked for. The choice is remembered.
  const [showMore, setShowMoreState] = useState(() => {
    try {
      return localStorage.getItem(MORE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const setShowMore = (v: boolean) => {
    setShowMoreState(v);
    try {
      localStorage.setItem(MORE_KEY, v ? '1' : '0');
    } catch {
      /* remembering the choice is a nicety */
    }
  };
  const range = useMemo(() => rangeFor(period), [period]);
  const [onboardingHidden, setOnboardingHidden] = useState(() => {
    try {
      return localStorage.getItem(ONBOARDING_KEY) === '1';
    } catch {
      return false;
    }
  });
  const hideOnboarding = () => {
    setOnboardingHidden(true);
    try {
      localStorage.setItem(ONBOARDING_KEY, '1');
    } catch {
      /* hiding it for this visit is enough */
    }
  };

  const overview = useQuery(() => api.dashboardOverview(range, compare), [period, compare]);
  const inventory = useQuery(() => api.inventorySummary());
  const lowDesigns = useQuery(() => api.designsList({ status: 'low' }));
  const openQuotes = useQuery(() => api.proformasList({ status: 'open' }));
  const settings = useQuery(() => api.getSettings());
  const now = useQuery(() => api.dashboardNow());
  const everyone = useQuery(() => api.customersList());
  const summary = useQuery(() => api.dashboardSummary());
  const o = overview.data;

  // Charts want the same series in the shape the shared sales chart already draws.
  const invoiceSeries = useMemo(() => (o?.trend ?? []).map((t) => ({ key: t.key, invoicedPaise: t.invoicedPaise, collectedPaise: t.receivedPaise, invoices: 0 })), [o]);
  const sparkInvoiced = useMemo(() => (o?.trend ?? []).map((t) => t.invoicedPaise), [o]);
  const sparkReceived = useMemo(() => (o?.trend ?? []).map((t) => t.receivedPaise), [o]);

  const owner = settings.data?.ownerName.split(' ')[0];
  const scope = periodLabel(period).toLowerCase();
  const brandNew = o?.invoiceCount === 0 && o.expensesPaise === 0 && (o?.recent.length ?? 0) === 0;
  const businessName = settings.data?.businessName ?? '';
  // Only once everything has loaded, so the list doesn't flash up for a shop that has long since done all of it.
  const steps =
    settings.data && inventory.data && everyone.data && summary.data
      ? onboardingSteps(settings.data, { designs: inventory.data.designCount, customers: everyone.data.length, invoices: summary.data.recent.length })
      : null;

  // Each part of the page, so the owner can switch them off and reorder them (Customize).
  const sections: Record<DashboardSectionId, ReactNode> = {
    attention: now.data && <AttentionCard items={now.data.attention} />,
    today: now.data && <TodayStrip today={now.data.today} />,
    figures: (
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          index={0}
          label="Total invoiced"
          icon={FileText}
          value={<Money paise={o?.invoicedPaise ?? 0} fractionDigits={0} />}
          sub={o ? `${plural(o.invoiceCount, 'invoice')} · ${scope}` : ' '}
          spark={sparkInvoiced}
          sparkColor={C_INVOICED}
          delta={o?.previous ? <Delta now={o.invoicedPaise} before={o.previous.invoicedPaise} compare={compare} /> : undefined}
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
          delta={o?.previous ? <Delta now={o.receivedPaise} before={o.previous.receivedPaise} compare={compare} /> : undefined}
          onClick={() => navigate(paths.payments)}
        />
        <StatCard
          index={2}
          label="Outstanding"
          icon={Hourglass}
          tone="amber"
          value={<Money paise={o?.outstandingPaise ?? 0} fractionDigits={0} />}
          sub={o ? (o.openInvoices === 0 ? 'Nothing owed right now' : `${plural(o.openInvoices, 'unpaid invoice')}`) : ' '}
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
    ),
    money: (
      <div className="grid grid-cols-3 gap-4">
        {o && <ProfitCard overview={o} compare={compare} scope={scope} index={4} />}
        {now.data && <GstCard month={now.data.month} index={5} />}
        {now.data && <TargetCard month={now.data.month} />}
      </div>
    ),
    speed: (
      <div className="animate-fade-up stagger flex items-center gap-4 rounded-lg border border-line bg-surface px-6 py-4 shadow-card" style={{ ['--i' as string]: 6 } as React.CSSProperties}>
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
    ),
    charts: (
      <div>
        <h2 className="mb-4 mt-4 text-lg">Analytics</h2>
        <div className="space-y-4">
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

          <div className="grid grid-cols-2 gap-4">
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
        </div>
      </div>
    ),
    insights: (
      <div className="grid grid-cols-2 gap-4">
        <BestSellersCard sellers={o?.bestSellers ?? []} scope={scope} />
        {now.data && <DeadStockCard stock={now.data.deadStock} />}
      </div>
    ),
    mix: (
      <div className="grid grid-cols-2 gap-4">
        <PaymentMixCard methods={o?.receivedByMethod ?? []} scope={scope} />
        <FestivalCard />
      </div>
    ),
    activity: (
      <div className="grid grid-cols-[1.4fr_1fr] gap-4">
        <RecentInvoicesCard invoices={o?.recent ?? []} loaded={!!o} />
        <div className="space-y-4">
          <LowStockCard designs={lowDesigns.data ?? []} businessName={businessName} />
          <OpenQuotesCard quotes={openQuotes.data ?? []} businessName={businessName} template={settings.data?.msgQuote ?? ''} onNew={() => start('proforma')} />
        </div>
      </div>
    ),
  };

  // Until the first invoice, expense or payment exists most sections would only show zeros, so only the recent-activity row stays.
  const { main, detail } = splitSections(layout);
  const shownMain = main.filter((id) => !brandNew || id === 'activity');
  const shownDetail = brandNew ? [] : detail;
  const detailNames = shownDetail.map((id) => DETAIL_NAME[id]).filter(Boolean).join(', ');

  return (
    <>
      <PageHeader
        title={`${greeting()}${owner ? `, ${owner}` : ''}`}
        subtitle={`${settings.data?.businessName ?? ''} · ${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}`}
        actions={
          <>
            {period !== 'all' && (
              <div className="w-52">
                <Select value={compare} onChange={(e) => setCompare(e.target.value as CompareWith)} aria-label="Compare with">
                  {COMPARE_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      vs {COMPARE_LABEL[c].toLowerCase()}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div className="w-40">
              <Select value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Period">
                {PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {periodLabel(p)}
                  </option>
                ))}
              </Select>
            </div>
            <Button icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setCustomizing(true)} title="Choose what the dashboard shows, and in what order">
              Customize
            </Button>
          </>
        }
      />
      {overview.error && <ErrorNote>{overview.error}</ErrorNote>}
      {steps && !onboardingHidden && !onboardingDone(steps) && <OnboardingCard steps={steps} onDismiss={hideOnboarding} />}

      {o && !brandNew && (
        <p className="animate-fade-up -mt-3 mb-6 flex items-start gap-2.5 text-ink">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden />
          <span>{briefing(o, inventory.data?.lowStockDesigns ?? 0, openQuotes.data?.length ?? 0)}</span>
        </p>
      )}

      {brandNew && (
        <Card className="mb-6">
          <EmptyState
            icon={<FileText className="h-6 w-6" />}
            title="Your dashboard fills in as you work"
            body="Issue an invoice, record a payment or log an expense and the figures and charts appear here. The arrow beside New invoice (top right) creates anything in one click; Ctrl K finds anything."
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
      )}

      {shownMain.length === 0 && shownDetail.length === 0 && !brandNew ? (
        <Card>
          <EmptyState
            icon={<SlidersHorizontal className="h-6 w-6" />}
            title="Everything is hidden"
            body="You've switched every section off. Customize the dashboard to bring some back."
            actions={<Button onClick={() => setCustomizing(true)}>Customize</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {shownMain.map((id) => (
            <div key={id}>{sections[id]}</div>
          ))}
          {shownDetail.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowMore(!showMore)}
                aria-expanded={showMore}
                className="group flex w-full items-center gap-3 rounded-lg border border-line bg-surface px-5 py-3 text-left transition-colors duration-150 hover:border-ink/25"
              >
                <ChevronDown className={`h-4 w-4 shrink-0 text-ink-muted transition-transform duration-200 ${showMore ? 'rotate-180' : ''}`} aria-hidden />
                <span className="font-medium">{showMore ? 'Hide detail' : 'More detail'}</span>
                <span className="min-w-0 flex-1 truncate text-ink-muted">{detailNames}</span>
              </button>
              {showMore && shownDetail.map((id) => <div key={id}>{sections[id]}</div>)}
            </>
          )}
        </div>
      )}

      {customizing && <CustomizeModal layout={layout} onSave={setLayout} onClose={() => setCustomizing(false)} />}
    </>
  );
}
