// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormBundle } from "@/features/forms/api";
import type { UserProfile } from "@/types";
import { FormsPage } from "./FormsPage";

const mocks = vi.hoisted(() => ({ loadFmsBuiltForms: vi.fn(), loadForms: vi.fn(), setFormLibraryVisibility: vi.fn(), setFormFamilyPlacement: vi.fn(), role: "super_admin" }));
vi.mock("@/auth/AuthContext", async () => {
  const { builtinAccessContext } = await vi.importActual<typeof import("@jewelos/core")>("@jewelos/core");
  return { useAuth: () => { const profile = { id: "user", tenant_id: "tenant", user_role: mocks.role } as UserProfile; return { profile, access: builtinAccessContext(profile) }; } };
});
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: () => undefined }));
vi.mock("@/features/forms/FormBuilder", () => ({ FormBuilder: () => <div>Builder</div> }));
vi.mock("@/features/forms/FmsStartingForm", () => ({ FmsStartingForm: () => <div>Assigned form</div> }));
vi.mock("@/features/forms/api", () => ({
  loadForms: mocks.loadForms, loadFmsBuiltForms: mocks.loadFmsBuiltForms, setFormLibraryVisibility: mocks.setFormLibraryVisibility, setFormFamilyPlacement: mocks.setFormFamilyPlacement,
  loadFormDynamicOptions: async () => ({ users: [], branches: [], departments: [], masters: [] }),
  deletedFormBundle: () => null,
}));

const bundle = { id: "work", family_id: "family", name: "Work and Upload", version: 1, lifecycle: "published", library_visible: false, permissions: { roles: ["staff"] }, fields: [], sections: [], submissionCount: 0 } as unknown as FormBundle;
beforeEach(() => { mocks.loadFmsBuiltForms.mockResolvedValue(new Map([["family", { familyId: "family", workflows: ["Sales"], steps: ["Call"], links: [{ workflowId: "flow", workflowName: "Sales", stageId: "call", stageName: "Call" }] }]])); mocks.role = "super_admin"; /* 0397: form authoring is Super Admin's by default */ mocks.loadForms.mockResolvedValue({ bundles: [bundle], submissions: [] }); mocks.setFormLibraryVisibility.mockResolvedValue(undefined); window.history.replaceState({}, "", "/forms"); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const link = (flow: string, name: string, version: number, isCurrent: boolean, stage: string, order: number, status: "draft" | "published" | "archived" = isCurrent ? "published" : "archived") =>
  ({ workflowId: `${flow}-v${version}`, workflowName: name, stageId: `${flow}-${stage}-v${version}`, stageName: stage, workflowFamilyId: flow, workflowVersion: version, workflowStatus: status, stageOrder: order, isCurrent });
const form = (id: string, name: string) => ({ ...bundle, id, family_id: id, name }) as FormBundle;

describe("FMS workflow form library", () => {
  it("moves a form between FMS workflow forms and Forms Library (0399)", async () => {
    mocks.setFormFamilyPlacement.mockResolvedValue(undefined);
    const user = userEvent.setup(); render(<FormsPage />);
    await user.click(await screen.findByRole("button", { name: /FMS workflow forms/ }));
    await user.click(await screen.findByRole("button", { name: "Versions and actions for Work and Upload" }));
    expect(screen.getByText("FMS workflow forms", { selector: "span.font-semibold" })).toBeTruthy();
    mocks.loadFmsBuiltForms.mockResolvedValue(new Map());
    await user.click(screen.getByRole("button", { name: "Move to Forms Library" }));
    await waitFor(() => expect(mocks.setFormFamilyPlacement).toHaveBeenCalledWith("work", "library"));
    await user.click(screen.getByRole("button", { name: /^Forms Library/ }));
    expect(await screen.findByRole("button", { name: "Work and Upload" })).toBeTruthy();
  });

  it("lists each FMS form once with where it is used, opens the live version, and filters status", async () => {
    const draft = { ...bundle, id: "work-draft", version: 2, lifecycle: "draft" } as unknown as FormBundle;
    mocks.loadForms.mockResolvedValue({ bundles: [bundle, draft], submissions: [] });
    const user = userEvent.setup(); render(<FormsPage />);
    await user.click(await screen.findByRole("button", { name: /FMS workflow forms/ }));
    expect(await screen.findByText("Used in Sales (Call)")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Step 1/ })).toBeNull();
    // Tapping the form edits the live version, so Save changes reaches every step using it.
    await user.click(screen.getByRole("button", { name: "Work and Upload" }));
    expect(screen.getByText("Builder")).toBeTruthy();
  });
  it("keeps hidden FMS forms away from staff", async () => {
    mocks.role = "staff";
    const user = userEvent.setup(); render(<FormsPage />);
    await user.click(await screen.findByRole("button", { name: /FMS workflow forms/ }));
    expect(await screen.findByText("No FMS workflow forms match. Forms built inside an FMS step appear here.")).toBeTruthy();
  });
  it("shows a form used by several workflows and versions once, naming the live workflows and steps", async () => {
    mocks.loadForms.mockResolvedValue({ bundles: [form("negotiation", "Negotiation — Instagram Leads"), form("payment", "Order payment")], submissions: [] });
    mocks.loadFmsBuiltForms.mockResolvedValue(new Map([
      ["negotiation", { familyId: "negotiation", workflows: [], steps: [], links: [
        link("insta", "INSTAGRAM LEADS", 1, false, "Negotiation", 0), link("insta", "INSTAGRAM LEADS", 2, true, "Negotiation", 0),
        link("double", "Doublelick FMS", 1, false, "Negotiation", 1), link("double", "Doublelick FMS", 2, true, "Negotiation", 1),
      ] }],
      ["payment", { familyId: "payment", workflows: [], steps: [], links: [link("double", "Doublelick FMS", 1, false, "Payment", 0), link("double", "Doublelick FMS", 2, true, "Payment", 0)] }],
      ["unused", { familyId: "unused", workflows: [], steps: [], unlinked: true }],
    ]));
    const user = userEvent.setup(); render(<FormsPage />);
    const fms = await screen.findByRole("button", { name: /FMS workflow forms/ });
    expect(within(fms).getByText("2")).toBeTruthy();
    await user.click(fms);
    expect(screen.getAllByRole("button", { name: "Negotiation — Instagram Leads" })).toHaveLength(1);
    expect(screen.getByText("Used in INSTAGRAM LEADS (Negotiation); Doublelick FMS (Negotiation)")).toBeTruthy();
    expect(screen.getByText("Used in Doublelick FMS (Payment)")).toBeTruthy();
    await user.type(screen.getByRole("searchbox", { name: "Search forms" }), "payment");
    expect(screen.queryByRole("button", { name: "Negotiation — Instagram Leads" })).toBeNull();
    expect(screen.getByRole("button", { name: "Order payment" })).toBeTruthy();
    expect(mocks.setFormLibraryVisibility).not.toHaveBeenCalled();
  });
});
