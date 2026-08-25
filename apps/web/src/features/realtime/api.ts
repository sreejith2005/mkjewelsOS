import { supabase } from "@jewelos/api-client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export const TENANT_REALTIME_TOPICS = ["tasks", "fms", "crm", "forms", "organization", "settings"] as const;
export type TenantRealtimeTopic = typeof TENANT_REALTIME_TOPICS[number];

type TenantRealtimeSubscription = {
  channel: RealtimeChannel;
  listeners: Set<{ topics: ReadonlySet<TenantRealtimeTopic>; listener: () => void }>;
  removalTimer: ReturnType<typeof setTimeout> | null;
};

const subscriptions = new Map<string, TenantRealtimeSubscription>();

function isTenantRealtimeTopic(value: unknown): value is TenantRealtimeTopic {
  return typeof value === "string" && (TENANT_REALTIME_TOPICS as readonly string[]).includes(value);
}

function createSubscription(tenantId: string): TenantRealtimeSubscription {
  const listeners = new Set<TenantRealtimeSubscription["listeners"] extends Set<infer Listener> ? Listener : never>();
  const channel = supabase.channel(`tenant-realtime:${tenantId}`).on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "tenant_realtime_events", filter: `tenant_id=eq.${tenantId}` },
    (payload) => {
      const topic = (payload.new as { topic?: unknown } | null)?.topic;
      if (!isTenantRealtimeTopic(topic)) return;
      listeners.forEach(({ listener, topics }) => { if (topics.has(topic)) listener(); });
    },
  ).subscribe();
  return { channel, listeners, removalTimer: null };
}

export function subscribeToTenantRealtime(
  tenantId: string,
  topics: readonly TenantRealtimeTopic[],
  listener: () => void,
): () => void {
  let subscription = subscriptions.get(tenantId);
  if (!subscription) {
    subscription = createSubscription(tenantId);
    subscriptions.set(tenantId, subscription);
  }
  if (subscription.removalTimer !== null) {
    clearTimeout(subscription.removalTimer);
    subscription.removalTimer = null;
  }
  const registeredListener = { listener, topics: new Set(topics) };
  subscription.listeners.add(registeredListener);

  return () => {
    subscription?.listeners.delete(registeredListener);
    if (!subscription || subscription.listeners.size !== 0 || subscription.removalTimer !== null) return;
    subscription.removalTimer = setTimeout(() => {
      if (!subscription || subscription.listeners.size !== 0) return;
      subscriptions.delete(tenantId);
      void supabase.removeChannel(subscription.channel);
    }, 0);
  };
}
