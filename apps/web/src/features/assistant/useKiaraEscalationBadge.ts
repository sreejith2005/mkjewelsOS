import { useCallback, useEffect, useState } from "react";
import { getKiaraEscalationBadge } from "@jewelos/data/assistant/escalations";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";

/**
 * Open Ask Kiara questions the signed-in user may answer, for the navigation
 * badge. Refreshed by the payload-free `assistant` realtime topic and when the
 * window regains focus. `enabled` is a screen aid (the permission and the
 * section); the database decides the count.
 */
export function useKiaraEscalationBadge(tenantId: string | null | undefined, enabled: boolean): number {
  const [count, setCount] = useState(0);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      setCount(await getKiaraEscalationBadge());
    } catch {
      // The badge is informational; the Questions tab shows the real list.
    }
  }, [enabled]);
  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    void refresh();
  }, [enabled, refresh]);
  useTenantRealtimeRefresh({ tenantId: enabled ? tenantId : null, topics: ["assistant"], refresh });
  return enabled ? count : 0;
}
