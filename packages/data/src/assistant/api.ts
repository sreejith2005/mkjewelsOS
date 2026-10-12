import { getSupabase as db } from "@jewelos/api-client/client";
import {
  createKiaraEventParser,
  parseKiaraEscalationOffer,
  parseKiaraQuota,
  type KiaraEscalationOffer,
  type KiaraEscalationOfferData,
  type KiaraChatResult,
  type KiaraCitationData,
  type KiaraErrorCode,
  type KiaraQuota,
  type KiaraStreamEvent,
} from "@jewelos/core";
import { newRequestKey } from "../runtime";

export type KiaraConversationSummary = Readonly<{
  id: string;
  title: string;
  client: "web" | "android";
  created_at: string;
  last_message_at: string;
  question_count: number;
}>;

export type KiaraMessageRole = "user" | "assistant" | "human_answer";

export type KiaraMessage = Readonly<{
  id: string;
  ordinal: number;
  role: KiaraMessageRole;
  display_text: string;
  reply_to_message_id: string | null;
  refunded: boolean;
  stop_reason: string | null;
  created_at: string;
  /** Validated knowledge-base sources for the answer's [n] markers. */
  citations: readonly KiaraCitationData[];
  /** Kiara's offer to pass the question to a person (assistant answers only). */
  escalation_offer: KiaraEscalationOffer | null;
  /** The escalation created from that offer, once the asker confirmed it. */
  escalation: Readonly<{ id: string; status: "open" | "answered" | "withdrawn"; answered_by: string | null; answered_at: string | null }> | null;
  /** Human answers: "Name (Designation)" of the person who answered. */
  answered_by: string | null;
}>;

export type KiaraConversation = Readonly<{
  id: string;
  title: string;
  created_at: string;
  last_message_at: string;
  question_count: number;
  messages: readonly KiaraMessage[];
}>;

/** Questions per conversation (start_kiara_turn raises kiara_conversation_full after this). */
export const KIARA_CONVERSATION_QUESTION_LIMIT = 15;
export const KIARA_QUESTION_MAX_LENGTH = 2000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): value is string => typeof value === "string";

function asSummary(value: unknown): KiaraConversationSummary | null {
  if (!isRecord(value) || !str(value.id) || !str(value.title) || !str(value.created_at) || !str(value.last_message_at)) return null;
  return {
    id: value.id,
    title: value.title,
    client: value.client === "android" ? "android" : "web",
    created_at: value.created_at,
    last_message_at: value.last_message_at,
    question_count: typeof value.question_count === "number" ? value.question_count : 0,
  };
}

/** Stored citations and streamed citation events share this shape. */
export function parseKiaraCitations(value: unknown): KiaraCitationData[] {
  return (Array.isArray(value) ? value : []).flatMap((item): KiaraCitationData[] => {
    if (!isRecord(item) || typeof item.marker !== "number" || !str(item.chunk_id) || !str(item.document_id) || !str(item.title)) return [];
    return [{ marker: item.marker, chunk_id: item.chunk_id, document_id: item.document_id, title: item.title, heading_path: str(item.heading_path) ? item.heading_path : "" }];
  });
}

function asMessage(value: unknown): KiaraMessage | null {
  if (!isRecord(value) || !str(value.id) || typeof value.ordinal !== "number" || !str(value.display_text) || !str(value.created_at)) return null;
  if (value.role !== "user" && value.role !== "assistant" && value.role !== "human_answer") return null;
  return {
    id: value.id,
    ordinal: value.ordinal,
    role: value.role,
    display_text: value.display_text,
    reply_to_message_id: str(value.reply_to_message_id) ? value.reply_to_message_id : null,
    refunded: value.refunded === true,
    stop_reason: str(value.stop_reason) ? value.stop_reason : null,
    created_at: value.created_at,
    citations: parseKiaraCitations(value.citations),
    escalation_offer: parseKiaraEscalationOffer(value.escalation_offer),
    escalation: isRecord(value.escalation) && str(value.escalation.id)
      ? {
        id: value.escalation.id,
        status: value.escalation.status === "answered" || value.escalation.status === "withdrawn" ? value.escalation.status : "open",
        answered_by: str(value.escalation.answered_by) ? value.escalation.answered_by : null,
        answered_at: str(value.escalation.answered_at) ? value.escalation.answered_at : null,
      }
      : null,
    answered_by: str(value.answered_by) ? value.answered_by : null,
  };
}

