import { BarChart3, Boxes, ClipboardList, FileText, LayoutDashboard, Plus, Receipt, Search, Settings as SettingsIcon, Truck, Users, Wallet, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { useQuery } from '../lib/data';
import { navigate, paths, type Section } from '../lib/router';
import { CommandPaletteProvider, useCommandPalette } from './CommandPalette';
import { QuickCreateFab, QuickCreateProvider } from './QuickCreate';
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
    <div className="flex h-14 shrink-0 items-center justify-between gap-6 border-b border-line bg-surface px-5">
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
      <Button variant="primary" title="New invoice (Ctrl+N)" icon={<Plus className="h-4 w-4" />} onClick={() => navigate(paths.newInvoice())}>
        New invoice
      </Button>
    </div>
  );
}

const NAV: { section: Section; label: string; icon: LucideIcon }[] = [
  { section: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { section: 'inventory', label: 'Inventory', icon: Boxes },
  { section: 'invoices', label: 'Invoices', icon: FileText },
  { section: 'proformas', label: 'Proformas', icon: ClipboardList },
  { section: 'customers', label: 'Customers', icon: Users },
  { section: 'payments', label: 'Payments', icon: Wallet },
  { section: 'purchases', label: 'Purchases', icon: Truck },
  { section: 'expenses', label: 'Expenses', icon: Receipt },
  { section: 'reports', label: 'Reports', icon: BarChart3 },
];

export function Sidebar({ active }: { active: Section }) {
  const settings = useQuery(() => api.getSettings());
  const summary = useQuery(() => api.inventorySummary());
  const dash = useQuery(() => api.dashboardSummary());
  // Settings → Notifications decides which of these counts are shown.
  const lowStock = settings.data?.notifyLowStock === false ? 0 : (summary.data?.lowStockDesigns ?? 0);
  const overdue = settings.data?.notifyOverdue === false ? 0 : (dash.data?.overdueCount ?? 0);

  // One highlight that glides to whichever page you're on, instead of each item lighting up on its own.
  const list = useRef<HTMLUListElement>(null);
  const [marker, setMarker] = useState<{ top: number; height: number } | null>(null);
  const [glide, setGlide] = useState(false);
  useLayoutEffect(() => {
    const el = list.current?.querySelector<HTMLElement>('[aria-current="page"]');
    setMarker(el ? { top: el.offsetTop, height: el.offsetHeight } : null);
  }, [active]);
  useEffect(() => {
    const t = requestAnimationFrame(() => setGlide(true)); // not on first paint, so it doesn't slide in from nowhere
    return () => cancelAnimationFrame(t);
  }, []);

  return (
    <nav aria-label="Main" className="flex w-56 shrink-0 flex-col border-r border-line bg-surface px-3 py-4">
      <ul ref={list} className="relative space-y-0.5">
        <span
          aria-hidden
          className={`absolute left-0 right-0 top-0 rounded-lg bg-brand-tint ${glide ? 'transition-[transform,height,opacity] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]' : ''}`}
          style={{ transform: `translateY(${marker?.top ?? 0}px)`, height: marker?.height ?? 0, opacity: marker ? 1 : 0 }}
        >
          <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-brand" />
        </span>
        {NAV.map(({ section, label, icon: Icon }) => {
          const isActive = section === active;
          return (
            <li key={section}>
              <a
                href={`#${paths.section(section)}`}
                aria-current={isActive ? 'page' : undefined}
                className={`relative flex h-9 items-center gap-3 rounded-lg px-3 transition-colors duration-150 ${isActive ? 'font-medium text-brand' : 'text-ink-muted hover:bg-ink/5 hover:text-ink'}`}
              >
                <Icon className="h-[18px] w-[18px]" aria-hidden />
                <span className="flex-1">{label}</span>
                {section === 'inventory' && lowStock > 0 && (
                  <span className="num rounded-full bg-status-partial-bg px-1.5 text-xs text-status-partial-fg" title={`${lowStock} designs low on stock`}>
                    {lowStock}
                  </span>
                )}
                {section === 'payments' && overdue > 0 && (
                  <span className="num rounded-full bg-status-overdue-bg px-1.5 text-xs text-status-overdue-fg" title={`${overdue} overdue invoices`}>
                    {overdue}
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto space-y-3 pt-4">
        <a
          href={`#${paths.settings}`}
          aria-current={active === 'settings' ? 'page' : undefined}
          className={`flex h-9 items-center gap-3 rounded-lg px-3 transition-colors duration-150 ${active === 'settings' ? 'bg-brand-tint font-medium text-brand' : 'text-ink-muted hover:bg-ink/5 hover:text-ink'}`}
        >
          <SettingsIcon className="h-[18px] w-[18px]" aria-hidden />
          Settings
        </a>
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

  // Ctrl+N: new invoice, from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        navigate(paths.newInvoice());
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <QuickCreateProvider>
      <CommandPaletteProvider>
        <div className="flex h-full flex-col">
          <TopBar />
          <div className="flex min-h-0 flex-1">
            <Sidebar active={active} />
            <main ref={main} tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto outline-none">
              <div key={pageKey} className="animate-fade-up mx-auto max-w-6xl px-8 pb-28 pt-9">
                {children}
              </div>
            </main>
          </div>
        </div>
        <QuickCreateFab hidden={hideFab} />
      </CommandPaletteProvider>
    </QuickCreateProvider>
  );
}
