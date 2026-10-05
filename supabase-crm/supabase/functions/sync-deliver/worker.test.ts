import { assertEquals, assertFalse } from "@std/assert";
import { type ClaimedEvent, type CrmOutboxGateway, type FinishState, handleSyncDeliver, type JewelosReceiver, syncEventId } from "./worker.ts";

const SECRET = "cron-secret-for-tests";

function event(id: number, at = "2026-10-05T10:00:00.000Z"): ClaimedEvent {
  return {
    event_id: id, event_type: "walkin.changed", aggregate_id: `q-${id}`,
    snapshot: { queue_id: `q-${id}`, snapshot_at: at, client_name: "Synthetic Walk-in", client_code: "MKC-1", completed: false },
  };
}

function crm(batches: ClaimedEvent[][]) {
  const finished: Array<{ id: number; ok: boolean; error: string | null }> = [];
  const gateway: CrmOutboxGateway = {
    claim: () => Promise.resolve(batches.shift() ?? []),
    finish: (id, ok, error): Promise<FinishState> => {
      finished.push({ id, ok, error });
      return Promise.resolve(ok ? "delivered" : "retry");
    },
  };
  return { gateway, finished };
}

function jewelos(respond: (body: Record<string, unknown>) => { status: number; body: unknown } | Error) {
  const sent: Record<string, unknown>[] = [];
  const receiver: JewelosReceiver = {
    post: (body) => {
      sent.push(body);
      const result = respond(body);
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    },
  };
  return { receiver, sent };
}

const allOk = (body: Record<string, unknown>) => ({
  status: 200,
  body: { results: (body.events as Array<{ event_id: string }>).map((item) => ({ event_id: item.event_id, ok: true, outcome: "created" })) },
});

function post(secret: string | null = SECRET) {
  const headers: Record<string, string> = {};
  if (secret !== null) headers["x-cron-secret"] = secret;
  return new Request("http://local/sync-deliver", { method: "POST", headers });
}

Deno.test("refuses a missing or wrong cron secret and an unconfigured function", async () => {
  const { gateway } = crm([]);
  const { receiver } = jewelos(allOk);
  assertEquals((await handleSyncDeliver(post(null), { cronSecret: SECRET, crm: gateway, jewelos: receiver })).status, 401);
  assertEquals((await handleSyncDeliver(post("wrong"), { cronSecret: SECRET, crm: gateway, jewelos: receiver })).status, 401);
  assertEquals((await handleSyncDeliver(post(), { cronSecret: SECRET, crm: gateway, jewelos: null })).status, 503);
  assertEquals((await handleSyncDeliver(new Request("http://local", { method: "GET" }), { cronSecret: SECRET, crm: gateway, jewelos: receiver })).status, 405);
});

Deno.test("delivers walk-in snapshots to JewelOS and returns counts only", async () => {
  const { gateway, finished } = crm([[event(1), event(2)]]);
  const { receiver, sent } = jewelos(allOk);
  const response = await handleSyncDeliver(post(), { cronSecret: SECRET, crm: gateway, jewelos: receiver });
  const text = await response.text();
  assertEquals(JSON.parse(text), { claimed: 2, delivered: 2, requeued: 0, retry: 0, dead: 0, ignored: 0 });
  assertFalse(/synthetic|MKC-1|q-1/i.test(text));
  assertEquals(sent[0]?.kind, "walkin.events");
  assertEquals(finished.map((item) => item.ok), [true, true]);
});

Deno.test("failures retry with an error code", async () => {
  const { gateway, finished } = crm([[event(1)]]);
  const { receiver } = jewelos(() => ({ status: 401, body: null }));
  await handleSyncDeliver(post(), { cronSecret: SECRET, crm: gateway, jewelos: receiver });
  assertEquals(finished, [{ id: 1, ok: false, error: "http_401" }]);
  const second = crm([[event(2)]]);
  await handleSyncDeliver(post(), { cronSecret: SECRET, crm: second.gateway, jewelos: jewelos(() => new Error("reset")).receiver });
  assertEquals(second.finished, [{ id: 2, ok: false, error: "network" }]);
});

Deno.test("event ids are per snapshot and match the receiver's pattern", () => {
  assertFalse(syncEventId(event(3)) === syncEventId(event(3, "2026-10-05T10:01:00.000Z")));
  assertEquals(/^[A-Za-z0-9_.:-]{1,160}$/.test(syncEventId(event(3))), true);
});
