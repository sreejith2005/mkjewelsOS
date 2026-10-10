import type Anthropic from "@anthropic-ai/sdk";
import {
  KIARA_INTERRUPTED_MESSAGE,
  KIARA_REFUSAL_MESSAGE,
  KIARA_SEARCH_AGAIN_NOTE,
  KIARA_SYSTEM_PROMPT,
  buildTurnContext,
} from "../../../packages/core/src/assistant/systemPrompt.ts";
import type { KiaraToolSpec } from "../../../packages/core/src/assistant/tools.ts";
import { CITATION_MARKER_PATTERN, applyCitations, type KiaraCitation, type KiaraCitationSource } from "../../../packages/core/src/assistant/citations.ts";
import { detectLanguageStyle } from "../../../packages/core/src/assistant/language.ts";
import { parseKiaraQuota, type KiaraQuota } from "../../../packages/core/src/assistant/quota.ts";
import { encodeKiaraEvent, type KiaraErrorCode, type KiaraStreamEvent } from "../../../packages/core/src/assistant/events.ts";
import type { PageId } from "../../../packages/core/src/roleMenu.ts";
import type { AccessContext } from "../../../packages/core/src/permissions/resolve.ts";
import { executeKiaraTool, type ActorClient, type RpcError } from "./tools/index.ts";

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type StreamParams = Parameters<Anthropic["beta"]["messages"]["stream"]>[0];
type StreamEvent = Anthropic.Beta.Messages.BetaRawMessageStreamEvent;
type Message = Anthropic.Beta.Messages.BetaMessage;
type ContentBlock = Anthropic.Beta.Messages.BetaContentBlock;
type ToolResultParam = Anthropic.Beta.Messages.BetaToolResultBlockParam;
type ToolUseBlock = Anthropic.Beta.Messages.BetaToolUseBlock;

export type { ActorClient } from "./tools/index.ts";

/** The slice of the Anthropic client the worker uses; tests inject a fake. */
export interface KiaraModelStream extends AsyncIterable<StreamEvent> {
  finalMessage(): Promise<Message>;
}
export interface AnthropicLike {
  stream(params: StreamParams): KiaraModelStream;
}

export type KiaraEffort = "low" | "medium" | "high";

export type KiaraConfig = Readonly<{
  model: string;
  effort: KiaraEffort;
  maxTokens: number;
  /** Model requests per question (spec 7.3). */
  maxRequests: number;
  /** Tool executions per question (spec 7.3). */
  maxToolCalls: number;
}>;

export const DEFAULT_KIARA_CONFIG: KiaraConfig = {
  model: "claude-sonnet-5-5",
  effort: "low",
  maxTokens: 8000,
  maxRequests: 6,
  maxToolCalls: 8,
};

// ---------------------------------------------------------------------------
// Request validation and the start contract
// ---------------------------------------------------------------------------

