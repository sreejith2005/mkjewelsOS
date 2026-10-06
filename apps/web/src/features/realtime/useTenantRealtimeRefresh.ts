import { useCallback, useEffect, useRef } from "react";
import { createRefreshCoordinator } from "@jewelos/core";
import { subscribeToTenantRealtime, type TenantRealtimeTopic } from "./api";

export function useTenantRealtimeRefresh({ tenantId, topics, refresh, debounceMs = 350 }: {
  tenantId: string | null | undefined;
  topics: readonly TenantRealtimeTopic[];
  refresh: () => Promise<void> | void;
  debounceMs?: number;
}): () => void {
  const requestRef = useRef<() => void>(() => {});
  const request = useCallback(() => requestRef.current(), []);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const topicKey = topics.join(",");
  useEffect(() => {
    if (!tenantId || !topicKey) return;
    const coordinator = createRefreshCoordinator(() => refreshRef.current(), debounceMs);
    requestRef.current = coordinator.request;
    const onVisible = () => {
      if (document.visibilityState === "visible") coordinator.request();
    };
    const unsubscribe = subscribeToTenantRealtime(tenantId, topics, coordinator.request);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      requestRef.current = () => {};
      coordinator.dispose();
      unsubscribe();
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [debounceMs, tenantId, topicKey]);
  return request;
}
