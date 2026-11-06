// Store Intelligence conversations from JewelOS (CRM migration 20261106000200).
// Called only AFTER the existing secret, method and total-body-size checks in worker.ts.
//   store_conversation.events    {events: [{event_id, payload}]}       -> crm_apply_store_conversation_event
//   store_conversation.outcomes  {tenantId, items: [{linkId,since,until}]} -> crm_store_conversation_outcomes
// The database validates every field again. Responses never echo the payload.

export type StoreConversationGateway = {
  applyStoreConversation?: (eventId: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  storeConversationOutcomes?: (tenantId: string, items: ReadonlyArray<Record<string, unknown>>) => Promise<Record<string, unknown>>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_ID = /^jewelos\.store_conversation\.[0-9a-f-]{36}\.(linked|unlinked)$/;
const KEPT = ["outcome", "reason", "client_id", "lead_id", "visit_id", "client_code", "display_name", "withdrawn", "duplicate"];
const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isInstant(value: unknown): value is string { return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value)); }

export async function receiveStoreConversationBatch(body: Record<string, unknown>, gateway: StoreConversationGateway): Promise<Response> {
  if (body.kind === "store_conversation.outcomes") {
    if (!gateway.storeConversationOutcomes) return json(503, { error: "Store conversation outcomes are not configured" });
    const items = body.items;
    if (typeof body.tenantId !== "string" || !UUID.test(body.tenantId) || !Array.isArray(items) || items.length < 1 || items.length > 50
      || !items.every((item) => object(item) && typeof item.linkId === "string" && UUID.test(item.linkId) && isInstant(item.since) && isInstant(item.until))) {
      return json(400, { error: "Invalid outcome request" });
    }
    try { return json(200, await gateway.storeConversationOutcomes(body.tenantId, items as Array<Record<string, unknown>>)); }
    catch { return json(500, { error: "Outcome read failed" }); }
  }
  if (!gateway.applyStoreConversation) return json(503, { error: "Store conversation receiver is not configured" });
  const events = body.events;
  if (!Array.isArray(events) || events.length < 1 || events.length > 10) return json(400, { error: "Invalid store conversation batch" });
  for (const item of events) {
    if (!object(item) || typeof item.event_id !== "string" || !EVENT_ID.test(item.event_id) || !object(item.payload) || item.payload.eventId !== item.event_id) {
      return json(400, { error: "Invalid store conversation event" });
    }
  }
  const results = [];
  for (const item of events as Array<{ event_id: string; payload: Record<string, unknown> }>) {
    try {
      const result = await gateway.applyStoreConversation(item.event_id, item.payload);
      const kept: Record<string, unknown> = { event_id: item.event_id, ok: true };
      for (const key of KEPT) if (key in result) kept[key] = result[key];
      results.push(kept);
    } catch {
      results.push({ event_id: item.event_id, ok: false, error: "apply_failed" });
    }
  }
  return json(200, { results });
}
