import { assertEquals, assertFalse } from "@std/assert";
import { handleCrmSyncReceive, type JewelosSyncGateway } from "./worker.ts";

const SECRET = "inbound-secret-for-tests";
const snapshot = { queue_id: "q-1", snapshot_at: "2026-10-05T10:00:00Z", client_name: "Synthetic Walk-in", client_code: "MKC-1" };

function fake(failFor?: string) {
  const applied: string[] = [];
  const gateway: JewelosSyncGateway = {
    applyWalkin: (eventId) => {
      if (eventId === failFor) return Promise.reject(new Error("rpc_22023"));
      applied.push(eventId);
      return Promise.resolve({ outcome: "created" });
    },
  };
  return { gateway, applied };
}

function post(body: unknown, secret: string | null = SECRET) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-crm-sync-secret"] = secret;
  return new Request("http://local/crm-sync-receive", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}

Deno.test("refuses a missing or wrong secret and an unconfigured function", async () => {
  const { gateway, applied } = fake();
  assertEquals((await handleCrmSyncReceive(post({ kind: "walkin.events" }, null), { secret: SECRET, gateway })).status, 401);
  assertEquals((await handleCrmSyncReceive(post({ kind: "walkin.events" }, "nope"), { secret: SECRET, gateway })).status, 401);
  assertEquals((await handleCrmSyncReceive(post({}), { secret: undefined, gateway })).status, 503);
  assertEquals((await handleCrmSyncReceive(new Request("http://local", { method: "GET" }), { secret: SECRET, gateway })).status, 405);
  assertEquals(applied.length, 0);
});

Deno.test("applies each walk-in event; failures are per event; no personal values echoed", async () => {
  const { gateway, applied } = fake("crm.walkin.1.1");
  const response = await handleCrmSyncReceive(post({ kind: "walkin.events", events: [
    { event_id: "crm.walkin.1.1", snapshot },
    { event_id: "crm.walkin.2.1", snapshot },
  ] }), { secret: SECRET, gateway });
  const text = await response.text();
  assertEquals(JSON.parse(text).results, [
    { event_id: "crm.walkin.1.1", ok: false, error: "apply_failed" },
    { event_id: "crm.walkin.2.1", ok: true, outcome: "created", duplicate: false },
  ]);
  assertFalse(/synthetic|MKC-1/i.test(text));
  assertEquals(applied, ["crm.walkin.2.1"]);
});

Deno.test("rejects malformed requests and unknown kinds", async () => {
  const { gateway } = fake();
  const cases: unknown[] = [
    "{",
    { kind: "staff.events", events: [] },
    { kind: "walkin.events", events: [] },
    { kind: "walkin.events", events: [{ event_id: "has space", snapshot }] },
  ];
  for (const body of cases) assertEquals((await handleCrmSyncReceive(post(body), { secret: SECRET, gateway })).status, 400);
});

// Saved-submission events for FMS start triggers (migration 0374).
function fakeSubmissions(failFor?: string) {
  const applied: Array<{ id: string; payload: Record<string, unknown> }> = [];
  const gateway: JewelosSyncGateway = {
    applyWalkin: () => Promise.reject(new Error("wrong stream")),
    applySubmission: (eventId, payload) => {
      if (eventId === failFor) return Promise.reject(new Error("rpc_P0001"));
      applied.push({ id: eventId, payload });
      return Promise.resolve({ outcome: "processed", duplicate: eventId === "crm.sub.9" });
    },
  };
  return { gateway, applied };
}
const visit = { kind: "crm.walkin_visit_saved", record_id: "v-1", answers: { visit_status: "NO" } };

Deno.test("applies submission.events through the submission gateway, one result per event", async () => {
  const { gateway, applied } = fakeSubmissions("crm.sub.2");
  const response = await handleCrmSyncReceive(post({ kind: "submission.events", events: [
    { event_id: "crm.sub.1", payload: visit }, { event_id: "crm.sub.2", payload: visit }, { event_id: "crm.sub.9", payload: visit },
  ] }), { secret: SECRET, gateway });
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.results.map((item: { ok: boolean }) => item.ok), [true, false, true]);
  assertEquals(body.results[2].duplicate, true);
  assertEquals(applied.map((item) => item.id), ["crm.sub.1", "crm.sub.9"]);
  assertFalse(JSON.stringify(body).includes("NO"));
});

Deno.test("refuses submission events without a payload or with a bad id, and an old deployment without the gateway", async () => {
  const { gateway } = fakeSubmissions();
  assertEquals((await handleCrmSyncReceive(post({ kind: "submission.events", events: [{ event_id: "crm.sub.1", snapshot: visit }] }), { secret: SECRET, gateway })).status, 400);
  assertEquals((await handleCrmSyncReceive(post({ kind: "submission.events", events: [{ event_id: "bad id!", payload: visit }] }), { secret: SECRET, gateway })).status, 400);
  const walkinOnly: JewelosSyncGateway = { applyWalkin: () => Promise.resolve({ outcome: "created" }) };
  assertEquals((await handleCrmSyncReceive(post({ kind: "submission.events", events: [{ event_id: "crm.sub.1", payload: visit }] }), { secret: SECRET, gateway: walkinOnly })).status, 503);
});
