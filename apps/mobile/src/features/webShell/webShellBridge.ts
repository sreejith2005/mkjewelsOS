/**
 * Native side of the JewelOS web shell: the app shows the JewelOS web app (the same build that is
 * deployed to the web origin) full screen in one WebView, so the app and the web never differ.
 * Owner decision 2026-10-15, replacing the per-screen native rewrite.
 *
 * The page owns its own sign-in and session (web storage persisted by the WebView). The app holds
 * no session and no token; it only:
 *   - keeps top-level navigation on the configured web origin and opens everything else outside;
 *   - saves files the page builds in memory (blob:/data: downloads), which a WebView cannot save;
 *   - follows the page's theme for the status-bar strip and its own dialogs.
 * Messages are accepted only from a page on the web origin, and only in the shapes below.
 * Pure: no React Native import, so it is unit-tested under Node.
 */

/** Added to the WebView user agent, so the web can tell it is inside the app. */
export const WEB_SHELL_USER_AGENT_TOKEN = "JewelOSApp/1";

/** Namespace of every page -> app message. */
export const WEB_SHELL_MESSAGE_NAMESPACE = "jewelos-shell/1";

/** Largest file the page may hand to the app for saving (bytes, before base64). */
export const WEB_SHELL_MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;

/** Schemes that belong to another app on the phone (dialer, mail, SMS, WhatsApp, maps, ...). */
const OUTSIDE_APP_SCHEMES = new Set(["tel:", "mailto:", "sms:", "smsto:", "whatsapp:", "geo:", "intent:", "upi:"]);

export type WebShellNavigation = "allow" | "outside" | "block";

/**
 * What to do with a navigation of the WebView. Only the top frame is decided here: the app keeps
 * that frame on the web origin. A sub-frame may load https or an inert document only.
 */
export function webShellNavigation(rawUrl: string, origin: string, isTopFrame = true): WebShellNavigation {
  if (rawUrl === "about:blank") return "allow";
  let url: URL;
  try { url = new URL(rawUrl); } catch { return "block"; }
  if (!isTopFrame) return url.protocol === "https:" || url.protocol === "data:" || url.protocol === "blob:" ? "allow" : "block";
  if (url.username || url.password) return "block";
  // A blob: URL reports its creator's origin, so the protocol is checked before the origin.
  if (url.protocol === "https:" || url.protocol === "http:") return url.origin === origin ? "allow" : "outside";
  if (OUTSIDE_APP_SCHEMES.has(url.protocol)) return "outside";
  return "block";
}

/** True when a message's sender page is on the web origin. */
export function isFromWebOrigin(senderUrl: string | undefined, origin: string): boolean {
  if (!senderUrl) return false;
  try { return new URL(senderUrl).origin === origin; } catch { return false; }
}

/** The page theme, its header colour (status-bar strip) and the colour at its bottom edge. */
export type WebShellTheme = Readonly<{ theme: "light" | "dark"; barColour: string | null; bottomColour: string | null }>;
export type WebShellDownload = Readonly<{ fileName: string; mimeType: string; base64: string }>;
export type WebShellMessage =
  | Readonly<{ kind: "theme" } & WebShellTheme>
  | Readonly<{ kind: "download" } & WebShellDownload>
  | Readonly<{ kind: "download-failed"; reason: "too-large" | "unreadable" }>;

const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
/** base64 length for the byte limit, so an oversized payload is refused before decoding. */
const MAX_BASE64_LENGTH = Math.ceil(WEB_SHELL_MAX_DOWNLOAD_BYTES / 3) * 4;

/**
 * A file name that is safe as the last segment of a path in the app's cache: no folders, no
 * control or reserved characters, no leading dots, and a bounded length that keeps the extension.
 */
export function safeDownloadName(raw: unknown): string {
  const base = (typeof raw === "string" ? raw : "").split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is removed
  let name = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").replace(/^[.\s]+/, "").trim();
  if (name.length > 120) {
    const dot = name.lastIndexOf(".");
    const extension = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : "";
    name = name.slice(0, 120 - extension.length) + extension;
  }
  return name || "download";
}

const hexColour = (value: unknown): string | null =>
  typeof value === "string" && HEX_COLOUR.test(value.trim()) ? value.trim() : null;

/** Parses one page message. Anything unexpected is null and is ignored. */
export function parseWebShellMessage(raw: string): WebShellMessage | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (message.ns !== WEB_SHELL_MESSAGE_NAMESPACE) return null;
  switch (message.kind) {
    case "theme": {
      if (message.theme !== "light" && message.theme !== "dark") return null;
      return { kind: "theme", theme: message.theme, barColour: hexColour(message.color), bottomColour: hexColour(message.bottom) };
    }
    case "download": {
      const { base64 } = message;
      if (typeof base64 !== "string" || base64.length === 0 || base64.length > MAX_BASE64_LENGTH || !BASE64.test(base64)) return null;
      const mimeType = typeof message.mimeType === "string" && MIME_TYPE.test(message.mimeType) ? message.mimeType : "application/octet-stream";
      return { kind: "download", fileName: safeDownloadName(message.name), mimeType, base64 };
    }
    case "download-failed":
      return { kind: "download-failed", reason: message.reason === "too-large" ? "too-large" : "unreadable" };
    default:
      return null;
  }
}

/** Light status-bar icons on a dark strip, dark icons on a light one. */
export function statusBarStyleFor(barColour: string): "light" | "dark" {
  if (!HEX_COLOUR.test(barColour)) return "dark";
  let hex = barColour.slice(1);
  if (hex.length === 3) hex = hex.split("").map((digit) => digit + digit).join("");
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance < 0.4 ? "light" : "dark";
}

