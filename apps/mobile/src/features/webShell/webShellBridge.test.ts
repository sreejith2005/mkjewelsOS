import { describe, expect, it } from "vitest";
import {
  WEB_SHELL_MAX_DOWNLOAD_BYTES,
  WEB_SHELL_MESSAGE_NAMESPACE,
  incomingWebPath,
  isFromWebOrigin,
  parseWebShellMessage,
  safeDownloadName,
  statusBarStyleFor,
  webShellInjectedScript,
  webShellNavigation,
} from "./webShellBridge";

const ORIGIN = "https://mkjewels-os.vercel.app";
const message = (body: Record<string, unknown>) => JSON.stringify({ ns: WEB_SHELL_MESSAGE_NAMESPACE, ...body });

describe("webShellNavigation", () => {
  it("keeps the web origin in the app", () => {
    expect(webShellNavigation(`${ORIGIN}/tasks?view=today`, ORIGIN)).toBe("allow");
    expect(webShellNavigation(`${ORIGIN}/crm`, ORIGIN)).toBe("allow");
    expect(webShellNavigation("about:blank", ORIGIN)).toBe("allow");
  });

  it("opens other web addresses and phone apps outside", () => {
    expect(webShellNavigation("https://project.supabase.co/storage/v1/object/sign/x?token=t", ORIGIN)).toBe("outside");
    expect(webShellNavigation("https://mkjewels-os.vercel.app.evil.test/", ORIGIN)).toBe("outside");
    expect(webShellNavigation("http://mkjewels-os.vercel.app/", ORIGIN)).toBe("outside");
    expect(webShellNavigation("tel:+919999999999", ORIGIN)).toBe("outside");
    expect(webShellNavigation("mailto:a@b.test", ORIGIN)).toBe("outside");
    expect(webShellNavigation("https://wa.me/919999999999", ORIGIN)).toBe("outside");
  });

  it("blocks schemes that can run or read inside the app frame", () => {
    expect(webShellNavigation("javascript:alert(1)", ORIGIN)).toBe("block");
    expect(webShellNavigation("file:///data/data/com.jewelos.mobile/x", ORIGIN)).toBe("block");
    expect(webShellNavigation("data:text/html,<p>x</p>", ORIGIN)).toBe("block");
    expect(webShellNavigation("blob:https://mkjewels-os.vercel.app/abc", ORIGIN)).toBe("block");
    expect(webShellNavigation("content://media/external/1", ORIGIN)).toBe("block");
    expect(webShellNavigation(`https://user:pass@${ORIGIN.slice(8)}/`, ORIGIN)).toBe("block");
    expect(webShellNavigation("not a url", ORIGIN)).toBe("block");
  });

  it("lets a sub-frame load https or an inert document only", () => {
    expect(webShellNavigation("https://www.youtube.com/embed/x", ORIGIN, false)).toBe("allow");
    expect(webShellNavigation("http://example.test/", ORIGIN, false)).toBe("block");
    expect(webShellNavigation("javascript:alert(1)", ORIGIN, false)).toBe("block");
  });
});

describe("isFromWebOrigin", () => {
  it("accepts only pages on the web origin", () => {
    expect(isFromWebOrigin(`${ORIGIN}/tasks`, ORIGIN)).toBe(true);
    expect(isFromWebOrigin("https://other.test/", ORIGIN)).toBe(false);
    expect(isFromWebOrigin(undefined, ORIGIN)).toBe(false);
    expect(isFromWebOrigin("garbage", ORIGIN)).toBe(false);
  });
});

