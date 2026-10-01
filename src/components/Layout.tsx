import { BarChart3, Boxes, CalendarDays, ClipboardList, FileText, LayoutDashboard, PanelLeftClose, PanelLeftOpen, Plus, Receipt, Search, Settings as SettingsIcon, Users, Wallet, type LucideIcon } from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { financialYear, todayIso } from '../../shared/gst';
import { CHORD_MS, goTarget, isTypingContext } from '../../shared/shortcuts';
import { api } from '../lib/api';
import { useQuery } from '../lib/data';
import { navigate, paths, type Section } from '../lib/router';
import { CommandPaletteProvider, useCommandPalette } from './CommandPalette';
import { QuickCreateFab, QuickCreateProvider } from './QuickCreate';
import { ShortcutsHelp } from './ShortcutsHelp';
import { Button } from './ui';

/** The mark. The ring around it breathes slowly: InvoiceOn is "always on", and it looks it. */
export function Logo({ size = 28, live = false }: { size?: number; live?: boolean }) {
  return (
    <span className="relative inline-flex" style={{ width: size, height: size }}>
      {live && <span aria-hidden className="animate-breathe absolute inset-0 rounded-lg bg-brand" />}
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="relative">
        <rect width="32" height="32" rx="8" fill="#0F6E56" />
        <path d="M16 8v8" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M11.2 11.6a7.6 7.6 0 1 0 9.6 0" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      </svg>
    </span>
  );
}

export function TopBar() {
  const palette = useCommandPalette();
  return (
    <div className="flex h-14 shrink-0 items-center justify-between gap-6 border-b border-line bg-surface px-5 print:hidden">
      <a href="#/dashboard" className="flex items-center gap-2.5 rounded-lg">
        <Logo live />
        <span className="text-base tracking-tight">InvoiceOn</span>
        <span className="hidden text-xs text-ink-muted sm:inline">simple, always on</span>
      </a>
      <button
        type="button"
        onClick={palette.open}
        className="group hidden h-9 w-full max-w-sm items-center gap-2.5 rounded-lg border border-line bg-canvas px-3 text-left text-ink-muted transition-[border-color,background-color] duration-150 hover:border-ink/25 hover:bg-surface md:flex"
      >
        <Search className="h-4 w-4" aria-hidden />
        <span className="flex-1">Search or create…</span>
        <kbd className="rounded-md border border-line bg-surface px-1.5 text-[11px]">Ctrl K</kbd>
      </button>
      <a href={`#${paths.reports('sales', { preset: 'this-fy' })}`} className="hidden items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:border-ink/25 hover:text-ink lg:inline-flex" title="The financial year (April to March) your invoice numbers and year reports follow. Click for this year's sales.">
        <CalendarDays className="h-3.5 w-3.5" aria-hidden />
        <span className="num">FY {financialYear(todayIso())}</span>
      </a>
      <Button variant="primary" title="New invoice (Ctrl+N)" icon={<Plus className="h-4 w-4" />} onClick={() => navigate(paths.newInvoice())}>
        New invoice
      </Button>
    </div>
  );
}

