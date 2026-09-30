import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { canDo, type AccessStatus, type Capability } from '../../shared/access';
import { api } from './api';

interface AccessValue {
  status: AccessStatus | null;
  /** Whether the signed in person may do this. Always true while access control is off. */
  can: (capability: Capability) => boolean;
  refresh: () => Promise<void>;
  /** Signs out, which locks the app. */
  lock: () => Promise<void>;
}

const AccessContext = createContext<AccessValue>({ status: null, can: () => true, refresh: async () => {}, lock: async () => {} });
export const useAccess = () => useContext(AccessContext);

/**
 * Knows whether sign-in is on and who is signed in, and tells the rest of the app. A locked app (or one that answers "locked" to any
 * request) shows the sign-in page instead of itself; with access control off, this does nothing and `can` always says yes.
 */
export function AccessProvider({ children, lockedView }: { children: ReactNode; lockedView: (status: AccessStatus, refresh: () => Promise<void>) => ReactNode }) {
  const [status, setStatus] = useState<AccessStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.accessStatus());
    } catch {
      /* the data layer is unreachable: the screens will say so themselves */
    }
  }, []);

  const lock = useCallback(async () => {
    try {
      setStatus(await api.accessLogout());
    } catch {
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
    // Any request the data layer refuses as "locked" (the app was locked from another window, say) brings the sign-in page up.
    const onLocked = () => void refresh();
    window.addEventListener('invoiceon:locked', onLocked);
    window.addEventListener('focus', onLocked);
    return () => {
      window.removeEventListener('invoiceon:locked', onLocked);
      window.removeEventListener('focus', onLocked);
    };
  }, [refresh]);

  // Locks itself after a while without use (the owner chooses how long; 0 means never).
  const idleFor = status?.enabled && status.user ? status.autoLockMinutes : 0;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!idleFor) return;
    const reset = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void lock(), idleFor * 60_000);
    };
    const events = ['mousedown', 'keydown', 'touchstart', 'wheel'] as const;
    events.forEach((e) => document.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      events.forEach((e) => document.removeEventListener(e, reset));
      if (timer.current) clearTimeout(timer.current);
    };
  }, [idleFor, lock]);

  const value = useMemo<AccessValue>(
    () => ({ status, can: (cap) => !status?.enabled || canDo(status.user?.role, cap), refresh, lock }),
    [status, refresh, lock],
  );

  return <AccessContext.Provider value={value}>{status?.enabled && !status.user ? lockedView(status, refresh) : children}</AccessContext.Provider>;
}
