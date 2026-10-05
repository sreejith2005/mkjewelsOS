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
