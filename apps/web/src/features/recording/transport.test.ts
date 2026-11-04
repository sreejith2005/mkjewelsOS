import { afterEach, expect, it, vi } from "vitest";
import { RecordingTransport } from "./transport";
import type { RecordingSession } from "@jewelos/core";
afterEach(() => vi.unstubAllGlobals());
it("authenticates WSS in the first message and binds the sequenced chunk without URL credentials", async () => {
  const id = "b626c751-1f01-43bc-8d34-f2a79c718f22";
  const session: RecordingSession = { id, device_id: id, tenant_id: id, employee_id: id, branch_id: id, status: "recording", next_sequence: 0, error_reason: null, created_at: "2026-11-04T00:00:00Z" };
  const sent: Record<string, unknown>[] = []; const urls: string[] = [];
  class Socket extends EventTarget {
    static OPEN = 1; readyState = 0; bufferedAmount = 0;
    constructor(url: string) { super(); urls.push(url); queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); }); }
    send(raw: string) {
      const value = JSON.parse(raw); sent.push(value);
      const response = value.type === "auth" ? { type: "authenticated", ingest_token: "t".repeat(64), expires_at: new Date(Date.now() + 300_000).toISOString(), session }
        : value.type === "commit" ? { session: { ...session, status: "processing" } } : { type: "ack", sequence: value.sequence, sha256: value.sha256, next_sequence: value.sequence + 1 };
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(response) })));
    }
    close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
  }
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("HTTPS fallback was unexpected"); }));
  const transport = new RecordingTransport(session, async () => ({ session, ticket: "one-use-ticket".repeat(3), expires_at: new Date(Date.now() + 60_000).toISOString(), upload_url: "https://ingest.example", stream_url: "wss://ingest.example" }));
  const sha256 = "a".repeat(64);
  expect(await transport.chunk({ sequence: 0, sha256, bytes: new Uint8Array([1,0]) })).toEqual({ sequence: 0, sha256 });
  await transport.commit(0);
  expect(urls).toEqual(["wss://ingest.example/v1/stream"]);
  expect(sent[0]?.type).toBe("auth");
  expect(sent[1]).toMatchObject({ type: "chunk", session_id: id, device_id: id, tenant_id: id, employee_id: id, branch_id: id, sequence: 0, sha256 });
  expect(sent[1]).not.toHaveProperty("ticket");
  transport.clearCredentials();
});
