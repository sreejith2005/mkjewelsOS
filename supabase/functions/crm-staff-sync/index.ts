import { createClient } from "@supabase/supabase-js";
import { type CrmReceiver, handleStaffSync, type JewelosSyncGateway } from "./worker.ts";

// Secrets (JewelOS project Edge Function secrets; never in Git, chat or logs):
//   CRM_STAFF_SYNC_CRON_SECRET  the x-cron-secret pg_cron sends (Vault secret crm_staff_sync_cron_secret)
//   CRM_SYNC_RECEIVE_URL        https://<crm-project-ref>.supabase.co/functions/v1/sync-receive
//   CRM_SYNC_OUTBOUND_SECRET    equals the CRM project's CRM_SYNC_INBOUND_SECRET (JewelOS -> CRM only)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the runtime.
// verify_jwt is off (supabase/config.toml): the cron secret is the gate.

function jewelosGateway(): JewelosSyncGateway | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return {
    async claim(limit) {
      const { data, error } = await admin.rpc("crm_sync_claim_staff_events", { p_limit: limit });
      if (error) throw new Error("claim_failed");
      return (data ?? []) as Awaited<ReturnType<JewelosSyncGateway["claim"]>>;
    },
    async finish(eventId, ok, errorCode) {
      const { data, error } = await admin.rpc("crm_sync_finish_staff_event", { p_event_id: eventId, p_ok: ok, p_error: errorCode });
      if (error) throw new Error("finish_failed");
      return data as Awaited<ReturnType<JewelosSyncGateway["finish"]>>;
    },
    async roster() {
      const { data, error } = await admin.rpc("crm_sync_staff_roster");
      if (error) throw new Error("roster_failed");
      return (data ?? []) as Awaited<ReturnType<JewelosSyncGateway["roster"]>>;
    },
  };
}

function crmReceiver(): CrmReceiver | null {
  const url = Deno.env.get("CRM_SYNC_RECEIVE_URL");
  const secret = Deno.env.get("CRM_SYNC_OUTBOUND_SECRET");
  if (!url || !secret) return null;
  return {
    async post(body) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-crm-sync-secret": secret },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25_000),
      });
      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
      return { status: response.status, body: parsed };
    },
  };
}

Deno.serve((request) =>
  handleStaffSync(request, {
    cronSecret: Deno.env.get("CRM_STAFF_SYNC_CRON_SECRET"),
    jewelos: jewelosGateway(),
    crm: crmReceiver(),
  })
);
