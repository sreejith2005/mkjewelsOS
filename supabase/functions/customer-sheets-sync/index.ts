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
  // "ALL FMS MASTER DATABASE": row 1 holds column numbers, the headers are on row 2.
  // COMBO (reference number + stage) is unique per row.
  { source: "instagram_fms", idSecret: "FMS_SHEET_ID", tabSecret: "INSTAGRAM_FMS_TAB", tab: "INSTAGRAM FMS", keyColumns: ["COMBO"], oneTime: false, headerRow: 2 },
  { source: "instagram_ads_fms", idSecret: "FMS_SHEET_ID", tabSecret: "INSTAGRAM_ADS_FMS_TAB", tab: "INSTAGRAM ADDS FMS", keyColumns: ["COMBO"], oneTime: false, headerRow: 2 },
  { source: "doubletick_fms", idSecret: "FMS_SHEET_ID", tabSecret: "DOUBLETICK_FMS_TAB", tab: "DOUBLE TICK FMS", keyColumns: ["COMBO"], oneTime: false, headerRow: 2 },
  { source: "website_chat_fms", idSecret: "FMS_SHEET_ID", tabSecret: "WEBSITE_CHAT_FMS_TAB", tab: "WEBSITE CHAT FMS", keyColumns: ["COMBO"], oneTime: false, headerRow: 2 },
  { source: "not_bought_fms", idSecret: "FMS_SHEET_ID", tabSecret: "NOT_BOUGHT_FMS_TAB", tab: "NOT BOUGHT FMS", keyColumns: ["COMBO"], oneTime: false, headerRow: 2 },
  // Same key values as the REFERRALS tab of the walk-in sheet (COMBO repeats).
  { source: "references_calling_fms", idSecret: "FMS_SHEET_ID", tabSecret: "REFERENCES_CALLING_FMS_TAB", tab: "REFERENCES CALLING FMS", keyColumns: ["TIMESTAMP", "NUMBER OF THE REFERENCE", "NAME OF THE REFERENCE"], oneTime: false, headerRow: 2 },
  // One row per order and stage; DESIGN NO can be edited, so it is not part of the key (migration 0431).
  { source: "order_fms", idSecret: "FMS_SHEET_ID", tabSecret: "ORDER_FMS_TAB", tab: "ORDER FMS", keyColumns: ["WORK ORDER NO", "WORK STAGE"], oneTime: false, headerRow: 2 },
  { source: "repair_fms", idSecret: "FMS_SHEET_ID", tabSecret: "REPAIR_FMS_TAB", tab: "REPAIR FMS", keyColumns: ["UNIQUE ID", "REPAIR NUMBER", "WORK STAGE"], oneTime: false, headerRow: 2 },
  // "Zoho Clients - DATA": the old CRM, no longer filled. Read once.
  { source: "zoho", idSecret: "ZOHO_SHEET_ID", tabSecret: "ZOHO_SHEET_TAB", tab: "ZOHO DATA", keyColumns: ["Sr. No"], oneTime: true },
  // "EXHIBITION WALKIN DATASET (FOR PORTAL)". REFERENCE NUMBER is the exhibition's code, not the row's.
  { source: "exhibition", idSecret: "EXHIBITION_SHEET_ID", tabSecret: "EXHIBITION_SHEET_TAB", tab: "Master", keyColumns: ["TIMESTAMP", "PHONE 1"], oneTime: false },
  // "OLD EXHIBITION DATA MASTER": a merged old sheet, no longer filled. Read once.
  { source: "exhibition_old", idSecret: "EXHIBITION_OLD_SHEET_ID", tabSecret: "EXHIBITION_OLD_SHEET_TAB", tab: "UNIQUE MASTER", keyColumns: ["MOBILE NUMBER"], oneTime: true },
  // "Database CUSTOMER DATA": dead, read once. MOBILE NO repeats and is #N/A on many rows: rows are keyed by row number.
  { source: "customer_data", idSecret: "CUSTOMER_DATA_SHEET_ID", tabSecret: "CUSTOMER_DATA_TAB", tab: "Masterdata", keyColumns: [], oneTime: true },
  { source: "customer_data_abroad", idSecret: "CUSTOMER_DATA_SHEET_ID", tabSecret: "CUSTOMER_DATA_ABROAD_TAB", tab: "Abroad", keyColumns: [], oneTime: true },
  // "MK CENTRALIZED CLIENT DATABASE": live, headers on row 3, one row per number. Rows are heavy (about 35 answers).
  { source: "master_sheet", idSecret: "CLIENT_DATABASE_SHEET_ID", tabSecret: "CLIENT_DATABASE_TAB", tab: "MASTER DATABASE", keyColumns: ["CONTACT NUMBER"], oneTime: false, headerRow: 3, applyBatch: 25 },
  // Other tabs of the same file (migration 0429), headers on row 1, one row per number.
  { source: "master_wrong_number", idSecret: "CLIENT_DATABASE_SHEET_ID", tabSecret: "CLIENT_DATABASE_WRONG_NUMBER_TAB", tab: "WRONG NUMBER", keyColumns: ["CONTACT NUMBER"], oneTime: false, headerRow: 1 },
  { source: "master_dont_contact", idSecret: "CLIENT_DATABASE_SHEET_ID", tabSecret: "CLIENT_DATABASE_DONT_CONTACT_TAB", tab: "DONT CONTACT ANYMORE", keyColumns: ["CONTACT NUMBER"], oneTime: false, headerRow: 1 },
  { source: "master_buyer_list", idSecret: "CLIENT_DATABASE_SHEET_ID", tabSecret: "CLIENT_DATABASE_BUYER_LIST_TAB", tab: "ALL BUYER LIST", keyColumns: ["CONTACT NUMBER"], oneTime: false, headerRow: 1 },
  { source: "master_old_final", idSecret: "CLIENT_DATABASE_SHEET_ID", tabSecret: "CLIENT_DATABASE_OLD_FINAL_TAB", tab: "ALL OLD FINAL DATA", keyColumns: ["CONTACT NUMBER"], oneTime: true, headerRow: 1, applyBatch: 25 },
  // Migration 0430: more tabs of the same file, all one-time. SCOT and CHIRAYU APP have no unique column, so they are read by row number.
  { source: "master_no_name", idSecret: "CLIENT_DATABASE_SHEET_ID", tabSecret: "CLIENT_DATABASE_NO_NAME_TAB", tab: "NO NAME", keyColumns: ["CONTACT NUMBER"], oneTime: true, headerRow: 1, applyBatch: 25 },
  { source: "master_no_number", idSecret: "CLIENT_DATABASE_SHEET_ID", tabSecret: "CLIENT_DATABASE_NO_NUMBER_TAB", tab: "NO NUMBER", keyColumns: ["CLIENT ID"], oneTime: true, headerRow: 1, applyBatch: 25 },
  { source: "master_bangalore_buyers", idSecret: "CLIENT_DATABASE_SHEET_ID", tabSecret: "CLIENT_DATABASE_BANGALORE_TAB", tab: "BANGALORE BUYER LIST", keyColumns: ["CONTACT NUMBER"], oneTime: true, headerRow: 1 },
  { source: "master_scot", idSecret: "CLIENT_DATABASE_SHEET_ID", tabSecret: "CLIENT_DATABASE_SCOT_TAB", tab: "SCOT", keyColumns: [], oneTime: true, headerRow: 1, applyBatch: 25 },
  { source: "master_chirayu_app", idSecret: "CLIENT_DATABASE_SHEET_ID", tabSecret: "CLIENT_DATABASE_CHIRAYU_TAB", tab: "CHIRAYU APP", keyColumns: [], oneTime: true, headerRow: 1, applyBatch: 25 },
  // "Account List": Mumbai's billing software (migration 0434). No unique column, so read by row number.
  { source: "software_account_list", idSecret: "CLIENT_DATABASE_SHEET_ID", tabSecret: "CLIENT_DATABASE_ACCOUNT_LIST_TAB", tab: "Account List", keyColumns: [], oneTime: true, headerRow: 1, applyBatch: 25 },
  // "01 WALKIN DATA": headers on row 1.
  { source: "walkin", idSecret: "WALKIN_SHEET_ID", tabSecret: "WALKIN_SHEET_TAB", tab: "WALKIN DATASET", keyColumns: ["REFERENCE NUMBER"], oneTime: false, applyBatch: 20 },
  { source: "walkin_family", idSecret: "WALKIN_SHEET_ID", tabSecret: "WALKIN_FAMILY_TAB", tab: "FAMILY DATA", keyColumns: ["CLIENT ID", "TIMESTAMP"], oneTime: false },
  // "WALKIN DATA (AHMEDABAD)" (migration 0435): Ahmedabad's walk-in form, family data and referrals.
  { source: "ahd_walkin", idSecret: "AHMEDABAD_WALKIN_SHEET_ID", tabSecret: "AHMEDABAD_WALKIN_TAB", tab: "WALKIN DATASET", keyColumns: ["REFERENCE NUMBER"], oneTime: false, headerRow: 3, applyBatch: 20 },
  { source: "ahd_walkin_family", idSecret: "AHMEDABAD_WALKIN_SHEET_ID", tabSecret: "AHMEDABAD_FAMILY_TAB", tab: "FAMILY DATA", keyColumns: ["CLIENT ID", "TIMESTAMP"], oneTime: false, headerRow: 1 },
  { source: "ahd_referral", idSecret: "AHMEDABAD_WALKIN_SHEET_ID", tabSecret: "AHMEDABAD_REFERRALS_TAB", tab: "REFERRALS", keyColumns: ["NUMBER", "REFERRAL NAME"], oneTime: false, headerRow: 1 },
  { source: "referral", idSecret: "WALKIN_SHEET_ID", tabSecret: "WALKIN_REFERRALS_TAB", tab: "REFERRALS", keyColumns: ["TIMESTAMP", "REFERRAL NUMBER", "REFERRAL NAME"], oneTime: false },
] as const;

// Spreadsheet files a probe may look at: short name -> the secret holding the
// file's id. A probe is read-only and returns headers, counts and shapes.
const PROBE_FILES: Record<string, string> = {
  runo: "RUNO_SHEET_ID",
  runo_old: "RUNO_OLD_SHEET_ID",
  fms: "FMS_SHEET_ID",
  walkin: "WALKIN_SHEET_ID",
  exhibition: "EXHIBITION_SHEET_ID",
  exhibition_old: "EXHIBITION_OLD_SHEET_ID",
  client_database: "CLIENT_DATABASE_SHEET_ID",
  zoho: "ZOHO_SHEET_ID",
  customer_data: "CUSTOMER_DATA_SHEET_ID",
  ahmedabad_walkin: "AHMEDABAD_WALKIN_SHEET_ID",
};

function dependencies(): SyncDeps {
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const googleKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
  const sources: SheetSource[] = SHEETS.map((sheet) => {
    const sheetId = Deno.env.get(sheet.idSecret);
    return {
      source: sheet.source, keyColumns: sheet.keyColumns, oneTime: sheet.oneTime, headerRow: "headerRow" in sheet ? sheet.headerRow : 1, applyBatch: "applyBatch" in sheet ? sheet.applyBatch : undefined,
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
