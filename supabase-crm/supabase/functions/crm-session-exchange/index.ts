import { createClient } from "@supabase/supabase-js";
import { type CrmGateway, handleSessionExchange, type JewelosGateway } from "./worker.ts";

// Configuration (Edge Function secrets of the CRM project):
//   JEWELOS_SUPABASE_URL, JEWELOS_SUPABASE_ANON_KEY  the JewelOS project's public URL and anon key
//   CRM_BRIDGE_ALLOWED_ORIGINS                       comma-separated JewelOS web origins
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by the runtime.
// verify_jwt is off for this function (supabase-crm/supabase/config.toml): the caller's token
// is a JewelOS token, which this function verifies with JewelOS itself.

const noSession = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } } as const;

function jewelosGateway(): JewelosGateway | null {
  const url = Deno.env.get("JEWELOS_SUPABASE_URL");
  const anon = Deno.env.get("JEWELOS_SUPABASE_ANON_KEY");
  if (!url || !anon) return null;
  const asCaller = (token: string) =>
    createClient(url, anon, { ...noSession, global: { headers: { Authorization: `Bearer ${token}` } } });
  return {
    async verify(token) {
      const { data, error } = await createClient(url, anon, noSession).auth.getUser(token);
      return error || !data.user ? null : data.user.id;
    },
    async access(token) {
      const db = asCaller(token);
      const [profile, active, crmView, section] = await Promise.all([
        db.rpc("current_profile"),
        db.rpc("current_profile_is_active"),
        db.rpc("has_permission", { p_key: "crm.view" }),
        db.rpc("module_accessible", { p_page: "crm", p_require_permission: false }),
      ]);
      const failed = [profile, active, crmView, section].find((result) => result.error);
      if (failed) throw new Error("JewelOS access check failed");
      const profileId = (profile.data as { id?: string | null } | null)?.id ?? null;
      return { profileId, active: active.data === true, crmView: crmView.data === true, sectionOpen: section.data === true };
    },
  };
}

type GrantRow = {
  id: string;
  legacy_crm_user_id: string;
  crm_auth_user_id: string | null;
  active: boolean;
  users: { active: boolean; email: string } | null;
};

function crmGateway(): CrmGateway | null {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return null;
  const admin = createClient(url, service, noSession);
  return {
    async grantFor(jewelosProfileId) {
      const { data, error } = await admin
        .from("crm_sso_access_grants")
        .select("id, legacy_crm_user_id, crm_auth_user_id, active, users!crm_sso_access_grants_legacy_crm_user_id_fkey(active, email)")
        .eq("jewelos_user_id", jewelosProfileId)
        .maybeSingle();
      if (error) throw new Error("grant lookup failed");
      const row = data as GrantRow | null;
      if (!row) return null;
      return {
        id: row.id,
        legacyCrmUserId: row.legacy_crm_user_id,
        crmAuthUserId: row.crm_auth_user_id,
        active: row.active,
        crmUserActive: row.users?.active === true,
        crmUserEmail: row.users?.email ?? "",
      };
    },
    async ensureAuthUser(crmUserId, email) {
      const existing = await admin.auth.admin.getUserById(crmUserId);
      if (existing.data.user) {
        if (!existing.data.user.email) throw new Error("CRM auth user has no email");
        return existing.data.user.email;
      }
      const normalized = email.trim().toLowerCase();
      if (!normalized) throw new Error("CRM user has no email");
      // Same id as the CRM users row, so auth.uid() is the CRM user id, as in the original CRM.
      const created = await admin.auth.admin.createUser({ id: crmUserId, email: normalized, email_confirm: true });
      if (created.error || !created.data.user?.email) throw new Error("CRM auth user could not be created");
      return created.data.user.email;
    },
    async linkGrant(grantId, crmUserId) {
      const { error } = await admin
        .from("crm_sso_access_grants")
        .update({ crm_auth_user_id: crmUserId, updated_at: new Date().toISOString() })
        .eq("id", grantId);
      if (error) throw new Error("grant link failed");
    },
    async mintAccessToken(signInEmail) {
      // A magic link generated server-side is never sent: its hashed token is verified here at
      // once. Only the access token leaves this function; the refresh token is discarded.
      const link = await admin.auth.admin.generateLink({ type: "magiclink", email: signInEmail });
      const tokenHash = link.data.properties?.hashed_token;
      if (link.error || !tokenHash) throw new Error("session link failed");
      const verified = await createClient(url, anon, noSession).auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
      const session = verified.data.session;
      if (verified.error || !session?.access_token || !session.expires_at) throw new Error("session open failed");
      return { accessToken: session.access_token, expiresAt: session.expires_at };
    },
    async audit(entry) {
      const { error } = await admin.from("crm_sso_access_audit").insert({
        grant_id: entry.grantId,
        actor_crm_auth_user_id: entry.crmAuthUserId,
        action: entry.action,
        metadata: entry.metadata,
      });
      if (error) throw new Error("audit write failed");
    },
  };
}

const allowedOrigins = (Deno.env.get("CRM_BRIDGE_ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

Deno.serve((request) =>
  handleSessionExchange(request, { jewelos: jewelosGateway(), crm: crmGateway(), allowedOrigins })
);
