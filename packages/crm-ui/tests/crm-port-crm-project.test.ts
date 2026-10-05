// crm-port addition (two-project design, 2026-10-01): the CRM-project token source behind every
// CRM query. It exchanges the JewelOS token through the login bridge, reuses a CRM token until
// shortly before expiry, runs one exchange at a time, remembers a refusal briefly, retries a
// CRM 401 once with a fresh token, and is forgotten on sign-out.
import { describe, expect, it, vi } from "vitest";

import { crmTokenSource, retryOnUnauthorized } from "@/crm-port/crm-project";

const config = { url: "https://crm.example.invalid", anonKey: "crm-anon" };
const EXCHANGE = "https://crm.example.invalid/functions/v1/crm-session-exchange";

function bridge(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses.shift() ?? { status: 500 };
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status });
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

describe("crmTokenSource", () => {
  it("exchanges the JewelOS token at the bridge and returns the CRM access token", async () => {
    const { fetcher, calls } = bridge([{ status: 200, body: { access_token: "crm-1", expires_at: 2_000, crm_user_id: "u" } }]);
    const source = crmTokenSource({ config, jewelosAccessToken: async () => "jw-1", fetch: fetcher, now: () => 1_000_000 });
    await expect(source.token()).resolves.toBe("crm-1");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(EXCHANGE);
    expect(calls[0].init?.method).toBe("POST");
    expect(new Headers(calls[0].init?.headers).get("Authorization")).toBe("Bearer jw-1");
    expect(new Headers(calls[0].init?.headers).get("apikey")).toBe("crm-anon");
  });

  it("reuses the CRM token until a minute before it expires, then exchanges again", async () => {
    let now = 1_000_000;
    const { fetcher, calls } = bridge([
      { status: 200, body: { access_token: "crm-1", expires_at: 1_000 + 3_600 } },
      { status: 200, body: { access_token: "crm-2", expires_at: 1_000 + 7_200 } },
    ]);
    const source = crmTokenSource({ config, jewelosAccessToken: async () => "jw-1", fetch: fetcher, now: () => now });
    await source.token();
    now += 3_000_000;
    await expect(source.token()).resolves.toBe("crm-1");
    now += 560_000; // within 60 s of expiry
    await expect(source.token()).resolves.toBe("crm-2");
    expect(calls).toHaveLength(2);
  });

  it("runs a single exchange for concurrent requests", async () => {
    const { fetcher, calls } = bridge([{ status: 200, body: { access_token: "crm-1", expires_at: 9_999_999 } }]);
    const source = crmTokenSource({ config, jewelosAccessToken: async () => "jw-1", fetch: fetcher });
    const tokens = await Promise.all([source.token(), source.token(), source.token()]);
    expect(tokens).toEqual(["crm-1", "crm-1", "crm-1"]);
    expect(calls).toHaveLength(1);
  });

  it("exchanges again when the JewelOS token changes (refresh or another user)", async () => {
    let jewelos = "jw-1";
    const { fetcher, calls } = bridge([
      { status: 200, body: { access_token: "crm-1", expires_at: 9_999_999 } },
      { status: 200, body: { access_token: "crm-2", expires_at: 9_999_999 } },
    ]);
    const source = crmTokenSource({ config, jewelosAccessToken: async () => jewelos, fetch: fetcher });
    await expect(source.token()).resolves.toBe("crm-1");
    jewelos = "jw-2";
    await expect(source.token()).resolves.toBe("crm-2");
    expect(new Headers(calls[1].init?.headers).get("Authorization")).toBe("Bearer jw-2");
  });

  it("returns null without calling the bridge when there is no JewelOS session", async () => {
    const { fetcher, calls } = bridge([]);
    const source = crmTokenSource({ config, jewelosAccessToken: async () => null, fetch: fetcher });
    await expect(source.token()).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("returns null when the bridge refuses, and remembers the refusal for 30 s", async () => {
    let now = 1_000_000;
    const { fetcher, calls } = bridge([
      { status: 403, body: { error: "CRM access is not enabled for your account.", code: "no_crm_permission" } },
      { status: 200, body: { access_token: "crm-1", expires_at: 9_999_999 } },
    ]);
    const source = crmTokenSource({ config, jewelosAccessToken: async () => "jw-1", fetch: fetcher, now: () => now });
    await expect(source.token()).resolves.toBeNull();
    await expect(source.token()).resolves.toBeNull();
    expect(calls).toHaveLength(1);
    now += 31_000;
    await expect(source.token()).resolves.toBe("crm-1");
  });

  it("does not remember a server error: the next request exchanges again", async () => {
    const { fetcher, calls } = bridge([
      { status: 503, body: { error: "CRM sign-in is unavailable" } },
      { status: 200, body: { access_token: "crm-1", expires_at: 9_999_999 } },
    ]);
    const source = crmTokenSource({ config, jewelosAccessToken: async () => "jw-1", fetch: fetcher });
    await expect(source.token()).resolves.toBeNull();
    await expect(source.token()).resolves.toBe("crm-1");
    expect(calls).toHaveLength(2);
  });

  it("returns null on a network failure and tries again next time", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "crm-1", expires_at: 9_999_999 }), { status: 200 }));
    const source = crmTokenSource({ config, jewelosAccessToken: async () => "jw-1", fetch: fetcher as unknown as typeof fetch });
    await expect(source.token()).resolves.toBeNull();
    await expect(source.token()).resolves.toBe("crm-1");
  });

  it("forgets the CRM token on invalidate (sign-out)", async () => {
    const { fetcher, calls } = bridge([
      { status: 200, body: { access_token: "crm-1", expires_at: 9_999_999 } },
      { status: 200, body: { access_token: "crm-2", expires_at: 9_999_999 } },
    ]);
    const source = crmTokenSource({ config, jewelosAccessToken: async () => "jw-1", fetch: fetcher });
    await source.token();
    source.invalidate();
    await expect(source.token()).resolves.toBe("crm-2");
    expect(calls).toHaveLength(2);
  });
});

describe("retryOnUnauthorized", () => {
  it("re-exchanges and retries a CRM-project 401 once with the fresh token", async () => {
    const source = { token: vi.fn().mockResolvedValue("crm-fresh"), invalidate: vi.fn() };
    const base = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const wrapped = retryOnUnauthorized(source, config.url, base as unknown as typeof fetch);
    const response = await wrapped("https://crm.example.invalid/rest/v1/clients", { headers: { Authorization: "Bearer crm-old" } });
    expect(response.status).toBe(200);
    expect(source.invalidate).toHaveBeenCalledOnce();
    expect(base).toHaveBeenCalledTimes(2);
    expect(new Headers((base.mock.calls[1][1] as RequestInit).headers).get("Authorization")).toBe("Bearer crm-fresh");
  });

  it("does not retry other origins, the bridge itself, or when no fresh token is available", async () => {
    for (const url of ["https://jewelos.example.invalid/rest/v1/x", EXCHANGE]) {
      const source = { token: vi.fn().mockResolvedValue("crm-fresh"), invalidate: vi.fn() };
      const base = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
      const response = await retryOnUnauthorized(source, config.url, base as unknown as typeof fetch)(url, {});
      expect(response.status).toBe(401);
      expect(base).toHaveBeenCalledTimes(1);
    }
    const source = { token: vi.fn().mockResolvedValue(null), invalidate: vi.fn() };
    const base = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    const response = await retryOnUnauthorized(source, config.url, base as unknown as typeof fetch)("https://crm.example.invalid/rest/v1/clients", {});
    expect(response.status).toBe(401);
    expect(base).toHaveBeenCalledTimes(1);
  });
});
