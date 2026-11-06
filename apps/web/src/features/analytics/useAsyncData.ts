import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Retain a usable screen on refresh; never carry data across dependency scopes. */
export function useAsyncData<T>(loader: () => Promise<T>, dependencies: readonly unknown[] = []) {
  const scope = useMemo(() => ({}), dependencies);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const generation = useRef(0);
  const [state, setState] = useState<{ scope: object; data: T | null; error: string | null; pending: boolean }>({ scope, data: null, error: null, pending: true });
  const load = useCallback(async () => {
    const request = ++generation.current;
    setState((old) => ({ scope, data: old.scope === scope ? old.data : null, error: null, pending: true }));
    try {
      const data = await loaderRef.current();
      if (request === generation.current) setState({ scope, data, error: null, pending: false });
    } catch (cause) {
      if (request === generation.current) setState((old) => ({ ...old, error: cause instanceof Error ? cause.message : "Request failed", pending: false }));
    }
  }, [scope]);
  useEffect(() => {
    void load();
    return () => { generation.current += 1; };
  }, [load]);
  const current = state.scope === scope ? state : { data: null, error: null, pending: true };
  return { data: current.data, error: current.error, loading: current.pending && current.data === null, refreshing: current.pending && current.data !== null, retry: load };
}
