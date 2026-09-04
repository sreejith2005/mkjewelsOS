import { useEffect, useRef } from "react";
import { subscribeToTenantRealtime, type TenantRealtimeTopic } from "./api";

export function useTenantRealtimeRefresh({
  tenantId,
  topics,
  refresh,
  debounceMs = 350,
}: {
  tenantId: string | null | undefined;
  topics: readonly TenantRealtimeTopic[];
  refresh: () => Promise<void> | void;
  debounceMs?: number;
}): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const topicKey = topics.join(",");

  useEffect(() => {
    if (!tenantId || topics.length === 0) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let refreshInFlight = false;
    let refreshQueued = false;
    let disposed = false;
    const scheduleRefresh = () => {
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => { void runRefresh(); }, debounceMs);
    };
    const runRefresh = async () => {
      timer = null;
      refreshInFlight = true;
      try {
        await refreshRef.current();
      } catch {
        // Page loaders surface their own errors. A wake-up must not become an
        // unhandled promise rejection.
      } finally {
        refreshInFlight = false;
        if (disposed || !refreshQueued) return;
        refreshQueued = false;
        scheduleRefresh();
      }
    };
    const unsubscribe = subscribeToTenantRealtime(tenantId, topics, () => {
      scheduleRefresh();
    });
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
    };
  }, [debounceMs, tenantId, topicKey]);
}
