/**
 * Native side of the CRM WebView bridge (CRM Phase 6). The CRM tab shows the JewelOS web `/crm`
 * route in a WebView; this app stays the only holder and refresher of the session.
 *
 * Rules (protocol and allowlist shared with the web page in @jewelos/core crmEmbed):
 *   - a page message is accepted only when the frame that sent it is on the JewelOS web origin;
 *   - the current ACCESS token is sent only while the WebView's page is on that origin, only
 *     through the bridge, never in a URL, and never with the refresh token;
 *   - when the page reports a rejected token, this app refreshes the session itself;
 *   - navigation leaves the WebView for anything outside `<origin>/crm`.
 * Pure: no React Native import, so it is unit-tested under Node.
 */
import {
  crmEmbedNavigation,
  httpOrigin,
  parseCrmEmbedPageMessage,
  serializeCrmEmbedMessage,
  type CrmEmbedNavigation,
  type CrmEmbedPageMessage,
} from "@jewelos/core";

export type NativeSessionToken = Readonly<{ accessToken: string; expiresAt: number | null }>;

export type NativeCrmBridgeDeps = Readonly<{
  /** The configured JewelOS web origin, e.g. https://jewelos.example.com. */
  origin: string;
  /** The app's current session (may refresh when it has expired, as supabase-js getSession does). */
  currentToken: () => Promise<NativeSessionToken | null>;
  /** Forces a refresh of the app's session after the page reported a rejected token. */
  refreshToken: () => Promise<NativeSessionToken | null>;
  /** Delivers a native message to the page (WebView postMessage). */
  send: (raw: string) => void;
  onHome: () => void;
  onSignOutRequested: () => void;
  onCleared: () => void;
}>;

export type NativeCrmBridge = Readonly<{
  /** Records the URL of the page the WebView has loaded (navigation state / load end). */
  pageLoaded: (url: string) => void;
  /** Handles one message event: its data and the URL/origin react-native-webview reports for the sender. */
  handleMessage: (data: string, senderUrl: string) => Promise<"accepted" | "rejected">;
  /** Pushes a token the app refreshed on its own (TOKEN_REFRESHED). */
  pushToken: (token: NativeSessionToken | null) => void;
  /** Asks the page to forget its token and clear its storage (sign-out / account switch). */
  requestClear: () => void;
  /** The allowlist decision for a navigation request. */
  navigation: (url: string) => CrmEmbedNavigation;
}>;

export function createNativeCrmBridge(deps: NativeCrmBridgeDeps): NativeCrmBridge {
  let loadedOrigin: string | null = null;
  let clearing = false;

  const sendToken = (token: NativeSessionToken | null) => {
    // Only a page on the JewelOS origin ever receives a token.
    if (!token || clearing || loadedOrigin !== deps.origin) return;
    deps.send(serializeCrmEmbedMessage({ type: "jewelos-crm:token", accessToken: token.accessToken, expiresAt: token.expiresAt }));
  };

  const handle = async (message: CrmEmbedPageMessage) => {
    switch (message.type) {
      case "jewelos-crm:ready":
        sendToken(await deps.currentToken());
        return;
      case "jewelos-crm:token-request":
        sendToken(message.reason === "unauthorized" ? await deps.refreshToken() : await deps.currentToken());
        return;
      case "jewelos-crm:home":
        deps.onHome();
        return;
      case "jewelos-crm:sign-out":
        deps.onSignOutRequested();
        return;
      case "jewelos-crm:cleared":
        deps.onCleared();
        return;
    }
  };

  return {
    pageLoaded: (url) => {
      loadedOrigin = httpOrigin(url);
    },
    handleMessage: async (data, senderUrl) => {
      if (httpOrigin(senderUrl) !== deps.origin) return "rejected";
      const message = parseCrmEmbedPageMessage(data);
      if (!message) return "rejected";
      // The sender is on the origin, so the page is too (a message proves the page that sent it).
      loadedOrigin = deps.origin;
      await handle(message);
      return "accepted";
    },
    pushToken: sendToken,
    requestClear: () => {
      clearing = true;
      if (loadedOrigin === deps.origin) deps.send(serializeCrmEmbedMessage({ type: "jewelos-crm:clear" }));
    },
    navigation: (url) => crmEmbedNavigation(url, deps.origin),
  };
}

/** The first URL the CRM tab opens. */
export function crmStartUrl(origin: string, initialPath = "/crm"): string {
  const url = new URL(initialPath, origin);
  if (url.origin !== new URL(origin).origin || !(url.pathname === "/crm" || url.pathname.startsWith("/crm/"))) return `${origin}/crm`;
  return url.href;
}
