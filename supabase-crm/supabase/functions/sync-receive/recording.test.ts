import { assertEquals } from "@std/assert";
import { handleSyncReceive, type CrmSyncGateway } from "./worker.ts";

const linkId = "20261106-7777-4000-8000-000000000001";
const eventId = `jewelos.store_conversation.${linkId}.linked`;
let applied = 0;
const gateway: CrmSyncGateway = {
  applyStaff: () => Promise.resolve({}),
  reconcileStaff: () => Promise.resolve({}),
  applyStoreConversation: () => { applied++; return Promise.resolve({ outcome: "accepted", client_id: "c1", client_code: "MKC-1", display_name: "Asha", internal: "never echoed" }); },
  storeConversationOutcomes: (_tenant, items) => Promise.resolve({ results: items.map((i) => ({ linkId: i.linkId, state: "no_purchase_recorded" })) }),
};
const request = (body: unknown, secret = "test") => new Request("https://local.test", { method: "POST", headers: { "x-crm-sync-secret": secret }, body: JSON.stringify(body) });

Deno.test("store conversation events need the existing transport secret", async () => {
  applied = 0;
  const response = await handleSyncReceive(request({ kind: "store_conversation.events", events: [] }, "wrong"), { secret: "test", gateway });
  assertEquals(response.status, 401);
  assertEquals(applied, 0);
});

Deno.test("an accepted link returns only the kept fields", async () => {
  applied = 0;
  const response = await handleSyncReceive(request({ kind: "store_conversation.events", events: [{ event_id: eventId, payload: { eventId, transcript: "private" } }] }), { secret: "test", gateway });
  assertEquals(await response.json(), { results: [{ event_id: eventId, ok: true, outcome: "accepted", client_id: "c1", client_code: "MKC-1", display_name: "Asha" }] });
  assertEquals(applied, 1);
});

Deno.test("an envelope that does not match its payload, or a foreign event id, is refused before any apply", async () => {
  applied = 0;
  assertEquals((await handleSyncReceive(request({ kind: "store_conversation.events", events: [{ event_id: eventId, payload: { eventId: "other" } }] }), { secret: "test", gateway })).status, 400);
  assertEquals((await handleSyncReceive(request({ kind: "store_conversation.events", events: [{ event_id: "jewelos.form.x", payload: { eventId: "jewelos.form.x" } }] }), { secret: "test", gateway })).status, 400);
  assertEquals(applied, 0);
});

Deno.test("database errors never leak", async () => {
  const response = await handleSyncReceive(request({ kind: "store_conversation.events", events: [{ event_id: eventId, payload: { eventId } }] }),
    { secret: "test", gateway: { ...gateway, applyStoreConversation: () => Promise.reject(new Error("private name")) } });
  assertEquals(await response.json(), { results: [{ event_id: eventId, ok: false, error: "apply_failed" }] });
});

Deno.test("outcome reads are bounded and validated", async () => {
  const ok = await handleSyncReceive(request({ kind: "store_conversation.outcomes", tenantId: linkId, items: [{ linkId, since: "2026-11-01T00:00:00Z", until: "2026-12-01T00:00:00Z" }] }), { secret: "test", gateway });
  assertEquals(await ok.json(), { results: [{ linkId, state: "no_purchase_recorded" }] });
  const tooMany = Array(51).fill({ linkId, since: "2026-11-01T00:00:00Z", until: "2026-12-01T00:00:00Z" });
  assertEquals((await handleSyncReceive(request({ kind: "store_conversation.outcomes", tenantId: linkId, items: tooMany }), { secret: "test", gateway })).status, 400);
  assertEquals((await handleSyncReceive(request({ kind: "store_conversation.outcomes", tenantId: "x", items: [] }), { secret: "test", gateway })).status, 400);
});