/** A JSON-mode or stored offer as the client shows it. */
function parseOfferData(value: unknown): KiaraEscalationOfferData | null {
  if (!isRecord(value) || !str(value.message_id) || !str(value.offer_id) || !str(value.summary)) return null;
  const offer = parseKiaraEscalationOffer({ offer_id: value.offer_id, reason: value.reason, summary_en: value.summary });
  return offer ? { message_id: value.message_id, offer_id: offer.offer_id, reason: offer.reason, summary: offer.summary_en } : null;
}

export async function listMyKiaraConversations(limit = 30): Promise<KiaraConversationSummary[]> {
  const { data, error } = await db().rpc("list_my_kiara_conversations", { p_limit: limit });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).flatMap((row) => {
    const summary = asSummary(row);
    return summary ? [summary] : [];
  });
}

export async function getMyKiaraConversation(id: string): Promise<KiaraConversation> {
  const { data, error } = await db().rpc("get_my_kiara_conversation", { p_id: id });
  if (error) throw error;
  const summary = asSummary({ ...(isRecord(data) ? data : {}), client: "web" });
  if (!summary || !isRecord(data)) throw new Error("This chat could not be loaded.");
  const messages = (Array.isArray(data.messages) ? data.messages : []).flatMap((row) => {
    const message = asMessage(row);
    return message ? [message] : [];
  });
  return { id: summary.id, title: summary.title, created_at: summary.created_at, last_message_at: summary.last_message_at, question_count: summary.question_count, messages };
}

export async function archiveMyKiaraConversation(id: string): Promise<void> {
  const { error } = await db().rpc("archive_my_kiara_conversation", { p_id: id });
  if (error) throw error;
}

export async function getMyKiaraQuota(): Promise<KiaraQuota> {
  const { data, error } = await db().rpc("get_my_kiara_quota");
  if (error) throw error;
  const quota = parseKiaraQuota(data);
  if (!quota) throw new Error("Your question allowance could not be loaded.");
  return quota;
}

export type KiaraExcerpt =
  | Readonly<{ available: true; title: string; heading_path: string; content: string }>
  | Readonly<{ available: false }>;

/** The excerpt behind a citation chip; unavailable once the document is removed, inactive, or replaced. */
export async function getKiaraKnowledgeExcerpt(chunkId: string): Promise<KiaraExcerpt> {
  const { data, error } = await db().rpc("get_kiara_knowledge_excerpt", { p_chunk_id: chunkId });
  if (error) throw error;
  if (isRecord(data) && data.available === true && str(data.title) && str(data.content)) {
    return { available: true, title: data.title, heading_path: str(data.heading_path) ? data.heading_path : "", content: data.content };
  }
  return { available: false };
}

export type AskKiaraOptions = Readonly<{
  conversationId: string | null;
  message: string;
  client: "web" | "android";
  /** Reuse the same id to retry a send; the server never counts it twice. */
  requestId?: string | undefined;
  /** false asks for the single JSON response (clients that cannot stream). */
  stream?: boolean | undefined;
  signal?: AbortSignal | undefined;
  onEvent?: ((event: KiaraStreamEvent) => void) | undefined;
}>;

export type AskKiaraOutcome =
  | Readonly<{ ok: true; requestId: string; result: KiaraChatResult }>
  | Readonly<{ ok: false; requestId: string; code: KiaraErrorCode; message: string; quota?: KiaraQuota | undefined; conversationId: string | null }>;

const GENERIC_FAILURE = "Kiara could not answer right now. Please try again.";

