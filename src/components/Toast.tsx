import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

type Kind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: Kind;
  message: string;
  action?: ToastAction;
  leaving?: boolean;
}

/** A button on the toast, such as Undo. It runs once; the toast then goes away. */
export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

interface Toaster {
  success: (message: string, action?: ToastAction) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const noop = () => {};
const ToastContext = createContext<Toaster>({ success: noop, error: noop, info: noop });
export const useToast = () => useContext(ToastContext);

const ICON: Record<Kind, ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 text-brand" aria-hidden />,
  error: <AlertCircle className="h-4 w-4 text-status-overdue-fg" aria-hidden />,
  info: <Info className="h-4 w-4 text-ink-muted" aria-hidden />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 160);
  }, []);

  const push = useCallback((kind: Kind, message: string, action?: ToastAction) => {
    const id = nextId.current++;
    setItems((list) => [...list.slice(-2), { id, kind, message, action }]);
    // Ease out first, then remove. A toast with an Undo stays long enough to be read and used.
    setTimeout(() => dismiss(id), action ? 8000 : kind === 'error' ? 6000 : 3200);
  }, [dismiss]);

  const toaster = useMemo<Toaster>(() => ({ success: (m, a) => push('success', m, a), error: (m) => push('error', m), info: (m) => push('info', m) }), [push]);

  return (
    <ToastContext.Provider value={toaster}>
      {children}
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`${t.leaving ? 'animate-pop-out' : 'animate-pop-in'} pointer-events-auto flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm shadow-overlay`}>
            {ICON[t.kind]}
            {t.message}
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  const run = t.action!.onClick;
                  dismiss(t.id);
                  void run();
                }}
                className="ml-2 rounded-lg px-2 py-0.5 text-brand transition-colors hover:bg-brand-tint"
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
