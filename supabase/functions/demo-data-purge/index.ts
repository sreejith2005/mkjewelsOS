import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

const confirmation = "DELETE";
export const purgeModules = [
  "tasks",
  "recurring_templates",
  "task_imports",
  "fms",
  "forms",
  "notifications",
  "checklists",
] as const;

type RpcError = { code?: string; message?: string };
type Dependencies = {
  configured: boolean;
  getUser: (token: string) => Promise<{ id: string } | null>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError | null }>;
};

const respond = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function statusFor(error: RpcError): number {
  if (error.code === "42501") return 403;
  if (error.code === "22023" || error.code === "P0001") return 400;
  return 500;
}

// Only an active super admin gets past the RPC's own gate, so the database
// message is safe to hand back here -- and without it a failed purge is
// undiagnosable from the browser.
function describe(error: RpcError, fallback: string): string {
  const message = error.message?.trim();
  if (!message) return fallback;
  return error.code ? `${message} (${error.code})` : message;
}

export async function handleDemoDataPurge(request: Request, dependencies: Dependencies): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return respond(405, { error: "Method not allowed" });
  if (!dependencies.configured) return respond(500, { error: "Function is not configured" });

  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return respond(401, { error: "Authentication required" });

  let identity: { id: string } | null;
  try {
    identity = await dependencies.getUser(token);
  } catch {
    identity = null;
  }
  if (!identity) return respond(401, { error: "Invalid or expired session" });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return respond(400, { error: "Request body must be valid JSON" });
  }
  if (!isRecord(payload) || typeof payload.action !== "string") return respond(400, { error: "Request action is invalid" });

  if (payload.action === "counts") {
    if (!hasOnlyKeys(payload, ["action"])) return respond(400, { error: "Counts request contains unsupported fields" });
    const result = await dependencies.rpc("demo_data_purge_counts", { p_actor_auth_user_id: identity.id });
    if (result.error) return respond(statusFor(result.error), { error: describe(result.error, "Unable to read purge counts") });
    return respond(200, { data: result.data });
  }

  if (payload.action === "purge") {
    if (!hasOnlyKeys(payload, ["action", "modules", "confirmation"])) return respond(400, { error: "Purge request contains unsupported fields" });
    if (!Array.isArray(payload.modules) || payload.modules.length === 0) return respond(400, { error: "Select at least one module to purge" });
    if (!payload.modules.every((module): module is string => typeof module === "string" && (purgeModules as readonly string[]).includes(module))) {
      return respond(400, { error: "modules contains an unknown module" });
    }
    if (payload.confirmation !== confirmation) return respond(400, { error: "confirmation must equal DELETE" });

    const result = await dependencies.rpc("purge_demo_data", {
      p_actor_auth_user_id: identity.id,
      p_modules: [...new Set(payload.modules)],
      p_confirmation: confirmation,
    });
    if (result.error) return respond(statusFor(result.error), { error: describe(result.error, "Unable to purge demo data") });
    return respond(200, { data: result.data });
  }

  return respond(400, { error: "Request action is invalid" });
}

Deno.serve((request) => {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const configured = Boolean(url && anonKey && serviceRoleKey);
  const caller = configured ? createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  const admin = configured ? createClient(url!, serviceRoleKey!, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

  return handleDemoDataPurge(request, {
    configured,
    getUser: async (token) => {
      const { data, error } = await caller!.auth.getUser(token);
      return error || !data.user ? null : { id: data.user.id };
    },
    rpc: async (name, args) => {
      const { data, error } = await admin!.rpc(name, args);
      return { data, error: error ? { code: error.code, message: error.message } : null };
    },
  });
});
