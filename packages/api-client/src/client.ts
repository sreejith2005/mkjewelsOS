import { createClient, type SupabaseClient, type SupabaseClientOptions } from "@supabase/supabase-js";
import type { Database } from "@jewelos/core";

export type JewelosClient = SupabaseClient<Database>;

/**
 * The storage a platform gives Supabase for its session. The web client uses
 * the browser default; React Native must supply an encrypted implementation
 * because a device has no origin-scoped storage to inherit.
 */
export type JewelosSessionStorage = Readonly<{
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}>;

export type JewelosClientConfig = Readonly<{
  url: string;
  anonKey: string;
  /** Absent on web, where the browser default is correct. */
  storage?: JewelosSessionStorage | undefined;
  /**
   * Only a browser can complete a redirect-carried session, and only a browser
   * can be trusted to have one in its URL. Native passes `false`.
   */
  detectSessionInUrl?: boolean | undefined;
  /** Native pauses and resumes refresh with the app lifecycle, so it opts out of the timer. */
  autoRefreshToken?: boolean | undefined;
}>;

/**
 * Builds a client from explicit configuration. It reads no environment of its
 * own, so the same construction works under Vite, Metro, and Node tests.
 */
export function createJewelosClient(config: JewelosClientConfig): JewelosClient {
  if (!config.url || !config.anonKey) {
    throw new Error("A JewelOS Supabase client needs both a project URL and an anon key");
  }
  const options: SupabaseClientOptions<"public"> = {
    auth: {
      persistSession: true,
      autoRefreshToken: config.autoRefreshToken ?? true,
      detectSessionInUrl: config.detectSessionInUrl ?? true,
      ...(config.storage ? { storage: config.storage } : {}),
    },
  };
  return createClient<Database>(config.url, config.anonKey, options);
}

export type JewelosAccessTokenClientConfig = Readonly<{
  url: string;
  anonKey: string;
  /** Returns the current access token (or null), issued and refreshed elsewhere. */
  accessToken: () => Promise<string | null>;
  fetch?: typeof fetch | undefined;
}>;

/**
 * A client that never manages a session: every request carries the token `accessToken`
 * returns. supabase-js builds no auth client for it, so it cannot refresh, persist or hold a
 * refresh token (`client.auth` throws). Used by the CRM page inside the JewelOS Android app's
 * WebView, where the native app is the only session holder.
 */
export function createJewelosAccessTokenClient(config: JewelosAccessTokenClientConfig): JewelosClient {
  if (!config.url || !config.anonKey) {
    throw new Error("A JewelOS Supabase client needs both a project URL and an anon key");
  }
  return createClient<Database>(config.url, config.anonKey, {
    accessToken: config.accessToken,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(config.fetch ? { global: { fetch: config.fetch } } : {}),
  });
}

let registered: JewelosClient | null = null;

/**
 * Registers the client every shared data module reads through. The web entry
 * registers its browser singleton on import; the React Native entry registers
 * a client built with encrypted device storage before the first screen renders.
 */
export function setSupabaseClient(client: JewelosClient): void {
  registered = client;
}

export function getSupabase(): JewelosClient {
  if (!registered) {
    throw new Error(
      "No Supabase client has been registered. Import @jewelos/api-client on web, or call setSupabaseClient() during native startup.",
    );
  }
  return registered;
}
