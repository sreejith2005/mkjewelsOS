import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadFmsLibraryData } from "./api";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@jewelos/api-client/client", () => ({ getSupabase: () => ({ from: mocks.from }) }));

function query(result: { data: unknown; error: { message: string } | null }) {
  const chain = { select: vi.fn(() => chain), order: vi.fn(() => chain), limit: vi.fn(async () => result) };
  return chain;
}
beforeEach(() => { mocks.from.mockReset(); });

describe("FMS library reads", () => {
  it("returns workflow metadata and run-filter people without reading authoring or runtime tables", async () => {
    const flow = { id: "workflow", family_id: "family", name: "Sales", version: 2 };
    const person = { id: "employee", employee_name: "Employee A" };
    mocks.from.mockImplementation((table: string) => {
      if (table === "fms_flows") return query({ data: [flow], error: null });
      if (table === "user_profiles") return query({ data: [person], error: null });
      throw new Error(`Unexpected library table: ${table}`);
    });
    expect(await loadFmsLibraryData()).toEqual({ flows: [flow], users: [person] });
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(["fms_flows", "user_profiles"]);
  });

  it("surfaces authorization/read failures instead of silently showing an empty library", async () => {
    mocks.from.mockImplementation((table: string) => query({ data: [], error: table === "fms_flows" ? { message: "permission denied" } : null }));
    await expect(loadFmsLibraryData()).rejects.toThrow("Load FMS library: permission denied");
  });
});
