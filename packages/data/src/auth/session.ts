import type { Session } from "@supabase/supabase-js";
import { getSupabase as db } from "@jewelos/api-client/client";
import {
  DEFAULT_USER_PREFERENCES,
  builtinAccessContext,
  validateAccessContext,
  type AccessContext,
  type Tables,
  type UserPreferences,
} from "@jewelos/core";
import { usernameLoginFunctionError } from "./functionError";

export type UserProfile = Tables<"user_profiles">;
export type Branch = Tables<"branches">;

/**
 * What signing in produced. A message is the user-facing reason a sign-in did
 * not happen; it is never an exception, because a wrong password is an ordinary
 * outcome rather than a fault.
 */
export type SignInResult =
  | Readonly<{ ok: true; session: Session }>
  | Readonly<{ ok: false; message: string }>;

/**
 * Why a signed-in session may still not reach the application.
 *
 * These mirror the server's account state. They are a courtesy to the person
 * holding the phone, never the access control itself: RLS and the audited RPCs
 * remain the only thing standing between an account and its data.
 */
export type ProfileGate =
  | Readonly<{ status: "authenticated"; profile: UserProfile; branch: Branch | null; preferences: UserPreferences }>
  | Readonly<{ status: "incomplete"; message: string }>
  | Readonly<{ status: "blocked"; message: string; signOut: boolean }>;

/**
 * Signs in with a username or a work email. The credential never reaches the
 * database directly: an Edge Function resolves the identity and mints the
 * session, so the client only ever holds tokens.
 */
export async function signInWithUsername(username: string, password: string): Promise<SignInResult> {
  const { data, error } = await db().functions.invoke<{ access_token?: string; refresh_token?: string; error?: string }>(
    "username-password-login",
    { body: { username, password } },
  );
  if (error || !data?.access_token || !data.refresh_token) {
    return {
      ok: false,
      message: error
        ? await usernameLoginFunctionError(error)
        : "Login failed. Please contact your administrator and quote LOGIN-UNKNOWN.",
    };
  }
  const { data: sessionData, error: sessionError } = await db().auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  if (sessionError || !sessionData.session) return { ok: false, message: "Sign-in failed" };
  return { ok: true, session: sessionData.session };
}

/**
 * The signed-in user's server-resolved permissions and dashboard authority.
 *
 * Before migration 0156 is deployed the RPC does not exist; the built-in role
 * behaviour stands in, exactly as on web. The database stays the authority
 * either way, so this only decides what the app shows.
 */
export async function loadAccessContext(profile: Pick<UserProfile, "id" | "user_role">): Promise<AccessContext> {
  const { data, error } = await db().rpc("get_my_access_context");
  if (error) return builtinAccessContext(profile);
  try {
    return validateAccessContext(data);
  } catch {
    return builtinAccessContext(profile);
  }
}

/** Re-reads the profile behind a live session, for an access refresh. */
export async function loadSignedInProfile(session: Session): Promise<UserProfile | null> {
  const { data, error } = await db()
    .from("user_profiles")
    .select("*")
    .eq("auth_user_id", session.user.id)
    .maybeSingle();
  return error ? null : data;
}

export async function loadUserPreferences(): Promise<UserPreferences> {
  const { data } = await db().from("user_preferences").select("preferences").maybeSingle();
  return (data?.preferences as UserPreferences | undefined) ?? DEFAULT_USER_PREFERENCES;
}

/**
 * Resolves the profile behind a session and decides whether it may proceed.
 *
 * `account_status` arrived with migration 0016, so a null value is not treated
 * as a block: the established working-status and login-enabled guards stay
 * authoritative wherever that column has not been backfilled.
 */
export async function loadProfileGate(session: Session): Promise<ProfileGate> {
  const { data: profile, error } = await db()
    .from("user_profiles")
    .select("*")
    .eq("auth_user_id", session.user.id)
    .maybeSingle();

  if (error) {
    return {
      status: "blocked",
      message: "We could not load your account profile. Please try again or contact your admin.",
      signOut: false,
    };
  }
  if (!profile) {
    return { status: "incomplete", message: "Your account is not fully set up. Please contact your admin." };
  }

  const explicitlyBlocked = profile.account_status != null && profile.account_status !== "active";
  if (explicitlyBlocked || profile.working_status === "resigned" || profile.is_login_enabled === false) {
    return {
      status: "blocked",
      signOut: true,
      message:
        profile.working_status === "resigned" || profile.account_status === "left"
          ? "This account belongs to a resigned employee and can no longer sign in. Contact your admin if this is incorrect."
          : profile.account_status === "suspended"
            ? "This account has been suspended. Please contact your admin."
            : "Login has been disabled for this account. Please contact your admin.",
    };
  }

  const { data: branch } = await db().from("branches").select("*").eq("id", profile.branch_id).maybeSingle();
  return { status: "authenticated", profile, branch, preferences: await loadUserPreferences() };
}
