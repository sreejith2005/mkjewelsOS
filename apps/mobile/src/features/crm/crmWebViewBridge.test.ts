import { describe, expect, it, vi } from "vitest";
import { parseCrmEmbedNativeMessage, serializeCrmEmbedMessage } from "@jewelos/core";

import { createNativeCrmBridge, crmStartUrl, type NativeSessionToken } from "./crmWebViewBridge";

const ORIGIN = "https://jewelos.example.com";
const CURRENT: NativeSessionToken = { accessToken: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhIn0.c2lnYQ", expiresAt: 1_900_000_000 };
const REFRESHED: NativeSessionToken = { accessToken: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJiIn0.c2lnYg", expiresAt: 1_900_003_600 };

function setup() {
  const sent: string[] = [];
  const deps = {
    origin: ORIGIN,
    currentToken: vi.fn(async () => CURRENT),
    refreshToken: vi.fn(async () => REFRESHED),
    send: (raw: string) => sent.push(raw),
    onHome: vi.fn(),
    onSignOutRequested: vi.fn(),
    onCleared: vi.fn(),
  };
  const bridge = createNativeCrmBridge(deps);
  const page = (message: Parameters<typeof serializeCrmEmbedMessage>[0]) => serializeCrmEmbedMessage(message);
  const received = () => sent.map((raw) => parseCrmEmbedNativeMessage(raw));
  return { bridge, deps, sent, page, received };
}

describe("native CRM bridge: origin checks", () => {
  it("answers the page's ready message with the current access token only", async () => {
    const { bridge, page, received, sent } = setup();
    bridge.pageLoaded(`${ORIGIN}/crm`);
    await expect(bridge.handleMessage(page({ type: "jewelos-crm:ready" }), ORIGIN)).resolves.toBe("accepted");
    expect(received()).toEqual([{ type: "jewelos-crm:token", ...CURRENT }]);
    expect(sent[0]).not.toMatch(/refresh/i);
  });

  it("rejects messages from any other origin, including look-alikes", async () => {
    const { bridge, deps, page, sent } = setup();
    for (const sender of ["https://evil.example", "https://jewelos.example.com.evil.test", "http://jewelos.example.com", "https://jewelos.example.com:444", "null", "", "file:///x"]) {
      await expect(bridge.handleMessage(page({ type: "jewelos-crm:ready" }), sender)).resolves.toBe("rejected");
    }
    await expect(bridge.handleMessage(page({ type: "jewelos-crm:home" }), "https://evil.example/crm")).resolves.toBe("rejected");
    expect(sent).toEqual([]);
    expect(deps.onHome).not.toHaveBeenCalled();
    expect(deps.currentToken).not.toHaveBeenCalled();
  });

  it("rejects malformed messages from the right origin", async () => {
    const { bridge, sent } = setup();
    await expect(bridge.handleMessage("{\"type\":\"jewelos-crm:ready\"}", ORIGIN)).resolves.toBe("rejected");
    await expect(bridge.handleMessage("hello", ORIGIN)).resolves.toBe("rejected");
    expect(sent).toEqual([]);
  });

  it("never pushes a token to a page that is not on the JewelOS origin", () => {
    const { bridge, sent } = setup();
    bridge.pushToken(CURRENT);
    bridge.pageLoaded("about:blank");
    bridge.pushToken(CURRENT);
    bridge.pageLoaded("https://evil.example/crm");
    bridge.pushToken(CURRENT);
    expect(sent).toEqual([]);
    bridge.pageLoaded(`${ORIGIN}/crm/queue`);
    bridge.pushToken(CURRENT);
    expect(sent).toHaveLength(1);
  });
});

describe("native CRM bridge: token messages", () => {
  it("refreshes natively when the page reports a rejected token, and resends on expiry", async () => {
    const { bridge, deps, page, received } = setup();
    await bridge.handleMessage(page({ type: "jewelos-crm:token-request", reason: "unauthorized" }), ORIGIN);
    expect(deps.refreshToken).toHaveBeenCalledTimes(1);
    await bridge.handleMessage(page({ type: "jewelos-crm:token-request", reason: "expired" }), ORIGIN);
    expect(deps.currentToken).toHaveBeenCalledTimes(1);
    expect(received()).toEqual([{ type: "jewelos-crm:token", ...REFRESHED }, { type: "jewelos-crm:token", ...CURRENT }]);
  });

  it("pushes a token the app refreshed on its own", () => {
    const { bridge, received } = setup();
    bridge.pageLoaded(`${ORIGIN}/crm`);
    bridge.pushToken(REFRESHED);
    bridge.pushToken(null);
    expect(received()).toEqual([{ type: "jewelos-crm:token", ...REFRESHED }]);
  });

  it("sends nothing when the app has no session", async () => {
    const { bridge, deps, page, sent } = setup();
    deps.currentToken.mockResolvedValueOnce(null as unknown as NativeSessionToken);
    await bridge.handleMessage(page({ type: "jewelos-crm:ready" }), ORIGIN);
    expect(sent).toEqual([]);
  });
});

describe("native CRM bridge: sign-out clearing", () => {
  it("asks the page to clear, stops sending tokens, and reports the confirmation", async () => {
    const { bridge, deps, page, received } = setup();
    bridge.pageLoaded(`${ORIGIN}/crm`);
    bridge.requestClear();
    bridge.pushToken(REFRESHED);
    await bridge.handleMessage(page({ type: "jewelos-crm:token-request", reason: "missing" }), ORIGIN);
    expect(received()).toEqual([{ type: "jewelos-crm:clear" }]);
    await bridge.handleMessage(page({ type: "jewelos-crm:cleared" }), ORIGIN);
    expect(deps.onCleared).toHaveBeenCalledTimes(1);
  });

  it("routes the page's sign-out and home requests to the app", async () => {
    const { bridge, deps, page } = setup();
    await bridge.handleMessage(page({ type: "jewelos-crm:sign-out" }), ORIGIN);
    await bridge.handleMessage(page({ type: "jewelos-crm:home" }), `${ORIGIN}/crm/dashboard`);
    expect(deps.onSignOutRequested).toHaveBeenCalledTimes(1);
    expect(deps.onHome).toHaveBeenCalledTimes(1);
  });
});

describe("native CRM bridge: navigation allowlist", () => {
  it("keeps /crm in the WebView and sends everything else out", () => {
    const { bridge } = setup();
    expect(crmStartUrl(ORIGIN)).toBe(`${ORIGIN}/crm`);
    expect(bridge.navigation(`${ORIGIN}/crm/clients/1`)).toBe("allow");
    expect(bridge.navigation(`${ORIGIN}/`)).toBe("external");
    expect(bridge.navigation("https://maps.example/x")).toBe("external");
    expect(bridge.navigation("tel:9876543210")).toBe("dial");
    expect(bridge.navigation("javascript:alert(1)")).toBe("block");
    expect(bridge.navigation("intent://scan#Intent;end")).toBe("block");
  });
});
