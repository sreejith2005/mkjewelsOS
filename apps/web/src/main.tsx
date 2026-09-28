import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { isEmbeddedCrmPage, type ReactNativeWebViewBridge } from "./embedded/nativeCrmBridge";
import "./index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element was not found");
}

const root = ReactDOM.createRoot(rootElement);
const embeddedWindow = window as Window & { ReactNativeWebView?: ReactNativeWebViewBridge };
const nativeBridge = isEmbeddedCrmPage(embeddedWindow) ? embeddedWindow.ReactNativeWebView : undefined;

if (nativeBridge) {
  // /crm inside the JewelOS Android app's WebView: the native app holds the session (CRM Phase 6).
  void import("./embedded/EmbeddedCrmRoot").then(({ EmbeddedCrmRoot }) => {
    root.render(
      <React.StrictMode>
        <EmbeddedCrmRoot
          bridge={nativeBridge}
          supabaseAnonKey={import.meta.env.VITE_SUPABASE_ANON_KEY ?? ""}
          supabaseUrl={import.meta.env.VITE_SUPABASE_URL ?? ""}
        />
      </React.StrictMode>,
    );
  });
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
