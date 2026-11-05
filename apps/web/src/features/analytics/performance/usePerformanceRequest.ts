import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One dashboard section's request lifecycle.
 *
 * - A new key (filters changed) aborts the previous request; a late answer for an old key is
 *   never shown.
 * - A refresh of the same key keeps the last good data on screen and marks it stale if the
 *   refresh fails, with the time it was last updated. Failure never turns into zeros.
 * - Only transient failures (network, gateway, statement timeout) retry automatically, twice,
 *   with back-off. Permission and validation errors surface at once.
 * - One request per hook at a time: refreshes asked for while one is running are coalesced.
 */
export type PerformanceRequestState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  stale: boolean;
  updatedAt: Date | null;
  refresh: () => Promise<void>;
};

const RETRY_DELAYS_MS = [700, 2000] as const;

function message(caught: unknown): string {
  return caught && typeof caught === "object" && "message" in caught ? String((caught as { message: unknown }).message) : String(caught ?? "");
}

function code(caught: unknown): string {
  return caught && typeof caught === "object" && "code" in caught ? String((caught as { code: unknown }).code) : "";
}

export function isTransientFailure(caught: unknown): boolean {
  const text = message(caught);
  if (["42501", "22023", "P0001", "PGRST202"].includes(code(caught))) return false;
  return code(caught) === "57014" || /failed to fetch|network|load failed|timeout|timed out|statement timeout|canceling statement|502|503|504|fetch/i.test(text);
}

export function isAbort(caught: unknown): boolean {
  return (caught instanceof DOMException && caught.name === "AbortError") || /abort/i.test(message(caught)) || code(caught) === "20";
}

/** Name what the reader can do; never echo raw server text. */
export function performanceErrorMessage(caught: unknown): string {
  const text = message(caught);
  if (code(caught) === "42501" || /not authorized|denied|permission/i.test(text)) return "Your access does not include this view.";
  if (code(caught) === "57014" || /statement timeout|canceling statement/i.test(text)) return "This view took too long to load. It will retry; a shorter period or narrower filter loads faster.";
  if (/366|period|date/i.test(text) && code(caught) === "22023") return "Choose a period of 1 to 366 days.";
  return "Could not load this section. Check your connection; it retries automatically.";
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { window.clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });

export function usePerformanceRequest<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>): PerformanceRequestState<T> {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null; loading: boolean; refreshing: boolean; stale: boolean; updatedAt: Date | null }>(
    { key, data: null, error: null, loading: key !== null, refreshing: false, stale: false, updatedAt: null },
  );
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const keyRef = useRef(key);
  keyRef.current = key;

  const run = useCallback(async (mode: "initial" | "refresh"): Promise<void> => {
    const runKey = keyRef.current;
    if (runKey === null) return;
    if (mode === "refresh" && inFlight.current) return inFlight.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setState((old) => old.key === runKey
      ? { ...old, loading: old.data === null, refreshing: old.data !== null, error: null }
      : { key: runKey, data: null, error: null, loading: true, refreshing: false, stale: false, updatedAt: null });
    const task = (async () => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const data = await loadRef.current(abort.signal);
          if (abort.signal.aborted || keyRef.current !== runKey) return;
          setState({ key: runKey, data, error: null, loading: false, refreshing: false, stale: false, updatedAt: new Date() });
          return;
        } catch (caught) {
          if (abort.signal.aborted || isAbort(caught) || keyRef.current !== runKey) return;
          const delay = RETRY_DELAYS_MS[attempt];
          if (delay !== undefined && isTransientFailure(caught)) {
            try { await wait(delay, abort.signal); } catch { return; }
            continue;
          }
          setState((old) => old.key === runKey
            ? { ...old, error: performanceErrorMessage(caught), loading: false, refreshing: false, stale: old.data !== null }
            : old);
          return;
        }
      }
    })();
    inFlight.current = task;
    try { await task; } finally { if (inFlight.current === task) inFlight.current = null; }
  }, []);

  useEffect(() => {
    if (key === null) return;
    void run("initial");
    return () => { controller.current?.abort(); inFlight.current = null; };
  }, [key, run]);

  const refresh = useCallback(() => run("refresh"), [run]);
  const current = state.key === key ? state : { key, data: null, error: null, loading: key !== null, refreshing: false, stale: false, updatedAt: null };
  return { data: current.data, error: current.error, loading: current.loading, refreshing: current.refreshing, stale: current.stale, updatedAt: current.updatedAt, refresh };
}
