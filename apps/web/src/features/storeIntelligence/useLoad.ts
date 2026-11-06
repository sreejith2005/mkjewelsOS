import { useCallback, useEffect, useRef, useState } from "react";
import { WorkspaceError, type WorkspaceErrorKind } from "@jewelos/data";

export type LoadState<T> = Readonly<{ data: T | null; error: string | null; errorKind: WorkspaceErrorKind | null; loading: boolean; reload: () => void }>;

/**
 * Loads one server read, keeps the previous data while refreshing (no flashing
 * skeleton), ignores stale responses, and can refresh itself on an interval.
 */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[], refreshMs?: number): LoadState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<WorkspaceErrorKind | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const loader = useRef(load); loader.current = load;
  const reload = useCallback(() => setNonce((value) => value + 1), []);
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      setLoading(true);
      try { const next = await loader.current(); if (active) { setData(next); setError(null); setErrorKind(null); } }
      catch (cause) {
        if (!active) return;
        setError(cause instanceof Error && cause.message ? cause.message : "This could not be loaded.");
        setErrorKind(cause instanceof WorkspaceError ? cause.kind : "unavailable");
      } finally { if (active) setLoading(false); }
      if (active && refreshMs) timer = setTimeout(() => { void run(); }, document.hidden ? refreshMs * 3 : refreshMs);
    };
    void run();
    return () => { active = false; if (timer) clearTimeout(timer); };
    // The caller's dependency list decides when to reload; the loader itself is read from a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, refreshMs]);
  return { data, error, errorKind, loading, reload };
}

/** Browser connection state, for honest offline notices. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true); const off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}
