// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DropdownMasterPage } from "./DropdownMasterPage";

const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@jewelos/api-client", () => ({ supabase: { rpc: state.rpc } }));
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ access: { permissions: ["dropdowns.manage"] }, profile: { tenant_id: "t1" } }) }));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: () => undefined }));
vi.mock("@jewelos/core", async (importOriginal) => ({ ...await importOriginal<typeof import("@jewelos/core")>(), hasPermission: () => true }));

const row = (id: string, master_type: string, label: string, extra: Record<string, unknown> = {}) => ({
  id, tenant_id: "t1", master_type, label, value: label.toLowerCase().replace(/\W+/g, "_"), sort_order: 0, is_active: true,
  created_by: "u1", updated_by: "u1", created_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T10:00:00Z", ...extra,
});
vi.mock("@/features/dropdowns/api", () => ({
  invalidateMasterOptions: () => undefined,
  loadDropdownMasterRows: async () => [
    row("d1", "designation", "Sales Executive", { created_by: null }),
    row("l1", "lead_source", "Walk-in"), row("l2", "lead_source", "Instagram", { is_active: false }),
    row("o1", "occasion", "Wedding"), row("o2", "occasion", "Birthday"),
  ],
  loadDropdownListInsights: async () => ({
    madeInForms: new Map([["occasion", "2026-10-28T09:00:00Z"]]),
    builtIn: new Set(["designation"]),
    usedBy: new Map([["occasion", [{ formTemplateId: "f1", name: "Visit form", lifecycle: "published", questions: ["Occasion"] }]]]),
    complete: true,
  }),
}));

describe("Dropdown Master overview", () => {
  beforeEach(() => { window.history.replaceState({}, "", "/dropdown-master"); state.rpc.mockReset(); state.rpc.mockResolvedValue({ error: null }); });
  afterEach(() => cleanup());

  it("shows every list with counts, origin and form usage", async () => {
    render(<DropdownMasterPage />);
    const occasion = await screen.findByRole("button", { name: "Open Occasion" });
    expect(within(occasion).getByText("Made in a form")).toBeTruthy();
    expect(within(occasion).getByText(/2 active · used in 1 form/)).toBeTruthy();
    expect(within(screen.getByRole("button", { name: "Open Lead Source" })).getByText("Made in Dropdown Master")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: "Open Lead Source" })).getByText(/1 active · 1 off/)).toBeTruthy();
    expect(within(screen.getByRole("button", { name: "Open Designation" })).getByText("Built-in")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Made in forms" }));
    expect(screen.queryByRole("button", { name: "Open Lead Source" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open Occasion" })).toBeTruthy();
  });

  it("finds a list by one of its options and opens it with its forms", async () => {
    const user = userEvent.setup();
    render(<DropdownMasterPage />);
    await screen.findByRole("button", { name: "Open Occasion" });
    await user.type(screen.getByLabelText("Search lists and options"), "birth");
    expect(screen.getByText("Matches: Birthday")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Open Occasion" }));
    expect(window.location.search).toBe("?category=occasion");
    expect(screen.getByText("Visit form")).toBeTruthy();
    expect(screen.getByText("Wedding")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "All lists" }));
    expect(window.location.search).toBe("");
  });

  it("turns items off and on instead of claiming to delete them", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/dropdown-master?category=lead_source");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DropdownMasterPage />);
    await user.click(await screen.findByRole("button", { name: "Turn off Walk-in" }));
    expect(state.rpc).toHaveBeenLastCalledWith("change_dropdown_with_audit", expect.objectContaining({ p_record_id: "l1", p_is_active: false }));
    await user.click(screen.getByRole("button", { name: "Turn on Instagram" }));
    expect(state.rpc).toHaveBeenLastCalledWith("change_dropdown_with_audit", expect.objectContaining({ p_record_id: "l2", p_is_active: true }));
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
  });

  it("stores a new list under the same key format forms use", async () => {
    const user = userEvent.setup();
    render(<DropdownMasterPage />);
    await screen.findByRole("button", { name: "Open Occasion" });
    await user.click(screen.getByRole("button", { name: "New list" }));
    await user.type(screen.getByLabelText("List name"), "Gift Type");
    await user.type(screen.getByLabelText("Label"), "Coin");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(state.rpc).toHaveBeenCalledWith("change_dropdown_with_audit", expect.objectContaining({ p_operation: "create", p_master_type: "gift_type", p_label: "Coin", p_value: "coin" }));
  });
});