type NavItem = { section: Section; label: string; icon: LucideIcon };
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: 'Overview', items: [{ section: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  {
    label: 'Sell',
    items: [
      { section: 'invoices', label: 'Invoices', icon: FileText },
      { section: 'proformas', label: 'Proformas', icon: ClipboardList },
      { section: 'customers', label: 'Customers', icon: Users },
    ],
  },
  { label: 'Stock', items: [{ section: 'inventory', label: 'Inventory', icon: Boxes }] },
  {
    label: 'Money',
    items: [
      { section: 'payments', label: 'Payments', icon: Wallet },
      { section: 'expenses', label: 'Expenses', icon: Receipt },
    ],
  },
  { label: 'Insights', items: [{ section: 'reports', label: 'Reports', icon: BarChart3 }] },
];

const COLLAPSE_KEY = 'invoiceon.sidebar.collapsed';
function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function Sidebar({ active }: { active: Section }) {
  const settings = useQuery(() => api.getSettings());
  const summary = useQuery(() => api.inventorySummary());
  const dash = useQuery(() => api.dashboardSummary());
  // Settings → Notifications decides which of these counts are shown.
  const lowStock = settings.data?.notifyLowStock === false ? 0 : (summary.data?.lowStockDesigns ?? 0);
  const overdue = settings.data?.notifyOverdue === false ? 0 : (dash.data?.overdueCount ?? 0);

  // Narrow to icons only, for a roomier page. The choice is remembered.
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* remembering the choice is a nicety */
      }
      return !c;
    });

  // One highlight that glides to whichever page you're on, instead of each item lighting up on its own.
  const list = useRef<HTMLUListElement>(null);
  const [marker, setMarker] = useState<{ top: number; height: number } | null>(null);
  const [glide, setGlide] = useState(false);
  useLayoutEffect(() => {
    const el = list.current?.querySelector<HTMLElement>('[aria-current="page"]');
    setMarker(el ? { top: el.offsetTop, height: el.offsetHeight } : null);
  }, [active, collapsed]);
  useEffect(() => {
    const t = requestAnimationFrame(() => setGlide(true)); // not on first paint, so it doesn't slide in from nowhere
    return () => cancelAnimationFrame(t);
  }, []);

  const itemClass = (isActive: boolean) =>
    `relative flex h-9 items-center rounded-lg transition-colors duration-150 ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} ${isActive ? 'font-medium text-brand' : 'text-ink-muted hover:bg-ink/5 hover:text-ink'}`;

  return (
    <nav aria-label="Main" className={`flex shrink-0 flex-col border-r border-line bg-surface py-4 transition-[width] duration-200 print:hidden ${collapsed ? 'w-16 px-2' : 'w-56 px-3'}`}>
      <ul ref={list} className="relative">
        <span
          aria-hidden
          className={`absolute left-0 right-0 top-0 rounded-lg bg-brand-tint ${glide ? 'transition-[transform,height,opacity] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]' : ''}`}
          style={{ transform: `translateY(${marker?.top ?? 0}px)`, height: marker?.height ?? 0, opacity: marker ? 1 : 0 }}
        >
          <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-brand" />
        </span>
        {NAV_GROUPS.map((group, gi) => (
          <Fragment key={group.label}>
            {collapsed ? (
              gi > 0 && <li aria-hidden className="mx-2 my-2 h-px bg-line" />
            ) : (
              <li aria-hidden className={`px-3 pb-1 text-[11px] uppercase tracking-wider text-ink-muted/80 ${gi === 0 ? 'pt-0' : 'pt-4'}`}>
                {group.label}
              </li>
            )}
            {group.items.map(({ section, label, icon: Icon }) => {
              const isActive = section === active;
              const badge = section === 'inventory' && lowStock > 0 ? { n: lowStock, tone: 'bg-status-partial-bg text-status-partial-fg', title: `${lowStock} designs low on stock` } : section === 'payments' && overdue > 0 ? { n: overdue, tone: 'bg-status-overdue-bg text-status-overdue-fg', title: `${overdue} overdue invoices` } : null;
              return (
                <li key={section} className="mt-0.5">
                  <a href={`#${paths.section(section)}`} aria-current={isActive ? 'page' : undefined} title={collapsed ? label : undefined} aria-label={collapsed ? label : undefined} className={itemClass(isActive)}>
                    <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                    {!collapsed && <span className="flex-1">{label}</span>}
                    {badge && (
                      <span className={`num rounded-full px-1.5 text-xs ${badge.tone} ${collapsed ? 'absolute right-0.5 top-0.5 px-1 text-[10px] leading-4' : ''}`} title={badge.title}>
                        {badge.n}
                      </span>
                    )}
                  </a>
                </li>
              );
            })}
          </Fragment>
        ))}
      </ul>
      <div className="mt-auto space-y-3 pt-4">
        <a href={`#${paths.settings}`} aria-current={active === 'settings' ? 'page' : undefined} title={collapsed ? 'Settings' : undefined} aria-label={collapsed ? 'Settings' : undefined} className={`flex h-9 items-center rounded-lg transition-colors duration-150 ${collapsed ? 'justify-center' : 'gap-3 px-3'} ${active === 'settings' ? 'bg-brand-tint font-medium text-brand' : 'text-ink-muted hover:bg-ink/5 hover:text-ink'}`}>
          <SettingsIcon className="h-[18px] w-[18px] shrink-0" aria-hidden />
          {!collapsed && 'Settings'}
        </a>
        <button type="button" onClick={toggle} aria-label={collapsed ? 'Expand the menu' : 'Collapse the menu'} title={collapsed ? 'Expand the menu' : 'Collapse the menu'} className={`flex h-8 w-full items-center rounded-lg text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink ${collapsed ? 'justify-center' : 'gap-3 px-3 text-xs'}`}>
          {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <PanelLeftClose className="h-4 w-4" aria-hidden />}
          {!collapsed && 'Collapse menu'}
        </button>
        {collapsed ? (
          <div className="flex justify-center" title="Always on · your data is saved on this computer">
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="animate-breathe absolute inset-0 rounded-full bg-brand" />
              <span className="relative h-2 w-2 rounded-full bg-brand" />
            </span>
          </div>
        ) : (
          <div className="px-3 text-xs text-ink-muted">
            <div className="truncate text-ink">{settings.data?.businessName}</div>
            <div className="mt-0.5 flex items-center gap-2" title="Your data is stored on this computer and works without internet">
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="animate-breathe absolute inset-0 rounded-full bg-brand" />
                <span className="relative h-2 w-2 rounded-full bg-brand" />
              </span>
              Always on · saved locally
            </div>
            <div className="mt-0.5">InvoiceOn v0.3</div>
          </div>
        )}
      </div>
    </nav>
  );
}

