import { useEffect, useState } from "react";
import { getKiaraEscalationBadge } from "@jewelos/data/assistant/escalations";
import { subscribeToTenantRealtime } from "@jewelos/data/realtime/api";
import { createRefreshLifecycle } from "@/lib/refreshLifecycle";
import { subscribeAppAvailability } from "@/lib/useTenantRealtimeRefresh";

/**
 * Open Ask Kiara questions the signed-in user may answer, for the badge on the
 * Ask Kiara entry. Refreshed by the payload-free `assistant` realtime topic and
 * when the app returns to the foreground or comes back online. `enabled` is a
 * screen aid (permission and section); the badge RPC decides the count.
 * Mounted by the shell, outside any screen, so it does not follow screen focus.
 */
export function useKiaraEscalationBadge(tenantId: string | null | undefined, enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled || !tenantId) {
      setCount(0);
      return;
    }
    let active = true;
    const refresh = async () => {
      try {
        const next = await getKiaraEscalationBadge();
        if (active) setCount(next);
      } catch {
        // The badge is informational; the Questions tab shows the real list.
      }
    };
    const lifecycle = createRefreshLifecycle(refresh, false);
    const stopAvailability = subscribeAppAvailability(lifecycle.setActive);
    const unsubscribe = subscribeToTenantRealtime(tenantId, ["assistant"], lifecycle.request);
    return () => {
      active = false;
      lifecycle.dispose();
      stopAvailability();
      unsubscribe();
    };
  }, [enabled, tenantId]);
  return enabled ? count : 0;
}
