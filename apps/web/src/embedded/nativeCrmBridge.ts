/**
 * Web side of the JewelOS Android app's CRM WebView bridge (CRM Phase 6). The protocol, the
 * message validation and the navigation allowlist are shared with the app in @jewelos/core
 * (crmEmbed). Design and threat model: docs/superpowers/specs/2026-09-25-crm-native-integration-design.md.
 *
 * The page never refreshes a session and never sees a refresh token. It holds only the native
 * app's current access token, in memory, and asks the app for a new one when it is missing,
 * about to expire, or rejected (401).
 */
import {
  crmEmbedTokenIsFresh,
  CRM_EMBED_USER_AGENT_TOKEN,
  isCrmEmbedPath,
  parseCrmEmbedNativeMessage,
  serializeCrmEmbedMessage,
  type CrmEmbedPageMessage,
  type CrmEmbedTokenRequestReason,
} from "@jewelos/core";

/** What react-native-webview injects into the page. */
export type ReactNativeWebViewBridge = { postMessage: (message: string) => void };

type BridgeWindow = Pick<Window, "location" | "navigator"> & { ReactNativeWebView?: ReactNativeWebViewBridge | undefined };

/**
 * Embedded mode: a /crm page loaded inside the JewelOS app's WebView. The user-agent token only
 * selects the mode; without the native bridge object there is no embedded mode, and without a
 * token from that bridge there is no access.
 */
export function isEmbeddedCrmPage(win: BridgeWindow): boolean {
  return isCrmEmbedPath(win.location.pathname)
    && win.navigator.userAgent.includes(CRM_EMBED_USER_AGENT_TOKEN)
    && typeof win.ReactNativeWebView?.postMessage === "function";
}

/**
 * Only the native bridge may talk to the page. react-native-webview delivers native messages by
 * dispatching a synthetic MessageEvent on `document` with no source window and an empty origin.
 * A message from any other window (an opener, a frame) is delivered to `window`, is trusted, and
 * carries that window and its origin, so it never passes this check.
 */
export function isNativeBridgeEvent(event: MessageEvent): boolean {
  return event.source === null && event.origin === "" && !event.isTrusted;
}

export type TokenBrokerOptions = {
  post: (message: CrmEmbedPageMessage) => void;
  now?: () => number;
  /** How long a request for a token waits before giving up (the request then runs without one and is denied). */
  timeoutMs?: number;
  /** Clears the page's own storage when native signs out, before it confirms. */
  clearStorage?: () => Promise<void> | void;
};

type Token = { accessToken: string; expiresAt: number | null };
type Waiter = { notEqual: string | null; resolve: (token: string | null) => void; timer: ReturnType<typeof setTimeout> };

export class NativeTokenBroker {
  private token: Token | null = null;
  private waiters: Waiter[] = [];
  private cleared = false;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(private readonly options: TokenBrokerOptions) {
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /** Handles one `message` event from `document`; returns whether it was accepted. */
  receive(event: MessageEvent): boolean {
    if (!isNativeBridgeEvent(event)) return false;
    const message = parseCrmEmbedNativeMessage(event.data);
    if (!message) return false;
    if (message.type === "jewelos-crm:clear") {
      this.clear();
      void Promise.resolve(this.options.clearStorage?.()).catch(() => undefined).finally(() => this.options.post({ type: "jewelos-crm:cleared" }));
      return true;
    }
    if (this.cleared) return false;
    this.token = { accessToken: message.accessToken, expiresAt: message.expiresAt };
    const pending = this.waiters;
    this.waiters = [];
    for (const waiter of pending) {
      if (waiter.notEqual !== null && waiter.notEqual === message.accessToken) {
        this.waiters.push(waiter);
        continue;
      }
      clearTimeout(waiter.timer);
      waiter.resolve(message.accessToken);
    }
    return true;
  }

  /** The current token, or a fresh one from native when it is missing or about to expire. */
  async getToken(): Promise<string | null> {
    if (this.cleared) return null;
    if (this.token && crmEmbedTokenIsFresh(this.token.expiresAt, this.now())) return this.token.accessToken;
    return this.request(this.token ? "expired" : "missing", null);
  }

  /** After a 401 with `rejected`: a different token, from native if needed. */
  async tokenAfterRejection(rejected: string | null): Promise<string | null> {
    if (this.cleared) return null;
    if (this.token && this.token.accessToken !== rejected && crmEmbedTokenIsFresh(this.token.expiresAt, this.now())) return this.token.accessToken;
    return this.request("unauthorized", rejected);
  }

  /** Forgets the token and refuses further ones (native signed out). */
  clear(): void {
    this.cleared = true;
    this.token = null;
    const pending = this.waiters;
    this.waiters = [];
    for (const waiter of pending) {
      clearTimeout(waiter.timer);
      waiter.resolve(null);
    }
  }

  private request(reason: CrmEmbedTokenRequestReason, notEqual: string | null): Promise<string | null> {
    return new Promise((resolve) => {
      const waiter: Waiter = {
        notEqual,
        resolve,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((candidate) => candidate !== waiter);
          resolve(null);
        }, this.timeoutMs),
      };
      // Concurrent requests for a first/renewed token share one question; a rejected token
      // always asks again, because native must then refresh rather than resend.
      const alreadyAsked = this.waiters.length > 0 && reason !== "unauthorized";
      this.waiters.push(waiter);
      if (!alreadyAsked) this.options.post({ type: "jewelos-crm:token-request", reason });
    });
  }
}

/** Sends one page message to native. */
export function postToNative(bridge: ReactNativeWebViewBridge, message: CrmEmbedPageMessage): void {
  bridge.postMessage(serializeCrmEmbedMessage(message));
}
