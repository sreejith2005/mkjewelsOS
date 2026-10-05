import { assertEquals, assertFalse } from "@std/assert";
import {
  type ClaimedEvent,
  crmEventId,
  type CrmReceiver,
  type FinishState,
  handleStaffSync,
  type JewelosSyncGateway,
  secretMatches,
  type StaffSnapshot,
} from "./worker.ts";

const SECRET = "cron-secret-for-tests";

function snapshot(id: string, at = "2026-10-05T10:00:00.000Z"): StaffSnapshot {
  return { jewelos_user_id: id, snapshot_at: at, name: "Synthetic Person", email: "synthetic@example.invalid", eligible: true };
}

function event(id: number, person = `p-${id}`): ClaimedEvent {
  return { event_id: id, event_type: "staff.access_changed", aggregate_id: person, snapshot: snapshot(person) };
}

function jewelos(batches: ClaimedEvent[][], roster: StaffSnapshot[] = []) {
  const finished: Array<{ id: number; ok: boolean; error: string | null }> = [];
  const gateway: JewelosSyncGateway = {
    claim: () => Promise.resolve(batches.shift() ?? []),
    finish: (id, ok, error): Promise<FinishState> => {
      finished.push({ id, ok, error });
      return Promise.resolve(ok ? "delivered" : "retry");
    },
    roster: () => Promise.resolve(roster),
  };
  return { gateway, finished };
}

function crm(respond: (body: Record<string, unknown>) => { status: number; body: unknown } | Error) {
  const sent: Record<string, unknown>[] = [];
  const receiver: CrmReceiver = {
    post: (body) => {
      sent.push(body);
      const result = respond(body);
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    },
  };
  return { receiver, sent };
}

function okFor(body: Record<string, unknown>) {
  const events = body.events as Array<{ event_id: string }>;
  return { status: 200, body: { results: events.map((item) => ({ event_id: item.event_id, ok: true, outcome: "granted" })) } };
}

