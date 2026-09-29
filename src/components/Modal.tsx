import { X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, ErrorNote, IconButton } from './ui';

const WIDTH = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' } as const;

interface ModalProps {
  title: string;
  onClose: () => void;
  size?: keyof typeof WIDTH;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ title, onClose, size = 'md', children, footer }: ModalProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Dialogs are unmounted by whoever opened them (after saving, on Escape, on navigation…). So the exit animation can't live in
  // the dialog's own state: instead, as it unmounts it leaves an inert copy of itself behind that fades out and removes itself.
  const root = useRef<HTMLDivElement>(null);
  const openedAt = useRef(0);
  useLayoutEffect(() => {
    openedAt.current = performance.now();
    const el = root.current;
    return () => {
      // React's development-mode mount/unmount rehearsal happens instantly; a real close never does.
      if (!el || performance.now() - openedAt.current < 150) return;
      const ghost = el.cloneNode(true) as HTMLElement;
      // A clone doesn't carry what was typed (only the original attribute), so copy the live values across.
      const live = el.querySelectorAll<HTMLInputElement>('input, select, textarea');
      ghost.querySelectorAll<HTMLInputElement>('input, select, textarea').forEach((field, i) => {
        if (live[i]) field.value = live[i]!.value;
      });
      ghost.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
      ghost.querySelectorAll('a, button, input, select, textarea').forEach((n) => n.setAttribute('tabindex', '-1'));
      ghost.setAttribute('aria-hidden', 'true');
      ghost.classList.add('modal-exit');
      document.body.appendChild(ghost);
      setTimeout(() => ghost.remove(), 200);
    };
  }, []);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>('[data-autofocus], input:not([disabled]), select, textarea, button:not([aria-label="Close"])');
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      // Keep Tab inside the dialog.
      const items = [...panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')];
      if (items.length === 0) return;
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, []);

  return createPortal(
    <div ref={root} className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto px-4 py-[8vh]">
      <div className="modal-backdrop animate-fade-in fixed inset-0 bg-ink/25" onMouseDown={onClose} aria-hidden />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`animate-pop-in relative w-full ${WIDTH[size]} rounded-lg border border-line bg-surface shadow-overlay`}>
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 id={titleId} className="text-base">
            {title}
          </h2>
          <IconButton label="Close" onClick={onClose} className="-mr-2">
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmProps {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

export function ConfirmDialog({ title, body, confirmLabel, danger, onConfirm, onClose }: ConfirmProps) {
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title={title}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className={danger ? 'bg-status-overdue-fg hover:bg-[#5f1616]' : ''}
            onClick={async () => {
              if (busy.current) return;
              busy.current = true;
              try {
                await onConfirm();
                onClose();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Something went wrong.');
                busy.current = false;
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-ink-muted">
        <div>{body}</div>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}
