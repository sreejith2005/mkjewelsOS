// CRM-project Edge Function: the JewelOS login bridge.
// Design: docs/superpowers/specs/2026-10-01-crm-two-project-client-database-design.md,
// "Login bridge".
//
// A JewelOS user's browser or WebView sends its JewelOS access token. This function:
//   1. Verifies the token with JewelOS Auth. It holds no JewelOS secret.
//   2. Asks JewelOS, as the caller, whether CRM access is currently allowed, using JewelOS's
//      own checks: active profile, crm.view permission, and the crm section switched on.
//      JewelOS stays the single authority on access.
//   3. Finds the caller's active crm_sso_access_grants row (by JewelOS profile id) and that
//      grant's active CRM user.
//   4. Opens a CRM session as that CRM user. The auth user id equals the CRM users.id, so
//      the original auth.uid()-based RLS works unchanged. A missing auth user is created
//      with that same id.
//   5. Returns ONLY a short-lived access token. No refresh token ever leaves this function.
//      The client exchanges again when the token expires, so a JewelOS-side revocation
//      takes effect within one token lifetime even before the roster sync exists.
// Every grant and every denial of a verified JewelOS user is audited in
// crm_sso_access_audit. Tokens, emails and other personal values are never logged or
// audited.

export type JewelosAccess = Readonly<{
  /** JewelOS user_profiles.id of the caller, or null when the caller has no profile. */
  profileId: string | null;
  /** current_profile_is_active(): login enabled, not resigned, account active. */
  active: boolean;
  /** has_permission('crm.view'). */
  crmView: boolean;
  /** module_accessible('crm', false): the CRM section is switched on. */
  sectionOpen: boolean;
}>;

export type JewelosGateway = Readonly<{
  /** The JewelOS Auth user id for a valid token, or null for an invalid or expired one. */
  verify: (token: string) => Promise<string | null>;
  /** JewelOS's own access checks, evaluated as the caller. */
  access: (token: string) => Promise<JewelosAccess>;
}>;

export type CrmGrant = Readonly<{
  id: string;
  legacyCrmUserId: string;
  crmAuthUserId: string | null;
  active: boolean;
  crmUserActive: boolean;
  crmUserEmail: string;
}>;

export type CrmGateway = Readonly<{
  grantFor: (jewelosProfileId: string) => Promise<CrmGrant | null>;
  /** The sign-in email of the CRM auth user with this id. A missing user is created with this id. */
  ensureAuthUser: (crmUserId: string, email: string) => Promise<string>;
  /** Sets the grant's crm_auth_user_id to the CRM user id. */
  linkGrant: (grantId: string, crmUserId: string) => Promise<void>;
  /** Opens a session for the auth user with this sign-in email and returns only its access token. */
  mintAccessToken: (signInEmail: string) => Promise<Readonly<{ accessToken: string; expiresAt: number }>>;
  audit: (entry: Readonly<{
    grantId: string | null;
    crmAuthUserId: string | null;
    action: "session_exchange";
    metadata: Readonly<Record<string, string | boolean>>;
  }>) => Promise<void>;
}>;

export type ExchangeDeps = Readonly<{
  jewelos: JewelosGateway | null;
  crm: CrmGateway | null;
  /** Browser origins allowed to call (the JewelOS web origins). Empty: no browser origin is allowed. */
  allowedOrigins: ReadonlyArray<string>;
}>;

export type DenialCode =
  | "no_profile"
  | "inactive"
  | "no_crm_permission"
  | "crm_section_off"
  | "not_provisioned"
  | "crm_user_inactive";

const DENIAL_MESSAGE = "CRM access is not enabled for your account.";

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    Vary: "Origin",
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(body: Record<string, unknown>, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

function bearer(request: Request): string | null {
  return request.headers.get("Authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
}

export async function handleSessionExchange(request: Request, deps: ExchangeDeps): Promise<Response> {
  // Non-browser callers (the native app) send no Origin. A browser Origin must be allow-listed.
  const requestOrigin = request.headers.get("Origin");
  if (requestOrigin !== null && !deps.allowedOrigins.includes(requestOrigin)) {
    return json({ error: "Origin not allowed" }, 403, null);
  }
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(requestOrigin) });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST, OPTIONS" } });

  const { jewelos, crm } = deps;
  if (!jewelos || !crm) return json({ error: "CRM sign-in is unavailable" }, 503, requestOrigin);

  const token = bearer(request);
  if (!token) return json({ error: "Sign in to JewelOS first" }, 401, requestOrigin);

  let grant: CrmGrant | null = null;
  try {
    const jewelosAuthUserId = await jewelos.verify(token);
    if (!jewelosAuthUserId) return json({ error: "Sign in to JewelOS first" }, 401, requestOrigin);

    const access = await jewelos.access(token);
    const deny = async (code: DenialCode, grantId: string | null = null) => {
      await crm.audit({
        grantId,
        crmAuthUserId: null,
        action: "session_exchange",
        metadata: { outcome: "denied", code, jewelos_profile_id: access.profileId ?? "none" },
      });
      return json({ error: DENIAL_MESSAGE, code }, 403, requestOrigin);
    };

    if (!access.profileId) return await deny("no_profile");
    if (!access.active) return await deny("inactive");
    if (!access.crmView) return await deny("no_crm_permission");
    if (!access.sectionOpen) return await deny("crm_section_off");

    grant = await crm.grantFor(access.profileId);
    if (!grant || !grant.active) return await deny("not_provisioned", grant?.id ?? null);
    if (!grant.crmUserActive) return await deny("crm_user_inactive", grant.id);

    const signInEmail = await crm.ensureAuthUser(grant.legacyCrmUserId, grant.crmUserEmail);
    const linked = grant.crmAuthUserId !== grant.legacyCrmUserId;
    if (linked) await crm.linkGrant(grant.id, grant.legacyCrmUserId);
    const session = await crm.mintAccessToken(signInEmail);

    await crm.audit({
      grantId: grant.id,
      crmAuthUserId: grant.legacyCrmUserId,
      action: "session_exchange",
      metadata: { outcome: "granted", linked, jewelos_profile_id: access.profileId },
    });
    return json(
      { access_token: session.accessToken, expires_at: session.expiresAt, crm_user_id: grant.legacyCrmUserId },
      200,
      requestOrigin,
    );
  } catch (error) {
    // Never echo upstream errors: they can carry emails or token fragments.
    console.error("crm-session-exchange failed:", error instanceof Error ? error.name : "unknown");
    try {
      await crm.audit({
        grantId: grant?.id ?? null,
        crmAuthUserId: null,
        action: "session_exchange",
        metadata: { outcome: "failed" },
      });
    } catch {
      // The audit write is best effort on the failure path; the request already failed.
    }
    return json({ error: "CRM sign-in is unavailable" }, 500, requestOrigin);
  }
}
