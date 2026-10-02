import { createContext, useContext, type ReactNode } from 'react';
import type { SessionState } from '../../shared/types';
import { SignInScreen } from '../components/SignInScreen';
import { Spinner } from '../components/ui';
import { api } from './api';
import { useQuery } from './data';

const Ctx = createContext<SessionState>({ enabled: false, current: null, people: [] });

/** Who is signed in. Without people set up this is always "nobody has to". */
export const useSession = () => useContext(Ctx);

/** Shows the sign in screen while signing in is switched on and nobody has signed in; otherwise the app. */
export function SessionGate({ children }: { children: ReactNode }) {
  const state = useQuery(() => api.sessionState());
  if (!state.data) return state.error ? <p className="p-8 text-sm">{state.error}</p> : <Spinner />;
  if (state.data.enabled && !state.data.current) return <SignInScreen people={state.data.people} />;
  return <Ctx.Provider value={state.data}>{children}</Ctx.Provider>;
}
