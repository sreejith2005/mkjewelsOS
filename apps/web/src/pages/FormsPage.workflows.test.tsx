// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormBundle } from "@/features/forms/api";
import type { UserProfile } from "@/types";
import { FormsPage } from "./FormsPage";

const mocks = vi.hoisted(() => ({ loadFormProvenance: vi.fn(), loadForms: vi.fn(), setFormLibraryVisibility: vi.fn(), role: "admin" }));
vi.mock("@/auth/AuthContext", async () => {
  const { builtinAccessContext } = await vi.importActual<typeof import("@jewelos/core")>("@jewelos/core");
  return { useAuth: () => { const profile = { id: "user", tenant_id: "tenant", user_role: mocks.role } as UserProfile; return { profile, access: builtinAccessContext(profile) }; } };
});
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: () => undefined }));
vi.mock("@/features/forms/FormBuilder", () => ({ FormBuilder: () => <div>Builder</div> }));
vi.mock("@/features/forms/FmsStartingForm", () => ({ FmsStartingForm: () => <div>Assigned form</div> }));
vi.mock("@/features/forms/api", () => ({
  loadForms: mocks.loadForms, setFormLibraryVisibility: mocks.setFormLibraryVisibility,
  loadFormDynamicOptions: async () => ({ users: [], branches: [], departments: [], masters: [] }),
  deletedFormBundle: () => null,
}));
vi.mock("@/features/forms/historyApi", () => ({ loadFormProvenance: mocks.loadFormProvenance }));
const bundle = { id: "work", family_id: "family", name: "Work and Upload", version: 1, lifecycle: "published", library_visible: false, permissions: { roles: ["staff"] }, fields: [], sections: [], submissionCount: 0 } as unknown as FormBundle;
beforeEach(() => { mocks.loadFormProvenance.mockResolvedValue({ work: { origin: "fms", family_id: "family", created_at: "", source_flow_id: "flow", source_flow_name: "Sales", source_stage_name: "Call" } }); mocks.role = "admin"; mocks.loadForms.mockResolvedValue({ bundles: [bundle], submissions: [] }); mocks.setFormLibraryVisibility.mockResolvedValue(undefined); window.history.replaceState({}, "", "/forms"); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("FMS workflow form library", () => {
  it("shows workflow then stage then existing form actions, and filters status", async () => {
    const user = userEvent.setup(); render(<FormsPage />);
    await user.selectOptions(await screen.findByRole("combobox", { name: "Origin filter" }), "fms");
    expect(await screen.findByRole("heading", { name: "Sales" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Call" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Work and Upload" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create new version" })).toBeTruthy();
    await user.selectOptions(screen.getByRole("combobox", { name: "Lifecycle filter" }), "draft");
    expect(await screen.findByText("No forms match these filters.")).toBeTruthy();
  });
  it("searches workflow and stage labels and preserves hidden-library restrictions", async () => {
    mocks.role = "staff";
    const user = userEvent.setup(); render(<FormsPage />);
    await user.selectOptions(await screen.findByRole("combobox", { name: "Origin filter" }), "fms");
    expect(await screen.findByText("No forms match these filters.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Sales" })).toBeNull();
  });
  it("filters workflow and stage without changing persisted forms", async () => {
    const user = userEvent.setup(); render(<FormsPage />);
    await user.selectOptions(await screen.findByRole("combobox", { name: "Origin filter" }), "fms");
    await user.selectOptions(await screen.findByRole("combobox", { name: "Workflow filter" }), "flow");
    await user.selectOptions(screen.getByRole("combobox", { name: "Stage filter" }), "Call");
    await user.type(screen.getByRole("textbox", { name: "Search forms" }), "sales call");
    expect(screen.getByRole("heading", { name: "Work and Upload" })).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "Search forms" }), " unavailable");
    expect(await screen.findByText("No forms match these filters.")).toBeTruthy();
    expect(mocks.setFormLibraryVisibility).not.toHaveBeenCalled();
  });
});
