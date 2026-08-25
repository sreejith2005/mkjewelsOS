import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const invalid = () => new Response(JSON.stringify({ code: "invalid_credentials" }), { status: 401, headers });
const respond = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });
const usernamePattern = /^[a-z0-9]{2,80}$/;

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return respond(405, { error: "Method not allowed" });
  const url = Deno.env.get("SUPABASE_URL"); const anonKey = Deno.env.get("SUPABASE_ANON_KEY"); const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); const rateSecret = Deno.env.get("USERNAME_LOGIN_RATE_LIMIT_SECRET");
  if (!url || !anonKey || !serviceRoleKey || !rateSecret) return respond(503, { code: "login_configuration" });
  let username = ""; let password = "";
  try { const body = await request.json(); username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : ""; password = typeof body?.password === "string" ? body.password : ""; } catch { return invalid(); }
  if (!usernamePattern.test(username) || password.length < 6 || password.length > 128) return invalid();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("cf-connecting-ip") || "unknown";
  const key = await digest(`${rateSecret}:${forwarded}:${username}`);
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: allowed, error: rateError } = await admin.rpc("consume_username_login_rate_limit", { p_rate_limit_key: key });
  if (rateError) return respond(503, { code: "login_rate_limit" });
  if (allowed !== true) return respond(429, { code: "login_rate_limited" });
  const { data: profile, error: profileError } = await admin.from("user_profiles").select("email,account_status,is_login_enabled,working_status").eq("username", username).maybeSingle();
  if (profileError) return respond(503, { code: "login_identity" });
  if (!profile || profile.account_status !== "active" || !profile.is_login_enabled || profile.working_status === "resigned") return invalid();
  const authResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email: profile.email, password }) });
  if (!authResponse.ok) return invalid();
  const session = await authResponse.json();
  if (typeof session?.access_token !== "string" || typeof session?.refresh_token !== "string") return respond(503, { code: "login_auth" });
  return respond(200, { access_token: session.access_token, refresh_token: session.refresh_token });
});
