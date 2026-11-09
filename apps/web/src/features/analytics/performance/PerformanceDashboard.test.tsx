// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const api = vi.hoisted(() => ({
  fetchTaskPerformance: vi.fn(),
  fetchTaskPerformanceOptions: vi.fn(),
  fetchTaskPerformanceRecords: vi.fn(),
  fetchTaskPerformanceStages: vi.fn(),
}));
const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock("@jewelos/data/analytics/index", () => api);
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: null }, access: { permissions: auth.permissions } }) }));
vi.mock("@jewelos/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@jewelos/core")>()),
  hasPermission: (_access: unknown, key: string) => auth.permissions.has(key),
}));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: () => () => {} }));
vi.mock("./Accountability", () => ({ Accountability: () => null }));

import { PerformanceDashboard } from "./PerformanceDashboard";
import { dashboardSectionFromSearch } from "../DashboardView";

const counts = { assigned: 10, on_time: 2, late: 2, completed_untimed: 1, pending: 2, in_progress: 1, overdue: 2 };
const payload = (scope: "me" | "team") => ({
  version: 1, generatedAt: "2026-11-05T08:00:00Z", timezone: "Asia/Kolkata", scope, canTeam: scope === "team", from: "2026-11-01", to: "2026-11-05", granularity: "day",
  summary: { ...counts, excluded: 2, excluded_rejected: 1, excluded_skipped: 1, excluded_stopped: 0, excluded_cancelled_run: 0, work_items: 9 },
  employees: [
    { user_profile_id: "43820000-0000-0000-0000-000000000003", employee_name: "Asha", branch_id: null, branch_name: "Main", department_id: null, department_name: "Sales", active: true, ...counts },
    { user_profile_id: "43820000-0000-0000-0000-000000000004", employee_name: "Bala", branch_id: null, branch_name: "Main", department_id: null, department_name: "Sales", active: true, assigned: 0, on_time: 0, late: 0, completed_untimed: 0, pending: 0, in_progress: 0, overdue: 0 },
  ],
  flows: [{ flow_id: "63820000-0000-0000-0000-0000000000ff", flow_name: "Order FMS", visits: 2, ...counts, assigned: 3, on_time: 0, late: 1, completed_untimed: 0, pending: 0, in_progress: 0, overdue: 2 }],
  trend: [{ bucket_start: "2026-11-04", due: 10, on_time: 2, late: 2, completed_untimed: 1, remaining: 5 }],
  kinds: [], branches: [], departments: [], backlog: { overdue_before_period: 3, people: 1 }, pendingStartForms: 1,
});
const options = { canTeam: true, me: { id: "x", name: "Me" }, branches: [], departments: [], employees: [], flows: [] };

afterEach(() => { cleanup(); vi.clearAllMocks(); auth.permissions = new Set(); window.history.replaceState({}, "", "/dashboard"); });

describe("dashboard sections", () => {
  it("opens on employee performance and keeps insights deep links working", () => {
    expect(dashboardSectionFromSearch("")).toBe("performance");
    expect(dashboardSectionFromSearch("?scope=team&from=2026-11-01")).toBe("performance");
    expect(dashboardSectionFromSearch("?tab=workflows&metric=overdue")).toBe("insights");
    expect(dashboardSectionFromSearch("?preset=this_month&groupBy=employee")).toBe("insights");
    expect(dashboardSectionFromSearch("?view=insights")).toBe("insights");
  });
});