export type KiaraChatRequest = Readonly<{
  conversation_id: string | null;
  request_id: string;
  message: string;
  client: "web" | "android";
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function validateChatRequest(body: unknown): KiaraChatRequest | null {
  if (!isRecord(body)) return null;
  const allowed = ["conversation_id", "request_id", "message", "client"];
  if (Object.keys(body).some((key) => !allowed.includes(key))) return null;
  const { conversation_id: conversationId, request_id: requestId, message, client } = body;
  if (conversationId !== null && conversationId !== undefined && (typeof conversationId !== "string" || !UUID.test(conversationId))) return null;
  if (typeof requestId !== "string" || !UUID.test(requestId)) return null;
  if (typeof message !== "string" || message.trim().length < 1 || message.trim().length > 2000) return null;
  if (client !== "web" && client !== "android") return null;
  return { conversation_id: typeof conversationId === "string" ? conversationId : null, request_id: requestId, message: message.trim(), client };
}

export type StartedTurn = Readonly<{
  conversationId: string;
  userMessageId: string;
  history: MessageParam[];
  quota: KiaraQuota;
  context: Readonly<{ name: string; role: string; designation: string | null; department: string | null; branch: string | null; timezone: string }>;
}>;

export class KiaraHttpError extends Error {
  constructor(readonly status: number, readonly code: KiaraErrorCode, message: string, readonly quota?: KiaraQuota) {
    super(message);
  }
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

/** Maps the start RPC's documented failures onto HTTP (spec 7.2). */
export function startErrorToHttp(error: RpcError): KiaraHttpError {
  if (error.message === "kiara_daily_limit_reached") return new KiaraHttpError(429, "daily_limit_reached", "You have used all your questions for today.");
  if (error.message === "kiara_conversation_full") return new KiaraHttpError(409, "conversation_full", "This chat is full. Please start a new chat.");
  if (error.message === "kiara_request_completed") return new KiaraHttpError(409, "already_answered", "This question was already answered. Refresh to see the answer.");
  if (error.message === "kiara_request_refunded") return new KiaraHttpError(409, "already_answered", "This question could not be answered. Please ask again.");
  if (error.code === "42501") {
    const message = error.message === "This section is currently unavailable" ? "Ask Kiara is not available right now." : "You do not have access to Ask Kiara.";
    return new KiaraHttpError(403, "forbidden", message);
  }
  if (error.code === "22023") return new KiaraHttpError(400, "invalid_request", "Please check your question and try again.");
  return new KiaraHttpError(503, "unavailable", "Ask Kiara is unavailable right now. Please try again shortly.");
}

export async function startTurn(actor: ActorClient, request: KiaraChatRequest): Promise<StartedTurn> {
  const { data, error } = await actor.rpc("start_kiara_turn", {
    p_conversation_id: request.conversation_id,
    p_request_id: request.request_id,
    p_message: request.message,
    p_client: request.client,
  });
  if (error) {
    const failure = startErrorToHttp(error);
    if (failure.status === 429) {
      const quota = await actor.rpc("get_my_kiara_quota");
      const parsed = quota.error ? null : parseKiaraQuota(quota.data);
      throw new KiaraHttpError(429, failure.code, failure.message, parsed ?? undefined);
    }
    throw failure;
  }
  if (!isRecord(data) || typeof data.conversation_id !== "string" || typeof data.message_id !== "string" || !Array.isArray(data.history) || !isRecord(data.context)) {
    throw new KiaraHttpError(503, "unavailable", "Ask Kiara is unavailable right now. Please try again shortly.");
  }
  const quota = parseKiaraQuota(data.quota);
  if (!quota) throw new KiaraHttpError(503, "unavailable", "Ask Kiara is unavailable right now. Please try again shortly.");
  const context = data.context;
  return {
    conversationId: data.conversation_id,
    userMessageId: data.message_id,
    // Stored verbatim by complete_kiara_turn from earlier API messages; replayed unchanged.
    history: data.history as MessageParam[],
    quota,
    context: {
      name: text(context.name) ?? "Employee",
      role: text(context.role) ?? "staff",
      designation: text(context.designation),
      department: text(context.department),
      branch: text(context.branch),
      timezone: text(context.timezone) ?? "Asia/Kolkata",
    },
  };
}

// ---------------------------------------------------------------------------
// The turn loop
// ---------------------------------------------------------------------------

export type KiaraEmit = (event: KiaraStreamEvent) => void;

export type KiaraTurnDeps = Readonly<{
  anthropic: AnthropicLike;
  actor: ActorClient;
  config: KiaraConfig;
  now: () => Date;
  log: (entry: Record<string, unknown>) => void;
}>;

export type KiaraTurnInput = Readonly<{
  request: KiaraChatRequest;
  started: StartedTurn;
  offered: readonly KiaraToolSpec[];
  accessibleSections: readonly PageId[];
  access: AccessContext;
}>;

export type RequestUsage = Readonly<{
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_5m: number;
  cache_creation_1h: number;
}>;

export type KiaraUsage = RequestUsage & Readonly<{ requests: number; per_request: readonly RequestUsage[] }>;

export type KiaraTurnResult =
  | Readonly<{ ok: true; assistantMessageId: string; displayText: string; stopReason: string; quota: KiaraQuota; usage: KiaraUsage; toolsUsed: readonly string[]; citations: readonly KiaraCitation[] }>
  | Readonly<{ ok: false; code: KiaraErrorCode; message: string }>;

class ProviderFailure extends Error {}

function requestUsage(message: Message): RequestUsage {
  const usage = message.usage;
  return {
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    cache_creation_5m: usage.cache_creation?.ephemeral_5m_input_tokens ?? 0,
    cache_creation_1h: usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
  };
}

function totalUsage(perRequest: readonly RequestUsage[]): KiaraUsage {
  const sum = (key: keyof RequestUsage) => perRequest.reduce((total, entry) => total + entry[key], 0);
  return {
    requests: perRequest.length,
    input_tokens: sum("input_tokens"),
    output_tokens: sum("output_tokens"),
    cache_creation_input_tokens: sum("cache_creation_input_tokens"),
    cache_read_input_tokens: sum("cache_read_input_tokens"),
    cache_creation_5m: sum("cache_creation_5m"),
    cache_creation_1h: sum("cache_creation_1h"),
    per_request: perRequest,
  };
}

/**
 * After a mid-output server-side fallback, the blocks before the last
 * `fallback` boundary that belong to the declined model (thinking, tool calls)
 * must not be echoed back; text blocks and everything after the boundary are
 * kept. Without a fallback block the content is returned unchanged, which is
 * the normal append-only path.
 */
export function echoableContent(content: readonly ContentBlock[]): ContentBlock[] {
  const boundary = content.map((block) => block.type).lastIndexOf("fallback");
  if (boundary === -1) return [...content];
  return content.filter((block, index) =>
    index >= boundary || !(block.type === "thinking" || block.type === "redacted_thinking" || block.type === "tool_use"));
}

export function buildRequestParams(
  config: KiaraConfig,
  offered: readonly KiaraToolSpec[],
  messages: MessageParam[],
  finalRound: boolean,
): StreamParams {
  // Tools render first, then the system prompt: both are identical for every
  // caller with the same permission shape, and the 1-hour breakpoint on the
  // system block caches them together. The top-level breakpoint caches the
  // conversation so far (5 minutes); everything about the user lives there.
  const params: StreamParams = {
    model: config.model,
    max_tokens: config.maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: config.effort },
    system: [{ type: "text", text: KIARA_SYSTEM_PROMPT, cache_control: { type: "ephemeral", ttl: "1h" } }],
    cache_control: { type: "ephemeral" },
    messages,
  };
  if (offered.length > 0) {
    params.tools = offered.map((tool) => ({ ...tool.definition, input_schema: { ...tool.definition.input_schema, required: [...tool.definition.input_schema.required] } }));
    // Forced tool choice is rejected on this model; only auto and none are used.
    params.tool_choice = finalRound ? { type: "none" } : { type: "auto" };
  }
  return params;
}

/**
 * Runs one question to completion: streams the model, executes tools as the
 * caller, stores the turn, and emits the SSE events. Returns the outcome; the
 * caller emits `meta` before and `done`/`error` after.
 */
export async function runKiaraTurn(deps: KiaraTurnDeps, input: KiaraTurnInput, emit: KiaraEmit): Promise<KiaraTurnResult> {
  const { anthropic, actor, config } = deps;
  const { started, request, offered } = input;
  const startedAt = Date.now();
  const userMessage: MessageParam = {
    role: "user",
    content: [
      {
        type: "text",
        text: buildTurnContext({
          now: deps.now(),
          timeZone: started.context.timezone,
          name: started.context.name,
          role: started.context.role,
          designation: started.context.designation,
          department: started.context.department,
          branch: started.context.branch,
        }),
      },
      { type: "text", text: request.message },
    ],
  };
  const messages: MessageParam[] = [...started.history, userMessage];
  const turn: MessageParam[] = [userMessage];
  const perRequest: RequestUsage[] = [];
  const toolsUsed: string[] = [];
  const dataCategories: string[] = [];
  // Chunks returned by knowledge searches in this turn: the only citable sources (spec 7.5).
  const citationSources = new Map<string, KiaraCitationSource>();
  let displayText = "";
  let textEmitted = false;
  let toolCalls = 0;
  let stopReason = "end_turn";
  let model = config.model;
  // Search-again rule (enforced here, not only in the prompt): after a knowledge
  // search, answer text is held back until it carries a valid citation. If the
  // model finishes after a single search with nothing citable, the held reply
  // is dropped and Kiara is asked to search once more with other words; a
  // not-found reply is allowed only after the second search.
  let kbSearches = 0;
  let searchNudges = 0;
  let citationShown = false;
  let held = "";

  const appendText = (delta: string) => {
    if (!delta) return;
    displayText += delta;
    textEmitted = true;
    emit({ event: "delta", data: { text: delta } });
  };
  const hasValidCitation = (value: string) => [...value.matchAll(CITATION_MARKER_PATTERN)].some((match) => citationSources.has(match[1]!));
  const releaseHeld = () => {
    const pending = held;
    held = "";
    appendText(pending);
  };
  const handleText = (delta: string) => {
    if (kbSearches === 0 || citationShown) return appendText(delta);
    held += delta;
    if (hasValidCitation(held)) {
      citationShown = true;
      releaseHeld();
    }
  };

  try {
    for (let round = 0; round < config.maxRequests; round += 1) {
      const finalRound = round === config.maxRequests - 1;
      emit({ event: "status", data: { phase: "thinking", label: round === 0 ? "Thinking" : "Putting the answer together" } });
      let message: Message;
      let blockHasText = false;
      try {
        const stream = anthropic.stream(buildRequestParams(config, offered, messages, finalRound));
        for await (const event of stream) {
          if (event.type === "content_block_start") {
            blockHasText = false;
            if (event.content_block.type === "tool_use") {
              const spec = offered.find((tool) => tool.definition.name === (event.content_block as ToolUseBlock).name);
              emit({ event: "status", data: { phase: "tool", label: spec?.statusLabel ?? "Checking" } });
            }
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta" && event.delta.text) {
            // Separate this text block from text shown (or held) earlier in the turn.
            const earlier = displayText + held;
            if (!blockHasText && earlier && !earlier.endsWith("\n")) handleText("\n\n");
            blockHasText = true;
            handleText(event.delta.text);
          }
        }
        message = await stream.finalMessage();
      } catch (caught) {
        throw new ProviderFailure(caught instanceof Error ? caught.name : "provider_error");
      }
      perRequest.push(requestUsage(message));
      model = message.model;

      // A declined request: never run its tools or keep partial content.
      if (message.stop_reason === "refusal") {
        stopReason = "refusal";
        displayText = KIARA_REFUSAL_MESSAGE;
        turn.push({ role: "assistant", content: [{ type: "text", text: KIARA_REFUSAL_MESSAGE }] });
        deps.log({ event: "kiara_refusal", category: message.stop_details?.category ?? null });
        break;
      }

      const content = echoableContent(message.content);
      const assistant: MessageParam = { role: "assistant", content };
      turn.push(assistant);
      messages.push(assistant);
      stopReason = message.stop_reason ?? "end_turn";

      const toolUses = content.filter((block): block is ToolUseBlock => block.type === "tool_use");
      if (toolUses.length === 0) {
        // A reply after one search that cites nothing: search once more first,
        // when two more model requests and a tool call are still available.
        if (kbSearches === 1 && !citationShown && searchNudges === 0 && round + 2 < config.maxRequests && toolCalls < config.maxToolCalls) {
          held = "";
          searchNudges += 1;
          const note: MessageParam = { role: "user", content: [{ type: "text", text: KIARA_SEARCH_AGAIN_NOTE }] };
          turn.push(note);
          messages.push(note);
          deps.log({ event: "kiara_search_again" });
          continue;
        }
        break;
      }

      const results: ToolResultParam[] = [];
      // A tool call cut off at max_tokens is never run; every tool_use still gets
      // a result so the stored history stays a valid conversation.
      const runnable = message.stop_reason === "tool_use" && !finalRound;
      for (const toolUse of toolUses) {
        if (!runnable || toolCalls >= config.maxToolCalls) {
          results.push({ type: "tool_result", tool_use_id: toolUse.id, is_error: true, content: JSON.stringify({ error: "limit_reached", message: "No more lookups are possible for this question. Answer with what you already have." }) });
          continue;
        }
        toolCalls += 1;
        const executed = await executeKiaraTool(toolUse.name, toolUse.input, {
          actor,
          offered,
          accessibleSections: input.accessibleSections,
          timeZone: started.context.timezone,
          access: input.access,
          now: deps.now(),
        });
        for (const source of executed.citationSources ?? []) citationSources.set(source.chunk_id, source);
        if (toolUse.name === "search_knowledge_base" && executed.spec) kbSearches += 1;
        if (executed.spec) {
          if (!toolsUsed.includes(executed.spec.definition.name)) toolsUsed.push(executed.spec.definition.name);
          if (!dataCategories.includes(executed.spec.dataCategory)) dataCategories.push(executed.spec.dataCategory);
        }
        results.push({ type: "tool_result", tool_use_id: toolUse.id, content: executed.content, ...(executed.isError ? { is_error: true } : {}) });
      }
      const toolTurn: MessageParam = { role: "user", content: results };
      turn.push(toolTurn);
      messages.push(toolTurn);
      if (!runnable) break;
    }
  } catch (caught) {
    if (!(caught instanceof ProviderFailure)) throw caught;
    deps.log({ event: "kiara_provider_failed", kind: caught.message, text_sent: textEmitted, requests: perRequest.length, ms: Date.now() - startedAt });
    if (!textEmitted) {
      // Nothing was shown: the question is given back (quota rule, spec 9).
      const refund = await actor.rpc("refund_kiara_question", { p_request_id: request.request_id });
      if (refund.error) deps.log({ event: "kiara_refund_failed", code: refund.error.code ?? null });
      return { ok: false, code: "provider_error", message: "Kiara could not answer right now. Your question was not counted. Please try again." };
    }
    return { ok: false, code: "interrupted", message: KIARA_INTERRUPTED_MESSAGE };
  }

  // Whatever is still held (no citation, or the loop ran out) is the reply.
  if (stopReason === "refusal") held = "";
  else releaseHeld();

  // The stored turn must end on a model turn or a complete tool-result turn.
  const last = turn[turn.length - 1];
  if (last && last.role === "assistant" && Array.isArray(last.content)) {
    const dangling = last.content.filter((block) => block.type === "tool_use") as ToolUseBlock[];
    if (dangling.length > 0) {
      turn.push({ role: "user", content: dangling.map((block) => ({ type: "tool_result" as const, tool_use_id: block.id, is_error: true, content: "Not run." })) });
    }
  }

  const cited = applyCitations(displayText.trim(), citationSources);
  const finalText = cited.text || "Sorry, I could not find an answer to that. Please try asking in a different way.";
  if (cited.removedMarkers > 0) deps.log({ event: "kiara_citation_removed", count: cited.removedMarkers });
  const usage = totalUsage(perRequest);
  const kbHit = cited.citations.length > 0;
  // Phase 4 hook: a knowledge search that ended without a valid citation is the
  // "not in the SOPs" case where the escalation offer will be made.
  const kbNoMatch = toolsUsed.includes("search_knowledge_base") && !kbHit;

  const completed = await actor.rpc("complete_kiara_turn", {
    p_request_id: request.request_id,
    p_display_text: finalText,
    p_api_content: turn,
    p_language: detectLanguageStyle(request.message),
    p_citations: cited.citations,
    p_escalation_offer: null,
    p_tools_used: toolsUsed,
    p_data_categories: dataCategories,
    p_kb_hit: kbHit,
    p_model: model,
    p_stop_reason: stopReason,
    p_usage: usage,
  });
  // Shape only: never question text, answers, or tool data.
  deps.log({ event: "kiara_turn", ok: !completed.error, model, stop_reason: stopReason, tools: toolsUsed, tool_calls: toolCalls, kb_searches: kbSearches, citations: cited.citations.length, kb_no_match: kbNoMatch, ms: Date.now() - startedAt, usage });
  if (completed.error || typeof completed.data !== "string") {
    return { ok: false, code: "unavailable", message: "Kiara answered, but the answer could not be saved. Please try again." };
  }
  for (const citation of cited.citations) {
    emit({ event: "citation", data: { marker: citation.marker, chunk_id: citation.chunk_id, document_id: citation.document_id, title: citation.title, heading_path: citation.heading_path } });
  }
  return { ok: true, assistantMessageId: completed.data, displayText: finalText, stopReason, quota: started.quota, usage, toolsUsed, citations: cited.citations };
}

/**
 * The SSE body: `meta` first, the turn's events, then exactly one `done` or
 * `error`. If the client disconnects the turn still finishes and is stored.
 */
export function kiaraEventStream(
  deps: KiaraTurnDeps,
  input: KiaraTurnInput,
  log: (entry: Record<string, unknown>) => void,
  heartbeatMs = 15_000,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const { started } = input;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const write = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          open = false;
        }
      };
      const emit = (event: KiaraStreamEvent) => write(encodeKiaraEvent(event));
      const heartbeat = setInterval(() => write(": keep-alive\n\n"), heartbeatMs);
      try {
        emit({ event: "meta", data: { conversation_id: started.conversationId, user_message_id: started.userMessageId, quota: started.quota } });
        const result = await runKiaraTurn(deps, input, emit);
        if (result.ok) {
          emit({ event: "done", data: { assistant_message_id: result.assistantMessageId, stop_reason: result.stopReason, quota: result.quota, display_text: result.displayText } });
        } else {
          emit({ event: "error", data: { code: result.code, message: result.message } });
        }
      } catch {
        log({ event: "kiara_turn_crashed" });
        emit({ event: "error", data: { code: "unavailable", message: "Ask Kiara is unavailable right now. Please try again shortly." } });
      } finally {
        clearInterval(heartbeat);
        if (open) {
          open = false;
          controller.close();
        }
      }
    },
  });
}
