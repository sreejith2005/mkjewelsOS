import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { resolvePageAccess, validateAccessContext, type AccessContext } from "../../../packages/core/src/permissions/resolve.ts";
import { validateSectionControls, type SectionControls } from "../../../packages/core/src/settings/sectionAvailability.ts";
import { accessibleKiaraSections, offeredKiaraTools } from "../../../packages/core/src/assistant/tools.ts";
import type { KiaraChatResult, KiaraErrorBody } from "../../../packages/core/src/assistant/events.ts";
import { createActorClient } from "./actor.ts";
import {
  DEFAULT_KIARA_CONFIG,
  KiaraHttpError,
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
 * JWT; this function never reads the service-role key.
 */
const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, accept, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

function json(status: number, body: KiaraErrorBody | KiaraChatResult): Response {
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

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  if (!/\/ask-kiara(\/chat)?$/.test(path)) return json(404, { error: "Not found", code: "invalid_request" });
  if (request.method !== "POST") return json(405, { error: "Method not allowed", code: "invalid_request" });

  // The token is passed to getUser explicitly (see interpret-task-voice): a
  // lowercase authorization header beside supabase-js's own would be rejected.
  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!token) return json(401, { error: "Authentication required", code: "unauthenticated" });
  if (!supabaseUrl || !anonKey || !anthropicKey) return json(503, { error: "Ask Kiara is not configured", code: "unavailable" });

  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) return json(401, { error: "Authentication required", code: "unauthenticated" });
  const actor = createActorClient(client);

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

  const deps: KiaraTurnDeps = {
    anthropic: new Anthropic({ apiKey: anthropicKey }).beta.messages,
    actor,
    config: configFromEnv(),
    now: () => new Date(),
    log,
  };
  const input = { request: chat, started, offered: offeredKiaraTools(access, controls), accessibleSections: accessibleKiaraSections(access, controls), access };

  const wantsStream = (request.headers.get("Accept") ?? "").includes("text/event-stream");
  if (!wantsStream) {
    const result = await runKiaraTurn(deps, input, () => {});
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

  const stream = kiaraEventStream(deps, input, log);
  return new Response(stream, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
  });
});
