import { describe, expect, it } from "vitest";
import {
  crmEmbedNavigation,
  crmEmbedTokenIsFresh,
  httpOrigin,
  isCrmEmbedPath,
  parseCrmEmbedNativeMessage,
  parseCrmEmbedPageMessage,
  serializeCrmEmbedMessage,
} from "./crmEmbed";

const ORIGIN = "https://jewelos.example.com";
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl";

describe("CRM embed messages", () => {
  it("round-trips every page message", () => {
    for (const message of [
      { type: "jewelos-crm:ready" },
      { type: "jewelos-crm:home" },
      { type: "jewelos-crm:sign-out" },
      { type: "jewelos-crm:cleared" },
      { type: "jewelos-crm:token-request", reason: "unauthorized" },
    ] as const) {
      expect(parseCrmEmbedPageMessage(serializeCrmEmbedMessage(message))).toEqual(message);
    }
  });

  it("round-trips native token and clear messages", () => {
    const token = { type: "jewelos-crm:token", accessToken: TOKEN, expiresAt: 1_900_000_000 } as const;
    expect(parseCrmEmbedNativeMessage(serializeCrmEmbedMessage(token))).toEqual(token);
    expect(parseCrmEmbedNativeMessage(serializeCrmEmbedMessage({ type: "jewelos-crm:clear" }))).toEqual({ type: "jewelos-crm:clear" });
  });

  it("rejects malformed, unknown, versionless and oversized messages", () => {
    for (const raw of [
      undefined, 42, "", "not json", "[]", "null",
      JSON.stringify({ type: "jewelos-crm:ready" }),
      JSON.stringify({ v: 2, type: "jewelos-crm:ready" }),
      JSON.stringify({ v: 1, type: "jewelos-crm:navigate", url: "https://evil.example" }),
      JSON.stringify({ v: 1, type: "jewelos-crm:token-request", reason: "because" }),
      JSON.stringify({ v: 1, type: "jewelos-crm:ready", pad: "x".repeat(20_000) }),
    ]) {
      expect(parseCrmEmbedPageMessage(raw)).toBeNull();
      expect(parseCrmEmbedNativeMessage(raw)).toBeNull();
    }
  });

  it("accepts only a JWT-shaped access token with a sane expiry", () => {
    const token = (accessToken: unknown, expiresAt: unknown) => parseCrmEmbedNativeMessage(JSON.stringify({ v: 1, type: "jewelos-crm:token", accessToken, expiresAt }));
    expect(token(TOKEN, null)).toEqual({ type: "jewelos-crm:token", accessToken: TOKEN, expiresAt: null });
    expect(token("not-a-jwt", 1)).toBeNull();
    expect(token(`${TOKEN}.extra`, 1)).toBeNull();
    expect(token(`${TOKEN}<script>`, 1)).toBeNull();
    expect(token(TOKEN, "1900000000")).toBeNull();
    expect(token(TOKEN, -5)).toBeNull();
    expect(token(TOKEN, 0)).toBeNull();
    // A refresh token is never sent; a native message that carries one is still only read for the access token.
    expect(parseCrmEmbedNativeMessage(JSON.stringify({ v: 1, type: "jewelos-crm:token", accessToken: TOKEN, expiresAt: 1, refreshToken: "r" }))).toEqual({ type: "jewelos-crm:token", accessToken: TOKEN, expiresAt: 1 });
  });
});

describe("CRM embed navigation allowlist", () => {
  it("keeps /crm and below of the JewelOS origin in the WebView", () => {
    expect(crmEmbedNavigation(`${ORIGIN}/crm`, ORIGIN)).toBe("allow");
    expect(crmEmbedNavigation(`${ORIGIN}/crm/clients/abc?x=1#top`, ORIGIN)).toBe("allow");
    expect(crmEmbedNavigation("about:blank", ORIGIN)).toBe("allow");
  });

  it("sends every other page to the system browser", () => {
    expect(crmEmbedNavigation(`${ORIGIN}/`, ORIGIN)).toBe("external");
    expect(crmEmbedNavigation(`${ORIGIN}/tasks`, ORIGIN)).toBe("external");
    expect(crmEmbedNavigation(`${ORIGIN}/crmx`, ORIGIN)).toBe("external");
    expect(crmEmbedNavigation(`${ORIGIN}/crm/../settings`, ORIGIN)).toBe("external");
    expect(crmEmbedNavigation("https://jewelos.example.com.evil.test/crm", ORIGIN)).toBe("external");
    expect(crmEmbedNavigation("http://jewelos.example.com/crm", ORIGIN)).toBe("external");
    expect(crmEmbedNavigation("https://jewelos.example.com:8443/crm", ORIGIN)).toBe("external");
    expect(crmEmbedNavigation("https://abc.supabase.co/storage/v1/object/sign/crm-legacy-documents/a.jpg?token=t", ORIGIN)).toBe("external");
    expect(crmEmbedNavigation("mailto:a@example.com", ORIGIN)).toBe("external");
  });

  it("dials tel: links and blocks other schemes", () => {
    expect(crmEmbedNavigation("tel:+919876543210", ORIGIN)).toBe("dial");
    for (const url of ["javascript:alert(1)", "data:text/html,x", "file:///sdcard/x", "blob:https://jewelos.example.com/1", "intent://x#Intent;end", "content://x", "not a url", `https://user:pw@jewelos.example.com/crm`]) {
      expect(crmEmbedNavigation(url, ORIGIN)).toBe("block");
    }
  });

  it("normalises origins and paths", () => {
    expect(httpOrigin("https://jewelos.example.com/crm?x")).toBe(ORIGIN);
    expect(httpOrigin("http://10.0.2.2:5180/")).toBe("http://10.0.2.2:5180");
    expect(httpOrigin("ftp://x")).toBeNull();
    expect(httpOrigin("https://u:p@x.example")).toBeNull();
    expect(httpOrigin("nonsense")).toBeNull();
    expect(isCrmEmbedPath("/crm")).toBe(true);
    expect(isCrmEmbedPath("/crm/")).toBe(true);
    expect(isCrmEmbedPath("/crmx")).toBe(false);
  });
});

describe("token freshness", () => {
  it("treats a token that expires within a minute as stale", () => {
    const now = 1_000_000_000_000;
    expect(crmEmbedTokenIsFresh(null, now)).toBe(true);
    expect(crmEmbedTokenIsFresh(now / 1000 + 3600, now)).toBe(true);
    expect(crmEmbedTokenIsFresh(now / 1000 + 30, now)).toBe(false);
    expect(crmEmbedTokenIsFresh(now / 1000 - 1, now)).toBe(false);
  });
});