export function AppShell({ active, children, pageKey, hideFab }: { active: Section; children: ReactNode; pageKey: string; hideFab?: boolean }) {
  const main = useRef<HTMLElement>(null);

  // A new page starts at the top, and keyboard focus starts in it (not wherever the last click left it).
  useEffect(() => {
    main.current?.scrollTo(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [pageKey]);

  // Ctrl+N: new invoice, from anywhere. "G" then a letter jumps to a page, and "?" lists them all. These pause while typing.
  const [help, setHelp] = useState(false);
  useEffect(() => {
    let chordAt = 0;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        navigate(paths.newInvoice());
        return;
      }
      if (isTypingContext(e.target as HTMLElement | null, e) || document.querySelector('[role="dialog"]')) return;
      if (e.key === '?') {
        e.preventDefault();
        setHelp(true);
        return;
      }
      if (chordAt && Date.now() - chordAt < CHORD_MS) {
        chordAt = 0;
        const target = goTarget(e.key);
        if (target) {
          e.preventDefault();
          navigate(target.path);
        }
        return;
      }
      chordAt = e.key.toLowerCase() === 'g' && !e.shiftKey ? Date.now() : 0;
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <QuickCreateProvider>
      <CommandPaletteProvider>
        <div className="flex h-full flex-col print:block print:h-auto">
          <TopBar />
          <div className="flex min-h-0 flex-1 print:block">
            <Sidebar active={active} />
            <main ref={main} tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto outline-none print:overflow-visible">
              <div key={pageKey} className="animate-fade-up mx-auto max-w-6xl px-8 pb-28 pt-9">
                {children}
              </div>
            </main>
          </div>
        </div>
        <QuickCreateFab hidden={hideFab} />
        {help && <ShortcutsHelp onClose={() => setHelp(false)} />}
      </CommandPaletteProvider>
    </QuickCreateProvider>
  );
}