/**
 * The web path an incoming link asks for: `jewelos://tasks/123` or a link on the web origin.
 * Anything else, including a protocol-relative path, is null.
 */
export function incomingWebPath(raw: string, origin: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.username || url.password) return null;
  let path: string;
  if (url.protocol === "jewelos:") path = `${url.hostname ? `/${url.hostname}` : ""}${url.pathname}${url.search}${url.hash}`;
  else if (url.origin === origin) path = `${url.pathname}${url.search}${url.hash}`;
  else return null;
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.startsWith("//") || path.startsWith("/\\")) return null;
  return path;
}

/**
 * Runs in the page before its own scripts (top frame only). It must stay small, dependency-free
 * ES2017, and must never change what the page does except for the two things it reports:
 *   - a click on an `<a download>` whose target is a blob:/data: URL (including the detached
 *     `anchor.click()` pattern the web uses) is handed to the app as base64, because a WebView
 *     cannot save such a file itself. The Blob is kept from `URL.createObjectURL` for a minute,
 *     because the web revokes the URL right after the click;
 *   - the page theme (`<html data-theme>` and the `theme-color` meta the web keeps in step) and
 *     the colour at the page's bottom edge, re-read on theme and route changes, so the strips
 *     above and below the page (status bar, gesture bar) match it.
 */
export function webShellInjectedScript(): string {
  return `(function () {
  if (window.__jewelosShell) return;
  window.__jewelosShell = true;
  var NS = ${JSON.stringify(WEB_SHELL_MESSAGE_NAMESPACE)};
  var MAX = ${WEB_SHELL_MAX_DOWNLOAD_BYTES};
  function post(message) {
    message.ns = NS;
    try { window.ReactNativeWebView.postMessage(JSON.stringify(message)); } catch (e) {}
  }
  var blobs = new Map();
  var createObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (object) {
    var url = createObjectURL(object);
    if (object instanceof Blob) {
      blobs.set(url, object);
      setTimeout(function () { blobs.delete(url); }, 60000);
    }
    return url;
  };
  function send(blob, name) {
    if (blob.size > MAX) { post({ kind: "download-failed", reason: "too-large" }); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var result = String(reader.result || "");
      post({ kind: "download", name: name, mimeType: blob.type, base64: result.slice(result.indexOf(",") + 1) });
    };
    reader.onerror = function () { post({ kind: "download-failed", reason: "unreadable" }); };
    reader.readAsDataURL(blob);
  }
  function intercept(anchor) {
    if (!anchor || !anchor.hasAttribute || !anchor.hasAttribute("download")) return false;
    var href = anchor.href || "";
    if (href.indexOf("blob:") !== 0 && href.indexOf("data:") !== 0) return false;
    var name = anchor.getAttribute("download") || "download";
    var kept = blobs.get(href);
    if (kept) { send(kept, name); return true; }
    fetch(href).then(function (response) { return response.blob(); })
      .then(function (blob) { send(blob, name); })
      .catch(function () { post({ kind: "download-failed", reason: "unreadable" }); });
    return true;
  }
  var click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (intercept(this)) return;
    return click.apply(this, arguments);
  };
  document.addEventListener("click", function (event) {
    var target = event.target;
    var anchor = target && target.closest ? target.closest("a[download]") : null;
    if (anchor && intercept(anchor)) event.preventDefault();
  }, true);
  function hex(css) {
    var parts = /^rgba?\\(\\s*(\\d+)[ ,]+(\\d+)[ ,]+(\\d+)(?:[ ,/]+([\\d.]+))?\\s*\\)$/.exec(css || "");
    if (!parts || (parts[4] !== undefined && Number(parts[4]) === 0)) return null;
    return "#" + [parts[1], parts[2], parts[3]].map(function (n) { return ("0" + Math.min(255, Number(n)).toString(16)).slice(-2); }).join("");
  }
  function bottomColour() {
    var element = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 1);
    while (element && element.nodeType === 1) {
      var colour = hex(getComputedStyle(element).backgroundColor);
      if (colour) return colour;
      element = element.parentElement;
    }
    return null;
  }
  var lastTheme = "";
  function reportTheme() {
    var root = document.documentElement;
    var theme = root.getAttribute("data-theme") === "dark" ? "dark" : "light";
    var meta = document.querySelector('meta[name="theme-color"]');
    var color = meta ? meta.getAttribute("content") : null;
    var bottom = document.body ? bottomColour() : null;
    var key = theme + "|" + color + "|" + bottom;
    if (key === lastTheme) return;
    lastTheme = key;
    post({ kind: "theme", theme: theme, color: color, bottom: bottom });
  }
  // The page renders after the theme switch, so it is read again once the new screen has painted.
  function soon() { setTimeout(reportTheme, 0); setTimeout(reportTheme, 400); }
  new MutationObserver(soon).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  function watchHead() { if (document.head) new MutationObserver(soon).observe(document.head, { childList: true }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { watchHead(); soon(); });
  else { watchHead(); soon(); }
  window.addEventListener("pageshow", function () { lastTheme = ""; soon(); });
  window.addEventListener("popstate", soon);
  ["pushState", "replaceState"].forEach(function (name) {
    var original = history[name];
    history[name] = function () { var result = original.apply(this, arguments); soon(); return result; };
  });
})();
true;`;
}
