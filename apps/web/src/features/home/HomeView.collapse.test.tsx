// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HomeSummary } from "@/features/analytics/types";
import { HomeView } from "./HomeView";

const summary: HomeSummary = {
  generated_at: "2026-09-23T04:00:00Z",
  tenant_local_date: "2026-09-23",
  timezone: "Asia/Kolkata",
  profile: { id: "user-1", name: "Asha Rao", role: "staff", branch_id: "branch-1", branch_name: "Main", department_id: "dept-1", department_name: null, working_status: "working" },
  tasks: [{ id: "task-1", title: "Polish display tray", task_type: "one_time", status: "pending", priority: "medium", due_at: "2026-09-23T12:00:00Z", overdue: false, checklist_completion: null }],
  fms_stages: [],
  fms_starters: [],
  forms_awaiting_submission: [],
  crm_followups: [{ id: "follow-1", client_id: "client-1", subject: "Call about bangles", due_date: "2026-09-23", status: "open", overdue: false }],
  unread_notifications: 0,
  availability_status: null,
  recent_activity: [],
  quick_actions: [],
};

vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ branch: null, profile: { id: "user-1", tenant_id: "tenant-1", user_role: "staff", employee_name: "Asha Rao" } }) }));
vi.mock("@/features/analytics/useAsyncData", () => ({ useAsyncData: () => ({ data: summary, error: null, loading: false, retry: vi.fn() }) }));
vi.mock("@/features/analytics/api", () => ({ fetchHomeSummary: vi.fn() }));
vi.mock("@/features/notifications/api", () => ({ subscribeToInbox: () => () => undefined }));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: () => undefined }));

afterEach(cleanup);

describe("HomeView collapsible work groups", () => {
  it("opens every group by default and collapses each one independently", () => {
    render(<HomeView onNavigate={vi.fn()} />);

    const tasks = screen.getByRole("button", { name: "My Tasks" });
    const fms = screen.getByRole("button", { name: "FMS Tasks" });
    const crm = screen.getByRole("button", { name: "CRM Tasks" });
    for (const toggle of [tasks, fms, crm]) expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /Polish display tray/ })).toBeTruthy();

    fireEvent.click(tasks);

    expect(tasks.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /Polish display tray/ })).toBeNull();
    expect(screen.getByText("Polish display tray", { selector: "span" })).toBeTruthy();
    expect(crm.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /Call about bangles/ })).toBeTruthy();

    fireEvent.click(tasks);

    expect(tasks.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /Polish display tray/ })).toBeTruthy();
  });
});
