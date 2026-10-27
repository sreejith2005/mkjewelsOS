// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FmsData } from "@/features/fms/api";
import type { UserProfile } from "@/types";
import { FMSBuilderPage } from "./FMSBuilderPage";

const mocks = vi.hoisted(() => ({
  loadFmsBuilderData: vi.fn(),
  loadFmsRuntime: vi.fn(),
  startFmsInstance: vi.fn(),
  setFmsFlowActive: vi.fn(),
  deleteFmsFlow: vi.fn(),
}));

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

afterEach(() => { cleanup(); vi.clearAllMocks(); window.history.replaceState({}, "", "/fms"); });

describe("unified FMS console", () => {
  it("opens the exact authorized source version even when workflow names match", async () => {
    window.history.replaceState({}, "", "/fms?flow=older-source");
    mocks.loadFmsBuilderData.mockResolvedValue({ ...data, flows: [...data.flows, { ...flow, id: "older-source", version: 0, status: "archived", description: "Exact historical source" }] });
    mocks.loadFmsRuntime.mockResolvedValue(runtime);
    render(<FMSBuilderPage />);
    expect(await screen.findByRole("heading", { name: "Source FMS — Sales intake · v0" }, { timeout: 20_000 })).toBeTruthy();
    expect(screen.getByText(/Exact historical source/)).toBeTruthy();
    expect(mocks.setFmsFlowActive).not.toHaveBeenCalled();
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

  it("deletes a flow from the same card", async () => {
    mocks.loadFmsBuilderData.mockResolvedValue(data);
    mocks.loadFmsRuntime.mockResolvedValue(runtime);
    mocks.deleteFmsFlow.mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<FMSBuilderPage />);

    await screen.findByText("Sales intake");
    await user.click(screen.getByRole("button", { name: "Delete Sales intake" }));

    await waitFor(() => expect(mocks.deleteFmsFlow).toHaveBeenCalledWith("flow"));
  });
});
