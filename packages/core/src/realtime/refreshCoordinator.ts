/** Realtime wakes up an observer; its existing API remains the data authority. */
export function createRefreshCoordinator(refresh: () => Promise<void> | void, debounceMs = 350): { request: () => void; dispose: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let queued = false;
  let disposed = false;
  const request = () => {
    if (disposed) return;
    if (inFlight) { queued = true; return; }
    // Keep the first deadline so a busy tenant cannot postpone refresh forever.
    if (timer !== null) return;
    timer = setTimeout(() => { void run(); }, debounceMs);
  };
  const run = async () => {
    timer = null;
    if (disposed) return;
    inFlight = true;
    try { await refresh(); }
    catch { /* The loader owns error presentation. */ }
    finally {
      inFlight = false;
      if (!disposed && queued) { queued = false; request(); }
    }
  };
  return { request, dispose: () => {
    disposed = true;
    queued = false;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  } };
}
