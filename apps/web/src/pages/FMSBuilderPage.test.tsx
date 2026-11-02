// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FmsData } from "@/features/fms/api";
import type { UserProfile } from "@/types";
import { FMSBuilderPage } from "./FMSBuilderPage";

const mocks = vi.hoisted(() => ({
  loadFmsBuilderData: vi.fn(),
  loadFmsRuntime: vi.fn(),
  startFmsInstance: vi.fn(),
  setFmsFlowActive: vi.fn(),
  deleteFmsFlow: vi.fn(),
  eraseFmsFlow: vi.fn(),
  loadFmsFlowDeletionImpact: vi.fn(),
  loadFmsLibraryOutcomes: vi.fn(),
}));
vi.mock("@jewelos/data/fms/outcomes", () => ({ loadFmsLibraryOutcomes: mocks.loadFmsLibraryOutcomes }));

vi.mock("@/auth/AuthContext", async () => {
  const { builtinAccessContext } = await vi.importActual<typeof import("@jewelos/core")>("@jewelos/core");
  const profile = { id: "admin", user_role: "admin", branch_id: "andheri", department_id: "admin" } as UserProfile;
  return { useAuth: () => ({ profile, access: builtinAccessContext(profile) }) };
});
vi.mock("@/features/fms/api", async () => ({
  loadFmsBuilderData: mocks.loadFmsBuilderData,
  loadFmsRuntime: mocks.loadFmsRuntime,
  startFmsInstance: mocks.startFmsInstance,
  setFmsFlowActive: mocks.setFmsFlowActive,
  deleteFmsFlow: mocks.deleteFmsFlow,
  eraseFmsFlow: mocks.eraseFmsFlow,
  loadFmsFlowDeletionImpact: mocks.loadFmsFlowDeletionImpact,
  restoreFmsFlow: vi.fn(),
  archiveFmsFlow: vi.fn(),
  publishFmsFlow: vi.fn(),
  reviseFmsFlow: vi.fn(),
  saveFmsDraft: vi.fn(),
}));
vi.mock("./FMSTasksPage", () => ({ FMSTasksPage: ({ initialInstanceId }: { initialInstanceId?: string }) => <div>Live instance {initialInstanceId ?? "list"}</div> }));

const flow = { id: "flow", family_id: "family", version: 1, name: "Sales intake", description: null, status: "published", scope_type: "department", branch_id: "andheri", department_id: "sales", is_active: true, usage_count: 0 };
const data = {
  flows: [flow],
  stages: [{ id: "first", fms_flow_id: "flow", stage_key: "details", name: "Customer details", step_type: "form", sort_order: 0, form_template_id: "form" }],
  assignees: [{ fms_stage_id: "first", assignee_type: "specific_user", user_profile_id: "owner", fallback_user_profile_id: null, role_value: null, allow_next_selection: false, sort_order: 0 }],
  users: [{ id: "owner", employee_name: "Workflow Owner", user_role: "staff", branch_id: "andheri", department_id: "sales", working_status: "active", account_status: "active", is_login_enabled: true }],
  availability: [], branches: [{ id: "andheri", name: "Andheri" }], departments: [{ id: "sales", branch_id: "andheri", name: "Sales" }], branchRules: [], forms: [],
} as unknown as FmsData;
const runtime = { instances: [], stages: [], definitions: [], flows: [flow], checklist: [], evidence: [], logs: [], users: [] };

afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => { mocks.loadFmsLibraryOutcomes.mockResolvedValue(new Map()); });

