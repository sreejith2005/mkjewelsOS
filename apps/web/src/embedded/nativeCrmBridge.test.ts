// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { CRM_EMBED_USER_AGENT_TOKEN, parseCrmEmbedPageMessage, serializeCrmEmbedMessage, type CrmEmbedPageMessage } from "@jewelos/core";

import { isEmbeddedCrmPage, isNativeBridgeEvent, NativeTokenBroker } from "./nativeCrmBridge";

const TOKEN_A = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhIn0.c2lnYQ";
const TOKEN_B = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJiIn0.c2lnYg";
const NOW = 1_800_000_000_000;

/** What react-native-webview's postMessage command dispatches on document. */
function nativeEvent(data: string): MessageEvent {
  return new MessageEvent("message", { data });
}
const tokenMessage = (accessToken: string, expiresAt: number | null = NOW / 1000 + 3600) => serializeCrmEmbedMessage({ type: "jewelos-crm:token", accessToken, expiresAt });

function brokerWithOutbox(timeoutMs = 1000) {
  const outbox: CrmEmbedPageMessage[] = [];
  const clearStorage = vi.fn();
  const broker = new NativeTokenBroker({ post: (message) => outbox.push(message), now: () => NOW, timeoutMs, clearStorage });
  return { broker, outbox, clearStorage };
}

afterEach(() => vi.useRealTimers());

describe("embedded mode detection", () => {
  const win = (pathname: string, userAgent: string, bridge?: unknown) => ({ location: { pathname }, navigator: { userAgent }, ReactNativeWebView: bridge }) as unknown as Parameters<typeof isEmbeddedCrmPage>[0];
  const bridge = { postMessage: () => undefined };

  it("needs a /crm path, the app's user-agent token and the native bridge object", () => {
    expect(isEmbeddedCrmPage(win("/crm/queue", `Mozilla/5.0 ${CRM_EMBED_USER_AGENT_TOKEN}`, bridge))).toBe(true);
    expect(isEmbeddedCrmPage(win("/crm/queue", "Mozilla/5.0", bridge))).toBe(false);
    expect(isEmbeddedCrmPage(win("/crm/queue", `Mozilla/5.0 ${CRM_EMBED_USER_AGENT_TOKEN}`))).toBe(false);
    expect(isEmbeddedCrmPage(win("/tasks", `Mozilla/5.0 ${CRM_EMBED_USER_AGENT_TOKEN}`, bridge))).toBe(false);
  });
});

describe("native bridge origin check", () => {
  it("accepts only the synthetic, sourceless, originless event native dispatches", () => {
    expect(isNativeBridgeEvent(nativeEvent("x"))).toBe(true);
    expect(isNativeBridgeEvent(new MessageEvent("message", { data: "x", origin: "https://evil.example" }))).toBe(false);
    expect(isNativeBridgeEvent(new MessageEvent("message", { data: "x", source: window }))).toBe(false);
  });

  it("ignores a token posted by another window", () => {
    const { broker } = brokerWithOutbox();
    expect(broker.receive(new MessageEvent("message", { data: tokenMessage(TOKEN_A), origin: "https://evil.example", source: window }))).toBe(false);
  });
});

describe("NativeTokenBroker", () => {
  it("asks native for a token once and resolves every waiting request with it", async () => {
    const { broker, outbox } = brokerWithOutbox();
    const first = broker.getToken();
    const second = broker.getToken();
    expect(outbox).toEqual([{ type: "jewelos-crm:token-request", reason: "missing" }]);
    expect(broker.receive(nativeEvent(tokenMessage(TOKEN_A)))).toBe(true);
    await expect(first).resolves.toBe(TOKEN_A);
    await expect(second).resolves.toBe(TOKEN_A);
    await expect(broker.getToken()).resolves.toBe(TOKEN_A);
    expect(outbox).toHaveLength(1);
  });

  it("asks again when the token is about to expire", async () => {
    const { broker, outbox } = brokerWithOutbox();
    broker.receive(nativeEvent(tokenMessage(TOKEN_A, NOW / 1000 + 30)));
    const pending = broker.getToken();
    expect(outbox).toEqual([{ type: "jewelos-crm:token-request", reason: "expired" }]);
    broker.receive(nativeEvent(tokenMessage(TOKEN_B)));
    await expect(pending).resolves.toBe(TOKEN_B);
  });

  it("after a 401 waits for a different token (native refreshes)", async () => {
    const { broker, outbox } = brokerWithOutbox();
    broker.receive(nativeEvent(tokenMessage(TOKEN_A)));
    const retry = broker.tokenAfterRejection(TOKEN_A);
    expect(outbox).toEqual([{ type: "jewelos-crm:token-request", reason: "unauthorized" }]);
    broker.receive(nativeEvent(tokenMessage(TOKEN_A)));
    broker.receive(nativeEvent(tokenMessage(TOKEN_B)));
    await expect(retry).resolves.toBe(TOKEN_B);
  });

  it("gives up after the timeout, so the request runs without a token and is denied", async () => {
    vi.useFakeTimers();
    const { broker } = brokerWithOutbox(500);
    const pending = broker.getToken();
    vi.advanceTimersByTime(501);
    await expect(pending).resolves.toBeNull();
  });

  it("drops malformed messages", () => {
    const { broker } = brokerWithOutbox();
    expect(broker.receive(nativeEvent("{\"v\":1,\"type\":\"jewelos-crm:token\",\"accessToken\":\"x\"}"))).toBe(false);
    expect(broker.receive(nativeEvent("not json"))).toBe(false);
  });

  it("on native sign-out forgets the token, refuses new ones, clears storage and confirms", async () => {
    const { broker, outbox, clearStorage } = brokerWithOutbox();
    broker.receive(nativeEvent(tokenMessage(TOKEN_A)));
    const waiting = broker.tokenAfterRejection(TOKEN_A);
    expect(broker.receive(nativeEvent(serializeCrmEmbedMessage({ type: "jewelos-crm:clear" })))).toBe(true);
    await expect(waiting).resolves.toBeNull();
    await vi.waitFor(() => expect(outbox.at(-1)).toEqual({ type: "jewelos-crm:cleared" }));
    expect(clearStorage).toHaveBeenCalledTimes(1);
    expect(broker.receive(nativeEvent(tokenMessage(TOKEN_B)))).toBe(false);
    await expect(broker.getToken()).resolves.toBeNull();
  });

  it("never sends anything but protocol messages to native", () => {
    const { broker, outbox } = brokerWithOutbox();
    void broker.getToken();
    for (const message of outbox) expect(parseCrmEmbedPageMessage(serializeCrmEmbedMessage(message))).toEqual(message);
  });
});
