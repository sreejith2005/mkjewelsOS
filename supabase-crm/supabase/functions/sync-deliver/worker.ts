// CRM-project Edge Function: delivers CRM sync events (walk-in queue changes) to JewelOS.
// Design: docs/superpowers/specs/2026-10-01-crm-two-project-client-database-design.md
// ("Sync mechanism", "Event catalog"); database contract: supabase-crm migration 20261005000400.
//
// Called by pg_cron (x-cron-secret), never by a browser. It claims due walkin.changed events,
// sends their snapshots (computed at claim time) to JewelOS crm-sync-receive, and finishes each
// event (delivered, requeued when it changed in flight, retry with backoff, dead after 10).
// The response carries counts only. Snapshots (client display name, MKC) are never logged.

export type WalkinSnapshot = Readonly<Record<string, unknown> & { queue_id: string; snapshot_at: string }>;

export type ClaimedEvent = Readonly<{
  event_id: number;
  event_type: string;
  aggregate_id: string;
  snapshot: WalkinSnapshot;
}>;

export type FinishState = "delivered" | "requeued" | "retry" | "dead" | "ignored";

export type CrmOutboxGateway = Readonly<{
  claim: (limit: number) => Promise<readonly ClaimedEvent[]>;
  finish: (eventId: number, ok: boolean, error: string | null) => Promise<FinishState>;
}>;

export type ReceiverResult = Readonly<{ event_id: string; ok: boolean; outcome?: string; error?: string }>;

export type JewelosReceiver = Readonly<{
  /** POSTs to JewelOS crm-sync-receive. Returns the HTTP status and the parsed body (or null). */
  post: (body: Record<string, unknown>) => Promise<Readonly<{ status: number; body: unknown }>>;
}>;

export type DeliverDeps = Readonly<{
  cronSecret: string | undefined;
  crm: CrmOutboxGateway | null;
  jewelos: JewelosReceiver | null;
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

/** The JewelOS inbox key: one per delivered snapshot, so an exact replay is applied once. */
export function syncEventId(event: ClaimedEvent): string {
  const at = Date.parse(event.snapshot.snapshot_at);
  return `crm.walkin.${event.event_id}.${Number.isFinite(at) ? at : 0}`;
}

function resultsById(body: unknown): Map<string, ReceiverResult> {
  const results = (body as { results?: unknown } | null)?.results;
  const map = new Map<string, ReceiverResult>();
  if (!Array.isArray(results)) return map;
  for (const item of results) {
    const result = item as Partial<ReceiverResult>;
    if (typeof result?.event_id === "string" && typeof result.ok === "boolean") map.set(result.event_id, result as ReceiverResult);
  }
  return map;
}

async function deliver(crm: CrmOutboxGateway, jewelos: JewelosReceiver) {
  const counts = { claimed: 0, delivered: 0, requeued: 0, retry: 0, dead: 0, ignored: 0 };
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const events = await crm.claim(BATCH_SIZE);
    if (events.length === 0) break;
    counts.claimed += events.length;
    let results = new Map<string, ReceiverResult>();
    let failure: string | null = null;
    try {
      const response = await jewelos.post({
        kind: "walkin.events",
        events: events.map((event) => ({ event_id: syncEventId(event), snapshot: event.snapshot })),
      });
      if (response.status === 200) results = resultsById(response.body);
      else failure = `http_${response.status}`;
    } catch {
      failure = "network";
    }
    for (const event of events) {
      const result = results.get(syncEventId(event));
      const ok = failure === null && result?.ok === true;
      const error = ok ? null : failure ?? (typeof result?.error === "string" ? result.error : "no_result");
      counts[await crm.finish(event.event_id, ok, error)] += 1;
    }
    if (failure !== null || events.length < BATCH_SIZE) break;
  }
  return counts;
}

export async function handleSyncDeliver(request: Request, deps: DeliverDeps): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  if (!deps.cronSecret || !deps.crm || !deps.jewelos) return json(503, { error: "CRM sync is not configured" });
  if (!secretMatches(request.headers.get("x-cron-secret"), deps.cronSecret)) return json(401, { error: "Scheduler authorization required" });

  try {
    return json(200, await deliver(deps.crm, deps.jewelos));
  } catch (error) {
    console.error("sync-deliver failed:", error instanceof Error ? error.name : "unknown");
    return json(500, { error: "CRM sync failed" });
  }
}
