import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const respond = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function temporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return respond(405, { error: "Method not allowed" });
  const url = Deno.env.get("SUPABASE_URL"); const anonKey = Deno.env.get("SUPABASE_ANON_KEY"); const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) return respond(500, { error: "Function secrets are not configured" });
  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return respond(401, { error: "Authentication required" });
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: identity, error: identityError } = await caller.auth.getUser(token);
  if (identityError || !identity.user) return respond(401, { error: "Invalid or expired session" });
  let profileId: string;
  try { const body = await request.json(); profileId = typeof body?.profile_id === "string" ? body.profile_id : ""; if (!UUID_PATTERN.test(profileId)) throw new Error(); }
  catch { return respond(400, { error: "profile_id must be a valid UUID" }); }
  const { data: targetAuthUserId, error: authorizationError } = await admin.rpc("authorize_super_admin_password_reset", { p_actor_auth_user_id: identity.user.id, p_target_profile_id: profileId });
  if (authorizationError || !targetAuthUserId) return respond(authorizationError?.code === "42501" ? 403 : 400, { error: authorizationError?.message ?? "Password reset is not allowed" });
  const password = temporaryPassword();
  const { error: resetError } = await admin.auth.admin.updateUserById(targetAuthUserId, { password });
  if (resetError) return respond(400, { error: "Unable to reset this password" });
  const { error: auditError } = await admin.rpc("audit_super_admin_password_reset", { p_actor_auth_user_id: identity.user.id, p_target_profile_id: profileId });
  if (auditError) { console.error("password reset audit failed", { code: auditError.code ?? null }); return respond(500, { error: "Password reset completed but could not be audited. Contact a system owner before sharing it." }); }
  return respond(200, { temporary_password: password });
});
