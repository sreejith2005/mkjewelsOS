// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FmsData } from "@/features/fms/api";
import type { UserProfile } from "@/types";
import { FMSBuilderPage } from "./FMSBuilderPage";

// Per-workflow FMS access (migration 0390) for a staff member without `fms.manage`.
const mocks = vi.hoisted(() => ({
  loadFmsBuilderData: vi.fn(),
  loadFmsLibraryData: vi.fn(),
  loadMyFmsFlowAccess: vi.fn(),
  loadFmsLibraryOutcomes: vi.fn(),
}));
vi.mock("@jewelos/data/fms/outcomes", () => ({ loadFmsLibraryOutcomes: mocks.loadFmsLibraryOutcomes, loadFmsFlowReport: vi.fn(() => new Promise(() => undefined)), defaultFmsReportFilters: vi.fn(() => ({})) }));
vi.mock("@/features/fms/flowAccessApi", () => ({ loadMyFmsFlowAccess: mocks.loadMyFmsFlowAccess }));
vi.mock("@/auth/AuthContext", async () => {
  const { builtinAccessContext } = await vi.importActual<typeof import("@jewelos/core")>("@jewelos/core");
  const profile = { id: "staff", user_role: "staff", branch_id: "andheri", department_id: "sales" } as UserProfile;
  return { useAuth: () => ({ profile, access: builtinAccessContext(profile) }) };
});
vi.mock("@/features/fms/api", async () => ({
  loadFmsBuilderData: mocks.loadFmsBuilderData,
  loadFmsLibraryData: mocks.loadFmsLibraryData,
  loadFmsRuntime: vi.fn(), startFmsInstance: vi.fn(), setFmsFlowActive: vi.fn(), deleteFmsFlow: vi.fn(), eraseFmsFlow: vi.fn(),
  loadFmsFlowDeletionImpact: vi.fn(), deleteFmsWorkflow: vi.fn(), loadFmsWorkflowDeletionImpact: vi.fn(), restoreFmsFlow: vi.fn(),
  archiveFmsFlow: vi.fn(), publishFmsFlow: vi.fn(), reviseFmsFlow: vi.fn(), saveFmsDraft: vi.fn(),
}));
vi.mock("./FMSTasksPage", () => ({ FMSTasksPage: () => <div>Runs</div> }));

const flow = { id: "flow", family_id: "family", version: 1, name: "Sales intake", description: null, status: "published", scope_type: "tenant", branch_id: null, department_id: null, is_active: true, usage_count: 0 };
const other = { ...flow, id: "other", family_id: "other-family", name: "Repairs" };
const data = {
  flows: [flow, other],
  stages: [{ id: "first", fms_flow_id: "flow", stage_key: "details", name: "Customer details", step_type: "task", sort_order: 0, form_template_id: null, planned_time_rule: {}, checklist_definition: [], parallel_target_stage_ids: [] }],
  assignees: [], users: [], availability: [], branches: [], departments: [], branchRules: [], forms: [], formFields: [], statusOptions: [], contextDefaults: [],
} as unknown as FmsData;

afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => {
  window.history.replaceState({}, "", "/fms");
  mocks.loadFmsLibraryData.mockResolvedValue(data);
  mocks.loadFmsBuilderData.mockResolvedValue(data);
  mocks.loadFmsLibraryOutcomes.mockResolvedValue(new Map());
});

describe("per-workflow FMS access", () => {
  it("offers View workflow only on the granted workflow, with no edit actions", async () => {
    mocks.loadMyFmsFlowAccess.mockResolvedValue(new Map([["family", "view"]]));
    render(<FMSBuilderPage />);
    const card = await screen.findByRole("article", { name: "Sales intake" });
    expect(await screen.findByRole("button", { name: "View workflow" })).toBeTruthy();
    expect(card.textContent).not.toContain("New version");
    expect(screen.queryByRole("button", { name: "New workflow" })).toBeNull();
    const repairs = screen.getByRole("article", { name: "Repairs" });
    expect(repairs.textContent).not.toContain("View workflow");
  });

  it("opens the builder view-only: no save, publish or add step", async () => {
    mocks.loadMyFmsFlowAccess.mockResolvedValue(new Map([["family", "view"]]));
    render(<FMSBuilderPage />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "View workflow" }));
    expect((await screen.findAllByText("View only")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Save draft/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Publish$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Step" })).toBeNull();
  });

  it("an edit grant offers a new version but never publishing", async () => {
    mocks.loadMyFmsFlowAccess.mockResolvedValue(new Map([["family", "edit"]]));
    render(<FMSBuilderPage />);
    const card = await screen.findByRole("article", { name: "Sales intake" });
    expect(await screen.findByRole("button", { name: "New version" })).toBeTruthy();
    expect(card.textContent).not.toContain("View workflow");
  });
});
