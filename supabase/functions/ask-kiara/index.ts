import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { resolvePageAccess, validateAccessContext, type AccessContext } from "../../../packages/core/src/permissions/resolve.ts";
import { validateSectionControls, type SectionControls } from "../../../packages/core/src/settings/sectionAvailability.ts";
import { accessibleKiaraSections, offeredKiaraTools } from "../../../packages/core/src/assistant/tools.ts";
import type { KiaraChatResult, KiaraErrorBody } from "../../../packages/core/src/assistant/events.ts";
import { createActorClient, crmActorFor } from "./actor.ts";
import { createCrmSession, type CrmSession } from "./tools/crmSession.ts";
import { handleKiaraTranscribe, kiaraRoute, type KiaraTranscribeResult } from "./transcribe.ts";
import { transcriptionModel } from "../_shared/voice/transcribe.ts";
import {
  DEFAULT_KIARA_CONFIG,
  KiaraHttpError,
  authFailureToHttp,
  kiaraEventStream,
  runKiaraTurn,
  startTurn,
  validateChatRequest,
  type KiaraConfig,
  type KiaraEffort,
  type KiaraTurnDeps,
} from "./worker.ts";

/**
 * Ask Kiara (spec section 7). verify_jwt stays on. Every database call runs as
 * the caller through `actor`, a client built from the anon key and the caller's
 * JWT; this function never reads the service-role key. CRM reads go to the CRM
 * project with a short-lived token from its login bridge, obtained with the
 * caller's JWT for this request only (tools/crmSession.ts).
 */
const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, accept, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

function json(status: number, body: KiaraErrorBody | KiaraChatResult | KiaraTranscribeResult): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function failure(error: KiaraHttpError): Response {
  return json(error.status, { error: error.message, code: error.code, ...(error.quota ? { quota: error.quota } : {}) });
}

function configFromEnv(): KiaraConfig {
  const effort = Deno.env.get("KIARA_EFFORT")?.trim();
  return {
    ...DEFAULT_KIARA_CONFIG,
    model: Deno.env.get("KIARA_MODEL")?.trim() || DEFAULT_KIARA_CONFIG.model,
    effort: effort === "low" || effort === "medium" || effort === "high" ? (effort satisfies KiaraEffort) : DEFAULT_KIARA_CONFIG.effort,
  };
}

const log = (entry: Record<string, unknown>) => console.log(JSON.stringify(entry));

