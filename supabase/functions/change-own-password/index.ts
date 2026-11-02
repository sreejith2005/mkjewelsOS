import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Lets a signed-in employee change their own login password. The current
// password is checked first; passwords are never stored, logged, or returned.
const headers = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const respond = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });
// Keep in step with OWN_PASSWORD_MIN_LENGTH / OWN_PASSWORD_MAX_LENGTH in packages/core/src/userCredentials.ts.
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 72;

async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return respond(405, { error: "Method not allowed" });
  const url = Deno.env.get("SUPABASE_URL"); const anonKey = Deno.env.get("SUPABASE_ANON_KEY"); const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); const rateSecret = Deno.env.get("USERNAME_LOGIN_RATE_LIMIT_SECRET");
  if (!url || !anonKey || !serviceRoleKey || !rateSecret) return respond(503, { error: "Password change is not configured. Please contact your administrator." });
  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return respond(401, { error: "Your session has expired. Please sign in again." });
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: identity, error: identityError } = await caller.auth.getUser(token);
  const email = identity?.user?.email;
  if (identityError || !identity.user || !email) return respond(401, { error: "Your session has expired. Please sign in again." });

  let currentPassword = ""; let newPassword = "";
  try {
    const body = await request.json();
    currentPassword = typeof body?.current_password === "string" ? body.current_password : "";
    newPassword = typeof body?.new_password === "string" ? body.new_password : "";
  } catch { return respond(400, { error: "Request body must be valid JSON" }); }
  if (!currentPassword) return respond(400, { error: "Enter your current password." });
  if (newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > MAX_PASSWORD_LENGTH) return respond(400, { error: `New password must be ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.` });
  if (newPassword === currentPassword) return respond(400, { error: "Choose a new password that is different from your current one." });

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: authorizationError } = await admin.rpc("authorize_own_password_change", { p_actor_auth_user_id: identity.user.id });
  if (authorizationError) return respond(authorizationError.code === "42501" ? 403 : 503, { error: authorizationError.code === "42501" ? "Your account cannot change its password. Please contact your Super Admin." : "Password change is unavailable. Please try again." });

  // Same 10 tries per 15 minutes as sign-in, counted separately for each account.
  const { data: allowed, error: rateError } = await admin.rpc("consume_username_login_rate_limit", { p_rate_limit_key: await digest(`${rateSecret}:change-own-password:${identity.user.id}`) });
  if (rateError) return respond(503, { error: "Password change is unavailable. Please try again." });
  if (allowed !== true) return respond(429, { error: "Too many attempts. Try again in 15 minutes." });

  const check = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: currentPassword }) });
  if (!check.ok) return respond(400, { error: "Your current password is incorrect." });
  // The check opened a throwaway session; close it so it does not linger.
  const checkSession = await check.json().catch(() => null) as { access_token?: unknown } | null;
  if (typeof checkSession?.access_token === "string") {
    await fetch(`${url}/auth/v1/logout?scope=local`, { method: "POST", headers: { apikey: anonKey, Authorization: `Bearer ${checkSession.access_token}` } }).catch(() => undefined);
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(identity.user.id, { password: newPassword });
  if (updateError) return respond(400, { error: "Your password could not be changed. Try a different password." });
  const { error: auditError } = await admin.rpc("audit_own_password_change", { p_actor_auth_user_id: identity.user.id });
  if (auditError) console.error("own password change audit failed", { code: auditError.code ?? null });
  return respond(200, { success: true });
});
