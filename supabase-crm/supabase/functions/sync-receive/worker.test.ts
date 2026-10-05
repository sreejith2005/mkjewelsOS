import { assertEquals, assertFalse } from "@std/assert";
import { type CrmSyncGateway, handleSyncReceive } from "./worker.ts";

const SECRET = "inbound-secret-for-tests";

function fake(options: { failFor?: string } = {}) {
  const applied: string[] = [];
  const reconciled: Array<{ runId: string; count: number }> = [];
  const gateway: CrmSyncGateway = {
    applyStaff: (eventId) => {
      if (eventId === options.failFor) return Promise.reject(new Error("rpc_42501"));
      applied.push(eventId);
      return Promise.resolve({ outcome: "granted" });
    },
    reconcileStaff: (runId, snapshots) => {
      reconciled.push({ runId, count: snapshots.length });
      return Promise.resolve({ granted: snapshots.length, absent_deactivated: 0 });
    },
  };
  return { gateway, applied, reconciled };
}

function post(body: unknown, secret: string | null = SECRET) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-crm-sync-secret"] = secret;
  return new Request("http://local/sync-receive", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}

const snapshot = { jewelos_user_id: "11111111-1111-4111-8111-111111111111", name: "Synthetic Person", email: "synthetic@example.invalid" };

Deno.test("refuses a missing or wrong secret before reading the body, and an unconfigured function", async () => {
  const { gateway, applied } = fake();
  assertEquals((await handleSyncReceive(post({ kind: "staff.events" }, null), { secret: SECRET, gateway })).status, 401);
  assertEquals((await handleSyncReceive(post({ kind: "staff.events" }, "nope"), { secret: SECRET, gateway })).status, 401);
  assertEquals((await handleSyncReceive(post({}), { secret: undefined, gateway })).status, 503);
  assertEquals((await handleSyncReceive(new Request("http://local", { method: "GET" }), { secret: SECRET, gateway })).status, 405);
  assertEquals(applied.length, 0);
});

Deno.test("applies each staff event and reports per-event outcomes without personal values", async () => {
  const { gateway, applied } = fake();
  const response = await handleSyncReceive(post({ kind: "staff.events", events: [
    { event_id: "jewelos.staff.1.1", snapshot },
    { event_id: "jewelos.staff.2.1", snapshot },
  ] }), { secret: SECRET, gateway });
  assertEquals(response.status, 200);
  const text = await response.text();
  assertEquals(JSON.parse(text).results.map((item: { ok: boolean }) => item.ok), [true, true]);
  assertFalse(/synthetic|example\.invalid/i.test(text));
  assertEquals(applied, ["jewelos.staff.1.1", "jewelos.staff.2.1"]);
});

Deno.test("a failing event is reported with an error code; the others still apply", async () => {
  const { gateway, applied } = fake({ failFor: "jewelos.staff.1.1" });
  const response = await handleSyncReceive(post({ kind: "staff.events", events: [
    { event_id: "jewelos.staff.1.1", snapshot },
    { event_id: "jewelos.staff.2.1", snapshot },
  ] }), { secret: SECRET, gateway });
  const body = await response.json();
  assertEquals(body.results[0], { event_id: "jewelos.staff.1.1", ok: false, error: "apply_failed" });
  assertEquals(body.results[1].ok, true);
  assertEquals(applied, ["jewelos.staff.2.1"]);
});

Deno.test("rejects malformed requests", async () => {
  const { gateway } = fake();
  const cases: unknown[] = [
    "{",
    [],
    { kind: "staff.events", events: [] },
    { kind: "staff.events", events: [{ event_id: "bad id with spaces", snapshot }] },
    { kind: "staff.events", events: [{ event_id: "ok.id", snapshot: "text" }] },
    { kind: "staff.events", events: Array.from({ length: 201 }, (_, index) => ({ event_id: `e.${index}`, snapshot })) },
    { kind: "staff.reconcile", run_id: "bad run", snapshots: [] },
    { kind: "staff.reconcile", run_id: "run-1", snapshots: ["x"] },
    { kind: "client.delete" },
  ];
  for (const body of cases) assertEquals((await handleSyncReceive(post(body), { secret: SECRET, gateway })).status, 400);
});

Deno.test("refuses a body over 2 MB", async () => {
  const { gateway } = fake();
  const big = JSON.stringify({ kind: "staff.events", events: [{ event_id: "e.1", snapshot: { pad: "x".repeat(2_100_000) } }] });
  assertEquals((await handleSyncReceive(post(big), { secret: SECRET, gateway })).status, 413);
});

Deno.test("reconciles the roster and returns counts", async () => {
  const { gateway, reconciled } = fake();
  const response = await handleSyncReceive(post({ kind: "staff.reconcile", run_id: "jewelos-202610051830", snapshots: [snapshot, snapshot] }),
    { secret: SECRET, gateway });
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { counts: { granted: 2, absent_deactivated: 0 } });
  assertEquals(reconciled, [{ runId: "jewelos-202610051830", count: 2 }]);
});
