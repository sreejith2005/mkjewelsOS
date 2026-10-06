// CRM-project Edge Function for the Google Sheet <-> CRM sync (owner-approved design
// 2026-10-06, https://claude.ai/artifact/MBHPPoH1pRbPJF9jExCL2D). The caller is the Apps Script
// supabase-crm/apps-script/crm-sheet-sync.gs in the MK JEWELS CRM SYSTEM project; it sends the
// x-mk-sheet-sync-key header (secret CRM_SHEET_SYNC_KEY, compared in constant time).
//
// One request = one action of public.crm_sheet_sync (migration 20261006000400):
//   {action: "run_start", mode}                       start a run (live | dry_run | import)
//   {action: "push", run_id, tab, dry_run, rows}      Sheet rows -> CRM (<= 200 rows)
//   {action: "pull", limit}                           web-app changes waiting for the Sheet
//   {action: "ack", results}                          what the script wrote
//   {action: "run_finish", run_id, status, pull_counts}
// WALKIN DATASET rows also get the canonical walk-in payload, built here with the walk-in
// feed's own mapping (sheet-walkin.ts).
//
// Never logged: row values, keys of referral rows, the sync key. Console output carries an
// error class only.
import { z } from "zod";

import { sheetRowToWalkinPayload } from "./sheet-walkin.ts";

export const TABS = [
  "CLIENT DATABASE MASTER",
  "WALKIN DATASET",
  "FAMILY DATA",
  "REFERRALS",
  "REFERRALS CALLING MASTER",
  "REFERRALS HISTORY",
] as const;

const MAX_REQUEST_BYTES = 6_000_000;

const cellText = z.string().max(5_000);
const sheetRow = z.object({
  key: z.string().trim().min(1).max(120),
  hash: z.string().max(128),
  values: z.record(z.string().max(120), cellText).refine((value) => Object.keys(value).length <= 200, "Too many columns."),
}).strict();

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("run_start"), mode: z.enum(["live", "dry_run", "import"]) }).strict(),
  z.object({
    action: z.literal("push"),
    run_id: z.string().uuid().nullable().optional(),
    tab: z.enum(TABS),
    dry_run: z.boolean().default(false),
    rows: z.array(sheetRow).max(200),
  }).strict(),
  z.object({ action: z.literal("pull"), limit: z.number().int().min(1).max(200).default(100) }).strict(),
  z.object({
    action: z.literal("ack"),
    results: z.array(z.object({
      id: z.number().int().positive(),
      outcome: z.enum(["applied", "sheet_won", "failed"]),
      applied_columns: z.array(z.string().max(120)).max(200).optional(),
      reason: z.string().regex(/^[a-z_]{1,60}$/).optional(),
    }).strict()).max(200),
  }).strict(),
  z.object({
    action: z.literal("run_finish"),
    run_id: z.string().uuid(),
    status: z.enum(["finished", "failed"]),
    pull_counts: z.record(z.string().max(60), z.number().int().min(0)).optional(),
  }).strict(),
]);

export type SheetSyncRequest = z.infer<typeof requestSchema>;

export type SyncGateway = Readonly<{
  call: (action: string, payload: Record<string, unknown>) => Promise<unknown>;
}>;

export type SyncDeps = Readonly<{
  apiKey: string | undefined;
  gateway: SyncGateway | null;
}>;

function response(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
  });
}

/** Length check first, then a constant-time byte comparison (as crm-walkin-ingest). */
export function suppliedKeyMatches(value: string | null, expected: string): boolean {
  if (!value) return false;
  const encoder = new TextEncoder();
  const supplied = encoder.encode(value);
  const configured = encoder.encode(expected);
  if (supplied.length !== configured.length) return false;
  let difference = 0;
  for (let index = 0; index < supplied.length; index += 1) difference |= supplied[index]! ^ configured[index]!;
  return difference === 0;
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

/** The RPC payload for an action; WALKIN DATASET rows carry their walk-in payload. */
export function rpcPayload(request: SheetSyncRequest): Record<string, unknown> {
  if (request.action !== "push") {
    const { action: _action, ...rest } = request;
    return rest;
  }
  const rows = request.rows.map((row) => {
    const key = row.key.trim().toUpperCase();
    return request.tab === "WALKIN DATASET"
      ? { key, hash: row.hash, values: row.values, payload: sheetRowToWalkinPayload(row.values, key) }
      : { key, hash: row.hash, values: row.values };
  });
  return { run_id: request.run_id ?? null, tab: request.tab, dry_run: request.dry_run, rows };
}

export async function handleSheetSync(request: Request, deps: SyncDeps): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  if (!deps.apiKey || !deps.gateway) {
    console.error("Sheet sync is not configured: CRM_SHEET_SYNC_KEY or the service connection is missing.");
    return response({ ok: false, code: "SERVER_MISCONFIGURED" }, 503);
  }
  if (!suppliedKeyMatches(request.headers.get("x-mk-sheet-sync-key"), deps.apiKey)) {
    return response({ ok: false, code: "UNAUTHORIZED" }, 401);
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES) {
    return response({ ok: false, code: "PAYLOAD_TOO_LARGE" }, 413);
  }

  let body: unknown;
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAX_REQUEST_BYTES) return response({ ok: false, code: "PAYLOAD_TOO_LARGE" }, 413);
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return response({ ok: false, code: "INVALID_JSON" }, 400);
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    // Issue paths and messages only: never the offending values.
    const issues = parsed.error.issues.slice(0, 10).map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    return response({ ok: false, code: "INVALID_REQUEST", issues }, 400);
  }

  try {
    const result = await deps.gateway.call(parsed.data.action, rpcPayload(parsed.data));
    return response({ ok: true, ...(result as Record<string, unknown>) }, 200);
  } catch (error) {
    console.error("Sheet sync action failed", { action: parsed.data.action, error: errorClass(error) });
    return response({ ok: false, code: "SYNC_FAILED" }, 500);
  }
}
