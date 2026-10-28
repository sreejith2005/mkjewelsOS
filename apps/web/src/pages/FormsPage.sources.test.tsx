// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormBundle } from "@/features/forms/api";
import type { UserProfile } from "@/types";
import { FormsPage } from "./FormsPage";

const mocks = vi.hoisted(() => ({ loadForms: vi.fn(), loadFmsBuiltForms: vi.fn(), role: "admin" }));
vi.mock("@/auth/AuthContext", async () => {
  const { builtinAccessContext } = await vi.importActual<typeof import("@jewelos/core")>("@jewelos/core");
  return { useAuth: () => { const profile = { id: "user", tenant_id: "tenant", user_role: mocks.role } as UserProfile; return { profile, access: builtinAccessContext(profile) }; } };
});
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: () => undefined }));
vi.mock("@/features/forms/FormBuilder", () => ({ FormBuilder: () => <div>Builder</div> }));
vi.mock("@/features/forms/FmsStartingForm", () => ({ FmsStartingForm: () => <div>Assigned form</div> }));
vi.mock("@/features/forms/api", () => ({
  loadForms: mocks.loadForms, loadFmsBuiltForms: mocks.loadFmsBuiltForms, setFormLibraryVisibility: vi.fn(),
  loadFormDynamicOptions: async () => ({ users: [], branches: [], departments: [], masters: [] }),
  deletedFormBundle: () => null,
}));
const form = (id: string, name: string, visible = true) => ({ id, family_id: `family-${id}`, name, version: 1, lifecycle: "published", library_visible: visible, permissions: { roles: ["staff"] }, fields: [], sections: [], submissionCount: 0 }) as unknown as FormBundle;
const bundles = [form("assignee", "Instagram Assignee Form"), form("call", "Introduction Call — Instagram Leads", false)];
beforeEach(() => {
  mocks.role = "admin";
  mocks.loadForms.mockResolvedValue({ bundles, submissions: [] });
  mocks.loadFmsBuiltForms.mockResolvedValue(new Map([["family-call", { familyId: "family-call", workflows: ["INSTAGRAM LEADS"], steps: ["Introduction Call"] }]]));
  window.history.replaceState({}, "", "/forms");
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("Forms Library and FMS workflow forms", () => {
  it("opens on Forms Library forms and switches to the forms built in FMS", async () => {
    const user = userEvent.setup(); render(<FormsPage />);
    expect(await screen.findByText("Instagram Assignee Form")).toBeTruthy();
    expect(screen.queryByText("Introduction Call — Instagram Leads")).toBeNull();
    const library = screen.getByRole("button", { name: /Forms Library/ });
    const fms = screen.getByRole("button", { name: /FMS workflow forms/ });
    expect(library.getAttribute("aria-pressed")).toBe("true");
    expect(within(fms).getByText("1")).toBeTruthy();
    await user.click(fms);
    expect(fms.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Introduction Call — Instagram Leads")).toBeTruthy();
    expect(screen.queryByText("Instagram Assignee Form")).toBeNull();
    expect(screen.getByText("FMS: INSTAGRAM LEADS · Step: Introduction Call")).toBeTruthy();
  });

  it("searches within the chosen group", async () => {
    const user = userEvent.setup(); render(<FormsPage />);
    await screen.findByText("Instagram Assignee Form");
    await user.type(screen.getByRole("searchbox", { name: "Search forms" }), "introduction");
    expect(screen.getByText("No forms match these filters.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /FMS workflow forms/ }));
    expect(screen.getByText("Introduction Call — Instagram Leads")).toBeTruthy();
  });

  it("shows every form together when the FMS list cannot be loaded", async () => {
    mocks.loadFmsBuiltForms.mockRejectedValue(new Error("not deployed yet"));
    render(<FormsPage />);
    expect(await screen.findByText("Introduction Call — Instagram Leads")).toBeTruthy();
    expect(screen.getByText("Instagram Assignee Form")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /FMS workflow forms/ })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
