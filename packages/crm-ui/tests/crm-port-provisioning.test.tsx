// @vitest-environment jsdom
// crm-port addition (no original counterpart). D2: the CRM root loader asks the database to
// provision the caller's CRM user (crm.ensure_my_crm_user) before any other CRM query, once per
// mount; a failure leaves access to the layout's own get_my_profile check. The embedded-mode
// auth override stands in for supabase.auth.getUser().
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CrmApp } from "@/crm-port/crm-app";

type Call = string;

function fakeClient(calls: Call[], { ensureFails = false, profile = [] as unknown[] } = {}) {
  const query = (table: string) => {
    const result = Promise.resolve({ data: [], error: null });
    // Any filter/order method returns the same chain; awaiting it yields no rows.
    const chain: object = new Proxy({}, {
      get: (_, prop) => prop === "then" ? result.then.bind(result)
        : prop === "single" || prop === "maybeSingle" ? () => Promise.resolve({ data: null, error: null })
          : () => chain,
    });
    calls.push(`from:${table}`);
    return chain;
  };
  const rpc = (name: string) => {
    calls.push(`rpc:${name}`);
    if (name === "ensure_my_crm_user") return ensureFails ? Promise.reject(new Error("offline")) : Promise.resolve({ data: "created", error: null });
    if (name === "get_my_profile") return Promise.resolve({ data: profile, error: null });
    return Promise.resolve({ data: null, error: null });
  };
  const crm = { from: query, rpc };
  return {
    schema: () => crm,
    storage: {},
    functions: {},
    get auth(): never { throw new Error("supabase.auth must not be used when an auth override is given"); },
  };
}

function renderCrm(calls: Call[], options?: Parameters<typeof fakeClient>[1]) {
  const auth = {
    getUser: async () => {
      calls.push("auth:getUser");
      return { data: { user: { id: "auth-user", email: "person@example.invalid" } }, error: null };
    },
  };
  // The fake implements only the surface the port uses; the cast is local to this test.
  const supabase = fakeClient(calls, options) as unknown as Parameters<typeof CrmApp>[0]["supabase"];
  return render(<CrmApp auth={auth} jewelosHomePath="/" navigate={() => undefined} onSignOut={() => undefined} path="/crm/dashboard" search="" supabase={supabase} />);
}

describe("CRM root loader provisioning", () => {
  it("calls ensure_my_crm_user first, then the layout and page queries", async () => {
    const calls: Call[] = [];
    renderCrm(calls);
    await screen.findByText("No CRM access");
    expect(calls[0]).toBe("rpc:ensure_my_crm_user");
    expect(calls.filter((call) => call === "rpc:ensure_my_crm_user")).toHaveLength(1);
    expect(calls).toContain("rpc:get_my_profile");
    expect(calls).toContain("auth:getUser");
  });

  it("still loads (and denies through get_my_profile) when provisioning fails", async () => {
    const calls: Call[] = [];
    renderCrm(calls, { ensureFails: true });
    await screen.findByText("No CRM access");
    await waitFor(() => expect(calls).toContain("rpc:get_my_profile"));
    expect(calls[0]).toBe("rpc:ensure_my_crm_user");
  });
});
