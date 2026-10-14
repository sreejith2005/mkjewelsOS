import { fetch as expoFetch } from "expo/fetch";
import { createJewelosAccessTokenClient, type JewelosClient } from "@jewelos/api-client/client";
import { env } from "@/config/env";
import { supabase } from "@/lib/supabase";

/**
 * Set false to answer every question through the JSON contract (one piece, no
 * live words) if streaming proves unreliable on employees' phones.
 */
export const KIARA_NATIVE_STREAMING = true;

let client: JewelosClient | null = null;

/**
 * A function-only client for Ask Kiara's answer stream. React Native's own
 * fetch buffers the whole response; expo/fetch exposes the body as a stream.
 * It carries the signed-in user's current access token from the app's one
 * session holder and never stores or refreshes a session itself. Every other
 * request (RPCs, uploads, voice) keeps using the normal client.
 */
export function kiaraStreamClient(): JewelosClient | null {
  if (!KIARA_NATIVE_STREAMING) return null;
  client ??= createJewelosAccessTokenClient({
    url: env.supabaseUrl,
    anonKey: env.supabaseAnonKey,
    accessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
    // expo/fetch implements the WHATWG fetch contract; its types differ only in Expo's own Request class.
    fetch: expoFetch as unknown as typeof fetch,
  });
  return client;
}
