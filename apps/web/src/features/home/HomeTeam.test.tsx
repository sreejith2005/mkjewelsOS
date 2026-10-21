// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmployeeProgress, HomeSummary } from "@/features/analytics/types";
import { HomeView } from "./HomeView";

const mocks = vi.hoisted(() => ({ role: "super_admin", progress: vi.fn() }));
const summary: HomeSummary = {
  generated_at: "2026-10-20T04:00:00Z", tenant_local_date: "2026-10-20", timezone: "Asia/Kolkata",
  profile: { id: "lead-1", name: "Lead", role: "super_admin", branch_id: "branch-1", branch_name: "Main", department_id: "dept-1", department_name: null, working_status: "working" },
  tasks: [], fms_stages: [], fms_starters: [], forms_awaiting_submission: [], crm_followups: [],
  unread_notifications: 0, availability_status: null, recent_activity: [], quick_actions: [],
};
const progress: EmployeeProgress = {
  employees: [
    { user_profile_id: "4d130000-0000-0000-0000-000000000006", employee_name: "Asha Rao", branch_id: "b", branch_name: "Main", department_id: "d1", department_name: "Sales", assigned: 4, completed: 1, remaining: 3, overdue: 2, on_time_completed: 1 },
    { user_profile_id: "4d130000-0000-0000-0000-000000000007", employee_name: "Ravi Kumar", branch_id: "b", branch_name: "Main", department_id: "d2", department_name: "Stock", assigned: 2, completed: 2, remaining: 0, overdue: 0, on_time_completed: 2 },
  ],
  departments: [
    { department_id: "d1", department_name: "Sales", assigned: 4, completed: 1, remaining: 3, overdue: 2, on_time_completed: 1 },
    { department_id: "d2", department_name: "Stock", assigned: 2, completed: 2, remaining: 0, overdue: 0, on_time_completed: 2 },
  ],
  branches: [],
};

vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ branch: null, profile: { id: "lead-1", tenant_id: "tenant-1", user_role: mocks.role, employee_name: "Lead Person" } }) }));
vi.mock("@/features/analytics/useAsyncData", () => ({ useAsyncData: () => ({ data: summary, error: null, loading: false, retry: vi.fn() }) }));
vi.mock("@/features/analytics/api", () => ({ fetchHomeSummary: vi.fn(), fetchEmployeeTaskProgress: mocks.progress }));
vi.mock("@/features/notifications/api", () => ({ subscribeToInbox: () => () => undefined }));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: () => undefined }));

afterEach(() => { cleanup(); mocks.progress.mockReset(); });

describe("Home for leaders", () => {
  it("shows the team's day when the leader has no tasks of their own", async () => {
    mocks.role = "super_admin";
    mocks.progress.mockResolvedValue(progress);
    const navigate = vi.fn();
    render(<HomeView onNavigate={navigate} />);
    expect(await screen.findByText("Team completion today")).toBeTruthy();
    expect(screen.getByText("Team tasks")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
    expect(mocks.progress).toHaveBeenCalledWith({});
    const people = screen.getByRole("list", { name: "People with pending work" });
    expect(people.textContent).toContain("Asha Rao");
    expect(people.textContent).not.toContain("Ravi Kumar");
    fireEvent.click(screen.getByRole("button", { name: /Asha Rao/ }));
    expect(navigate).toHaveBeenCalledWith("/task-templates?tab=tasks&user=4d130000-0000-0000-0000-000000000006");
  });

  it("keeps the personal Home for other roles and when team data is unavailable", async () => {
    mocks.role = "staff";
    render(<HomeView onNavigate={vi.fn()} />);
    expect(screen.queryByText("Team today")).toBeNull();
    expect(mocks.progress).not.toHaveBeenCalled();
    cleanup();
    mocks.role = "admin";
    mocks.progress.mockRejectedValue(new Error("Employee progress is not authorized"));
    render(<HomeView onNavigate={vi.fn()} />);
    await Promise.resolve();
    expect(screen.queryByText("Team today")).toBeNull();
    expect(screen.getByText("Today’s Completion")).toBeTruthy();
  });
});
