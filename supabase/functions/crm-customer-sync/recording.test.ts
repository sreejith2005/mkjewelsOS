import { assertEquals } from "@std/assert";
import { judgeRecordingResult, syncRecordings, type RecordingDeliveryEvent, type RecordingGateway, type RecordingOutcomeCheck } from "./recording.ts";
import { handleCustomerSync } from "./worker.ts";

const linked: RecordingDeliveryEvent = { id: "e1", lease_token: "l1", payload: { eventId: "jewelos.store_conversation.20261106-0000-4000-8000-000000000001.linked", eventType: "store_conversation.linked" } };
const client = "20261106-2222-4000-8000-000000000001";

function fixture(answer: unknown, opts: { status?: number; reject?: boolean; checks?: RecordingOutcomeCheck[]; outcomes?: unknown } = {}) {
  const finished: Array<{ result: unknown; error: string | null }> = [];
  const recorded: unknown[] = [];
  const sent: Array<Record<string, unknown>> = [];
  let claimed = false;
  const gateway: RecordingGateway = {
    claimRecording: () => Promise.resolve(claimed ? [] : (claimed = true, [linked])),
    finishRecording: (_id, _lease, result, error) => { finished.push({ result, error }); return Promise.resolve(error ? "retry" : "delivered"); },
    claimOutcomeChecks: () => Promise.resolve(opts.checks ?? []),
    recordOutcomes: (tenant, results) => { recorded.push([tenant, results]); return Promise.resolve(results.length); },
  };
  const receiver = {
    post: (body: Record<string, unknown>) => {
      sent.push(body);
      if (opts.reject) return Promise.reject(new Error("synthetic network failure"));
      return Promise.resolve({ status: opts.status ?? 200, body: body.kind === "store_conversation.outcomes" ? opts.outcomes : answer });
    },
  };
  return { gateway, receiver, finished, recorded, sent };
}

Deno.test("an accepted link keeps only CRM identifiers and the minimal display", async () => {
  const f = fixture({ results: [{ event_id: linked.payload.eventId, ok: true, outcome: "accepted", client_id: client, client_code: "MKC-200001", display_name: "Asha", extra: "dropped" }] });
  const counts = await syncRecordings(f.gateway, f.receiver);
  assertEquals(f.finished, [{ result: { outcome: "accepted", client_id: client, client_code: "MKC-200001", display_name: "Asha" }, error: null }]);
  assertEquals(counts.delivered, 1);
  assertEquals(f.sent[0]!.kind, "store_conversation.events");
});

Deno.test("an accepted link without a CRM identity is never acknowledged", () => {
  assertEquals(judgeRecordingResult(linked, { ok: true, outcome: "accepted" }), { result: null, error: "invalid_ack" });
  assertEquals(judgeRecordingResult(linked, { ok: true, outcome: "accepted", client_id: "not-a-uuid" }), { result: null, error: "invalid_ack" });
});

Deno.test("unknown answers, failures and silence stay queued", () => {
  assertEquals(judgeRecordingResult(linked, null).error, "no_result");
  assertEquals(judgeRecordingResult(linked, { ok: false, error: "apply_failed" }).error, "apply_failed");
  assertEquals(judgeRecordingResult(linked, { ok: true, outcome: "synced_probably" }).error, "invalid_result");
});

Deno.test("held, retry and refusal answers pass through for the database to record", () => {
  assertEquals(judgeRecordingResult(linked, { ok: true, outcome: "source_unapproved" }).result, { outcome: "source_unapproved" });
  assertEquals(judgeRecordingResult(linked, { ok: true, outcome: "rejected", reason: "target_not_found" }).result, { outcome: "rejected", reason: "target_not_found" });
  assertEquals(judgeRecordingResult(linked, { ok: true, outcome: "retry", reason: "walkin_not_registered" }).result, { outcome: "retry", reason: "walkin_not_registered" });
});

Deno.test("a network failure leaves the event leased for retry", async () => {
  const f = fixture(null, { reject: true });
  await syncRecordings(f.gateway, f.receiver);
  assertEquals(f.finished, [{ result: null, error: "network" }]);
});

Deno.test("an HTTP error is recorded with its status code", async () => {
  const f = fixture({ error: "x" }, { status: 503 });
  await syncRecordings(f.gateway, f.receiver);
  assertEquals(f.finished, [{ result: null, error: "http_503" }]);
});

Deno.test("purchase evidence is asked per tenant and only answers to asked links are recorded", async () => {
  const checks: RecordingOutcomeCheck[] = [
    { link_id: "l-a", tenant_id: "t1", since: "2026-11-01T00:00:00Z", until: "2026-12-01T00:00:00Z" },
    { link_id: "l-b", tenant_id: "t1", since: "2026-11-01T00:00:00Z", until: "2026-12-01T00:00:00Z" },
  ];
  const f = fixture({ results: [] }, { checks, outcomes: { results: [
    { linkId: "l-a", state: "purchase_verified", purchaseVisitId: "v1" },
    { linkId: "l-x", state: "purchase_verified" },
    { linkId: "l-b", state: "maybe" },
  ] } });
  const counts = await syncRecordings(f.gateway, f.receiver);
  assertEquals(f.recorded, [["t1", [{ linkId: "l-a", state: "purchase_verified", purchaseVisitId: "v1" }]]]);
  assertEquals(counts.outcomesRecorded, 1);
  assertEquals(f.sent.find((b) => b.kind === "store_conversation.outcomes")?.items, [
    { linkId: "l-a", since: "2026-11-01T00:00:00Z", until: "2026-12-01T00:00:00Z" },
    { linkId: "l-b", since: "2026-11-01T00:00:00Z", until: "2026-12-01T00:00:00Z" },
  ]);
});

Deno.test("the customer job still answers when recording sync throws", async () => {
  const request = new Request("https://local.test", { method: "POST", headers: { "x-cron-secret": "test" } });
  const response = await handleCustomerSync(request, {
    secret: "test",
    gateway: { claim: () => Promise.resolve([]), finish: () => Promise.resolve("delivered") },
    receiver: { post: () => Promise.resolve({ status: 200, body: {} }) },
    recording: { claimRecording: () => Promise.reject(new Error("db down")), finishRecording: () => Promise.resolve("retry"), claimOutcomeChecks: () => Promise.resolve([]), recordOutcomes: () => Promise.resolve(0) },
  });
  assertEquals(response.status, 200);
  assertEquals((await response.json()).recording, { error: "recording_sync_failed" });
});
