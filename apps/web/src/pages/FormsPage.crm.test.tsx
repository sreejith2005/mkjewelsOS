// @vitest-environment jsdom
// CRM forms in Forms Library (owner request 2026-11-03): the forms CRM uses for registration are
// ordinary Forms Library forms, listed under CRM forms; Fill form opens CRM registration.
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormBundle } from "@/features/forms/api";
import type { UserProfile } from "@/types";
import { FormsPage } from "./FormsPage";

const mocks = vi.hoisted(() => ({ loadForms: vi.fn(), loadFmsBuiltForms: vi.fn(), loadCrmLinkedFamilies: vi.fn(), role: "super_admin" }));
vi.mock("@/auth/AuthContext", async () => {
  const { builtinAccessContext } = await vi.importActual<typeof import("@jewelos/core")>("@jewelos/core");
  return { useAuth: () => { const profile = { id: "user", tenant_id: "tenant", user_role: mocks.role } as UserProfile; return { profile, access: builtinAccessContext(profile) }; } };
});
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: () => undefined }));
vi.mock("@/features/forms/FormBuilder", () => ({ FormBuilder: () => <div>Builder</div> }));
vi.mock("@/features/forms/FmsStartingForm", () => ({ FmsStartingForm: () => <div>Assigned form</div> }));
vi.mock("@/features/crm/crmFormLinks", async (importOriginal) => ({ ...await importOriginal<typeof import("@/features/crm/crmFormLinks")>(), loadCrmLinkedFamilies: mocks.loadCrmLinkedFamilies }));
vi.mock("@/features/forms/api", () => ({
  loadForms: mocks.loadForms, loadFmsBuiltForms: mocks.loadFmsBuiltForms, setFormLibraryVisibility: vi.fn(),
  loadFormDynamicOptions: async () => ({ users: [], branches: [], departments: [], masters: [] }),
  deletedFormBundle: () => null,
}));
const form = (id: string, name: string, visible = true) => ({ id, family_id: `family-${id}`, name, version: 1, lifecycle: "published", library_visible: visible, permissions: { roles: ["staff"] }, fields: [], sections: [], submissionCount: 0 }) as unknown as FormBundle;

beforeEach(() => {
  mocks.role = "super_admin";
  mocks.loadForms.mockResolvedValue({ bundles: [form("survey", "Customer survey"), form("lead", "Lead registration", false), form("queue", "Client queue registration", false)], submissions: [] });
  mocks.loadFmsBuiltForms.mockResolvedValue(new Map());
  mocks.loadCrmLinkedFamilies.mockResolvedValue(new Map([["family-lead", "lead"], ["family-queue", "queue"]]));
  window.history.replaceState({}, "", "/forms");
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("CRM forms in Forms Library", () => {
  it("lists the forms CRM uses under CRM forms, apart from the other library forms", async () => {
    const user = userEvent.setup(); render(<FormsPage />);
    expect(await screen.findByText("Customer survey")).toBeTruthy();
    const crm = await screen.findByRole("button", { name: /CRM forms/ });
    expect(within(crm).getByText("2")).toBeTruthy();
    expect(screen.queryByText("Lead registration")).toBeNull();
    await user.click(crm);
    expect(screen.getByText("Lead registration")).toBeTruthy();
    expect(screen.getByText("Client queue registration")).toBeTruthy();
    expect(screen.queryByText("Customer survey")).toBeNull();
    expect(screen.getByText(/Forms CRM uses to register people/)).toBeTruthy();
  });

  it("opens CRM registration when a CRM form is filled, so the client or lead is really registered", async () => {
    const user = userEvent.setup(); render(<FormsPage />);
    await user.click(await screen.findByRole("button", { name: /CRM forms/ }));
    const card = screen.getByText("Lead registration").closest("article") ?? document.body;
    const popstate = vi.fn(); window.addEventListener("popstate", popstate);
    await user.click(within(card as HTMLElement).getAllByRole("button", { name: /Fill form/ })[0]!);
    expect(window.location.pathname + window.location.search).toBe("/crm/queue?register=lead");
    expect(popstate).toHaveBeenCalled();
    window.removeEventListener("popstate", popstate);
  });

  it("shows no CRM group without CRM forms", async () => {
    mocks.loadCrmLinkedFamilies.mockResolvedValue(new Map());
    render(<FormsPage />);
    expect(await screen.findByText("Customer survey")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /CRM forms/ })).toBeNull();
  });
});
