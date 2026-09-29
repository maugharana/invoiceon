import { ClipboardList, FileText, HandCoins, Plus, Receipt, Shirt, UserPlus, type LucideIcon } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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

/** The round button at the bottom right. It fans out the six things you create most, each with a key. */
export function QuickCreateFab({ hidden }: { hidden?: boolean }) {
  const { start } = useQuickCreate();
  const [open, setOpen] = useState(false);

  // Anything that changes the page closes the menu; so does Escape.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
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
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('hashchange', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, start]);

  if (hidden) return null;
  return (
    <>
      {open && <div aria-hidden onClick={() => setOpen(false)} className="animate-fade-in fixed inset-0 z-30 bg-canvas/70 backdrop-blur-[2px]" />}
      <div className="fixed bottom-7 right-8 z-30 flex flex-col items-end gap-3">
        {open && (
          <ul role="menu" aria-label="Create" className="flex flex-col items-end gap-2.5">
            {QUICK_ITEMS.map(({ kind, label, icon: Icon, key }, i) => (
              <li key={kind} role="none" className="animate-pop-in" style={{ animationDelay: `${(QUICK_ITEMS.length - 1 - i) * 38}ms` }}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    start(kind);
                  }}
                  className="group flex h-11 items-center gap-3 rounded-full border border-line bg-surface pl-4 pr-3 text-sm shadow-lift transition-[transform,border-color] duration-150 hover:-translate-x-1 hover:border-brand/40"
                >
                  <Icon className="h-4 w-4 text-brand" aria-hidden />
                  {label}
                  <kbd className="num ml-1 flex h-5 w-5 items-center justify-center rounded-md bg-canvas text-[11px] uppercase text-ink-muted">{key}</kbd>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          aria-label={open ? 'Close create menu' : 'Create something new'}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((o) => !o)}
          className={`flex h-14 w-14 items-center justify-center rounded-full text-white shadow-fab transition-[background-color,transform] duration-200 hover:scale-105 active:scale-95 ${open ? 'bg-brand-ink' : 'bg-brand hover:bg-brand-hover'}`}
        >
          <Plus className={`h-6 w-6 transition-transform duration-200 ${open ? 'rotate-[135deg]' : ''}`} aria-hidden />
        </button>
      </div>
    </>
  );
}
