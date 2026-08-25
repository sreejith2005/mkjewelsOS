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
    const unsubscribe = subscribeToTenantRealtime(tenantId, topics, () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void refreshRef.current();
      }, debounceMs);
    });
    return () => {
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
    };
  }, [debounceMs, tenantId, topicKey]);
}
