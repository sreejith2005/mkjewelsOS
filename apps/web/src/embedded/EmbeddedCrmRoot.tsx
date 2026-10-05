/**
 * The /crm route in embedded mode: the ported CRM, full-screen, inside the JewelOS Android
 * app's WebView (CRM Phase 6). The JewelOS web shell, its session-holding Supabase client and
 * its login are not used here; the native app owns the session and the navigation outside /crm.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { isCrmEmbedPath, type CrmEmbedPageMessage } from "@jewelos/core";

import { crmProjectConfig } from "@/lib/crmProject";

import { createEmbeddedCrmClient, embeddedCrmAuth } from "./embeddedCrmClient";
import { NativeTokenBroker, postToNative, type ReactNativeWebViewBridge } from "./nativeCrmBridge";

const CrmApp = lazy(() => import("@jewelos/crm-ui").then((module) => ({ default: module.CrmApp })));

/** Everything the page keeps in storage; cleared when the app signs out (no credentials are ever stored). */
async function clearPageStorage(): Promise<void> {
  try { window.localStorage.clear(); } catch { /* storage may be unavailable */ }
  try { window.sessionStorage.clear(); } catch { /* storage may be unavailable */ }
  try {
    if ("caches" in window) for (const key of await window.caches.keys()) await window.caches.delete(key);
  } catch { /* Cache API may be unavailable */ }
}

export type EmbeddedCrmRootProps = {
  bridge: ReactNativeWebViewBridge;
  supabaseUrl: string;
  supabaseAnonKey: string;
};

export function EmbeddedCrmRoot({ bridge, supabaseUrl, supabaseAnonKey }: EmbeddedCrmRootProps) {
  const post = useCallback((message: CrmEmbedPageMessage) => postToNative(bridge, message), [bridge]);
  const broker = useMemo(() => new NativeTokenBroker({ post, clearStorage: clearPageStorage }), [post]);
  const supabase = useMemo(() => createEmbeddedCrmClient({ url: supabaseUrl, anonKey: supabaseAnonKey, broker }), [broker, supabaseAnonKey, supabaseUrl]);
  // The login bridge exchanges the native app's JewelOS token for the CRM-project token.
  const jewelosAccessToken = useCallback(() => broker.getToken(), [broker]);
  const auth = useMemo(() => embeddedCrmAuth({ url: supabaseUrl, anonKey: supabaseAnonKey, broker }), [broker, supabaseAnonKey, supabaseUrl]);
  const [href, setHref] = useState(window.location.href);

  useEffect(() => {
    // The CRM keeps nothing in browser storage; whatever a previous session of this WebView may
    // have left (a sign-out clear that arrived after the app unmounted it) goes before any use.
    void clearPageStorage();
    const onMessage = (event: Event) => { if (event instanceof MessageEvent) broker.receive(event); };
    // Native messages arrive on document only (see isNativeBridgeEvent).
    document.addEventListener("message", onMessage);
    const onPopState = () => setHref(window.location.href);
    window.addEventListener("popstate", onPopState);
    post({ type: "jewelos-crm:ready" });
    return () => {
      document.removeEventListener("message", onMessage);
      window.removeEventListener("popstate", onPopState);
    };
  }, [broker, post]);

  // Inside /crm the page navigates itself; anything else (the "← JewelOS" link, a JewelOS path)
  // belongs to the native app, which switches to its Home tab.
  const navigate = useCallback((target: string) => {
    const next = new URL(target, window.location.origin);
    if (next.origin !== window.location.origin || !isCrmEmbedPath(next.pathname)) {
      post({ type: "jewelos-crm:home" });
      return;
    }
    const path = `${next.pathname}${next.search}`;
    if (path !== `${window.location.pathname}${window.location.search}`) window.history.pushState({}, "", path);
    setHref(next.href);
  }, [post]);

  const onSignOut = useCallback(() => {
    broker.clear();
    post({ type: "jewelos-crm:sign-out" });
  }, [broker, post]);

  const url = new URL(href);
  return <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-gold">Loading…</div>}>
    <CrmApp auth={auth} crmProject={crmProjectConfig} jewelosAccessToken={jewelosAccessToken} jewelosHomePath="/" navigate={navigate} onSignOut={onSignOut} path={url.pathname} search={url.search} supabase={supabase} />
  </Suspense>;
}
