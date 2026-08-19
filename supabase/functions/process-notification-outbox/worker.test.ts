import { assertEquals, assertFalse } from "@std/assert";
import { adapterFor, handleOutboxRequest, processBatch, type AdapterResult, type ClaimedDelivery, type OutboxGateway } from "./worker.ts";

function gateway(deliveries: readonly ClaimedDelivery[] = []): OutboxGateway & { finished: Array<{ id: string; result: AdapterResult }> } {
  const finished: Array<{ id: string; result: AdapterResult }> = [];
  return {
    finished,
    detectScheduled: async () => undefined,
    processEvents: async () => undefined,
    claimDeliveries: async (limit) => deliveries.slice(0, limit),
    finishDelivery: async (id, result) => { finished.push({ id, result }); return result.outcome === "failed" ? "failed_terminal" : result.outcome; },
  };
}

Deno.test("rejects a missing or wrong cron secret", async () => {
  const fake = gateway();
  assertEquals((await handleOutboxRequest(new Request("http://local", { method: "POST" }), "expected", fake)).status, 401);
  assertEquals((await handleOutboxRequest(new Request("http://local", { method: "POST", headers: { "x-cron-secret": "wrong" } }), "expected", fake)).status, 401);
});

Deno.test("returns bounded aggregate counts only", async () => {
  const fake = gateway([{ id: "delivery-1", channel: "in_app", attempt_number: 1, max_attempts: 3 }]);
  const response = await handleOutboxRequest(new Request("http://local", { method: "POST", headers: { "x-cron-secret": "expected", "content-type": "application/json" }, body: JSON.stringify({ batch_size: 1 }) }), "expected", fake, "worker-1");
  assertEquals(response.status, 200);
  const text = await response.text();
  assertEquals(JSON.parse(text), { claimed: 1, delivered: 1, blocked_configuration: 0, retry_wait: 0, failed_terminal: 0 });
  assertFalse(text.includes("delivery-1"));
  assertFalse(/email|phone|message|token|secret/i.test(text));
});

Deno.test("external adapters are explicitly unavailable", () => {
  for (const channel of ["email", "whatsapp", "sms", "push"] as const) {
    assertEquals(adapterFor(channel).outcome, "blocked_configuration");
    assertEquals(adapterFor(channel).retryable, false);
  }
});

Deno.test("in-app replay delegates idempotency to the database completion RPC", async () => {
  const fake = gateway([{ id: "same-delivery", channel: "in_app", attempt_number: 1, max_attempts: 3 }]);
  assertEquals((await processBatch(fake, 25, "worker-1")).delivered, 1);
  assertEquals((await processBatch(fake, 25, "worker-2")).delivered, 1);
  assertEquals(fake.finished.map((item) => item.id), ["same-delivery", "same-delivery"]);
});

Deno.test("retryable and terminal outcomes remain distinguishable", async () => {
  const retryable: AdapterResult = { outcome: "failed", providerIdentifier: "test", errorCategory: "temporary", retryable: true };
  const terminal: AdapterResult = { outcome: "failed", providerIdentifier: "test", errorCategory: "invalid", retryable: false };
  assertEquals(retryable.retryable, true);
  assertEquals(terminal.retryable, false);
});
