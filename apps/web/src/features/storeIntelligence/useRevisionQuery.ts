import { useCallback, useEffect, useRef, useState } from "react";
import { SupersededError, WorkspaceError, type WorkspaceErrorKind } from "@jewelos/data";

/**
 * "Latest wins" for one stream of requests. Each begin() aborts the request before it and
 * hands out a ticket; only the newest ticket may write state, so a slow old response can
 * never overwrite the current filters' result.
 */
export function createLatestGate() {
  let current = 0; let controller: AbortController | null = null;
  return {
    begin() {
      controller?.abort();
      const own = new AbortController(); controller = own;
      const revision = ++current;
      return { revision, signal: own.signal, isCurrent: () => revision === current && !own.signal.aborted };
    },
    cancel() { controller?.abort(); controller = null; current += 1; },
  };
}
const isSuperseded = (cause: unknown) => cause instanceof SupersededError || (cause instanceof DOMException && cause.name === "AbortError");

export type RevisionState<T> = Readonly<{
  data: T | null; error: string | null; errorKind: WorkspaceErrorKind | null;
  /** True while a request for the current key is in flight (previous data stays visible). */
  loading: boolean; /** The key `data` belongs to; differs from the current key while refreshing. */ dataKey: string | null; reload: () => void;
}>;

/**
 * Fetches once per key (one filter revision). No polling: it refetches only when the key
 * changes or reload() is called. Older requests are aborted and their answers ignored.
 */
export function useRevisionQuery<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>): RevisionState<T> {
  const [state, setState] = useState<{ data: T | null; dataKey: string | null; error: string | null; errorKind: WorkspaceErrorKind | null; loading: boolean }>(
    { data: null, dataKey: null, error: null, errorKind: null, loading: key !== null });
  const loader = useRef(load); loader.current = load;
  const gate = useRef(createLatestGate());
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);
  useEffect(() => {
    if (key === null) { gate.current.cancel(); setState((s) => ({ ...s, loading: false })); return; }
    const ticket = gate.current.begin();
    setState((s) => ({ ...s, loading: true }));
    loader.current(ticket.signal).then(
      (data) => { if (ticket.isCurrent()) setState({ data, dataKey: key, error: null, errorKind: null, loading: false }); },
      (cause: unknown) => {
        if (!ticket.isCurrent() || isSuperseded(cause)) return;
        setState((s) => ({ ...s, loading: false, error: cause instanceof Error && cause.message ? cause.message : "This could not be loaded.",
          errorKind: cause instanceof WorkspaceError ? cause.kind : "unavailable" }));
      },
    );
  }, [key, nonce]);
  useEffect(() => () => gate.current.cancel(), []);
  return { ...state, reload };
}

export type PagedState<R> = Readonly<{
  rows: readonly R[]; total: number | null; hasMore: boolean; loading: boolean; error: string | null; loadMore: () => void; retry: () => void;
}>;
/**
 * Keyset pages for one key. A new key starts over; "Load more" appends only if the key has not
 * changed meanwhile. Scrolling never refetches the summary.
 */
export function usePagedQuery<R, C>(key: string | null, load: (cursor: C | null, signal: AbortSignal) => Promise<{ rows: readonly R[]; has_more: boolean; total: number | null }>,
  cursorOf: (row: R) => C): PagedState<R> {
  const [state, setState] = useState<{ rows: readonly R[]; total: number | null; hasMore: boolean; loading: boolean; error: string | null }>({ rows: [], total: null, hasMore: false, loading: false, error: null });
  const loader = useRef(load); loader.current = load;
  const cursorFn = useRef(cursorOf); cursorFn.current = cursorOf;
  const gate = useRef(createLatestGate());
  const rowsRef = useRef<readonly R[]>([]);
  const fetchPage = useCallback((append: boolean) => {
    const ticket = gate.current.begin();
    const last = append ? rowsRef.current.at(-1) : undefined;
    setState((s) => ({ ...s, loading: true, error: null, ...(append ? {} : { rows: [], total: null, hasMore: false }) }));
    if (!append) rowsRef.current = [];
    loader.current(last === undefined ? null : cursorFn.current(last), ticket.signal).then(
      (page) => {
        if (!ticket.isCurrent()) return;
        rowsRef.current = append ? [...rowsRef.current, ...page.rows] : page.rows;
        setState((s) => ({ rows: rowsRef.current, total: append ? s.total : page.total, hasMore: page.has_more, loading: false, error: null }));
      },
      (cause: unknown) => {
        if (!ticket.isCurrent() || isSuperseded(cause)) return;
        setState((s) => ({ ...s, loading: false, error: cause instanceof Error && cause.message ? cause.message : "This could not be loaded." }));
      },
    );
  }, []);
  useEffect(() => {
    if (key === null) { gate.current.cancel(); rowsRef.current = []; setState({ rows: [], total: null, hasMore: false, loading: false, error: null }); return; }
    fetchPage(false);
  }, [key, fetchPage]);
  useEffect(() => () => gate.current.cancel(), []);
  return { ...state, loadMore: () => fetchPage(true), retry: () => fetchPage(rowsRef.current.length > 0) };
}
