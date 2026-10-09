/**
 * The CRM tab (CRM Phase 6): the JewelOS web `/crm` route - the ported original CRM - in an
 * in-app WebView, already signed in, identical to the web at phone width.
 *
 * Exception to the playbook's "no WebView" rule, by owner decision (2026-09-25): the CRM must
 * be identical to the original, and the web route is that port. Everything else stays native.
 * Bridge rules and threat model: ./crmWebViewBridge.ts and
 * docs/superpowers/specs/2026-09-25-crm-native-integration-design.md ("Mobile WebView").
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Linking, StyleSheet, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";
import { CRM_EMBED_USER_AGENT_TOKEN } from "@jewelos/core";
import { useAuth } from "@/auth/AuthProvider";
import { env } from "@/config/env";
import { log } from "@/lib/log";
import { supabase } from "@/lib/supabase";
import type { TabParamList } from "@/navigation/types";
import { Screen } from "@/ui/Screen";
import { ErrorState, LoadingState } from "@/ui/states";
import { createNativeCrmBridge, crmStartUrl, type NativeSessionToken } from "./crmWebViewBridge";

/**
 * The original CRM's own colours (globals.css: page `--background`, `.crm-mobile-header`), the
 * approved CRM palette exception: the page behind a slow load, and the status-bar strip above
 * the CRM's header.
 */
const CRM_BACKGROUND = "#eee9de";
const CRM_HEADER = "#24211c";

const toToken = (session: { access_token: string; expires_at?: number | undefined } | null): NativeSessionToken | null =>
  session ? { accessToken: session.access_token, expiresAt: session.expires_at ?? null } : null;

type LoadState = "loading" | "ready" | "error";

function openOutside(url: string) {
  void Linking.openURL(url).catch((error: unknown) => log.error("navigation", "could not open a CRM link outside the app", error));
}

function CrmWebView({ origin, userId, initialPath }: { origin: string; userId: string; initialPath: string }) {
  const navigation = useNavigation<BottomTabNavigationProp<TabParamList>>();
  const { logout } = useAuth();
  const insets = useSafeAreaInsets();
  const webView = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [attempt, setAttempt] = useState(0);

  const clearWebView = useCallback(() => {
    // Cache, history and form data of this WebView; cookies are removed whenever a WebView is
    // created (incognito); the page clears its own storage on the bridge's clear message.
    webView.current?.clearCache?.(true);
    webView.current?.clearHistory?.();
    webView.current?.clearFormData?.();
  }, []);

  const bridge = useMemo(() => createNativeCrmBridge({
    origin,
    currentToken: async () => toToken((await supabase.auth.getSession()).data.session),
    refreshToken: async () => toToken((await supabase.auth.refreshSession()).data.session),
    send: (raw) => webView.current?.postMessage(raw),
    onHome: () => navigation.navigate("Home"),
    onSignOutRequested: () => { void logout(); },
    onCleared: () => log.debug("auth", "CRM page storage cleared"),
  }), [logout, navigation, origin]);

  // The app refreshes its session on its own schedule; the page gets each new access token.
  // On sign-out the page is told to forget its token and wipe its storage, and the WebView's
  // cache is cleared, before the signed-out app unmounts it.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || (session && session.user.id !== userId)) {
        bridge.requestClear();
        clearWebView();
        return;
      }
      if (event === "TOKEN_REFRESHED") bridge.pushToken(toToken(session));
    });
    return () => data.subscription.unsubscribe();
  }, [bridge, clearWebView, userId]);

  // Android back walks the WebView's history first, then leaves the tab.
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canGoBack.current) return false;
      webView.current?.goBack();
      return true;
    });
    return () => subscription.remove();
  }, []));

  const onShouldStartLoadWithRequest = useCallback((request: ShouldStartLoadRequest) => {
    const decision = bridge.navigation(request.url);
    if (decision === "allow") return true;
    if (decision === "dial" || decision === "external") openOutside(request.url);
    else log.warn("navigation", "blocked a CRM WebView navigation");
    return false;
  }, [bridge]);

  const onNavigationStateChange = useCallback((state: WebViewNavigation) => {
    canGoBack.current = state.canGoBack;
    bridge.pageLoaded(state.url);
  }, [bridge]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    void bridge.handleMessage(event.nativeEvent.data, event.nativeEvent.url).then((result) => {
      if (result === "rejected") log.warn("auth", "ignored a CRM WebView message from an unexpected origin or shape");
    });
  }, [bridge]);

  if (loadState === "error") {
    return (
      <Screen>
        <ErrorState
          message="The CRM could not be loaded. Check your internet connection and try again."
          onRetry={() => { setLoadState("loading"); setAttempt((value) => value + 1); }}
          title="CRM unavailable"
        />
      </Screen>
    );
  }

  return (
    <View style={[styles.frame, { paddingTop: insets.top }]}>
      <WebView
        applicationNameForUserAgent={CRM_EMBED_USER_AGENT_TOKEN}
        allowFileAccess={false}
        allowsBackForwardNavigationGestures={false}
        geolocationEnabled={false}
        incognito
        javaScriptCanOpenWindowsAutomatically={false}
        key={`${userId}:${attempt}`}
        mixedContentMode="never"
        onError={() => setLoadState("error")}
        onHttpError={(event) => { if (event.nativeEvent.statusCode >= 500) setLoadState("error"); }}
        onLoadEnd={(event) => { bridge.pageLoaded(event.nativeEvent.url); setLoadState((state) => (state === "loading" ? "ready" : state)); }}
        onMessage={onMessage}
        onNavigationStateChange={onNavigationStateChange}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        originWhitelist={["*"]}
        ref={webView}
        setSupportMultipleWindows={false}
        source={{ uri: crmStartUrl(origin, initialPath) }}
        style={styles.fill}
        textZoom={100}
        webviewDebuggingEnabled={__DEV__}
      />
      {loadState === "loading" ? <View style={styles.overlay}><LoadingState label="Opening CRM..." /></View> : null}
    </View>
  );
}

/** The CRM tab. The section gate (crm.view, section switch) is applied by the tab shell. */
export function CrmWebViewScreen({initialPath="/crm"}: {initialPath?:string}={}) {
  const { session } = useAuth();
  const origin = env.jewelosWebOrigin;
  if (!origin) {
    return (
      <Screen>
        <ErrorState
          message="This build of JewelOS has no web address for the CRM. Ask your administrator for an updated app."
          title="CRM not configured"
        />
      </Screen>
    );
  }
  // A new signed-in user gets a new WebView (and a signed-out app has none).
  return session ? <CrmWebView key={session.user.id} origin={origin} userId={session.user.id} initialPath={initialPath} /> : null;
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: CRM_HEADER },
  fill: { flex: 1, backgroundColor: CRM_BACKGROUND },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: CRM_BACKGROUND },
});
