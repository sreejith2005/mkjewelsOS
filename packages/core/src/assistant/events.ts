import { parseKiaraQuota, type KiaraQuota } from "./quota.ts";

/**
 * The `POST /functions/v1/ask-kiara/chat` streaming contract (spec 7.2).
 *
 * The Edge Function encodes these events; web and Android parse them with the
 * same parser. Order: `meta` first, then any `status`/`delta`/`citation`
 * events, then exactly one terminal `done` or `error`. A client that cannot
 * stream asks for `application/json` and receives one `KiaraChatResult`.
 */
export type KiaraMetaEvent = Readonly<{ event: "meta"; data: Readonly<{ conversation_id: string; user_message_id: string; quota: KiaraQuota }> }>;
export type KiaraStatusEvent = Readonly<{ event: "status"; data: Readonly<{ phase: "thinking" | "tool"; label: string }> }>;
export type KiaraDeltaEvent = Readonly<{ event: "delta"; data: Readonly<{ text: string }> }>;
export type KiaraCitationEvent = Readonly<{ event: "citation"; data: Readonly<{ marker: number; document_id: string; title: string; heading_path: string }> }>;
export type KiaraDoneEvent = Readonly<{
  event: "done";
  data: Readonly<{
    assistant_message_id: string;
    stop_reason: string;
    quota: KiaraQuota;
    /** The authoritative final text (citations applied); replaces streamed deltas. */
    display_text: string;
  }>;
}>;
export type KiaraErrorEvent = Readonly<{ event: "error"; data: Readonly<{ code: KiaraErrorCode; message: string }> }>;

export type KiaraStreamEvent =
  | KiaraMetaEvent
  | KiaraStatusEvent
  | KiaraDeltaEvent
  | KiaraCitationEvent
  | KiaraDoneEvent
  | KiaraErrorEvent;

export type KiaraErrorCode =
  | "invalid_request"
  | "unauthenticated"
  | "forbidden"
  | "conversation_full"
  | "already_answered"
  | "daily_limit_reached"
  | "unavailable"
  | "provider_error"
  | "interrupted";

/** The JSON-mode response: the `done` fields plus the conversation ids. */
export type KiaraChatResult = Readonly<{
  conversation_id: string;
  user_message_id: string;
  assistant_message_id: string;
  stop_reason: string;
  display_text: string;
  quota: KiaraQuota;
}>;

/** The body of every non-2xx response, streaming or not. */
export type KiaraErrorBody = Readonly<{ error: string; code: KiaraErrorCode; quota?: KiaraQuota | undefined }>;

export function encodeKiaraEvent(event: KiaraStreamEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): value is string => typeof value === "string";

/** Validates one decoded event; unknown names and malformed payloads return null. */
export function parseKiaraEvent(name: string, data: unknown): KiaraStreamEvent | null {
  if (!isRecord(data)) return null;
  switch (name) {
    case "meta": {
      const quota = parseKiaraQuota(data.quota);
      return str(data.conversation_id) && str(data.user_message_id) && quota
        ? { event: "meta", data: { conversation_id: data.conversation_id, user_message_id: data.user_message_id, quota } } : null;
    }
    case "status":
      return (data.phase === "thinking" || data.phase === "tool") && str(data.label) ? { event: "status", data: { phase: data.phase, label: data.label } } : null;
    case "delta":
      return str(data.text) ? { event: "delta", data: { text: data.text } } : null;
    case "citation":
      return typeof data.marker === "number" && str(data.document_id) && str(data.title) && str(data.heading_path)
        ? { event: "citation", data: { marker: data.marker, document_id: data.document_id, title: data.title, heading_path: data.heading_path } } : null;
    case "done": {
      const quota = parseKiaraQuota(data.quota);
      return str(data.assistant_message_id) && str(data.stop_reason) && str(data.display_text) && quota
        ? { event: "done", data: { assistant_message_id: data.assistant_message_id, stop_reason: data.stop_reason, display_text: data.display_text, quota } } : null;
    }
    case "error":
      return str(data.code) && str(data.message) ? { event: "error", data: { code: data.code as KiaraErrorCode, message: data.message } } : null;
    default:
      return null;
  }
}

/**
 * An incremental Server-Sent Events parser. Feed it decoded text in any chunk
 * sizes; it emits each complete, valid event. Comments and unknown events are
 * ignored, so the server can add heartbeats without breaking older clients.
 */
export function createKiaraEventParser(onEvent: (event: KiaraStreamEvent) => void): Readonly<{ push: (chunk: string) => void; end: () => void }> {
  let buffer = "";
  const dispatch = (block: string) => {
    let name = "message";
    const data: string[] = [];
    for (const rawLine of block.split("\n")) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (!line || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") name = value;
      else if (field === "data") data.push(value);
    }
    if (data.length === 0) return;
    let payload: unknown;
    try {
      payload = JSON.parse(data.join("\n"));
    } catch {
      return;
    }
    const event = parseKiaraEvent(name, payload);
    if (event) onEvent(event);
  };
  return {
    push(chunk: string) {
      buffer += chunk.replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        dispatch(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    },
    end() {
      if (buffer.trim()) dispatch(buffer);
      buffer = "";
    },
  };
}
