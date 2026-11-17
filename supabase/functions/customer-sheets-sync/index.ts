import { createClient } from "@supabase/supabase-js";
import { googleProbeFile, googleSheetReader } from "./google.ts";
import { handleSyncRequest, type IngestGateway, type SheetSource, type SyncDeps } from "./worker.ts";

// A failed database call is reported as "<step>_failed_<postgres code>", for
// example apply_failed_57014 (statement cancelled). The code says what went
// wrong without exposing any row content.
function failure(step: string, error: { code?: string }): Error {
  const code = String(error.code ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return new Error(code ? `${step}_failed_${code}` : `${step}_failed`);
}

function gateway(url: string, key: string): IngestGateway {
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return {
    async state(source) {
      const { data, error } = await admin.rpc("customer_ingest_state", { p_source: source });
      if (error) throw failure("state", error);
      return data as { next_row: number; scan_row: number; pending: number; completed: boolean };
    },
    async store(source, rows, options) {
      const { data, error } = await admin.rpc("customer_ingest_store", { p_source: source, p_rows: rows, p_options: options });
      if (error) throw failure("store", error);
      return data as { new: number; changed: number };
    },
    async apply(source, limit) {
      const { data, error } = await admin.rpc("customer_ingest_apply", { p_source: source, p_limit: limit });
      if (error) throw failure("apply", error);
      return data as { applied: number; rejected: number; pending: number };
    },
    async finishScan(source) {
      const { data, error } = await admin.rpc("customer_ingest_finish_scan", { p_source: source });
      if (error) throw failure("finish", error);
      return data as { removed: number; remaining: boolean; blocked: boolean };
    },
    async noteError(source, message) {
      await admin.rpc("customer_ingest_note_error", { p_source: source, p_error: message });
    },
  };
}

// Each sheet: its source name in the database, the secret holding its sheet id,
// its tab, the columns that together identify a row, and whether it is read only once.
const SHEETS = [
  { source: "runo", idSecret: "RUNO_SHEET_ID", tabSecret: "RUNO_SHEET_TAB", tab: "Interactions", keyColumns: ["callId"], oneTime: false },
  { source: "runo_old", idSecret: "RUNO_OLD_SHEET_ID", tabSecret: "RUNO_OLD_SHEET_TAB", tab: "25-26", keyColumns: ["Unique id", "Interaction Date"], oneTime: true },
] as const;

// Spreadsheet files a probe may look at: short name -> the secret holding the
// file's id. A probe is read-only and returns headers, counts and shapes.
const PROBE_FILES: Record<string, string> = {
  runo: "RUNO_SHEET_ID",
  runo_old: "RUNO_OLD_SHEET_ID",
  fms: "FMS_SHEET_ID",
  walkin: "WALKIN_SHEET_ID",
  exhibition: "EXHIBITION_SHEET_ID",
  client_database: "CLIENT_DATABASE_SHEET_ID",
};

function dependencies(): SyncDeps {
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const googleKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
  const sources: SheetSource[] = SHEETS.map((sheet) => {
    const sheetId = Deno.env.get(sheet.idSecret);
    return {
      source: sheet.source, keyColumns: sheet.keyColumns, oneTime: sheet.oneTime,
      reader: googleKey && sheetId ? googleSheetReader(googleKey, sheetId, Deno.env.get(sheet.tabSecret) ?? sheet.tab) : null,
    };
  });
  return {
    secret: Deno.env.get("CUSTOMER_SHEETS_SYNC_CRON_SECRET"),
    sources,
    gateway: url && key ? gateway(url, key) : null,
    probeFile(file) {
      if (!Object.hasOwn(PROBE_FILES, file)) return undefined;
      const sheetId = Deno.env.get(PROBE_FILES[file]);
      return googleKey && sheetId ? googleProbeFile(googleKey, sheetId) : null;
    },
  };
}

Deno.serve((request) => handleSyncRequest(request, dependencies()));
