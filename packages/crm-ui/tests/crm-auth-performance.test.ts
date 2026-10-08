import type { JewelosClient } from "@jewelos/api-client";
import { expect, it, vi } from "vitest";
import { configureCrmHost, crmSupabase, forgetCrmSession } from "@/crm-port/runtime";

vi.mock("@/crm-port/crm-project", () => ({
  crmTokenSource: () => ({ invalidate: vi.fn() }),
  createCrmProjectClient: () => ({ from: vi.fn(), rpc: vi.fn(), schema: vi.fn(), storage: {} }),
}));

function setup() {
  let token: string | null = "session-a";
  const getUser = vi.fn();
  configureCrmHost({
    supabase: {} as JewelosClient, auth: { getUser },
    crmProject: { url: "https://crm.example.invalid", anonKey: "synthetic" },
    jewelosAccessToken: async () => token, navigate: vi.fn(), onSignOut: vi.fn(), jewelosHomePath: "/",
  });
  return { getUser, auth: crmSupabase().auth, setToken: (next: string | null) => { token = next; } };
}
const user = { data: { user: { id: "synthetic-a" } }, error: null };

it("shares a concurrent login verification but verifies again after it settles", async () => {
  const { getUser, auth } = setup();
  let finish!: (result: typeof user) => void;
  getUser.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue(user);
  const a = auth.getUser(); const b = auth.getUser();
  await vi.waitFor(() => expect(getUser).toHaveBeenCalled());
  expect(getUser).toHaveBeenCalledOnce();
  finish(user);
  expect(await a).toEqual(user); expect(await b).toEqual(user);
  await auth.getUser();
  expect(getUser).toHaveBeenCalledTimes(2);
});

it("never shares a pending identity verification across changed sessions", async () => {
  const { getUser, auth, setToken } = setup();
  let finish!: (result: typeof user) => void;
  getUser.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const a = auth.getUser();
  await vi.waitFor(() => expect(getUser).toHaveBeenCalledOnce());
  setToken("session-b");
  const next = { data: { user: { id: "synthetic-b" } }, error: null };
  getUser.mockResolvedValueOnce(next);
  expect(await auth.getUser()).toEqual(next);
  finish(user); await a;
  expect(getUser).toHaveBeenCalledTimes(2);
});

it("preserves denial and network failures and retries the next read", async () => {
  const { getUser, auth } = setup();
  const denied = { data: { user: null }, error: { status: 403 } };
  getUser.mockResolvedValueOnce(denied).mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(user);
  expect(await auth.getUser()).toEqual(denied);
  await expect(auth.getUser()).rejects.toThrow("Failed to fetch");
  expect(await auth.getUser()).toEqual(user);
  expect(getUser).toHaveBeenCalledTimes(3);
  forgetCrmSession();
});

it("also shares the browser Auth client verification using its current session", async () => {
  let finish!: (result: typeof user) => void;
  const getUser = vi.fn(() => new Promise<typeof user>((resolve) => { finish = resolve; }));
  configureCrmHost({
    supabase: { auth: { getUser, getSession: async () => ({ data: { session: { access_token: "browser-session" } } }) } } as unknown as JewelosClient,
    crmProject: { url: "https://crm.example.invalid", anonKey: "synthetic" },
    navigate: vi.fn(), onSignOut: vi.fn(), jewelosHomePath: "/",
  });
  const auth = crmSupabase().auth;
  const reads = [auth.getUser(), auth.getUser()];
  await vi.waitFor(() => expect(getUser).toHaveBeenCalledOnce());
  finish(user);
  expect(await Promise.all(reads)).toEqual([user, user]);
});
