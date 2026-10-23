import { createClient } from "@supabase/supabase-js";
import type { FmsAiActor } from "./catalog.ts";
import { DEFAULT_FMS_AI_CONFIG, handleFmsAiTurn, type FmsAiConfig } from "./handler.ts";
import { anthropicModel } from "./model.ts";

/**
 * FMS AI assistant (debugger + workflow builder). verify_jwt stays on. Every
 * database read runs as the caller through a client built from the anon key
 * and the caller's JWT; this function never reads the service-role key and
 * performs no database writes except its own usage row through
 * start/finish_fms_ai_request. It never saves, publishes, assigns or
 * completes FMS work: the browser applies a reviewed proposal to the editor,
 * and the author saves and publishes through the existing audited RPCs.
 * It is separate from Ask Kiara (own quotas, prompts and switches).
 */
const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, accept, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

function configFromEnv(): FmsAiConfig {
  const effort = Deno.env.get("FMS_AI_EFFORT")?.trim();
  const timeout = Number(Deno.env.get("FMS_AI_TIMEOUT_MS"));
  return {
    ...DEFAULT_FMS_AI_CONFIG,
    model: Deno.env.get("FMS_AI_MODEL")?.trim() || DEFAULT_FMS_AI_CONFIG.model,
    effort: effort === "low" || effort === "medium" || effort === "high" ? effort : DEFAULT_FMS_AI_CONFIG.effort,
    requestTimeoutMs: timeout >= 10_000 && timeout <= 130_000 ? timeout : DEFAULT_FMS_AI_CONFIG.requestTimeoutMs,
  };
}

const log = (entry: Record<string, unknown>) => console.log(JSON.stringify(entry));

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (request.method !== "POST") return respond(405, { error: "Method not allowed", code: "invalid_request", schemaVersion: 1 });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!supabaseUrl || !anonKey) return respond(503, { error: "The FMS assistant is not configured", code: "unavailable", schemaVersion: 1 });
  // The token goes to getUser explicitly (see ask-kiara/interpret-task-voice).
  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
  const declared = Number(request.headers.get("Content-Length"));
  if (declared > 300_000) return respond(413, { error: "This workflow is too large for the assistant.", code: "too_large", schemaVersion: 1 });
  const body = await request.text();
  const config = configFromEnv();
  const clientFor = (jwt: string) => createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const result = await handleFmsAiTurn(token, body, {
    disabled: Deno.env.get("FMS_AI_DISABLED")?.trim() === "true",
    config,
    model: anthropicKey ? anthropicModel(anthropicKey, config.model, config.effort, config.maxTokens) : null,
    now: () => new Date(),
    log,
    authenticate: async (jwt) => {
      const { data, error } = await clientFor(jwt).auth.getUser(jwt);
      if (data?.user && !error) return "ok";
      return error && (!error.status || error.status >= 500) ? "unavailable" : "invalid";
    },
    actorFor: (jwt): FmsAiActor => {
      const client = clientFor(jwt);
      return {
        rpc: async (fn, args) => {
          const { data, error } = await client.rpc(fn, args ?? {});
          return { data, error: error ? { code: error.code, message: error.message } : null };
        },
        // Filters are fixed by this function's code; values travel as PostgREST parameters.
        select: async (table, columns, filters, limit, order) => {
          let query = client.from(table).select(columns);
          for (const filter of filters) query = filter.op === "in" ? query.in(filter.column, [...(filter.value as readonly string[])]) : query.eq(filter.column, filter.value as string | boolean);
          if (order) query = query.order(order.column, { ascending: order.ascending });
          const { data, error } = await query.limit(limit);
          return { data: (data ?? null) as readonly Record<string, unknown>[] | null, error: error ? { code: error.code, message: error.message } : null };
        },
      };
    },
  });
  return respond(result.status, result.body);
});
