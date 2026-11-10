// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "@/types";
import { SettingsView } from "./SettingsView";

const mocks = vi.hoisted(() => ({ role: "manager" }));
vi.mock("@/auth/AuthContext", async () => {
  const { builtinAccessContext } = await vi.importActual<typeof import("@jewelos/core")>("@jewelos/core");
  return { useAuth: () => { const profile = { id: "user", tenant_id: "tenant", user_role: mocks.role, branch_id: null, employee_name: "Test", email: "t@example.in" } as unknown as UserProfile; return { profile, access: builtinAccessContext(profile), signOut: async () => undefined }; } };
});
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: () => undefined }));
vi.mock("./SettingsSectionNav", () => ({ SettingsSectionNav: () => null }));
vi.mock("./ChangePasswordCard", () => ({ ChangePasswordCard: () => null }));
vi.mock("./DataPurgeCard", () => ({ DataPurgeCard: () => null }));
vi.mock("./api", async () => {
  const { DEFAULT_SECTION_CONTROLS } = await vi.importActual<typeof import("@jewelos/core")>("@jewelos/core");
  return {
    fetchSettings: async () => ({
      tenant: { id: "tenant", name: "MK Jewels", currency: "INR", timezone: "Asia/Kolkata", settings_version: 3, export_retention_days: 7, export_max_rows: 50000 },
      branches: [], departments: [], preferences: null, sectionControls: DEFAULT_SECTION_CONTROLS,
    }),
    fetchDemoDataPurgeCounts: async () => null, purgeDemoData: vi.fn(), saveBranch: vi.fn(), savePreferences: vi.fn(), saveSectionControls: vi.fn(), saveTenant: vi.fn(),
  };
});

afterEach(() => { cleanup(); mocks.role = "manager"; });

describe("Organization settings, view only (0401)", () => {
  it("shows a Manager the organization settings with nothing to change", async () => {
    render(<SettingsView />);
    const panel = (await screen.findByText("View only. Super Admin changes these.")).closest("section") ?? document.body;
    expect(within(panel as HTMLElement).getByText("MK Jewels")).toBeTruthy();
    expect(within(panel as HTMLElement).getByText("Asia/Kolkata")).toBeTruthy();
    expect(within(panel as HTMLElement).getByText("7 days")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Save organization settings/ })).toBeNull();
    expect(screen.queryByDisplayValue("MK Jewels")).toBeNull();
  });
  it("does not show staff the organization settings", async () => {
    mocks.role = "staff";
    render(<SettingsView />);
    expect(await screen.findByText(/Your role can view assigned identity/)).toBeTruthy();
    expect(screen.queryByText("View only. Super Admin changes these.")).toBeNull();
  });
});
