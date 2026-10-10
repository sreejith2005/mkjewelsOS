import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeKiaraEvent, type KiaraStreamEvent } from "@jewelos/core";

const api = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn() }));
vi.mock("@jewelos/api-client/client", () => ({
  getSupabase: () => ({ functions: { invoke: api.invoke }, rpc: api.rpc }),
}));

import { askKiara, getMyKiaraConversation, getMyKiaraQuota, listMyKiaraConversations } from "./api";

const quota = { used: 2, limit: 10, resets_at: "2026-10-09T18:30:00.000Z" };
const requestId = "33333333-3333-4333-8333-333333333333";

function sse(events: KiaraStreamEvent[], chunkSize = 7): Response {
  const wire = events.map(encodeKiaraEvent).join("");
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let index = 0; index < wire.length; index += chunkSize) controller.enqueue(encoder.encode(wire.slice(index, index + chunkSize)));
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

beforeEach(() => {
  api.invoke.mockReset();
  api.rpc.mockReset();
});

describe("askKiara", () => {
  it("streams events in order and resolves with the done payload", async () => {
    const events: KiaraStreamEvent[] = [
      { event: "meta", data: { conversation_id: "c1", user_message_id: "u1", quota } },
      { event: "status", data: { phase: "tool", label: "Checking your work" } },
      { event: "delta", data: { text: "Aapke 2 " } },
      { event: "delta", data: { text: "task pending hain." } },
      { event: "citation", data: { marker: 1, chunk_id: "k1", document_id: "d1", title: "Synthetic SOP", heading_path: "Opening" } },
      { event: "done", data: { assistant_message_id: "a1", stop_reason: "end_turn", quota, display_text: "Aapke 2 task pending hain." } },
    ];
    api.invoke.mockResolvedValue({ data: sse(events), error: null });
    const seen: string[] = [];
    const outcome = await askKiara({ conversationId: null, message: "aaj mera kya pending hai?", client: "web", requestId, onEvent: (event) => seen.push(event.event) });
    expect(seen).toEqual(["meta", "status", "delta", "delta", "citation", "done"]);
    expect(outcome).toEqual({ ok: true, requestId, result: { conversation_id: "c1", user_message_id: "u1", assistant_message_id: "a1", stop_reason: "end_turn", display_text: "Aapke 2 task pending hain.", quota,
      citations: [{ marker: 1, chunk_id: "k1", document_id: "d1", title: "Synthetic SOP", heading_path: "Opening" }], escalation_offer: null } });
    expect(api.invoke).toHaveBeenCalledWith("ask-kiara/chat", expect.objectContaining({
      method: "POST",
      headers: { Accept: "text/event-stream" },
      body: { conversation_id: null, request_id: requestId, message: "aaj mera kya pending hai?", client: "web" },
    }));
  });

  it("generates a request id when none is given", async () => {
    api.invoke.mockResolvedValue({ data: sse([{ event: "error", data: { code: "provider_error", message: "Try again" } }]), error: null });
    const outcome = await askKiara({ conversationId: "c1", message: "hi", client: "web" });
    expect(outcome.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(outcome).toEqual(expect.objectContaining({ ok: false, code: "provider_error", message: "Try again", conversationId: "c1" }));
  });

  it("reports an interrupted stream with the conversation it belongs to", async () => {
    api.invoke.mockResolvedValue({ data: sse([{ event: "meta", data: { conversation_id: "c9", user_message_id: "u9", quota } }, { event: "delta", data: { text: "Half" } }]), error: null });
    const outcome = await askKiara({ conversationId: null, message: "hi", client: "web", requestId });
    expect(outcome).toEqual(expect.objectContaining({ ok: false, code: "interrupted", conversationId: "c9" }));
  });

  it("reads a buffered SSE body when the platform cannot stream", async () => {
    const wire = [
      { event: "meta", data: { conversation_id: "c1", user_message_id: "u1", quota } },
      { event: "done", data: { assistant_message_id: "a1", stop_reason: "end_turn", quota, display_text: "Done." } },
    ].map((event) => encodeKiaraEvent(event as KiaraStreamEvent)).join("");
    const buffered = { body: null, text: () => Promise.resolve(wire) };
    Object.setPrototypeOf(buffered, Response.prototype);
    api.invoke.mockResolvedValue({ data: buffered, error: null });
    const outcome = await askKiara({ conversationId: null, message: "hi", client: "android", requestId });
    expect(outcome.ok && outcome.result.display_text).toBe("Done.");
  });

  it("uses the JSON contract when streaming is off", async () => {
    api.invoke.mockResolvedValue({ data: { conversation_id: "c1", user_message_id: "u1", assistant_message_id: "a1", stop_reason: "end_turn", display_text: "JSON answer", quota }, error: null });
    const outcome = await askKiara({ conversationId: null, message: "hi", client: "android", requestId, stream: false });
    expect(outcome.ok && outcome.result.display_text).toBe("JSON answer");
    expect(api.invoke).toHaveBeenCalledWith("ask-kiara/chat", expect.objectContaining({ headers: { Accept: "application/json" } }));
  });

  it("surfaces the daily limit with the quota from the error body", async () => {
    const context = new Response(JSON.stringify({ error: "You have used all your questions for today.", code: "daily_limit_reached", quota: { ...quota, used: 10 } }), { status: 429, headers: { "content-type": "application/json" } });
    api.invoke.mockResolvedValue({ data: null, error: { context } });
    const outcome = await askKiara({ conversationId: null, message: "11th", client: "web", requestId });
    expect(outcome).toEqual({ ok: false, requestId, conversationId: null, code: "daily_limit_reached", message: "You have used all your questions for today.", quota: { ...quota, used: 10, timezone: undefined } });
  });

  it("falls back to a content-free message when the error has no body", async () => {
    api.invoke.mockResolvedValue({ data: null, error: new Error("network") });
    const outcome = await askKiara({ conversationId: null, message: "hi", client: "web", requestId });
    expect(outcome).toEqual(expect.objectContaining({ ok: false, code: "unavailable", message: "Kiara could not answer right now. Please try again." }));
  });
});

describe("conversation reads", () => {
  it("lists conversations and drops malformed rows", async () => {
    api.rpc.mockResolvedValue({ data: [{ id: "c1", title: "Pending work", client: "web", created_at: "2026-10-09T05:00:00Z", last_message_at: "2026-10-09T05:01:00Z", question_count: 2 }, { id: 4 }], error: null });
    await expect(listMyKiaraConversations()).resolves.toEqual([{ id: "c1", title: "Pending work", client: "web", created_at: "2026-10-09T05:00:00Z", last_message_at: "2026-10-09T05:01:00Z", question_count: 2 }]);
    expect(api.rpc).toHaveBeenCalledWith("list_my_kiara_conversations", { p_limit: 30 });
  });

  it("loads a conversation's display messages only", async () => {
    api.rpc.mockResolvedValue({
      data: {
        id: "c1", title: "Pending work", created_at: "2026-10-09T05:00:00Z", last_message_at: "2026-10-09T05:01:00Z", question_count: 1,
        messages: [
          { id: "m1", ordinal: 1, role: "user", display_text: "What is pending?", refunded: false, created_at: "2026-10-09T05:00:00Z" },
          { id: "m2", ordinal: 2, role: "assistant", display_text: "Two tasks [1].", reply_to_message_id: "m1", stop_reason: "end_turn", created_at: "2026-10-09T05:00:05Z", api_content: [{ secret: true }],
            citations: [{ marker: 1, chunk_id: "k1", document_id: "d1", version_id: "v1", title: "Synthetic SOP", heading_path: "Opening" }, { marker: "x" }] },
        ],
      },
      error: null,
    });
    const conversation = await getMyKiaraConversation("c1");
    expect(conversation.messages.map((message) => [message.role, message.display_text])).toEqual([["user", "What is pending?"], ["assistant", "Two tasks [1]."]]);
    expect(conversation.messages[1]!.citations).toEqual([{ marker: 1, chunk_id: "k1", document_id: "d1", title: "Synthetic SOP", heading_path: "Opening" }]);
    expect(JSON.stringify(conversation)).not.toContain("secret");
  });

  it("parses the quota", async () => {
    api.rpc.mockResolvedValue({ data: { used: 3, limit: null, resets_at: "2026-10-09T18:30:00Z", timezone: "Asia/Kolkata" }, error: null });
    await expect(getMyKiaraQuota()).resolves.toEqual({ used: 3, limit: null, resets_at: "2026-10-09T18:30:00Z", timezone: "Asia/Kolkata" });
  });
});