describe("unified FMS console", () => {
  it("shows server-counted running and outcome totals on the workflow card without loading the runtime", async () => {
    mocks.loadFmsBuilderData.mockResolvedValue(data);
    mocks.loadFmsLibraryOutcomes.mockResolvedValue(new Map([["family", { familyId: "family", started: 100, running: 38, onHold: 2, completed: 60, cancelled: 0, won: 30, lost: 20, doNotContact: 10, other: 0, unspecified: 0, mine: 3 }]]));
    render(<FMSBuilderPage />);
    const counts = await screen.findByLabelText("Sales intake counts");
    expect(counts.textContent).toContain("Running40");
    expect(counts.textContent).toContain("Won30");
    expect(counts.textContent).toContain("Lost20");
    expect(counts.textContent).toContain("Other endings10");
    expect(screen.getByRole("button", { name: /Tasks \(3\)/ })).toBeTruthy();
    expect(mocks.loadFmsRuntime).not.toHaveBeenCalled();
  });

  it("keeps published workflows form-triggered instead of exposing a manual instance start", async () => {
    mocks.loadFmsBuilderData.mockResolvedValue(data);
    mocks.loadFmsRuntime.mockResolvedValue(runtime);
    render(<FMSBuilderPage />);
    await screen.findByText("Sales intake");
    expect(screen.queryByRole("button", { name: "Start instance" })).toBeNull();
    expect(mocks.startFmsInstance).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "My workflow tasks" })).toBeNull();
  });

  it("pauses a published flow from the same card", async () => {
    mocks.loadFmsBuilderData.mockResolvedValue(data);
    mocks.loadFmsRuntime.mockResolvedValue(runtime);
    mocks.setFmsFlowActive.mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<FMSBuilderPage />);

    await screen.findByText("Sales intake");
    await user.click(screen.getByRole("button", { name: "Pause" }));

    await waitFor(() => expect(mocks.setFmsFlowActive).toHaveBeenCalledWith("flow", false));
  });

  const impact = (action: string, runs = 0, openRuns = 0) => ({ name: "Sales intake", version: 1, status: "published", runs, openRuns, handoffsFrom: [], canErase: action === "erase", action });
  const clickDelete = async () => {
    mocks.loadFmsBuilderData.mockResolvedValue(data);
    mocks.loadFmsRuntime.mockResolvedValue(runtime);
    const user = userEvent.setup();
    render(<FMSBuilderPage />);
    await screen.findByText("Sales intake");
    await user.click(screen.getByRole("button", { name: "Delete Sales intake" }));
  };

  it("deletes a never-run flow permanently after a confirm", async () => {
    mocks.loadFmsFlowDeletionImpact.mockResolvedValue(impact("delete"));
    mocks.deleteFmsFlow.mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await clickDelete();
    await waitFor(() => expect(mocks.deleteFmsFlow).toHaveBeenCalledWith("flow"));
    expect(confirm.mock.calls[0]?.[0]).toContain("permanently? It has never been run.");
    expect(await screen.findByText('"Sales intake" v1 was deleted.')).toBeTruthy();
  });

  it("warns that a flow with runs is archived", async () => {
    mocks.loadFmsFlowDeletionImpact.mockResolvedValue(impact("archive", 3));
    mocks.deleteFmsFlow.mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await clickDelete();
    await waitFor(() => expect(mocks.deleteFmsFlow).toHaveBeenCalledWith("flow"));
    expect(confirm.mock.calls[0]?.[0]).toContain("has 3 runs, so it will be archived");
    expect(mocks.eraseFmsFlow).not.toHaveBeenCalled();
  });

  it("lets a super admin erase a flow with runs only after typing DELETE", async () => {
    mocks.loadFmsFlowDeletionImpact.mockResolvedValue(impact("erase", 4, 1));
    mocks.eraseFmsFlow.mockResolvedValue(undefined);
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("DELETE");
    await clickDelete();
    await waitFor(() => expect(mocks.eraseFmsFlow).toHaveBeenCalledWith("flow", "DELETE"));
    expect(prompt.mock.calls[0]?.[0]).toContain("This erases 4 runs (1 still open)");
    expect(mocks.deleteFmsFlow).not.toHaveBeenCalled();
  });

  it("erases nothing when the typed word is wrong", async () => {
    mocks.loadFmsFlowDeletionImpact.mockResolvedValue(impact("erase", 4));
    vi.spyOn(window, "prompt").mockReturnValue("delete");
    await clickDelete();
    expect(await screen.findByText(/Nothing was deleted/)).toBeTruthy();
    expect(mocks.eraseFmsFlow).not.toHaveBeenCalled();
  });
});
