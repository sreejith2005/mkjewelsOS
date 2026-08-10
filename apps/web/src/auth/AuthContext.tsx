import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@jewelos/api-client";
import type { Branch, UserProfile } from "@/types";
import { DEFAULT_USER_PREFERENCES, type UserPreferences } from "@jewelos/core";

type AuthStatus = "loading" | "signed_out" | "authenticated" | "incomplete" | "blocked";

type AuthContextValue = {
  branch: Branch | null;
  logout: () => Promise<void>;
  profile: UserProfile | null;
  preferences: UserPreferences;
  refreshPreferences: () => Promise<void>;
  session: Session | null;
  signIn: (email: string, password: string) => Promise<string | null>;
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
    if (nextProfile.working_status === "resigned" || nextProfile.is_login_enabled === false) {
      forcedSignOut.current = true;
      setStatus("blocked");
      setStatusMessage(
        nextProfile.working_status === "resigned"
          ? "This account belongs to a resigned employee and can no longer sign in. Contact your admin if this is incorrect."
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
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) void loadProfile(data.session);
      else setStatus("signed_out");
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

  const signIn = useCallback(async (email: string, password: string) => {
    setStatusMessage(null);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.session) {
        setStatus("signed_out");
        return error?.message ?? "Sign-in failed";
      }
      await loadProfile(data.session);
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
