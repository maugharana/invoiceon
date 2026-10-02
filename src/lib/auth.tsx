import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ROLE_SECTIONS } from '../../shared/roles';
import type { AuthStatus } from '../../shared/types';
import { api } from './api';
import { useRefresh } from './data';

interface Auth {
  /** Null until the first answer arrives. */
  status: AuthStatus | null;
  /** Ask again after signing in or out, turning sign-in on or off. */
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Whether the person signed in may open this part of the app. Everyone may when the shop doesn't use sign-in. */
  canOpen: (section: string) => boolean;
}

const AuthContext = createContext<Auth>({ status: null, reload: async () => undefined, signOut: async () => undefined, canOpen: () => true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const refresh = useRefresh();
  const [status, setStatus] = useState<AuthStatus | null>(null);

  const reload = useCallback(async () => {
    try {
      setStatus(await api.authStatus());
    } catch {
      setStatus({ required: false, user: null });
    }
    refresh();
  }, [refresh]);

  useEffect(() => {
    void reload();
    const again = () => void reload();
    window.addEventListener('invoiceon:signed-out', again);
    return () => window.removeEventListener('invoiceon:signed-out', again);
  }, [reload]);

  const value = useMemo<Auth>(
    () => ({
      status,
      reload,
      signOut: async () => {
        await api.authSignOut();
        await reload();
      },
      canOpen: (section) => !status?.required || !status.user || ROLE_SECTIONS[status.user.role].includes(section),
    }),
    [status, reload],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): Auth => useContext(AuthContext);