describe("parseWebShellMessage", () => {
  it("reads the page theme and a valid bar colour", () => {
    expect(parseWebShellMessage(message({ kind: "theme", theme: "dark", color: "#262422", bottom: "#1f1d1b" }))).toEqual({ kind: "theme", theme: "dark", barColour: "#262422", bottomColour: "#1f1d1b" });
    expect(parseWebShellMessage(message({ kind: "theme", theme: "light", color: "red; background:url(x)", bottom: 3 }))).toEqual({ kind: "theme", theme: "light", barColour: null, bottomColour: null });
    expect(parseWebShellMessage(message({ kind: "theme", theme: "purple" }))).toBeNull();
  });

  it("reads a download and cleans its name and type", () => {
    expect(parseWebShellMessage(message({ kind: "download", name: "../../mk-jewels-task-bulk-import.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: "UEsDBA==" })))
      .toEqual({ kind: "download", fileName: "mk-jewels-task-bulk-import.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: "UEsDBA==" });
    expect(parseWebShellMessage(message({ kind: "download", name: "x.csv", mimeType: "text/html; script", base64: "YQ==" })))
      .toMatchObject({ mimeType: "application/octet-stream" });
  });

  it("refuses empty, malformed and oversized downloads", () => {
    expect(parseWebShellMessage(message({ kind: "download", name: "x", base64: "" }))).toBeNull();
    expect(parseWebShellMessage(message({ kind: "download", name: "x", base64: "not base64!" }))).toBeNull();
    const tooLong = "A".repeat(Math.ceil(WEB_SHELL_MAX_DOWNLOAD_BYTES / 3) * 4 + 4);
    expect(parseWebShellMessage(message({ kind: "download", name: "x", base64: tooLong }))).toBeNull();
  });

  it("ignores anything outside the namespace or not JSON", () => {
    expect(parseWebShellMessage(JSON.stringify({ kind: "theme", theme: "dark" }))).toBeNull();
    expect(parseWebShellMessage(JSON.stringify({ ns: "jewelos-crm-embed/1", kind: "theme", theme: "dark" }))).toBeNull();
    expect(parseWebShellMessage("{")).toBeNull();
    expect(parseWebShellMessage("null")).toBeNull();
    expect(parseWebShellMessage(message({ kind: "eval", code: "x" }))).toBeNull();
  });

  it("reads the page's safe-area insets and refuses nonsense", () => {
    expect(parseWebShellMessage(message({ kind: "insets", top: 36.5, bottom: 24 }))).toEqual({ kind: "insets", top: 36.5, bottom: 24 });
    expect(parseWebShellMessage(message({ kind: "insets", top: 0, bottom: 0 }))).toEqual({ kind: "insets", top: 0, bottom: 0 });
    expect(parseWebShellMessage(message({ kind: "insets", top: -1, bottom: 0 }))).toBeNull();
    expect(parseWebShellMessage(message({ kind: "insets", top: "36", bottom: 0 }))).toBeNull();
    expect(parseWebShellMessage(message({ kind: "insets", top: 1e9, bottom: 0 }))).toBeNull();
  });

  it("reports a failed download with a known reason", () => {
    expect(parseWebShellMessage(message({ kind: "download-failed", reason: "too-large" }))).toEqual({ kind: "download-failed", reason: "too-large" });
    expect(parseWebShellMessage(message({ kind: "download-failed", reason: "?" }))).toEqual({ kind: "download-failed", reason: "unreadable" });
  });
});

describe("safeDownloadName", () => {
  it("keeps only a plain last path segment", () => {
    expect(safeDownloadName("report.xlsx")).toBe("report.xlsx");
    expect(safeDownloadName("..\\..\\a.csv")).toBe("a.csv");
    expect(safeDownloadName(".hidden")).toBe("hidden");
    expect(safeDownloadName("a<b>:c?.pdf")).toBe("a_b__c_.pdf");
    expect(safeDownloadName("")).toBe("download");
    expect(safeDownloadName(42)).toBe("download");
  });

  it("bounds the length and keeps the extension", () => {
    const name = safeDownloadName(`${"x".repeat(300)}.xlsx`);
    expect(name).toHaveLength(120);
    expect(name.endsWith(".xlsx")).toBe(true);
  });
});

describe("statusBarStyleFor", () => {
  it("uses light icons on the dark web header and dark icons on a light strip", () => {
    expect(statusBarStyleFor("#262422")).toBe("light");
    expect(statusBarStyleFor("#0a0a0a")).toBe("light");
    expect(statusBarStyleFor("#F8FAFC")).toBe("dark");
    expect(statusBarStyleFor("#fff")).toBe("dark");
  });
});

describe("incomingWebPath", () => {
  it("maps the app scheme and web-origin links to a web path", () => {
    expect(incomingWebPath("jewelos://tasks/abc?x=1", ORIGIN)).toBe("/tasks/abc?x=1");
    expect(incomingWebPath("jewelos:///notifications", ORIGIN)).toBe("/notifications");
    expect(incomingWebPath(`${ORIGIN}/tasks/fms?instance=1#top`, ORIGIN)).toBe("/tasks/fms?instance=1#top");
  });

  it("refuses other hosts, credentials and protocol-relative paths", () => {
    expect(incomingWebPath("https://evil.test/tasks", ORIGIN)).toBeNull();
    expect(incomingWebPath("jewelos://user:pw@tasks", ORIGIN)).toBeNull();
    expect(incomingWebPath(`${ORIGIN}//evil.test/x`, ORIGIN)).toBeNull();
    expect(incomingWebPath("nonsense", ORIGIN)).toBeNull();
  });
});

describe("webShellInjectedScript", () => {
  it("is a self-contained script that ends with a value for the WebView", () => {
    const script = webShellInjectedScript();
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain(WEB_SHELL_MESSAGE_NAMESPACE);
    expect(script.trimEnd().endsWith("true;")).toBe(true);
  });
});
