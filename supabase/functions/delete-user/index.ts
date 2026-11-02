import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const respond = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return respond(405, { error: "Method not allowed" });
  const url = Deno.env.get("SUPABASE_URL"); const anon = Deno.env.get("SUPABASE_ANON_KEY"); const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return respond(500, { error: "Function secrets are not configured" });
  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return respond(401, { error: "Authentication required" });
  const caller = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: identity, error: identityError } = await caller.auth.getUser(token);
  if (identityError || !identity.user) return respond(401, { error: "Invalid or expired session" });
  let profileId: string;
  try {
    const body = await request.json(); profileId = typeof body?.profile_id === "string" ? body.profile_id : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profileId)) throw new Error();
  } catch { return respond(400, { error: "profile_id must be a valid UUID" }); }
  // Removes the employee in the database (audited, history kept), then makes
  // sure the old login can never be used again.
  const { data: targetAuthId, error: removeError } = await caller.rpc("remove_employee_with_audit", { p_profile_id: profileId });
  if (removeError || !targetAuthId) return respond(removeError?.code === "42501" ? 403 : 400, { error: removeError?.message ?? "User could not be deleted" });
  // An account that never did any work can go entirely; anything with history fails here and is locked instead.
  const { error: deleteError } = await admin.auth.admin.deleteUser(targetAuthId);
  if (deleteError) {
    const { error: lockError } = await admin.auth.admin.updateUserById(targetAuthId, {
      email: `removed-${profileId}@removed.invalid`, password: `${crypto.randomUUID()}${crypto.randomUUID()}`.slice(0, 72),
      email_confirm: true, ban_duration: "876000h", user_metadata: {},
    });
    if (lockError) {
      console.error("removed user login lock failed", { code: lockError.code ?? null });
      return respond(500, { error: "The user was removed and can no longer sign in, but their old login record could not be cleaned up. Ask your system owner to check Supabase Auth." });
    }
  }
  return respond(200, { deleted: true });
});
