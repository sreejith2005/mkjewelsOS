// Store Intelligence -> CRM delivery (migration 0384, CRM 20261106000200). Runs inside the existing
// crm-customer-sync job, after customer events, over the same secret and CRM sync-receive endpoint.
//
// Two jobs:
//  1. Link / unlink events from crm_sync.recording_events. The CRM's answer is recorded exactly; an
//     unknown or malformed answer is a retry, never "delivered".
//  2. Purchase evidence for verified links: the CRM answers with its own walkin_purchase_evidence
//     rule; JewelOS stores the answer with its check time.
// Logs and results carry ids, outcomes and fixed codes only, never names or payloads.

export type RecordingDeliveryEvent = Readonly<{ id: string; lease_token: string; payload: Record<string, unknown> & { eventId: string } }>;
export type RecordingOutcomeCheck = Readonly<{ link_id: string; tenant_id: string; since: string; until: string }>;
export type RecordingFinish = "delivered" | "held" | "retry" | "dead" | "rejected";
export type RecordingGateway = Readonly<{
  claimRecording(limit: number): Promise<readonly RecordingDeliveryEvent[]>;
  finishRecording(id: string, lease: string, result: Record<string, unknown> | null, error: string | null): Promise<RecordingFinish>;
  claimOutcomeChecks(limit: number): Promise<readonly RecordingOutcomeCheck[]>;
  recordOutcomes(tenantId: string, results: readonly Record<string, unknown>[]): Promise<number>;
}>;
export type RecordingReceiver = Readonly<{ post(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> }>;
export type RecordingCounts = { claimed: number; delivered: number; held: number; retry: number; dead: number; rejected: number; outcomeChecks: number; outcomesRecorded: number };

const OUTCOMES = ["accepted", "retry", "rejected", "source_unapproved"] as const;
const STATES = ["purchase_verified", "no_purchase_recorded", "no_client", "not_linked"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** The CRM answer for one event, or the fixed error code that keeps it queued. */
export function judgeRecordingResult(event: RecordingDeliveryEvent, result: Record<string, unknown> | null): { result: Record<string, unknown> | null; error: string | null } {
  if (!result) return { result: null, error: "no_result" };
  if (result.ok !== true) return { result: null, error: "apply_failed" };
  const outcome = String(result.outcome);
  if (!(OUTCOMES as readonly string[]).includes(outcome)) return { result: null, error: "invalid_result" };
  if (outcome === "accepted" && event.payload.eventType === "store_conversation.linked"
    && !(typeof result.client_id === "string" && UUID.test(result.client_id)) && !(typeof result.lead_id === "string" && UUID.test(result.lead_id))) {
    return { result: null, error: "invalid_ack" };
  }
  // Only the fields JewelOS keeps: CRM identifiers, the minimal display cache and the verdict.
  const kept: Record<string, unknown> = { outcome };
  for (const key of ["reason", "client_id", "lead_id", "visit_id", "client_code", "display_name", "withdrawn", "duplicate"]) if (key in result) kept[key] = result[key];
  return { result: kept, error: null };
}

export async function syncRecordings(gateway: RecordingGateway, receiver: RecordingReceiver): Promise<RecordingCounts> {
  const counts: RecordingCounts = { claimed: 0, delivered: 0, held: 0, retry: 0, dead: 0, rejected: 0, outcomeChecks: 0, outcomesRecorded: 0 };
  for (let batch = 0; batch < 3; batch++) {
    const events = await gateway.claimRecording(10);
    if (!events.length) break;
    counts.claimed += events.length;
    let failure: string | null = null;
    let results: unknown[] = [];
    try {
      const response = await receiver.post({ kind: "store_conversation.events", events: events.map((e) => ({ event_id: e.payload.eventId, payload: e.payload })) });
      if (response.status !== 200) failure = `http_${response.status}`;
      const received = record(response.body)?.results;
      if (Array.isArray(received)) results = received;
    } catch {
      failure = "network";
    }
    for (const event of events) {
      const judged = failure
        ? { result: null, error: failure }
        : judgeRecordingResult(event, record(results.find((value) => record(value)?.event_id === event.payload.eventId)));
      counts[await gateway.finishRecording(event.id, event.lease_token, judged.result, judged.error)] += 1;
    }
    if (failure || events.length < 10) break;
  }

  const checks = await gateway.claimOutcomeChecks(50);
  counts.outcomeChecks = checks.length;
  const byTenant = new Map<string, RecordingOutcomeCheck[]>();
  for (const check of checks) byTenant.set(check.tenant_id, [...(byTenant.get(check.tenant_id) ?? []), check]);
  for (const [tenantId, items] of byTenant) {
    try {
      const response = await receiver.post({ kind: "store_conversation.outcomes", tenantId, items: items.map((c) => ({ linkId: c.link_id, since: c.since, until: c.until })) });
      const answered = record(response.body)?.results;
      if (response.status !== 200 || !Array.isArray(answered)) continue; // Checked again next run.
      const asked = new Set(items.map((c) => c.link_id));
      const valid = answered.map(record).filter((row): row is Record<string, unknown> =>
        row !== null && typeof row.linkId === "string" && asked.has(row.linkId) && (STATES as readonly string[]).includes(String(row.state)));
      if (valid.length) counts.outcomesRecorded += await gateway.recordOutcomes(tenantId, valid);
    } catch {
      /* Outcome reads are advisory; the next run asks again. */
    }
  }
  return counts;
}
