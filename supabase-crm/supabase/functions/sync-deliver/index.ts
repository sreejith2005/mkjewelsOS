import { createClient } from "@supabase/supabase-js";
import { type CrmOutboxGateway, handleSyncDeliver, type JewelosReceiver } from "./worker.ts";

// Secrets (CRM project Edge Function secrets; never in Git, chat or logs):
//   CRM_SYNC_CRON_SECRET      the x-cron-secret pg_cron sends (Vault secret crm_sync_cron_secret)
//   JEWELOS_SYNC_RECEIVE_URL  https://<jewelos-project-ref>.supabase.co/functions/v1/crm-sync-receive
//   CRM_SYNC_OUTBOUND_SECRET  equals the JewelOS project's CRM_SYNC_INBOUND_SECRET (CRM -> JewelOS only)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the runtime.
// verify_jwt is off (supabase-crm/supabase/config.toml): the cron secret is the gate.

function crmGateway(): CrmOutboxGateway | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return {
    async claim(limit) {
      const { data, error } = await admin.rpc("crm_sync_claim_events", { p_limit: limit });
      if (error) throw new Error("claim_failed");
      return (data ?? []) as Awaited<ReturnType<CrmOutboxGateway["claim"]>>;
    },
    async finish(eventId, ok, errorCode) {
      const { data, error } = await admin.rpc("crm_sync_finish_event", { p_event_id: eventId, p_ok: ok, p_error: errorCode });
      if (error) throw new Error("finish_failed");
      return data as Awaited<ReturnType<CrmOutboxGateway["finish"]>>;
    },
  };
}

function jewelosReceiver(): JewelosReceiver | null {
  const url = Deno.env.get("JEWELOS_SYNC_RECEIVE_URL");
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
  handleSyncDeliver(request, { cronSecret: Deno.env.get("CRM_SYNC_CRON_SECRET"), crm: crmGateway(), jewelos: jewelosReceiver() })
);
