/**
 * The bridge between the JewelOS Android app and the web CRM (`/crm`) running inside the
 * app's WebView (CRM Phase 6). Both sides use these definitions; neither copies them.
 *
 * Security model (design: docs/superpowers/specs/2026-09-25-crm-native-integration-design.md,
 * "Mobile WebView"):
 *   - the native app is the only holder and refresher of the session; the page receives only
 *     the current ACCESS token, in memory, through the native bridge, and never the refresh
 *     token; no token is ever put in a URL, cookie, storage or log;
 *   - native accepts page messages only from the JewelOS web origin and keeps the WebView on
 *     `<origin>/crm` and below; everything else leaves for the system browser or dialer;
 *   - the page accepts native messages only from the native bridge (see `isNativeBridgeEvent`).
 */

export const CRM_EMBED_PROTOCOL_VERSION = 1;
/** Appended to the WebView user agent. It selects embedded mode; it grants nothing by itself. */
export const CRM_EMBED_USER_AGENT_TOKEN = "JewelOSCrmEmbed/1";
export const CRM_EMBED_BASE_PATH = "/crm";

/** Page -> native. */
export type CrmEmbedPageMessage =
  | Readonly<{ type: "jewelos-crm:ready" }>
  | Readonly<{ type: "jewelos-crm:token-request"; reason: CrmEmbedTokenRequestReason }>
  | Readonly<{ type: "jewelos-crm:home" }>
  | Readonly<{ type: "jewelos-crm:sign-out" }>
  | Readonly<{ type: "jewelos-crm:cleared" }>;

export type CrmEmbedTokenRequestReason = "missing" | "expired" | "unauthorized";

/** Native -> page. `expiresAt` is the access token's expiry in epoch seconds, as Supabase reports it. */
export type CrmEmbedNativeMessage =
  | Readonly<{ type: "jewelos-crm:token"; accessToken: string; expiresAt: number | null }>
  | Readonly<{ type: "jewelos-crm:clear" }>;

const REASONS: readonly CrmEmbedTokenRequestReason[] = ["missing", "expired", "unauthorized"];
const MAX_MESSAGE_LENGTH = 16_384;
const MAX_TOKEN_LENGTH = 8_192;
/** A compact JWS: three base64url segments. The server verifies it; this only rejects junk. */
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function serializeCrmEmbedMessage(message: CrmEmbedPageMessage | CrmEmbedNativeMessage): string {
  return JSON.stringify({ v: CRM_EMBED_PROTOCOL_VERSION, ...message });
}

function parseEnvelope(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_MESSAGE_LENGTH) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return record.v === CRM_EMBED_PROTOCOL_VERSION && typeof record.type === "string" ? record : null;
}

/** Native side: a page message, or null for anything malformed or unknown. */
export function parseCrmEmbedPageMessage(raw: unknown): CrmEmbedPageMessage | null {
  const record = parseEnvelope(raw);
  if (!record) return null;
  switch (record.type) {
    case "jewelos-crm:ready":
    case "jewelos-crm:home":
    case "jewelos-crm:sign-out":
    case "jewelos-crm:cleared":
      return { type: record.type };
    case "jewelos-crm:token-request":
      return REASONS.includes(record.reason as CrmEmbedTokenRequestReason)
        ? { type: record.type, reason: record.reason as CrmEmbedTokenRequestReason }
        : null;
    default:
      return null;
  }
}

/** Page side: a native message, or null for anything malformed or unknown. */
export function parseCrmEmbedNativeMessage(raw: unknown): CrmEmbedNativeMessage | null {
  const record = parseEnvelope(raw);
  if (!record) return null;
  if (record.type === "jewelos-crm:clear") return { type: record.type };
  if (record.type !== "jewelos-crm:token") return null;
  const { accessToken, expiresAt } = record;
  if (typeof accessToken !== "string" || accessToken.length > MAX_TOKEN_LENGTH || !JWT_SHAPE.test(accessToken)) return null;
  if (expiresAt !== null && (typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= 0)) return null;
  return { type: record.type, accessToken, expiresAt };
}

/**
 * The origin (`scheme://host[:port]`) of an http(s) URL, or null. The configured JewelOS web
 * origin must be https in a release build; http is allowed only for a local debug stack.
 */
export function httpOrigin(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password) return null;
  return parsed.origin;
}

export function isCrmEmbedPath(pathname: string): boolean {
  return pathname === CRM_EMBED_BASE_PATH || pathname.startsWith(`${CRM_EMBED_BASE_PATH}/`);
}

/**
 * What the WebView does with a navigation request:
 *   allow    - load it in the WebView (only `<origin>/crm` and below)
 *   dial     - hand a `tel:` link to the phone's dialer
 *   external - open in the system browser (other https/http pages, JewelOS pages outside /crm,
 *              mail and messaging links)
 *   block    - drop it (script, data, file, blob, intent and every other scheme)
 */
export type CrmEmbedNavigation = "allow" | "dial" | "external" | "block";

export function crmEmbedNavigation(url: string, jewelosOrigin: string): CrmEmbedNavigation {
  if (url === "about:blank") return "allow";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "block";
  }
  switch (parsed.protocol) {
    case "tel:":
      return "dial";
    case "mailto:":
    case "sms:":
      return "external";
    case "https:":
    case "http:":
      if (parsed.username || parsed.password) return "block";
      return parsed.origin === jewelosOrigin && isCrmEmbedPath(parsed.pathname) ? "allow" : "external";
    default:
      return "block";
  }
}

/** Seconds of validity a token must still have to be used without asking native for a fresh one. */
export const CRM_EMBED_TOKEN_MIN_REMAINING_SECONDS = 60;

export function crmEmbedTokenIsFresh(expiresAt: number | null, nowMs: number): boolean {
  return expiresAt === null || expiresAt * 1000 - nowMs > CRM_EMBED_TOKEN_MIN_REMAINING_SECONDS * 1000;
}
