import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

type Kind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: Kind;
  message: string;
  leaving?: boolean;
}

interface Toaster {
  success: (message: string) => void;
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

  const push = useCallback((kind: Kind, message: string) => {
    const id = nextId.current++;
    setItems((list) => [...list.slice(-2), { id, kind, message }]);
    // Ease out first, then remove.
    setTimeout(() => setItems((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t))), kind === 'error' ? 6000 : 3200);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), (kind === 'error' ? 6000 : 3200) + 160);
  }, []);

  const toaster = useMemo<Toaster>(() => ({ success: (m) => push('success', m), error: (m) => push('error', m), info: (m) => push('info', m) }), [push]);

  return (
    <ToastContext.Provider value={toaster}>
      {children}
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`${t.leaving ? 'animate-pop-out' : 'animate-pop-in'} pointer-events-auto flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm shadow-overlay`}>
            {ICON[t.kind]}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