function post(body?: unknown, secret: string | null = SECRET) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-cron-secret"] = secret;
  return new Request("http://local/crm-staff-sync", { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

Deno.test("refuses a missing or wrong cron secret, and an unconfigured function", async () => {
  const { gateway } = jewelos([]);
  const { receiver } = crm(okFor);
  assertEquals((await handleStaffSync(post(undefined, null), { cronSecret: SECRET, jewelos: gateway, crm: receiver })).status, 401);
  assertEquals((await handleStaffSync(post(undefined, "wrong"), { cronSecret: SECRET, jewelos: gateway, crm: receiver })).status, 401);
  assertEquals((await handleStaffSync(post(), { cronSecret: undefined, jewelos: gateway, crm: receiver })).status, 503);
  assertEquals((await handleStaffSync(post(), { cronSecret: SECRET, jewelos: gateway, crm: null })).status, 503);
  assertEquals((await handleStaffSync(new Request("http://local", { method: "GET" }), { cronSecret: SECRET, jewelos: gateway, crm: receiver })).status, 405);
});

Deno.test("constant-time secret comparison", () => {
  assertEquals(secretMatches("abc", "abc"), true);
  assertEquals(secretMatches("abd", "abc"), false);
  assertEquals(secretMatches("ab", "abc"), false);
  assertEquals(secretMatches(null, "abc"), false);
});

Deno.test("delivers claimed snapshots and finishes each event; the response has counts only", async () => {
  const { gateway, finished } = jewelos([[event(1), event(2)]]);
  const { receiver, sent } = crm(okFor);
  const response = await handleStaffSync(post({ mode: "deliver" }), { cronSecret: SECRET, jewelos: gateway, crm: receiver });
  assertEquals(response.status, 200);
  const text = await response.text();
  assertEquals(JSON.parse(text), { claimed: 2, delivered: 2, requeued: 0, retry: 0, dead: 0, ignored: 0 });
  assertFalse(/synthetic|example\.invalid|p-1/i.test(text));
  assertEquals(finished, [{ id: 1, ok: true, error: null }, { id: 2, ok: true, error: null }]);
  assertEquals(sent[0]?.kind, "staff.events");
  assertEquals((sent[0]?.events as unknown[]).length, 2);
});

Deno.test("an HTTP failure retries every event of the batch with an error code", async () => {
  const { gateway, finished } = jewelos([[event(1), event(2)]]);
  const { receiver } = crm(() => ({ status: 502, body: { error: "upstream said 9000000001" } }));
  const response = await handleStaffSync(post(), { cronSecret: SECRET, jewelos: gateway, crm: receiver });
  assertEquals((await response.json()).retry, 2);
  assertEquals(finished.map((item) => item.error), ["http_502", "http_502"]);
});

Deno.test("a network failure retries with error code network", async () => {
  const { gateway, finished } = jewelos([[event(1)]]);
  const { receiver } = crm(() => new Error("connection reset"));
  await handleStaffSync(post(), { cronSecret: SECRET, jewelos: gateway, crm: receiver });
  assertEquals(finished, [{ id: 1, ok: false, error: "network" }]);
});

Deno.test("a per-event refusal retries only that event", async () => {
  const { gateway, finished } = jewelos([[event(1), event(2)]]);
  const { receiver } = crm((body) => {
    const events = body.events as Array<{ event_id: string }>;
    return { status: 200, body: { results: [{ event_id: events[0]!.event_id, ok: true }, { event_id: events[1]!.event_id, ok: false, error: "apply_failed" }] } };
  });
  await handleStaffSync(post(), { cronSecret: SECRET, jewelos: gateway, crm: receiver });
  assertEquals(finished, [{ id: 1, ok: true, error: null }, { id: 2, ok: false, error: "apply_failed" }]);
});

Deno.test("a missing per-event result is not counted as delivered", async () => {
  const { gateway, finished } = jewelos([[event(1)]]);
  const { receiver } = crm(() => ({ status: 200, body: { results: [] } }));
  await handleStaffSync(post(), { cronSecret: SECRET, jewelos: gateway, crm: receiver });
  assertEquals(finished, [{ id: 1, ok: false, error: "no_result" }]);
});

Deno.test("full batches continue; a short batch stops", async () => {
  const full = Array.from({ length: 50 }, (_, index) => event(index + 1));
  const { gateway } = jewelos([full, [event(51)], [event(52)]]);
  const { receiver, sent } = crm(okFor);
  const response = await handleStaffSync(post(), { cronSecret: SECRET, jewelos: gateway, crm: receiver });
  assertEquals((await response.json()).claimed, 51);
  assertEquals(sent.length, 2);
});

Deno.test("event ids differ per snapshot so a requeued event is applied again", () => {
  const first = event(7);
  const again = { ...first, snapshot: snapshot(first.aggregate_id, "2026-10-05T10:05:00.000Z") };
  assertFalse(crmEventId(first) === crmEventId(again));
  assertEquals(/^[A-Za-z0-9_.:-]{1,160}$/.test(crmEventId(first)), true);
});

Deno.test("reconcile sends the roster with a per-minute run id and returns counts", async () => {
  const { gateway } = jewelos([], [snapshot("a"), snapshot("b")]);
  const { receiver, sent } = crm(() => ({ status: 200, body: { counts: { granted: 2, absent_deactivated: 0 } } }));
  const response = await handleStaffSync(post({ mode: "reconcile" }), {
    cronSecret: SECRET, jewelos: gateway, crm: receiver, now: () => new Date("2026-10-05T18:30:45Z"),
  });
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { ok: true, run_id: "jewelos-202610051830", counts: { granted: 2, absent_deactivated: 0 } });
  assertEquals(sent[0]?.kind, "staff.reconcile");
  assertEquals((sent[0]?.snapshots as unknown[]).length, 2);
});

Deno.test("rejects an unknown mode and a non-JSON body", async () => {
  const { gateway } = jewelos([]);
  const { receiver } = crm(okFor);
  assertEquals((await handleStaffSync(post({ mode: "purge" }), { cronSecret: SECRET, jewelos: gateway, crm: receiver })).status, 400);
  const bad = new Request("http://local", { method: "POST", headers: { "x-cron-secret": SECRET }, body: "{" });
  assertEquals((await handleStaffSync(bad, { cronSecret: SECRET, jewelos: gateway, crm: receiver })).status, 400);
});
