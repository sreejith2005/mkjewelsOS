// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CrmLayout from "@/app/(crm)/layout";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.auth }, rpc: mocks.rpc }) }));
vi.mock("@/components/crm-shell", () => ({ CrmShell: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/crm-port/access", () => ({ NoCrmAccess: () => <div>No CRM access</div>, leaveForJewelosLogin: () => { throw new Error("Login required"); } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("propagates a failed profile read instead of discarding the page as no access", async () => {
  const error = { code: "", message: "TypeError: Failed to fetch" };
  mocks.auth.mockResolvedValue({ data: { user: { id: "synthetic" } }, error: null });
  mocks.rpc.mockResolvedValue({ data: null, error });
  await expect(CrmLayout({ children: <input /> })).rejects.toBe(error);
});
it("still denies a successful empty profile response", async () => {
  mocks.auth.mockResolvedValue({ data: { user: { id: "synthetic" } }, error: null });
  mocks.rpc.mockResolvedValue({ data: [], error: null });
  render(await CrmLayout({ children: <input /> }));
  expect(screen.queryByText("No CRM access")).not.toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
});
it("still leaves for login before querying a profile when signed out", async () => {
  mocks.auth.mockResolvedValue({ data: { user: null }, error: null });
  await expect(CrmLayout({ children: <input /> })).rejects.toThrow("Login required");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
