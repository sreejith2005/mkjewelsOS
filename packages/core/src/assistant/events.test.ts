import { describe, expect, it } from "vitest";
import { createKiaraEventParser, encodeKiaraEvent, parseKiaraEvent, type KiaraStreamEvent } from "./events";

const quota = { used: 3, limit: 10, resets_at: "2026-10-09T18:30:00.000Z" };
const stream: KiaraStreamEvent[] = [
  { event: "meta", data: { conversation_id: "c1", user_message_id: "u1", quota } },
  { event: "status", data: { phase: "tool", label: "Checking your work" } },
  { event: "delta", data: { text: "You have " } },
  { event: "delta", data: { text: "2 tasks.\nBoth due today." } },
  { event: "done", data: { assistant_message_id: "a1", stop_reason: "end_turn", quota, display_text: "You have 2 tasks.\nBoth due today." } },
];

const collect = (chunks: readonly string[]) => {
  const events: KiaraStreamEvent[] = [];
  const parser = createKiaraEventParser((event) => events.push(event));
  for (const chunk of chunks) parser.push(chunk);
  parser.end();
  return events;
};

describe("Kiara SSE events", () => {
  it("round-trips the encoded stream", () => {
    expect(collect([stream.map(encodeKiaraEvent).join("")])).toEqual(stream);
  });

  it("reassembles events split at any byte", () => {
    const wire = stream.map(encodeKiaraEvent).join("");
    const chunks = [...wire].map((character) => character);
    expect(collect(chunks)).toEqual(stream);
  });

  it("accepts CRLF framing and ignores comments and unknown events", () => {
    const wire = ": keep-alive\r\n\r\nevent: surprise\r\ndata: {}\r\n\r\n" + encodeKiaraEvent(stream[2]!).replace(/\n/g, "\r\n");
    expect(collect([wire])).toEqual([stream[2]]);
  });

  it("drops malformed payloads", () => {
    expect(collect(["event: delta\ndata: not json\n\n", "event: delta\ndata: {\"text\":42}\n\n"])).toEqual([]);
    expect(parseKiaraEvent("meta", { conversation_id: "c", user_message_id: "u", quota: { used: -1, limit: 1, resets_at: "x" } })).toBeNull();
    expect(parseKiaraEvent("status", { phase: "secret", label: "x" })).toBeNull();
  });

  it("parses an unlimited quota and a terminal error", () => {
    expect(parseKiaraEvent("meta", { conversation_id: "c", user_message_id: "u", quota: { used: 4, limit: null, resets_at: quota.resets_at } }))
      .toEqual({ event: "meta", data: { conversation_id: "c", user_message_id: "u", quota: { used: 4, limit: null, resets_at: quota.resets_at, timezone: undefined } } });
    expect(parseKiaraEvent("error", { code: "provider_error", message: "Try again" })).toEqual({ event: "error", data: { code: "provider_error", message: "Try again" } });
  });
});
