import { ChevronDown, ClipboardList, FileText, HandCoins, Plus, Receipt, Shirt, UserPlus, type LucideIcon } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ExpenseFormModal } from '../pages/expenses/ExpenseFormModal';
import { CustomerFormModal } from '../pages/customers/CustomerFormModal';
import { RecordPaymentModal } from '../pages/payments/RecordPaymentModal';
import { navigate, paths } from '../lib/router';

export type QuickKind = 'invoice' | 'proforma' | 'expense' | 'customer' | 'payment' | 'sarees';

interface QuickItem {
  kind: QuickKind;
  label: string;
  icon: LucideIcon;
  /** Pressed while the menu is open. */
  key: string;
}

export const QUICK_ITEMS: QuickItem[] = [
  { kind: 'invoice', label: 'New invoice', icon: FileText, key: 'i' },
  { kind: 'proforma', label: 'New proforma', icon: ClipboardList, key: 'p' },
  { kind: 'expense', label: 'New expense', icon: Receipt, key: 'e' },
  { kind: 'customer', label: 'New customer', icon: UserPlus, key: 'c' },
  { kind: 'sarees', label: 'Add sarees', icon: Shirt, key: 's' },
  { kind: 'payment', label: 'Record payment', icon: HandCoins, key: 'r' },
];

const QuickContext = createContext<{ start: (kind: QuickKind) => void }>({ start: () => {} });
export const useQuickCreate = () => useContext(QuickContext);

/**
 * "Create something" from anywhere. Invoices and proformas have pages of their own; a customer, an expense or a payment is a
 * short form, so it opens right over whatever you were looking at (the list behind refreshes when it's saved).
 */
export function QuickCreateProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<Exclude<QuickKind, 'invoice' | 'proforma' | 'sarees'> | null>(null);

  const start = useCallback((kind: QuickKind) => {
    if (kind === 'invoice') navigate(paths.newInvoice());
    else if (kind === 'proforma') navigate(paths.newProforma());
    else if (kind === 'sarees') navigate(paths.addSarees);
    else setDialog(kind);
  }, []);

  const value = useMemo(() => ({ start }), [start]);
  return (
    <QuickContext.Provider value={value}>
      {children}
      {dialog === 'expense' && <ExpenseFormModal onClose={() => setDialog(null)} />}
      {dialog === 'payment' && <RecordPaymentModal onClose={() => setDialog(null)} />}
      {dialog === 'customer' && (
        <CustomerFormModal
          onClose={() => setDialog(null)}
          onSaved={(c) => {
            setDialog(null);
            navigate(paths.customer(c.id));
          }}
        />
      )}
    </QuickContext.Provider>
  );
}

/**
 * "New invoice" in the top bar, with a small arrow beside it that opens the six things you create most, each with a key. It
 * replaces the round button that used to float over the page and cover the bottom-right of tables and charts.
 */
export function QuickCreateButton() {
  const { start } = useQuickCreate();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Anything that changes the page closes the menu; so does Escape or a click elsewhere. A letter picks the item with that key.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const item = QUICK_ITEMS.find((i) => i.key === e.key.toLowerCase());
      if (item) {
        e.preventDefault();
        close();
        start(item.kind);
      }
    };
    window.addEventListener('hashchange', close);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('hashchange', close);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, start]);

  return (
    <div ref={box} className="relative flex">
      <button
        type="button"
        title="New invoice (Ctrl+N)"
        onClick={() => start('invoice')}
        className="inline-flex h-9 items-center gap-2 rounded-l-lg bg-brand px-3.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-hover active:translate-y-px"
      >
        <Plus className="h-4 w-4" aria-hidden />
        New invoice
      </button>
      <button
        type="button"
        aria-label={open ? 'Close the create menu' : 'Create something else'}
        title="Create something else"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 w-8 items-center justify-center rounded-r-lg border-l border-white/25 bg-brand text-white transition-colors duration-150 hover:bg-brand-hover"
      >
        <ChevronDown className={`h-4 w-4 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <ul role="menu" aria-label="Create" className="animate-pop-in absolute right-0 top-full z-40 mt-1.5 w-56 rounded-lg border border-line bg-surface py-1 shadow-overlay">
          {QUICK_ITEMS.map(({ kind, label, icon: Icon, key }) => (
            <li key={kind} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  start(kind);
                }}
                className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-canvas"
              >
                <Icon className="h-4 w-4 text-brand" aria-hidden />
                <span className="flex-1">{label}</span>
                <kbd className="num flex h-5 w-5 items-center justify-center rounded-md bg-canvas text-[11px] uppercase text-ink-muted">{key}</kbd>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