describe("employee performance", () => {
  it("shows a staff member only their own performance with Task Control scores", async () => {
    api.fetchTaskPerformance.mockResolvedValue(payload("me"));
    api.fetchTaskPerformanceOptions.mockResolvedValue({ ...options, canTeam: false });
    api.fetchTaskPerformanceRecords.mockResolvedValue({ total: 0, offset: 0, limit: 8, rows: [] });
    render(<PerformanceDashboard onOpenInsights={() => {}} />);
    expect(await screen.findByRole("heading", { name: "My performance" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /All employees/ })).toBeNull();
    expect(api.fetchTaskPerformance.mock.calls[0]?.[0]).toMatchObject({ scope: "me" });
    // 5 of 10 completed -> -50.0%; 2 on time of 5 completed -> -60.0%.
    expect(screen.getAllByText("−50.0%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("−60.0%").length).toBeGreaterThan(0);
    const summary = screen.getByRole("table", { name: "Task work lifecycle" });
    expect(within(summary).getByRole("button", { name: "10 All assigned work" })).toBeTruthy();
    expect(within(summary).getByRole("button", { name: "1 No completion time" })).toBeTruthy();
    expect(screen.queryByText("Tasks assigned")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Completed vs remaining" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "On time vs delayed" })).toBeNull();
  });

  it("opens exactly the overdue records behind the Overdue count", async () => {
    api.fetchTaskPerformance.mockResolvedValue(payload("me"));
    api.fetchTaskPerformanceOptions.mockResolvedValue({ ...options, canTeam: false });
    api.fetchTaskPerformanceRecords.mockResolvedValue({ total: 2, offset: 0, limit: 25, rows: [] });
    render(<PerformanceDashboard onOpenInsights={() => {}} />);
    const summary = await screen.findByRole("table", { name: "Task work lifecycle" });
    fireEvent.click(within(summary).getByRole("button", { name: "2 Overdue" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(api.fetchTaskPerformanceRecords).toHaveBeenCalledWith(expect.objectContaining({ selector: "overdue", filter: expect.objectContaining({ scope: "me" }) }), expect.anything()));
    expect(within(dialog).queryByText(/Work changed since the count/)).toBeNull();
  });

  it("gives authorized leadership the all-employee table with clickable counts", async () => {
    auth.permissions = new Set(["dashboard.view_team_performance"]);
    api.fetchTaskPerformance.mockResolvedValue(payload("team"));
    api.fetchTaskPerformanceOptions.mockResolvedValue(options);
    api.fetchTaskPerformanceRecords.mockResolvedValue({ total: 2, offset: 0, limit: 25, rows: [] });
    render(<PerformanceDashboard onOpenInsights={() => {}} />);
    expect(await screen.findByRole("heading", { name: "All employees" })).toBeTruthy();
    expect(api.fetchTaskPerformance.mock.calls[0]?.[0]).toMatchObject({ scope: "team" });
    fireEvent.click(screen.getByTitle("Open Asha: Overdue"));
    await waitFor(() => expect(api.fetchTaskPerformanceRecords).toHaveBeenCalledWith(
      expect.objectContaining({ selector: "overdue", filter: expect.objectContaining({ scope: "team", user_profile_id: "43820000-0000-0000-0000-000000000003" }) }), expect.anything()));
    // No assigned work reads "No data", never a failing score.
    expect(screen.getAllByText("No data").length).toBeGreaterThan(0);
  });

  it("reports a failed load instead of drawing zeros", async () => {
    api.fetchTaskPerformance.mockRejectedValue({ code: "42501", message: "Team performance is not authorized" });
    api.fetchTaskPerformanceOptions.mockResolvedValue(options);
    render(<PerformanceDashboard onOpenInsights={() => {}} />);
    expect(await screen.findByText("Your access does not include this view.")).toBeTruthy();
    expect(screen.queryByText("Tasks assigned")).toBeNull();
    expect(api.fetchTaskPerformance).toHaveBeenCalledTimes(1);
  });

  it.each(["employee", "workflow", "backlog"] as const)("opens matching %s attention records", async (target) => {
    auth.permissions = new Set(["dashboard.view_team_performance"]);
    const data = payload("team");
    data.employees.push({ ...data.employees[0]!, user_profile_id: "43820000-0000-0000-0000-000000000005", employee_name: "Chitra", ...counts, assigned: 12, overdue: 4 });
    api.fetchTaskPerformance.mockResolvedValue(data);
    api.fetchTaskPerformanceOptions.mockResolvedValue(options);
    api.fetchTaskPerformanceRecords.mockResolvedValue({ total: 4, offset: 0, limit: 25, rows: [] });
    render(<PerformanceDashboard onOpenInsights={() => {}} />);
    const attention = await screen.findByRole("region", { name: "Needs attention" });
    const people = within(attention).getByRole("group", { name: "Employee follow-up" });
    expect(within(people).getAllByRole("button")[0]?.textContent).toContain("Chitra");
    const button = target === "employee" ? within(people).getByRole("button", { name: /Chitra/ }) : within(attention).getByRole("button", { name: target === "workflow" ? /Order FMS/ : /3 Older overdue assignments/ });
    fireEvent.click(button);
    const expected = target === "employee" ? { selector: "overdue", filter: expect.objectContaining({ user_profile_id: "43820000-0000-0000-0000-000000000005" }) } : target === "workflow" ? { selector: "overdue", filter: expect.objectContaining({ flow_id: data.flows[0]!.flow_id, kind: "fms" }) } : { selector: "backlog" };
    await waitFor(() => expect(api.fetchTaskPerformanceRecords).toHaveBeenLastCalledWith(expect.objectContaining(expected), expect.anything()));
    expect(screen.queryByRole("heading", { name: "FMS comparison" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Employee performance comparison" })).toBeNull();
  });

  it("keeps an empty cohort neutral while still surfacing older backlog", async () => {
    const data = payload("me");
    data.summary = { ...data.summary, assigned: 0, on_time: 0, late: 0, completed_untimed: 0, pending: 0, in_progress: 0, overdue: 0, work_items: 0 };
    api.fetchTaskPerformance.mockResolvedValue(data);
    api.fetchTaskPerformanceOptions.mockResolvedValue({ ...options, canTeam: false });
    api.fetchTaskPerformanceRecords.mockResolvedValue({ total: 0, offset: 0, limit: 8, rows: [] });
    render(<PerformanceDashboard onOpenInsights={() => {}} />);
    const summary = await screen.findByRole("table", { name: "Task work lifecycle" });
    expect(within(summary).getAllByText("No data")).toHaveLength(2);
    expect(within(summary).queryByText("No completion time")).toBeNull();
    expect(await screen.findByRole("button", { name: /3 Older overdue assignments/ })).toBeTruthy();
  });

  it("warns when counts do not reconcile", async () => {
    const data = payload("me");
    data.summary.assigned = 11;
    api.fetchTaskPerformance.mockResolvedValue(data);
    api.fetchTaskPerformanceOptions.mockResolvedValue({ ...options, canTeam: false });
    api.fetchTaskPerformanceRecords.mockResolvedValue({ total: 0, offset: 0, limit: 8, rows: [] });
    render(<PerformanceDashboard onOpenInsights={() => {}} />);
    expect(await screen.findByText("These counts do not add up. Refresh; if it persists, report it.")).toBeTruthy();
  });
});
