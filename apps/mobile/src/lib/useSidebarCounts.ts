import { useEffect, useState } from "react";
import type { SidebarCounts } from "@jewelos/core";
import { subscribeSidebarCounts } from "./sidebarCountsSubscription";

export function useSidebarCounts(profileId: string, tenantId: string): SidebarCounts {
  const identity = `${tenantId}:${profileId}`;
  const [snapshot, setSnapshot] = useState<{ identity: string; counts: SidebarCounts } | null>(null);
  useEffect(() => subscribeSidebarCounts(profileId, tenantId, (counts) => setSnapshot({ identity, counts })), [identity, profileId, tenantId]);
  return snapshot?.identity === identity ? snapshot.counts : {};
}
