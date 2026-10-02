import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Notification } from '../../shared/types';
import { openNotification, useNotifications } from '../lib/notifications';
import { navigate, paths } from '../lib/router';

export const SEVERITY_DOT: Record<Notification['severity'], string> = { urgent: 'bg-status-overdue-fg', soon: 'bg-status-partial-fg', info: 'bg-brand' };

/** The bell in the top bar: how many things want attention, and the most pressing of them one click away. */
export function NotificationBell() {
  const n = useNotifications();
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

  const shown = n.items.slice(0, 7);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={n.unread > 0 ? `Notifications, ${n.unread} unread` : 'Notifications'}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:border-ink/25 hover:text-ink"
      >
        <Bell className="h-4 w-4" aria-hidden />
        {n.unread > 0 && (
          <span className={`num absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] text-white ${n.unreadUrgent > 0 ? 'bg-status-overdue-fg' : 'bg-brand'}`}>{n.unread > 9 ? '9+' : n.unread}</span>
        )}
      </button>
      {open && (
        <div className="animate-fade-in absolute right-0 top-11 z-40 w-[22rem] overflow-hidden rounded-xl border border-line bg-surface shadow-overlay">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-sm">Notifications</span>
            {n.unread > 0 && (
              <button type="button" onClick={n.markAllRead} className="text-xs text-brand transition-colors hover:text-brand-hover">
                Mark all read
              </button>
            )}
          </div>
          {shown.length === 0 ? (
            <p className="px-4 py-6 text-center text-ink-muted">All clear. Nothing needs you right now.</p>
          ) : (
            <ul className="max-h-[22rem] divide-y divide-line/70 overflow-y-auto">
              {shown.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      n.markRead([item.id]);
                      setOpen(false);
                      openNotification(item.link);
                    }}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-canvas"
                  >
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.isRead(item.id) ? 'bg-line' : SEVERITY_DOT[item.severity]}`} aria-hidden />
                    <span className={`min-w-0 ${n.isRead(item.id) ? 'text-ink-muted' : ''}`}>
                      <span className="block truncate">{item.title}</span>
                      <span className="block truncate text-xs text-ink-muted">{item.detail}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate(paths.notifications);
            }}
            className="block w-full border-t border-line px-4 py-2.5 text-center text-sm text-brand transition-colors hover:bg-canvas"
          >
            {n.items.length > shown.length ? `See all ${n.items.length}` : 'Open the notifications page'}
          </button>
        </div>
      )}
    </div>
  );
}
