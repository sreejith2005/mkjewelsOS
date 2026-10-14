import { describe, expect, it, vi } from "vitest";
import type { KiaraStreamEvent } from "@jewelos/core";
import type { AskKiaraOptions, AskKiaraOutcome } from "@jewelos/data/assistant/api";
import { sendKiaraQuestion } from "./sendKiaraQuestion";

const quota = { used: 1, limit: 10, resets_at: "2026-10-13T18:30:00.000Z" };
const result = { conversation_id: "c1", user_message_id: "u1", assistant_message_id: "a1", stop_reason: "end_turn", display_text: "Done", quota, citations: [] };
const streamClient = { functions: {} } as never;

describe("sendKiaraQuestion", () => {
  it("streams through the expo/fetch client as android", async () => {
    const ask = vi.fn(async (options: AskKiaraOptions): Promise<AskKiaraOutcome> => {
      options.onEvent?.({ event: "meta", data: { conversation_id: "c1", user_message_id: "u1", quota } });
      return { ok: true, requestId: options.requestId!, result };
    });
    const seen: KiaraStreamEvent["event"][] = [];
    const outcome = await sendKiaraQuestion({ conversationId: null, message: "kya pending hai", streamClient, onEvent: (event) => seen.push(event.event) }, ask);
    expect(outcome.ok).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0]![0]).toMatchObject({ client: "android", stream: true, functionsClient: streamClient, message: "kya pending hai" });
    expect(seen).toEqual(["meta"]);
  });

  it("retries a failed connection once as JSON with the same request id", async () => {
    const ask = vi.fn()
      .mockResolvedValueOnce({ ok: false, requestId: "x", code: "unavailable", message: "m", conversationId: null, transport: true })
      .mockResolvedValueOnce({ ok: true, requestId: "x", result });
    const outcome = await sendKiaraQuestion({ conversationId: "c1", message: "hi", streamClient }, ask);
    expect(outcome.ok).toBe(true);
    const [first, second] = ask.mock.calls.map((call) => call[0] as AskKiaraOptions);
    expect(second).toMatchObject({ stream: false, client: "android", conversationId: "c1" });
    expect(second!.functionsClient).toBeUndefined();
    expect(second!.requestId).toBe(first!.requestId);
  });

  it("does not retry a refusal (daily limit) or a stream that already started", async () => {
    const limit = vi.fn().mockResolvedValue({ ok: false, requestId: "x", code: "daily_limit_reached", message: "m", conversationId: null });
    await sendKiaraQuestion({ conversationId: null, message: "hi", streamClient }, limit);
    expect(limit).toHaveBeenCalledTimes(1);
    const dropped = vi.fn(async (options: AskKiaraOptions): Promise<AskKiaraOutcome> => {
      options.onEvent?.({ event: "meta", data: { conversation_id: "c1", user_message_id: "u1", quota } });
      return { ok: false, requestId: "x", code: "interrupted", message: "m", conversationId: "c1", transport: true };
    });
    await sendKiaraQuestion({ conversationId: null, message: "hi", streamClient }, dropped);
    expect(dropped).toHaveBeenCalledTimes(1);
  });

  it("uses the JSON contract directly when streaming is switched off", async () => {
    const ask = vi.fn().mockResolvedValue({ ok: true, requestId: "x", result });
    await sendKiaraQuestion({ conversationId: null, message: "hi", streamClient: null }, ask);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0]![0]).toMatchObject({ stream: false, client: "android" });
  });
});
