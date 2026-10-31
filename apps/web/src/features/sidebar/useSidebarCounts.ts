import { useEffect, useState } from "react";
import { createRefreshCoordinator, type SidebarCounts } from "@jewelos/core";
import { loadMySidebarCounts } from "@jewelos/data/sidebar/api";
import { subscribeToTenantRealtime } from "@/features/realtime/api";
import { subscribeToInbox } from "@/features/notifications/api";

export function useSidebarCounts(profileId: string, tenantId: string): SidebarCounts {
  const identity = `${tenantId}:${profileId}`;
  const [snapshot, setSnapshot] = useState<{ identity: string; counts: SidebarCounts } | null>(null);
  useEffect(() => {
    let active = true;
    const coordinator = createRefreshCoordinator(async () => {
      try {
        const counts = await loadMySidebarCounts();
        if (active) setSnapshot({ identity, counts });
      } catch {
        // Unavailable counts must not prevent opening authorized sections.
        if (active) setSnapshot(null);
      }
    }, 350);
    const refreshVisible = () => { if (document.visibilityState === "visible") coordinator.request(); };
    const stopTenant = subscribeToTenantRealtime(tenantId, ["tasks", "fms", "forms", "organization", "settings"], coordinator.request);
    const stopInbox = subscribeToInbox(profileId, coordinator.request);
    window.addEventListener("focus", refreshVisible);
    window.addEventListener("online", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    coordinator.request();
    return () => {
      active = false; coordinator.dispose(); stopTenant(); stopInbox();
      window.removeEventListener("focus", refreshVisible);
      window.removeEventListener("online", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [identity, profileId, tenantId]);
  return snapshot?.identity === identity ? snapshot.counts : {};
}
