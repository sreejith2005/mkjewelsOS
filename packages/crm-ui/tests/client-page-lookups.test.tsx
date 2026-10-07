// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { notFound } from "@/next-shim/navigation";

let clientError: { message: string; code: string } | null = null;
afterEach(() => { clientError = null; vi.clearAllMocks(); });

const lookups = {
  lookup_beverages: [{ label: "Tea" }],
  lookup_snacks: [{ label: "Nuts" }],
  lookup_sugar_options: [{ label: "No sugar" }],
  lookup_communities: [{ label: "Nair" }],
  lookup_gifts: [{ label: "Birthday" }],
};

function responseFor(table: string) {
  const data = table === "clients" ? { client_id: "client-1", primary_name: "Anita", last_branch_id: null }
    : table === "client_timeline" || table === "client_edit_log" ? []
      : table === "branches" ? []
        : table === "users" ? { branch_id: null }
          : table === "client_identity" ? { referral_code: "MKREF-1", household_id: null }
      : lookups[table as keyof typeof lookups] ?? [];
  const result = Promise.resolve(table === "clients" && clientError ? { data: null, error: clientError } : { data, error: null });
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    in: () => query,
    single: () => result,
    maybeSingle: () => result,
    neq: () => query,
    range: () => query,
    then: result.then.bind(result),
  };
  return query;
}

vi.mock("@/next-shim/navigation", () => ({ notFound: vi.fn() })); // crm-port: next/navigation -> local shim module
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({
  from: responseFor,
  rpc: vi.fn(async () => ({ data: [{ role: "salesperson" }], error: null })),
  auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
})) }));
vi.mock("@/components/client-profile", () => ({
  ClientProfile: ({ lookups: profileLookups }: { lookups: Record<string, string[]> }) => <output>{JSON.stringify(profileLookups)}</output>,
}));

import ClientPage from "@/app/(crm)/clients/[clientId]/page";

describe("ClientPage lookup loading", () => {
  it("propagates a transient client read failure instead of declaring the client missing", async () => {
    clientError = { message: "TypeError: Failed to fetch", code: "" };
    await expect(ClientPage({ params: Promise.resolve({ clientId: "client-1" }) })).rejects.toBe(clientError);
    expect(notFound).not.toHaveBeenCalled();
  });
  it("renders all lookup arrays after unwrapping Supabase response data", async () => {
    render(await ClientPage({ params: Promise.resolve({ clientId: "client-1" }) }));

    expect(screen.getByText(/No sugar/)).toBeTruthy();
    expect(screen.getByText(/Tea/)).toBeTruthy();
    expect(screen.getByText(/Nair/)).toBeTruthy();
  });
});
