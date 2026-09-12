// `URL` and `URLSearchParams` are incomplete in Hermes, and both
// @supabase/supabase-js and its Realtime transport depend on them. This import
// must run before the client is constructed, so it stays at the top.
import "react-native-url-polyfill/auto";

import { AppState, type AppStateStatus } from "react-native";
import { createJewelosClient, setSupabaseClient, type JewelosClient } from "@jewelos/api-client/client";
import { env } from "@/config/env";
import { secureSessionStorage } from "@/lib/secureSessionStorage";

/**
 * The native Supabase client. It differs from the browser client in three ways:
 *
 *   - the session lives in encrypted device storage rather than `localStorage`;
 *   - there is no URL to detect a session in, so that probe is disabled;
 *   - token refresh follows the app lifecycle instead of a free-running timer,
 *     because Android suspends timers for a backgrounded process and a timer
 *     that fires late is worse than one that is restarted on resume.
 */
export const supabase: JewelosClient = createJewelosClient({
  url: env.supabaseUrl,
  anonKey: env.supabaseAnonKey,
  storage: secureSessionStorage,
  detectSessionInUrl: false,
  autoRefreshToken: false,
});

// Shared data modules resolve the client through `getSupabase()`; register it
// before any screen can issue a query.
setSupabaseClient(supabase);

let lifecycleSubscription: { remove: () => void } | null = null;

/** Starts lifecycle-driven token refresh. Returns a teardown for tests. */
export function startSupabaseSessionLifecycle(): () => void {
  if (lifecycleSubscription) return () => undefined;
  const apply = (state: AppStateStatus) => {
    if (state === "active") void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  };
  apply(AppState.currentState);
  const subscription = AppState.addEventListener("change", apply);
  lifecycleSubscription = subscription;
  return () => {
    subscription.remove();
    lifecycleSubscription = null;
  };
}
