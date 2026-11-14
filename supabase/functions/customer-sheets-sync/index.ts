import { createClient } from "@supabase/supabase-js";
import { googleSheetReader } from "./google.ts";
import { handleSyncRequest, type IngestGateway, type SyncDeps } from "./worker.ts";

function gateway(url: string, key: string): IngestGateway {
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return {
    async state(source) {
      const { data, error } = await admin.rpc("customer_ingest_state", { p_source: source });
      if (error) throw new Error("state_failed");
      return data as { next_row: number; pending: number };
    },
    async store(source, rows, nextRow) {
      const { data, error } = await admin.rpc("customer_ingest_sheet_rows", { p_source: source, p_rows: rows, p_next_row: nextRow });
      if (error) throw new Error("store_failed");
      return data as { new: number; changed: number };
    },
    async apply(source, limit) {
      const { data, error } = await admin.rpc("customer_ingest_apply", { p_source: source, p_limit: limit });
      if (error) throw new Error("apply_failed");
      return data as { applied: number; rejected: number; pending: number };
    },
    async noteError(source, message) {
      await admin.rpc("customer_ingest_note_error", { p_source: source, p_error: message });
    },
  };
}

function dependencies(): SyncDeps {
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const googleKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY"), sheetId = Deno.env.get("RUNO_SHEET_ID");
  const tab = Deno.env.get("RUNO_SHEET_TAB") ?? "Interactions";
  return {
    secret: Deno.env.get("CUSTOMER_SHEETS_SYNC_CRON_SECRET"),
    reader: googleKey && sheetId ? googleSheetReader(googleKey, sheetId, tab) : null,
    gateway: url && key ? gateway(url, key) : null,
  };
}

Deno.serve((request) => handleSyncRequest(request, dependencies()));
