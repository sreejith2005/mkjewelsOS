// crm-port (2026-10-01, two-project design): the CRM data lives in the separate CRM Supabase
// project (docs/superpowers/specs/2026-10-01-crm-two-project-client-database-design.md).
// This module builds the CRM-project client every ported query reads through.
//
// - JewelOS remains the only login. The CRM project's crm-session-exchange function (the
//   login bridge) turns the caller's JewelOS access token into a short-lived CRM access
//   token for the caller's own CRM user. Under that token the original auth.uid()-based RLS
//   applies unchanged.
// - The client uses supabase-js's `accessToken` option, so it has no auth client of its own.
//   The browser never holds a CRM refresh token, and nothing is persisted.
// - A CRM token is reused until shortly before it expires, and only one exchange runs at a
//   time. A request the CRM project rejects with 401 re-exchanges and is retried once.
// - When the bridge refuses (no CRM access in JewelOS, not provisioned, section switched
//   off), requests go out with no session. The gate (current_crm_user_id) then resolves to
//   no CRM user, and the layout shows its original "No CRM access" screen. A refusal is
//   cached briefly, so a user without access does not call the bridge on every query.
import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export type CrmProjectConfig = Readonly<{ url: string; anonKey: string }>;

type Fetch = typeof fetch;

type Grant = { jewelosToken: string; accessToken: string; expiresAtMs: number };
type Refusal = { jewelosToken: string; untilMs: number };

/** Re-exchange this long before the CRM token's expiry. */
const EXPIRY_MARGIN_MS = 60_000;
/** How long a refused exchange is remembered for the same JewelOS token. */
const REFUSAL_TTL_MS = 30_000;

export type CrmTokenSource = {
  /** The current CRM access token, or null when there is no JewelOS session or the bridge refused. */
  token: () => Promise<string | null>;
  /** Forget the cached CRM token (after a 401, or on sign-out). */
  invalidate: () => void;
};

export function crmTokenSource(options: {
  config: CrmProjectConfig;
  jewelosAccessToken: () => Promise<string | null>;
  fetch?: Fetch;
  now?: () => number;
}): CrmTokenSource {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  const exchangeUrl = new URL("functions/v1/crm-session-exchange", withSlash(options.config.url)).href;
  let grant: Grant | null = null;
  let refusal: Refusal | null = null;
  let inflight: Promise<string | null> | null = null;

  async function exchange(jewelosToken: string): Promise<string | null> {
    try {
      const response = await doFetch(exchangeUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${jewelosToken}`, apikey: options.config.anonKey },
      });
      if (!response.ok) {
        // Only a decision (401 invalid JewelOS token, 403 no CRM access) is remembered. A server
        // error or a function still starting is retried on the next request.
        if (response.status === 401 || response.status === 403) refusal = { jewelosToken, untilMs: now() + REFUSAL_TTL_MS };
        return null;
      }
      const body = (await response.json()) as { access_token?: unknown; expires_at?: unknown };
      if (typeof body.access_token !== "string" || typeof body.expires_at !== "number") return null;
      grant = { jewelosToken, accessToken: body.access_token, expiresAtMs: body.expires_at * 1000 };
      refusal = null;
      return grant.accessToken;
    } catch {
      return null; // Network failure: try again on the next request.
    }
  }

  return {
    async token() {
      const jewelosToken = await options.jewelosAccessToken();
      if (!jewelosToken) return null;
      if (grant && grant.jewelosToken === jewelosToken && grant.expiresAtMs - EXPIRY_MARGIN_MS > now()) return grant.accessToken;
      if (refusal && refusal.jewelosToken === jewelosToken && refusal.untilMs > now()) return null;
      inflight ??= exchange(jewelosToken).finally(() => { inflight = null; });
      return inflight;
    },
    invalidate() {
      grant = null;
      refusal = null;
    },
  };
}

/** Retries a 401 from the CRM project once, with a freshly exchanged token. */
export function retryOnUnauthorized(source: CrmTokenSource, projectUrl: string, baseFetch: Fetch): Fetch {
  const projectOrigin = new URL(projectUrl).origin;
  return async (input, init) => {
    const response = await baseFetch(input, init);
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (response.status !== 401 || url.origin !== projectOrigin || url.pathname.endsWith("/crm-session-exchange")) return response;
    source.invalidate();
    const fresh = await source.token();
    if (!fresh) return response;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("Authorization", `Bearer ${fresh}`);
    return baseFetch(input instanceof Request ? input.clone() : input, { ...init, headers });
  };
}

export function createCrmProjectClient(options: { config: CrmProjectConfig; source: CrmTokenSource; fetch?: Fetch }) {
  const baseFetch = options.fetch ?? ((input, init) => fetch(input, init));
  return createClient<Database>(options.config.url, options.config.anonKey, {
    accessToken: () => options.source.token(),
    global: { fetch: retryOnUnauthorized(options.source, options.config.url, baseFetch) },
  });
}

function withSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}
