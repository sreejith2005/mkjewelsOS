import { createClient } from "@supabase/supabase-js";
import { handleCrmSyncReceive, type JewelosSyncGateway } from "./worker.ts";

// Secret (JewelOS project Edge Function secret; never in Git, chat or logs):
//   CRM_SYNC_INBOUND_SECRET  equals the CRM project's CRM_SYNC_OUTBOUND_SECRET
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the runtime.
// verify_jwt is off (supabase/config.toml): the shared secret is the gate.

function gateway(): JewelosSyncGateway | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return {
    async applyWalkin(eventId, snapshot) {
      const { data, error } = await admin.rpc("crm_sync_apply_walkin", { p_event_id: eventId, p_snapshot: snapshot });
      // Only the SQLSTATE is reported: a database message could quote input values.
      if (error) throw new Error(`rpc_${error.code ?? "unknown"}`);
      return (data ?? {}) as Awaited<ReturnType<JewelosSyncGateway["applyWalkin"]>>;
    },
  };
}

Deno.serve((request) => handleCrmSyncReceive(request, { secret: Deno.env.get("CRM_SYNC_INBOUND_SECRET"), gateway: gateway() }));
