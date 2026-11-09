// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormBundle } from "@/features/forms/api";
import type { UserProfile } from "@/types";
import { FormsPage } from "./FormsPage";

const mocks = vi.hoisted(() => ({ loadFmsBuiltForms: vi.fn(), loadForms: vi.fn(), setFormLibraryVisibility: vi.fn(), role: "admin" }));
vi.mock("@/auth/AuthContext", async () => {
  const { builtinAccessContext } = await vi.importActual<typeof import("@jewelos/core")>("@jewelos/core");
  return { useAuth: () => { const profile = { id: "user", tenant_id: "tenant", user_role: mocks.role } as UserProfile; return { profile, access: builtinAccessContext(profile) }; } };
});
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: () => undefined }));
vi.mock("@/features/forms/FormBuilder", () => ({ FormBuilder: () => <div>Builder</div> }));
vi.mock("@/features/forms/FmsStartingForm", () => ({ FmsStartingForm: () => <div>Assigned form</div> }));
vi.mock("@/features/forms/api", () => ({
  loadForms: mocks.loadForms, loadFmsBuiltForms: mocks.loadFmsBuiltForms, setFormLibraryVisibility: mocks.setFormLibraryVisibility,
  loadFormDynamicOptions: async () => ({ users: [], branches: [], departments: [], masters: [] }),
  deletedFormBundle: () => null,
}));

const bundle = { id: "work", family_id: "family", name: "Work and Upload", version: 1, lifecycle: "published", library_visible: false, permissions: { roles: ["staff"] }, fields: [], sections: [], submissionCount: 0 } as unknown as FormBundle;
beforeEach(() => { mocks.loadFmsBuiltForms.mockResolvedValue(new Map([["family", { familyId: "family", workflows: ["Sales"], steps: ["Call"], links: [{ workflowId: "flow", workflowName: "Sales", stageId: "call", stageName: "Call" }] }]])); mocks.role = "admin"; mocks.loadForms.mockResolvedValue({ bundles: [bundle], submissions: [] }); mocks.setFormLibraryVisibility.mockResolvedValue(undefined); window.history.replaceState({}, "", "/forms"); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const link = (flow: string, name: string, version: number, isCurrent: boolean, stage: string, order: number, status: "draft" | "published" | "archived" = isCurrent ? "published" : "archived") =>
  ({ workflowId: `${flow}-v${version}`, workflowName: name, stageId: `${flow}-${stage}-v${version}`, stageName: stage, workflowFamilyId: flow, workflowVersion: version, workflowStatus: status, stageOrder: order, isCurrent });
const form = (id: string, name: string) => ({ ...bundle, id, family_id: id, name }) as FormBundle;

describe("FMS workflow form library", () => {
  it("shows workflow then stage then existing form actions, and filters status", async () => {
    const user = userEvent.setup(); render(<FormsPage />);
    await user.click(await screen.findByRole("button", { name: /FMS workflow forms/ }));
    expect((await screen.findByRole("button", { name: /Sales/ })).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("heading", { name: "Step 1: Call" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Work and Upload" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Versions and actions for Work and Upload" }));
    expect(screen.getByRole("button", { name: "Create new version" })).toBeTruthy();
    await user.selectOptions(screen.getByRole("combobox", { name: "Lifecycle filter" }), "draft");
    expect(await screen.findByText("No FMS workflow forms match. Forms built inside an FMS step appear here.")).toBeTruthy();
  });
  it("searches workflow and stage labels and preserves hidden-library restrictions", async () => {
    mocks.role = "staff";
    const user = userEvent.setup(); render(<FormsPage />);
    await user.click(await screen.findByRole("button", { name: /FMS workflow forms/ }));
    expect(await screen.findByText("No FMS workflow forms match. Forms built inside an FMS step appear here.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Sales/ })).toBeNull();
  });
  it("lists each workflow once across saved versions, collapsed until chosen, with step and shared-form tags", async () => {
    mocks.loadForms.mockResolvedValue({ bundles: [form("negotiation", "Negotiation — Instagram Leads"), form("payment", "Order payment")], submissions: [] });
    mocks.loadFmsBuiltForms.mockResolvedValue(new Map([
      ["negotiation", { familyId: "negotiation", workflows: [], steps: [], links: [
        link("insta", "INSTAGRAM LEADS", 1, false, "Negotiation", 0), link("insta", "INSTAGRAM LEADS", 2, true, "Negotiation", 0),
        link("double", "Doublelick FMS", 1, false, "Negotiation", 1), link("double", "Doublelick FMS", 2, true, "Negotiation", 1),
      ] }],
      ["payment", { familyId: "payment", workflows: [], steps: [], links: [link("double", "Doublelick FMS", 1, false, "Payment", 0), link("double", "Doublelick FMS", 2, true, "Payment", 0)] }],
    ]));
    const user = userEvent.setup(); render(<FormsPage />);
    const fms = await screen.findByRole("button", { name: /FMS workflow forms/ });
    expect(within(fms).getByText("2")).toBeTruthy();
    await user.click(fms);
    const double = screen.getByRole("button", { name: /Doublelick FMS/ });
    expect(screen.getAllByRole("button", { name: /INSTAGRAM LEADS|Doublelick FMS/ })).toHaveLength(2);
    expect(double.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("heading", { name: "Order payment" })).toBeNull();
    await user.click(double);
    expect(double.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("heading", { level: 3 }).map(heading => heading.textContent)).toEqual(["Step 1: Payment", "Step 2: Negotiation"]);
    expect(screen.getByText("Doublelick FMS · Step 2 · Negotiation")).toBeTruthy();
    expect(screen.getByText("Also used in INSTAGRAM LEADS")).toBeTruthy();
    await user.click(double);
    expect(screen.queryByRole("heading", { name: "Order payment" })).toBeNull();
    await user.type(screen.getByRole("searchbox", { name: "Search forms" }), "payment");
    expect(await screen.findByRole("heading", { name: "Order payment" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /INSTAGRAM LEADS/ })).toBeNull();
    expect(mocks.setFormLibraryVisibility).not.toHaveBeenCalled();
  });
});
