// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FmsData } from "@/features/fms/api";
import type { UserProfile } from "@/types";
import { FMSBuilderPage } from "./FMSBuilderPage";

const mocks = vi.hoisted(() => ({
  loadFmsBuilderData: vi.fn(),
  startFmsInstance: vi.fn(),
}));

vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ profile: { id: "admin", user_role: "admin", branch_id: "andheri", department_id: "admin" } as UserProfile }) }));
vi.mock("@/features/fms/api", async () => ({
  loadFmsBuilderData: mocks.loadFmsBuilderData,
  startFmsInstance: mocks.startFmsInstance,
  archiveFmsFlow: vi.fn(),
  publishFmsFlow: vi.fn(),
  reviseFmsFlow: vi.fn(),
  saveFmsDraft: vi.fn(),
}));
vi.mock("./FMSTasksPage", () => ({ FMSTasksPage: ({ initialInstanceId }: { initialInstanceId?: string }) => <div>Live instance {initialInstanceId ?? "list"}</div> }));

const data = {
  flows: [{ id: "flow", family_id: "family", version: 1, name: "Sales intake", description: null, status: "published", scope_type: "department", branch_id: "andheri", department_id: "sales", is_active: true, usage_count: 0 }],
  stages: [{ id: "first", fms_flow_id: "flow", stage_key: "details", name: "Customer details", step_type: "form", sort_order: 0, form_template_id: "form" }],
  assignees: [{ fms_stage_id: "first", assignee_type: "specific_user", user_profile_id: "owner", fallback_user_profile_id: null, role_value: null, allow_next_selection: false, sort_order: 0 }],
  users: [{ id: "owner", employee_name: "Workflow Owner", user_role: "staff", branch_id: "andheri", department_id: "sales", working_status: "active", account_status: "active", is_login_enabled: true }],
  availability: [], branches: [{ id: "andheri", name: "Andheri" }], departments: [{ id: "sales", branch_id: "andheri", name: "Sales" }], branchRules: [], forms: [],
} as unknown as FmsData;

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("published FMS quick start", () => {
  it("lets the builder heading wrap its primary action on narrow screens", async () => {
    mocks.loadFmsBuilderData.mockResolvedValue(data);
    render(<FMSBuilderPage />);

    const create = await screen.findByRole("button", { name: "New workflow" });
    expect(create.parentElement?.className).toContain("flex-wrap");
  });

  it("starts in one click without rendering start settings and opens the new instance", async () => {
    mocks.loadFmsBuilderData.mockResolvedValue(data);
    mocks.startFmsInstance.mockResolvedValue({ instance_id: "instance-1", reference_number: "FMS-1" });
    const user = userEvent.setup();
    render(<FMSBuilderPage />);

    await user.click(screen.getByRole("button", { name: "Flow library" }));
    await screen.findByText("Sales intake");
    expect(screen.queryByText("Instance title")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Start instance" }));

    await waitFor(() => expect(mocks.startFmsInstance).toHaveBeenCalledWith(expect.objectContaining({ flowId: "flow", title: "Sales intake", branchId: "andheri", departmentId: "sales", firstAssigneeId: "owner", context: {} })));
    expect(await screen.findByText("Live instance instance-1")).toBeTruthy();
    expect(screen.queryByText("Start workflow")).toBeNull();
  });
});
