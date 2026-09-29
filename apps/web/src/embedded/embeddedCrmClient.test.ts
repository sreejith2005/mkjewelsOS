// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { serializeCrmEmbedMessage, type CrmEmbedPageMessage } from "@jewelos/core";

import { createEmbeddedCrmClient, embeddedCrmAuth, retryUnauthorizedFetch } from "./embeddedCrmClient";
import { NativeTokenBroker } from "./nativeCrmBridge";

const URL_BASE = "http://127.0.0.1:54321";
const TOKEN_A = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhIn0.c2lnYQ";
const TOKEN_B = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJiIn0.c2lnYg";

function nativeToken(broker: NativeTokenBroker, accessToken: string) {
  broker.receive(new MessageEvent("message", { data: serializeCrmEmbedMessage({ type: "jewelos-crm:token", accessToken, expiresAt: Math.floor(Date.now() / 1000) + 3600 }) }));
}

/** A broker whose "native side" answers token requests with the next token in `tokens`. */
function answeringBroker(tokens: string[]) {
  const outbox: CrmEmbedPageMessage[] = [];
  const broker: NativeTokenBroker = new NativeTokenBroker({
    post: (message) => {
      outbox.push(message);
      const next = tokens.shift();
      if (message.type === "jewelos-crm:token-request" && next) queueMicrotask(() => nativeToken(broker, next));
    },
    timeoutMs: 1000,
  });
  return { broker, outbox };
}

const authOf = (init: RequestInit | undefined) => new Headers(init?.headers).get("Authorization");

describe("embedded CRM Supabase client", () => {
  it("sends the native access token and has no auth client of its own", async () => {
    const { broker } = answeringBroker([TOKEN_A]);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }));
    const client = createEmbeddedCrmClient({ url: URL_BASE, anonKey: "anon", broker, fetch: fetchMock });
    await client.schema("crm").from("clients").select("client_id");
    expect(authOf(fetchMock.mock.calls[0]?.[1])).toBe(`Bearer ${TOKEN_A}`);
    expect(() => client.auth.getSession()).toThrow(/accessToken option/);
  });

  it("retries a 401 once with a fresh token from native", async () => {
    const { broker, outbox } = answeringBroker([TOKEN_A, TOKEN_B]);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      authOf(init) === `Bearer ${TOKEN_A}` ? new Response("{}", { status: 401 }) : new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }));
    const client = createEmbeddedCrmClient({ url: URL_BASE, anonKey: "anon", broker, fetch: fetchMock });
    const { error } = await client.schema("crm").from("clients").select("client_id");
    expect(error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authOf(fetchMock.mock.calls[1]?.[1])).toBe(`Bearer ${TOKEN_B}`);
    expect(outbox).toEqual([{ type: "jewelos-crm:token-request", reason: "missing" }, { type: "jewelos-crm:token-request", reason: "unauthorized" }]);
  });

  it("does not retry requests to other origins", async () => {
    const { broker } = answeringBroker([TOKEN_B]);
    const fetchMock = vi.fn(async () => new Response("{}", { status: 401 }));
    const response = await retryUnauthorizedFetch(broker, URL_BASE, fetchMock)("https://elsewhere.example/x", { headers: { Authorization: `Bearer ${TOKEN_A}` } });
    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns the original 401 when native has no other token", async () => {
    const { broker } = answeringBroker([]);
    nativeToken(broker, TOKEN_A);
    const fetchMock = vi.fn(async () => new Response("{}", { status: 401 }));
    const response = await retryUnauthorizedFetch(broker, URL_BASE, fetchMock)(`${URL_BASE}/rest/v1/x`, { headers: { Authorization: `Bearer ${TOKEN_A}` } });
    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 5000);
});

describe("embedded CRM auth.getUser", () => {
  it("asks GoTrue for the user of the native token", async () => {
    const { broker } = answeringBroker([TOKEN_A]);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ id: "auth-user", email: "person@example.invalid" }), { status: 200 }));
    const auth = embeddedCrmAuth({ url: URL_BASE, anonKey: "anon", broker, fetch: fetchMock });
    await expect(auth.getUser()).resolves.toEqual({ data: { user: { id: "auth-user", email: "person@example.invalid" } }, error: null });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${URL_BASE}/auth/v1/user`);
    expect(authOf(fetchMock.mock.calls[0]?.[1])).toBe(`Bearer ${TOKEN_A}`);
  });

  it("reports no user without a token or when GoTrue rejects it", async () => {
    const noToken = answeringBroker([]);
    const fetchMock = vi.fn(async () => new Response("{}", { status: 403 }));
    noToken.broker.clear();
    await expect(embeddedCrmAuth({ url: URL_BASE, anonKey: "anon", broker: noToken.broker, fetch: fetchMock }).getUser()).resolves.toMatchObject({ data: { user: null } });
    expect(fetchMock).not.toHaveBeenCalled();
    const rejected = answeringBroker([TOKEN_A]);
    await expect(embeddedCrmAuth({ url: URL_BASE, anonKey: "anon", broker: rejected.broker, fetch: fetchMock }).getUser()).resolves.toMatchObject({ data: { user: null } });
  });
});