// Questions still being answered by this worker. When the runtime is about to stop
// it (time or memory limit), each one is aborted so the turn ends through its
// failure path: a question that showed no answer text yet is refunded (spec 9).
const inflight = new Set<AbortController>();
if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("beforeunload", () => {
    log({ event: "kiara_worker_stopping", inflight: inflight.size });
    for (const controller of inflight) controller.abort();
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const route = kiaraRoute(new URL(request.url).pathname);
  if (route === null) return json(404, { error: "Not found", code: "invalid_request" });
  const transcribe = route === "transcribe";
  if (request.method !== "POST") return json(405, { error: "Method not allowed", code: "invalid_request" });

  // The token is passed to getUser explicitly (see interpret-task-voice): a
  // lowercase authorization header beside supabase-js's own would be rejected.
  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!token) return json(401, { error: "Authentication required", code: "unauthenticated" });
  if (!supabaseUrl || !anonKey || (!transcribe && !anthropicKey)) return json(503, { error: "Ask Kiara is not configured", code: "unavailable" });

  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) {
    const authFailure = authFailureToHttp(userError);
    if (authFailure.status !== 401) log({ event: "kiara_auth_unavailable", status: userError?.status ?? null });
    return failure(authFailure);
  }
  const actor = createActorClient(client);

  // Voice questions (Phase 7): the words go back to the input box for editing.
  // The OpenAI key is the one Tasks voice already uses.
  if (transcribe) {
    const openAiKey = Deno.env.get("OPENAI_API_KEY")?.trim();
    if (!openAiKey) return json(503, { error: "Voice input is not configured", code: "unavailable" });
    const result = await handleKiaraTranscribe(request, { actor, openAiKey, model: transcriptionModel(Deno.env.get("OPENAI_TRANSCRIBE_MODEL")), log });
    return json(result.status, result.body);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid request", code: "invalid_request" });
  }
  const chat = validateChatRequest(body);
  if (!chat) return json(400, { error: "Invalid request", code: "invalid_request" });

  // The tool list follows the caller's effective permissions and the section
  // switches, exactly as the app shell resolves them. The database re-checks.
  const [accessResult, controlsResult] = await Promise.all([
    actor.rpc("get_my_access_context"),
    actor.rpc("get_section_availability"),
  ]);
  if (accessResult.error?.code === "42501") return json(403, { error: "Active profile required", code: "forbidden" });
  if (accessResult.error || controlsResult.error) {
    log({ event: "kiara_access_context_failed", access_code: accessResult.error?.code ?? null, controls_code: controlsResult.error?.code ?? null });
    return json(503, { error: "Ask Kiara is unavailable right now. Please try again shortly.", code: "unavailable" });
  }
  let access: AccessContext;
  let controls: SectionControls;
  try {
    access = validateAccessContext(accessResult.data);
    controls = validateSectionControls(controlsResult.data);
  } catch {
    log({ event: "kiara_access_context_invalid" });
    return json(503, { error: "Ask Kiara is unavailable right now. Please try again shortly.", code: "unavailable" });
  }
  const pageAccess = resolvePageAccess(access, controls, "ask_kiara");
  if (pageAccess !== "allowed") {
    return json(403, { error: pageAccess === "disabled" ? "Ask Kiara is not available right now." : "You do not have access to Ask Kiara.", code: "forbidden" });
  }

  let started: Awaited<ReturnType<typeof startTurn>>;
  try {
    started = await startTurn(actor, chat);
  } catch (caught) {
    if (caught instanceof KiaraHttpError) return failure(caught);
    log({ event: "kiara_start_failed" });
    return json(503, { error: "Ask Kiara is unavailable right now. Please try again shortly.", code: "unavailable" });
  }

  const controller = new AbortController();
  inflight.add(controller);
  const settle = () => {
    inflight.delete(controller);
  };
  const deps: KiaraTurnDeps = {
    anthropic: new Anthropic({ apiKey: anthropicKey }).beta.messages,
    actor,
    config: configFromEnv(),
    now: () => new Date(),
    log,
    signal: controller.signal,
  };
  // CRM (Phase 5): the CRM project's public URL and anon key. Without them the CRM
  // tools are not offered. The session is created per request and exchanges the
  // caller's JewelOS token only when a CRM tool is first used in this question.
  const crmUrl = Deno.env.get("CRM_SUPABASE_URL")?.trim();
  const crmAnonKey = Deno.env.get("CRM_SUPABASE_ANON_KEY")?.trim();
  const crm: CrmSession | null = crmUrl && crmAnonKey
    ? createCrmSession({
      crmUrl,
      crmAnonKey,
      jewelosToken: token,
      fetch,
      actorFor: crmActorFor(crmUrl, crmAnonKey),
      log,
      // Optional override of the bridge timeout (default 20 s; see tools/crmSession.ts).
      ...(Number(Deno.env.get("KIARA_CRM_TIMEOUT_MS")) > 0 ? { timeoutMs: Number(Deno.env.get("KIARA_CRM_TIMEOUT_MS")) } : {}),
    })
    : null;
  const offered = offeredKiaraTools(access, controls).filter((spec) => crm !== null || spec.dataCategory !== "crm");
  const input = { request: chat, started, offered, accessibleSections: accessibleKiaraSections(access, controls), access, crm };

  const wantsStream = (request.headers.get("Accept") ?? "").includes("text/event-stream");
  if (!wantsStream) {
    const result = await runKiaraTurn(deps, input, () => {}).finally(settle);
    if (!result.ok) return json(result.code === "provider_error" || result.code === "unavailable" ? 503 : 500, { error: result.message, code: result.code });
    return json(200, {
      conversation_id: started.conversationId,
      user_message_id: started.userMessageId,
      assistant_message_id: result.assistantMessageId,
      stop_reason: result.stopReason,
      display_text: result.displayText,
      quota: result.quota,
      citations: result.citations.map(({ marker, chunk_id, document_id, title, heading_path }) => ({ marker, chunk_id, document_id, title, heading_path })),
      escalation_offer: result.escalationOffer
        ? { message_id: result.assistantMessageId, offer_id: result.escalationOffer.offer_id, reason: result.escalationOffer.reason, summary: result.escalationOffer.summary_en }
        : null,
    });
  }

  // The turn runs inside the stream; it is settled when the stream closes.
  const stream = kiaraEventStream(deps, input, log).pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ flush: settle }));
  return new Response(stream, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
  });
});
