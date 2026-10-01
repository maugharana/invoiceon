import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './ui';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  /** Greyed out, with this as the reason shown beneath. */
  disabledReason?: string;
}

/** A button that opens a short list of actions. Closes on a choice, on Escape, or on a click anywhere else. */
export function Menu({ label, icon, items }: { label: string; icon?: ReactNode; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <Button icon={icon} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        {label}
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </Button>
      {open && (
        <ul role="menu" className="animate-pop-in absolute right-0 z-30 mt-1.5 w-64 rounded-lg border border-line bg-surface py-1 shadow-overlay">
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={!!item.disabledReason}
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
                className="flex w-full items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <span className="mt-0.5 text-ink-muted">{item.icon}</span>
                <span>
                  <span className="block">{item.label}</span>
                  {item.disabledReason && <span className="block text-xs text-ink-muted">{item.disabledReason}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
