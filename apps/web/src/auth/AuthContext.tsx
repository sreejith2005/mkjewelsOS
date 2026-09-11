import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@jewelos/api-client";
import type { Branch, UserProfile } from "@/types";
import { DEFAULT_USER_PREFERENCES, builtinAccessContext, validateAccessContext, type AccessContext, type UserPreferences } from "@jewelos/core";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { usernameLoginFunctionError } from "./functionError";

type AuthStatus = "loading" | "signed_out" | "authenticated" | "incomplete" | "blocked";

type AuthContextValue = {
  /** Server-resolved permissions and dashboard authority for the signed-in user. */
  access: AccessContext | null;
  branch: Branch | null;
  logout: () => Promise<void>;
  /**
   * The signed-in profile. `user_role` is the effective role (dashboard
   * authority when one is set), matching what the database's role-level rules
   * see; the assigned role is `access.baseRole`.
   */
  profile: UserProfile | null;
  preferences: UserPreferences;
  refreshAccess: () => Promise<void>;
  refreshPreferences: () => Promise<void>;
  session: Session | null;
  signIn: (username: string, password: string) => Promise<string | null>;
  status: AuthStatus;
  statusMessage: string | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchAccessContext(profile: UserProfile): Promise<AccessContext> {
  const { data, error } = await supabase.rpc("get_my_access_context");
  // Before migration 0156 is deployed the RPC does not exist. Fall back to the
  // shipped role behaviour; the database remains the authorization boundary.
  if (error) return builtinAccessContext(profile);
  try {
    return validateAccessContext(data);
  } catch {
    return builtinAccessContext(profile);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [access, setAccess] = useState<AccessContext | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_USER_PREFERENCES);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const forcedSignOut = useRef(false);

  const refreshPreferences = useCallback(async () => {
    const { data } = await supabase.from("user_preferences").select("preferences").maybeSingle();
    setPreferences((data?.preferences as UserPreferences | undefined) ?? DEFAULT_USER_PREFERENCES);
  }, []);

  const applyProfile = useCallback(async (nextProfile: UserProfile) => {
    const nextAccess = await fetchAccessContext(nextProfile);
    setAccess(nextAccess);
    setProfile({ ...nextProfile, user_role: nextAccess.effectiveRole });
  }, []);

  const loadProfile = useCallback(async (nextSession: Session) => {
    setSession(nextSession);
    const { data: nextProfile, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("auth_user_id", nextSession.user.id)
      .maybeSingle();
    if (error) {
      setStatus("blocked");
      setStatusMessage("We could not load your account profile. Please try again or contact your admin.");
      return;
    }
    if (!nextProfile) {
      setProfile(null);
      setAccess(null);
      setBranch(null);
      setStatus("incomplete");
      setStatusMessage("Your account is not fully set up. Please contact your admin.");
      return;
    }

    // `account_status` is introduced by migration 0016. Keep the established
    // active-session guard authoritative until that migration is present.
    const accountIsExplicitlyBlocked = nextProfile.account_status != null && nextProfile.account_status !== "active";
    if (accountIsExplicitlyBlocked || nextProfile.working_status === "resigned" || nextProfile.is_login_enabled === false) {
      setProfile(nextProfile);
      forcedSignOut.current = true;
      setStatus("blocked");
      setStatusMessage(
        nextProfile.working_status === "resigned" || nextProfile.account_status === "left"
          ? "This account belongs to a resigned employee and can no longer sign in. Contact your admin if this is incorrect."
          : nextProfile.account_status === "suspended"
            ? "This account has been suspended. Please contact your admin."
            : "Login has been disabled for this account. Please contact your admin.",
      );
      await supabase.auth.signOut();
      setSession(null);
      return;
    }

    await applyProfile(nextProfile);
    const { data: nextBranch } = await supabase
      .from("branches")
      .select("*")
      .eq("id", nextProfile.branch_id)
      .maybeSingle();
    setBranch(nextBranch);
    await refreshPreferences();
    setStatusMessage(null);
    setStatus("authenticated");
  }, [applyProfile, refreshPreferences]);

  /**
   * Reloads the signed-in profile and access snapshot. Called when permission,
   * authority, or organization data changes so the UI never keeps stale access;
   * the server re-evaluates on every request regardless.
   */
  const refreshAccess = useCallback(async () => {
    if (!session) return;
    const { data: nextProfile, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("auth_user_id", session.user.id)
      .maybeSingle();
    if (error || !nextProfile) return;
    await applyProfile(nextProfile);
  }, [applyProfile, session]);

  useTenantRealtimeRefresh({ tenantId: status === "authenticated" ? profile?.tenant_id : null, topics: ["settings", "organization"], refresh: refreshAccess });

  useEffect(() => {
    if (status !== "authenticated") return;
    const onVisible = () => { if (document.visibilityState === "visible") void refreshAccess(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshAccess, status]);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(async ({ data, error }) => {
      if (!active) return;
      if (error || !data.session) {
        setStatus("signed_out");
        return;
      }
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (!active) return;
      if (refreshError || !refreshed.session) {
        await supabase.auth.signOut({ scope: "local" });
        if (!active) return;
        setSession(null);
        setProfile(null);
        setAccess(null);
        setBranch(null);
        setStatus("signed_out");
        setStatusMessage("Your session has expired. Please sign in again.");
        return;
      }
      void loadProfile(refreshed.session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      if (nextSession) {
        void loadProfile(nextSession);
      } else if (event === "SIGNED_OUT" && forcedSignOut.current) {
        forcedSignOut.current = false;
      } else {
        setSession(null);
        setProfile(null);
        setAccess(null);
        setBranch(null);
        setStatusMessage(null);
        setStatus("signed_out");
      }
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (username: string, password: string) => {
    setStatusMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke<{ access_token?: string; refresh_token?: string; error?: string }>("username-password-login", { body: { username, password } });
      if (error || !data?.access_token || !data.refresh_token) {
        setStatus("signed_out");
        return error ? await usernameLoginFunctionError(error) : "Login failed. Please contact your administrator and quote LOGIN-UNKNOWN.";
      }
      const { data: sessionData, error: sessionError } = await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
      if (sessionError || !sessionData.session) { setStatus("signed_out"); return "Sign-in failed"; }
      await loadProfile(sessionData.session);
      return null;
    } catch (error) {
      setStatus("signed_out");
      return error instanceof Error ? error.message : "Sign-in failed";
    }
  }, [loadProfile]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{ access, branch, logout, preferences, profile, refreshAccess, refreshPreferences, session, signIn, status, statusMessage }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
