// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FmsData } from "@/features/fms/api";
import type { UserProfile } from "@/types";
import { FMSBuilderPage } from "./FMSBuilderPage";

const mocks = vi.hoisted(() => ({
  loadFmsBuilderData: vi.fn(),
  loadFmsLibraryData: vi.fn(),
  loadFmsRuntime: vi.fn(),
  startFmsInstance: vi.fn(),
  setFmsFlowActive: vi.fn(),
  deleteFmsFlow: vi.fn(),
  eraseFmsFlow: vi.fn(),
  loadFmsFlowDeletionImpact: vi.fn(),
  deleteFmsWorkflow: vi.fn(),
  loadFmsWorkflowDeletionImpact: vi.fn(),
  loadFmsLibraryOutcomes: vi.fn(),
}));
vi.mock("@jewelos/data/fms/outcomes", () => ({ loadFmsLibraryOutcomes: mocks.loadFmsLibraryOutcomes }));

vi.mock("@/auth/AuthContext", async () => {
  const { builtinAccessContext } = await vi.importActual<typeof import("@jewelos/core")>("@jewelos/core");
  // Migration 0397: building forms and FMS workflows is Super Admin's by default (Admin views only).
  const profile = { id: "admin", user_role: "super_admin", branch_id: "andheri", department_id: "admin" } as UserProfile;
  return { useAuth: () => ({ profile, access: builtinAccessContext(profile) }) };
});
vi.mock("@/features/fms/api", async () => ({
  loadFmsBuilderData: mocks.loadFmsBuilderData,
  loadFmsLibraryData: mocks.loadFmsLibraryData,
  loadFmsRuntime: mocks.loadFmsRuntime,
  startFmsInstance: mocks.startFmsInstance,
  setFmsFlowActive: mocks.setFmsFlowActive,
  deleteFmsFlow: mocks.deleteFmsFlow,
  eraseFmsFlow: mocks.eraseFmsFlow,
  loadFmsFlowDeletionImpact: mocks.loadFmsFlowDeletionImpact,
  deleteFmsWorkflow: mocks.deleteFmsWorkflow,
  loadFmsWorkflowDeletionImpact: mocks.loadFmsWorkflowDeletionImpact,
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
beforeEach(() => { window.history.replaceState({}, "", "/fms"); mocks.loadFmsLibraryData.mockResolvedValue(data); mocks.loadFmsLibraryOutcomes.mockResolvedValue(new Map()); });

describe("unified FMS console", () => {
  it("shows the library without downloading authoring data", async () => {
    mocks.loadFmsBuilderData.mockImplementation(() => new Promise(() => undefined));
    render(<FMSBuilderPage />);
    await screen.findByText("Sales intake");
    expect(mocks.loadFmsBuilderData).not.toHaveBeenCalled();
  });

  it("shows workflows while optional run counts are still loading", async () => {
    mocks.loadFmsBuilderData.mockResolvedValue(data);
    mocks.loadFmsLibraryOutcomes.mockImplementation(() => new Promise(() => undefined));
    render(<FMSBuilderPage />);
    await screen.findByText("Sales intake");
    expect(screen.getByLabelText("Sales intake counts").textContent).not.toContain("Running0");
    await userEvent.setup().click(screen.getByRole("button", { name: "Assigned to me" }));
    expect(screen.queryByText(/No workflows match this view/)).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/loading/i);
  });

  it("loads full authoring data only when New workflow is opened", async () => {
    mocks.loadFmsBuilderData.mockResolvedValue({ ...data, formFields: {} });
    render(<FMSBuilderPage />);
    await screen.findByText("Sales intake");
    expect(mocks.loadFmsBuilderData).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "New workflow" }));
    await screen.findByRole("heading", { name: "Name this workflow" });
    expect(mocks.loadFmsBuilderData).toHaveBeenCalledTimes(1);
  });

  it("keeps failed assignment counts distinct from an empty assignment list", async () => {
    mocks.loadFmsLibraryOutcomes.mockRejectedValueOnce(new Error("Counts unavailable"));
    render(<FMSBuilderPage />);
    await screen.findByText("Sales intake");
    await userEvent.setup().click(screen.getByRole("button", { name: "Assigned to me" }));
    expect(await screen.findByText("Workflow counts are unavailable.")).toBeTruthy();
    expect(screen.queryByText(/No workflows match this view/)).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/No workflows match this view/)).toBeTruthy();
  });

  it("keeps the library usable after an authoring load fails and allows retry", async () => {
    mocks.loadFmsBuilderData.mockRejectedValueOnce(new Error("Builder unavailable")).mockResolvedValue({ ...data, formFields: {} });
    render(<FMSBuilderPage />);
    await screen.findByText("Sales intake");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "New workflow" }));
    await screen.findByText("Builder unavailable", { exact: false });
    expect(screen.getByText("Sales intake")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "New workflow" }));
    await screen.findByRole("heading", { name: "Name this workflow" });
  });

  it("does not reopen the editor when a cancelled authoring request finishes", async () => {
    let finish: ((value: FmsData) => void) | undefined;
    mocks.loadFmsBuilderData.mockImplementation(() => new Promise<FmsData>((resolve) => { finish = resolve; }));
    render(<FMSBuilderPage />);
    await screen.findByText("Sales intake");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "New workflow" }));
    await screen.findByText("Loading workflow editor...");
    await user.click(screen.getByRole("button", { name: /Back to FMS/ }));
    await act(async () => { finish?.({ ...data, formFields: {} }); });
    expect(screen.getByText("Sales intake")).toBeTruthy();
    expect(screen.queryByText("Loading workflow editor...")).toBeNull();
  });

  it("opens assigned instance links without waiting for authoring data", async () => {
    window.history.replaceState({}, "", "/tasks/fms?instance=assigned-run&stage=assigned-stage");
    mocks.loadFmsBuilderData.mockImplementation(() => new Promise(() => undefined));
    render(<FMSBuilderPage />);
    await screen.findByText("Live instance assigned-run");
    expect(mocks.loadFmsBuilderData).not.toHaveBeenCalled();
  });

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
    // Pause and Delete sit in the row's "More actions" menu.
    await user.click(screen.getByRole("button", { name: "More actions for Sales intake" }));
    await user.click(screen.getByRole("menuitem", { name: "Pause" }));

    await waitFor(() => expect(mocks.setFmsFlowActive).toHaveBeenCalledWith("flow", false));
  });

  const impact = (action: string, runs = 0, openRuns = 0) => ({ name: "Sales intake", versions: 3, runs, openRuns, handoffsFrom: [], canErase: action === "erase", action });
  const clickDelete = async () => {
    mocks.loadFmsBuilderData.mockResolvedValue(data);
    mocks.loadFmsRuntime.mockResolvedValue(runtime);
    const user = userEvent.setup();
    render(<FMSBuilderPage />);
    await screen.findByText("Sales intake");
    await user.click(screen.getByRole("button", { name: "More actions for Sales intake" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete Sales intake" }));
  };

  it("deletes a never-run workflow, every version, after a confirm", async () => {
    mocks.loadFmsWorkflowDeletionImpact.mockResolvedValue(impact("delete"));
    mocks.deleteFmsWorkflow.mockResolvedValue("deleted");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await clickDelete();
    await waitFor(() => expect(mocks.deleteFmsWorkflow).toHaveBeenCalledWith("family"));
    expect(mocks.loadFmsWorkflowDeletionImpact).toHaveBeenCalledWith("family");
    expect(confirm.mock.calls[0]?.[0]).toContain('Delete the whole workflow "Sales intake" (3 versions) permanently?');
    expect(await screen.findByText('"Sales intake" was deleted.')).toBeTruthy();
    expect(mocks.deleteFmsFlow).not.toHaveBeenCalled();
  });

  it("tells an admin a workflow with runs is archived", async () => {
    mocks.loadFmsWorkflowDeletionImpact.mockResolvedValue(impact("archive", 3));
    mocks.deleteFmsWorkflow.mockResolvedValue("archived");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await clickDelete();
    await waitFor(() => expect(mocks.deleteFmsWorkflow).toHaveBeenCalledWith("family"));
    expect(confirm.mock.calls[0]?.[0]).toContain("has 3 runs, so all its versions will be archived");
  });

  it("lets a super admin delete the whole workflow with runs after typing DELETE", async () => {
    mocks.loadFmsWorkflowDeletionImpact.mockResolvedValue(impact("erase", 4, 1));
    mocks.deleteFmsWorkflow.mockResolvedValue("deleted");
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("DELETE");
    await clickDelete();
    await waitFor(() => expect(mocks.deleteFmsWorkflow).toHaveBeenCalledWith("family", "DELETE"));
    expect(prompt.mock.calls[0]?.[0]).toContain("This removes all 3 versions and 4 runs (1 still open)");
    expect(await screen.findByText('"Sales intake" was deleted: 3 versions and 4 runs.')).toBeTruthy();
  });

  it("deletes nothing when the typed word is wrong", async () => {
    mocks.loadFmsWorkflowDeletionImpact.mockResolvedValue(impact("erase", 4));
    vi.spyOn(window, "prompt").mockReturnValue("delete");
    await clickDelete();
    expect(await screen.findByText(/Nothing was deleted/)).toBeTruthy();
    expect(mocks.deleteFmsWorkflow).not.toHaveBeenCalled();
  });
});
