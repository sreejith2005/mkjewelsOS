// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HomeSummary } from "@/features/analytics/types";
import { HomeView } from "./HomeView";
import { buildWorkCards, dueLabel } from "./HomeWorkCards";

const task = (id: string, task_type: string, extra: Partial<HomeSummary["tasks"][number]> = {}): HomeSummary["tasks"][number] =>
  ({ id, title: `Task ${id}`, task_type, status: "pending", priority: "medium", due_at: "2026-09-23T12:00:00Z", overdue: false, checklist_completion: null, ...extra });

const summary: HomeSummary = {
  generated_at: "2026-09-23T04:00:00Z",
  tenant_local_date: "2026-09-23",
  timezone: "Asia/Kolkata",
  profile: { id: "user-1", name: "Asha Rao", role: "staff", branch_id: "branch-1", branch_name: "Main", department_id: "dept-1", department_name: null, working_status: "working" },
  tasks: [
    { ...task("11111111-1111-1111-1111-111111111111", "delegation"), title: "Polish display tray" },
    { ...task("22222222-2222-2222-2222-222222222222", "checklist", { overdue: true }), title: "Open the safe" },
  ],
  fms_stages: [],
  fms_starters: [{ id: "starter-1", fms_flow_id: "flow-1", form_template_id: "form-1", form_name: "Lead form", flow_name: "Instagram leads", stage_name: "Start", assigned_at: "2026-09-23T04:00:00Z" }],
  forms_awaiting_submission: [{ task_id: "11111111-1111-1111-1111-111111111111", form_template_id: "form-2", form_name: "Tray check", task_title: "Polish display tray", due_at: "2026-09-23T12:00:00Z" }],
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

afterEach(() => { cleanup(); });

describe("Home work cards", () => {
  it("puts each kind of work in its own card with a count", () => {
    render(<HomeView onNavigate={vi.fn()} />);
    const checklist = screen.getByRole("article", { name: "Daily Checklist" });
    const mine = screen.getByRole("article", { name: "My Tasks" });
    const fms = screen.getByRole("article", { name: "FMS Tasks" });

    expect(within(checklist).getByText("Open the safe")).toBeTruthy();
    expect(within(checklist).getByText("1 overdue")).toBeTruthy();
    expect(within(mine).getByText("Polish display tray")).toBeTruthy();
    expect(within(mine).getByText("Form: Tray check")).toBeTruthy();
    expect(within(fms).getByText("Instagram leads")).toBeTruthy();
    expect(within(fms).getByText("Starting form: Lead form")).toBeTruthy();
    expect(within(mine).getByLabelText("1 waiting")).toBeTruthy();
  });

  it("opens the exact task or FMS work, and the full lists from each card", () => {
    const onNavigate = vi.fn();
    render(<HomeView onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: /Polish display tray/ }));
    expect(onNavigate).toHaveBeenLastCalledWith("/tasks?task_id=11111111-1111-1111-1111-111111111111");
    fireEvent.click(screen.getByRole("button", { name: /Instagram leads/ }));
    expect(onNavigate.mock.lastCall?.[0]).toContain("starter");
    fireEvent.click(within(screen.getByRole("article", { name: "FMS Tasks" })).getByRole("button", { name: "Open FMS tasks" }));
    expect(onNavigate).toHaveBeenLastCalledWith("/tasks/fms");
  });

  it("switches cards from the labelled switcher", () => {
    render(<HomeView onNavigate={vi.fn()} />);
    const fmsTab = screen.getByRole("button", { name: "Show FMS Tasks, 1 waiting" });
    expect(screen.getByRole("button", { name: "Show Daily Checklist, 1 waiting" }).getAttribute("aria-current")).toBe("true");
    fireEvent.click(fmsTab);
    expect(fmsTab.getAttribute("aria-current")).toBe("true");
  });

  it("shows a friendly empty state", () => {
    const cards = buildWorkCards({ ...summary, tasks: [], fms_starters: [] });
    expect(cards.map((card) => card.items.length)).toEqual([0, 0, 0]);
    expect(cards.map((card) => card.emptyTitle)).toEqual(["Checklist clear", "All caught up", "No steps waiting"]);
  });

  it("marks a count as partial when the server list hit its limit", () => {
    const tasks = Array.from({ length: 10 }, (_, index) => task(`t${index}`, "delegation"));
    const mine = buildWorkCards({ ...summary, tasks }).find((card) => card.id === "mine");
    expect(mine?.items).toHaveLength(10);
    expect(mine?.capped).toBe(true);
  });

  it("hides the old CRM follow-ups since the CRM cutover", () => {
    render(<HomeView onNavigate={vi.fn()} />);
    expect(screen.queryByText("CRM Follow-ups Due")).toBeNull();
    expect(screen.queryByText(/Call about bangles/)).toBeNull();
  });
});

it("labels due times relative to today in the company timezone", () => {
  const now = new Date("2026-09-23T06:00:00Z");
  expect(dueLabel("2026-09-23T12:00:00Z", "Asia/Kolkata", now)).toMatch(/^Today, 5:30/);
  expect(dueLabel("2026-09-24T04:00:00Z", "Asia/Kolkata", now)).toMatch(/^Tomorrow, 9:30/);
  expect(dueLabel(null, "Asia/Kolkata", now)).toBe("No due time");
});

it("distinguishes otherwise identical FMS actions by their persisted reference", () => {
  const stages = ["FMS-41", "FMS-42"].map((reference_number, index) => ({ stage_id: `visit-${index}`, instance_id: `instance-${index}`, form_template_id: "form", form_name: "Call form", reference_number, instance_title: "Instagram leads", stage_name: "Introduction call", status: "pending", planned_datetime: null, sla_breached: false }));
  summary.fms_stages = stages;
  render(<HomeView onNavigate={vi.fn()} />);
  expect(screen.getByText("Instagram leads - Introduction call | FMS-41")).toBeTruthy();
  expect(screen.getByText("Instagram leads - Introduction call | FMS-42")).toBeTruthy();
  summary.fms_stages = [];
});
