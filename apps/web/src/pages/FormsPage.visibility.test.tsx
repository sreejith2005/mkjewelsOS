// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormBundle } from "@/features/forms/api";
import type { UserProfile } from "@/types";
import { FormsPage } from "./FormsPage";

const mocks = vi.hoisted(() => ({ loadForms: vi.fn(), setFormLibraryVisibility: vi.fn(), role: "admin" }));
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
const bundle = { id: "work", family_id: "family", name: "Work and Upload", version: 1, lifecycle: "published", library_visible: false, permissions: { roles: ["staff"] }, fields: [], sections: [], submissionCount: 0 } as unknown as FormBundle;
beforeEach(() => { mocks.role = "admin"; mocks.loadForms.mockResolvedValue({ bundles: [bundle], submissions: [] }); mocks.setFormLibraryVisibility.mockResolvedValue(undefined); window.history.replaceState({}, "", "/forms"); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("Form library visibility", () => {
  it("lets authors reveal hidden forms and shows the saved state", async () => {
    const user = userEvent.setup(); render(<FormsPage />);
    const toggle = await screen.findByRole("switch", { name: /Visible in Forms Library/ });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    mocks.loadForms.mockResolvedValue({ bundles: [{ ...bundle, library_visible: true }], submissions: [] });
    await user.click(toggle);
    await waitFor(() => expect(mocks.setFormLibraryVisibility).toHaveBeenCalledWith("work", true));
    await waitFor(() => expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true"));
  });
  it("keeps the saved visibility when the server refuses the change", async () => {
    mocks.setFormLibraryVisibility.mockRejectedValue(new Error("Visibility change denied"));
    const user = userEvent.setup(); render(<FormsPage />);
    await user.click(await screen.findByRole("switch"));
    expect(await screen.findByText(/Visibility change denied/)).toBeTruthy();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });
  it("hides readable assigned or historical templates from the staff library", async () => {
    mocks.role = "staff"; render(<FormsPage />);
    expect(await screen.findByText("No forms match these filters.")).toBeTruthy();
    expect(screen.queryByText("Work and Upload")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });
  it("continues to list visible forms for staff", async () => {
    mocks.role = "staff"; mocks.loadForms.mockResolvedValue({ bundles: [{ ...bundle, library_visible: true }], submissions: [] });
    render(<FormsPage />);
    expect(await screen.findByText("Work and Upload")).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
  });
  it("opens an exact assigned starter even when its form is hidden from the library", async () => {
    mocks.role = "staff"; window.history.replaceState({}, "", "/forms?fmsStarter=assignment&form=work");
    render(<FormsPage />);
    expect(await screen.findByText("Assigned form")).toBeTruthy();
    expect(screen.getByText("No forms match these filters.")).toBeTruthy();
  });
});
