/**
 * The whole app: the JewelOS web app, full screen, in one WebView. See ./webShellBridge.ts for
 * the rules (navigation allowlist, accepted messages) and why the app holds no session.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, BackHandler, Keyboard, KeyboardAvoidingView, Linking, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import type { ShouldStartLoadRequest, WebViewOpenWindowEvent } from "react-native-webview/lib/WebViewTypes";
import { env } from "@/config/env";
import { errorText, log } from "@/lib/log";
import { NetworkBanner } from "@/lib/NetworkBanner";
import { useAppTheme, useTheme } from "@/theme/ThemeProvider";
import { ErrorState, LoadingState } from "@/ui/states";
import { saveWebDownload } from "./saveDownload";
import {
  WEB_SHELL_USER_AGENT_TOKEN,
  incomingWebPath,
  isFromWebOrigin,
  parseWebShellMessage,
  statusBarStyleFor,
  webShellInjectedScript,
  webShellNavigation,
} from "./webShellBridge";

type LoadState = "loading" | "ready" | "error";

function openOutside(url: string) {
  void Linking.openURL(url).catch((error: unknown) => log.error("navigation", "could not open a link outside the app", error));
}

function WebApp({ origin }: { origin: string }) {
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { setTheme } = useTheme();
  const webView = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const [startUrl, setStartUrl] = useState(`${origin}/`);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [attempt, setAttempt] = useState(0);
  const [topColour, setTopColour] = useState<string | null>(null);
  const [bottomColour, setBottomColour] = useState<string | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const injectedScript = useMemo(webShellInjectedScript, []);

  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () => setKeyboardOpen(true));
    const hidden = Keyboard.addListener("keyboardDidHide", () => setKeyboardOpen(false));
    return () => { shown.remove(); hidden.remove(); };
  }, []);

  const open = useCallback((path: string) => {
    const url = `${origin}${path}`;
    if (loadState === "ready" && webView.current) webView.current.injectJavaScript(`window.location.assign(${JSON.stringify(url)}); true;`);
    else setStartUrl(url);
  }, [loadState, origin]);

  // A jewelos:// link or a link to the web origin opens that page inside the app.
  useEffect(() => {
    void Linking.getInitialURL().then((url) => {
      const path = url ? incomingWebPath(url, origin) : null;
      if (path) setStartUrl(`${origin}${path}`);
    });
  }, [origin]);
  useEffect(() => {
    const subscription = Linking.addEventListener("url", ({ url }) => {
      const path = incomingWebPath(url, origin);
      if (path) open(path);
    });
    return () => subscription.remove();
  }, [open, origin]);

  // Android back walks the page's history first; on the first page it leaves the app as usual.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canGoBack.current || !webView.current) return false;
      webView.current.goBack();
      return true;
    });
    return () => subscription.remove();
  }, []);

  const onShouldStartLoadWithRequest = useCallback((request: ShouldStartLoadRequest) => {
    const decision = webShellNavigation(request.url, origin, request.isTopFrame);
    if (decision === "allow") return true;
    if (decision === "outside") openOutside(request.url);
    else log.warn("navigation", "blocked a WebView navigation");
    return false;
  }, [origin]);

  // window.open (signed file links, external pages): the app never opens a second WebView.
  const onOpenWindow = useCallback((event: WebViewOpenWindowEvent) => {
    const { targetUrl } = event.nativeEvent;
    const decision = webShellNavigation(targetUrl, origin);
    if (decision === "outside") openOutside(targetUrl);
    else if (decision === "allow") webView.current?.injectJavaScript(`window.location.assign(${JSON.stringify(targetUrl)}); true;`);
    else log.warn("navigation", "blocked a WebView window");
  }, [origin]);

  const onNavigationStateChange = useCallback((state: WebViewNavigation) => {
    canGoBack.current = state.canGoBack;
  }, []);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    if (!isFromWebOrigin(event.nativeEvent.url, origin)) {
      log.warn("navigation", "ignored a WebView message from outside the web origin");
      return;
    }
    const message = parseWebShellMessage(event.nativeEvent.data);
    if (!message) return;
    switch (message.kind) {
      case "theme":
        setTheme(message.theme);
        setTopColour(message.barColour);
        setBottomColour(message.bottomColour);
        return;
      case "download":
        void saveWebDownload(message).catch((error: unknown) => {
          log.error("navigation", "could not save a downloaded file", error);
          Alert.alert("Download failed", errorText(error));
        });
        return;
      case "download-failed":
        Alert.alert("Download failed", message.reason === "too-large" ? "This file is too large to save from the app. Download it from JewelOS on a computer." : "The file could not be read. Try again.");
        return;
    }
  }, [origin, setTheme]);

  const reload = useCallback(() => {
    setLoadState("loading");
    setAttempt((value) => value + 1);
  }, []);

  if (loadState === "error") {
    return (
      <View style={[styles.fill, { backgroundColor: theme.colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <StatusBar style={statusBarStyleFor(theme.colors.background)} />
        <ErrorState
          message="JewelOS could not be reached. Check your internet connection and try again."
          onRetry={reload}
          title="No connection"
        />
      </View>
    );
  }

  const top = topColour ?? theme.colors.background;
  const bottom = bottomColour ?? theme.colors.background;
  // The app draws edge to edge, so Android may not shrink it for the keyboard. The avoiding view
  // pads by the measured overlap only, which is zero where the system already made room; the
  // gesture-bar strip goes while the keyboard covers it.
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.fill, { backgroundColor: top, paddingTop: insets.top }]}>
      <StatusBar style={statusBarStyleFor(top)} />
      <NetworkBanner />
      <WebView
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        allowsBackForwardNavigationGestures={false}
        applicationNameForUserAgent={WEB_SHELL_USER_AGENT_TOKEN}
        cacheEnabled
        domStorageEnabled
        geolocationEnabled={false}
        injectedJavaScriptBeforeContentLoaded={injectedScript}
        javaScriptCanOpenWindowsAutomatically
        key={attempt}
        mixedContentMode="never"
        onError={() => setLoadState("error")}
        onHttpError={(event) => { if (event.nativeEvent.statusCode >= 500) setLoadState("error"); }}
        onLoadEnd={() => setLoadState((state) => (state === "loading" ? "ready" : state))}
        onMessage={onMessage}
        onNavigationStateChange={onNavigationStateChange}
        onOpenWindow={onOpenWindow}
        // Android stopped the page's renderer (low memory): start the page again.
        onRenderProcessGone={() => { log.warn("navigation", "the WebView renderer stopped; reloading"); reload(); }}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        originWhitelist={["https://*", "http://*", "about:*", "tel:*", "mailto:*", "sms:*", "smsto:*", "whatsapp:*", "geo:*", "intent:*", "upi:*"]}
        overScrollMode="content"
        ref={webView}
        setBuiltInZoomControls={false}
        setSupportMultipleWindows
        source={{ uri: startUrl }}
        style={[styles.fill, { backgroundColor: bottom }]}
        textZoom={100}
        thirdPartyCookiesEnabled={false}
        webviewDebuggingEnabled={__DEV__}
      />
      <View style={{ height: keyboardOpen ? 0 : insets.bottom, backgroundColor: bottom }} />
      {loadState === "loading" ? (
        <View style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
          <LoadingState label="Opening JewelOS..." />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

/** The app's only screen. */
export function WebAppScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const origin = env.jewelosWebOrigin;
  if (!origin) {
    return (
      <View style={[styles.fill, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
        <ErrorState
          message="This build of JewelOS has no web address. Ask your administrator for an updated app."
          title="JewelOS not configured"
        />
      </View>
    );
  }
  return <WebApp origin={origin} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { justifyContent: "center" },
});
