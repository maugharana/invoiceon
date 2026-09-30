import { BarChart3, Boxes, ClipboardList, CornerDownLeft, FileText, LayoutDashboard, Receipt, Search, Settings as SettingsIcon, Shirt, UserRound, Users, Wallet, type LucideIcon } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { matchesAll } from '../../shared/search';
import type { Customer, DesignSummary, InvoiceSummary, ProformaSummary } from '../../shared/types';
import { api } from '../lib/api';
import { navigate, paths } from '../lib/router';
import { QUICK_ITEMS, useQuickCreate } from './QuickCreate';

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  /** Extra words that should find it. */
  keywords?: string;
  shortcut?: string;
  run: () => void;
}

const PaletteContext = createContext<{ open: () => void }>({ open: () => {} });
export const useCommandPalette = () => useContext(PaletteContext);

interface Records {
  customers: Customer[];
  invoices: InvoiceSummary[];
  proformas: ProformaSummary[];
  designs: DesignSummary[];
}

const GROUP_ORDER = ['Create', 'Go to', 'Customers', 'Invoices', 'Proformas', 'Designs'];
const PER_GROUP = 5;

/**
 * Ctrl+K from anywhere: type a few letters to create something, jump to a page, or open any customer, invoice, proforma or design.
 * Records are fetched when it opens, so it is never stale and costs nothing while closed.
 */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo(() => ({ open }), [open]);
  return (
    <PaletteContext.Provider value={value}>
      {children}
      {isOpen && <Palette onClose={() => setIsOpen(false)} />}
    </PaletteContext.Provider>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const { start } = useQuickCreate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [records, setRecords] = useState<Records | null>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.customersList(), api.invoicesList(), api.proformasList(), api.designsList()])
      .then(([customers, invoices, proformas, designs]) => !cancelled && setRecords({ customers, invoices, proformas, designs }))
      .catch(() => !cancelled && setRecords({ customers: [], invoices: [], proformas: [], designs: [] }));
    return () => {
      cancelled = true;
    };
  }, []);

  const go = (path: string) => () => navigate(path);

  const commands = useMemo<Command[]>(() => {
    const create: Command[] = QUICK_ITEMS.map((q) => ({ id: `create-${q.kind}`, group: 'Create', label: q.label, icon: q.icon, keywords: 'add new create', run: () => start(q.kind) }));
    const pages: [string, string, LucideIcon, string?][] = [
      ['Dashboard', paths.dashboard, LayoutDashboard],
      ['Inventory', paths.inventory(), Boxes, 'designs stock sarees'],
      ['Raw materials', paths.materials, Boxes, 'yarn zari costs'],
      ['Add sarees', paths.addSarees, Shirt, 'bulk sheet designs new stock import'],
      ['Invoices', paths.invoices(), FileText],
      ['Credit notes', paths.creditNotes, FileText, 'returns refund adjustment'],
      ['Proformas', paths.proformas(), ClipboardList, 'quotes quotations'],
      ['Customers', paths.customers, Users],
      ['Payments', paths.payments, Wallet],
      ['Dues', paths.dues, Wallet, 'outstanding overdue owed'],
      ['Expenses', paths.expenses(), Receipt, 'spending costs'],
      ['Sales report', paths.reports('sales'), BarChart3],
      ['GST report', paths.reports('gst'), BarChart3, 'tax gstr'],
      ['Stock valuation', paths.reports('stock'), BarChart3],
      ['Settings', paths.settingsSection('business'), SettingsIcon],
      ['Invoice settings', paths.settingsSection('invoice'), SettingsIcon, 'pdf logo colour prefix'],
      ['Data management', paths.settingsSection('data'), SettingsIcon, 'backup restore'],
    ];
    const rec = records;
    return [
      ...create,
      ...pages.map(([label, path, icon, keywords]): Command => ({ id: `go-${path}`, group: 'Go to', label, icon, keywords, run: go(path) })),
      ...(rec?.customers ?? []).map((c): Command => ({ id: `c-${c.id}`, group: 'Customers', label: c.name, hint: [c.phone, c.city].filter(Boolean).join(' · '), icon: UserRound, keywords: c.gstin, run: go(paths.customer(c.id)) })),
      ...(rec?.invoices ?? []).map((i): Command => ({ id: `i-${i.id}`, group: 'Invoices', label: i.number, hint: i.buyerName, icon: FileText, run: go(paths.invoice(i.id)) })),
      ...(rec?.proformas ?? []).map((p): Command => ({ id: `p-${p.id}`, group: 'Proformas', label: p.number, hint: p.buyerName, icon: ClipboardList, run: go(paths.proforma(p.id)) })),
      ...(rec?.designs ?? []).map((d): Command => ({ id: `d-${d.id}`, group: 'Designs', label: d.name, hint: `${d.code} · ${d.fabric}`, icon: Shirt, run: go(paths.design(d.id)) })),
    ];
  }, [records, start]);

  // Nothing typed: just the actions and pages. Typing searches everything, a few per group.
  const results = useMemo(() => {
    const q = query.trim();
    const pool = q ? commands.filter((c) => matchesAll(`${c.label} ${c.hint ?? ''} ${c.keywords ?? ''}`, q)) : commands.filter((c) => c.group === 'Create' || c.group === 'Go to');
    return GROUP_ORDER.flatMap((g) => pool.filter((c) => c.group === g).slice(0, q ? PER_GROUP : 20));
  }, [commands, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, results]);

  const choose = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  let lastGroup = '';
  return createPortal(
    <div className="animate-fade-in fixed inset-0 z-[60] flex items-start justify-center bg-ink/25 px-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown} className="animate-pop-in w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-overlay">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customers, invoices, designs — or create something…"
            aria-label="Search or run a command"
            role="combobox"
            aria-expanded
            aria-controls="palette-results"
            className="h-12 w-full bg-transparent text-base placeholder:text-ink-muted/60 focus:outline-none"
          />
          <kbd className="rounded-md bg-canvas px-1.5 py-0.5 text-[11px] text-ink-muted">Esc</kbd>
        </div>
        <ul id="palette-results" ref={list} role="listbox" className="max-h-[52vh] overflow-y-auto py-2">
          {results.length === 0 && <li className="px-4 py-8 text-center text-ink-muted">{records ? `Nothing matches “${query.trim()}”.` : 'Loading…'}</li>}
          {results.map((c, i) => {
            const header = c.group !== lastGroup;
            lastGroup = c.group;
            return (
              <li key={c.id} role="none">
                {header && <div className="px-4 pb-1 pt-3 text-[11px] uppercase tracking-wider text-ink-muted first:pt-1">{c.group}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  data-active={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(c)}
                  className={`flex w-full items-center gap-3 border-l-2 px-4 py-2 text-left transition-colors duration-100 ${i === active ? 'border-brand bg-brand-tint' : 'border-transparent'}`}
                >
                  <c.icon className={`h-4 w-4 shrink-0 ${i === active ? 'text-brand' : 'text-ink-muted'}`} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="num">{c.label}</span>
                    {c.hint && <span className="ml-2 text-ink-muted">{c.hint}</span>}
                  </span>
                  {i === active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-4 border-t border-line bg-canvas px-4 py-2 text-xs text-ink-muted">
          <span>↑ ↓ to move</span>
          <span>Enter to open</span>
          <span className="ml-auto">Ctrl K anywhere</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
