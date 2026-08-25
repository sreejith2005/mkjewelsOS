import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@jewelos/api-client";
import type { Branch, UserProfile } from "@/types";
import { DEFAULT_USER_PREFERENCES, type UserPreferences } from "@jewelos/core";
import { usernameLoginFunctionError } from "./functionError";

type AuthStatus = "loading" | "signed_out" | "authenticated" | "incomplete" | "blocked";

type AuthContextValue = {
  branch: Branch | null;
  logout: () => Promise<void>;
  profile: UserProfile | null;
  preferences: UserPreferences;
  refreshPreferences: () => Promise<void>;
  session: Session | null;
  signIn: (username: string, password: string) => Promise<string | null>;
  status: AuthStatus;
  statusMessage: string | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_USER_PREFERENCES);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const forcedSignOut = useRef(false);

  const refreshPreferences = useCallback(async () => {
    const { data } = await supabase.from("user_preferences").select("preferences").maybeSingle();
    setPreferences((data?.preferences as UserPreferences | undefined) ?? DEFAULT_USER_PREFERENCES);
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
      setBranch(null);
      setStatus("incomplete");
      setStatusMessage("Your account is not fully set up. Please contact your admin.");
      return;
    }

    setProfile(nextProfile);
    // `account_status` is introduced by migration 0016. Keep the established
    // active-session guard authoritative until that migration is present.
    const accountIsExplicitlyBlocked = nextProfile.account_status != null && nextProfile.account_status !== "active";
    if (accountIsExplicitlyBlocked || nextProfile.working_status === "resigned" || nextProfile.is_login_enabled === false) {
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

    const { data: nextBranch } = await supabase
      .from("branches")
      .select("*")
      .eq("id", nextProfile.branch_id)
      .maybeSingle();
    setBranch(nextBranch);
    await refreshPreferences();
    setStatusMessage(null);
    setStatus("authenticated");
  }, [refreshPreferences]);

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
    <AuthContext.Provider value={{ branch, logout, preferences, profile, refreshPreferences, session, signIn, status, statusMessage }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
