// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type Listener = (event: string, session: unknown) => void;

const mocks = vi.hoisted(() => {
  const state = { listener: null as Listener | null, profileReads: 0 };
  const session = { user: { id: "auth-1" }, access_token: "a", refresh_token: "r" };
  const refreshed = { ...session, access_token: "b" };
  const profile = { id: "p-1", auth_user_id: "auth-1", tenant_id: "t-1", branch_id: "b-1", user_role: "staff", account_status: "active", working_status: "active", is_login_enabled: true };
  const query = (table: string) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => {
        if (table === "user_profiles") { state.profileReads += 1; return { data: profile, error: null }; }
        if (table === "branches") return { data: { id: "b-1", name: "Main" }, error: null };
        return { data: null, error: null };
      },
    };
    return builder;
  };
  const supabase = {
    from: vi.fn(query),
    rpc: vi.fn(async () => ({ data: null, error: { message: "not deployed" } })),
    channel: vi.fn(() => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) })),
    removeChannel: vi.fn(),
    auth: {
      getSession: vi.fn(async () => {
        // supabase-js reports the stored session as INITIAL_SESSION on subscribe.
        state.listener?.("INITIAL_SESSION", session);
        return { data: { session }, error: null };
      }),
      refreshSession: vi.fn(async () => {
        state.listener?.("TOKEN_REFRESHED", refreshed);
        return { data: { session: refreshed }, error: null };
      }),
      onAuthStateChange: vi.fn((listener: Listener) => {
        state.listener = listener;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signOut: vi.fn(async () => ({ error: null })),
    },
  };
  return { state, supabase };
});

vi.mock("@jewelos/api-client", () => ({ supabase: mocks.supabase }));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: () => undefined }));
vi.mock("@/features/dropdowns/api", () => ({ invalidateMasterOptions: () => undefined }));

import { AuthProvider, useAuth } from "./AuthContext";

function Probe() {
  const { status, branch, session } = useAuth();
  return <p>{status}|{branch?.name ?? "-"}|{session?.access_token ?? "-"}</p>;
}

afterEach(() => { mocks.state.profileReads = 0; mocks.state.listener = null; });

describe("AuthProvider boot", () => {
  it("opens with one profile load when only the token refreshed", async () => {
    await act(async () => { render(<AuthProvider><Probe /></AuthProvider>); });
    await waitFor(() => expect(screen.getByText(/^authenticated\|Main\|b$/)).toBeTruthy());
    expect(mocks.state.profileReads).toBe(1);
  });
});
