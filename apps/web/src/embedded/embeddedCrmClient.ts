/**
 * The Supabase client of the embedded CRM page (JewelOS Android app WebView, CRM Phase 6).
 *
 * It uses supabase-js's `accessToken` option, fed with the native app's current access token.
 * With that option supabase-js builds no auth client at all: nothing here can refresh, persist
 * or even hold a refresh token. A request rejected with 401 asks native for a new token and is
 * retried once with it.
 */
// The ./client subpath, not the package root: the root module creates the browser's
// session-holding client, which the embedded page must not use.
import { createJewelosAccessTokenClient, type JewelosClient } from "@jewelos/api-client/client";
import type { CrmAuth } from "@jewelos/crm-ui";

import type { NativeTokenBroker } from "./nativeCrmBridge";

type Fetch = typeof fetch;

function bearer(headers: Headers): string | null {
  const value = headers.get("Authorization");
  return value?.startsWith("Bearer ") ? value.slice("Bearer ".length) : null;
}

/** Retries a 401 once with a different token from native. Only for requests to the Supabase project. */
export function retryUnauthorizedFetch(broker: NativeTokenBroker, supabaseUrl: string, baseFetch: Fetch = fetch): Fetch {
  const projectOrigin = new URL(supabaseUrl).origin;
  return async (input, init) => {
    const response = await baseFetch(input, init);
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (response.status !== 401 || url.origin !== projectOrigin) return response;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const rejected = bearer(headers);
    const fresh = await broker.tokenAfterRejection(rejected);
    if (!fresh || fresh === rejected) return response;
    headers.set("Authorization", `Bearer ${fresh}`);
    return baseFetch(input instanceof Request ? input.clone() : input, { ...init, headers });
  };
}

export function createEmbeddedCrmClient(options: { url: string; anonKey: string; broker: NativeTokenBroker; fetch?: Fetch }): JewelosClient {
  return createJewelosAccessTokenClient({
    url: options.url,
    anonKey: options.anonKey,
    accessToken: () => options.broker.getToken(),
    fetch: retryUnauthorizedFetch(options.broker, options.url, options.fetch),
  });
}

/**
 * supabase.auth.getUser() for the ported CRM: the same GoTrue call supabase-js makes, with the
 * native access token, so the server still validates the token.
 */
export function embeddedCrmAuth(options: { url: string; anonKey: string; broker: NativeTokenBroker; fetch?: Fetch }): CrmAuth {
  const request = retryUnauthorizedFetch(options.broker, options.url, options.fetch);
  return {
    async getUser() {
      const token = await options.broker.getToken();
      if (!token) return { data: { user: null }, error: new Error("No JewelOS session in the app") };
      try {
        const response = await request(new URL("auth/v1/user", options.url.endsWith("/") ? options.url : `${options.url}/`).href, {
          headers: { apikey: options.anonKey, Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return { data: { user: null }, error: new Error(`Auth user request failed (${response.status})`) };
        const user = (await response.json()) as { id?: unknown; email?: unknown };
        if (typeof user.id !== "string") return { data: { user: null }, error: new Error("Auth user response has no id") };
        return { data: { user: { id: user.id, email: typeof user.email === "string" ? user.email : undefined } }, error: null };
      } catch (error) {
        return { data: { user: null }, error };
      }
    },
  };
}
