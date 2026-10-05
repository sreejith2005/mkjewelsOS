// JewelOS Edge Function: delivers CRM roster sync events to the CRM project.
// Design: docs/superpowers/specs/2026-10-01-crm-two-project-client-database-design.md
// ("Roster sync", "Sync mechanism"); database contract: migration 0195.
//
// Called by pg_cron (x-cron-secret), never by a browser:
//   {"mode":"deliver"}   (default) claim due staff.access_changed events, send their
//                        snapshots to the CRM project's sync-receive, finish each event;
//   {"mode":"reconcile"} send the full roster; the CRM project deactivates any grant JewelOS
//                        no longer lists and returns counts.
// The response carries counts only. Snapshots (staff name and login email) are never logged.

export type StaffSnapshot = Readonly<Record<string, unknown> & { jewelos_user_id: string; snapshot_at: string }>;

export type ClaimedEvent = Readonly<{
  event_id: number;
  event_type: string;
  aggregate_id: string;
  snapshot: StaffSnapshot;
}>;

export type FinishState = "delivered" | "requeued" | "retry" | "dead" | "ignored";

export type JewelosSyncGateway = Readonly<{
  claim: (limit: number) => Promise<readonly ClaimedEvent[]>;
  finish: (eventId: number, ok: boolean, error: string | null) => Promise<FinishState>;
  roster: () => Promise<readonly StaffSnapshot[]>;
}>;

export type CrmEventResult = Readonly<{ event_id: string; ok: boolean; outcome?: string; error?: string }>;

export type CrmReceiver = Readonly<{
  /** POSTs to the CRM project's sync-receive. Returns the HTTP status and the parsed body (or null). */
  post: (body: Record<string, unknown>) => Promise<Readonly<{ status: number; body: unknown }>>;
}>;

export type StaffSyncDeps = Readonly<{
  cronSecret: string | undefined;
  jewelos: JewelosSyncGateway | null;
  crm: CrmReceiver | null;
  now?: () => Date;
}>;

const BATCH_SIZE = 50;
const MAX_BATCHES = 4;

function json(status: number, body: Readonly<Record<string, unknown>>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
  });
}

/** Constant-time comparison of a supplied secret with the configured one. */
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

/** The CRM inbox key: one per delivered snapshot, so an exact replay is applied once. */
export function crmEventId(event: ClaimedEvent): string {
  const at = Date.parse(event.snapshot.snapshot_at);
  return `jewelos.staff.${event.event_id}.${Number.isFinite(at) ? at : 0}`;
}

function resultsById(body: unknown): Map<string, CrmEventResult> {
  const results = (body as { results?: unknown } | null)?.results;
  const map = new Map<string, CrmEventResult>();
  if (!Array.isArray(results)) return map;
  for (const item of results) {
    const result = item as Partial<CrmEventResult>;
    if (typeof result?.event_id === "string" && typeof result.ok === "boolean") map.set(result.event_id, result as CrmEventResult);
  }
  return map;
}

async function deliver(jewelos: JewelosSyncGateway, crm: CrmReceiver) {
  const counts = { claimed: 0, delivered: 0, requeued: 0, retry: 0, dead: 0, ignored: 0 };
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const events = await jewelos.claim(BATCH_SIZE);
    if (events.length === 0) break;
    counts.claimed += events.length;
    let results = new Map<string, CrmEventResult>();
    let failure: string | null = null;
    try {
      const response = await crm.post({
        kind: "staff.events",
        events: events.map((event) => ({ event_id: crmEventId(event), snapshot: event.snapshot })),
      });
      if (response.status === 200) results = resultsById(response.body);
      else failure = `http_${response.status}`;
    } catch {
      failure = "network";
    }
    for (const event of events) {
      const result = results.get(crmEventId(event));
      const ok = failure === null && result?.ok === true;
      const error = ok ? null : failure ?? (typeof result?.error === "string" ? result.error : "no_result");
      counts[await jewelos.finish(event.event_id, ok, error)] += 1;
    }
    if (failure !== null || events.length < BATCH_SIZE) break;
  }
  return counts;
}

async function reconcile(jewelos: JewelosSyncGateway, crm: CrmReceiver, now: Date) {
  const snapshots = await jewelos.roster();
  // One run per minute at most: a repeated cron call within the minute is applied once.
  const runId = `jewelos-${now.toISOString().slice(0, 16).replace(/[^0-9]/g, "")}`;
  const response = await crm.post({ kind: "staff.reconcile", run_id: runId, snapshots });
  if (response.status !== 200) return { ok: false, error: `http_${response.status}` };
  const counts = (response.body as { counts?: unknown } | null)?.counts;
  return { ok: true, run_id: runId, counts: counts && typeof counts === "object" ? counts : {} };
}

export async function handleStaffSync(request: Request, deps: StaffSyncDeps): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  if (!deps.cronSecret || !deps.jewelos || !deps.crm) return json(503, { error: "CRM sync is not configured" });
  if (!secretMatches(request.headers.get("x-cron-secret"), deps.cronSecret)) return json(401, { error: "Scheduler authorization required" });

  let mode = "deliver";
  try {
    const text = await request.text();
    if (text.trim()) {
      const body = JSON.parse(text) as { mode?: unknown };
      if (body.mode !== undefined) mode = String(body.mode);
    }
  } catch {
    return json(400, { error: "Request body must be JSON" });
  }
  if (mode !== "deliver" && mode !== "reconcile") return json(400, { error: "mode must be deliver or reconcile" });

  try {
    if (mode === "reconcile") {
      const result = await reconcile(deps.jewelos, deps.crm, (deps.now ?? (() => new Date()))());
      return json(result.ok ? 200 : 502, result);
    }
    return json(200, await deliver(deps.jewelos, deps.crm));
  } catch (error) {
    console.error("crm-staff-sync failed:", error instanceof Error ? error.name : "unknown");
    return json(500, { error: "CRM sync failed" });
  }
}
