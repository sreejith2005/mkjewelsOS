import { createClient } from "@supabase/supabase-js";
import { handleSheetSync, type SyncGateway } from "./worker.ts";

// CRM project function. Secret: CRM_SHEET_SYNC_KEY (function secret). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by the Edge runtime. verify_jwt = false because
// Google Apps Script sends no JWT; the x-mk-sheet-sync-key check is the gate.
function gateway(url: string, key: string): SyncGateway {
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false }, db: { schema: "public" } });
  return {
    async call(action, payload) {
      const { data, error } = await admin.rpc("crm_sheet_sync", { p_action: action, p_payload: payload });
      if (error) throw new Error("rpc_failed");
      return data;
    },
  };
}

Deno.serve((request) => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return handleSheetSync(request, {
    apiKey: Deno.env.get("CRM_SHEET_SYNC_KEY"),
    gateway: url && key ? gateway(url, key) : null,
  });
});
