import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { Session } from "@supabase/supabase-js";
import { DEFAULT_USER_PREFERENCES, builtinAccessContext, type AccessContext, type UserPreferences } from "@jewelos/core";
import {
  loadAccessContext,
  loadProfileGate,
  loadSignedInProfile,
  loadUserPreferences,
  signInWithUsername,
  type Branch,
  type UserProfile,
} from "@jewelos/data/auth/session";
import { subscribeToTenantRealtime } from "@jewelos/data/realtime/api";
import { supabase } from "@/lib/supabase";
import { errorText, log } from "@/lib/log";

/**
 * `restoring` covers the moment before the stored session has been read out of
 * SecureStore. It is distinct from `signed_out`, because showing a login form
 * to someone who is already signed in is a bug the web app never had to face:
 * a browser has its session synchronously, a phone does not.
 */
export type AuthStatus = "restoring" | "signed_out" | "authenticated" | "incomplete" | "blocked";

type AuthContextValue = Readonly<{
  status: AuthStatus;
  statusMessage: string | null;
  session: Session | null;
  /** Server-resolved permissions and dashboard authority for the signed-in user. */
  access: AccessContext | null;
  /**
   * The signed-in profile. `user_role` is the effective role (dashboard
   * authority when one is set), matching what the database's role-level rules
   * see — the same substitution the web app makes. The assigned role is
   * `access.baseRole`.
   */
  profile: UserProfile | null;
  branch: Branch | null;
  preferences: UserPreferences;
  signIn: (username: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  refreshAccess: () => Promise<void>;
  refreshPreferences: () => Promise<void>;
}>;

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("restoring");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [access, setAccess] = useState<AccessContext | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_USER_PREFERENCES);
  const forcedSignOut = useRef(false);

  const refreshPreferences = useCallback(async () => {
    setPreferences(await loadUserPreferences());
  }, []);

  const clearIdentity = useCallback(() => {
    setSession(null);
    setProfile(null);
    setAccess(null);
    setBranch(null);
  }, []);

  /**
   * Applies a profile together with its access snapshot, as the web does.
   *
   * An unchanged refresh keeps the existing objects. Every consumer of the
   * profile re-renders when its identity changes, and refreshes arrive on each
   * foregrounding and each tenant settings event — re-rendering the whole tree
   * for identical data is wasted work on a phone.
   */
  const applyProfile = useCallback(async (nextProfile: UserProfile) => {
    const nextAccess = await loadAccessContext(nextProfile);
    const effective = { ...nextProfile, user_role: nextAccess.effectiveRole };
    setAccess((current) => (current && JSON.stringify(current) === JSON.stringify(nextAccess) ? current : nextAccess));
    setProfile((current) => (current && JSON.stringify(current) === JSON.stringify(effective) ? current : effective));
  }, []);

  const applySession = useCallback(async (next: Session) => {
    setSession(next);
    try {
      const gate = await loadProfileGate(next);
      if (gate.status === "incomplete") {
        setProfile(null);
        setAccess(null);
        setBranch(null);
        setStatusMessage(gate.message);
        setStatus("incomplete");
        return;
      }
      if (gate.status === "blocked") {
        setStatusMessage(gate.message);
        setStatus("blocked");
        if (!gate.signOut) return;
        forcedSignOut.current = true;
        await supabase.auth.signOut();
        setSession(null);
        return;
      }
      await applyProfile(gate.profile);
      setBranch(gate.branch);
      setPreferences(gate.preferences);
      setStatusMessage(null);
      setStatus("authenticated");
    } catch (error) {
      // A phone loses its network mid-request routinely. That is not a reason
      // to sign someone out — the stored session is still valid, so the screen
      // says so and offers a retry instead of dumping them at the login form.
      log.error("auth", "could not load the profile behind a restored session", error);
      setStatusMessage(errorText(error));
      setStatus("blocked");
    }
  }, [applyProfile]);

  /**
   * Reloads the signed-in profile and access snapshot. Called when permission,
   * authority, or organization data changes so the UI never keeps stale access;
   * the server re-evaluates on every request regardless.
   */
  const refreshAccess = useCallback(async () => {
    if (!session) return;
    try {
      const nextProfile = await loadSignedInProfile(session);
      if (nextProfile) await applyProfile(nextProfile);
    } catch (error) {
      log.error("auth", "could not refresh access", error);
    }
  }, [applyProfile, session]);

  // The web refreshes on the same two tenant topics; permission and authority
  // edits publish on them.
  useEffect(() => {
    const tenantId = status === "authenticated" ? profile?.tenant_id : null;
    if (!tenantId) return;
    return subscribeToTenantRealtime(tenantId, ["settings", "organization"], () => void refreshAccess());
  }, [profile?.tenant_id, refreshAccess, status]);

  // The phone equivalent of the web's `visibilitychange` refresh: coming back
  // to the app picks up any access change made while it was in the background.
  useEffect(() => {
    if (status !== "authenticated") return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshAccess();
    });
    return () => subscription.remove();
  }, [refreshAccess, status]);

  useEffect(() => {
    let active = true;

    void (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!active) return;
      if (error || !data.session) {
        setStatus("signed_out");
        return;
      }
      // A phone can sit closed for days, so the stored access token is usually
      // stale. Refreshing up front turns an expired token into a clean sign-out
      // rather than a confusing failure on the first screen that loads data.
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (!active) return;
      if (refreshError || !refreshed.session) {
        await supabase.auth.signOut({ scope: "local" });
        if (!active) return;
        clearIdentity();
        setStatusMessage("Your session has expired. Please sign in again.");
        setStatus("signed_out");
        return;
      }
      await applySession(refreshed.session);
    })();

    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      if (next) {
        void applySession(next);
        return;
      }
      if (event === "SIGNED_OUT" && forcedSignOut.current) {
        forcedSignOut.current = false;
        return;
      }
      clearIdentity();
      setStatusMessage(null);
      setStatus("signed_out");
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [applySession, clearIdentity]);

  const signIn = useCallback(async (username: string, password: string) => {
    setStatusMessage(null);
    try {
      const result = await signInWithUsername(username, password);
      if (!result.ok) {
        setStatus("signed_out");
        return result.message;
      }
      await applySession(result.session);
      return null;
    } catch (error) {
      log.error("auth", "sign-in failed", error);
      setStatus("signed_out");
      return errorText(error);
    }
  }, [applySession]);

  const logout = useCallback(async () => {
    // `signOut` clears the stored session, so the SecureStore entries go with
    // it and nothing recoverable is left on the device.
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider
      value={{ status, statusMessage, session, access, profile, branch, preferences, signIn, logout, refreshAccess, refreshPreferences }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

/** The signed-in profile, for screens that only render once authenticated. */
export function useProfile(): UserProfile {
  const { profile } = useAuth();
  if (!profile) throw new Error("useProfile must be used inside an authenticated screen");
  return profile;
}

/**
 * The signed-in user's access, for screens that only render once
 * authenticated. Falls back to the built-in role rules for the instant between
 * a profile and its access snapshot, the same fallback the web shell uses.
 */
export function useAccess(): AccessContext {
  const { access } = useAuth();
  const profile = useProfile();
  return access ?? builtinAccessContext(profile);
}
