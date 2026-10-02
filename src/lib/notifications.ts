import { useCallback, useEffect, useState } from 'react';
import type { Notification, NotificationLink } from '../../shared/types';
import { api } from './api';
import { useQuery } from './data';
import { navigate, paths } from './router';

const KEY = 'invoiceon.notifications.read';
const MAX_REMEMBERED = 500;

function load(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function save(ids: Set<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...ids].slice(-MAX_REMEMBERED)));
  } catch {
    /* remembering what has been read is a nicety */
  }
}

/** Takes the person to where a notification points. */
export function openNotification(link: NotificationLink) {
  switch (link.to) {
    case 'customer':
      return navigate(paths.customer(link.id));
    case 'proforma':
      return navigate(paths.proforma(link.id));
    case 'design':
      return navigate(paths.design(link.id));
    case 'materials':
      return navigate(paths.materials);
    case 'path':
      return navigate(link.path);
    default:
      return navigate(paths.payments);
  }
}

/**
 * The notifications, and which of them have been looked at. What is "read" is remembered on this computer; a notification that
 * is read stays read for as long as it exists, and one that goes away (the problem was dealt with) is simply no longer listed.
 */
export function useNotifications() {
  const query = useQuery(() => api.notificationsList());
  const [read, setRead] = useState<Set<string>>(load);

  // Another window or tab may have marked some as read.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === KEY && setRead(load());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const items: Notification[] = query.data ?? [];
  const markRead = useCallback((ids: string[]) => {
    setRead((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      save(next);
      return next;
    });
  }, []);
  const markUnread = useCallback((id: string) => {
    setRead((prev) => {
      const next = new Set(prev);
      next.delete(id);
      save(next);
      return next;
    });
  }, []);

  return {
    items,
    loading: query.loading,
    error: query.error,
    isRead: (id: string) => read.has(id),
    unread: items.filter((n) => !read.has(n.id)).length,
    unreadUrgent: items.filter((n) => !read.has(n.id) && n.severity === 'urgent').length,
    markRead,
    markUnread,
    markAllRead: () => markRead(items.map((n) => n.id)),
  };
}
