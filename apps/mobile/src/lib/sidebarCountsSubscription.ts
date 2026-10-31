import type { SidebarCounts } from "@jewelos/core";
import { loadMySidebarCounts } from "@jewelos/data/sidebar/api";
import { subscribeToTenantRealtime } from "@jewelos/data/realtime/api";
import { subscribeToInbox } from "@jewelos/data/notifications/api";
import { createRefreshLifecycle } from "./refreshLifecycle";
import { subscribeAppAvailability } from "./useTenantRealtimeRefresh";

export function subscribeSidebarCounts(profileId: string, tenantId: string, update: (counts: SidebarCounts) => void): () => void {
  let active = true;
  const lifecycle = createRefreshLifecycle(async () => {
    try { const counts = await loadMySidebarCounts(); if (active) update(counts); }
    catch { if (active) update({}); }
  }, false);
  const stopAvailability = subscribeAppAvailability(lifecycle.setActive);
  const stopTenant = subscribeToTenantRealtime(tenantId, ["tasks", "fms", "forms", "organization", "settings"], lifecycle.request);
  const stopInbox = subscribeToInbox(profileId, lifecycle.request);
  return () => { active = false; lifecycle.dispose(); stopTenant(); stopInbox(); stopAvailability(); };
}
