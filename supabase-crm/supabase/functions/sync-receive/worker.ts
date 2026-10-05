// CRM-project Edge Function: receives sync events from JewelOS.
// Design: docs/superpowers/specs/2026-10-01-crm-two-project-client-database-design.md
// ("Sync mechanism"); database contract: migration 20261005000100.
//
// Server-to-server only. The caller (JewelOS crm-staff-sync) proves itself with
// x-crm-sync-secret (CRM_SYNC_INBOUND_SECRET, one secret for the JewelOS -> CRM direction),
// checked in constant time before the body is read. Kinds:
//   staff.events     {events: [{event_id, snapshot}]} -> crm_apply_staff_snapshot per event
//   staff.reconcile  {run_id, snapshots}              -> crm_reconcile_staff_roster
// Idempotency and ordering are enforced in the database. Responses carry ids, outcomes and
// counts; snapshots (names, emails) are never logged or echoed.

export type ApplyResult = Readonly<{ outcome?: string; reason?: string | null; duplicate?: boolean }>;

export type CrmSyncGateway = Readonly<{
  applyStaff: (eventId: string, snapshot: Record<string, unknown>) => Promise<ApplyResult>;
  reconcileStaff: (runId: string, snapshots: ReadonlyArray<Record<string, unknown>>) => Promise<Record<string, unknown>>;
}>;

export type ReceiveDeps = Readonly<{ secret: string | undefined; gateway: CrmSyncGateway | null }>;

const MAX_BODY_BYTES = 2_000_000;
const MAX_EVENTS = 200;
const MAX_SNAPSHOTS = 5_000;
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/;
const RUN_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;

function json(status: number, body: Readonly<Record<string, unknown>>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
  });
}

export function secretMatches(supplied: string | null, expected: string): boolean {
  if (!supplied) return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(supplied);
  const b = encoder.encode(expected);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index]! ^ b[index]!;
  return difference === 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function handleSyncReceive(request: Request, deps: ReceiveDeps): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  if (!deps.secret || !deps.gateway) return json(503, { error: "Sync is not configured" });
  if (!secretMatches(request.headers.get("x-crm-sync-secret"), deps.secret)) return json(401, { error: "Unauthorized" });

  let body: unknown;
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAX_BODY_BYTES) return json(413, { error: "Payload too large" });
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json(400, { error: "Request body must be JSON" });
  }
  if (!isObject(body)) return json(400, { error: "Invalid sync request" });

  const gateway = deps.gateway;
  if (body.kind === "staff.events") {
    const events = body.events;
    if (!Array.isArray(events) || events.length === 0 || events.length > MAX_EVENTS) return json(400, { error: "Invalid events" });
    for (const item of events) {
      if (!isObject(item) || typeof item.event_id !== "string" || !ID_PATTERN.test(item.event_id) || !isObject(item.snapshot)) {
        return json(400, { error: "Invalid events" });
      }
    }
    const results = [];
    for (const item of events as Array<{ event_id: string; snapshot: Record<string, unknown> }>) {
      try {
        const result = await gateway.applyStaff(item.event_id, item.snapshot);
        results.push({ event_id: item.event_id, ok: true, outcome: result.outcome ?? "unknown", duplicate: result.duplicate === true });
      } catch (error) {
        console.error("sync-receive apply failed:", error instanceof Error ? error.message : "unknown");
        results.push({ event_id: item.event_id, ok: false, error: "apply_failed" });
      }
    }
    return json(200, { results });
  }

  if (body.kind === "staff.reconcile") {
    const { run_id: runId, snapshots } = body;
    if (typeof runId !== "string" || !RUN_PATTERN.test(runId) || !Array.isArray(snapshots) || snapshots.length > MAX_SNAPSHOTS
      || !snapshots.every(isObject)) {
      return json(400, { error: "Invalid reconciliation" });
    }
    try {
      return json(200, { counts: await gateway.reconcileStaff(runId, snapshots as Array<Record<string, unknown>>) });
    } catch (error) {
      console.error("sync-receive reconcile failed:", error instanceof Error ? error.message : "unknown");
      return json(500, { error: "Reconciliation failed" });
    }
  }

  return json(400, { error: "Unknown sync kind" });
}
