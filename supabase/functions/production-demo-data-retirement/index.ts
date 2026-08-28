import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

const confirmation = "RETIRE DEMO DATA";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const manifestHashPattern = /^[a-f0-9]{64}$/;

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
  if (error.code === "23514") return 409;
  if (error.code === "22023" || error.code === "P0001") return 400;
  return 500;
}

export async function handleProductionDemoDataRetirement(request: Request, dependencies: Dependencies): Promise<Response> {
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

  if (payload.action === "preview") {
    if (!hasOnlyKeys(payload, ["action", "backup_reference", "maintenance_acknowledged"])) return respond(400, { error: "Preview request contains unsupported fields" });
    if (typeof payload.backup_reference !== "string" || payload.backup_reference.trim().length < 3 || payload.backup_reference.trim().length > 500) return respond(400, { error: "backup_reference must contain 3 to 500 characters" });
    if (payload.maintenance_acknowledged !== true) return respond(400, { error: "maintenance_acknowledged must be true" });

    const result = await dependencies.rpc("preview_production_demo_data_retirement", {
      p_actor_auth_user_id: identity.id,
      p_backup_reference: payload.backup_reference.trim(),
      p_maintenance_acknowledged: true,
    });
    if (result.error) return respond(statusFor(result.error), { error: statusFor(result.error) === 500 ? "Unable to create retirement preview" : "Retirement preview was denied or is invalid" });
    return respond(200, { data: result.data });
  }

  if (payload.action === "execute") {
    if (!hasOnlyKeys(payload, ["action", "operation_id", "manifest_hash", "confirmation"])) return respond(400, { error: "Execute request contains unsupported fields" });
    if (typeof payload.operation_id !== "string" || !uuidPattern.test(payload.operation_id)) return respond(400, { error: "operation_id must be a UUID" });
    if (typeof payload.manifest_hash !== "string" || !manifestHashPattern.test(payload.manifest_hash)) return respond(400, { error: "manifest_hash must be a SHA-256 hash" });
    if (payload.confirmation !== confirmation) return respond(400, { error: "confirmation must equal RETIRE DEMO DATA" });

    const result = await dependencies.rpc("execute_production_demo_data_retirement", {
      p_actor_auth_user_id: identity.id,
      p_operation_id: payload.operation_id,
      p_manifest_hash: payload.manifest_hash,
      p_confirmation: confirmation,
    });
    if (result.error) return respond(statusFor(result.error), { error: statusFor(result.error) === 500 ? "Unable to execute retirement" : "Retirement execution was denied, expired, or changed" });
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

  return handleProductionDemoDataRetirement(request, {
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
