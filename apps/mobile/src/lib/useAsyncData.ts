import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, log } from "@/lib/log";

export type AsyncData<T> = Readonly<{
  data: T | null;
  error: string | null;
  /** True only for the first load, so a refresh never blanks the screen. */
  loading: boolean;
  /** True while a pull-to-refresh or a background reload is in flight. */
  refreshing: boolean;
  reload: () => Promise<void>;
  refresh: () => Promise<void>;
}>;

/**
 * Loads a screen's data and keeps its three states honest.
 *
 * The distinction between `loading` and `refreshing` matters more on a phone
 * than in a browser: a pull-to-refresh that replaced the list with a spinner
 * would throw away the viewer's scroll position for no reason.
 *
 * A late response from a request that has been superseded is dropped, so
 * switching tabs quickly cannot leave one screen showing another's data.
 */
export function useAsyncData<T>(loader: () => Promise<T>, dependencies: readonly unknown[] = []): AsyncData<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (mode: "initial" | "refresh") => {
      const attempt = ++generation.current;
      if (mode === "refresh") setRefreshing(true);
      else setLoading(true);
      try {
        const next = await loader();
        if (!mounted.current || attempt !== generation.current) return;
        setData(next);
        setError(null);
      } catch (caught) {
        if (!mounted.current || attempt !== generation.current) return;
        log.error("api", "screen data failed to load", caught);
        setError(errorText(caught));
      } finally {
        if (!mounted.current || attempt !== generation.current) return;
        setLoading(false);
        setRefreshing(false);
      }
    },
    // The caller owns the identity of `loader`; the dependency list is theirs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    dependencies,
  );

  useEffect(() => {
    void run("initial");
  }, [run]);

  const reload = useCallback(() => run("initial"), [run]);
  const refresh = useCallback(() => run("refresh"), [run]);

  return { data, error, loading, refreshing, reload, refresh };
}
