import { createClient } from "@supabase/supabase-js";
import { handleOutboxRequest, type AdapterResult, type ClaimedDelivery, type OutboxGateway } from "./worker.ts";

function createGateway(url: string, serviceRoleKey: string): OutboxGateway {
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return {
    async detectScheduled(limit) {
      const { error } = await admin.rpc("detect_scheduled_notification_events", { p_limit: limit });
      if (error) throw new Error("scheduled_detection_failed");
    },
    async processEvents(limit) {
      const { error } = await admin.rpc("process_notification_events", { p_limit: limit });
      if (error) throw new Error("event_processing_failed");
    },
    async claimDeliveries(limit, workerId) {
      const { data, error } = await admin.rpc("claim_notification_deliveries", {
        p_limit: limit,
        p_worker_id: workerId,
        p_lease_minutes: 5,
      });
      if (error) throw new Error("delivery_claim_failed");
      return (data ?? []) as ClaimedDelivery[];
    },
    async finishDelivery(deliveryId: string, result: AdapterResult) {
      const { data, error } = await admin.rpc("finish_notification_delivery", {
        p_delivery_id: deliveryId,
        p_outcome: result.outcome,
        p_provider_identifier: result.providerIdentifier,
        p_error_category: result.errorCategory,
        p_retryable: result.retryable,
      });
      if (error) throw new Error("delivery_finish_failed");
      return data as string;
    },
  };
}

Deno.serve((request: Request) => {
  const secret = Deno.env.get("NOTIFICATION_OUTBOX_CRON_SECRET");
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const gateway = url && serviceRoleKey ? createGateway(url, serviceRoleKey) : null;
  return handleOutboxRequest(request, secret, gateway);
});
