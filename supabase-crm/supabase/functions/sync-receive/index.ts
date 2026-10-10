import { createClient } from "@supabase/supabase-js";
import { type CrmSyncGateway, handleSyncReceive } from "./worker.ts";

// Secret (CRM project Edge Function secret; never in Git, chat or logs):
//   CRM_SYNC_INBOUND_SECRET  equals the JewelOS project's CRM_SYNC_OUTBOUND_SECRET
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the runtime.
// verify_jwt is off (supabase-crm/supabase/config.toml): the shared secret is the gate.

function gateway(): CrmSyncGateway | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return {
    async applyMasters(eventId,snapshot) {
      const {data,error}=await admin.rpc('crm_apply_master_snapshot',{p_event_id:eventId,p_snapshot:snapshot});
      if(error)throw new Error(`rpc_${error.code ?? 'unknown'}`);
      return (data ?? {}) as Awaited<ReturnType<NonNullable<CrmSyncGateway['applyMasters']>>>;
    },
    async applyStaff(eventId, snapshot) {
      const { data, error } = await admin.rpc("crm_apply_staff_snapshot", { p_event_id: eventId, p_snapshot: snapshot });
      // Only the SQLSTATE is reported: a database message could quote input values.
      if (error) throw new Error(`rpc_${error.code ?? "unknown"}`);
      return (data ?? {}) as Awaited<ReturnType<CrmSyncGateway["applyStaff"]>>;
    },
    async reconcileStaff(runId, snapshots) {
      const { data, error } = await admin.rpc("crm_reconcile_staff_roster", { p_run_id: runId, p_snapshots: snapshots });
      if (error) throw new Error(`rpc_${error.code ?? "unknown"}`);
      return (data ?? {}) as Record<string, unknown>;
    },
  };
}

Deno.serve((request) => handleSyncReceive(request, { secret: Deno.env.get("CRM_SYNC_INBOUND_SECRET"), gateway: gateway() }));