/** The function's error body ({ error, code, quota }) when it sent one. */
async function failureFromError(error: unknown): Promise<Readonly<{ code: KiaraErrorCode; message: string; quota?: KiaraQuota | undefined }>> {
  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json() as { error?: unknown; code?: unknown; quota?: unknown };
      return {
        code: typeof body.code === "string" ? body.code as KiaraErrorCode : "unavailable",
        message: typeof body.error === "string" && body.error.trim() ? body.error : GENERIC_FAILURE,
        quota: parseKiaraQuota(body.quota) ?? undefined,
      };
    } catch {
      // Fall through to the content-free message.
    }
  }
  return { code: "unavailable", message: GENERIC_FAILURE };
}

async function readEvents(response: Response, onEvent: (event: KiaraStreamEvent) => void): Promise<void> {
  const parser = createKiaraEventParser(onEvent);
  // React Native's fetch has no streaming body; it buffers the same SSE text.
  if (!response.body) {
    parser.push(await response.text());
    parser.end();
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.end();
}

/**
 * Sends one question. Streams by default (SSE); every event reaches `onEvent`
 * as it arrives. The outcome is decided by the terminal `done` or `error`
 * event, or by the JSON body when streaming is off.
 */
export async function askKiara(options: AskKiaraOptions): Promise<AskKiaraOutcome> {
  const requestId = options.requestId ?? newRequestKey();
  const stream = options.stream !== false;
  const { data, error } = await db().functions.invoke("ask-kiara/chat", {
    method: "POST",
    body: { conversation_id: options.conversationId, request_id: requestId, message: options.message, client: options.client },
    headers: { Accept: stream ? "text/event-stream" : "application/json" },
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (error) return { ok: false, requestId, conversationId: options.conversationId, ...(await failureFromError(error)) };

  if (!stream || !(data instanceof Response)) {
    if (isRecord(data) && str(data.conversation_id) && str(data.user_message_id) && str(data.assistant_message_id) && str(data.display_text) && str(data.stop_reason)) {
      const quota = parseKiaraQuota(data.quota);
      if (quota) {
        return { ok: true, requestId, result: { conversation_id: data.conversation_id, user_message_id: data.user_message_id, assistant_message_id: data.assistant_message_id, stop_reason: data.stop_reason, display_text: data.display_text, quota, citations: parseKiaraCitations(data.citations), escalation_offer: parseOfferData(data.escalation_offer) } };
      }
    }
    return { ok: false, requestId, conversationId: options.conversationId, code: "unavailable", message: GENERIC_FAILURE };
  }

  let meta: Extract<KiaraStreamEvent, { event: "meta" }>["data"] | null = null;
  let outcome: AskKiaraOutcome | null = null;
  const citations: KiaraCitationData[] = [];
  let offer: KiaraEscalationOfferData | null = null;
  try {
    await readEvents(data, (event) => {
      if (outcome) return;
      options.onEvent?.(event);
      if (event.event === "meta") meta = event.data;
      if (event.event === "citation") citations.push(event.data);
      if (event.event === "escalation_offer") offer = event.data;
      if (event.event === "done" && meta) {
        outcome = {
          ok: true,
          requestId,
          result: { conversation_id: meta.conversation_id, user_message_id: meta.user_message_id, assistant_message_id: event.data.assistant_message_id, stop_reason: event.data.stop_reason, display_text: event.data.display_text, quota: event.data.quota, citations: [...citations], escalation_offer: offer },
        };
      }
      if (event.event === "error") {
        outcome = { ok: false, requestId, conversationId: meta?.conversation_id ?? options.conversationId, code: event.data.code, message: event.data.message };
      }
    });
  } catch {
    // A dropped connection: the server still finishes and stores the answer.
  }
  const seen = meta as Extract<KiaraStreamEvent, { event: "meta" }>["data"] | null;
  return outcome ?? { ok: false, requestId, conversationId: seen?.conversation_id ?? options.conversationId, code: "interrupted", message: "The connection dropped. Open the chat again to see the answer." };
}
