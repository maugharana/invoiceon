import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { errorMessage } from './api';

// One counter for the whole app. Any successful write calls refresh(), and every mounted query
// refetches — so the sidebar, dashboard and lists never disagree about what's in stock.
const DataContext = createContext<{ version: number; refresh: () => void }>({ version: 0, refresh: () => {} });

export function DataProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  return <DataContext.Provider value={{ version, refresh }}>{children}</DataContext.Provider>;
}

export const useRefresh = () => useContext(DataContext).refresh;

export interface QueryState<T> {
  data: T | undefined;
  error: string | null;
  /** True only until the first result arrives; later refetches keep showing the old data (no flicker). */
  loading: boolean;
}

export function useQuery<T>(fetcher: () => Promise<T>, deps: readonly unknown[] = []): QueryState<T> {
  const { version } = useContext(DataContext);
  const [state, setState] = useState<QueryState<T>>({ data: undefined, error: null, loading: true });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;
    fetcherRef
      .current()
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((err) => !cancelled && setState((s) => ({ data: s.data, error: errorMessage(err), loading: false })));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);

  return state;
}
